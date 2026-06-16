import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Save, Check } from 'lucide-react'
import { ipc } from '../ipc/client'
import { useSettingsStore } from '../store/settings'
import type { ClientProfile } from '../ipc/types'

interface SettingsPanelProps {
  profile: ClientProfile
  onBack: () => void
}

export function SettingsPanel({ profile, onBack }: SettingsPanelProps) {
  const { t } = useTranslation()
  const { profileSettings, availableJava, dirty, setProfileSettings, updateRamMb, toggleFlag, setAvailableJava, markClean } = useSettingsStore()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Load settings and java list on mount
    ipc.makeClientProfileSettings(profile.uuid)
      .then(res => setProfileSettings({ ...res.settings, profileUuid: profile.uuid }))
      .catch(() => {})
    ipc.getAvailableJava()
      .then(res => setAvailableJava(res.java))
      .catch(() => {})
  }, [profile.uuid])

  const handleSave = useCallback(async () => {
    if (!profileSettings) return
    setSaving(true)
    try {
      await ipc.saveClientProfileSettings(profileSettings)
      markClean()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }, [profileSettings, markClean])

  const ram = profileSettings?.reservedMemoryMb ?? 2048
  const flags = profileSettings?.flags ?? {
    AUTO_ENTER: false, FULLSCREEN: false, LINUX_WAYLAND_SUPPORT: false, DEBUG_SKIP_FILE_MONITOR: false,
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.18 }}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elev-1)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onBack} style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'transparent', color: 'var(--text-mid)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ArrowLeft size={16} />
        </button>
        <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-hi)', fontSize: 16 }}>
          {t('settings.title')} — {profile.title}
        </span>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            height: 34, padding: '0 14px',
            borderRadius: 'var(--radius-control)',
            background: saved ? 'var(--success)' : 'var(--primary)',
            color: 'var(--on-primary)',
            display: 'flex', alignItems: 'center', gap: 7,
            fontSize: 13, fontWeight: 500,
            opacity: !dirty || saving ? 0.5 : 1,
            transition: 'background 0.3s, opacity 0.15s',
          }}
        >
          {saved ? <Check size={13} /> : <Save size={13} />}
          {saved ? t('settings.saved') : t('settings.save')}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* RAM slider */}
        <Section title={t('settings.ram')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <input
              type="range"
              min={512} max={16384} step={512}
              value={ram}
              onChange={e => updateRamMb(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--primary)' }}
            />
            <span style={{
              minWidth: 80, textAlign: 'right',
              fontFamily: 'var(--font-mono)', fontSize: 13,
              color: 'var(--text-hi)', fontWeight: 500,
            }}>
              {ram} MB
            </span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-lo)', marginTop: 6 }}>{t('settings.ramHint')}</p>
        </Section>

        {/* Java selection */}
        {availableJava.length > 0 && (
          <Section title={t('settings.java')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {availableJava.map(j => (
                <button
                  key={j.index}
                  onClick={() => {
                    if (profileSettings) {
                      setProfileSettings({ ...profileSettings, selectedJavaMajor: j.version, selectedJavaPath: j.path })
                    }
                  }}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-control)',
                    background: profileSettings?.selectedJavaMajor === j.version ? 'var(--primary)' : 'var(--bg-elev-3)',
                    color: profileSettings?.selectedJavaMajor === j.version ? 'var(--on-primary)' : 'var(--text-mid)',
                    fontSize: 13, fontWeight: 500,
                    border: '1px solid var(--border)',
                  }}
                >
                  Java {j.version}
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Flags */}
        <Section title={t('settings.flags')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <FlagToggle
              label={t('settings.autoEnter')}
              value={flags.AUTO_ENTER}
              onChange={() => toggleFlag('AUTO_ENTER')}
            />
            <FlagToggle
              label={t('settings.fullscreen')}
              value={flags.FULLSCREEN}
              onChange={() => toggleFlag('FULLSCREEN')}
            />
            <FlagToggle
              label={t('settings.waylandSupport')}
              value={flags.LINUX_WAYLAND_SUPPORT}
              onChange={() => toggleFlag('LINUX_WAYLAND_SUPPORT')}
            />
          </div>
        </Section>

        {/* Optional mods */}
        {profile.optionalMods.length > 0 && (
          <Section title="Optional Mods">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {profile.optionalMods.filter(m => m.visible).map(mod => (
                <div key={mod.name} style={{
                  padding: '10px 14px',
                  background: 'var(--bg-elev-2)',
                  borderRadius: 'var(--radius-control)',
                  border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-hi)' }}>{mod.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-lo)', marginTop: 2 }}>{mod.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </motion.div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function FlagToggle({ label, value, onChange }: { label: string; value: boolean; onChange: () => void }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 12,
      cursor: 'pointer', userSelect: 'none',
    }}>
      <div
        onClick={onChange}
        style={{
          width: 38, height: 22,
          borderRadius: 11,
          background: value ? 'var(--primary)' : 'var(--bg-elev-3)',
          border: `1px solid ${value ? 'var(--primary)' : 'var(--border)'}`,
          position: 'relative',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute',
          top: 2, left: value ? 18 : 2,
          width: 16, height: 16,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      <span style={{ fontSize: 13, color: 'var(--text-hi)' }}>{label}</span>
    </label>
  )
}
