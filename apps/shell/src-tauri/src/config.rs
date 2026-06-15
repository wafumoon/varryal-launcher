//! Shell configuration — persisted to ${data_dir}/Varryal/shell-config.json

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JreEntry {
    pub major_version: u32,
    pub os: String,
    pub arch: String,
    pub path: PathBuf,
    pub sha1: String,
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ShellConfig {
    pub jre_entries: Vec<JreEntry>,
    pub locale: Option<String>,
    pub launcher_jar: Option<PathBuf>,
    pub last_update_check: Option<String>,
}

impl ShellConfig {
    pub fn config_path(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
        let data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;
        Ok(data_dir.join("shell-config.json"))
    }

    pub fn load(app: &tauri::AppHandle) -> anyhow::Result<Self> {
        let path = Self::config_path(app)?;
        if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&raw).unwrap_or_default())
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self, app: &tauri::AppHandle) -> anyhow::Result<()> {
        let path = Self::config_path(app)?;
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    pub fn find_jre(&self, major: u32) -> Option<&JreEntry> {
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;
        self.jre_entries.iter().find(|e| e.major_version == major && e.os == os && e.arch == arch)
    }

    pub fn add_or_replace_jre(&mut self, entry: JreEntry) {
        self.jre_entries.retain(|e| !(e.major_version == entry.major_version && e.os == entry.os && e.arch == entry.arch));
        self.jre_entries.push(entry);
    }
}
