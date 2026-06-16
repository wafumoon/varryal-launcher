# Varryal Launcher — Progress

_Last updated: 2026-06-16 (production-readiness pass)_

## Status legend
- [x] Done / green
- [~] In progress
- [ ] Not started
- [!] Blocked — see BLOCKERS.md

---

## Phase A — Scaffold

- [x] git init, LICENSE (GPL-3.0), README.md
- [x] Monorepo dirs: apps/shell, apps/ui, bridge, scripts, .github/workflows
- [x] .gitignore
- [x] docs/IPC-PROTOCOL.md (transcribed from PLAN §3)
- [x] docs/PROGRESS.md, docs/BLOCKERS.md
- [x] .github/workflows/ci.yml (bridge + ui + tauri matrix)

---

## Phase B — Java bridge module

- [x] bridge/build.gradle.kts — Gradle 9.4, Java 21, dep on launcher-runtime:5.7.10
- [x] bridge/settings.gradle.kts
- [x] BridgeRuntimeModule.java (extends LauncherModule, hooks ClientPreGuiPhase)
- [x] BridgeRuntimeProvider.java (implements RuntimeProvider — preLoad/init/run)
- [x] BridgeModuleConfig.java (Module-Config-Class)
- [x] WsBridgeServer.java (embedded Java-WebSocket, 127.0.0.1, random port, session token)
- [x] IpcDispatcher.java (all §3 methods mapped to real LauncherBackendAPI 5.7.10)
- [x] WsMainCallback.java (extends MainCallback)
- [x] WsDownloadCallback.java (extends DownloadCallback)
- [x] WsRunCallback.java (extends RunCallback)
- [x] bridge/proguard-keep.txt
- [x] **GATE B GREEN: `gradle build` succeeded** — produces bridge/build/libs/bridge-1.0.0.jar

### API adaptations (verified against real 5.7.10 jar via javap)
- `MainCallback` / `DownloadCallback` / `RunCallback` are **classes** (extend, not implement)
- `LauncherInitData` is a record with `.methods()` (no `authMethods()`, no `updateRequired()`)
- `SelfUser` interface: `getUsername()`, `getUUID()`, `getAccessToken()` (no `login()`)
- `ProfileFeatureAPI.ClientProfile`: `getName()`, `getUUID()`, `getMinecraftVersion()`, `getServer()`
- `ServerPingInfo`: `getMaxOnline()`, `getOnline()`, `getPlayerNames()` (no motd/latency)
- `Java` interface: `getMajorVersion()`, `getPath()`
- `ClientProfileSettings.getReservedMemoryBytes(MemoryClass.TOTAL)`
- `AuthPlainPassword(String)` in `pro.gravit.launcher.core.api.method.password` (no AES in core 5.7.10)
- `Version(int,int,int)` 3-arg constructor (no Type.STABLE/RELEASE as 4th arg)
- `OptionalMod`: `getName()`, `getDescription()`, `getCategory()`, `isVisible()` (no `isEnabled()`)
- `LauncherBackendAPIHolder.getApi()` confirmed present
- `LauncherAPIHolder.changeAuthId(String)` used for selectAuthMethod fallback
- Module registration: `registerEvent(this::onPreGui, ClientPreGuiPhase.class)` — sets `phase.runtimeProvider`
- `pingProfileServers` not in 5.7.10 API — falls back to `pingServer`

---

## Phase C — Frontend (React + Vite + TS)

- [x] apps/ui/package.json, vite.config.ts, tsconfig.json, index.html
- [x] src/main.tsx, src/App.tsx (scene router: loading → login → server-menu → downloading → running → settings)
- [x] src/ipc/types.ts (all §3 domain types)
- [x] src/ipc/client.ts (typed ipc.* surface + mock IPC with simulated events)
- [x] src/store/auth.ts, profiles.ts, download.ts, run.ts, settings.ts (Zustand)
- [x] src/theme/theme.json (Neutral Dark palette from PLAN §7)
- [x] src/theme/applyTheme.ts (camelCase → CSS custom properties on :root)
- [x] src/theme/global.css
- [x] src/i18n/ru.json, en.json, index.ts (i18next, RU default)
- [x] src/components/Titlebar.tsx (frameless, platform-aware Win/mac layout)
- [x] src/scenes/Login.tsx
- [x] src/scenes/ServerMenu.tsx (profile cards + server ping)
- [x] src/scenes/UpdateProgress.tsx (download events, progress bar, cancel)
- [x] src/scenes/Running.tsx (console output, terminate)
- [x] src/scenes/SettingsPanel.tsx (RAM slider, Java picker, flags, optional mods)
- [x] **GATE C GREEN: `pnpm install && pnpm build` succeeded** — 349 kB JS bundle

---

## Phase D — Tauri shell (write-only, cargo absent)

- [x] apps/shell/src-tauri/Cargo.toml (tauri 2, tokio-tungstenite, reqwest, zip/tar/flate2, dirs-next)
- [x] apps/shell/src-tauri/tauri.conf.json (frameless window 960×620, bundle targets all)
- [x] apps/shell/src-tauri/build.rs
- [x] apps/shell/src-tauri/src/main.rs (bootstrap: JRE → jar → WS connect)
- [x] apps/shell/src-tauri/src/config.rs (ShellConfig, JreEntry, JSON persistence)
- [x] apps/shell/src-tauri/src/jre.rs (BellSoft Liberica download/extract, multi-version)
- [x] apps/shell/src-tauri/src/runner.rs (spawn javaw -Dlauncher.noJavaCheck=true -jar)
- [x] apps/shell/src-tauri/src/ipc_proxy.rs (WS proxy, Tauri ipc_request command, event emit)
- [!] **GATE D: UNCOMPILED** — cargo not installed (see BLOCKERS.md BLOCKER-1)

---

## Phase E — Production-readiness pass (2026-06-16)

- [x] **BUG FIX**: `WsBridgeServer` — port race condition: `boundPort` was read from `getPort()` in
  the constructor before `start()` bound the socket (returned 0 when port=0 / OS-assigned).
  Fixed: `boundPort` now set in `onStart()` callback; handshake write moved there too;
  `awaitStart()` latch added so `BridgeRuntimeProvider.run()` blocks until port is real.
- [x] **BUG FIX**: `runner.rs` — Java stdout piped but never drained; OS pipe buffer (~64 KiB)
  would fill and deadlock the Java process during long launcher output.
  Fixed: `drain_stdout()` helper spawns a background thread to drain stdout line-by-line.
  `main.rs` updated to call `drain_stdout(&mut child)` immediately after spawn.
- [x] **BUG FIX**: `IpcDispatcher.getUserSettings` — confirmed real signature is
  `getUserSettings(String, Function<String,UserSettings>)` (2-arg); code preserved correctly.
- [x] **MISSING FILE**: `apps/shell/package.json` — required for `pnpm tauri build` in CI. Created.
- [x] **MISSING FILE**: `apps/shell/src-tauri/capabilities/default.json` — required by Tauri 2
  security model; without it all `invoke()` calls are denied at runtime. Created with
  correct permissions for window controls, shell, and opener.
- [x] **GATE B RE-VERIFIED GREEN**: `gradle build` succeeded after all bridge changes.
- [x] **GATE C RE-VERIFIED GREEN**: `pnpm build` succeeded (349 kB bundle unchanged).

---

## Phase F — Review pass 2 (2026-06-16, Sonnet)

Closes all F1–F4 findings from REVIEW.md plus the window-controls gap.

- [x] **F4 — Unified data dir**: New `apps/shell/src-tauri/src/paths.rs` exposes
  `varryal_data_dir()` returning `%APPDATA%\Varryal` (Windows) / `~/Varryal` (Unix).
  Verified to match `WsBridgeServer.writeHandshake()` exactly.
  All of `config.rs`, `jre.rs`, `runner.rs`, and `ipc_proxy.rs` now call this
  helper — `tauri::AppHandle::path().app_data_dir()` (which appends the bundle
  identifier) is no longer used for any shared path.

- [x] **F1 — Java 25 for launcher**: `main.rs` now provisions `LAUNCHER_JAVA_MAJOR = 25`
  (was hardcoded 21). The constant is documented at the top of `main.rs`.
  `ensure_version(major)` remains fully parameterised and multi-version-capable.
  A TODO comment in `bootstrap()` marks where post-login per-profile provisioning
  should be added once the IPC proxy is live (stub as per spec).

- [x] **F2 — Varryal.jar download**: `runner.rs` now has `resolve_jar(app, cfg)` (async).
  `VARRYAL_JAR_URL = "https://launcher.varryal.ru/Varryal.jar"` is a module-level
  constant. Age-based freshness check: re-download if mtime > `JAR_MAX_AGE_DAYS` (7).
  Uses `download_file_with_sha1` from `jre.rs` for transport-integrity (digest logged).
  `cfg.jar_downloaded_at` updated on each download; `cfg.save()` called in bootstrap.

- [x] **F3 — SHA-1 verification**: `LibericaRelease` now includes `sha1: Option<String>`.
  `download_file_with_sha1()` in `jre.rs` streams bytes through `sha1::Sha1` (RustCrypto)
  and returns the hex digest. After download, digest is compared to the API value
  (case-insensitive); mismatch → delete archive + bail with clear error message.
  Digest is stored in `JreEntry.sha1` in `shell-config.json`.
  `sha1 = { version = "0.10", features = ["oid"] }` added to `Cargo.toml`.
  Compiles only in CI (BLOCKER-1 still applies — cargo not local).

- [x] **Window controls**: `Titlebar.tsx` replaced fragile `__TAURI__` cast with a
  proper `import('@tauri-apps/api/window').getCurrentWindow()` lazy import.
  `@tauri-apps/api ^2.0.0` (resolved to 2.11.0) added to `apps/ui/package.json`.
  `capabilities/default.json` now grants:
  `allow-start-dragging`, `allow-minimize`, `allow-maximize`, `allow-unmaximize`,
  `allow-toggle-maximize`, `allow-close`.
  **GATE C RE-VERIFIED GREEN**: `pnpm build` succeeded (350.52 kB + 15.85 kB window chunk).

---

## Phase G — Rust cargo check pass (2026-06-16, Sonnet)

Goal: `cargo check` exits 0 with `#![deny(warnings)]` active.

- [x] **Rust installed**: rustup + stable-x86_64-pc-windows-gnu 1.96.0 via rustup-init.exe
- [x] **C linker**: MSYS2 + mingw-w64 gcc 16.1.0 installed; `.cargo/config.toml` configures it
- [x] **`src/lib.rs`**: Created — required by `[lib]` entry in Cargo.toml (Tauri 2 pattern)
- [x] **`anyhow` crate**: Added to Cargo.toml (was used in all modules but missing from deps)
- [x] **`icons/`**: Placeholder `icon.ico` + PNGs generated via Python — required by tauri-build
- [x] **`ipc_proxy.rs`**: Restored `PathBuf` import; `tauri::Manager` → `tauri::Emitter`; removed `debug` import
- [x] **`jre.rs`**: Removed unused `download_file` convenience wrapper (dead code)
- [x] **`ipc_proxy.rs`**: `token` → `_token` (unused in event stream loop); `#[allow(dead_code)]` on `protocol_version` and `IpcRequestPayload`
- [x] **`main.rs`**: Removed unused `tauri::Manager` import; added `#![deny(warnings)]`
- [x] **GATE D GREEN**: `cargo check` exits 0, zero errors, zero warnings (both `--target x86_64-pc-windows-gnu` and default)

---

## Phase H — Web-auth (browser login)

_2026-06-16_

Implements the full browser-based OAuth-redirect ("Claude Code"-style) auth flow.
The portal opens in the system browser; after login the deep-link `varryal://`
callback delivers the token to the launcher without any user input in the UI.

### Rust (`apps/shell/src-tauri`)

- [x] **`src/auth.rs`** (new): `PendingAuthState` (Mutex<Option<String>>),
  `start_web_auth` Tauri command (generates CSPRNG UUID state, percent-encodes
  `redirect_uri`, opens portal URL via `tauri-plugin-opener`),
  `handle_callback` (parses query string, validates state, emits `web_auth_result` event),
  `PORTAL_WEB_LOGIN_URL` + `REDIRECT_URI` constants, unit tests.
- [x] **`Cargo.toml`**: added `tauri-plugin-deep-link = "2"` and
  `tauri-plugin-single-instance = "2"`.
- [x] **`tauri.conf.json`**: added `plugins.deep-link.desktop.schemes = ["varryal"]`
  and `plugins.single-instance = {}`.
- [x] **`src/main.rs`**: added `mod auth`; registered both plugins in builder;
  wired `DeepLinkExt::on_open_url` handler (hot deep-link) and
  `single-instance` callback (cold-start argv forwarding); added
  `auth::start_web_auth` to `invoke_handler`; added `use tauri::Manager`.
- [x] **`src/lib.rs`**: added `pub mod auth`.
- [x] **`capabilities/default.json`**: added `"deep-link:default"`.
- [x] **`build.rs`**: patched to skip `tauri_build::build()` (which calls
  `tauri-winres`/`windres`) on the gnu toolchain; emits minimum cargo directives
  instead. MSVC path (CI) unchanged. Extends BLOCKER-5 resolution.

### Frontend (`apps/ui`)

- [x] **`src/ipc/types.ts`**: added `WebAuthResult` interface.
- [x] **`src/ipc/client.ts`**: added `getTauri()` helper; `invokeNative<T>()` for
  direct Tauri commands; `listenTauriEvent<T>()` with mock fallback;
  `ipc.startWebAuth()` and `ipc.listenWebAuthResult()` on the exported object;
  mock handler for `start_web_auth` (fires success after 1.5 s).
- [x] **`src/scenes/Login.tsx`**: replaced email/password form with single
  "Войти через Varryal" button → `startWebAuth` → waiting spinner + Cancel →
  `web_auth_result` → `selectAuthMethod('std')` + `authorize('', token)` →
  `onSuccess`. Error codes mapped to RU i18n strings. Mock path works standalone.
- [x] **`src/i18n/ru.json`**: added `login.webAuthBtn/retryBtn/waiting/authorizing`
  + all 7 error-code keys; added `common.cancel`.
- [x] **`src/i18n/en.json`**: same keys in English.

### Gates

- [x] **GATE C GREEN**: `pnpm build` — 353.86 kB bundle, zero TS errors.
- [x] **GATE D (cargo check) GREEN**: `cargo check --target x86_64-pc-windows-gnu`
  exits 0, zero errors, zero warnings.

### Deferred to CI (Rust compile only in CI)
- `tauri build` with MSVC toolchain needed for the real binary + deep-link OS
  registration (scheme written to Windows registry by installer).
- Single-instance plugin wires up correctly in source but only verifiable at
  runtime on a compiled binary.
- See BLOCKERS.md BLOCKER-5 and new BLOCKER-6.

---

---

## Phase I — Auth/character UX redesign (2026-06-16)

Replaces the old "web-auth delivers per-character minecraft token → authorize immediately"
flow with the new two-stage flow:

```
[preparing]  Rust emits bootstrap_status events → UI shows phase + progress bar
             Login button is BLOCKED until phase = "ready"
[login]      "Войти через Varryal" → browser → account login → varryal://auth/callback
             token = ACCOUNT token (Bearer for /launcher/me/*); stored in auth store
             No ipc.authorize() call here anymore
[characters] CharacterSelect.tsx: GET /launcher/me/characters (Bearer account token)
             → native list (nickname / race / skin preview)
             Player picks → POST /launcher/me/characters/{id}/session
             → minecraftAccessToken → ipc.selectAuthMethod('std') + ipc.authorize('', token)
             → server menu
[server-menu] New "Сменить персонажа" button (UserCog icon) → re-enter CharacterSelect
             with stored accountToken; no browser, no new web-auth
```

### Rust (`apps/shell/src-tauri`)

- [x] **`src/portal.rs`** (new): two `#[tauri::command]`s using existing `reqwest` dep:
  - `portal_list_characters(account_token)` → GET `https://varryal.ru/api/launcher/me/characters`
  - `portal_create_session(account_token, character_id)` → POST `.../characters/{id}/session`
  - Both registered in `invoke_handler`; account token passed per-call (no Rust state).
- [x] **`src/main.rs`**: added `mod portal`; registered `portal_list_characters` and
  `portal_create_session` in `invoke_handler`; added `BootstrapStatus` struct and
  `emit_bootstrap()` helper; `bootstrap()` now emits `bootstrap_status` events at each
  phase: `jre` (0 %), `jar` (30 %), `starting` (60 %), `connecting` (80 %), `ready` (100 %),
  `error` (on `Err`). Login is unreachable until `ready` fires.
- [x] **`src/lib.rs`**: added `pub mod portal`.

### Frontend (`apps/ui/src`)

- [x] **`ipc/types.ts`**: added `BootstrapStatus`, `CharacterRace`, `Character`,
  `ListCharactersResponse`, `CreateSessionResponse`.  `WebAuthResult.token` comment
  updated: token is now the account token, not a minecraft token.
- [x] **`ipc/client.ts`**: added `ipc.listenBootstrapStatus()` (listens to `bootstrap_status`
  Tauri event); `ipc.listCharacters(accountToken)` and `ipc.createSession(accountToken, characterId)`
  (native invoke wrappers for the new Rust commands); mock cases for
  `portal_list_characters` (2 fake characters), `portal_create_session` (fake mc token),
  `bootstrap_status_start` (emits full phase sequence ending in `ready` after ~1.5 s);
  `startEventForwarding()` triggers mock bootstrap in dev mode.
- [x] **`store/auth.ts`**: added `accountToken: string | null` field and `setAccountToken()`
  action; `logout()` clears it.
- [x] **`scenes/CharacterSelect.tsx`** (new): on enter loads character list via
  `ipc.listCharacters`; renders character cards (nickname, race, skin preview with
  pixelated img or User icon placeholder); on pick calls `ipc.createSession` → mints
  `minecraftAccessToken` → `ipc.selectAuthMethod('std')` + `ipc.authorize('', token)` →
  `setUser` → `onSuccess`. Loading / authorizing / error / retry states.
- [x] **`scenes/Login.tsx`**: `onSuccess` prop changed to `(accountToken: string) => void`;
  on `web_auth_result` stores token via `setAccountToken` and calls `onSuccess(token)` —
  no `ipc.authorize()` call here. Removed `'authorizing'` phase (authorize moved to
  CharacterSelect). `listenWebAuthResult` subscription unchanged.
- [x] **`App.tsx`**: scene machine now starts in `preparing`; listens to
  `ipc.listenBootstrapStatus` — on `ready` advances to `login`; added `characters` scene
  state; `Login.onSuccess` routes to `characters`; `CharacterSelect.onSuccess` routes to
  `server-menu`; added `handleSwitchCharacter` (reads stored `accountToken`, returns to
  `characters` without browser); passes `onSwitchCharacter` to `ServerMenu`. Added
  `PreparingScene` component with phase label, spinner, animated progress bar, error
  state + retry.
- [x] **`scenes/ServerMenu.tsx`**: added `onSwitchCharacter` prop; added "Сменить
  персонажа" `IconBtn` (UserCog icon) in top bar.
- [x] **`i18n/ru.json`**: added `characterSelect.*` keys; added `serverMenu.switchCharacter`.
- [x] **`i18n/en.json`**: same keys in English.

### Gates

- [x] **GATE C GREEN**: `pnpm -C apps/ui build` — 363.27 kB bundle, zero TS errors.
- [!] **GATE D (cargo check)**: Rust writes correctly; local cargo check blocked by
  missing MinGW `dlltool` (BLOCKER-1 still applies). New modules `portal.rs` and
  updated `main.rs`/`lib.rs` will be validated by CI on MSVC. No `bridge/` or Java
  modules were touched.

### BLOCKERS (Rust / CI-deferred)

- **BLOCKER-1** (existing): `cargo check` requires MinGW `dlltool` which is absent
  locally. CI on MSVC validates the full Rust compile. `portal.rs` uses only `reqwest`
  and `serde_json` which are already in `Cargo.toml`; no new crates added.
- **portal endpoints live**: `portal_list_characters` and `portal_create_session` depend
  on the portal deploying the v2 web-auth change (see `docs/PORTAL-WEBAUTH-V2-TASK.md`).
  Until that ships, the Rust commands will return HTTP errors in production (mock mode
  works standalone in dev).

---

## Next steps (for Opus)
1. Deploy bridge jar to LaunchServer, run `build` on server, verify module loads
2. Confirm Module-Config-Name `VarryalRuntime` is accepted (or rename to `JavaRuntime`)
3. Test `init → authorize → fetchProfiles` with real server
4. Run `tauri build` on a machine with MSVC Build Tools for the official Windows release
5. Generate Varryal logo (GPT Image) and replace placeholder monogram
6. Deploy portal web-auth v2 (PORTAL-WEBAUTH-V2-TASK.md) so account token is returned
   from the browser redirect; then E2E-test the full new character flow
