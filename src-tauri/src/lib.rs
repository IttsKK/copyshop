//! copyshop as a desktop app.
//!
//! The whole app is the web page in src/; this side only gives it what a
//! browser cannot: files by path. Folders the user picks are remembered as
//! paths, so they never need their permission asked for again, and the
//! library and session live as plain files in the same folder the browser
//! launcher (scripts/app.mjs) uses, in the same layout, so either finds what
//! the other saved.
//!
//! The page is the app's own, loaded from inside the bundle, so these
//! commands take any path, as a desktop app's file access does.
//!
//! Anything that touches the disk or runs a tool is `async`: a plain command
//! runs on the main thread, and the whole window stood still while a photo
//! was read, written or developed.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// Thumbnails and RAW files in Rust, off the Mac (there sips does both).
#[cfg(any(not(target_os = "macos"), test))]
mod portable;

/// Library and session: ~/Library/Application Support/copyshop, or
/// GRAIN_EMULATOR_DATA, as for the launcher. The folder the app used as
/// Grain Emulator is moved here the first time, so nothing is left behind.
/// The panel toggles, as in src/ui/shortcuts.ts PANEL_KEYS: Option-Command on
/// a Mac; elsewhere Ctrl+Shift, because Windows reads AltGr as Ctrl+Alt.
#[cfg(target_os = "macos")]
const PANEL_KEYS: [&str; 3] = ["Alt+CmdOrCtrl+1", "Alt+CmdOrCtrl+2", "Alt+CmdOrCtrl+3"];
#[cfg(not(target_os = "macos"))]
const PANEL_KEYS: [&str; 3] = ["CmdOrCtrl+Shift+1", "CmdOrCtrl+Shift+2", "CmdOrCtrl+Shift+3"];

#[tauri::command]
fn data_dir() -> Result<String, String> {
    if let Ok(dir) = std::env::var("GRAIN_EMULATOR_DATA") {
        if !dir.is_empty() {
            return Ok(dir);
        }
    }
    // Windows has no HOME, as a rule: the profile folder instead.
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map_err(|e| e.to_string())?;
    let (dir, old) = if cfg!(target_os = "macos") {
        let support = PathBuf::from(home).join("Library").join("Application Support");
        (support.join("copyshop"), support.join("Grain Emulator"))
    } else {
        (PathBuf::from(&home).join(".copyshop"), PathBuf::from(&home).join(".grain-emulator"))
    };
    if !dir.exists() && old.is_dir() {
        let _ = fs::rename(&old, &dir);
    }
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

/// A file moved (renamed) within its disk; never over a file already at `to`.
#[tauri::command(async)]
fn move_file(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err(format!("{to} is there already"));
    }
    if let Some(parent) = Path::new(&to).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// A file put in the Trash (the Recycle Bin on Windows), from where it can
/// be put back. On a Mac by the system's file manager, not the Finder,
/// which would ask for permission to control it.
#[cfg(desktop)]
#[tauri::command(async)]
fn trash_file(path: String) -> Result<(), String> {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete(&path).map_err(|e| e.to_string())
}

/// The first `len` bytes of a file (all of it if it is shorter): where a
/// photo's EXIF is, read for many photos at once without reading them whole.
#[tauri::command(async)]
fn read_head(path: String, len: u64) -> Result<Response, String> {
    use std::io::Read;
    let mut out = Vec::new();
    fs::File::open(&path).and_then(|f| f.take(len).read_to_end(&mut out)).map_err(|e| e.to_string())?;
    Ok(Response::new(out))
}

/// Bytes in the request body, the path in an x-path header (URI-encoded:
/// headers are ASCII, paths need not be). Written beside the target and
/// renamed over it, so a crash never leaves half a file. Each write has a
/// temporary file of its own: two saves of one record at once (the previews
/// list, rewritten as thumbnails land) shared one before, and the second's
/// rename found it already moved and failed.
#[tauri::command(async)]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let encoded = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("no path given")?;
    let path = PathBuf::from(urlencoding::decode(encoded).map_err(|e| e.to_string())?.into_owned());
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    static WRITES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = WRITES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut tmp = path.clone().into_os_string();
    tmp.push(format!(".{}-{}.tmp", std::process::id(), n));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    // Windows can refuse a rename over a file another write is just replacing: try again briefly.
    let mut tries = 0;
    loop {
        match fs::rename(&tmp, &path) {
            Ok(()) => return Ok(()),
            Err(_) if tries < 5 => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e.to_string());
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    name: String,
    is_file: bool,
}

#[tauri::command(async)]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // Hidden files (.DS_Store, a write's .tmp) are not the user's.
        if name.starts_with('.') {
            continue;
        }
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        out.push(DirEntry { name, is_file });
    }
    Ok(out)
}

#[tauri::command(async)]
fn remove_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// A web page in the default browser: buying the app, finding a license key,
/// and the browser version when bringing its edits in. Only http(s).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return Err("Only web and mail addresses can be opened".into());
    }
    let program = if cfg!(target_os = "macos") { "open" } else if cfg!(target_os = "windows") { "explorer" } else { "xdg-open" };
    std::process::Command::new(program).arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// A folder opened in the Finder, or with `select`, a file shown selected in
/// its folder (the system's own file manager elsewhere).
#[tauri::command]
fn reveal(path: String, select: bool) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("{path} is not there any more"));
    }
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        if select {
            c.arg("-R");
        }
        c.arg(&path);
        c
    } else if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("explorer");
        if select {
            c.arg(format!("/select,{path}"));
        } else {
            c.arg(&path);
        }
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        let target = if select { std::path::Path::new(&path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or(path.clone()) } else { path.clone() };
        c.arg(target);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn spotlight(name: &str) -> Vec<String> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let escaped: String = name
        .chars()
        .flat_map(|c| if matches!(c, '"' | '\\' | '*') { vec!['\\', c] } else { vec![c] })
        .collect();
    let query = format!("kMDItemFSName == \"{escaped}\"");
    Command::new("mdfind")
        .arg(query)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(str::to_owned).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default()
}

/// An export's original, wherever it is: Spotlight finds files by the
/// original's name (or the name Originals/ gives a clashing one), copies in
/// an Originals folder are tried first, and only a file of the recorded size
/// and SHA-256 is returned.
#[tauri::command(async)]
fn find_original(name: String, size: u64, sha256: String) -> Result<Response, String> {
    let hash = sha256.to_lowercase();
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) || name.is_empty() || name.contains('/') {
        return Err("bad request".into());
    }
    let archived = match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{}-{}{}", &name[..dot], &hash[..8], &name[dot..]),
        _ => format!("{}-{}", name, &hash[..8]),
    };
    let mut found = spotlight(&name);
    for path in spotlight(&archived) {
        if !found.contains(&path) {
            found.push(path);
        }
    }
    let in_originals = |p: &String| {
        Path::new(p).parent().and_then(|d| d.file_name()).map(|n| n == "Originals").unwrap_or(false)
    };
    found.sort_by_key(|p| !in_originals(p));
    for path in found.iter().take(50) {
        if size > 0 && fs::metadata(path).map(|m| m.len()).unwrap_or(0) != size {
            continue;
        }
        let Ok(bytes) = fs::read(path) else { continue };
        let digest = Sha256::digest(&bytes);
        let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        if hex == hash {
            return Ok(Response::new(bytes));
        }
    }
    Err("not found".into())
}

#[derive(Serialize)]
struct HashMatch {
    prefix: String,
    path: String,
}

/// Images whose SHA-256 starts with one of `prefixes`, found by walking
/// `roots` in order (a leading ~ is the home folder): how a collage image
/// that left the app's library is found again, since it is named by its
/// contents and its file name may not be known. Hidden folders, Library and
/// app bundles are skipped; a folder reached twice is walked once; the walk
/// stops when every prefix is found.
#[tauri::command(async)]
fn find_by_hash(roots: Vec<String>, prefixes: Vec<String>) -> Vec<HashMatch> {
    let mut wanted: Vec<String> = prefixes
        .into_iter()
        .map(|p| p.to_lowercase())
        .filter(|p| p.len() >= 16 && p.len() <= 64 && p.chars().all(|c| c.is_ascii_hexdigit()))
        .collect();
    let mut found = Vec::new();
    if wanted.is_empty() {
        return found;
    }
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let mut checked = 0usize;
    for root in roots {
        let root = match root.strip_prefix("~/") {
            Some(rest) if !home.is_empty() => format!("{home}/{rest}"),
            _ => root,
        };
        let mut stack = vec![(PathBuf::from(root), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            if wanted.is_empty() || checked > 60_000 {
                return found;
            }
            let Ok(real) = fs::canonicalize(&dir) else { continue };
            if !seen.insert(real) {
                continue;
            }
            let Ok(entries) = fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                let path = entry.path();
                let Ok(kind) = entry.file_type() else { continue };
                if kind.is_dir() {
                    if depth < 10 && name != "Library" && !name.ends_with(".app") && name != "node_modules" {
                        stack.push((path, depth + 1));
                    }
                    continue;
                }
                let lower = name.to_lowercase();
                if !kind.is_file() || ![".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".heif", ".avif", ".bmp", ".gif"].iter().any(|e| lower.ends_with(e)) {
                    continue;
                }
                checked += 1;
                let Ok(bytes) = fs::read(&path) else { continue };
                let digest = Sha256::digest(&bytes);
                let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
                if let Some(at) = wanted.iter().position(|p| hex.starts_with(p.as_str())) {
                    found.push(HashMatch { prefix: wanted.remove(at), path: path.to_string_lossy().into_owned() });
                    if wanted.is_empty() {
                        return found;
                    }
                }
            }
        }
    }
    found
}

/// A request header as text, %-decoded; empty when absent.
fn header(request: &Request<'_>, key: &str) -> String {
    request
        .headers()
        .get(key)
        .and_then(|v| v.to_str().ok())
        .map(|s| urlencoding::decode(s).map(|c| c.into_owned()).unwrap_or_default())
        .unwrap_or_default()
}

/// A file in the system's temporary folder for sips to read or write: the
/// extension kept from `name` (letters and digits only), or `fallback`.
#[cfg(target_os = "macos")]
fn temp_file(tag: &str, name: &str, fallback: &str) -> PathBuf {
    let ext: String = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or(fallback)
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(5)
        .collect();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("grain-{tag}-{}-{stamp}.{ext}", std::process::id()))
}

/// `bytes` written to a temporary file named like `name`, run through sips
/// with `args`, and the result read back. Neither file is left behind.
#[cfg(target_os = "macos")]
fn through_sips(bytes: &[u8], name: &str, args: &[&str], out_ext: &str, what: &str) -> Result<Response, String> {
    let input = temp_file("in", name, "img");
    let output = temp_file("out", &format!("x.{out_ext}"), out_ext);
    fs::write(&input, bytes).map_err(|e| e.to_string())?;
    let status = Command::new("/usr/bin/sips").args(args).arg(&input).arg("--out").arg(&output).output();
    let _ = fs::remove_file(&input);
    let result = match status {
        Ok(out) if out.status.success() => fs::read(&output).map(Response::new).map_err(|e| e.to_string()),
        Ok(out) => Err(format!("macOS could not read this {what}: {}", String::from_utf8_lossy(&out.stderr).trim())),
        Err(e) => Err(e.to_string()),
    };
    let _ = fs::remove_file(&output);
    result
}

#[cfg(target_os = "macos")]
const SRGB_PROFILE: &str = "/System/Library/ColorSync/Profiles/sRGB Profile.icc";

/// A camera RAW file (its bytes in the body, its name in x-name for the
/// extension) developed by macOS's own RAW engine through sips, as the
/// camera set it: white balance as shot, Apple's default tone and noise
/// reduction, sRGB. Back as a full-quality JPEG that keeps the RAW's EXIF
/// (orientation, date). The app's Base modules adjust it from there; this is
/// a starting point, not a RAW developer.
#[cfg(target_os = "macos")]
#[tauri::command(async)]
fn develop_raw(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    let name = header(&request, "x-name");
    let name = if name.is_empty() { "photo.raw".to_string() } else { name };
    through_sips(bytes, &name, &["-s", "format", "jpeg", "-s", "formatOptions", "100", "--matchTo", SRGB_PROFILE], "jpg", "RAW file")
}

/// A photo the webview can't decode (its bytes in the body, its name in
/// x-name), converted by macOS's own image engine into a PNG it can: the
/// first page or frame, in sRGB, at full depth; with x-keep-values "1" (grain
/// plates) its values are left as they are, no colour profile applied. The
/// EXIF goes with it, orientation included, which the webview applies.
#[cfg(target_os = "macos")]
#[tauri::command(async)]
fn convert_image(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    let name = header(&request, "x-name");
    let keep = header(&request, "x-keep-values") == "1";
    let args: &[&str] = if keep { &["-s", "format", "png"] } else { &["-s", "format", "png", "--matchTo", SRGB_PROFILE] };
    through_sips(bytes, &name, args, "png", "file")
}

/// The same off the Mac, developed in Rust (portable.rs): white balance as
/// shot, the camera's colour matrix, brightened so the top 1% is white, sRGB
/// tone, turned upright, with the RAW's EXIF.
#[cfg(not(target_os = "macos"))]
#[tauri::command(async)]
fn develop_raw(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    portable::develop_raw(bytes).map(Response::new)
}

/// The same off the Mac, in Rust (portable.rs): TIFF (8 and 16-bit, the
/// first page), WebP, BMP, GIF (the first frame), PNG and JPEG, turned
/// upright, its colour profile kept for the webview to apply. HEIC and AVIF
/// are not read.
#[cfg(not(target_os = "macos"))]
#[tauri::command(async)]
fn convert_image(request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    portable::convert_image(bytes, header(&request, "x-keep-values") == "1").map(Response::new)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoFile {
    name: String,
    path: String,
    size: u64,
    /// Last changed, in milliseconds since 1970.
    modified: u64,
}

/// The photos in a folder (not its subfolders), by name: files whose
/// extension is one of `extensions`, lower case without the dot.
#[tauri::command(async)]
fn photo_files(dir: String, extensions: Vec<String>) -> Result<Vec<PhotoFile>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let ext = Path::new(&name).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !extensions.iter().any(|e| *e == ext) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(PhotoFile { name, path: entry.path().to_string_lossy().into_owned(), size: meta.len(), modified });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Photos by path, as photo_files reads them, for photos kept by path rather
/// than by folder (Recent). Those no longer there are left out.
#[tauri::command(async)]
fn photo_stats(paths: Vec<String>) -> Vec<PhotoFile> {
    paths
        .into_iter()
        .filter_map(|path| {
            let meta = fs::metadata(&path).ok()?;
            if !meta.is_file() {
                return None;
            }
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let name = Path::new(&path).file_name()?.to_string_lossy().into_owned();
            Some(PhotoFile { name, path, size: meta.len(), modified })
        })
        .collect()
}

/// A small JPEG of a photo, `size` pixels on its long side, written to `out`:
/// by macOS's own image engine (sips), which reads RAW files too, in sRGB.
#[cfg(target_os = "macos")]
#[tauri::command(async)]
fn thumbnail(path: String, out: String, size: u32) -> Result<(), String> {
    let out = PathBuf::from(out);
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut tmp = out.clone().into_os_string();
    tmp.push(".part.jpg");
    let tmp = PathBuf::from(tmp);
    let size = size.clamp(32, 1024).to_string();
    let status = Command::new("/usr/bin/sips")
        .args(["-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", &size, "--matchTo", "/System/Library/ColorSync/Profiles/sRGB Profile.icc"])
        .arg(&path)
        .arg("--out")
        .arg(&tmp)
        .output()
        .map_err(|e| e.to_string())?;
    if !status.status.success() || !tmp.exists() {
        let _ = fs::remove_file(&tmp);
        return Err(format!("macOS could not read {path}"));
    }
    fs::rename(&tmp, &out).map_err(|e| e.to_string())
}

/// The same off the Mac, made in Rust (portable.rs): photos read whole, RAW
/// files by the preview the camera put in them. A RAW with none that can be
/// read is an error, and the filmstrip marks it with a "?".
#[cfg(not(target_os = "macos"))]
#[tauri::command(async)]
fn thumbnail(path: String, out: String, size: u32) -> Result<(), String> {
    let out = PathBuf::from(out);
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut tmp = out.clone().into_os_string();
    tmp.push(".part.jpg");
    let tmp = PathBuf::from(tmp);
    let size = size.clamp(32, 1024);
    let source = Path::new(&path);
    let jpeg = if portable::is_plain_image(source) {
        portable::plain_thumbnail(source, size)
    } else {
        portable::raw_thumbnail(source, size)
    }
    .map_err(|e| format!("could not read {path}: {e}"))?;
    if let Err(e) = fs::write(&tmp, jpeg) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    fs::rename(&tmp, &out).map_err(|e| e.to_string())
}

/// A file's SHA-256, as the page's sha256() gives it: what a photo's edit is kept under.
#[tauri::command(async)]
fn file_sha(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// The folder for the app's self-check (src/platform/smoke.ts), when it is
/// launched with GRAIN_EMULATOR_SMOKE set; otherwise none, and it never runs.
#[tauri::command]
fn smoke_dir() -> Option<String> {
    std::env::var("GRAIN_EMULATOR_SMOKE").ok().filter(|d| !d.is_empty())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// When the app last quit properly (ms since 1970), from a note written as it
/// quits. The page compares it with its own last sign of life to tell a quit
/// from a crash (src/platform/watchdog.ts): the window never says it closed.
fn exit_note() -> Option<PathBuf> {
    data_dir().ok().map(|d| PathBuf::from(d).join("last-exit"))
}

#[tauri::command(async)]
fn last_clean_exit() -> Option<u64> {
    fs::read_to_string(exit_note()?).ok()?.trim().parse().ok()
}

fn note_clean_exit() {
    let (Some(path), Ok(now)) = (exit_note(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)) else { return };
    let _ = fs::create_dir_all(path.parent().unwrap_or(&path));
    let _ = fs::write(path, now.as_millis().to_string());
}

/// The menu bar's own items (not the system's: Copy, Hide, Quit...), by id,
/// so the page can grey them out.
struct MenuItems(HashMap<String, MenuItem<Wry>>);

/// The app's menu bar. A click on one of its own items is sent to the page
/// as a `menu` event carrying the item's id (src/platform/menu.ts).
///
/// Keys: WKWebView gives a Cmd-key press to the page first. When the page's
/// shortcut handler takes it (preventDefault), the menu's key equivalent
/// does not fire; only otherwise does the menu get it. The page handles
/// every shortcut listed here itself, so menu actions arrive only from mouse
/// clicks on the menu, and no action runs twice.
///
/// Undo and Redo are the app's own items, not the system's: those go to the
/// text system and would not reach the page's edit history.
///
/// Windows and Linux have no app menu: Settings is at the end of Edit, Exit
/// (Quit on Linux) at the end of File, About in Help, and there is no Window
/// menu. Their Exit and Full Screen are the app's own items (EXIT and
/// FULLSCREEN, handled here, never sent to the page): the system's do
/// nothing there. CmdOrCtrl is Ctrl there.
fn build_menu(app: &AppHandle) -> tauri::Result<(Menu<Wry>, HashMap<String, MenuItem<Wry>>)> {
    let mut items = HashMap::new();
    let mut item = |id: &str, label: &str, key: Option<&str>| -> tauri::Result<MenuItem<Wry>> {
        let it = MenuItem::with_id(app, id, label, true, key)?;
        items.insert(id.to_owned(), it.clone());
        Ok(it)
    };
    let sep = || PredefinedMenuItem::separator(app);

    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "copyshop",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About copyshop"), None)?,
            &sep()?,
            &item("settings", "Settings…", Some("CmdOrCtrl+Comma"))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("open", "Open…", Some("CmdOrCtrl+O"))?,
            &item("open-folder", "Add Folder to Library…", Some("Shift+CmdOrCtrl+O"))?,
            &sep()?,
            &item("export", "Export", Some("CmdOrCtrl+E"))?,
            &item("export-as", "Export As…", Some("Alt+CmdOrCtrl+E"))?,
            &item("export-timelapse", "Export Timelapse Video…", Some("Shift+CmdOrCtrl+E"))?,
            &sep()?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(target_os = "windows")]
            &MenuItem::with_id(app, EXIT, "Exit", true, None::<&str>)?,
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            &MenuItem::with_id(app, EXIT, "Quit", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &item("undo", "Undo", Some("CmdOrCtrl+Z"))?,
            &item("redo", "Redo", Some("Shift+CmdOrCtrl+Z"))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &sep()?,
            &item("snapshot", "Take Snapshot", Some("Shift+CmdOrCtrl+N"))?,
            &item("reset-all", "Start Over", Some("Shift+CmdOrCtrl+R"))?,
            &sep()?,
            &item("command-palette", "Find a Setting…", Some("CmdOrCtrl+K"))?,
            #[cfg(not(target_os = "macos"))]
            &sep()?,
            #[cfg(not(target_os = "macos"))]
            &item("settings", "Settings…", Some("CmdOrCtrl+Comma"))?,
        ],
    )?;
    // Show Original is held down (\) and Library is G: plain keys the page
    // handles, so they carry no key equivalent here.
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("zoom-fit", "Fit", Some("CmdOrCtrl+0"))?,
            &item("zoom-100", "100%", Some("CmdOrCtrl+1"))?,
            &item("zoom-200", "200%", Some("CmdOrCtrl+2"))?,
            &item("zoom-in", "Zoom In", Some("CmdOrCtrl+Equal"))?,
            &item("zoom-out", "Zoom Out", Some("CmdOrCtrl+Minus"))?,
            &sep()?,
            &item("show-original", "Show Original", None)?,
            &item("phone-preview", "Phone Preview", None)?,
            &sep()?,
            &item("toggle-left", "Left Panel", Some(PANEL_KEYS[0]))?,
            &item("toggle-right", "Right Panel", Some(PANEL_KEYS[1]))?,
            &item("toggle-filmstrip", "Filmstrip", Some(PANEL_KEYS[2]))?,
            &item("library", "Library", None)?,
            &sep()?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::fullscreen(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &MenuItem::with_id(app, FULLSCREEN, "Full Screen", true, Some("F11"))?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?],
    )?;
    #[cfg(target_os = "macos")]
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &item("intro", "How copyshop Works", None)?,
            &item("shortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+Slash"))?,
            &sep()?,
            &item("feedback", "Send Feedback or Report a Problem…", None)?,
        ],
    )?;
    #[cfg(not(target_os = "macos"))]
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &item("intro", "How copyshop Works", None)?,
            &item("shortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+Slash"))?,
            &sep()?,
            &item("feedback", "Send Feedback or Report a Problem…", None)?,
            &sep()?,
            &PredefinedMenuItem::about(
                app,
                Some("About copyshop"),
                Some(tauri::menu::AboutMetadata {
                    name: Some("copyshop".into()),
                    version: Some(app.package_info().version.to_string()),
                    copyright: app.config().bundle.copyright.clone(),
                    ..Default::default()
                }),
            )?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    {
        window.set_as_windows_menu_for_nsapp()?;
        help.set_as_help_menu_for_nsapp()?;
    }

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])?;
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&file, &edit, &view, &help])?;
    Ok((menu, items))
}

/// Off the Mac: the menu's own Exit, and Full Screen.
#[cfg(not(target_os = "macos"))]
const EXIT: &str = "app-exit";
#[cfg(not(target_os = "macos"))]
const FULLSCREEN: &str = "app-fullscreen";

/// A menu bar item greyed out, or back: Export with no photo open, say.
#[tauri::command(async)]
fn set_menu_enabled(items: tauri::State<'_, MenuItems>, id: String, enabled: bool) -> Result<(), String> {
    let item = items.0.get(&id).ok_or_else(|| format!("no menu item {id}"))?;
    item.set_enabled(enabled).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Updates: getcopyshop.com/downloads/latest.json, signed with the key in tauri.conf.json.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let (menu, items) = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.manage(MenuItems(items));
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            #[cfg(not(target_os = "macos"))]
            match id {
                EXIT => return app.exit(0),
                FULLSCREEN => {
                    if let Some(window) = app.get_webview_window("main") {
                        let full = window.is_fullscreen().unwrap_or(false);
                        let _ = window.set_fullscreen(!full);
                    }
                    return;
                }
                _ => {}
            }
            // The system's items (Copy, Hide...) do their own work.
            if app.state::<MenuItems>().0.contains_key(id) {
                let _ = app.emit("menu", id);
            }
        })
        .invoke_handler(tauri::generate_handler![
            data_dir,
            read_file,
            read_head,
            move_file,
            trash_file,
            photo_files,
            photo_stats,
            thumbnail,
            file_sha,
            write_file,
            list_dir,
            remove_file,
            make_dir,
            reveal,
            open_url,
            find_original,
            find_by_hash,
            develop_raw,
            convert_image,
            smoke_dir,
            quit_app,
            last_clean_exit,
            set_menu_enabled
        ])
        .build(tauri::generate_context!())
        .expect("error while running copyshop")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                note_clean_exit();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn finds_images_by_hash_prefix_in_nested_folders() {
        let root = std::env::temp_dir().join(format!("grain-find-{}", std::process::id()));
        let deep = root.join("a/b");
        let hidden = root.join(".hidden");
        fs::create_dir_all(&deep).unwrap();
        fs::create_dir_all(&hidden).unwrap();
        fs::write(deep.join("sky.JPG"), b"sky bytes").unwrap();
        fs::write(root.join("note.txt"), b"other bytes").unwrap();
        fs::write(hidden.join("secret.png"), b"hidden bytes").unwrap();
        let sky = hex(b"sky bytes")[..24].to_string();
        let note = hex(b"other bytes")[..24].to_string();
        let secret = hex(b"hidden bytes")[..24].to_string();
        let found = find_by_hash(vec![root.to_string_lossy().into_owned()], vec![sky.clone(), note, secret]);
        fs::remove_dir_all(&root).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].prefix, sky);
        assert!(found[0].path.ends_with("a/b/sky.JPG"));
    }

    /// One-off: GRAIN_FIND_ROOT and GRAIN_FIND_PREFIXES (comma-separated).
    #[test]
    #[ignore]
    fn timing_on_real_folder() {
        let root = std::env::var("GRAIN_FIND_ROOT").unwrap();
        let prefixes: Vec<String> = std::env::var("GRAIN_FIND_PREFIXES").unwrap().split(',').map(str::to_owned).collect();
        let t = std::time::Instant::now();
        let found = find_by_hash(vec![root], prefixes);
        println!("found {} in {:?}", found.len(), t.elapsed());
    }
}
