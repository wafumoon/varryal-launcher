//! Portal API commands — character list + session minting.
//!
//! These are thin HTTP wrappers over `https://varryal.ru/api`.
//! The account token (received from `web_auth_result`) is passed by the
//! frontend per-call; no Rust-side state is stored.
//!
//! Endpoints used:
//!   GET  /launcher/me/characters          → { items: [Character] }
//!   POST /launcher/me/characters/{id}/session → { minecraftAccessToken, uuid, username, ... }

use serde::Deserialize;
use serde_json::Value;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tauri::command;
use tracing::{info, warn};

const PORTAL_HOST: &str = "varryal.ru";
const PORTAL_API_BASE: &str = "https://varryal.ru/api";

struct DohEndpoint {
    host: &'static str,
    socket_addr: &'static str,
    url: &'static str,
}

const DOH_ENDPOINTS: [DohEndpoint; 2] = [
    DohEndpoint {
        host: "cloudflare-dns.com",
        socket_addr: "1.1.1.1:443",
        url: "https://cloudflare-dns.com/dns-query?name=varryal.ru&type=A",
    },
    DohEndpoint {
        host: "dns.google",
        socket_addr: "8.8.8.8:443",
        url: "https://dns.google/resolve?name=varryal.ru&type=A",
    },
];

// ── Tauri commands ────────────────────────────────────────────────────────────

/// List characters for the authenticated account.
///
/// Called by the frontend as `invoke('portal_list_characters', { accountToken })`.
/// Returns the parsed JSON value (the full response body, including `.items`).
#[command]
pub async fn portal_list_characters(account_token: String) -> Result<Value, String> {
    let url = format!("{PORTAL_API_BASE}/launcher/me/characters");
    info!("portal_list_characters: GET {url}");

    let client = build_client().await?;
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

    let client = build_client().await?;
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

/// Log in with email + password (credentials login).
///
/// Called by the frontend as `invoke('portal_login', { email, password })`.
/// On success returns the parsed JSON body, which includes `accountAccessToken`
/// (the account Bearer token for /launcher/me/*), `accountId`, `displayName`
/// and `accountAccessExpiresAt`.
///
/// On failure the portal's human-readable `message` (e.g. "Неверная почта или
/// пароль.") is surfaced verbatim so the UI can show it directly. Credentials
/// are never logged.
#[command]
pub async fn portal_login(email: String, password: String) -> Result<Value, String> {
    let url = format!("{PORTAL_API_BASE}/launcher/auth/login");
    info!("portal_login: POST {url}");

    let client = build_client().await?;
    let response = client
        .post(&url)
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        warn!("portal_login failed: HTTP {status}");
        // Prefer the portal's localized `message` field; fall back to the status.
        let msg = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| {
                v.get("message")
                    .and_then(|m| m.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(msg);
    }

    serde_json::from_str::<Value>(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

/// Fetch a Minecraft skin PNG and return it as a base64 `data:` URL.
///
/// The skin endpoint (`/api/skins/<uuid>.png`) answers with a 302 redirect and
/// no `Access-Control-Allow-Origin` header, so loading it cross-origin into a
/// WebGL texture (skinview3d) taints the canvas. Fetching here (reqwest follows
/// the redirect, no CORS) and handing back a same-origin data URL avoids that.
#[command]
pub async fn portal_fetch_skin(url: String) -> Result<String, String> {
    use base64::Engine as _;
    info!("portal_fetch_skin: GET {url}");
    let client = build_client().await?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read failed: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{content_type};base64,{b64}"))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct DohResponse {
    #[serde(rename = "Status")]
    status: u16,
    #[serde(rename = "Answer", default)]
    answers: Vec<DohAnswer>,
}

#[derive(Deserialize)]
struct DohAnswer {
    #[serde(rename = "type")]
    record_type: u16,
    data: String,
}

fn parse_doh_addresses(body: &str) -> Result<Vec<IpAddr>, String> {
    let response: DohResponse =
        serde_json::from_str(body).map_err(|error| format!("Invalid DoH response: {error}"))?;
    if response.status != 0 {
        return Err(format!("DoH returned DNS status {}", response.status));
    }

    let addresses: Vec<IpAddr> = response
        .answers
        .into_iter()
        .filter(|answer| answer.record_type == 1)
        .filter_map(|answer| match answer.data.parse::<IpAddr>() {
            Ok(IpAddr::V4(address)) => Some(IpAddr::V4(address)),
            _ => None,
        })
        .collect();
    if addresses.is_empty() {
        return Err("DoH response contains no IPv4 addresses".to_string());
    }
    Ok(addresses)
}

async fn resolve_portal_addresses() -> Result<Vec<IpAddr>, String> {
    let mut errors = Vec::new();
    for endpoint in &DOH_ENDPOINTS {
        let socket_addr = endpoint
            .socket_addr
            .parse::<SocketAddr>()
            .map_err(|error| format!("Invalid DoH endpoint address: {error}"))?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .resolve(endpoint.host, socket_addr)
            .build()
            .map_err(|error| format!("Failed to build DoH client: {error}"))?;

        let result = async {
            let response = client
                .get(endpoint.url)
                .header(reqwest::header::ACCEPT, "application/dns-json")
                .send()
                .await
                .map_err(|error| format!("request failed: {error}"))?;
            if !response.status().is_success() {
                return Err(format!("HTTP {}", response.status()));
            }
            let body = response
                .text()
                .await
                .map_err(|error| format!("response read failed: {error}"))?;
            parse_doh_addresses(&body)
        }
        .await;

        match result {
            Ok(addresses) => return Ok(addresses),
            Err(error) => errors.push(format!("{}: {error}", endpoint.host)),
        }
    }
    Err(errors.join("; "))
}

async fn build_client() -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30));

    match resolve_portal_addresses().await {
        Ok(addresses) => {
            let socket_addrs: Vec<SocketAddr> = addresses
                .into_iter()
                .map(|address| SocketAddr::new(address, 443))
                .collect();
            info!(
                "Portal DNS resolved over HTTPS ({} address(es))",
                socket_addrs.len()
            );
            builder = builder.resolve_to_addrs(PORTAL_HOST, &socket_addrs);
        }
        Err(error) => {
            warn!("Portal DoH resolution failed; falling back to system DNS: {error}");
        }
    }

    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

#[cfg(test)]
mod tests {
    use super::parse_doh_addresses;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn doh_parser_accepts_only_successful_ipv4_answers() {
        let body = r#"{
            "Status": 0,
            "Answer": [
                { "name": "varryal.ru", "type": 5, "data": "alias.example" },
                { "name": "varryal.ru", "type": 1, "data": "2001:db8::1" },
                { "name": "varryal.ru", "type": 1, "data": "178.130.53.26" }
            ]
        }"#;

        assert_eq!(
            parse_doh_addresses(body).unwrap(),
            vec![IpAddr::V4(Ipv4Addr::new(178, 130, 53, 26))]
        );
    }

    #[test]
    fn doh_parser_rejects_dns_errors_and_empty_a_answers() {
        assert!(parse_doh_addresses(r#"{ "Status": 2 }"#).is_err());
        assert!(parse_doh_addresses(r#"{ "Status": 0, "Answer": [] }"#).is_err());
    }
}
