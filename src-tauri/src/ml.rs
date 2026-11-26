//! Precise selection's models (src/ml/precise), run natively with ONNX
//! Runtime: on the GPU through DirectML on Windows, on the CPU elsewhere.
//!
//! The page sends tensors in and gets tensors back, as raw bytes (a JSON
//! header, then the data), so nothing is copied through JSON. A run can keep
//! some of its outputs here under a name (a photo's image embeddings, 16 MB)
//! for later runs to take as inputs, so they never cross back and forth.
//!
//! ONNX Runtime's prebuilt libraries are linked in for Apple silicon and
//! Windows. An Intel Mac has none, and Linux's needs a newer glibc than the
//! Linux build is made for: there precise selection's first model runs in the
//! page (WebGPU on an Intel Mac, the CPU on Linux) and the second is not used. On a Mac the
//! runtime would add Core ML on its own: it is kept to the CPU, as Core ML
//! aborted the process on one of these models and hung on another (Nov 23).

use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request, Response};

/// What this build can run natively.
#[derive(Serialize)]
pub struct MlInfo {
    /// Models can be run here (ml_load, ml_run).
    pub native: bool,
    /// The GPU's way of running them, if any: "directml" on Windows.
    pub gpu: Option<&'static str>,
}

#[tauri::command]
pub fn ml_info() -> MlInfo {
    MlInfo { native: imp::NATIVE, gpu: imp::GPU }
}

/// Opens a model (its .onnx file; its weights beside it) under a name. Says how it runs: "directml" or "cpu".
#[tauri::command(async)]
pub fn ml_load(state: tauri::State<'_, imp::Ml>, name: String, path: String) -> Result<String, String> {
    imp::load(&state, name, PathBuf::from(path))
}

/// Closes a model, and lets go of everything kept under a prefix.
#[tauri::command(async)]
pub fn ml_unload(state: tauri::State<'_, imp::Ml>, name: Option<String>, kept: Option<String>) -> Result<(), String> {
    imp::unload(&state, name, kept)
}

/// Runs a model. The body: a little-endian u32, that many bytes of JSON (RunHeader), then the inputs' data.
#[tauri::command(async)]
pub fn ml_run(state: tauri::State<'_, imp::Ml>, request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("expected the run's bytes".into());
    };
    imp::run(&state, body).map(Response::new)
}

/// Adds bytes to the end of a file (made if missing): a model downloaded a piece at a time.
#[tauri::command(async)]
pub fn ml_append(request: Request<'_>) -> Result<u64, String> {
    let encoded = request.headers().get("x-path").and_then(|v| v.to_str().ok()).ok_or("no path given")?;
    let path = PathBuf::from(urlencoding::decode(encoded).map_err(|e| e.to_string())?.into_owned());
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.metadata().map(|m| m.len()).map_err(|e| e.to_string())
}

/// What a run is asked to do (the JSON at the front of ml_run's body).
#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct RunHeader {
    session: String,
    inputs: Vec<InputSpec>,
    /// Outputs sent back, by name.
    #[serde(default)]
    outputs: Vec<String>,
    /// Outputs kept here: output name to the name it is kept under.
    #[serde(default)]
    keep: std::collections::HashMap<String, String>,
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct InputSpec {
    name: String,
    /// "f32" or "i64", with its shape and where its bytes are after the header.
    #[serde(rename = "type")]
    ty: Option<String>,
    #[serde(default)]
    shape: Vec<i64>,
    #[serde(default)]
    offset: usize,
    #[serde(default)]
    bytes: usize,
    /// Or something kept by an earlier run, by the name it was kept under.
    kept: Option<String>,
}

#[derive(Serialize)]
#[allow(dead_code)]
struct OutputSpec {
    name: String,
    shape: Vec<i64>,
    offset: usize,
    bytes: usize,
}

#[allow(dead_code)]
fn split_body(body: &[u8]) -> Result<(RunHeader, &[u8]), String> {
    if body.len() < 4 {
        return Err("the run's bytes are cut short".into());
    }
    let len = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    if body.len() < 4 + len {
        return Err("the run's header is cut short".into());
    }
    let header: RunHeader = serde_json::from_slice(&body[4..4 + len]).map_err(|e| format!("the run's header: {e}"))?;
    Ok((header, &body[4 + len..]))
}

#[cfg(any(all(target_os = "macos", target_arch = "aarch64"), all(target_os = "windows", target_arch = "x86_64")))]
mod imp {
    use super::*;
    use ort::session::builder::{AutoDevicePolicy, GraphOptimizationLevel};
    use ort::session::{Session, SessionInputValue};
    use ort::value::{DynValue, Tensor};
    use std::borrow::Cow;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};

    pub const NATIVE: bool = true;
    #[cfg(target_os = "windows")]
    pub const GPU: Option<&'static str> = Some("directml");
    #[cfg(not(target_os = "windows"))]
    pub const GPU: Option<&'static str> = None;

    #[derive(Default)]
    pub struct Ml {
        sessions: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
        kept: Mutex<HashMap<String, Arc<DynValue>>>,
    }

    fn environment() -> Result<&'static ort::environment::Environment, String> {
        static ENV: OnceLock<Result<ort::environment::Environment, String>> = OnceLock::new();
        ENV.get_or_init(|| ort::environment::init().with_name("copyshop").build().map_err(|e| e.to_string())).as_ref().map_err(|e| e.clone())
    }

    fn builder() -> Result<ort::session::builder::SessionBuilder, String> {
        let e = |e: ort::Error| e.to_string();
        // Half the cores, the rest for the app and everything else: BiRefNet takes seconds,
        // and the window (and the user's other apps) have to keep going. All but two of
        // them pinned the Mac while it ran.
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        Session::builder(environment()?)
            .map_err(e)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| e.to_string())?
            .with_intra_threads((cores / 2).max(2))
            .map_err(|e| e.to_string())?
            // Never an execution provider the runtime picks itself (Core ML, on a Mac).
            .with_auto_device(AutoDevicePolicy::PreferCPU)
            .map_err(|e| e.to_string())
    }

    pub fn load(state: &Ml, name: String, path: PathBuf) -> Result<String, String> {
        if !path.is_file() {
            return Err(format!("{} is missing", path.display()));
        }
        #[cfg(target_os = "windows")]
        {
            // DirectML wants no memory pattern and one node at a time; a GPU or driver it can't use falls back to the CPU.
            let gpu = builder()
                .and_then(|b| b.with_memory_pattern(false).map_err(|e| e.to_string()))
                .and_then(|b| b.with_parallel_execution(false).map_err(|e| e.to_string()))
                .and_then(|b| b.with_execution_providers([ort::ep::DirectML::default().build().error_on_failure()]).map_err(|e| e.to_string()))
                .and_then(|mut b| b.commit_from_file(&path).map_err(|e| e.to_string()));
            match gpu {
                Ok(session) => {
                    state.sessions.lock().unwrap().insert(name, Arc::new(Mutex::new(session)));
                    return Ok("directml".into());
                }
                Err(err) => eprintln!("precise selection: DirectML could not run {}: {err}; on the CPU instead", path.display()),
            }
        }
        // No arena and no memory pattern on the CPU: what a run takes (gigabytes, for
        // BiRefNet at 1024 px) goes back to the system when it ends, instead of being
        // kept for the next run for as long as the model is loaded.
        let session = builder()?
            .with_memory_pattern(false)
            .map_err(|e| e.to_string())?
            .with_execution_providers([ort::ep::CPU::default().with_arena_allocator(false).build()])
            .map_err(|e| e.to_string())?
            .commit_from_file(&path)
            .map_err(|e| e.to_string())?;
        state.sessions.lock().unwrap().insert(name, Arc::new(Mutex::new(session)));
        Ok("cpu".into())
    }

    pub fn unload(state: &Ml, name: Option<String>, kept: Option<String>) -> Result<(), String> {
        if let Some(name) = name {
            state.sessions.lock().unwrap().remove(&name);
        }
        if let Some(prefix) = kept {
            state.kept.lock().unwrap().retain(|k, _| !k.starts_with(&prefix));
        }
        Ok(())
    }

    fn floats(bytes: &[u8]) -> Vec<f32> {
        bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
    }
    fn longs(bytes: &[u8]) -> Vec<i64> {
        bytes.chunks_exact(8).map(|c| i64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]])).collect()
    }

    pub fn run(state: &Ml, body: &[u8]) -> Result<Vec<u8>, String> {
        let (header, data) = split_body(body)?;
        let session = state.sessions.lock().unwrap().get(&header.session).cloned().ok_or_else(|| format!("the model {} is not open", header.session))?;
        // Owned inputs first, then the kept ones looked up: both live until the run is done.
        let mut owned: Vec<(String, DynValue)> = Vec::new();
        let mut borrowed: Vec<(String, Arc<DynValue>)> = Vec::new();
        for input in &header.inputs {
            if let Some(key) = &input.kept {
                let value = state.kept.lock().unwrap().get(key).cloned().ok_or_else(|| format!("nothing is kept as {key}"))?;
                borrowed.push((input.name.clone(), value));
                continue;
            }
            let end = input.offset.checked_add(input.bytes).filter(|&e| e <= data.len()).ok_or_else(|| format!("{}: its bytes are out of range", input.name))?;
            let raw = &data[input.offset..end];
            let shape: Vec<usize> = input.shape.iter().map(|&d| d.max(0) as usize).collect();
            let value: DynValue = match input.ty.as_deref() {
                Some("i64") => Tensor::from_array((shape, longs(raw))).map_err(|e| format!("{}: {e}", input.name))?.into_dyn(),
                _ => Tensor::from_array((shape, floats(raw))).map_err(|e| format!("{}: {e}", input.name))?.into_dyn(),
            };
            owned.push((input.name.clone(), value));
        }
        let mut inputs: Vec<(Cow<'_, str>, SessionInputValue<'_>)> = Vec::new();
        for (name, value) in &owned {
            inputs.push((Cow::Borrowed(name.as_str()), SessionInputValue::from(value.view())));
        }
        for (name, value) in &borrowed {
            inputs.push((Cow::Borrowed(name.as_str()), SessionInputValue::from(value.view())));
        }
        let mut session = session.lock().unwrap();
        let mut outputs = session.run(inputs).map_err(|e| e.to_string())?;
        let mut specs = Vec::new();
        let mut out = Vec::new();
        for name in &header.outputs {
            let value = outputs.get(name.as_str()).ok_or_else(|| format!("the model gave no {name}"))?;
            let (shape, values) = value.try_extract_tensor::<f32>().map_err(|e| format!("{name}: {e}"))?;
            let offset = out.len();
            out.reserve(values.len() * 4);
            for v in values {
                out.extend_from_slice(&v.to_le_bytes());
            }
            specs.push(OutputSpec { name: name.clone(), shape: shape.iter().copied().collect(), offset, bytes: values.len() * 4 });
        }
        for (name, key) in &header.keep {
            let value = outputs.remove(name.as_str()).ok_or_else(|| format!("the model gave no {name} to keep"))?;
            state.kept.lock().unwrap().insert(key.clone(), Arc::new(value));
        }
        let json = serde_json::to_vec(&serde_json::json!({ "outputs": specs })).map_err(|e| e.to_string())?;
        let mut response = Vec::with_capacity(4 + json.len() + out.len());
        response.extend_from_slice(&(json.len() as u32).to_le_bytes());
        response.extend_from_slice(&json);
        response.extend_from_slice(&out);
        Ok(response)
    }
}

/// No native runtime in this build (an Intel Mac, Linux): precise selection runs what it can in the page.
#[cfg(not(any(all(target_os = "macos", target_arch = "aarch64"), all(target_os = "windows", target_arch = "x86_64"))))]
mod imp {
    use super::*;
    pub const NATIVE: bool = false;
    pub const GPU: Option<&'static str> = None;
    #[derive(Default)]
    pub struct Ml;
    const NONE: &str = "precise selection's native runtime is not in this build";
    pub fn load(_: &Ml, _: String, _: PathBuf) -> Result<String, String> {
        Err(NONE.into())
    }
    pub fn unload(_: &Ml, _: Option<String>, _: Option<String>) -> Result<(), String> {
        Ok(())
    }
    pub fn run(_: &Ml, _: &[u8]) -> Result<Vec<u8>, String> {
        Err(NONE.into())
    }
}

pub use imp::Ml;
