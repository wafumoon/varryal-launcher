//! Varryal Launcher — Tauri shell entry point.
//!
//! Responsibilities:
//! 1. JRE provisioning (BellSoft Liberica, multi-version)
//! 2. Spawn signed Java launcher jar as background process
//! 3. WebSocket client to Java BridgeRuntimeProvider
//! 4. Proxy IPC between Tauri frontend (invoke/emit) and Java WS
//! 5. Frameless window, auto-updater

// Prevent a console window from opening on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod jre;
mod runner;
mod ipc_proxy;

use tauri::Manager;
use tracing::info;
use tracing_subscriber::EnvFilter;

fn main() {
    // Initialise logging
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("varryal=debug".parse().unwrap()))
        .init();

    info!("Varryal Launcher starting up");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Spawn the bootstrap task: provision JRE + launch jar + connect WS
            tauri::async_runtime::spawn(async move {
                if let Err(e) = bootstrap(app_handle).await {
                    tracing::error!("Bootstrap failed: {e}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc_proxy::ipc_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn bootstrap(app: tauri::AppHandle) -> anyhow::Result<()> {
    use crate::config::ShellConfig;
    use crate::jre::JreManager;
    use crate::runner::launch_jar;
    use crate::ipc_proxy::IpcProxy;

    // Load / create shell config
    let mut cfg = ShellConfig::load(&app)?;

    // Provision JRE (launcher needs Java 21+; profile may need 25)
    let jre_mgr = JreManager::new(&app, &mut cfg);
    let launcher_jre = jre_mgr.ensure_version(21).await?;
    info!("Launcher JRE: {}", launcher_jre.display());

    // Save config with updated JRE entry
    cfg.save(&app)?;

    // Find the launcher jar (bundled as resource or downloaded)
    let jar_path = crate::runner::resolve_jar(&app)?;
    info!("Launcher jar: {}", jar_path.display());

    // Spawn Java process
    let java_exe = launcher_jre.join("bin").join(if cfg!(windows) { "javaw.exe" } else { "java" });
    let _child = launch_jar(&java_exe, &jar_path)?;

    // Wait for ipc-handshake.json (written by BridgeRuntimeProvider)
    let handshake = ipc_proxy::wait_for_handshake(&app, 30).await?;
    info!("IPC handshake: port={} pid={}", handshake.port, handshake.pid);

    // Connect WebSocket and start proxying
    let proxy = IpcProxy::connect(handshake, app.clone()).await?;
    proxy.run().await;

    Ok(())
}
