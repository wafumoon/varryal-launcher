import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { applyTheme } from './theme/applyTheme'
import { Titlebar } from './components/Titlebar'
import { Login } from './scenes/Login'
import { CharacterSelect } from './scenes/CharacterSelect'
import { ServerMenu } from './scenes/ServerMenu'
import { UpdateProgress } from './scenes/UpdateProgress'
import { Running } from './scenes/Running'
import { SettingsPanel } from './scenes/SettingsPanel'
import { ipc, startEventForwarding } from './ipc/client'
import { useAuthStore } from './store/auth'
import { useProfilesStore } from './store/profiles'
import { useSettingsStore } from './store/settings'
import { Loader2, AlertCircle } from 'lucide-react'
import type { ClientProfile, ClientProfileSettings, BootstrapStatus } from './ipc/types'

type Scene =
  | { name: 'preparing' }
  | { name: 'login' }
  | { name: 'characters'; accountToken: string }
  | { name: 'server-menu' }
  | { name: 'settings'; profile: ClientProfile }
  | { name: 'downloading'; profile: ClientProfile; settings: ClientProfileSettings }
  | { name: 'running'; readyProfileId: string }

export function App() {
  const [scene, setScene] = useState<Scene>({ name: 'preparing' })
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus | null>(null)
  const { setAuthMethods, setUser, setAccountToken, logout, accountToken } = useAuthStore()
  const { selectProfile } = useProfilesStore()
  const { profileSettings } = useSettingsStore()

  // Apply theme + start Java-bridge event forwarding on mount.
  // startEventForwarding() also kicks off the mock bootstrap sequence in dev.
  useEffect(() => { applyTheme(); startEventForwarding() }, [])

  // Listen to bootstrap_status events from Rust (or mock).
  useEffect(() => {
    const unsub = ipc.listenBootstrapStatus((status) => {
      setBootstrapStatus(status)
      if (status.phase === 'ready') {
        // Bootstrap done — advance to login (or skip straight to characters if
        // we already have a saved account token from a prior session).
        if (accountToken) {
          setScene({ name: 'characters', accountToken })
        } else {
          setScene({ name: 'login' })
        }
      }
      // 'error' phase: scene stays 'preparing' so the error UI renders.
    })
    return unsub
  }, [accountToken])

  // When inside Tauri, also call init() to set up auth methods for the bridge.
  // This runs once after bootstrap completes (on login scene enter).
  const initBridge = useCallback(async () => {
    try {
      const initData = await ipc.init()
      setAuthMethods(initData.authMethods)
    } catch {
      // Non-fatal: if bridge isn't up yet the auth flow will surface the error.
    }
  }, [setAuthMethods])

  useEffect(() => {
    if (scene.name === 'login') initBridge()
  }, [scene.name, initBridge])

  // ── Scene transitions ─────────────────────────────────────────────────────

  /** Called by Login when web-auth callback delivers the account token. */
  const handleLoginSuccess = useCallback((token: string) => {
    setAccountToken(token)
    setScene({ name: 'characters', accountToken: token })
  }, [setAccountToken])

  /** Called by CharacterSelect after bridge authorize() succeeds. */
  const goToServerMenu = useCallback(() => setScene({ name: 'server-menu' }), [])

  /** "Сменить персонажа" — go back to character select without re-doing browser login. */
  const handleSwitchCharacter = useCallback(() => {
    const token = useAuthStore.getState().accountToken
    if (token) {
      setScene({ name: 'characters', accountToken: token })
    } else {
      // Token lost (shouldn't happen) — fall back to full login.
      logout()
      setScene({ name: 'login' })
    }
  }, [logout])

  const handleLogout = useCallback(() => {
    logout()
    setScene({ name: 'login' })
  }, [logout])

  const handlePlay = useCallback(async (profile: ClientProfile) => {
    selectProfile(profile)
    let settings: ClientProfileSettings
    if (profileSettings?.profileUuid === profile.uuid) {
      settings = profileSettings
    } else {
      try {
        const res = await ipc.makeClientProfileSettings(profile.uuid)
        settings = { ...res.settings, profileUuid: profile.uuid }
      } catch {
        settings = {
          profileUuid: profile.uuid,
          reservedMemoryMb: 4096,
          flags: { AUTO_ENTER: false, FULLSCREEN: false, LINUX_WAYLAND_SUPPORT: false, DEBUG_SKIP_FILE_MONITOR: false },
        }
      }
    }
    setScene({ name: 'downloading', profile, settings })
  }, [profileSettings, selectProfile])

  const handleSettings = useCallback((profile: ClientProfile) => {
    setScene({ name: 'settings', profile })
  }, [])

  const handleDownloadComplete = useCallback((readyProfileId: string) => {
    setScene({ name: 'running', readyProfileId })
  }, [])

  const handleGameExit = useCallback(() => {
    setScene({ name: 'server-menu' })
  }, [])

  // ── Retry bootstrap after error ───────────────────────────────────────────

  const handleRetryBootstrap = useCallback(() => {
    // Reset to preparing — the Rust side already failed so there's nothing to
    // retry without a full restart, but this gives the user a clear message.
    // In practice they need to restart the launcher.
    setBootstrapStatus(null)
    setScene({ name: 'preparing' })
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: 'var(--bg-base)',
      overflow: 'hidden',
    }}>
      <Titlebar />

      <AnimatePresence mode="wait">
        {/* ── Preparing — bootstrap in progress or error ───────────────── */}
        {scene.name === 'preparing' && (
          <PreparingScene
            key="preparing"
            status={bootstrapStatus}
            onRetry={handleRetryBootstrap}
          />
        )}

        {/* ── Login — browser OAuth redirect ───────────────────────────── */}
        {scene.name === 'login' && (
          <Login key="login" onSuccess={handleLoginSuccess} />
        )}

        {/* ── Character selection ───────────────────────────────────────── */}
        {scene.name === 'characters' && (
          <CharacterSelect
            key="characters"
            accountToken={scene.accountToken}
            onSuccess={goToServerMenu}
          />
        )}

        {/* ── Server menu ───────────────────────────────────────────────── */}
        {scene.name === 'server-menu' && (
          <ServerMenu
            key="server-menu"
            onPlay={handlePlay}
            onSettings={handleSettings}
            onLogout={handleLogout}
            onSwitchCharacter={handleSwitchCharacter}
          />
        )}

        {scene.name === 'settings' && (
          <SettingsPanel
            key="settings"
            profile={scene.profile}
            onBack={goToServerMenu}
          />
        )}

        {scene.name === 'downloading' && (
          <UpdateProgress
            key="downloading"
            profile={scene.profile}
            settings={scene.settings}
            onComplete={handleDownloadComplete}
            onBack={goToServerMenu}
          />
        )}

        {scene.name === 'running' && (
          <Running
            key="running"
            readyProfileId={scene.readyProfileId}
            onExit={handleGameExit}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Preparing scene ────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  jre:        'Скачивание Java…',
  jar:        'Скачивание клиента…',
  starting:   'Запуск…',
  connecting: 'Подключение…',
  ready:      'Готово',
}

function PreparingScene({
  status,
  onRetry,
}: {
  status: BootstrapStatus | null
  onRetry: () => void
}) {
  const isError = status?.phase === 'error'
  const label = status ? (PHASE_LABELS[status.phase] ?? status.message) : 'Инициализация…'
  const progress = status?.progress ?? null

  return (
    <motion.div
      key="preparing"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: 40,
      }}
    >
      {/* Logo monogram */}
      <div style={{
        width: 56, height: 56, borderRadius: 16,
        background: isError ? 'rgba(229,87,92,0.15)' : 'var(--primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, fontWeight: 700, color: '#fff',
        marginBottom: 4,
      }}>
        {isError ? <AlertCircle size={28} color="var(--error)" /> : 'V'}
      </div>

      {/* Spinner or error icon */}
      {!isError && (
        <Loader2
          size={28}
          style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }}
        />
      )}

      {/* Phase label */}
      <p style={{
        fontSize: 14,
        color: isError ? 'var(--error)' : 'var(--text-mid)',
        textAlign: 'center',
        maxWidth: 320,
        lineHeight: 1.5,
      }}>
        {isError ? (status?.message ?? 'Ошибка запуска') : label}
      </p>

      {/* Progress bar */}
      {!isError && progress !== null && (
        <div style={{
          width: 240, height: 4,
          background: 'var(--bg-elev-3)',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <motion.div
            animate={{ width: `${Math.round(progress * 100)}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            style={{ height: '100%', background: 'var(--primary)', borderRadius: 2 }}
          />
        </div>
      )}

      {/* Retry button on error */}
      {isError && (
        <button
          onClick={onRetry}
          style={{
            marginTop: 8,
            height: 38, padding: '0 24px',
            borderRadius: 'var(--radius-control)',
            background: 'var(--bg-elev-3)',
            border: '1px solid var(--border)',
            color: 'var(--text-mid)',
            fontSize: 13, cursor: 'pointer',
          }}
        >
          Перезапустить
        </button>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  )
}
