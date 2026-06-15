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

// ── Core request function ─────────────────────────────────────────────────────

export async function request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) {
    // Real Tauri invoke — Rust proxy handles token injection
    const tauri = (window as unknown as Record<string, unknown>).__TAURI__ as {
      core: { invoke: (cmd: string, args?: unknown) => Promise<unknown> }
      event: { listen: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void> }
    }
    const response = await tauri.core.invoke('ipc_request', { method, params }) as IpcResponse<T>
    if (!response.ok) throw new Error(response.error?.message ?? 'IPC error')
    return response.result as T
  } else {
    // Mock mode
    return mockRequest<T>(method, params)
  }
}

// ── Typed API surface ─────────────────────────────────────────────────────────

export const ipc = {
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
    case 'init':
      return {
        authMethods: [{ name: 'std', displayName: 'Varryal Auth', visible: true }],
        updateRequired: false,
      } as T

    case 'tryAuthorize':
      return { user: null } as T

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
