import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  User, Settings, Puzzle, Play, LogOut, ChevronLeft, ChevronRight,
  Loader2, AlertCircle, Check, Cpu, Coffee, Wifi, WifiOff, ExternalLink,
} from 'lucide-react'
import { ipc } from '../ipc/client'
import { useAuthStore } from '../store/auth'
import { useProfilesStore } from '../store/profiles'
import { useSettingsStore } from '../store/settings'
import { SkinPreview } from '../components/SkinPreview'
import type { Character, ClientProfile, OptionalMod } from '../ipc/types'
import { CREATE_CHARACTER_URL } from '../config'

type Tab = 'character' | 'settings' | 'mods'

interface LauncherProps {
  onPlay: (profile: ClientProfile) => void
  onLogout: () => void
}

export function Launcher({ onPlay, onLogout }: LauncherProps) {
  const { t } = useTranslation()
  const { user, accountToken, displayName, setUser, setError: storeSetError } = useAuthStore()
  const { selected, pings, setProfiles, selectProfile, setPing } = useProfilesStore()
  const { profileSettings, availableJava, debugConsole, setProfileSettings, updateRamMb, toggleFlag, toggleOptional, setSelectedJava, setAvailableJava, setDebugConsole } = useSettingsStore()

  const [tab, setTab] = useState<Tab>('character')
  const [characters, setCharacters] = useState<Character[]>([])
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState(1)
  const [skin, setSkin] = useState('')
  const [activeCharId, setActiveCharId] = useState<string | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingChars, setLoadingChars] = useState(true)

  // ── Load characters ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoadingChars(true); setError(null)
    ipc.listCharacters(accountToken ?? '')
      .then(res => { if (!cancelled) { setCharacters(res.items ?? []); setIndex(0) } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoadingChars(false) })
    return () => { cancelled = true }
  }, [accountToken])

  // ── Focused character skin (3D) ──────────────────────────────────────────────
  const current = characters[index]
  useEffect(() => {
    if (!current) return
    let cancelled = false
    setSkin('')
    ipc.fetchSkin(current.skinUrl || '/default-skin.png')
      .then(d => { if (!cancelled) setSkin(d) })
      .catch(() => { if (!cancelled) setSkin('/default-skin.png') })
    return () => { cancelled = true }
  }, [current])

  const flip = useCallback((delta: number) => {
    if (characters.length < 2) return
    setDir(delta)
    setIndex(i => (i + delta + characters.length) % characters.length)
  }, [characters.length])

  // ── Authorize as the focused character ───────────────────────────────────────
  const authorizeChar = useCallback(async () => {
    const char = characters[index]
    if (!char || !accountToken) return
    setAuthorizing(true); setError(null)
    try {
      const session = await ipc.createSession(accountToken, char.id)
      // Clear any prior bridge session (e.g. after the game exited/crashed) so
      // re-authorizing a character doesn't fail with "You are already logged in".
      await ipc.userExit().catch(() => {})
      await ipc.selectAuthMethod('std')
      const authRes = await ipc.authorize('', session.minecraftAccessToken)
      setUser(authRes.user)
      setActiveCharId(char.id)
      // Load server profile + settings now that we have an authorized session.
      const pr = await ipc.fetchProfiles()
      setProfiles(pr.profiles)
      const p = pr.profiles[0]
      if (p) {
        selectProfile(p)
        ipc.makeClientProfileSettings(p.uuid).then(r => setProfileSettings({ ...r.settings, profileUuid: p.uuid })).catch(() => {})
        ipc.pingServer(p.uuid).then(pp => setPing(p.uuid, pp.ping)).catch(() => {})
      }
      ipc.getAvailableJava().then(r => setAvailableJava(r.java)).catch(() => {})
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg); storeSetError(msg)
    } finally {
      setAuthorizing(false)
    }
  }, [characters, index, accountToken, setUser, storeSetError, setProfiles, selectProfile, setProfileSettings, setPing, setAvailableJava])

  const ready = !!activeCharId && !!selected && !!profileSettings
  const handlePlay = useCallback(() => {
    if (!ready || !selected) return
    if (profileSettings) ipc.saveClientProfileSettings(profileSettings).catch(() => {})
    onPlay(selected)
  }, [ready, selected, profileSettings, onPlay])

  const ram = profileSettings?.reservedMemoryMb ?? 4096
  const flags = profileSettings?.flags
  const enabledOptionals = profileSettings?.enabledOptionals ?? []
  const ping = selected ? pings[selected.uuid] : undefined
  const mods = (selected?.optionalMods ?? []).filter(m => m.visible)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'transparent', minHeight: 0 }}
    >
      {/* ── Navbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 22px',
        borderBottom: '1px solid var(--border)', background: 'rgba(10,13,18,0.6)', backdropFilter: 'blur(10px)',
      }}>
        <img src="/varryal-logo.png" alt="" width={28} height={28} style={{ filter: 'drop-shadow(0 0 8px rgba(101,212,223,0.4))' }} />
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, color: 'var(--text-hi)', letterSpacing: 0.5, marginRight: 14 }}>Varryal</span>

        <nav style={{ display: 'flex', gap: 4 }}>
          <NavTab active={tab === 'character'} onClick={() => setTab('character')} icon={<User size={15} />}>{t('nav.character')}</NavTab>
          <NavTab active={tab === 'settings'} onClick={() => setTab('settings')} icon={<Settings size={15} />} disabled={!ready}>{t('nav.settings')}</NavTab>
          <NavTab active={tab === 'mods'} onClick={() => setTab('mods')} icon={<Puzzle size={15} />} disabled={!ready}>{t('nav.mods')}</NavTab>
        </nav>

        <div style={{ flex: 1 }} />
        {(displayName || user?.username) && <span style={{ fontSize: 13, color: 'var(--text-mid)' }}>{displayName || user?.username}</span>}
        <HoverIcon onClick={onLogout} title={t('home.logout')}><LogOut size={16} /></HoverIcon>
      </div>

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative', minHeight: 0 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.16 }}
            style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}
          >
            {tab === 'character' && (
              <CharacterTab
                t={t} loading={loadingChars} error={error} characters={characters} index={index}
                current={current} skin={skin} dir={dir} activeCharId={activeCharId} authorizing={authorizing}
                onFlip={flip} onAuthorize={authorizeChar}
              />
            )}
            {tab === 'settings' && (
              ready ? (
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Panel icon={<Cpu size={15} />} title={t('settings.ram')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <input type="range" min={1024} max={16384} step={512} value={ram}
                        onChange={e => updateRamMb(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--primary)' }} />
                      <span style={{ minWidth: 84, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-hi)', fontWeight: 600 }}>
                        {(ram / 1024).toFixed(ram % 1024 === 0 ? 0 : 1)} GB
                      </span>
                    </div>
                  </Panel>
                  {availableJava.length > 0 && (
                    <Panel icon={<Coffee size={15} />} title={t('settings.java')}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {availableJava.map(j => {
                          const sel = profileSettings?.selectedJavaMajor === j.version
                          return (
                            <button key={j.index} onClick={() => setSelectedJava(j.version, j.path)} style={{
                              padding: '6px 16px', borderRadius: 'var(--radius-control)',
                              background: sel ? 'var(--primary)' : 'var(--bg-elev-3)',
                              color: sel ? 'var(--on-primary)' : 'var(--text-mid)',
                              border: `1px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                              fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            }}>Java {j.version}</button>
                          )
                        })}
                      </div>
                    </Panel>
                  )}
                  {flags && (
                    <Panel title={t('settings.flags')}>
                      <Toggle label={t('settings.fullscreen')} value={flags.FULLSCREEN} onChange={() => toggleFlag('FULLSCREEN')} />
                    </Panel>
                  )}
                  <Panel title={t('settings.launcher')}>
                    <Toggle label={t('settings.debugConsole')} description={t('settings.debugConsoleHint')}
                      value={debugConsole} onChange={() => setDebugConsole(!debugConsole)} />
                  </Panel>
                </div>
              ) : <Hint>{t('nav.pickFirst')}</Hint>
            )}
            {tab === 'mods' && (
              ready ? (
                mods.length > 0
                  ? <ModsTab t={t} mods={mods} enabled={enabledOptionals} onToggle={toggleOptional} />
                  : <Hint>{t('nav.noMods')}</Hint>
              ) : <Hint>{t('nav.pickFirst')}</Hint>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Play bar ── */}
      <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', background: 'rgba(10,13,18,0.65)', backdropFilter: 'blur(10px)' }}>
        <motion.button
          onClick={handlePlay} disabled={!ready}
          whileHover={ready ? { scale: 1.012 } : undefined} whileTap={ready ? { scale: 0.985 } : undefined}
          style={{
            width: '100%', height: 44,
            background: ready ? 'linear-gradient(180deg, var(--primary), var(--accent))' : 'var(--bg-elev-3)',
            color: 'var(--on-primary)',
            clipPath: 'var(--cut-corners)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, letterSpacing: 0.5,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.5,
            boxShadow: ready ? '0 6px 20px -9px rgba(209,137,72,0.6)' : 'none',
          }}
        >
          <Play size={18} />
          {ready ? t('home.play') : t('nav.pickFirst')}
        </motion.button>
      </div>
    </motion.div>
  )
}

// ── Character tab ────────────────────────────────────────────────────────────

function CharacterTab({ t, loading, error, characters, index, current, skin, dir, activeCharId, authorizing, onFlip, onAuthorize }: {
  t: (k: string) => string; loading: boolean; error: string | null; characters: Character[]; index: number
  current?: Character; skin: string; dir: number; activeCharId: string | null; authorizing: boolean
  onFlip: (d: number) => void; onAuthorize: () => void
}) {
  const isActive = current && activeCharId === current.id
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '16px 24px' }}>
      {loading && <Loader2 size={30} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--error)', fontSize: 13, background: 'rgba(255,154,128,0.1)', padding: '10px 14px', borderRadius: 'var(--radius-control)' }}>
          <AlertCircle size={14} />{error}
        </div>
      )}
      {!loading && characters.length === 0 && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <p style={{ color: 'var(--text-mid)', fontSize: 14, textAlign: 'center', maxWidth: 320 }}>{t('characterSelect.empty')}</p>
          <button
            onClick={() => ipc.openExternalUrl(CREATE_CHARACTER_URL).catch(() => {})}
            style={{
              height: 42, padding: '0 22px', borderRadius: 'var(--radius-control)',
              background: 'var(--primary)', color: 'var(--on-primary)', clipPath: 'var(--cut-corners)',
              fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            }}
          >
            <ExternalLink size={16} />{t('characterSelect.createOnSite')}
          </button>
        </div>
      )}
      {characters.length > 0 && current && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ArrowBtn dir="left" disabled={characters.length < 2} onClick={() => onFlip(-1)} />
            <div style={{
              width: 300, height: 404, position: 'relative',
              background: 'linear-gradient(180deg, var(--bg-elev-1), var(--bg-elev-2))',
              border: `1px solid ${isActive ? 'var(--primary)' : 'var(--border-strong)'}`,
              clipPath: 'var(--cut-corners)', boxShadow: 'var(--glow-primary)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 18px 16px', overflow: 'hidden',
            }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                <AnimatePresence mode="wait">
                  <motion.div key={current.id} custom={dir}
                    initial={{ opacity: 0, x: dir * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -40 }} transition={{ duration: 0.22 }}>
                    {skin
                      ? <SkinPreview skin={skin} model={current.skinModel} width={188} height={268} />
                      : <div style={{ width: 188, height: 268, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Loader2 size={26} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
                        </div>}
                  </motion.div>
                </AnimatePresence>
              </div>
              <div style={{ textAlign: 'center', width: '100%' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, color: 'var(--text-hi)' }}>{current.name || current.generatedNickname}</div>
                <div style={{ fontSize: 11, color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{current.generatedNickname}</div>
                <div style={{ fontSize: 13, color: 'var(--primary)', marginTop: 7 }}>{current.race?.name}{current.alias ? ` · ${current.alias}` : ''}</div>
              </div>
            </div>
            <ArrowBtn dir="right" disabled={characters.length < 2} onClick={() => onFlip(1)} />
          </div>

          {characters.length > 1 && (
            <div style={{ display: 'flex', gap: 7 }}>
              {characters.map((c, i) => (
                <span key={c.id} style={{ width: i === index ? 18 : 7, height: 7, borderRadius: 4, background: i === index ? 'var(--primary)' : 'var(--border-strong)', transition: 'width 0.2s, background 0.2s' }} />
              ))}
            </div>
          )}

          <motion.button onClick={onAuthorize} disabled={authorizing || isActive}
            whileHover={!authorizing && !isActive ? { scale: 1.03 } : undefined} whileTap={!authorizing && !isActive ? { scale: 0.97 } : undefined}
            style={{
              width: 260, height: 46, marginTop: 2, borderRadius: 'var(--radius-control)',
              background: isActive ? 'var(--bg-elev-3)' : 'var(--primary)', color: isActive ? 'var(--success)' : 'var(--on-primary)',
              clipPath: 'var(--cut-corners)', fontWeight: 600, fontSize: 15,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
              cursor: isActive ? 'default' : 'pointer', opacity: authorizing ? 0.7 : 1,
            }}>
            {authorizing
              ? <><Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} />{t('characterSelect.authorizing')}</>
              : isActive
                ? <><Check size={17} />{t('nav.active')}</>
                : <><Play size={16} />{t('characterSelect.enter')}</>}
          </motion.button>
        </>
      )}
    </div>
  )
}

// ── Optional-mods tab (category sub-tabs) ─────────────────────────────────────

function ModsTab({ t, mods, enabled, onToggle }: {
  t: (k: string) => string; mods: OptionalMod[]; enabled: string[]; onToggle: (name: string) => void
}) {
  const catOf = useCallback((m: OptionalMod) => m.category?.trim() || t('mods.uncategorized'), [t])
  const categories = useMemo(() => {
    const seen: string[] = []
    for (const m of mods) { const c = catOf(m); if (!seen.includes(c)) seen.push(c) }
    return seen
  }, [mods, catOf])

  const [active, setActive] = useState<string>(categories[0] ?? '')
  useEffect(() => {
    if (!categories.includes(active)) setActive(categories[0] ?? '')
  }, [categories, active])

  const showTabs = categories.length > 1
  const visible = mods.filter(m => catOf(m) === active)

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {showTabs && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {categories.map(cat => {
            const sel = cat === active
            return (
              <button key={cat} onClick={() => setActive(cat)} style={{
                padding: '6px 14px', borderRadius: 'var(--radius-control)',
                background: sel ? 'var(--primary)' : 'var(--bg-elev-3)',
                color: sel ? 'var(--on-primary)' : 'var(--text-mid)',
                border: `1px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>{cat}</button>
            )
          })}
        </div>
      )}
      <Panel icon={<Puzzle size={15} />} title={showTabs ? active : t('home.mods')}>
        {visible.map(mod => (
          <Toggle key={mod.name} label={mod.name} description={mod.description}
            value={enabled.includes(mod.name)} onChange={() => onToggle(mod.name)} />
        ))}
      </Panel>
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function NavTab({ active, onClick, icon, children, disabled }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="vy-tab" style={{
      display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 'var(--radius-control)',
      background: active ? 'var(--bg-elev-2)' : 'transparent',
      color: active ? 'var(--primary)' : 'var(--text-mid)',
      fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`,
      transition: 'color 0.15s, background 0.15s',
    }}>{icon}{children}</button>
  )
}

function ArrowBtn({ dir, onClick, disabled }: { dir: 'left' | 'right'; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="vy-round" style={{
      width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
      color: disabled ? 'var(--text-lo)' : 'var(--text-hi)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, flexShrink: 0,
    }}>{dir === 'left' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}</button>
  )
}

function HoverIcon({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="vy-round" style={{
      width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'transparent', color: 'var(--text-mid)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    }}>{children}</button>
  )
}

function Panel({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <div style={{ padding: '16px 18px', background: 'var(--bg-elev-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, color: 'var(--text-lo)' }}>
        {icon}<span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}

function Toggle({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: () => void }) {
  return (
    <div onClick={onChange} className="vy-toggle" style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', userSelect: 'none', padding: '4px 0' }}>
      <div style={{
        width: 40, height: 23, borderRadius: 12, flexShrink: 0,
        background: value ? 'var(--primary)' : 'var(--bg-elev-3)', border: `1px solid ${value ? 'var(--primary)' : 'var(--border)'}`,
        position: 'relative', transition: 'background 0.2s',
      }}>
        <div style={{ position: 'absolute', top: 2, left: value ? 18 : 2, width: 17, height: 17, borderRadius: '50%', background: value ? 'var(--on-primary)' : 'var(--text-mid)', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-hi)' }}>{label}</div>
        {description && <div style={{ fontSize: 11, color: 'var(--text-lo)', marginTop: 1 }}>{description}</div>}
      </div>
    </div>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-mid)', fontSize: 14, padding: 40 }}>{children}</div>
}
