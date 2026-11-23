fn main() {
    // ONNX Runtime's prebuilt library for Apple silicon (precise selection, src/ml.rs) has Core ML in it, which
    // asks which macOS it is on through clang's runtime (__isPlatformVersionAtLeast). Rust links without clang's
    // default libraries, so it is linked here, from the toolchain that builds the app.
    let target = std::env::var("TARGET").unwrap_or_default();
    if target == "aarch64-apple-darwin" {
        if let Ok(out) = std::process::Command::new("xcrun").args(["clang", "--print-resource-dir"]).output() {
            let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !dir.is_empty() {
                println!("cargo:rustc-link-search=native={dir}/lib/darwin");
                println!("cargo:rustc-link-lib=static=clang_rt.osx");
            }
        }
    }
    tauri_build::build()
}
