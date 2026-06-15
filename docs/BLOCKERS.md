# Varryal Launcher — Blockers

_Last updated: 2026-06-16_

---

## BLOCKER-1: Rust/cargo not installed — Tauri shell uncompiled

**Status:** KNOWN / EXPECTED

**Detail:** `cargo` is not installed in this environment. The Tauri shell source files
(`apps/shell/src-tauri/`) have been written in full but cannot be compiled locally.
Compilation must happen in a CI environment (GitHub Actions `windows-latest` with
Rust stable) or on a machine with cargo installed.

**Impact:** Phase D (Tauri shell) is source-only. Phases B (Java bridge) and C (React UI)
are fully buildable and their gates can be verified locally.

**Resolution:** Install Rust via `rustup` on any build machine, then `cd apps/shell && pnpm tauri build`.
CI workflow `.github/workflows/ci.yml` handles this automatically.

---

## BLOCKER-2: Maven artifact resolution — needs network

**Status:** EXPECTED / FIRST-BUILD CHECK

**Detail:** `bridge/build.gradle.kts` depends on
`com.gravitlauncher.launcher:launcher-runtime:5.7.10` from `https://maven.gravitlauncher.com`.
First `gradle build` will attempt to download this. If the repo is unreachable or the
artifact version differs, the build will fail with a resolution error.

**Mitigation:** The build also has `mavenLocal()` as fallback; manually installing the jar
to local Maven cache (`mvn install:install-file`) unblocks the build offline.

**Verification needed:** Once Maven resolves, confirm exact class/method names in the
5.7.10 jar match what is used in `IpcDispatcher.java` (`LauncherBackendAPIHolder`,
`LauncherBackendAPI` methods). If names differ, adapt and note here.

---

## BLOCKER-3: Module name / inject keys — requires LaunchServer-side config

**Status:** OPEN QUESTION (from PLAN §1.1 item 5)

**Detail:** The current bridge module uses `Module-Config-Name = VarryalRuntime`.
The LaunchServer build pipeline may inject config via `@LauncherInject("modules.javaruntime.*")`
keys keyed to the `JavaRuntime` module name. If it does, either:
- Rename our config name to `JavaRuntime` (drop-in), OR
- Add `@LauncherInject("modules.varryalruntime.*")` keys to `LaunchServer.json`

**Resolution:** Confirmed by Opus when deploying bridge module to live LaunchServer.

---

## BLOCKER-4: guard-relaunch wrappedLaunch timing

**Status:** DESIGN RISK (from PLAN §4)

**Detail:** `ClientLauncherWrapper` re-spawns itself in a child JVM. The WS server must
start in the wrapped (final) JVM. Bridge checks `System.getProperty("launcher.wrappedLaunch")`
and only starts WS when `"true"`. Rust must wait for `ipc-handshake.json` with retries
(up to 30s, 500ms interval). If `noJavaCheck` flag suppresses the relaunch, this check
is unnecessary — to be confirmed during Phase 2 integration testing.
