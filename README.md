# Varryal Launcher

Cross-platform native launcher for Varryal Minecraft server, built on Tauri (Rust) + React + GravitLauncher Java core.

## Architecture

```
Tauri shell (Rust)
  └─ Web UI (React + Vite + TypeScript)
  └─ WS client → Java sidecar (BridgeRuntimeProvider)
                   └─ LauncherBackendAPI (GravitLauncher 5.7.x)
```

- `apps/shell/` — Tauri/Rust shell: JRE provisioning, process spawn, WS proxy
- `apps/ui/` — React frontend: all scenes, IPC client, Zustand stores, i18n
- `bridge/` — Java Gradle module: `BridgeRuntimeProvider` (replaces JavaFX runtime)
- `docs/` — plan, architecture research, IPC protocol reference

## Building

### Prerequisites
- Java 21+ (for bridge build)
- Node 18+ + pnpm (for UI)
- Rust stable + cargo (for Tauri shell — not required for bridge/UI)

### Bridge (Java)
```
cd bridge && gradle build
```
Output: `bridge/build/libs/bridge-runtime-*.jar`

### UI (React)
```
cd apps/ui && pnpm install && pnpm build
```
Output: `apps/ui/dist/`

### Tauri shell (requires Rust/cargo)
```
cd apps/shell && pnpm tauri build
```

## License

GPL-3.0 — see [LICENSE](LICENSE).

The Tauri shell communicates with the GravitLauncher Java core (GPL-3.0) over a
localhost WebSocket at arm's length; both are released under GPL-3.0 making this
fully license-compatible.
