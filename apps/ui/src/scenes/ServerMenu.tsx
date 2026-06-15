import { useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Play, Settings, LogOut, Users, Wifi, WifiOff } from 'lucide-react'
import { ipc } from '../ipc/client'
import { useAuthStore } from '../store/auth'
import { useProfilesStore } from '../store/profiles'
import type { ClientProfile } from '../ipc/types'

interface ServerMenuProps {
  onPlay: (profile: ClientProfile) => void
  onSettings: (profile: ClientProfile) => void
  onLogout: () => void
}

export function ServerMenu({ onPlay, onSettings, onLogout }: ServerMenuProps) {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const { profiles, selected, loading, error, pings, setProfiles, selectProfile, setLoading, setError, setPing } = useProfilesStore()

  // Fetch profiles on mount
  useEffect(() => {
    setLoading(true)
    ipc.fetchProfiles()
      .then(res => {
        setProfiles(res.profiles)
        if (res.profiles.length > 0) selectProfile(res.profiles[0])
        // Ping each server
        res.profiles.forEach(p => {
          ipc.pingServer(p.uuid).then(pr => setPing(p.uuid, pr.ping)).catch(() => {})
        })
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const handleLogout = useCallback(async () => {
    try { await ipc.userExit() } catch {}
    onLogout()
  }, [onLogout])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* Top bar */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elev-1)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-hi)', fontSize: 16 }}>
          {t('serverMenu.title')}
        </span>
        <span style={{ color: 'var(--text-mid)', fontSize: 13 }}>{user?.username}</span>
        <IconBtn onClick={handleLogout} title={t('serverMenu.logout')}><LogOut size={15} /></IconBtn>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {loading && <CenteredMsg>{t('common.loading')}</CenteredMsg>}
        {error && <CenteredMsg color="var(--error)">{error}</CenteredMsg>}
        {!loading && !error && profiles.length === 0 && (
          <CenteredMsg color="var(--text-mid)">No profiles available</CenteredMsg>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {profiles.map(p => (
            <ProfileCard
              key={p.uuid}
              profile={p}
              selected={selected?.uuid === p.uuid}
              ping={pings[p.uuid]}
              onClick={() => selectProfile(p)}
            />
          ))}
        </div>
      </div>

      {/* Action bar */}
      {selected && (
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elev-1)',
          display: 'flex', gap: 10,
        }}>
          <button
            onClick={() => onSettings(selected)}
            style={{
              height: 38, padding: '0 16px',
              borderRadius: 'var(--radius-control)',
              background: 'var(--bg-elev-3)',
              color: 'var(--text-hi)',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 13, fontWeight: 500,
            }}
          >
            <Settings size={14} />
            {t('serverMenu.settings')}
          </button>
          <button
            onClick={() => onPlay(selected)}
            style={{
              flex: 1, height: 38,
              borderRadius: 'var(--radius-control)',
              background: 'var(--primary)',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontSize: 14, fontWeight: 600,
            }}
          >
            <Play size={15} />
            {t('serverMenu.play')}
          </button>
        </div>
      )}
    </motion.div>
  )
}

function ProfileCard({ profile, selected, ping, onClick }: {
  profile: ClientProfile
  selected: boolean
  ping?: { online: number; maxOnline: number }
  onClick: () => void
}) {
  const isOnline = ping !== undefined
  return (
    <div
      onClick={onClick}
      style={{
        padding: '14px 16px',
        background: selected ? 'var(--bg-elev-2)' : 'var(--bg-elev-1)',
        border: `1px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-card)',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        display: 'flex', alignItems: 'center', gap: 14,
      }}
    >
      {/* Icon */}
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: 'var(--primary)', opacity: 0.8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0,
      }}>
        {profile.title.charAt(0)}
      </div>
      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text-hi)', fontSize: 14, marginBottom: 2 }}>
          {profile.title}
        </div>
        <div style={{ color: 'var(--text-mid)', fontSize: 12 }}>
          {profile.serverAddress}:{profile.serverPort} · MC {profile.version}
        </div>
      </div>
      {/* Ping */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {isOnline ? (
          <>
            <Wifi size={13} color="var(--success)" />
            <span style={{ fontSize: 12, color: 'var(--success)' }}>
              {ping.online}/{ping.maxOnline}
            </span>
            <Users size={11} color="var(--text-lo)" />
          </>
        ) : (
          <>
            <WifiOff size={13} color="var(--text-lo)" />
            <span style={{ fontSize: 12, color: 'var(--text-lo)' }}>—</span>
          </>
        )}
      </div>
    </div>
  )
}

function CenteredMsg({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 40, color: color ?? 'var(--text-mid)', fontSize: 14 }}>
      {children}
    </div>
  )
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 32, height: 32, borderRadius: 'var(--radius-control)',
      background: 'transparent', color: 'var(--text-mid)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {children}
    </button>
  )
}
