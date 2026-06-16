# Varryal Launcher — Blockers

_Last updated: 2026-06-16 (production-readiness pass)_

---

## BLOCKER-1: ~~Rust/cargo not installed~~ RESOLVED

**Status:** RESOLVED (2026-06-16, Pass 3)

**Detail:** Rust stable 1.96.0 (x86_64-pc-windows-gnu) installed via rustup.
MSYS2 + mingw-w64 gcc 16.1.0 installed as the C linker (no MSVC Build Tools needed).
`apps/shell/src-tauri/.cargo/config.toml` points to `C:\msys64\mingw64\bin\gcc.exe`.

**Gate D status:** `cargo check` exits 0 with no warnings on both
`--target x86_64-pc-windows-gnu` and the default gnu toolchain.
`#![deny(warnings)]` is active in `main.rs`.

All source fixes made in Pass 3:
- Added `src/lib.rs` (Tauri 2 desktop lib entry)
- Added `anyhow = "1"` to `Cargo.toml` (was missing despite being used everywhere)
- Added `icons/` directory with placeholder `.ico` and PNG files (required by tauri-build)
- Fixed `ipc_proxy.rs`: restored `PathBuf` import, switched `tauri::Manager` → `tauri::Emitter`, removed unused `debug` import
- Removed unused `download_file` wrapper from `jre.rs`
- Fixed unused `token` variable in `IpcProxy::run()` → `_token`
- Added `#[allow(dead_code)]` on `protocol_version` field and `IpcRequestPayload` struct

**Note for `tauri build`:** Still requires cargo on the build machine and the
`x86_64-pc-windows-msvc` toolchain + MSVC linker for official Windows releases.
The gnu toolchain works for `cargo check` / `cargo test` but Tauri's bundler
(`tauri build`) on Windows officially targets MSVC. CI uses `windows-latest`
which has MSVC pre-installed.

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

---

## BLOCKER-5: MSVC Build Tools not installable locally (no elevation)

**Status:** KNOWN / LOCAL-ONLY LIMITATION

**Detail:** `cargo check` with the MSVC toolchain (`stable-x86_64-pc-windows-msvc`)
requires `link.exe` (MSVC linker) and Windows SDK import libs (`kernel32.lib`, etc.).
Installing VS Build Tools 2022 requires administrator elevation, which is not available
in this environment. The per-user `--installPath` flag also triggers UAC (exit 1602).
`lld-link` from MSYS2 (a drop-in MSVC-flavour linker) was tried but also fails without
the Windows SDK `.lib` stubs.

**Local workaround:** Use the GNU toolchain (`stable-x86_64-pc-windows-gnu`) with gcc
from MSYS2 for local `cargo check`. This is fully equivalent for type-checking — all
Rust errors/warnings are identical regardless of toolchain. Gate D is green with GNU.

**CI:** `windows-latest` runners have VS Build Tools + Windows SDK pre-installed.
The `shell-check` CI job explicitly uses `stable-x86_64-pc-windows-msvc` so the MSVC
toolchain is verified in CI on every push/PR. No local action needed.

**Resolution path (optional):** Ask an admin to run:
  `vs_buildtools.exe --quiet --wait --add Microsoft.VisualStudio.Workload.VCTools`
or install `winget install Microsoft.VisualStudio.2022.BuildTools` with elevation.
