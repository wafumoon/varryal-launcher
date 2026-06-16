//! Launch the signed Java launcher jar as a background process.
//!
//! F2: `resolve_jar` now downloads Varryal.jar from the official URL when it
//!     is not already present (or when it is stale — older than JAR_MAX_AGE_DAYS).
//!     The URL is the constant `VARRYAL_JAR_URL`.  A simple age-based freshness
//!     check (mtime vs. JAR_MAX_AGE_DAYS) keeps the jar up-to-date without a
//!     full HEAD/ETag round-trip.
//! F4: Uses `paths::varryal_data_dir()` so the jar lives under
//!     %APPDATA%\Varryal\Varryal.jar alongside the config and JRE cache.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use anyhow::{Context, Result};
use tracing::{debug, info, warn};

use crate::config::ShellConfig;
use crate::jre::download_file_with_sha1;
use crate::paths::varryal_data_dir;

// ── Constants ─────────────────────────────────────────────────────────────────

/// Canonical download URL for the signed Varryal launcher jar.
/// This is the URL published on the official launcher distribution page.
pub const VARRYAL_JAR_URL: &str = "https://launcher.varryal.ru/Varryal.jar";

/// Re-download the jar if it is older than this many days.
/// Set to 0 to always re-download, or a large number to effectively never.
const JAR_MAX_AGE_DAYS: u64 = 7;

// ── Jar resolution + download (F2) ───────────────────────────────────────────

/// Return the path to `Varryal.jar`, downloading it if needed.
///
/// Resolution order:
/// 1. Bundled resource (if shipped inside the Tauri bundle) — never stale.
/// 2. Canonical data-dir location (`%APPDATA%\Varryal\Varryal.jar` on Windows).
///    - If present and fresh (mtime < JAR_MAX_AGE_DAYS), use as-is.
///    - If present but stale, re-download in-place.
///    - If absent, download from `VARRYAL_JAR_URL`.
///
/// `cfg` is updated with the new `jar_downloaded_at` timestamp; the caller must
/// call `cfg.save()` afterwards.
pub async fn resolve_jar(
    app: &tauri::AppHandle,
    cfg: &mut ShellConfig,
) -> Result<PathBuf> {
    use tauri::Manager;

    // 1. Bundled resource takes priority (not stale by definition — part of the binary)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("Varryal.jar");
        if bundled.exists() {
            info!("Using bundled Varryal.jar from {}", bundled.display());
            return Ok(bundled);
        }
    }

    // 2. Canonical data-dir location
    let data_dir = varryal_data_dir()?;
    let jar_path = data_dir.join("Varryal.jar");

    let needs_download = if jar_path.exists() {
        if is_stale(&jar_path) {
            warn!(
                "Varryal.jar is older than {JAR_MAX_AGE_DAYS} days — re-downloading from {VARRYAL_JAR_URL}"
            );
            true
        } else {
            info!("Varryal.jar found at {} (fresh)", jar_path.display());
            false
        }
    } else {
        info!("Varryal.jar not found — downloading from {VARRYAL_JAR_URL}");
        true
    };

    if needs_download {
        download_jar(&jar_path, cfg).await?;
    }

    Ok(jar_path)
}

/// Download `Varryal.jar` from `VARRYAL_JAR_URL` into `dest`.
/// Updates `cfg.jar_downloaded_at` on success.
async fn download_jar(dest: &Path, cfg: &mut ShellConfig) -> Result<()> {
    info!("Downloading Varryal.jar from {VARRYAL_JAR_URL} → {}", dest.display());
    let client = reqwest::Client::new();
    // We use the SHA-1-computing download helper so we get the digest for free.
    // The jar is signed by the LaunchServer (PKCS12/ECDSA) so we trust the
    // server's signature; the SHA-1 here is a transport-integrity check only.
    let sha1 = download_file_with_sha1(&client, VARRYAL_JAR_URL, dest)
        .await
        .with_context(|| format!("Failed to download Varryal.jar from {VARRYAL_JAR_URL}"))?;
    info!("Varryal.jar downloaded, SHA-1 = {sha1}");
    cfg.jar_downloaded_at = Some(unix_timestamp_now());
    Ok(())
}

/// Return true if `path`'s modification time is older than `JAR_MAX_AGE_DAYS` days.
fn is_stale(path: &Path) -> bool {
    match path.metadata().and_then(|m| m.modified()) {
        Ok(mtime) => {
            let age = std::time::SystemTime::now()
                .duration_since(mtime)
                .unwrap_or_default();
            age.as_secs() > JAR_MAX_AGE_DAYS * 86_400
        }
        Err(_) => true, // If we can't read mtime, treat as stale
    }
}

fn unix_timestamp_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

// ── Process launch ────────────────────────────────────────────────────────────

/// Spawn the Java process and return the child handle (not waited on — long-running).
///
/// Stdout is piped so the caller can drain it; stderr is inherited so errors
/// appear in the Tauri process log. If stdout is not drained the OS pipe buffer
/// (~64 KiB on Windows) fills and the Java process blocks — always call
/// `drain_stdout` after this function.
pub fn launch_jar(java_exe: &Path, jar: &Path) -> Result<Child> {
    info!("Launching {} -jar {}", java_exe.display(), jar.display());

    let mut cmd = Command::new(java_exe);

    // Tell the core not to search for a system Java (we provide ours)
    cmd.arg("-Dlauncher.noJavaCheck=true");
    // Signal the bridge that IPC mode is active
    cmd.arg("-Dvarryal.ipc=1");
    // Jar to launch
    cmd.arg("-jar").arg(jar);

    // On Windows: suppress the extra console window
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.stdin(Stdio::null());
    // Pipe stdout so we can drain it (prevents pipe-buffer deadlock).
    cmd.stdout(Stdio::piped());
    // Inherit stderr — Java stack traces go to the Tauri process stderr.
    cmd.stderr(Stdio::inherit());

    let child = cmd.spawn().context("Failed to spawn Java process")?;
    info!("Java process spawned, pid={}", child.id());
    Ok(child)
}

/// Drain stdout of the Java child in a background thread.
/// Each line is logged at DEBUG level.  Returns immediately.
pub fn drain_stdout(child: &mut Child) {
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            warn!("drain_stdout: child has no piped stdout");
            return;
        }
    };
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => debug!("[java] {l}"),
                Err(_) => break,
            }
        }
    });
}
