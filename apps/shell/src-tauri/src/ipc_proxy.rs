//! WebSocket proxy: Tauri frontend (invoke/emit) <-> Java BridgeRuntimeProvider (WS).
//!
//! The Java side writes ${data_dir}/Varryal/ipc-handshake.json and prints
//! "VARRYAL_IPC port=<N> token=<T>" to stdout. We wait for the file then connect.

use std::path::PathBuf;
use std::time::Duration;
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{error, info, warn};

// ── Handshake types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct IpcHandshake {
    pub port: u16,
    pub token: String,
    pub pid: u64,
    #[serde(rename = "protocolVersion")]
    #[allow(dead_code)]
    pub protocol_version: u32,
}

/// Wait for ipc-handshake.json to appear; retry for up to `timeout_secs` seconds.
pub async fn wait_for_handshake(app: &tauri::AppHandle, timeout_secs: u64) -> Result<IpcHandshake> {
    let path = handshake_path(app)?;
    info!("Waiting for IPC handshake at {}", path.display());

    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            match serde_json::from_str::<IpcHandshake>(&raw) {
                Ok(h) => return Ok(h),
                Err(e) => warn!("Handshake JSON parse error: {e}"),
            }
        }
        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("Timed out waiting for Java IPC handshake after {timeout_secs}s");
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

fn handshake_path(_app: &tauri::AppHandle) -> Result<PathBuf> {
    // F4: use the canonical varryal_data_dir() so the handshake is read from
    // the same directory that WsBridgeServer.writeHandshake() writes to:
    //   Windows → %APPDATA%\Varryal\ipc-handshake.json
    //   Unix    → ~/Varryal/ipc-handshake.json
    Ok(crate::paths::varryal_data_dir()?.join("ipc-handshake.json"))
}

/// Before spawning our own bridge, kill any leftover bridge from a previous run
/// (the launcher does not yet reap its Java child on exit) and delete the stale
/// handshake file. Otherwise `wait_for_handshake` and the per-request reads in
/// `ipc_request` could point at an orphaned JVM: `init()` would populate auth
/// methods on one bridge while `selectAuthMethod`/`authorize` hit another that
/// was never initialised — which surfaces as
/// "This method call not allowed before select authMethod".
pub fn clear_stale_bridge(app: &tauri::AppHandle) {
    let path = match handshake_path(app) {
        Ok(p) => p,
        Err(_) => return,
    };
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(h) = serde_json::from_str::<IpcHandshake>(&raw) {
            info!("Killing previous bridge pid={}", h.pid);
            kill_bridge_pid(h.pid);
        }
    }
    let _ = std::fs::remove_file(&path);
}

#[cfg(windows)]
fn kill_bridge_pid(pid: u64) {
    use std::os::windows::process::CommandExt;
    // IMAGENAME filter guards against PID reuse — only kill if it is still javaw.
    let _ = std::process::Command::new("taskkill")
        .args([
            "/F",
            "/FI",
            &format!("PID eq {pid}"),
            "/FI",
            "IMAGENAME eq javaw.exe",
        ])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output();
}

#[cfg(not(windows))]
fn kill_bridge_pid(pid: u64) {
    // Verify the pid is a java process before killing (guards against PID reuse).
    let is_java = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("java"))
        .unwrap_or(false);
    if is_java {
        let _ = std::process::Command::new("kill").arg("-9").arg(pid.to_string()).output();
    }
}

// ── Proxy ─────────────────────────────────────────────────────────────────────

pub struct IpcProxy {
    handshake: IpcHandshake,
    app: tauri::AppHandle,
}

impl IpcProxy {
    pub async fn connect(handshake: IpcHandshake, app: tauri::AppHandle) -> Result<Self> {
        // Verify connectivity (the actual WS connection will be per-request in run())
        let ws_url = format!("ws://127.0.0.1:{}", handshake.port);
        info!("Connecting to Java WS bridge at {ws_url}");
        // Quick probe
        let (_, _) = connect_async(&ws_url).await
            .context("Cannot connect to Java WS bridge")?;
        info!("Java WS bridge reachable");
        Ok(Self { handshake, app })
    }

    /// Run the proxy loop: forward Tauri invoke calls to Java WS and emit events back.
    pub async fn run(self) {
        let ws_url = format!("ws://127.0.0.1:{}", self.handshake.port);
        let _token = self.handshake.token.clone(); // reserved for event-stream auth
        let app = self.app.clone();

        // Persistent WS connection for event streaming
        loop {
            match connect_async(&ws_url).await {
                Err(e) => {
                    error!("WS reconnect failed: {e}");
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
                Ok((ws_stream, _)) => {
                    info!("WS event stream connected");
                    let (_, mut read) = ws_stream.split();
                    while let Some(msg) = read.next().await {
                        match msg {
                            Ok(Message::Text(text)) => {
                                // Forward Java events to the Tauri frontend
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                                    if val.get("type").and_then(|t| t.as_str()) == Some("event") {
                                        let channel = val.get("channel").and_then(|c| c.as_str()).unwrap_or("main");
                                        let name = val.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                        let event_name = format!("ipc_event_{channel}_{name}");
                                        let _ = app.emit(&event_name, &val);
                                        let _ = app.emit("ipc_event", &val);
                                    }
                                }
                            }
                            Ok(Message::Close(_)) => {
                                info!("Java WS closed, reconnecting…");
                                break;
                            }
                            Err(e) => {
                                warn!("WS read error: {e}");
                                break;
                            }
                            _ => {}
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        }
    }
}

// ── Tauri command ──────────────────────────────────────────────────────────────

/// Payload shape for `ipc_request` — matches the JS invoke call signature.
/// Defined here for documentation; fields are passed individually by Tauri.
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct IpcRequestPayload {
    pub method: String,
    pub params: serde_json::Value,
}

/// Tauri invoke command: send a request to the Java WS bridge and return the response.
#[tauri::command]
pub async fn ipc_request(
    app: tauri::AppHandle,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    // Read the handshake to get port + token
    let handshake = read_handshake_cached(&app).map_err(|e| e.to_string())?;
    let ws_url = format!("ws://127.0.0.1:{}", handshake.port);

    // Open a fresh WS connection per request (simple; for high-frequency use, pool connections)
    let (ws_stream, _) = connect_async(&ws_url).await
        .map_err(|e| format!("WS connect failed: {e}"))?;
    let (mut write, mut read) = ws_stream.split();

    // Build the IPC request envelope
    let id = uuid::Uuid::new_v4().to_string();
    let request = serde_json::json!({
        "id": id,
        "type": "request",
        "method": method,
        "token": handshake.token,
        "params": params,
    });

    write.send(Message::Text(request.to_string())).await
        .map_err(|e| format!("WS send failed: {e}"))?;

    // Wait for the matching response
    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    if val.get("type").and_then(|t| t.as_str()) == Some("response")
                        && val.get("id").and_then(|i| i.as_str()) == Some(&id)
                    {
                        return Ok(val);
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Err(e) => return Err(format!("WS read error: {e}")),
            _ => {}
        }
    }
    Err("No response received from Java bridge".to_string())
}

// ── Handshake caching (read from file) ───────────────────────────────────────

fn read_handshake_cached(app: &tauri::AppHandle) -> Result<IpcHandshake> {
    let path = handshake_path(app)?;
    let raw = std::fs::read_to_string(&path)
        .context("ipc-handshake.json not found — Java bridge not running?")?;
    serde_json::from_str(&raw).context("Failed to parse ipc-handshake.json")
}
