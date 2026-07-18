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
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
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

/// Open an external http(s) URL in the system browser.
///
/// Used by the frontend for the login "register" link and the "create a character"
/// prompt (empty character list). Refuses anything that isn't http(s) so the
/// command can't be coerced into opening arbitrary local schemes.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("refusing to open non-http(s) URL: {url}"));
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Show + focus the main window (used by the tray icon / menu to restore the
/// launcher after it was hidden to tray while the game ran).
fn show_main_window_handle(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Hide the main window to the system tray (post-play behaviour when the in-game
/// console is disabled).
#[tauri::command]
fn hide_to_tray(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// Restore the main window from the tray (e.g. the game exited).
#[tauri::command]
fn show_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

/// Check the GitHub Releases feed for a newer signed build.
/// Returns the new version string if an update is available, otherwise null.
#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(update.version)),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Download + install the pending update (its minisign signature is verified by
/// the plugin against the baked-in pubkey), then restart into the new version.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}

/// Prepare the per-run launcher log file (`<data dir>/logs/launcher-latest.log`,
/// truncated each launch) and return a writer factory for tracing. Returns None
/// if the path can't be prepared, in which case logging stays stderr-only.
fn setup_log_file() -> Option<impl Fn() -> std::fs::File + Send + Sync + 'static> {
    let dir = paths::varryal_data_dir().ok()?.join("logs");
    std::fs::create_dir_all(&dir).ok()?;
    let file = std::fs::File::create(dir.join("launcher-latest.log")).ok()?;
    Some(move || file.try_clone().expect("clone launcher log file handle"))
}

fn main() {
    // Release builds have no console (windows_subsystem = "windows"), so persist any
    // startup panic to a crash log for diagnosis.
    std::panic::set_hook(Box::new(|info| {
        if let Ok(dir) = paths::varryal_data_dir() {
            let _ = std::fs::write(dir.join("crash.log"), format!("panic: {info}\n"));
        }
    }));

    // Initialise logging — mirror everything to a per-run file in the data dir
    // (logs/launcher-latest.log) so issues are diagnosable without a console
    // (release builds have no stderr). Falls back to stderr-only if the file
    // can't be opened.
    let filter = EnvFilter::from_default_env().add_directive("varryal=debug".parse().unwrap());
    match setup_log_file() {
        Some(make_file) => {
            use tracing_subscriber::fmt::writer::MakeWriterExt;
            tracing_subscriber::fmt()
                .with_ansi(false)
                .with_writer(make_file.and(std::io::stderr))
                .with_env_filter(filter)
                .init();
        }
        None => {
            tracing_subscriber::fmt().with_env_filter(filter).init();
        }
    }

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
        .plugin(tauri_plugin_updater::Builder::new().build())
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

            // ── System tray ──────────────────────────────────────────────────
            // Lets the launcher hide to tray while the game runs (post-play
            // behaviour when the in-game console is disabled). Left-click or the
            // "Open" menu item restores the window; "Quit" exits the launcher.
            {
                let show_i = MenuItem::with_id(app, "show", "Открыть Varryal", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
                let icon = app.default_window_icon().cloned().ok_or("no default window icon")?;
                let _tray = TrayIconBuilder::with_id("main")
                    .tooltip("Varryal Launcher")
                    .icon(icon)
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => show_main_window_handle(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main_window_handle(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }

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
            portal::portal_fetch_skin,
            open_external_url,
            hide_to_tray,
            show_main_window,
            check_for_update,
            install_update,
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

    // Kill any leftover bridge from a previous run and clear its handshake, so every
    // connection this session (handshake wait + per-request) targets the bridge we
    // are about to spawn — not an orphaned, un-initialised JVM.
    ipc_proxy::clear_stale_bridge(&app);

    let mut child = launch_jar(&java_exe, &jar_path)?;
    // Drain stdout in a background thread to prevent pipe-buffer deadlock.
    crate::runner::drain_stdout(&mut child);
    let _child = child; // keep handle alive so the process is not killed on drop

    // ── Phase: connecting — Wait for IPC handshake ───────────────────────────
    emit_bootstrap(&app, "connecting", "Подключение…", Some(0.8));

    // Java/JavaFX can take longer than 30s on a cold launch (fresh JAR/JRE,
    // Windows Defender scan, slow disk). Timing out here leaves the UI able to
    // reach character auth while the Java backend has not selected an authMethod,
    // which surfaces as: "This method call not allowed before select authMethod".
    let handshake = ipc_proxy::wait_for_handshake(&app, 120).await?;
    info!("IPC handshake: port={} pid={}", handshake.port, handshake.pid);

    // ── Connect WebSocket and start proxying ─────────────────────────────────
    let proxy = IpcProxy::connect(handshake, app.clone()).await?;

    // ── Phase: ready — all good, frontend may show login ─────────────────────
    emit_bootstrap(&app, "ready", "Готово", Some(1.0));

    proxy.run().await;

    Ok(())
}
