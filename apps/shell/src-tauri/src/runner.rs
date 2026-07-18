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

    // Always fetch the current jar. It MUST be byte-identical to the LaunchServer's
    // signed `updates/Varryal.jar`: Gravit's `checkUpdates` compares the running
    // jar's digest against the server build and, on mismatch, runs its self-update
    // path — which tears down the backend executor and breaks profile downloads.
    // An age-based cache can serve a stale jar after the server rebuilds, so we
    // refresh it every launch. The JRE stays cached; only this ~10 MB jar is fetched.
    info!("Fetching current Varryal.jar from {VARRYAL_JAR_URL}");
    download_jar(&jar_path, cfg).await?;

    Ok(jar_path)
}

/// Download `Varryal.jar` from `VARRYAL_JAR_URL` into `dest`.
/// The replacement is validated and atomically promoted. If any refresh stage
/// fails, only a cache matching the SHA-256 of a prior successful HTTPS download
/// may be used.
async fn download_jar(dest: &Path, cfg: &mut ShellConfig) -> Result<()> {
    info!("Downloading Varryal.jar from {VARRYAL_JAR_URL} → {}", dest.display());
    let client = reqwest::Client::new();
    let temp = dest.with_extension("jar.download");
    let _ = tokio::fs::remove_file(&temp).await;
    let trusted_digest = cfg.launcher_jar_sha256.clone();

    let refresh: Result<(String, String)> = async {
        let sha1 = download_file_with_sha1(&client, VARRYAL_JAR_URL, &temp).await?;
        let sha256 = validate_and_promote(&temp, dest)?;
        Ok((sha1, sha256))
    }.await;

    let _ = tokio::fs::remove_file(&temp).await;
    match refresh {
        Ok((sha1, sha256)) => {
            info!("Varryal.jar downloaded, SHA-1 = {sha1}, SHA-256 = {sha256}");
            cfg.jar_downloaded_at = Some(unix_timestamp_now());
            cfg.launcher_jar_sha256 = Some(sha256);
            Ok(())
        }
        Err(error) if trusted_cached_jar(dest, trusted_digest.as_deref()) => {
            warn!(
                "Failed to refresh Varryal.jar ({error:#}); using digest-verified cached copy at {}",
                dest.display()
            );
            Ok(())
        }
        Err(error) => Err(error)
            .with_context(|| format!("Failed to download a valid Varryal.jar from {VARRYAL_JAR_URL}")),
    }
}

fn validate_jar(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let file = std::fs::File::open(path)
        .with_context(|| format!("Unable to open JAR {}", path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .with_context(|| format!("Invalid ZIP/JAR central directory in {}", path.display()))?;
    if archive.is_empty() {
        anyhow::bail!("JAR archive is empty");
    }
    if archive.by_name("META-INF/MANIFEST.MF").is_err() {
        anyhow::bail!("JAR archive has no META-INF/MANIFEST.MF");
    }
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)
            .with_context(|| format!("Invalid JAR entry at index {index}"))?;
        std::io::copy(&mut entry, &mut std::io::sink())
            .with_context(|| format!("Corrupt JAR entry {}", entry.name()))?;
    }
    drop(archive);

    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn trusted_cached_jar(path: &Path, expected_sha256: Option<&str>) -> bool {
    let Some(expected) = expected_sha256 else { return false; };
    validate_jar(path).is_ok_and(|actual| actual.eq_ignore_ascii_case(expected))
}

fn validate_and_promote(source: &Path, destination: &Path) -> Result<String> {
    let digest = validate_jar(source)
        .context("Downloaded Varryal.jar failed structural validation")?;
    atomic_replace_file(source, destination)
        .context("Failed to atomically promote downloaded Varryal.jar")?;
    Ok(digest)
}

#[cfg(windows)]
fn atomic_replace_file(source: &Path, destination: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH, REPLACEFILE_WRITE_THROUGH,
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    }

    let source_wide = wide(source);
    let destination_wide = wide(destination);
    let success = unsafe {
        if destination.exists() {
            ReplaceFileW(
                destination_wide.as_ptr(),
                source_wide.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_WRITE_THROUGH,
                std::ptr::null(),
                std::ptr::null(),
            )
        } else {
            MoveFileExW(source_wide.as_ptr(), destination_wide.as_ptr(), MOVEFILE_WRITE_THROUGH)
        }
    };
    if success == 0 {
        Err(std::io::Error::last_os_error()).with_context(|| {
            format!("Unable to replace {} with {}", destination.display(), source.display())
        })
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace_file(source: &Path, destination: &Path) -> Result<()> {
    std::fs::rename(source, destination).with_context(|| {
        format!("Unable to replace {} with {}", destination.display(), source.display())
    })
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

#[cfg(test)]
mod tests {
    use super::{
        atomic_replace_file, trusted_cached_jar, validate_and_promote, validate_jar,
    };
    use std::fs;
    use std::io::Write;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::write::SimpleFileOptions;

    fn test_dir() -> std::path::PathBuf {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("varryal-jar-test-{suffix}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_valid_jar(path: &Path, payload: &[u8]) {
        let file = fs::File::create(path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive.start_file("META-INF/MANIFEST.MF", SimpleFileOptions::default()).unwrap();
        archive.write_all(b"Manifest-Version: 1.0
\n
\n").unwrap();
        archive.start_file("payload.bin", SimpleFileOptions::default()).unwrap();
        archive.write_all(payload).unwrap();
        archive.finish().unwrap();
    }

    #[test]
    fn validates_complete_jar_and_rejects_oversized_fake_zip() {
        let dir = test_dir();
        let valid = dir.join("valid.jar");
        let fake = dir.join("fake.jar");
        write_valid_jar(&valid, b"signed launcher payload");

        let mut bytes = vec![0_u8; 2 * 1024 * 1024];
        bytes[..4].copy_from_slice(b"PK\x03\x04");
        fs::write(&fake, bytes).unwrap();

        let digest = validate_jar(&valid).unwrap();
        assert_eq!(digest.len(), 64);
        assert!(validate_jar(&fake).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cached_jar_requires_the_trusted_digest() {
        let dir = test_dir();
        let jar = dir.join("cached.jar");
        write_valid_jar(&jar, b"trusted cache");
        let digest = validate_jar(&jar).unwrap();

        assert!(trusted_cached_jar(&jar, Some(&digest)));
        assert!(!trusted_cached_jar(&jar, Some(&"0".repeat(64))));
        assert!(!trusted_cached_jar(&jar, None));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_download_is_never_promoted_over_trusted_destination() {
        let dir = test_dir();
        let destination = dir.join("Varryal.jar");
        let download = dir.join("Varryal.jar.download");
        fs::write(&destination, b"trusted-old").unwrap();
        let mut fake = vec![0_u8; 2 * 1024 * 1024];
        fake[..4].copy_from_slice(b"PK\x03\x04");
        fs::write(&download, fake).unwrap();

        assert!(validate_and_promote(&download, &destination).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"trusted-old");
        assert!(download.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn atomic_replacement_preserves_destination_on_failure() {
        let dir = test_dir();
        let destination = dir.join("Varryal.jar");
        fs::write(&destination, b"trusted-old").unwrap();

        assert!(atomic_replace_file(&dir.join("missing.download"), &destination).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"trusted-old");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn atomic_replacement_promotes_complete_download() {
        let dir = test_dir();
        let destination = dir.join("Varryal.jar");
        let download = dir.join("Varryal.jar.download");
        fs::write(&destination, b"old").unwrap();
        fs::write(&download, b"new-complete").unwrap();

        atomic_replace_file(&download, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"new-complete");
        assert!(!download.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
