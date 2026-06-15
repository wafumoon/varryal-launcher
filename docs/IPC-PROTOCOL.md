# Varryal Launcher — IPC Protocol Reference

> Transcribed from PLAN.md §3. This is the **shared contract** followed by the Java bridge,
> the Rust proxy, and the TypeScript client. All three sides must stay in sync with this document.

Protocol version: **1**

---

## Transport

- WebSocket `ws://127.0.0.1:<port>`
- Port: random high port chosen by the Java bridge at startup
- Authentication: every message (request and event) carries `"token": "<session-token>"`
- Handshake file: `${data_dir}/Varryal/ipc-handshake.json`
  ```json
  { "port": 53187, "token": "b3f1...", "pid": 12345, "protocolVersion": 1 }
  ```
- Stdout signal (alternative discovery): `VARRYAL_IPC port=<N> token=<T>`

---

## Message envelopes

### Request (UI → Java)
```json
{
  "id": "<uuid-v4>",
  "type": "request",
  "method": "<name>",
  "token": "<session-token>",
  "params": {}
}
```

### Response (Java → UI)
```json
{ "id": "<uuid-v4>", "type": "response", "ok": true, "result": {} }
{ "id": "<uuid-v4>", "type": "response", "ok": false, "error": { "code": "...", "message": "..." } }
```

### Event (Java → UI, server-push)
```json
{ "type": "event", "channel": "main|download|run", "name": "<callbackName>", "data": {}, "token": "<session-token>" }
```

---

## Methods

| method | params | result | Core mapping |
|---|---|---|---|
| `init` | — | `{ authMethods: AuthMethod[], updateRequired: boolean }` | `api.init()` → `LauncherInitData` |
| `selectAuthMethod` | `{ method: string }` | `{}` | `api.selectAuthMethod(method)` |
| `tryAuthorize` | — | `{ user: SelfUser \| null }` | `api.tryAuthorize()` |
| `authorize` | `{ login: string, password: string }` | `{ user: SelfUser }` | `api.authorize(login, AuthMethodPassword)` |
| `userExit` | — | `{}` | `api.userExit()` |
| `fetchProfiles` | — | `{ profiles: ClientProfile[] }` | `api.fetchProfiles()` |
| `makeClientProfileSettings` | `{ profileUuid: string }` | `{ settings: ClientProfileSettings }` | `api.makeClientProfileSettings(profile)` |
| `saveClientProfileSettings` | `{ settings: ClientProfileSettings }` | `{}` | `api.saveClientProfileSettings(settings)` |
| `downloadProfile` | `{ profileUuid: string, settings: ClientProfileSettings }` | `{ readyProfileId: string }` | `api.downloadProfile(...)` — events on `download` channel |
| `runProfile` | `{ readyProfileId: string }` | `{}` | `readyProfile.run(RunCallback)` — events on `run` channel |
| `cancelDownload` | `{ readyProfileId: string }` | `{}` | cancel Runnable from `DownloadCallback.onCanCancel` |
| `terminateGame` | `{ readyProfileId: string }` | `{}` | terminate Runnable from `RunCallback.onCanTerminate` |
| `getAvailableJava` | — | `{ java: JavaVersion[] }` | `api.getAvailableJava()` |
| `pingServer` | `{ profileUuid: string }` | `{ ping: ServerPingInfo }` | `api.pingServer(profile)` |
| `pingProfileServers` | `{ profileUuid: string }` | `{ ping: ServerPingInfo }` | `api.pingProfileServers(profile)` |
| `getUserSettings` | `{ name: string }` | `{ settings: object }` | `api.getUserSettings(name, ...)` |
| `getSelfUser` | — | `{ user: SelfUser, permissions: string[], username: string }` | `api.getSelfUser()` / `getPermissions()` / `getUsername()` |
| `isTestMode` | — | `{ testMode: boolean }` | `api.isTestMode()` |
| `shutdown` | — | `{}` | `api.shutdown()` |

---

## Events — channel: `"main"` (from MainCallback)

| name | data |
|---|---|
| `onChangeStatus` | `{ status: string }` |
| `onProfiles` | `{ profiles: ClientProfile[] }` |
| `onAuthorize` | `{ user: SelfUser }` |
| `onNotify` | `{ header: string, description: string }` |
| `onExit` | `{}` |
| `onShutdown` | `{}` |

---

## Events — channel: `"download"` (from DownloadCallback)

| name | data |
|---|---|
| `onStartPhase` | `{ phase: "JAVA" \| "ASSETS" \| "CLIENT" \| "LAUNCH" }` |
| `onStage` | `{ stage: "assetVerify" \| "hashing" \| "diff" \| "download" \| "deleteExtra" \| "done.part" \| "done" }` |
| `onTotalDownload` | `{ bytes: number }` |
| `onCurrentDownloaded` | `{ bytes: number }` |
| `onCanCancel` | `{}` |

---

## Events — channel: `"run"` (from RunCallback)

| name | data |
|---|---|
| `onStarted` | `{}` |
| `onCanTerminate` | `{}` |
| `onNormalOutput` | `{ base64: string }` (UTF-8 bytes base64-encoded) |
| `onErrorOutput` | `{ base64: string }` |
| `onFinished` | `{ code: number }` |
| `onReadyToExit` | `{}` |

---

## Domain types

### AuthMethod
```json
{ "name": "string", "displayName": "string", "type": "password|totp|web|loginOnly" }
```

### SelfUser
```json
{ "login": "string", "username": "string", "uuid": "string", "accessToken": "string" }
```

### ClientProfile
```json
{
  "uuid": "string",
  "title": "string",
  "serverAddress": "string",
  "serverPort": 25565,
  "version": "string",
  "assetIndex": "string",
  "dir": "string",
  "updateFastCheck": true,
  "jvmArgs": [],
  "minJavaVersion": 21,
  "recommendedJavaVersion": 21,
  "maxJavaVersion": 999,
  "classLoaderConfig": "LAUNCHER|BRIDGE",
  "mainClass": "string"
}
```

### ClientProfileSettings
```json
{
  "profileUuid": "string",
  "reservedMemoryMb": 2048,
  "flags": {
    "AUTO_ENTER": false,
    "FULLSCREEN": false,
    "LINUX_WAYLAND_SUPPORT": false,
    "DEBUG_SKIP_FILE_MONITOR": false
  },
  "selectedJavaIndex": 0,
  "enabledOptionals": ["mod-id-1"]
}
```

### JavaVersion
```json
{ "index": 0, "version": 21, "path": "string", "arch": "X86_64|ARM64", "javaFX": false }
```

### ServerPingInfo
```json
{ "online": true, "onlinePlayers": 12, "maxPlayers": 100, "motd": "string", "latencyMs": 42 }
```

---

## Security rules

1. WS binds strictly to `127.0.0.1` (never `0.0.0.0`).
2. Every inbound message MUST carry the correct session token; reject with `{"ok":false,"error":{"code":"AUTH_TOKEN","message":"bad token"}}` otherwise.
3. Token is generated fresh per Java process start (UUID v4 or 32-byte hex).
4. `readyProfileId` values are UUIDs generated by the bridge, not client-provided arbitrary strings; the bridge validates them against its internal registry before acting.
