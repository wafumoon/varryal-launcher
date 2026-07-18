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

/// Before spawning our own bridge, terminate a leftover bridge from a previous run
/// and delete its stale handshake. A responsive bridge first proves its identity with
/// the random handshake token and shuts down gracefully. Windows can additionally
/// reap a hung process through one verified process handle; non-Windows platforms
/// fail closed rather than killing an unverified or PID-reused process.
pub async fn clear_stale_bridge(
    app: &tauri::AppHandle,
    launcher_jre: &std::path::Path,
) -> Result<()> {
    let path = handshake_path(app)?;
    if !path.exists() {
        return Ok(());
    }

    let raw = std::fs::read_to_string(&path)
        .context("Failed to read stale IPC handshake")?;
    let handshake: IpcHandshake = serde_json::from_str(&raw)
        .context("Failed to parse stale IPC handshake")?;
    info!("Stopping previous bridge pid={}", handshake.pid);

    let graceful = request_bridge_shutdown(&handshake).await;
    if let Err(error) = &graceful {
        warn!("Authenticated stale bridge shutdown failed: {error:#}");
    }

    #[cfg(windows)]
    kill_bridge_pid(handshake.pid, launcher_jre)?;

    #[cfg(not(windows))]
    {
        let _ = launcher_jre;
        if graceful.is_ok() {
            wait_for_process_exit(handshake.pid, Duration::from_secs(5)).await?;
        } else if process_is_running(handshake.pid)? {
            return Err(graceful.unwrap_err())
                .context("Refusing to terminate an unauthenticated stale process");
        }
    }

    std::fs::remove_file(&path)
        .context("Failed to remove stale IPC handshake")?;
    Ok(())
}

async fn request_bridge_shutdown(handshake: &IpcHandshake) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(3), async {
        let ws_url = format!("ws://127.0.0.1:{}", handshake.port);
        let (ws_stream, _) = connect_async(&ws_url).await
            .context("Cannot connect to stale Java bridge")?;
        let (mut write, mut read) = ws_stream.split();
        let id = uuid::Uuid::new_v4().to_string();
        let request = serde_json::json!({
            "id": id,
            "type": "request",
            "method": "shutdown",
            "token": handshake.token,
            "params": {},
        });
        write.send(Message::Text(request.to_string())).await
            .context("Failed to send stale bridge shutdown")?;

        while let Some(message) = read.next().await {
            match message.context("Failed to read stale bridge shutdown response")? {
                Message::Text(text) => {
                    let response: serde_json::Value = serde_json::from_str(&text)
                        .context("Stale bridge returned malformed JSON")?;
                    if response.get("type").and_then(|value| value.as_str()) == Some("response")
                        && response.get("id").and_then(|value| value.as_str()) == Some(&id)
                    {
                        if response.get("ok").and_then(|value| value.as_bool()) == Some(true) {
                            return Ok(());
                        }
                        anyhow::bail!("Stale bridge rejected authenticated shutdown");
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        anyhow::bail!("Stale bridge closed without acknowledging shutdown")
    })
    .await
    .context("Timed out stopping stale Java bridge")?
}

#[cfg(any(windows, test))]
fn is_expected_bridge_executable(actual: &std::path::Path, launcher_jre: &std::path::Path) -> bool {
    let file_name = actual.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    if !file_name.eq_ignore_ascii_case("java.exe") && !file_name.eq_ignore_ascii_case("javaw.exe") {
        return false;
    }
    let expected_bin = launcher_jre.join("bin");
    let actual_parent = actual.parent().unwrap_or_else(|| std::path::Path::new(""));
    actual_parent.to_string_lossy().replace('\\', "/")
        .eq_ignore_ascii_case(&expected_bin.to_string_lossy().replace('\\', "/"))
}

#[cfg(windows)]
fn kill_bridge_pid(pid: u64, launcher_jre: &std::path::Path) -> Result<()> {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, WaitForSingleObject,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };
    const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

    struct OwnedHandle(windows_sys::Win32::Foundation::HANDLE);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0); }
        }
    }

    let pid = u32::try_from(pid).context("Bridge PID is outside the Windows PID range")?;
    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE_ACCESS,
            0,
            pid,
        )
    };
    if handle.is_null() {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(87) {
            return Ok(());
        }
        return Err(error).context("Unable to open stale bridge process");
    }
    let handle = OwnedHandle(handle);

    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let queried = unsafe {
        QueryFullProcessImageNameW(handle.0, 0, buffer.as_mut_ptr(), &mut length)
    };
    if queried == 0 {
        return Err(std::io::Error::last_os_error())
            .context("Unable to identify stale bridge executable");
    }
    let actual = PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize]));
    let actual = std::fs::canonicalize(&actual)
        .context("Unable to canonicalize stale bridge executable")?;
    let expected_jre = std::fs::canonicalize(launcher_jre)
        .context("Unable to canonicalize launcher JRE")?;
    if !is_expected_bridge_executable(&actual, &expected_jre) {
        anyhow::bail!(
            "Refusing to terminate pid={pid}: {} is outside launcher JRE {}",
            actual.display(),
            expected_jre.display()
        );
    }

    if unsafe { TerminateProcess(handle.0, 0) } == 0 {
        return Err(std::io::Error::last_os_error())
            .context("Failed to terminate stale bridge process");
    }
    if unsafe { WaitForSingleObject(handle.0, 5_000) } != WAIT_OBJECT_0 {
        anyhow::bail!("Timed out waiting for stale bridge pid={pid} to exit");
    }
    Ok(())
}

#[cfg(not(windows))]
fn process_is_running(pid: u64) -> Result<bool> {
    let status = std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .context("Failed to probe stale bridge process")?;
    Ok(status.success())
}

#[cfg(not(windows))]
async fn wait_for_process_exit(pid: u64, timeout: Duration) -> Result<()> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if !process_is_running(pid)? {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("Timed out waiting for authenticated stale bridge pid={pid} to exit");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
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

#[cfg(test)]
mod tests {
    use super::{is_expected_bridge_executable, request_bridge_shutdown, IpcHandshake};
    use futures_util::{SinkExt, StreamExt};
    use std::path::Path;
    use tokio::net::TcpListener;
    use tokio_tungstenite::{accept_async, tungstenite::Message};

    #[test]
    fn stale_bridge_cleanup_requires_the_provisioned_jre_executable() {
        let jre = Path::new("C:/Users/test/AppData/Roaming/Varryal/jre/java-25/jre-25.0.3");
        assert!(is_expected_bridge_executable(
            Path::new("C:/Users/test/AppData/Roaming/Varryal/jre/java-25/jre-25.0.3/bin/java.exe"),
            jre,
        ));
        assert!(is_expected_bridge_executable(
            Path::new("C:/Users/test/AppData/Roaming/Varryal/jre/java-25/jre-25.0.3/bin/javaw.exe"),
            jre,
        ));
        assert!(!is_expected_bridge_executable(Path::new("C:/Program Files/Java/bin/java.exe"), jre));
        assert!(!is_expected_bridge_executable(
            Path::new("C:/Users/test/AppData/Roaming/Varryal/jre/java-25/jre-25.0.3/java.exe"),
            jre,
        ));
    }

    #[tokio::test]
    async fn stale_bridge_shutdown_requires_token_and_matching_response() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let request = match socket.next().await.unwrap().unwrap() {
                Message::Text(text) => serde_json::from_str::<serde_json::Value>(&text).unwrap(),
                other => panic!("unexpected message: {other:?}"),
            };
            assert_eq!(request["method"], "shutdown");
            assert_eq!(request["token"], "test-secret");
            let response = serde_json::json!({
                "id": request["id"],
                "type": "response",
                "ok": true,
                "result": {},
            });
            socket.send(Message::Text(response.to_string())).await.unwrap();
        });

        request_bridge_shutdown(&IpcHandshake {
            port,
            token: "test-secret".to_string(),
            pid: 42,
            protocol_version: 1,
        })
        .await
        .unwrap();
        server.await.unwrap();
    }
}
