//! Canonical Varryal data directory.
//!
//! All Rust code that needs a persistent path (shell config, JRE cache,
//! downloaded jar, IPC handshake) MUST call `varryal_data_dir()` so they
//! all resolve to the same physical location.
//!
//! **Windows** → `%APPDATA%\Varryal`
//! **Unix**    → `~/Varryal`
//!
//! This matches the Java side exactly:
//!   WsBridgeServer.writeHandshake() uses System.getenv("APPDATA") on Windows
//!   and System.getProperty("user.home") on Unix, then appends "Varryal".
//!
//! Do NOT use `tauri::AppHandle::path().app_data_dir()` for these paths — that
//! method appends the bundle identifier (e.g. `…/com.varryal.launcher/Varryal`)
//! which does NOT match the Java side.

use std::path::PathBuf;
use anyhow::{Context, Result};

/// Returns the canonical Varryal data directory, creating it if needed.
///
/// - Windows: `%APPDATA%\Varryal`
/// - Unix:    `$HOME/Varryal`
pub fn varryal_data_dir() -> Result<PathBuf> {
    let base: PathBuf = if cfg!(windows) {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| dirs_next::home_dir().unwrap_or_default())
    } else {
        dirs_next::home_dir()
            .context("Cannot determine home directory")?
    };
    let dir = base.join("Varryal");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Cannot create Varryal data dir: {}", dir.display()))?;
    Ok(dir)
}
