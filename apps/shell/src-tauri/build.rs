fn main() {
    // On the MSVC toolchain (CI / official build machines) run the full
    // tauri_build pipeline: icon embedding, Windows manifest, permission-file
    // generation, etc.
    //
    // On the GNU toolchain (local cargo check — BLOCKER-5) `tauri_build::build()`
    // tries to run `windres.exe` to compile the .rc resource file; windres
    // preprocessing fails because the GNU toolchain lacks the MSVC SDK headers.
    // We skip the resource step and emit only the cfg/env directives that the
    // Rust source code actually needs to compile, so `cargo check` stays green.
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if target_env == "msvc" {
        // Full pipeline — CI / tauri build / production machines.
        tauri_build::build()
    } else {
        // GNU toolchain — local cargo check only.
        // Emit the minimum set of directives tauri_build would produce so that
        // the Tauri proc-macros and cfg guards in the source tree compile:
        println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
        println!("cargo:rerun-if-changed=tauri.conf.json");
        println!("cargo:rerun-if-changed=capabilities");
        println!("cargo:rustc-check-cfg=cfg(desktop)");
        println!("cargo:rustc-cfg=desktop");
        println!("cargo:rustc-check-cfg=cfg(mobile)");
        println!("cargo:rustc-check-cfg=cfg(dev)");
        println!("cargo:rustc-env=TAURI_ENV_TARGET_TRIPLE=x86_64-pc-windows-gnu");
        println!("cargo:rustc-env=TAURI_ANDROID_PACKAGE_NAME_PREFIX=ru_varryal");
        println!("cargo:rustc-env=TAURI_ANDROID_PACKAGE_NAME_APP_NAME=launcher");
    }
}
