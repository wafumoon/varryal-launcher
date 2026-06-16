import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Play, LogOut, UserCog, Cpu, Coffee, Puzzle, Wifi, WifiOff } from 'lucide-react'
import { ipc } from '../ipc/client'
import { useAuthStore } from '../store/auth'
import { useProfilesStore } from '../store/profiles'
import { useSettingsStore } from '../store/settings'
import type { ClientProfile } from '../ipc/types'

interface HomeProps {
  onPlay: (profile: ClientProfile) => void
  onSwitchCharacter: () => void
  onLogout: () => void
}

export function Home({ onPlay, onSwitchCharacter, onLogout }: HomeProps) {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const { selected, pings, setProfiles, selectProfile, setPing } = useProfilesStore()
  const { profileSettings, availableJava, setProfileSettings, updateRamMb, toggleFlag, toggleOptional, setSelectedJava, setAvailableJava } = useSettingsStore()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ipc.fetchProfiles()
      .then(res => {
        setProfiles(res.profiles)
        const p = res.profiles[0]
        if (p) {
          selectProfile(p)
          ipc.makeClientProfileSettings(p.uuid)
            .then(r => setProfileSettings({ ...r.settings, profileUuid: p.uuid }))
            .catch(() => {})
          ipc.pingServer(p.uuid).then(pr => setPing(p.uuid, pr.ping)).catch(() => {})
        }
        ipc.getAvailableJava().then(r => setAvailableJava(r.java)).catch(() => {})
      })
      .catch(e => setError(String(e)))
  }, [])

  const handleLogout = useCallback(async () => {
    try { await ipc.userExit() } catch {}
    onLogout()
  }, [onLogout])

  const handlePlay = useCallback(() => {
    if (!selected) return
    if (profileSettings) ipc.saveClientProfileSettings(profileSettings).catch(() => {})
    onPlay(selected)
  }, [selected, profileSettings, onPlay])

  const ram = profileSettings?.reservedMemoryMb ?? 4096
  const flags = profileSettings?.flags
  const enabledOptionals = profileSettings?.enabledOptionals ?? []
  const ping = selected ? pings[selected.uuid] : undefined
  const mods = (selected?.optionalMods ?? []).filter(m => m.visible)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'transparent' }}
    >
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 22px',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(10,13,18,0.55)',
        backdropFilter: 'blur(8px)',
      }}>
        <img src="/varryal-logo.png" alt="" width={30} height={30} style={{ filter: 'drop-shadow(0 0 8px rgba(101,212,223,0.35))' }} />
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--text-hi)', letterSpacing: 0.5 }}>Varryal</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--text-mid)' }}>{user?.username}</span>
        <IconBtn onClick={onSwitchCharacter} title={t('home.switchCharacter')}><UserCog size={16} /></IconBtn>
        <IconBtn onClick={handleLogout} title={t('home.logout')}><LogOut size={16} /></IconBtn>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div style={{ color: 'var(--error)', fontSize: 13 }}>{error}</div>}

        {/* Server banner */}
        {selected && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '16px 20px',
            background: 'linear-gradient(120deg, var(--bg-elev-2), var(--bg-elev-1))',
            border: '1px solid var(--border-strong)',
            clipPath: 'var(--cut-corners)',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--text-hi)' }}>{selected.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 3 }}>
                {selected.serverAddress}:{selected.serverPort} · Minecraft {selected.version}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              {ping ? (
                <>
                  <Wifi size={15} color="var(--success)" />
                  <span style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>{ping.online}/{ping.maxOnline}</span>
                </>
              ) : (
                <><WifiOff size={15} color="var(--text-lo)" /><span style={{ fontSize: 13, color: 'var(--text-lo)' }}>—</span></>
              )}
            </div>
          </div>
        )}

        {/* Settings */}
        <Panel icon={<Cpu size={15} />} title={t('settings.ram')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <input type="range" min={1024} max={16384} step={512} value={ram}
              onChange={e => updateRamMb(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--primary)' }} />
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

        {/* Game options (flags) */}
        {flags && (
          <Panel title={t('settings.flags')}>
            <Toggle label={t('settings.autoEnter')} value={flags.AUTO_ENTER} onChange={() => toggleFlag('AUTO_ENTER')} />
            <Toggle label={t('settings.fullscreen')} value={flags.FULLSCREEN} onChange={() => toggleFlag('FULLSCREEN')} />
          </Panel>
        )}

        {/* Optional mods */}
        {mods.length > 0 && (
          <Panel icon={<Puzzle size={15} />} title={t('home.mods')}>
            {mods.map(mod => (
              <Toggle
                key={mod.name}
                label={mod.name}
                description={mod.description}
                value={enabledOptionals.includes(mod.name)}
                onChange={() => toggleOptional(mod.name)}
              />
            ))}
          </Panel>
        )}
      </div>

      {/* ── Play bar ── */}
      <div style={{
        padding: '14px 22px',
        borderTop: '1px solid var(--border)',
        background: 'rgba(10,13,18,0.6)',
        backdropFilter: 'blur(8px)',
      }}>
        <button onClick={handlePlay} disabled={!selected} style={{
          width: '100%', height: 50,
          background: 'var(--primary)', color: 'var(--on-primary)',
          clipPath: 'var(--cut-corners)',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, letterSpacing: 0.5,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          cursor: selected ? 'pointer' : 'default', opacity: selected ? 1 : 0.5,
        }}>
          <Play size={20} />
          {t('home.play')}
        </button>
      </div>
    </motion.div>
  )
}

// ── Bits ──────────────────────────────────────────────────────────────────────

function Panel({ icon, title, children }: { icon?: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '16px 18px',
      background: 'var(--bg-elev-1)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-card)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, color: 'var(--text-lo)' }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}

function Toggle({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: () => void }) {
  return (
    <div onClick={onChange} style={{
      display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', userSelect: 'none',
    }}>
      <div style={{
        width: 40, height: 23, borderRadius: 12, flexShrink: 0,
        background: value ? 'var(--primary)' : 'var(--bg-elev-3)',
        border: `1px solid ${value ? 'var(--primary)' : 'var(--border)'}`,
        position: 'relative', transition: 'background 0.2s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: value ? 18 : 2,
          width: 17, height: 17, borderRadius: '50%',
          background: value ? 'var(--on-primary)' : 'var(--text-mid)',
          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-hi)' }}>{label}</div>
        {description && <div style={{ fontSize: 11, color: 'var(--text-lo)', marginTop: 1 }}>{description}</div>}
      </div>
    </div>
  )
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 34, height: 34, borderRadius: 'var(--radius-control)',
      background: 'transparent', color: 'var(--text-mid)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    }}>{children}</button>
  )
}
