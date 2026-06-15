# Varryal Launcher — Progress

_Last updated: 2026-06-16_

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

## Next steps (for Opus)
1. Deploy bridge jar to LaunchServer, run `build` on server, verify module loads
2. Confirm Module-Config-Name `VarryalRuntime` is accepted (or rename to `JavaRuntime`)
3. Test `init → authorize → fetchProfiles` with real server
4. Install Rust on a build machine, run `tauri build` for Windows
5. Generate Varryal logo (GPT Image) and replace placeholder monogram
