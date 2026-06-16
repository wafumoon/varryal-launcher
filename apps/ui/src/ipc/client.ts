/**
 * IPC client — typed request/event wrapper.
 *
 * In prod: communicates via Tauri invoke/listen (Rust proxies to Java WS).
 * In dev/mock: uses MockIpc which emits fake events locally.
 */
import type {
  IpcResponse,
  InitResult,
  AuthorizeResult,
  TryAuthorizeResult,
  FetchProfilesResult,
  MakeSettingsResult,
  DownloadProfileResult,
  GetJavaResult,
  PingResult,
  GetSelfUserResult,
  ClientProfileSettings,
  WebAuthResult,
  BootstrapStatus,
  ListCharactersResponse,
  CreateSessionResponse,
  LoginResult,
} from './types'

// ── Environment detection ─────────────────────────────────────────────────────

// Tauri injects `window.__TAURI__` when running inside the shell.
const isTauri = typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).__TAURI__

// ── Pending request map (for mock mode) ──────────────────────────────────────
type Resolve = (value: IpcResponse) => void
const pending = new Map<string, Resolve>()

// ── Event listener registry ───────────────────────────────────────────────────
type EventHandler = (data: Record<string, unknown>) => void
const eventListeners = new Map<string, EventHandler[]>()

export function onEvent(channel: string, name: string, handler: EventHandler): () => void {
  const key = `${channel}:${name}`
  if (!eventListeners.has(key)) eventListeners.set(key, [])
  eventListeners.get(key)!.push(handler)
  return () => {
    const arr = eventListeners.get(key) ?? []
    const idx = arr.indexOf(handler)
    if (idx >= 0) arr.splice(idx, 1)
  }
}

function dispatchEvent(channel: string, name: string, data: Record<string, unknown>) {
  const key = `${channel}:${name}`
  const handlers = eventListeners.get(key) ?? []
  handlers.forEach(h => h(data))
}

// ── Tauri internals accessor ──────────────────────────────────────────────────

type TauriGlobal = {
  core: { invoke: (cmd: string, args?: unknown) => Promise<unknown> }
  event: { listen: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void> }
}

function getTauri(): TauriGlobal {
  return (window as unknown as Record<string, unknown>).__TAURI__ as TauriGlobal
}

// ── Core request function ─────────────────────────────────────────────────────

export async function request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) {
    // Real Tauri invoke — Rust proxy handles token injection
    const response = await getTauri().core.invoke('ipc_request', { method, params }) as IpcResponse<T>
    if (!response.ok) throw new Error(response.error?.message ?? 'IPC error')
    return response.result as T
  } else {
    // Mock mode
    return mockRequest<T>(method, params)
  }
}

// ── Direct Tauri command invocation (non-IPC, not proxied through Java) ───────

/**
 * Invoke a native Tauri command directly (not routed through the Java WS bridge).
 * Used for commands implemented in Rust itself, e.g. `start_web_auth`.
 */
async function invokeNative<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) {
    return getTauri().core.invoke(cmd, args) as Promise<T>
  }
  // Mock: delegate to mockRequest using the command name as method key
  return mockRequest<T>(cmd, args)
}

/**
 * Listen to a Tauri event by name. Returns an unsubscribe function.
 * In mock mode, wires into the local eventListeners registry using the
 * convention channel = first segment before '_', name = rest joined by '_'.
 * e.g. "web_auth_result" → channel "web", name "auth_result"
 * The mock dispatcher for `start_web_auth` fires dispatchEvent('web_auth', 'result', …)
 * so we map "web_auth_result" → channel "web_auth", name "result".
 */
export function listenTauriEvent<T>(
  event: string,
  handler: (payload: T) => void,
): () => void {
  if (isTauri) {
    let unlisten: (() => void) | undefined
    getTauri().event.listen(event, (e) => handler(e.payload as T)).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  }
  // Mock mode: split on the LAST '_' so "web_auth_result" → ("web_auth", "result")
  const lastUnderscore = event.lastIndexOf('_')
  const channel = lastUnderscore >= 0 ? event.slice(0, lastUnderscore) : event
  const name = lastUnderscore >= 0 ? event.slice(lastUnderscore + 1) : ''
  return onEvent(channel, name, (data) => handler(data as unknown as T))
}

// ── Java-bridge event forwarding (real Tauri mode) ────────────────────────────

// The Rust proxy emits a Tauri event `ipc_event` for every Java-bridge event
// ({ type, channel, name, data }). Forward those into the local dispatchEvent
// registry that scenes subscribe to via onEvent(). No-op in mock mode (mock calls
// dispatchEvent directly).
let eventForwardingStarted = false
export function startEventForwarding(): void {
  if (eventForwardingStarted) return
  eventForwardingStarted = true

  if (isTauri) {
    void getTauri().event.listen('ipc_event', (e: { payload: unknown }) => {
      const v = e.payload as { channel?: string; name?: string; data?: Record<string, unknown> }
      if (v && v.channel && v.name) dispatchEvent(v.channel, v.name, v.data ?? {})
    })
  } else {
    // Mock mode: fire the fake bootstrap sequence so the Preparing scene
    // advances to ready and reveals the login button.
    void mockRequest<void>('bootstrap_status_start', {})
  }
}

// ── Typed API surface ─────────────────────────────────────────────────────────

export const ipc = {
  // ── Bootstrap status (emitted by Rust before login is reachable) ───────────

  /**
   * Subscribe to the `bootstrap_status` Tauri event.
   * Phases: jre → jar → starting → connecting → ready (or error).
   * The frontend must wait for `ready` before showing the login button.
   * Returns an unsubscribe function.
   */
  listenBootstrapStatus: (handler: (status: BootstrapStatus) => void) =>
    listenTauriEvent<BootstrapStatus>('bootstrap_status', handler),

  // ── Web-auth (browser OAuth-redirect) ──────────────────────────────────────

  /**
   * Open the Varryal portal in the system browser to begin web-auth.
   * After the user logs in, the portal redirects to varryal://auth/callback,
   * which the Rust deep-link handler processes and emits `web_auth_result`.
   * The token in the result is the ACCOUNT token (Bearer for /launcher/me/*).
   * Subscribe with `ipc.listenWebAuthResult` before calling this.
   */
  startWebAuth: () => invokeNative<void>('start_web_auth'),

  /**
   * Subscribe to the `web_auth_result` Tauri event.
   * Returns an unsubscribe function; call it when the component unmounts.
   */
  listenWebAuthResult: (handler: (result: WebAuthResult) => void) =>
    listenTauriEvent<WebAuthResult>('web_auth_result', handler),

  // ── Portal API (native Tauri commands, not proxied through Java WS) ────────

  /**
   * Log in with email + password (credentials login).
   * Returns the account access token (Bearer for /launcher/me/*) plus account
   * metadata. The frontend stores `accountAccessToken` and uses it for
   * `listCharacters` / `createSession`. No browser, no deep-link.
   * On failure the rejected Error message is the portal's localized text.
   */
  portalLogin: (email: string, password: string) =>
    invokeNative<LoginResult>('portal_login', { email, password }),

  /**
   * Fetch the list of characters for the authenticated account.
   * `accountToken` is the Bearer token received from `web_auth_result`.
   * Returns the full portal response (use `.items` for the character array).
   */
  listCharacters: (accountToken: string) =>
    invokeNative<ListCharactersResponse>('portal_list_characters', { accountToken }),

  /**
   * Mint a per-character Minecraft access token.
   * Returns `{ minecraftAccessToken, uuid, username, skinUrl }`.
   * After this, call `ipc.selectAuthMethod('std')` then
   * `ipc.authorize('', minecraftAccessToken)` to hand off to the Java bridge.
   */
  createSession: (accountToken: string, characterId: string) =>
    invokeNative<CreateSessionResponse>('portal_create_session', { accountToken, characterId }),

  /**
   * Fetch a Minecraft skin as a base64 data URL (via Rust — CORS-safe) so the
   * 3D skin viewer (WebGL) can use it as a texture. Returns the data URL string.
   */
  fetchSkin: (url: string) => invokeNative<string>('portal_fetch_skin', { url }),

  // ── Bridge IPC (proxied through Java WS) ──────────────────────────────────

  init: () => request<InitResult>('init'),
  selectAuthMethod: (method: string) => request<Record<string, never>>('selectAuthMethod', { method }),
  tryAuthorize: () => request<TryAuthorizeResult>('tryAuthorize'),
  authorize: (login: string, password: string) =>
    request<AuthorizeResult>('authorize', { login, password }),
  userExit: () => request<Record<string, never>>('userExit'),
  fetchProfiles: () => request<FetchProfilesResult>('fetchProfiles'),
  makeClientProfileSettings: (profileUuid: string) =>
    request<MakeSettingsResult>('makeClientProfileSettings', { profileUuid }),
  saveClientProfileSettings: (settings: ClientProfileSettings) =>
    request<Record<string, never>>('saveClientProfileSettings', { settings }),
  downloadProfile: (profileUuid: string, settings: ClientProfileSettings) =>
    request<DownloadProfileResult>('downloadProfile', { profileUuid, settings }),
  runProfile: (readyProfileId: string) =>
    request<Record<string, never>>('runProfile', { readyProfileId }),
  cancelDownload: (readyProfileId: string) =>
    request<Record<string, never>>('cancelDownload', { readyProfileId }),
  terminateGame: (readyProfileId: string) =>
    request<Record<string, never>>('terminateGame', { readyProfileId }),
  getAvailableJava: () => request<GetJavaResult>('getAvailableJava'),
  pingServer: (profileUuid: string) => request<PingResult>('pingServer', { profileUuid }),
  getUserSettings: (name: string) => request<{ settings: unknown }>('getUserSettings', { name }),
  getSelfUser: () => request<GetSelfUserResult>('getSelfUser'),
  isTestMode: () => request<{ testMode: boolean }>('isTestMode'),
  shutdown: () => request<Record<string, never>>('shutdown'),
}

// ── Mock IPC (dev mode without Tauri/Java) ────────────────────────────────────

async function mockRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
  // Simulate network delay
  await delay(80 + Math.random() * 120)

  switch (method) {
    // ── Bootstrap status mock: emit the full phase sequence quickly ──────────
    case 'bootstrap_status_start': {
      // Called internally on mock init to simulate bootstrap phases.
      const phases: Array<{ phase: string; message: string; progress: number }> = [
        { phase: 'jre',        message: 'Скачивание Java…',  progress: 0.0 },
        { phase: 'jar',        message: 'Скачивание клиента…', progress: 0.3 },
        { phase: 'starting',   message: 'Запуск…',           progress: 0.6 },
        { phase: 'connecting', message: 'Подключение…',      progress: 0.8 },
        { phase: 'ready',      message: 'Готово',            progress: 1.0 },
      ]
      phases.forEach(({ phase, message, progress }, i) => {
        setTimeout(() => {
          dispatchEvent('bootstrap', 'status', { phase, message, progress })
        }, 200 + i * 250)
      })
      return undefined as unknown as T
    }

    // ── Web-auth mock: simulate the browser round-trip with a 1.5s delay ─────
    case 'start_web_auth': {
      // In mock mode we never open a real browser.
      // Simulate the portal redirect by firing `web_auth_result` after a short delay.
      // The token is an ACCOUNT token (not a minecraft token).
      setTimeout(() => {
        dispatchEvent('web_auth', 'result', {
          ok: true,
          token: 'mock-account-token-' + crypto.randomUUID(),
        })
      }, 1500)
      return undefined as unknown as T
    }

    // ── Portal API mocks ──────────────────────────────────────────────────────
    case 'portal_fetch_skin':
      return '/default-skin.png' as T

    case 'portal_login': {
      const { email } = params as { email: string }
      return {
        accountId: 'mock-account-id',
        displayName: email.split('@')[0] || 'MockUser',
        accountAccessToken: 'mock-account-token-' + crypto.randomUUID(),
        accountAccessExpiresAt: '2099-01-01T00:00:00.000Z',
      } as T
    }

    case 'portal_list_characters': {
      return {
        items: [
          {
            id: 'char-uuid-1',
            generatedNickname: 'ShadowElf_7291',
            minecraftUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            name: 'Уголёк',
            race: { key: 'elf', name: 'Эльф' },
            alias: 'Следопыт',
            skinPreviewUrl: '',
            skinUrl: '/default-skin.png',
            skinModel: 'classic',
          },
          {
            id: 'char-uuid-2',
            generatedNickname: 'IronDwarf_4418',
            minecraftUuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
            name: 'Грим',
            race: { key: 'dwarf', name: 'Гном' },
            alias: 'Кузнец',
            skinPreviewUrl: '',
            skinUrl: '/default-skin.png',
            skinModel: 'classic',
          },
        ],
      } as T
    }

    case 'portal_create_session': {
      const { characterId } = params as { characterId: string }
      return {
        minecraftAccessToken: 'mock-mc-token-' + characterId + '-' + crypto.randomUUID(),
        uuid: params.characterId as string,
        username: characterId === 'char-uuid-1' ? 'ShadowElf_7291' : 'IronDwarf_4418',
        skinUrl: '',
      } as T
    }

    case 'init':
      return {
        authMethods: [{ name: 'std', displayName: 'Varryal Auth', visible: true }],
        updateRequired: false,
      } as T

    case 'tryAuthorize':
      return { user: null } as T

    case 'selectAuthMethod':
      return {} as T

    case 'authorize': {
      const { login } = params as { login: string }
      return {
        user: { username: login, uuid: 'mock-uuid-1234', accessToken: 'mock-token' },
      } as T
    }

    case 'userExit':
      return {} as T

    case 'fetchProfiles':
      // Simulate a push event too
      setTimeout(() => {
        dispatchEvent('main', 'onProfiles', { profiles: MOCK_PROFILES })
      }, 200)
      return { profiles: MOCK_PROFILES } as T

    case 'makeClientProfileSettings':
      return {
        settings: {
          profileUuid: params.profileUuid as string,
          reservedMemoryMb: 4096,
          flags: {
            AUTO_ENTER: false,
            FULLSCREEN: false,
            LINUX_WAYLAND_SUPPORT: false,
            DEBUG_SKIP_FILE_MONITOR: false,
          },
        },
      } as T

    case 'saveClientProfileSettings':
      return {} as T

    case 'downloadProfile': {
      const readyProfileId = crypto.randomUUID()
      // Simulate download events
      simulateMockDownload(readyProfileId)
      return { readyProfileId } as T
    }

    case 'runProfile': {
      const { readyProfileId } = params as { readyProfileId: string }
      simulateMockRun(readyProfileId)
      return {} as T
    }

    case 'cancelDownload':
    case 'terminateGame':
      return {} as T

    case 'getAvailableJava':
      return {
        java: [
          { index: 0, version: 21, path: 'C:/Program Files/BellSoft/Liberica/21' },
          { index: 1, version: 25, path: 'C:/Program Files/BellSoft/Liberica/25' },
        ],
      } as T

    case 'pingServer':
      return { ping: { online: 12, maxOnline: 100, playerNames: ['Player1', 'Player2'] } } as T

    case 'getSelfUser':
      return { user: null, username: '' } as T

    case 'isTestMode':
      return { testMode: true } as T

    case 'shutdown':
      return {} as T

    default:
      throw new Error(`Mock: unknown method ${method}`)
  }
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

const MOCK_PROFILES = [
  {
    uuid: 'mock-profile-1',
    title: 'Varryal Main',
    version: '26.1.2',
    description: 'Fabric 1.21 — основной сервер',
    serverAddress: 'mc.varryal.ru',
    serverPort: 25565,
    optionalMods: [
      { name: 'VoiceChat', description: 'Simple Voice Chat mod', category: 'audio', visible: true },
      { name: 'Shaders', description: 'Iris + Sodium shaders', category: 'visual', visible: true },
    ],
  },
]

function simulateMockDownload(readyProfileId: string) {
  const phases = ['CLIENT', 'ASSETS'] as const
  let t = 300
  for (const phase of phases) {
    setTimeout(() => dispatchEvent('download', 'onStartPhase', { readyProfileId, phase }), t)
    t += 200
    let downloaded = 0
    const total = 50 * 1024 * 1024
    setTimeout(() => dispatchEvent('download', 'onTotalDownload', { readyProfileId, bytes: total }), t)
    t += 100
    for (let i = 1; i <= 5; i++) {
      const chunk = (total / 5) * i
      setTimeout(() => {
        downloaded = chunk
        dispatchEvent('download', 'onCurrentDownloaded', { readyProfileId, bytes: downloaded })
      }, t + i * 300)
    }
    t += 1800
    setTimeout(() => dispatchEvent('download', 'onStage', { readyProfileId, stage: 'done' }), t)
    t += 200
  }
  setTimeout(() => dispatchEvent('download', 'onComplete', { readyProfileId }), t)
}

function simulateMockRun(readyProfileId: string) {
  setTimeout(() => dispatchEvent('run', 'onStarted', { readyProfileId }), 200)
  setTimeout(() => dispatchEvent('run', 'onCanTerminate', { readyProfileId }), 300)
  const lines = [
    '[INFO] Starting Minecraft 26.1.2',
    '[INFO] Loading Fabric mods...',
    '[INFO] Connecting to mc.varryal.ru:25565',
    '[INFO] Login successful',
  ]
  lines.forEach((line, i) => {
    const bytes = new TextEncoder().encode(line + '\n')
    const b64 = btoa(String.fromCharCode(...bytes))
    setTimeout(() => dispatchEvent('run', 'onNormalOutput', { readyProfileId, base64: b64 }), 500 + i * 400)
  })
}

// Expose dispatchEvent for Tauri event forwarding
export { dispatchEvent }
