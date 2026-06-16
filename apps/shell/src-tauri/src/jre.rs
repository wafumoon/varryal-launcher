//! JRE provisioning — downloads BellSoft Liberica per OS/arch, verifies SHA-1,
//! extracts and caches.
//!
//! Reference: LauncherPrestarter rust/5.7.x download.rs + extract.rs
//!
//! F3: SHA-1 is now parsed from the Liberica API response and verified after
//!     download.  Mismatch → hard error (download is deleted and the error
//!     propagates to bootstrap).
//! F4: Uses `paths::varryal_data_dir()` so the JRE cache lives next to the
//!     config and the IPC handshake, all under %APPDATA%\Varryal (Windows)
//!     or ~/Varryal (Unix).

use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use serde::Deserialize;
use tracing::{info, warn};

use crate::config::{JreEntry, ShellConfig};
use crate::paths::varryal_data_dir;

pub struct JreManager<'a> {
    config: &'a mut ShellConfig,
}

#[derive(Debug, Deserialize)]
struct LibericaRelease {
    #[serde(rename = "downloadUrl")]
    download_url: String,
    filename: String,
    #[serde(rename = "featureVersion")]
    feature_version: u32,
    size: u64,
    /// SHA-1 hex digest of the archive, as provided by the Liberica API.
    /// Field name in JSON is "sha1".
    sha1: Option<String>,
}

impl<'a> JreManager<'a> {
    pub fn new(config: &'a mut ShellConfig) -> Self {
        Self { config }
    }

    /// Ensure the given Java major version is installed. Returns the JRE root path.
    pub async fn ensure_version(&mut self, major: u32) -> Result<PathBuf> {
        if let Some(entry) = self.config.find_jre(major) {
            if entry.path.exists() {
                info!("JRE {major} already installed at {}", entry.path.display());
                return Ok(entry.path.clone());
            }
            warn!("JRE {major} entry found but path missing — re-downloading");
        }

        let (install_path, sha1) = self.download_and_extract(major).await?;
        let entry = JreEntry {
            major_version: major,
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            path: install_path.clone(),
            sha1,
            installed_at: unix_timestamp_now(),
        };
        self.config.add_or_replace_jre(entry);
        Ok(install_path)
    }

    async fn download_and_extract(&self, major: u32) -> Result<(PathBuf, String)> {
        let (os_str, arch_str, pkg_type) = platform_params()?;
        // BellSoft Liberica API — no JavaFX needed (GUI is Tauri/web)
        let api_url = format!(
            "https://api.bell-sw.com/v1/liberica/releases\
             ?version-modifier=latest\
             &version-feature={major}\
             &bitness=64\
             &os={os_str}\
             &arch={arch_str}\
             &package-type={pkg_type}\
             &bundle-type=jre"
        );
        info!("Fetching JRE {major} metadata from {api_url}");

        let client = reqwest::Client::new();
        let releases: Vec<LibericaRelease> = client
            .get(&api_url)
            .send()
            .await
            .context("Liberica API request failed")?
            .json()
            .await
            .context("Liberica API JSON parse failed")?;

        let release = releases
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!(
                "No Liberica JRE {major} release found for {os_str}/{arch_str}"
            ))?;

        info!(
            "Downloading JRE {} from {} ({} bytes)",
            release.feature_version, release.download_url, release.size
        );

        // Destination directory — F4: use canonical varryal_data_dir
        let data_dir = varryal_data_dir()?;
        let jre_dir = data_dir.join("jre");
        std::fs::create_dir_all(&jre_dir)?;
        let archive_path = jre_dir.join(&release.filename);

        // Download with streaming, collect SHA-1 digest simultaneously (F3)
        let computed_sha1 = download_file_with_sha1(&client, &release.download_url, &archive_path)
            .await
            .context("JRE download failed")?;

        // Verify SHA-1 (F3)
        if let Some(expected) = &release.sha1 {
            if !expected.is_empty() {
                let expected_lower = expected.to_lowercase();
                let computed_lower = computed_sha1.to_lowercase();
                if expected_lower != computed_lower {
                    // Remove the bad download before bailing
                    let _ = std::fs::remove_file(&archive_path);
                    anyhow::bail!(
                        "JRE {major} archive SHA-1 mismatch: \
                         expected {expected_lower}, got {computed_lower}. \
                         Download may be corrupt or tampered."
                    );
                }
                info!("JRE {major} SHA-1 verified: {computed_lower}");
            } else {
                warn!("JRE {major}: API returned empty sha1 — skipping integrity check");
            }
        } else {
            warn!("JRE {major}: Liberica API did not return sha1 — skipping integrity check");
        }

        // Extract
        let extract_dir = jre_dir.join(format!("java-{major}-{os_str}-{arch_str}"));
        if extract_dir.exists() {
            std::fs::remove_dir_all(&extract_dir)?;
        }
        std::fs::create_dir_all(&extract_dir)?;

        extract_archive(&archive_path, &extract_dir).context("JRE extraction failed")?;

        // Clean up archive
        let _ = std::fs::remove_file(&archive_path);

        // Find the actual JRE root (archives typically contain a single top-level dir)
        let jre_root = find_jre_root(&extract_dir)?;
        info!("JRE {major} installed to {}", jre_root.display());
        Ok((jre_root, computed_sha1))
    }
}

// ── Download helper (also used by runner.rs for Varryal.jar) ─────────────────

/// Download `url` to `dest`, streaming the bytes.  Returns the hex-encoded
/// SHA-1 digest of the downloaded content so callers can verify integrity.
pub async fn download_file_with_sha1(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
) -> Result<String> {
    use tokio::io::AsyncWriteExt;
    use futures_util::StreamExt;
    use sha1::{Sha1, Digest};

    let response = client.get(url).send().await?.error_for_status()?;
    let mut file = tokio::fs::File::create(dest).await?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha1::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
    }
    file.flush().await?;

    let digest = hasher.finalize();
    Ok(hex::encode(digest))
}

// ── Archive extraction ────────────────────────────────────────────────────────

fn extract_archive(archive: &Path, dest: &Path) -> Result<()> {
    let ext = archive.to_str().unwrap_or("");
    if ext.ends_with(".zip") {
        // Windows zip
        let file = std::fs::File::open(archive)?;
        let mut zip = zip::ZipArchive::new(file)?;
        zip.extract(dest)?;
    } else if ext.ends_with(".tar.gz") || ext.ends_with(".tgz") {
        // Unix tar.gz
        let file = std::fs::File::open(archive)?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut tar = tar::Archive::new(gz);
        tar.unpack(dest)?;
    } else {
        anyhow::bail!("Unknown archive format: {ext}");
    }
    Ok(())
}

fn find_jre_root(dir: &Path) -> Result<PathBuf> {
    // After extraction there is usually one top-level dir; find it
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            return Ok(entry.path());
        }
    }
    // Fallback: the dir itself may already be the JRE root
    Ok(dir.to_path_buf())
}

// ── Platform helpers ──────────────────────────────────────────────────────────

fn platform_params() -> Result<(&'static str, &'static str, &'static str)> {
    let os = match std::env::consts::OS {
        "windows" => "windows",
        "linux" => "linux",
        "macos" => "macos",
        other => anyhow::bail!("Unsupported OS: {other}"),
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86",
        "aarch64" => "aarch64",
        other => anyhow::bail!("Unsupported arch: {other}"),
    };
    let pkg = if os == "windows" { "zip" } else { "tar.gz" };
    Ok((os, arch, pkg))
}

fn unix_timestamp_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
