import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { AlertCircle, Download, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { applyTheme } from './theme/applyTheme'
import { Titlebar } from './components/Titlebar'
import { SceneBackdrop } from './components/SceneBackdrop'
import { ParticleField } from './components/ParticleField'
import { Login } from './scenes/Login'
import { Launcher } from './scenes/Launcher'
import { UpdateProgress } from './scenes/UpdateProgress'
import { Running } from './scenes/Running'
import { ipc, startEventForwarding } from './ipc/client'
import { useAuthStore } from './store/auth'
import { useProfilesStore } from './store/profiles'
import { useSettingsStore } from './store/settings'
import { classifyRemoteError, isCurrentOperation } from './utils/launcherState'
import { bridgeSessionQueue } from './utils/serialQueue'
import type { BootstrapStatus, Character, ClientProfile, ClientProfileSettings } from './ipc/types'

type Scene =
  | { name: 'preparing' }
  | { name: 'login' }
  | { name: 'launcher' }
  | { name: 'downloading'; profile: ClientProfile; settings: ClientProfileSettings; mode: 'play' | 'reinstall' }
  | { name: 'running'; readyProfileId: string }

type UpdateStatus = 'checking' | 'current' | 'available' | 'installing' | 'error'

export function App() {
  const [scene, setScene] = useState<Scene>({ name: 'preparing' })
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus | null>(null)
  const [initialCharacters, setInitialCharacters] = useState<Character[] | undefined>(undefined)
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('checking')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const sessionOperationRef = useRef(0)
  const {
    setAuthMethods, setAccountToken, setCachedCharacters, logout,
  } = useAuthStore()
  const { selectProfile, setActiveCharId } = useProfilesStore()
  const { motionMode } = useSettingsStore()

  useEffect(() => {
    applyTheme()
    startEventForwarding()
  }, [])

  const checkUpdate = useCallback(async () => {
    setUpdateStatus('checking')
    setUpdateError(null)
    try {
      const version = await ipc.checkForUpdate()
      if (version) {
        setUpdateVersion(version)
        setUpdateStatus('available')
      } else {
        setUpdateVersion(null)
        setUpdateStatus('current')
      }
    } catch (caught) {
      setUpdateError(caught instanceof Error ? caught.message : String(caught))
      setUpdateStatus('error')
    }
  }, [])

  useEffect(() => { void checkUpdate() }, [checkUpdate])

  const installUpdate = useCallback(async () => {
    setUpdateStatus('installing')
    setUpdateError(null)
    try {
      await ipc.installUpdate()
    } catch (caught) {
      setUpdateError(caught instanceof Error ? caught.message : String(caught))
      setUpdateStatus('error')
    }
  }, [])

  useEffect(() => {
    const unsubscribe = ipc.listenBootstrapStatus(setBootstrapStatus)
    return unsubscribe
  }, [])

  useEffect(() => {
    if (scene.name !== 'preparing') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const initData = await ipc.init()
        if (cancelled) return
        setAuthMethods(initData.authMethods)
        const token = useAuthStore.getState().accountToken
        if (!token) {
          setScene({ name: 'login' })
          return
        }

        try {
          const result = await ipc.listCharacters(token)
          if (cancelled) return
          const items = result.items ?? []
          setCachedCharacters(items)
          setInitialCharacters(items)
          setInitialLoadError(null)
          setScene({ name: 'launcher' })
        } catch (caught) {
          if (cancelled) return
          const message = caught instanceof Error ? caught.message : String(caught)
          if (classifyRemoteError(message) === 'auth') {
            logout()
            setActiveCharId(null)
            setScene({ name: 'login' })
          } else {
            setInitialCharacters(useAuthStore.getState().cachedCharacters)
            setInitialLoadError(message)
            setScene({ name: 'launcher' })
          }
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, 1200)
      }
    }

    timer = setTimeout(tick, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [scene.name, setAuthMethods, setCachedCharacters, logout, setActiveCharId])

  const initBridge = useCallback(async () => {
    try {
      const initData = await ipc.init()
      setAuthMethods(initData.authMethods)
    } catch {
      // The login flow displays a concrete bridge/network error if it stays unavailable.
    }
  }, [setAuthMethods])

  useEffect(() => {
    if (scene.name === 'login') void initBridge()
  }, [scene.name, initBridge])

  const handleLoginSuccess = useCallback((token: string) => {
    sessionOperationRef.current += 1
    setAccountToken(token)
    setInitialCharacters(undefined)
    setInitialLoadError(null)
    setScene({ name: 'launcher' })
  }, [setAccountToken])

  const goToLauncher = useCallback(() => {
    setInitialCharacters(undefined)
    setInitialLoadError(null)
    setScene({ name: 'launcher' })
  }, [])

  const handleLogout = useCallback(() => {
    sessionOperationRef.current += 1
    logout()
    void bridgeSessionQueue.enqueue(() => ipc.userExit()).catch(() => {})
    setActiveCharId(null)
    setInitialCharacters(undefined)
    setInitialLoadError(null)
    setScene({ name: 'login' })
  }, [logout, setActiveCharId])

  const handleSessionInvalid = useCallback(() => {
    sessionOperationRef.current += 1
    logout()
    void bridgeSessionQueue.enqueue(() => ipc.userExit()).catch(() => {})
    setActiveCharId(null)
    setInitialCharacters(undefined)
    setInitialLoadError(null)
    setScene({ name: 'login' })
  }, [logout, setActiveCharId])

  const startDownload = useCallback(async (profile: ClientProfile, mode: 'play' | 'reinstall') => {
    const accountToken = useAuthStore.getState().accountToken
    if (!accountToken) {
      handleSessionInvalid()
      return
    }
    const operation = ++sessionOperationRef.current
    const isCurrent = () => (
      isCurrentOperation(operation, sessionOperationRef.current)
      && useAuthStore.getState().accountToken === accountToken
    )

    selectProfile(profile)
    if (mode === 'reinstall') {
      try {
        await ipc.reinstallProfile(profile.uuid)
      } catch {
        // The download scene retains context and exposes Retry/diagnostics.
      }
      if (!isCurrent()) return
    }

    const currentSettings = useSettingsStore.getState().profileSettings
    let settings: ClientProfileSettings
    if (currentSettings?.profileUuid === profile.uuid) {
      settings = currentSettings
    } else {
      try {
        const result = await ipc.makeClientProfileSettings(profile.uuid)
        if (!isCurrent()) return
        settings = { ...result.settings, profileUuid: profile.uuid }
      } catch {
        if (!isCurrent()) return
        settings = {
          profileUuid: profile.uuid,
          reservedMemoryMb: 4096,
          flags: {
            AUTO_ENTER: false,
            FULLSCREEN: false,
            LINUX_WAYLAND_SUPPORT: false,
            DEBUG_SKIP_FILE_MONITOR: false,
          },
        }
      }
    }
    if (!isCurrent()) return
    setScene({ name: 'downloading', profile, settings, mode })
  }, [handleSessionInvalid, selectProfile])

  const handleDownloadComplete = useCallback((readyProfileId: string) => {
    if (scene.name === 'downloading' && scene.mode === 'reinstall') {
      goToLauncher()
      return
    }
    setScene({ name: 'running', readyProfileId })
  }, [scene, goToLauncher])

  const handleRetryBootstrap = useCallback(() => {
    setBootstrapStatus(null)
    setScene({ name: 'preparing' })
  }, [])

  const backdropVariant = scene.name === 'preparing' || scene.name === 'login'
    ? 'arrival'
    : scene.name === 'running'
      ? 'plain'
      : 'home'
  const reducedMotion = motionMode === 'reduced' ? 'always' : motionMode === 'full' ? 'never' : 'user'

  return (
    <MotionConfig reducedMotion={reducedMotion}>
      <div className="vy-app" data-motion={motionMode}>
        <SceneBackdrop variant={backdropVariant} />
        <ParticleField variant={backdropVariant} />
        <div className="vy-shell">
          <Titlebar />
          <AnimatePresence mode="wait">
            {scene.name === 'preparing' && <PreparingScene key="preparing" status={bootstrapStatus} onRetry={handleRetryBootstrap} />}
            {scene.name === 'login' && <Login key="login" onSuccess={handleLoginSuccess} />}
            {scene.name === 'launcher' && (
              <Launcher
                key="launcher"
                initialCharacters={initialCharacters}
                initialLoadError={initialLoadError}
                onPlay={(profile) => void startDownload(profile, 'play')}
                onReinstall={(profile) => void startDownload(profile, 'reinstall')}
                onLogout={handleLogout}
                onSessionInvalid={handleSessionInvalid}
              />
            )}
            {scene.name === 'downloading' && (
              <UpdateProgress
                key="downloading"
                profile={scene.profile}
                settings={scene.settings}
                mode={scene.mode}
                onComplete={handleDownloadComplete}
                onBack={goToLauncher}
              />
            )}
            {scene.name === 'running' && <Running key="running" readyProfileId={scene.readyProfileId} onExit={goToLauncher} />}
          </AnimatePresence>
        </div>

        {updateStatus !== 'current' && (
          <UpdateGate
            status={updateStatus}
            version={updateVersion}
            error={updateError}
            onCheck={checkUpdate}
            onInstall={installUpdate}
          />
        )}
      </div>
    </MotionConfig>
  )
}

const PHASE_LABELS: Record<string, string> = {
  jre: 'Подготавливаем Java',
  jar: 'Проверяем launcher core',
  starting: 'Запускаем службы',
  connecting: 'Устанавливаем защищённое соединение',
  ready: 'Готово',
}

function PreparingScene({ status, onRetry }: { status: BootstrapStatus | null; onRetry: () => void }) {
  const isError = status?.phase === 'error'
  const label = status ? (PHASE_LABELS[status.phase] ?? status.message) : 'Инициализация лаунчера'
  const progress = status?.progress ?? null
  const percent = progress === null ? null : Math.round(progress * 100)

  return (
    <motion.main className="vy-preparing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={`vy-preparing-card${isError ? ' is-error' : ''}`}>
        <div className="vy-preparing-card__brand"><img src="/varryal-logo.png" width={54} height={54} alt="Varryal" /><div><span>VARRYAL</span><small>Возвращение на Острог</small></div></div>
        <div className="vy-preparing-card__status">
          {isError ? <AlertCircle size={22} /> : <Loader2 className="vy-spin" size={22} />}
          <div><strong>{isError ? 'Не удалось запустить лаунчер' : label}</strong><span>{isError ? status?.message : 'Это может занять немного времени при первом запуске.'}</span></div>
          {percent !== null && !isError && <b>{percent}%</b>}
        </div>
        {!isError && progress !== null && <div className="vy-progress-track"><motion.i animate={{ width: `${percent}%` }} transition={{ duration: 0.35 }} /></div>}
        {isError && <button className="vy-secondary-action" onClick={onRetry}><RefreshCw size={15} />Повторить</button>}
      </div>
    </motion.main>
  )
}

function UpdateGate({ status, version, error, onCheck, onInstall }: {
  status: UpdateStatus
  version: string | null
  error: string | null
  onCheck: () => Promise<void>
  onInstall: () => Promise<void>
}) {
  const checking = status === 'checking'
  const installing = status === 'installing'
  const failed = status === 'error'

  return (
    <motion.div className="vy-update-gate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="vy-update-gate__card">
        <span className="vy-update-gate__icon">{failed ? <AlertCircle size={24} /> : installing ? <Download size={24} /> : checking ? <Loader2 className="vy-spin" size={24} /> : <ShieldCheck size={24} />}</span>
        <div>
          <span className="vy-eyebrow">Проверка совместимости</span>
          <h2 id="update-title">{checking ? 'Проверяем версию лаунчера' : installing ? 'Устанавливаем обновление' : failed ? 'Проверка не завершена' : `Требуется обновление ${version ?? ''}`}</h2>
          <p>{failed ? (error || 'Не удалось проверить или установить обновление.') : status === 'available' ? 'Обновление обязательно для запуска игры и будет проверено перед установкой.' : 'Не закрывайте лаунчер. После установки он перезапустится автоматически.'}</p>
        </div>
        {status === 'available' && <button className="vy-primary-action" onClick={() => void onInstall()}><Download size={17} />Обновить лаунчер</button>}
        {failed && <button className="vy-secondary-action" onClick={() => void (version ? onInstall() : onCheck())}><RefreshCw size={15} />Повторить</button>}
        {(checking || installing) && <div className="vy-update-gate__line"><i /></div>}
      </div>
    </motion.div>
  )
}
