import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle, Check, ChevronRight, CloudOff, Coffee, Cpu, ExternalLink,
  Home, Loader2, LogOut, Monitor, Play, Puzzle, RefreshCw, RotateCcw,
  Save, Settings, Terminal, UserRound, Wifi, WifiOff, Wrench,
} from 'lucide-react'
import { ipc } from '../ipc/client'
import { useAuthStore } from '../store/auth'
import { useProfilesStore } from '../store/profiles'
import { useSettingsStore } from '../store/settings'
import { SkinPreview } from '../components/SkinPreview'
import type { Character, ClientProfile, OptionalMod } from '../ipc/types'
import { CREATE_CHARACTER_URL } from '../config'
import {
  classifyRemoteError,
  formatCharacterName,
  nextOptionalSelection,
  type MotionMode,
} from '../utils/launcherState'

type Tab = 'home' | 'mods' | 'settings'

interface LauncherProps {
  onPlay: (profile: ClientProfile) => void
  onReinstall: (profile: ClientProfile) => void
  onLogout: () => void
  onSessionInvalid: () => void
  initialCharacters?: Character[]
  initialLoadError?: string | null
}

export function Launcher({
  onPlay,
  onReinstall,
  onLogout,
  onSessionInvalid,
  initialCharacters,
  initialLoadError = null,
}: LauncherProps) {
  const { t } = useTranslation()
  const {
    user, accountToken, displayName, cachedCharacters,
    setUser, setError: storeSetError, setLastCharId, setCachedCharacters,
  } = useAuthStore()
  const {
    selected, pings, activeCharId,
    setProfiles, selectProfile, setActiveCharId, setPing,
  } = useProfilesStore()
  const {
    profileSettings, availableJava, dirty, debugConsole, motionMode,
    setProfileSettings, updateRamMb, toggleFlag, setOptionals,
    setSelectedJava, setAvailableJava, setDebugConsole, setMotionMode, markClean,
  } = useSettingsStore()

  const [tab, setTab] = useState<Tab>('home')
  const [characters, setCharacters] = useState<Character[]>(initialCharacters ?? cachedCharacters)
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const [skin, setSkin] = useState('')
  const [authorizingId, setAuthorizingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(initialLoadError)
  const [loadingChars, setLoadingChars] = useState(initialCharacters === undefined && !initialLoadError)
  const [offline, setOffline] = useState(Boolean(initialLoadError))
  const [serverReachable, setServerReachable] = useState<boolean | null>(null)
  const [confirmReinstall, setConfirmReinstall] = useState(false)
  const [pendingMod, setPendingMod] = useState<string | null>(null)
  const [modError, setModError] = useState<{ name: string; message: string } | null>(null)
  const [settingsSave, setSettingsSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const consumedInitial = useRef(false)
  const autoAuthTried = useRef(false)

  const focusBestCharacter = useCallback((items: Character[]) => {
    const active = useProfilesStore.getState().activeCharId
    const last = useAuthStore.getState().lastCharId
    const idx = active ? items.findIndex(character => character.id === active) : items.findIndex(character => character.id === last)
    setIndex(idx >= 0 ? idx : 0)
  }, [])

  const loadCharacters = useCallback(async () => {
    setLoadingChars(true)
    setError(null)
    setOffline(false)
    try {
      const result = await ipc.listCharacters(accountToken ?? '')
      const items = result.items ?? []
      setCharacters(items)
      setCachedCharacters(items)
      focusBestCharacter(items)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      if (classifyRemoteError(message) === 'auth') {
        onSessionInvalid()
        return
      }
      const cached = useAuthStore.getState().cachedCharacters
      setCharacters(cached)
      focusBestCharacter(cached)
      setOffline(true)
      setError(message)
    } finally {
      setLoadingChars(false)
    }
  }, [accountToken, focusBestCharacter, onSessionInvalid, setCachedCharacters])

  useEffect(() => {
    if (consumedInitial.current) return
    consumedInitial.current = true
    if (initialCharacters !== undefined || initialLoadError) {
      const items = initialCharacters ?? cachedCharacters
      setCharacters(items)
      focusBestCharacter(items)
      setLoadingChars(false)
      setOffline(Boolean(initialLoadError))
      setError(initialLoadError)
      return
    }
    void loadCharacters()
  }, [initialCharacters, initialLoadError, cachedCharacters, focusBestCharacter, loadCharacters])

  const current = characters[index]
  useEffect(() => {
    if (!current) {
      setSkin('')
      return
    }
    let cancelled = false
    setSkin('')
    ipc.fetchSkin(current.skinUrl || '/default-skin.png')
      .then(data => { if (!cancelled) setSkin(data) })
      .catch(() => { if (!cancelled) setSkin('/default-skin.png') })
    return () => { cancelled = true }
  }, [current])

  // Preserve the existing dirty-worktree readiness fix: Java/JavaFX can need well
  // over 30 seconds on a cold start, and auth must wait until std is available.
  const waitForBridgeReady = useCallback(async () => {
    const deadline = Date.now() + 120_000
    let lastError: unknown = null
    while (Date.now() < deadline) {
      try {
        const initData = await ipc.init()
        if (initData.authMethods.some(method => method.name === 'std')) return
        lastError = new Error('Auth method std is not available yet')
      } catch (caught) {
        lastError = caught
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw lastError instanceof Error ? lastError : new Error('Java bridge is not ready')
  }, [])

  const authorizeCharacter = useCallback(async (character: Character) => {
    if (!character || !accountToken || offline || authorizingId) return
    setAuthorizingId(character.id)
    setError(null)
    try {
      await waitForBridgeReady()
      const session = await ipc.createSession(accountToken, character.id)
      await ipc.userExit().catch(() => {})
      await ipc.selectAuthMethod('std')
      const authResult = await ipc.authorize('', session.minecraftAccessToken)
      setUser(authResult.user)
      setActiveCharId(character.id)
      setLastCharId(character.id)

      const profilesResult = await ipc.fetchProfiles()
      setProfiles(profilesResult.profiles)
      const profile = profilesResult.profiles[0]
      if (profile) {
        selectProfile(profile)
        const settingsResult = await ipc.makeClientProfileSettings(profile.uuid)
        setProfileSettings({ ...settingsResult.settings, profileUuid: profile.uuid })
        try {
          const pingResult = await ipc.pingServer(profile.uuid)
          setPing(profile.uuid, pingResult.ping)
          setServerReachable(true)
        } catch {
          setServerReachable(false)
        }
      }
      ipc.getAvailableJava().then(result => setAvailableJava(result.java)).catch(() => {})
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      storeSetError(message)
    } finally {
      setAuthorizingId(null)
    }
  }, [
    accountToken, offline, authorizingId, waitForBridgeReady,
    setUser, setActiveCharId, setLastCharId, setProfiles, selectProfile,
    setProfileSettings, setPing, setAvailableJava, storeSetError,
  ])

  useEffect(() => {
    if (autoAuthTried.current || loadingChars || offline || characters.length === 0) return
    if (useProfilesStore.getState().activeCharId) return
    const lastId = useAuthStore.getState().lastCharId
    if (!lastId) return
    const lastCharacter = characters.find(character => character.id === lastId)
    if (!lastCharacter) return
    autoAuthTried.current = true
    setIndex(characters.indexOf(lastCharacter))
    void authorizeCharacter(lastCharacter)
  }, [loadingChars, offline, characters, authorizeCharacter])

  const selectCharacter = useCallback((character: Character, nextIndex: number) => {
    setDirection(nextIndex >= index ? 1 : -1)
    setIndex(nextIndex)
    if (character.id !== activeCharId && !offline) void authorizeCharacter(character)
  }, [index, activeCharId, offline, authorizeCharacter])

  const ready = Boolean(activeCharId && selected && profileSettings) && !offline
  const focusedIsActive = Boolean(current && current.id === activeCharId)
  const ram = profileSettings?.reservedMemoryMb ?? 4096
  const flags = profileSettings?.flags
  const enabledOptionals = profileSettings?.enabledOptionals ?? []
  const ping = selected ? pings[selected.uuid] : undefined
  const mods = (selected?.optionalMods ?? []).filter(mod => mod.visible)

  const handlePrimaryAction = useCallback(() => {
    if (!current || offline || authorizingId) return
    if (!focusedIsActive) {
      void authorizeCharacter(current)
      return
    }
    if (!ready || !selected) return
    if (profileSettings && dirty) {
      ipc.saveClientProfileSettings(profileSettings).then(markClean).catch(() => {})
    }
    onPlay(selected)
  }, [current, offline, authorizingId, focusedIsActive, ready, selected, profileSettings, dirty, authorizeCharacter, markClean, onPlay])

  const handleToggleOptional = useCallback(async (name: string) => {
    if (pendingMod) return
    const currentSettings = useSettingsStore.getState().profileSettings
    if (!currentSettings) return
    const before = currentSettings.enabledOptionals ?? []
    const after = nextOptionalSelection(before, name)
    setModError(null)
    setPendingMod(name)
    setOptionals(after, true)
    try {
      await ipc.saveClientProfileSettings({ ...currentSettings, enabledOptionals: after })
      markClean()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setOptionals(before, false)
      setModError({ name, message })
    } finally {
      setPendingMod(null)
    }
  }, [pendingMod, setOptionals, markClean])

  const saveSettings = useCallback(async () => {
    const settings = useSettingsStore.getState().profileSettings
    if (!settings || settingsSave === 'saving') return
    setSettingsSave('saving')
    setSettingsError(null)
    try {
      await ipc.saveClientProfileSettings(settings)
      markClean()
      setSettingsSave('saved')
      window.setTimeout(() => setSettingsSave('idle'), 1400)
    } catch (caught) {
      setSettingsSave('error')
      setSettingsError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [settingsSave, markClean])

  const accountName = displayName || user?.username || 'Varryal'

  return (
    <motion.div className="vy-launcher" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <header className="vy-launcher-header">
        <div className="vy-wordmark vy-wordmark--compact">
          <img src="/varryal-logo.png" alt="" width={34} height={34} />
          <div><span className="vy-wordmark__name">VARRYAL</span><span className="vy-wordmark__edition">LAUNCHER</span></div>
        </div>
        <nav className="vy-main-nav" aria-label="Основная навигация">
          <NavButton active={tab === 'home'} onClick={() => setTab('home')} icon={<Home size={16} />} label="Главная" />
          <NavButton active={tab === 'mods'} onClick={() => setTab('mods')} icon={<Puzzle size={16} />} label={t('nav.mods')} />
          <NavButton active={tab === 'settings'} onClick={() => setTab('settings')} icon={<Settings size={16} />} label={t('nav.settings')} />
        </nav>
        <div className="vy-account">
          <div><span>{accountName}</span><small>{offline ? 'Офлайн-контекст' : 'Аккаунт Varryal'}</small></div>
          <button className="vy-icon-button" onClick={onLogout} title={t('home.logout')} aria-label={t('home.logout')}><LogOut size={16} /></button>
        </div>
      </header>

      {offline && (
        <div className="vy-offline-banner" role="status">
          <CloudOff size={17} />
          <div><strong>Связь с порталом потеряна</strong><span>{error || 'Проверьте подключение и повторите попытку.'}</span></div>
          <button onClick={() => void loadCharacters()}><RefreshCw size={14} />{t('common.retry')}</button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {tab === 'home' && (
          <motion.main key="home" className="vy-home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <CharacterRail
              characters={characters}
              currentId={current?.id}
              activeId={activeCharId}
              authorizingId={authorizingId}
              disabled={offline}
              onSelect={selectCharacter}
            />

            <section className="vy-character-stage" aria-live="polite">
              {loadingChars && <div className="vy-stage-loader"><Loader2 className="vy-spin" size={30} /><span>Проверяем персонажей…</span></div>}
              {!loadingChars && characters.length === 0 && (
                <EmptyCharacters onRetry={loadCharacters} onLogout={onLogout} />
              )}
              {current && (
                <>
                  <div className="vy-character-stage__halo" aria-hidden="true" />
                  <AnimatePresence mode="wait" custom={direction}>
                    <motion.div
                      className="vy-character-model"
                      key={current.id}
                      custom={direction}
                      initial={{ opacity: 0, x: direction * 34, scale: 0.98 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: direction * -26, scale: 0.99 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {skin ? <SkinPreview skin={skin} model={current.skinModel} width={286} height={430} /> : <Loader2 className="vy-spin" size={28} />}
                    </motion.div>
                  </AnimatePresence>
                  <div className="vy-character-caption">
                    <span className="vy-character-caption__status">{focusedIsActive ? 'Активный персонаж' : 'Выбор персонажа'}</span>
                    <h1>{formatCharacterName(current)}</h1>
                    <p>{current.race?.name}{current.alias ? ` · ${current.alias}` : ''}</p>
                    <small>{current.generatedNickname}</small>
                  </div>
                </>
              )}
            </section>

            <aside className="vy-action-dock">
              <div className="vy-world-status">
                <div className={`vy-status-light${serverReachable === false ? ' is-offline' : ''}`} />
                <div>
                  <span>{selected?.title ?? 'Varryal Main'}</span>
                  <small>
                    {offline || serverReachable === false
                      ? <><WifiOff size={12} />сервер недоступен</>
                      : ping
                        ? <><Wifi size={12} />{ping.online} / {ping.maxOnline} в мире</>
                        : <><Loader2 className="vy-spin" size={12} />проверка сервера</>}
                  </small>
                </div>
              </div>

              {error && !offline && (
                <div className="vy-inline-alert" role="alert">
                  <AlertCircle size={16} /><span>{error}</span>
                  {current && !focusedIsActive && <button onClick={() => void authorizeCharacter(current)}>{t('common.retry')}</button>}
                </div>
              )}

              <div className="vy-action-dock__meta">
                <span>Клиент</span><strong>{selected?.version ?? '26.1.2'}</strong>
                <span>Память</span><strong>{(ram / 1024).toFixed(ram % 1024 === 0 ? 0 : 1)} GB</strong>
                <span>Моды</span><strong>{enabledOptionals.length}</strong>
              </div>

              <motion.button
                className="vy-play-button"
                onClick={handlePrimaryAction}
                disabled={!current || offline || Boolean(authorizingId) || (focusedIsActive && !ready)}
                whileHover={{ y: -1 }}
                whileTap={{ y: 1 }}
              >
                {authorizingId ? <Loader2 className="vy-spin" size={20} /> : <Play size={20} fill="currentColor" />}
                <span>
                  <strong>{authorizingId ? 'Подключаем персонажа…' : focusedIsActive ? t('home.play') : 'ВЫБРАТЬ ПЕРСОНАЖА'}</strong>
                  <small>{offline ? 'Требуется соединение' : focusedIsActive ? 'Войти в мир одним нажатием' : 'Активировать для запуска'}</small>
                </span>
                {!authorizingId && <ChevronRight size={18} />}
              </motion.button>
            </aside>
          </motion.main>
        )}

        {tab === 'mods' && (
          <Workspace key="mods" eyebrow="Профиль клиента" title={t('home.mods')} description="Дополнения сохраняются сразу после переключения.">
            {!ready ? <WorkspaceHint icon={<UserRound size={24} />} text={t('nav.pickFirst')} onHome={() => setTab('home')} /> : mods.length === 0 ? <WorkspaceHint icon={<Puzzle size={24} />} text={t('nav.noMods')} /> : (
              <ModsWorkspace
                mods={mods}
                enabled={enabledOptionals}
                pending={pendingMod}
                error={modError}
                onToggle={handleToggleOptional}
              />
            )}
          </Workspace>
        )}

        {tab === 'settings' && (
          <Workspace key="settings" eyebrow="Клиент и лаунчер" title={t('settings.title')} description="Параметры выбранного профиля и диагностика.">
            {!ready ? <WorkspaceHint icon={<UserRound size={24} />} text={t('nav.pickFirst')} onHome={() => setTab('home')} /> : (
              <SettingsWorkspace
                ram={ram}
                flags={flags}
                availableJava={availableJava}
                selectedJava={profileSettings?.selectedJavaMajor}
                debugConsole={debugConsole}
                motionMode={motionMode}
                dirty={dirty}
                saveState={settingsSave}
                saveError={settingsError}
                confirmReinstall={confirmReinstall}
                onRam={updateRamMb}
                onFullscreen={() => toggleFlag('FULLSCREEN')}
                onJava={setSelectedJava}
                onDebug={setDebugConsole}
                onMotion={setMotionMode}
                onSave={saveSettings}
                onConfirmReinstall={setConfirmReinstall}
                onReinstall={() => { setConfirmReinstall(false); if (selected) onReinstall(selected) }}
              />
            )}
          </Workspace>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return <button className={`vy-nav-button${active ? ' is-active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>
}

function CharacterRail({ characters, currentId, activeId, authorizingId, disabled, onSelect }: {
  characters: Character[]
  currentId?: string
  activeId: string | null
  authorizingId: string | null
  disabled: boolean
  onSelect: (character: Character, index: number) => void
}) {
  return (
    <aside className="vy-character-rail">
      <div className="vy-character-rail__heading"><span>Персонажи</span><small>{characters.length}</small></div>
      <div className="vy-character-rail__list">
        {characters.map((character, index) => {
          const active = character.id === activeId
          const focused = character.id === currentId
          return (
            <button
              key={character.id}
              className={`vy-character-row${focused ? ' is-focused' : ''}${active ? ' is-active' : ''}`}
              onClick={() => onSelect(character, index)}
              disabled={disabled || Boolean(authorizingId)}
            >
              <span className="vy-character-row__portrait">
                {character.skinPreviewUrl ? <img src={character.skinPreviewUrl} alt="" /> : <UserRound size={18} />}
                {active && <i><Check size={9} /></i>}
              </span>
              <span className="vy-character-row__copy">
                <strong>{formatCharacterName(character)}</strong>
                <small>{character.race?.name}{character.alias ? ` · ${character.alias}` : ''}</small>
              </span>
              {authorizingId === character.id ? <Loader2 className="vy-spin" size={14} /> : <ChevronRight size={14} />}
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function EmptyCharacters({ onRetry, onLogout }: { onRetry: () => Promise<void>; onLogout: () => void }) {
  return (
    <div className="vy-empty-state">
      <UserRound size={34} />
      <h2>Нет доступных персонажей</h2>
      <p>Создайте и подтвердите персонажа на портале, затем повторите проверку.</p>
      <div>
        <button className="vy-secondary-action" onClick={() => ipc.openExternalUrl(CREATE_CHARACTER_URL).catch(() => {})}><ExternalLink size={15} />Открыть портал</button>
        <button className="vy-secondary-action" onClick={() => void onRetry()}><RefreshCw size={15} />Проверить снова</button>
        <button className="vy-text-button" onClick={onLogout}>Сменить аккаунт</button>
      </div>
    </div>
  )
}

function Workspace({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return (
    <motion.main className="vy-workspace" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
      <header className="vy-workspace__header"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></header>
      <div className="vy-workspace__body">{children}</div>
    </motion.main>
  )
}

function WorkspaceHint({ icon, text, onHome }: { icon: ReactNode; text: string; onHome?: () => void }) {
  return <div className="vy-workspace-hint">{icon}<p>{text}</p>{onHome && <button className="vy-secondary-action" onClick={onHome}>К персонажам</button>}</div>
}

function ModsWorkspace({ mods, enabled, pending, error, onToggle }: {
  mods: OptionalMod[]
  enabled: string[]
  pending: string | null
  error: { name: string; message: string } | null
  onToggle: (name: string) => Promise<void>
}) {
  const catOf = useCallback((mod: OptionalMod) => mod.category?.trim() || 'Прочее', [])
  const categories = useMemo(() => Array.from(new Set(mods.map(catOf))), [mods, catOf])
  const [active, setActive] = useState(categories[0] ?? '')
  useEffect(() => { if (!categories.includes(active)) setActive(categories[0] ?? '') }, [categories, active])
  const visible = mods.filter(mod => catOf(mod) === active)

  return (
    <div className="vy-mods-layout">
      <nav className="vy-category-nav">
        {categories.map(category => <button key={category} className={active === category ? 'is-active' : ''} onClick={() => setActive(category)}><span>{category}</span><small>{mods.filter(mod => catOf(mod) === category).length}</small></button>)}
      </nav>
      <section className="vy-settings-panel">
        <div className="vy-settings-panel__heading"><div><span>Категория</span><h2>{active}</h2></div><small>{visible.length} дополнений</small></div>
        <div className="vy-mod-list">
          {visible.map(mod => (
            <div className="vy-mod-row" key={mod.name}>
              <div><strong>{mod.name}</strong>{mod.description && <p>{mod.description}</p>}{error?.name === mod.name && <span className="vy-row-error"><AlertCircle size={13} />{error.message}</span>}</div>
              <ToggleSwitch
                value={enabled.includes(mod.name)}
                disabled={Boolean(pending)}
                loading={pending === mod.name}
                onChange={() => void onToggle(mod.name)}
                label={`Переключить ${mod.name}`}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function SettingsWorkspace({
  ram, flags, availableJava, selectedJava, debugConsole, motionMode, dirty,
  saveState, saveError, confirmReinstall,
  onRam, onFullscreen, onJava, onDebug, onMotion, onSave, onConfirmReinstall, onReinstall,
}: {
  ram: number
  flags?: { FULLSCREEN: boolean }
  availableJava: Array<{ index: number; version: number; path: string }>
  selectedJava?: number
  debugConsole: boolean
  motionMode: MotionMode
  dirty: boolean
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  saveError: string | null
  confirmReinstall: boolean
  onRam: (value: number) => void
  onFullscreen: () => void
  onJava: (version: number, path: string) => void
  onDebug: (value: boolean) => void
  onMotion: (mode: MotionMode) => void
  onSave: () => Promise<void>
  onConfirmReinstall: (value: boolean) => void
  onReinstall: () => void
}) {
  return (
    <div className="vy-settings-grid">
      <section className="vy-settings-panel vy-settings-panel--wide">
        <div className="vy-settings-panel__heading"><div><span>Производительность</span><h2>Параметры игры</h2></div><Cpu size={19} /></div>
        <SettingRow icon={<Monitor size={17} />} title="Оперативная память" description="Рекомендуется 4–8 GB для основного профиля.">
          <div className="vy-range-control"><input type="range" min={1024} max={16384} step={512} value={ram} onChange={event => onRam(Number(event.target.value))} /><strong>{(ram / 1024).toFixed(ram % 1024 === 0 ? 0 : 1)} GB</strong></div>
        </SettingRow>
        {availableJava.length > 0 && (
          <SettingRow icon={<Coffee size={17} />} title="Java" description="Среда запуска выбранного профиля.">
            <div className="vy-segmented">{availableJava.map(java => <button key={java.index} className={selectedJava === java.version ? 'is-active' : ''} onClick={() => onJava(java.version, java.path)}>Java {java.version}</button>)}</div>
          </SettingRow>
        )}
        <SettingRow icon={<Monitor size={17} />} title="Полноэкранный режим" description="Запускать игровой клиент сразу на весь экран.">
          <ToggleSwitch value={Boolean(flags?.FULLSCREEN)} onChange={onFullscreen} label="Полноэкранный режим" />
        </SettingRow>
      </section>

      <section className="vy-settings-panel">
        <div className="vy-settings-panel__heading"><div><span>Лаунчер</span><h2>Поведение</h2></div><Settings size={19} /></div>
        <SettingRow icon={<Terminal size={17} />} title="Консоль игры" description="Оставить launcher открытым и показывать debug output.">
          <ToggleSwitch value={debugConsole} onChange={() => onDebug(!debugConsole)} label="Консоль игры" />
        </SettingRow>
        <SettingRow icon={<Monitor size={17} />} title="Движение" description="Системное значение учитывает настройки Windows.">
          <div className="vy-segmented vy-segmented--motion">
            {(['system', 'full', 'reduced'] as MotionMode[]).map(mode => <button key={mode} className={motionMode === mode ? 'is-active' : ''} onClick={() => onMotion(mode)}>{mode === 'system' ? 'Система' : mode === 'full' ? 'Полное' : 'Сниженное'}</button>)}
          </div>
        </SettingRow>
      </section>

      <section className="vy-settings-panel vy-settings-panel--danger">
        <div className="vy-settings-panel__heading"><div><span>Диагностика</span><h2>Восстановление клиента</h2></div><Wrench size={19} /></div>
        <p className="vy-panel-copy">Переустановка удалит локальные файлы профиля и загрузит проверенную копию заново. Настройки аккаунта сохранятся.</p>
        {!confirmReinstall ? (
          <button className="vy-danger-action" onClick={() => onConfirmReinstall(true)}><RotateCcw size={15} />Переустановить клиент</button>
        ) : (
          <div className="vy-confirm-row"><strong>Удалить локальные файлы клиента?</strong><button className="vy-danger-action" onClick={onReinstall}>Да, переустановить</button><button className="vy-text-button" onClick={() => onConfirmReinstall(false)}>Отмена</button></div>
        )}
      </section>

      <footer className="vy-settings-savebar">
        <div>{saveError && <span className="vy-row-error"><AlertCircle size={13} />{saveError}</span>}{!saveError && <span>{dirty ? 'Есть несохранённые изменения' : saveState === 'saved' ? 'Настройки сохранены' : 'Все изменения сохранены'}</span>}</div>
        <button className="vy-secondary-action vy-secondary-action--bright" onClick={() => void onSave()} disabled={!dirty || saveState === 'saving'}>
          {saveState === 'saving' ? <Loader2 className="vy-spin" size={15} /> : saveState === 'saved' ? <Check size={15} /> : <Save size={15} />}
          {saveState === 'saving' ? 'Сохраняем…' : saveState === 'saved' ? 'Сохранено' : 'Сохранить'}
        </button>
      </footer>
    </div>
  )
}

function SettingRow({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return <div className="vy-setting-row"><span className="vy-setting-row__icon">{icon}</span><div className="vy-setting-row__copy"><strong>{title}</strong><p>{description}</p></div><div className="vy-setting-row__control">{children}</div></div>
}

function ToggleSwitch({ value, onChange, disabled = false, loading = false, label }: { value: boolean; onChange: () => void; disabled?: boolean; loading?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={value} aria-label={label} disabled={disabled} className={`vy-switch${value ? ' is-on' : ''}`} onClick={onChange}>
      <span>{loading ? <Loader2 className="vy-spin" size={12} /> : null}</span>
    </button>
  )
}
