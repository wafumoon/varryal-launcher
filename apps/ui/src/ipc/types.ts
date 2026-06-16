// IPC Protocol types — strictly follow docs/IPC-PROTOCOL.md
// Verified against launcher-core-5.7.10.jar

export interface AuthMethod {
  name: string
  displayName: string
  visible: boolean
}

export interface SelfUser {
  username: string
  uuid: string
  accessToken: string
}

export interface OptionalMod {
  name: string
  description: string
  category: string
  visible: boolean
}

export interface ClientProfile {
  uuid: string
  title: string       // maps to getName()
  version: string     // maps to getMinecraftVersion()
  description: string
  serverAddress: string
  serverPort: number
  optionalMods: OptionalMod[]
}

export interface Flag {
  AUTO_ENTER: boolean
  FULLSCREEN: boolean
  LINUX_WAYLAND_SUPPORT: boolean
  DEBUG_SKIP_FILE_MONITOR: boolean
}

export interface ClientProfileSettings {
  profileUuid: string
  reservedMemoryMb: number
  flags: Flag
  selectedJavaMajor?: number
  selectedJavaPath?: string
  enabledOptionals?: string[]
}

export interface JavaVersion {
  index: number
  version: number
  path: string
}

export interface ServerPingInfo {
  online: number
  maxOnline: number
  playerNames: string[]
}

export type UpdatePhase = 'JAVA' | 'ASSETS' | 'CLIENT' | 'LAUNCH'
export type DownloadStage =
  | 'assetVerify'
  | 'hashing'
  | 'diff'
  | 'download'
  | 'deleteExtra'
  | 'done.part'
  | 'done'

// ── Request/Response envelopes ────────────────────────────────────────────────

export interface IpcRequest {
  id: string
  type: 'request'
  method: string
  token: string
  params: Record<string, unknown>
}

export interface IpcResponse<T = unknown> {
  id: string
  type: 'response'
  ok: boolean
  result?: T
  error?: { code: string; message: string }
}

export interface IpcEvent {
  type: 'event'
  channel: 'main' | 'download' | 'run'
  name: string
  data: Record<string, unknown>
  token: string
}

// ── Method param/result types ─────────────────────────────────────────────────

export interface InitResult {
  authMethods: AuthMethod[]
  updateRequired: boolean
}

export interface AuthorizeResult {
  user: SelfUser
}

export interface TryAuthorizeResult {
  user: SelfUser | null
}

export interface FetchProfilesResult {
  profiles: ClientProfile[]
}

export interface MakeSettingsResult {
  settings: ClientProfileSettings
}

export interface DownloadProfileResult {
  readyProfileId: string
}

export interface GetJavaResult {
  java: JavaVersion[]
}

export interface PingResult {
  ping: ServerPingInfo
}

export interface GetSelfUserResult {
  user: SelfUser | null
  username: string
}

// ── Event data types ──────────────────────────────────────────────────────────

export interface StatusEventData { status: string }
export interface ProfilesEventData { profiles: ClientProfile[] }
export interface AuthorizeEventData { user: SelfUser }
export interface NotifyEventData { header: string; description: string }

export interface DownloadPhaseEventData { readyProfileId: string; phase: UpdatePhase }
export interface DownloadStageEventData { readyProfileId: string; stage: DownloadStage }
export interface DownloadBytesEventData { readyProfileId: string; bytes: number }
export interface DownloadCancelEventData { readyProfileId: string }
export interface DownloadCompleteEventData { readyProfileId: string }
export interface DownloadErrorEventData { readyProfileId: string; error: string }

export interface RunEventData { readyProfileId: string }
export interface RunOutputEventData { readyProfileId: string; base64: string }
export interface RunFinishedEventData { readyProfileId: string; code: number }

// ── Web-auth (browser OAuth-redirect) ────────────────────────────────────────

/** Payload of the `web_auth_result` Tauri event emitted by auth.rs. */
export interface WebAuthResult {
  ok: boolean
  /** Opaque JWT token — present only when ok === true. */
  token?: string
  /**
   * Error code from the portal or internal validation.
   * Portal codes: access_denied | email_not_verified | password_login_unavailable | server_error
   * Internal codes: state_mismatch | missing_token | invalid_callback
   */
  error?: string
}
