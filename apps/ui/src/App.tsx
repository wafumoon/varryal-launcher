import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import { applyTheme } from './theme/applyTheme'
import { Titlebar } from './components/Titlebar'
import { Login } from './scenes/Login'
import { ServerMenu } from './scenes/ServerMenu'
import { UpdateProgress } from './scenes/UpdateProgress'
import { Running } from './scenes/Running'
import { SettingsPanel } from './scenes/SettingsPanel'
import { ipc } from './ipc/client'
import { useAuthStore } from './store/auth'
import { useProfilesStore } from './store/profiles'
import { useSettingsStore } from './store/settings'
import type { ClientProfile, ClientProfileSettings } from './ipc/types'

type Scene =
  | { name: 'loading' }
  | { name: 'login' }
  | { name: 'server-menu' }
  | { name: 'settings'; profile: ClientProfile }
  | { name: 'downloading'; profile: ClientProfile; settings: ClientProfileSettings }
  | { name: 'running'; readyProfileId: string }

export function App() {
  const [scene, setScene] = useState<Scene>({ name: 'loading' })
  const { setAuthMethods, setUser, logout } = useAuthStore()
  const { selectProfile } = useProfilesStore()
  const { profileSettings } = useSettingsStore()

  // Apply theme on mount
  useEffect(() => { applyTheme() }, [])

  // Bootstrap: call init(), then try to restore session
  useEffect(() => {
    async function bootstrap() {
      try {
        const initData = await ipc.init()
        setAuthMethods(initData.authMethods)
        // Try to restore saved session
        const tryAuth = await ipc.tryAuthorize()
        if (tryAuth.user) {
          setUser(tryAuth.user)
          setScene({ name: 'server-menu' })
        } else {
          setScene({ name: 'login' })
        }
      } catch {
        setScene({ name: 'login' })
      }
    }
    bootstrap()
  }, [])

  const goToServerMenu = useCallback(() => setScene({ name: 'server-menu' }), [])

  const handleLogout = useCallback(() => {
    logout()
    setScene({ name: 'login' })
  }, [logout])

  const handlePlay = useCallback(async (profile: ClientProfile) => {
    selectProfile(profile)
    // Get or use existing settings
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
        {scene.name === 'loading' && (
          <div key="loading" style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-lo)', fontSize: 14,
          }}>
            Loading...
          </div>
        )}

        {scene.name === 'login' && (
          <Login key="login" onSuccess={goToServerMenu} />
        )}

        {scene.name === 'server-menu' && (
          <ServerMenu
            key="server-menu"
            onPlay={handlePlay}
            onSettings={handleSettings}
            onLogout={handleLogout}
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
