//! Portal API commands — character list + session minting.
//!
//! These are thin HTTP wrappers over `https://varryal.ru/api`.
//! The account token (received from `web_auth_result`) is passed by the
//! frontend per-call; no Rust-side state is stored.
//!
//! Endpoints used:
//!   GET  /launcher/me/characters          → { items: [Character] }
//!   POST /launcher/me/characters/{id}/session → { minecraftAccessToken, uuid, username, ... }

use crate::dns_policy::{
    cache_is_fresh, fallback_sources, preferred_source, should_use_portal_resolver,
    ResolutionSource, TransportFailure,
};
use futures_util::stream::{FuturesUnordered, StreamExt};
use serde::Deserialize;
use serde_json::Value;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::command;
use tracing::{info, warn};

const PORTAL_HOST: &str = "varryal.ru";
const PORTAL_API_BASE: &str = "https://varryal.ru/api";

struct DohEndpoint {
    host: &'static str,
    socket_addr: &'static str,
    url: &'static str,
}

const SYSTEM_DNS_TIMEOUT: Duration = Duration::from_secs(2);
const DOH_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const DOH_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const DOH_CACHE_TTL: Duration = Duration::from_secs(300);

static DOH_ENDPOINTS: [DohEndpoint; 2] = [
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

#[derive(Clone)]
struct CachedDohAddresses {
    expires_at: Instant,
    addresses: Vec<SocketAddr>,
}

static DOH_CACHE: OnceLock<Mutex<Option<CachedDohAddresses>>> = OnceLock::new();

#[derive(Debug)]
struct PortalResolution {
    source: ResolutionSource,
    addresses: Vec<SocketAddr>,
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// List characters for the authenticated account.
///
/// Called by the frontend as `invoke('portal_list_characters', { accountToken })`.
/// Returns the parsed JSON value (the full response body, including `.items`).
#[command]
pub async fn portal_list_characters(account_token: String) -> Result<Value, String> {
    let url = format!("{PORTAL_API_BASE}/launcher/me/characters");
    info!("portal_list_characters: GET {url}");

    let request = reqwest::Client::new()
        .get(&url)
        .header("Authorization", format!("Bearer {account_token}"))
        .build()
        .map_err(|e| format!("Failed to build request: {e}"))?;
    let response = execute_portal_request(request).await?;

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

    let request = reqwest::Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {account_token}"))
        // The endpoint needs a Content-Type even with an empty body so some
        // server-side frameworks don't reject the request.
        .header("Content-Type", "application/json")
        .body("{}")
        .build()
        .map_err(|e| format!("Failed to build request: {e}"))?;
    let response = execute_portal_request(request).await?;

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

    let request = reqwest::Client::new()
        .post(&url)
        .json(&serde_json::json!({ "email": email, "password": password }))
        .build()
        .map_err(|e| format!("Failed to build request: {e}"))?;
    let response = execute_portal_request(request).await?;

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
    let request = reqwest::Client::new()
        .get(&url)
        .build()
        .map_err(|e| format!("Failed to build request: {e}"))?;
    let response = execute_portal_request(request).await?;
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

fn doh_cache() -> &'static Mutex<Option<CachedDohAddresses>> {
    DOH_CACHE.get_or_init(|| Mutex::new(None))
}

fn cached_doh_addresses() -> Option<Vec<SocketAddr>> {
    let mut cache = doh_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(cached) = cache.as_ref() else {
        return None;
    };
    if !cache_is_fresh(cached.expires_at, Instant::now()) {
        *cache = None;
        return None;
    }
    Some(cached.addresses.clone())
}

fn remember_doh_addresses(addresses: &[SocketAddr]) {
    let mut cache = doh_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cache = Some(CachedDohAddresses {
        expires_at: Instant::now() + DOH_CACHE_TTL,
        addresses: addresses.to_vec(),
    });
}

fn invalidate_doh_cache() {
    let mut cache = doh_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cache = None;
}

async fn resolve_system_addresses() -> Result<Vec<SocketAddr>, String> {
    let lookup = tokio::net::lookup_host((PORTAL_HOST, 443));
    let resolved = tokio::time::timeout(SYSTEM_DNS_TIMEOUT, lookup)
        .await
        .map_err(|_| {
            format!(
                "system DNS timed out after {} ms",
                SYSTEM_DNS_TIMEOUT.as_millis()
            )
        })?
        .map_err(|error| format!("system DNS failed: {error}"))?;

    let mut addresses: Vec<SocketAddr> = resolved.collect();
    addresses.sort_unstable();
    addresses.dedup();
    if addresses.is_empty() {
        return Err("system DNS returned no addresses".to_string());
    }
    Ok(addresses)
}

async fn query_doh_endpoint(endpoint: &'static DohEndpoint) -> Result<Vec<SocketAddr>, String> {
    let socket_addr = endpoint
        .socket_addr
        .parse::<SocketAddr>()
        .map_err(|error| format!("invalid endpoint address: {error}"))?;
    let client = reqwest::Client::builder()
        .connect_timeout(DOH_CONNECT_TIMEOUT)
        .timeout(DOH_REQUEST_TIMEOUT)
        .resolve(endpoint.host, socket_addr)
        .build()
        .map_err(|error| format!("client build failed: {error}"))?;
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
        .bytes()
        .await
        .map_err(|error| format!("response read failed: {error}"))?;
    if body.len() > 64 * 1024 {
        return Err("response exceeded 64 KiB".to_string());
    }
    let body =
        std::str::from_utf8(&body).map_err(|error| format!("response was not UTF-8: {error}"))?;
    let mut addresses: Vec<SocketAddr> = parse_doh_addresses(body)?
        .into_iter()
        .map(|address| SocketAddr::new(address, 443))
        .collect();
    addresses.sort_unstable();
    addresses.dedup();
    Ok(addresses)
}

async fn resolve_fresh_doh_addresses() -> Result<Vec<SocketAddr>, String> {
    let mut pending = FuturesUnordered::new();
    for endpoint in &DOH_ENDPOINTS {
        pending.push(async move { (endpoint.host, query_doh_endpoint(endpoint).await) });
    }

    let mut errors = Vec::new();
    while let Some((host, result)) = pending.next().await {
        match result {
            Ok(addresses) => {
                info!(
                    "Portal DNS resolved over HTTPS via {host} ({} address(es))",
                    addresses.len()
                );
                remember_doh_addresses(&addresses);
                return Ok(addresses);
            }
            Err(error) => errors.push(format!("{host}: {error}")),
        }
    }
    Err(errors.join("; "))
}

async fn resolution_for_source(source: ResolutionSource) -> Result<PortalResolution, String> {
    let addresses = match source {
        ResolutionSource::System => resolve_system_addresses().await?,
        ResolutionSource::DohCached => {
            cached_doh_addresses().ok_or_else(|| "cached DoH addresses expired".to_string())?
        }
        ResolutionSource::DohFresh => resolve_fresh_doh_addresses().await?,
    };
    Ok(PortalResolution { source, addresses })
}

async fn primary_portal_resolution() -> Result<PortalResolution, String> {
    if cached_doh_addresses().is_some() {
        return resolution_for_source(preferred_source(true, false)).await;
    }

    match resolve_system_addresses().await {
        Ok(addresses) => Ok(PortalResolution {
            source: preferred_source(false, true),
            addresses,
        }),
        Err(system_error) => {
            warn!("Portal system DNS unavailable; trying DNS-over-HTTPS: {system_error}");
            resolution_for_source(preferred_source(false, false))
                .await
                .map_err(|doh_error| format!("{system_error}; DNS-over-HTTPS failed: {doh_error}"))
        }
    }
}

fn build_client_for_resolution(resolution: &PortalResolution) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .resolve_to_addrs(PORTAL_HOST, &resolution.addresses)
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))
}

async fn execute_portal_request(request: reqwest::Request) -> Result<reqwest::Response, String> {
    if !should_use_portal_resolver(request.url().host_str(), PORTAL_HOST) {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| format!("Failed to build HTTP client: {error}"))?;
        return client
            .execute(request)
            .await
            .map_err(|error| format!("Request failed: {error}"));
    }

    let retry_template = request
        .try_clone()
        .ok_or_else(|| "Portal request body cannot be retried safely".to_string())?;
    let primary = primary_portal_resolution()
        .await
        .map_err(|error| format!("Request failed: {error}"))?;
    info!("Portal request DNS source: {:?}", primary.source);
    let primary_client = build_client_for_resolution(&primary)?;

    let first_error = match primary_client.execute(request).await {
        Ok(response) => return Ok(response),
        Err(error) => error,
    };
    let failure = if first_error.is_connect() {
        TransportFailure::Connect
    } else {
        TransportFailure::Other
    };
    let fallbacks = fallback_sources(primary.source, failure);
    if fallbacks.iter().all(Option::is_none) {
        return Err(format!("Request failed: {first_error}"));
    }

    if primary.source == ResolutionSource::DohCached {
        invalidate_doh_cache();
    }
    let mut errors = vec![format!("{:?}: {first_error}", primary.source)];
    for source in fallbacks.into_iter().flatten() {
        let resolution = match resolution_for_source(source).await {
            Ok(resolution) => resolution,
            Err(error) => {
                errors.push(format!("{source:?} resolution: {error}"));
                continue;
            }
        };
        warn!(
            "Portal connect failed via {:?}; retrying via {:?}",
            primary.source, resolution.source
        );
        let client = build_client_for_resolution(&resolution)?;
        let retry = retry_template
            .try_clone()
            .ok_or_else(|| "Portal request body cannot be retried safely".to_string())?;
        match client.execute(retry).await {
            Ok(response) => return Ok(response),
            Err(error) if error.is_connect() => {
                errors.push(format!("{:?}: {error}", resolution.source));
            }
            Err(error) => return Err(format!("Request failed: {error}")),
        }
    }

    Err(format!(
        "Request failed after DNS resolver fallback: {}",
        errors.join("; ")
    ))
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
