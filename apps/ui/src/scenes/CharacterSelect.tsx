import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { User, AlertCircle, Loader2, ChevronRight } from 'lucide-react'
import { ipc } from '../ipc/client'
import { useAuthStore } from '../store/auth'
import type { Character } from '../ipc/types'

interface CharacterSelectProps {
  accountToken: string
  /** Called when a character session has been minted and the bridge authorized. */
  onSuccess: () => void
  /** Clear the (possibly expired) session and return to the login form. */
  onRelogin: () => void
}

type Phase = 'loading' | 'list' | 'authorizing' | 'error'

export function CharacterSelect({ accountToken, onSuccess, onRelogin }: CharacterSelectProps) {
  const { t } = useTranslation()
  const { setUser, setError: storeSetError } = useAuthStore()
  const [phase, setPhase] = useState<Phase>('loading')
  const [characters, setCharacters] = useState<Character[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)

  // ── Load characters on mount ───────────────────────────────────────────────

  const loadCharacters = useCallback(async () => {
    setPhase('loading')
    setErrorMsg(null)
    try {
      const res = await ipc.listCharacters(accountToken)
      setCharacters(res.items ?? [])
      setPhase('list')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setPhase('error')
    }
  }, [accountToken])

  useEffect(() => { loadCharacters() }, [loadCharacters])

  // ── Pick a character ───────────────────────────────────────────────────────

  const handlePick = useCallback(async (char: Character) => {
    setPickedId(char.id)
    setPhase('authorizing')
    setErrorMsg(null)
    try {
      // Mint a per-character Minecraft access token
      const session = await ipc.createSession(accountToken, char.id)
      const { minecraftAccessToken } = session

      // Hand off to the Java bridge: selectAuthMethod + authorize
      await ipc.selectAuthMethod('std')
      const authRes = await ipc.authorize('', minecraftAccessToken)
      setUser(authRes.user)
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      storeSetError(msg)
      setPhase('error')
      setPickedId(null)
    }
  }, [accountToken, setUser, storeSetError, onSuccess])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.2 }}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
      }}
    >
      <div style={{
        width: 420,
        background: 'var(--bg-elev-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-modal)',
        padding: 32,
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 48, height: 48,
            borderRadius: 12,
            background: 'var(--bg-elev-3)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}>
            <User size={24} color="var(--primary)" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-hi)', margin: 0 }}>
            {t('characterSelect.title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-mid)', marginTop: 6 }}>
            {t('characterSelect.subtitle')}
          </p>
        </div>

        {/* Loading */}
        {phase === 'loading' && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
            <Loader2 size={28} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
          </div>
        )}

        {/* Authorizing */}
        {phase === 'authorizing' && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 12, padding: '24px 0',
          }}>
            <Loader2 size={28} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: 14, color: 'var(--text-mid)', textAlign: 'center' }}>
              {t('characterSelect.authorizing')}
            </p>
          </div>
        )}

        {/* Error */}
        {phase === 'error' && errorMsg && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            color: 'var(--error)', fontSize: 13,
            background: 'rgba(229,87,92,0.1)',
            padding: '10px 12px',
            borderRadius: 'var(--radius-control)',
            marginBottom: 16,
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{errorMsg}</span>
          </div>
        )}
        {phase === 'error' && (
          <button
            onClick={loadCharacters}
            style={{
              width: '100%', height: 40,
              borderRadius: 'var(--radius-control)',
              background: 'var(--primary)', color: 'var(--on-primary)',
              clipPath: 'var(--cut-corners)',
              fontWeight: 600, fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {t('common.retry')}
          </button>
        )}
        {phase === 'error' && (
          <button
            onClick={onRelogin}
            style={{
              width: '100%', height: 36, marginTop: 10,
              borderRadius: 'var(--radius-control)',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-lo)',
              fontSize: 13, cursor: 'pointer',
            }}
          >
            {t('characterSelect.relogin')}
          </button>
        )}

        {/* Character list */}
        {phase === 'list' && characters.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text-mid)', fontSize: 14, padding: '20px 0' }}>
            {t('characterSelect.empty')}
          </p>
        )}
        {phase === 'list' && characters.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {characters.map(char => (
              <CharacterCard
                key={char.id}
                char={char}
                selected={pickedId === char.id}
                onClick={() => handlePick(char)}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  )
}

// ── Character card ─────────────────────────────────────────────────────────────

function CharacterCard({ char, selected, onClick }: {
  char: Character
  selected: boolean
  onClick: () => void
}) {
  const hasSkin = !!char.skinPreviewUrl

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 14px',
        background: selected ? 'var(--bg-elev-3)' : 'var(--bg-elev-2)',
        border: `1px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-card)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Skin preview or placeholder */}
      <div style={{
        width: 44, height: 44, borderRadius: 8, flexShrink: 0,
        background: 'var(--bg-elev-3)',
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {hasSkin ? (
          <img
            src={char.skinPreviewUrl}
            alt={char.generatedNickname}
            style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
          />
        ) : (
          <User size={22} color="var(--text-lo)" />
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 600, color: 'var(--text-hi)', fontSize: 14,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {char.generatedNickname}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 2 }}>
          {char.race.name}{char.alias ? ` · ${char.alias}` : ''}
        </div>
      </div>

      {/* Arrow */}
      <ChevronRight size={16} color="var(--text-lo)" style={{ flexShrink: 0 }} />
    </button>
  )
}
