//! Browser-based ("OAuth-redirect") authentication.
//!
//! Flow:
//!   1. `start_web_auth` generates a CSPRNG state, stores it, builds the portal URL,
//!      opens it in the system browser.
//!   2. The portal redirects back to  varryal://auth/callback?token=<jwt>&state=<s>
//!      (success) or  varryal://auth/callback?error=<code>&state=<s>  (failure).
//!   3. The deep-link handler (registered in main.rs) calls `handle_callback`.
//!      It validates state, then emits a Tauri event `web_auth_result` to the frontend.
//!
//! Contract (do NOT change without updating the portal and the frontend):
//!   - redirect_uri MUST be exactly "varryal://auth/callback"  (URL-encoded in query string)
//!   - state MUST be CSPRNG-random, verified on callback
//!   - Token is opaque — never parsed here

use std::sync::Mutex;

use anyhow::Result;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tracing::{info, warn};

// ── Constants ─────────────────────────────────────────────────────────────────

/// Base URL for the Varryal portal web-login page.
pub const PORTAL_WEB_LOGIN_URL: &str = "https://varryal.ru/launcher/login";

/// Custom-scheme callback URI (registered as deep-link scheme "varryal").
pub const REDIRECT_URI: &str = "varryal://auth/callback";

// ── App state ─────────────────────────────────────────────────────────────────

/// Holds the pending CSPRNG state string for the in-flight auth attempt.
/// `None` means no auth attempt is active.
pub struct PendingAuthState(pub Mutex<Option<String>>);

impl PendingAuthState {
    pub fn new() -> Self {
        PendingAuthState(Mutex::new(None))
    }
}

// ── Event payload emitted to the frontend ────────────────────────────────────

/// Payload for the `web_auth_result` Tauri event.
#[derive(Debug, Clone, Serialize)]
pub struct WebAuthResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Tauri command ─────────────────────────────────────────────────────────────

/// Tauri command: generate a fresh auth attempt, open the portal in the system browser.
///
/// Called by the frontend as `invoke('start_web_auth')`.
#[tauri::command]
pub async fn start_web_auth(
    _app: AppHandle,
    pending: State<'_, PendingAuthState>,
) -> Result<(), String> {
    // Generate CSPRNG state via uuid v4 (already a dep)
    let state_value = uuid::Uuid::new_v4().to_string();

    // Store the pending state (overwrite any previous abandoned attempt)
    {
        let mut guard = pending.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(state_value.clone());
    }

    // Build the portal URL.
    // redirect_uri must be percent-encoded in the query string.
    let redirect_uri_encoded = percent_encode(REDIRECT_URI);
    let url = format!(
        "{}?redirect_uri={}&state={}",
        PORTAL_WEB_LOGIN_URL, redirect_uri_encoded, state_value
    );

    info!("Opening web-auth URL: {url}");

    // Open in system browser using tauri-plugin-opener
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {e}"))?;

    Ok(())
}

// ── Deep-link callback handler ────────────────────────────────────────────────

/// Called from the deep-link handler in main.rs for both cold-start and
/// single-instance (already-running) invocations of `varryal://auth/callback?...`.
///
/// Validates the state, emits `web_auth_result` to all windows, and clears
/// the pending state regardless of success/failure.
pub fn handle_callback(app: &AppHandle, url: &str, pending: &PendingAuthState) {
    info!("Deep-link callback: {url}");

    // Parse the URL query string manually (no heavy dep needed for one URL)
    let query = match url.split_once('?') {
        Some((_, q)) => q,
        None => {
            warn!("Callback URL has no query string: {url}");
            emit_error(app, "invalid_callback");
            return;
        }
    };

    // Parse key=value pairs from query string
    let params = parse_query(query);

    // Validate state
    let returned_state = params.get("state").map(|s| s.as_str()).unwrap_or("");
    let expected_state = {
        let mut guard = pending.0.lock().unwrap_or_else(|p| p.into_inner());
        guard.take() // consume the pending state
    };

    match expected_state {
        None => {
            warn!("No pending auth state — ignoring callback");
            return;
        }
        Some(expected) if expected != returned_state => {
            warn!("State mismatch — possible CSRF; expected={expected}, got={returned_state}");
            emit_error(app, "state_mismatch");
            return;
        }
        _ => {}
    }

    // State matched — check for error or token
    if let Some(error_code) = params.get("error") {
        info!("Auth callback error: {error_code}");
        let result = WebAuthResult {
            ok: false,
            token: None,
            error: Some(error_code.clone()),
        };
        let _ = app.emit("web_auth_result", &result);
        return;
    }

    match params.get("token") {
        Some(token) if !token.is_empty() => {
            info!("Auth callback success — token received");
            let result = WebAuthResult {
                ok: true,
                token: Some(token.clone()),
                error: None,
            };
            let _ = app.emit("web_auth_result", &result);
        }
        _ => {
            warn!("Auth callback: no token and no error — treating as error");
            emit_error(app, "missing_token");
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn emit_error(app: &AppHandle, code: &str) {
    let result = WebAuthResult {
        ok: false,
        token: None,
        error: Some(code.to_string()),
    };
    let _ = app.emit("web_auth_result", &result);
}

/// Minimal percent-encoder: encodes characters that are not unreserved in RFC 3986.
/// Sufficient for encoding `varryal://auth/callback` in a query parameter value.
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            b => {
                out.push('%');
                out.push(nibble_to_hex(b >> 4));
                out.push(nibble_to_hex(b & 0xF));
            }
        }
    }
    out
}

fn nibble_to_hex(n: u8) -> char {
    match n {
        0..=9 => (b'0' + n) as char,
        _ => (b'A' + n - 10) as char,
    }
}

/// Parse a URL query string into a key→value map.
/// Values are percent-decoded.
fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            map.insert(percent_decode(k), percent_decode(v));
        }
    }
    map
}

/// Minimal percent-decoder.
fn percent_decode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = hex_to_nibble(bytes[i + 1]);
            let lo = hex_to_nibble(bytes[i + 2]);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h << 4 | l) as char);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(' ');
        } else {
            out.push(bytes[i] as char);
        }
        i += 1;
    }
    out
}

fn hex_to_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_percent_encode_redirect_uri() {
        let encoded = percent_encode("varryal://auth/callback");
        assert_eq!(encoded, "varryal%3A%2F%2Fauth%2Fcallback");
    }

    #[test]
    fn test_parse_query_success() {
        let map = parse_query("token=abc123&state=xyz");
        assert_eq!(map.get("token").map(|s| s.as_str()), Some("abc123"));
        assert_eq!(map.get("state").map(|s| s.as_str()), Some("xyz"));
    }

    #[test]
    fn test_parse_query_error() {
        let map = parse_query("error=access_denied&state=xyz");
        assert_eq!(map.get("error").map(|s| s.as_str()), Some("access_denied"));
    }
}
