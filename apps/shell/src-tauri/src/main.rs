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
mod runner;
mod ipc_proxy;

use tauri::Manager;
use tracing::info;
use tracing_subscriber::EnvFilter;

/// Java major version used to run the launcher jar itself.
///
/// Set to 25 to match the live Varryal profile (`minJavaVersion:25`).
/// If a future profile requires a higher version, bump this constant
/// (and `ensure_version` will provision that version automatically).
///
/// The Java version used to run each GAME is resolved by the GravitLauncher
/// core from the profile — the launcher JRE just needs to be compatible.
const LAUNCHER_JAVA_MAJOR: u32 = 25;

fn main() {
    // Initialise logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("varryal=debug".parse().unwrap()),
        )
        .init();

    info!("Varryal Launcher starting up");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        // Single-instance: when a second instance is launched (e.g. via a varryal:// deep-link
        // on Windows), its arguments are forwarded to the already-running instance here.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Look for a varryal:// URL in the forwarded arguments and handle it.
            let pending = app.state::<auth::PendingAuthState>();
            for arg in &argv {
                if arg.starts_with("varryal://auth/callback") {
                    auth::handle_callback(app, arg, &pending);
                    return;
                }
            }
        }))
        // Deep-link: handles varryal:// URLs when the app is already running (macOS/Linux)
        // as well as cold-start deep-links (app launched directly by the OS via the scheme).
        .plugin(tauri_plugin_deep_link::init())
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
                if let Err(e) = bootstrap(app_handle).await {
                    tracing::error!("Bootstrap failed: {e}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc_proxy::ipc_request,
            auth::start_web_auth,
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

    // ── F1: Provision the launcher JRE (Java 25) ─────────────────────────────
    //
    // The live varryal_main profile requires minJavaVersion:25. Using Java 25
    // for the launcher process guarantees the GravitLauncher core can start and
    // pass compatibility checks for that profile.  `ensure_version` is already
    // multi-version-capable; adding a second call for Java 21 would provision a
    // second JRE alongside it for older profiles.
    //
    // TODO (post-login): After `fetchProfiles` returns, read each profile's
    //   minJavaVersion and call `jre_mgr.ensure_version(profile_min_java)` for
    //   any version not already cached.  This requires the IPC proxy to be up,
    //   so it is done in a separate task after bootstrap.  The profile field
    //   mapping in IpcDispatcher.java already serialises `minJavaVersion` in
    //   the ClientProfile JSON — the frontend store should forward it here via
    //   a dedicated Tauri command (e.g. `ensure_jre_for_profile`).
    let mut jre_mgr = JreManager::new(&mut cfg);
    let launcher_jre = jre_mgr.ensure_version(LAUNCHER_JAVA_MAJOR).await?;
    info!("Launcher JRE (Java {LAUNCHER_JAVA_MAJOR}): {}", launcher_jre.display());

    // Save config with updated JRE entry
    cfg.save()?;

    // ── F2: Resolve / download Varryal.jar ───────────────────────────────────
    let jar_path = resolve_jar(&app, &mut cfg).await?;
    info!("Launcher jar: {}", jar_path.display());

    // Persist updated jar_downloaded_at timestamp
    cfg.save()?;

    // ── Spawn Java process ───────────────────────────────────────────────────
    let java_exe = launcher_jre
        .join("bin")
        .join(if cfg!(windows) { "javaw.exe" } else { "java" });
    let mut child = launch_jar(&java_exe, &jar_path)?;
    // Drain stdout in a background thread to prevent pipe-buffer deadlock.
    crate::runner::drain_stdout(&mut child);
    let _child = child; // keep handle alive so the process is not killed on drop

    // ── Wait for IPC handshake ───────────────────────────────────────────────
    let handshake = ipc_proxy::wait_for_handshake(&app, 30).await?;
    info!("IPC handshake: port={} pid={}", handshake.port, handshake.pid);

    // ── Connect WebSocket and start proxying ─────────────────────────────────
    let proxy = IpcProxy::connect(handshake, app.clone()).await?;
    proxy.run().await;

    Ok(())
}
