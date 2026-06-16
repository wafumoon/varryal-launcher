//! Varryal Launcher — Tauri shell entry point.
//!
//! Responsibilities:
//! 1. JRE provisioning (BellSoft Liberica, multi-version)
//! 2. Spawn signed Java launcher jar as background process
//! 3. WebSocket client to Java BridgeRuntimeProvider
//! 4. Proxy IPC between Tauri frontend (invoke/emit) and Java WS
//! 5. Frameless window, auto-updater
//!
//! F1: The launcher JRE is now Java 25 (matching the live varryal_main profile's
//!     minJavaVersion:25).  After profiles are fetched, each profile's required
//!     Java major should be provisioned too — see the TODO in bootstrap() below.

// Prevent a console window from opening on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Treat all warnings as errors so CI catches regressions.
#![deny(warnings)]

mod auth;
mod config;
mod jre;
mod paths;
mod portal;
mod runner;
mod ipc_proxy;

use tauri::{Emitter, Manager};
use tracing::info;
use tracing_subscriber::EnvFilter;

/// Java major version used to run the launcher jar itself.
///
/// Set to 25 to match the live Varryal profile (`minJavaVersion:25`).
const LAUNCHER_JAVA_MAJOR: u32 = 25;

// ── Bootstrap status event ────────────────────────────────────────────────────

/// Payload for the `bootstrap_status` Tauri event.
/// The frontend listens to this to gate the login button behind readiness.
#[derive(Clone, serde::Serialize)]
struct BootstrapStatus {
    phase: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<f32>,
}

fn emit_bootstrap(app: &tauri::AppHandle, phase: &'static str, message: impl Into<String>, progress: Option<f32>) {
    let _ = app.emit("bootstrap_status", BootstrapStatus {
        phase,
        message: message.into(),
        progress,
    });
}

fn main() {
    // Release builds have no console (windows_subsystem = "windows"), so persist any
    // startup panic to a crash log for diagnosis.
    std::panic::set_hook(Box::new(|info| {
        if let Ok(dir) = paths::varryal_data_dir() {
            let _ = std::fs::write(dir.join("crash.log"), format!("panic: {info}\n"));
        }
    }));

    // Initialise logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("varryal=debug".parse().unwrap()),
        )
        .init();

    info!("Varryal Launcher starting up");

    tauri::Builder::default()
        // Single-instance MUST be the first plugin (Tauri requirement). When a 2nd instance is
        // launched (e.g. via a varryal:// deep-link on Windows), its argv is forwarded here.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let pending = app.state::<auth::PendingAuthState>();
            for arg in &argv {
                if arg.starts_with("varryal://auth/callback") {
                    auth::handle_callback(app, arg, &pending);
                    return;
                }
            }
        }))
        // Deep-link: handles varryal:// URLs (cold-start + already-running).
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(auth::PendingAuthState::new())
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;

            let app_handle = app.handle().clone();

            // Register deep-link handler for cold-start and hot (already-running) invocations.
            app.deep_link().on_open_url({
                let app_handle2 = app_handle.clone();
                move |event| {
                    let pending = app_handle2.state::<auth::PendingAuthState>();
                    for url in event.urls() {
                        let url_str = url.as_str();
                        if url_str.starts_with("varryal://auth/callback") {
                            auth::handle_callback(&app_handle2, url_str, &pending);
                        }
                    }
                }
            });

            // Spawn the bootstrap task: provision JRE + launch jar + connect WS
            tauri::async_runtime::spawn(async move {
                if let Err(e) = bootstrap(app_handle.clone()).await {
                    tracing::error!("Bootstrap failed: {e}");
                    emit_bootstrap(&app_handle, "error", format!("{e}"), None);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc_proxy::ipc_request,
            auth::start_web_auth,
            portal::portal_list_characters,
            portal::portal_create_session,
            portal::portal_login,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn bootstrap(app: tauri::AppHandle) -> anyhow::Result<()> {
    use crate::config::ShellConfig;
    use crate::jre::JreManager;
    use crate::runner::{launch_jar, resolve_jar};
    use crate::ipc_proxy::IpcProxy;

    // Load / create shell config (F4: config lives in varryal_data_dir, no app handle needed)
    let mut cfg = ShellConfig::load()?;

    // ── Phase: jre — Provision the launcher JRE (Java 25) ────────────────────
    emit_bootstrap(&app, "jre", "Скачивание Java…", Some(0.0));

    let mut jre_mgr = JreManager::new(&mut cfg);
    let launcher_jre = jre_mgr.ensure_version(LAUNCHER_JAVA_MAJOR).await?;
    info!("Launcher JRE (Java {LAUNCHER_JAVA_MAJOR}): {}", launcher_jre.display());

    // Save config with updated JRE entry
    cfg.save()?;

    // ── Phase: jar — Resolve / download Varryal.jar ──────────────────────────
    emit_bootstrap(&app, "jar", "Скачивание клиента…", Some(0.3));

    let jar_path = resolve_jar(&app, &mut cfg).await?;
    info!("Launcher jar: {}", jar_path.display());

    // Persist updated jar_downloaded_at timestamp
    cfg.save()?;

    // ── Phase: starting — Spawn Java process ─────────────────────────────────
    emit_bootstrap(&app, "starting", "Запуск…", Some(0.6));

    let java_exe = launcher_jre
        .join("bin")
        .join(if cfg!(windows) { "javaw.exe" } else { "java" });
    let mut child = launch_jar(&java_exe, &jar_path)?;
    // Drain stdout in a background thread to prevent pipe-buffer deadlock.
    crate::runner::drain_stdout(&mut child);
    let _child = child; // keep handle alive so the process is not killed on drop

    // ── Phase: connecting — Wait for IPC handshake ───────────────────────────
    emit_bootstrap(&app, "connecting", "Подключение…", Some(0.8));

    let handshake = ipc_proxy::wait_for_handshake(&app, 30).await?;
    info!("IPC handshake: port={} pid={}", handshake.port, handshake.pid);

    // ── Connect WebSocket and start proxying ─────────────────────────────────
    let proxy = IpcProxy::connect(handshake, app.clone()).await?;

    // ── Phase: ready — all good, frontend may show login ─────────────────────
    emit_bootstrap(&app, "ready", "Готово", Some(1.0));

    proxy.run().await;

    Ok(())
}
