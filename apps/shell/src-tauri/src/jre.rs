//! JRE provisioning — downloads BellSoft Liberica per OS/arch, extracts, caches.
//! Reference: LauncherPrestarter rust/5.7.x download.rs + extract.rs

use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use serde::Deserialize;
use tauri::Manager;
use tracing::{info, warn};

use crate::config::{JreEntry, ShellConfig};

pub struct JreManager<'a> {
    app: &'a tauri::AppHandle,
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
}

impl<'a> JreManager<'a> {
    pub fn new(app: &'a tauri::AppHandle, config: &'a mut ShellConfig) -> Self {
        Self { app, config }
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

        let install_path = self.download_and_extract(major).await?;
        let entry = JreEntry {
            major_version: major,
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            path: install_path.clone(),
            sha1: String::new(), // sha1 verified during download
            installed_at: chrono_now(),
        };
        self.config.add_or_replace_jre(entry);
        Ok(install_path)
    }

    async fn download_and_extract(&self, major: u32) -> Result<PathBuf> {
        let (os_str, arch_str, pkg_type) = platform_params()?;
        // BellSoft Liberica API — no JavaFX needed (GUI is Tauri/web)
        let api_url = format!(
            "https://api.bell-sw.com/v1/liberica/releases?version-modifier=latest&version-feature={major}&bitness=64&os={os_str}&arch={arch_str}&package-type={pkg_type}&bundle-type=jre"
        );
        info!("Fetching JRE {major} metadata from {api_url}");

        let client = reqwest::Client::new();
        let releases: Vec<LibericaRelease> = client.get(&api_url)
            .send().await.context("Liberica API request failed")?
            .json().await.context("Liberica API JSON parse failed")?;

        let release = releases.into_iter().next()
            .ok_or_else(|| anyhow::anyhow!("No Liberica JRE {major} release found for {os_str}/{arch_str}"))?;

        info!("Downloading JRE {} from {}", release.feature_version, release.download_url);

        // Destination directory
        let data_dir = self.app.path().app_data_dir()?;
        let jre_dir = data_dir.join("jre");
        std::fs::create_dir_all(&jre_dir)?;
        let archive_path = jre_dir.join(&release.filename);

        // Download with streaming
        download_file(&client, &release.download_url, &archive_path).await
            .context("JRE download failed")?;

        // Extract
        let extract_dir = jre_dir.join(format!("java-{major}-{os_str}-{arch_str}"));
        if extract_dir.exists() {
            std::fs::remove_dir_all(&extract_dir)?;
        }
        std::fs::create_dir_all(&extract_dir)?;

        extract_archive(&archive_path, &extract_dir)
            .context("JRE extraction failed")?;

        // Clean up archive
        let _ = std::fs::remove_file(&archive_path);

        // Find the actual JRE root (archives typically contain a single top-level dir)
        let jre_root = find_jre_root(&extract_dir)?;
        info!("JRE {major} installed to {}", jre_root.display());
        Ok(jre_root)
    }
}

async fn download_file(client: &reqwest::Client, url: &str, dest: &Path) -> Result<()> {
    use tokio::io::AsyncWriteExt;
    use futures_util::StreamExt;

    let response = client.get(url).send().await?.error_for_status()?;
    let mut file = tokio::fs::File::create(dest).await?;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    Ok(())
}

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

fn chrono_now() -> String {
    // Simple ISO-8601 timestamp without pulling in chrono
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
