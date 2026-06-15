//! Launch the signed Java launcher jar as a background process.
//! Reference: LauncherPrestarter rust/5.7.x runner.rs

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use anyhow::{Context, Result};
use tauri::Manager;
use tracing::info;

/// Find the launcher jar: first check resource directory, then data dir.
pub fn resolve_jar(app: &tauri::AppHandle) -> Result<PathBuf> {
    // 1. Bundled resource (if shipped inside the Tauri bundle)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("Varryal.jar");
        if bundled.exists() {
            return Ok(bundled);
        }
    }
    // 2. App data dir (downloaded/self-updated)
    if let Ok(data_dir) = app.path().app_data_dir() {
        let downloaded = data_dir.join("Varryal.jar");
        if downloaded.exists() {
            return Ok(downloaded);
        }
    }
    anyhow::bail!("Varryal.jar not found — please reinstall the launcher")
}

/// Spawn the Java process and return the child handle (not waited on — long-running).
pub fn launch_jar(java_exe: &Path, jar: &Path) -> Result<Child> {
    info!("Launching {} -jar {}", java_exe.display(), jar.display());

    let mut cmd = Command::new(java_exe);

    // Tell the core not to search for a system Java (we provide ours)
    cmd.arg("-Dlauncher.noJavaCheck=true");
    // Signal the bridge to start the WS server (even if wrappedLaunch isn't set)
    cmd.arg("-Dvarryal.ipc=1");
    // Jar to launch
    cmd.arg("-jar").arg(jar);

    // On Windows: suppress console window for javaw.exe
    // (javaw.exe already has no console; if java.exe is used, hide it)
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // Don't inherit stdin so the Java process doesn't block on empty stdin
    cmd.stdin(std::process::Stdio::null());
    // Capture stdout so we can read the VARRYAL_IPC handshake line
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = cmd.spawn().context("Failed to spawn Java process")?;
    info!("Java process spawned, pid={}", child.id());
    Ok(child)
}
