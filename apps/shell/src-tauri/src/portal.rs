//! Portal API commands — character list + session minting.
//!
//! These are thin HTTP wrappers over `https://varryal.ru/api`.
//! The account token (received from `web_auth_result`) is passed by the
//! frontend per-call; no Rust-side state is stored.
//!
//! Endpoints used:
//!   GET  /launcher/me/characters          → { items: [Character] }
//!   POST /launcher/me/characters/{id}/session → { minecraftAccessToken, uuid, username, ... }

use serde_json::Value;
use tauri::command;
use tracing::{info, warn};

const PORTAL_API_BASE: &str = "https://varryal.ru/api";

// ── Tauri commands ────────────────────────────────────────────────────────────

/// List characters for the authenticated account.
///
/// Called by the frontend as `invoke('portal_list_characters', { accountToken })`.
/// Returns the parsed JSON value (the full response body, including `.items`).
#[command]
pub async fn portal_list_characters(account_token: String) -> Result<Value, String> {
    let url = format!("{PORTAL_API_BASE}/launcher/me/characters");
    info!("portal_list_characters: GET {url}");

    let client = build_client()?;
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {account_token}"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        warn!("portal_list_characters: HTTP {status} — {body}");
        return Err(format!("HTTP {status}: {body}"));
    }

    response
        .json::<Value>()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))
}

/// Mint a per-character Minecraft access token.
///
/// Called by the frontend as
/// `invoke('portal_create_session', { accountToken, characterId })`.
/// Returns the parsed JSON value (includes `minecraftAccessToken`, `uuid`,
/// `username`, `skinUrl`, …).
#[command]
pub async fn portal_create_session(
    account_token: String,
    character_id: String,
) -> Result<Value, String> {
    let url = format!("{PORTAL_API_BASE}/launcher/me/characters/{character_id}/session");
    info!("portal_create_session: POST {url}");

    let client = build_client()?;
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {account_token}"))
        // The endpoint needs a Content-Type even with an empty body so some
        // server-side frameworks don't reject the request.
        .header("Content-Type", "application/json")
        .body("{}")
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        warn!("portal_create_session: HTTP {status} — {body}");
        return Err(format!("HTTP {status}: {body}"));
    }

    response
        .json::<Value>()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}
