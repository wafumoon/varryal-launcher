//! Shell configuration — persisted to ${varryal_data_dir}/shell-config.json
//!
//! Uses `paths::varryal_data_dir()` so the config sits alongside the JRE
//! cache, the downloaded jar, and the IPC handshake — all in the same tree.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::paths::varryal_data_dir;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JreEntry {
    pub major_version: u32,
    pub os: String,
    pub arch: String,
    pub path: PathBuf,
    /// SHA-1 hex digest of the downloaded archive, as returned by the
    /// BellSoft Liberica API.  Empty string = pre-F3 legacy entry.
    pub sha1: String,
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ShellConfig {
    pub jre_entries: Vec<JreEntry>,
    pub locale: Option<String>,
    pub launcher_jar: Option<PathBuf>,
    pub last_update_check: Option<String>,
    /// Timestamp of the last successful Varryal.jar download (Unix seconds as string).
    pub jar_downloaded_at: Option<String>,
}

impl ShellConfig {
    fn config_path() -> anyhow::Result<PathBuf> {
        Ok(varryal_data_dir()?.join("shell-config.json"))
    }

    pub fn load() -> anyhow::Result<Self> {
        let path = Self::config_path()?;
        if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&raw).unwrap_or_default())
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = Self::config_path()?;
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    pub fn find_jre(&self, major: u32) -> Option<&JreEntry> {
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;
        self.jre_entries.iter().find(|e| {
            e.major_version == major && e.os == os && e.arch == arch
        })
    }

    pub fn add_or_replace_jre(&mut self, entry: JreEntry) {
        self.jre_entries.retain(|e| {
            !(e.major_version == entry.major_version
                && e.os == entry.os
                && e.arch == entry.arch)
        });
        self.jre_entries.push(entry);
    }
}
