import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2, ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { ipc } from '../ipc/client'
import { useAuthStore } from '../store/auth'
import { SkinPreview } from '../components/SkinPreview'
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
  const [index, setIndex] = useState(0)
  const [skin, setSkin] = useState('')
  const [dir, setDir] = useState(1)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // ── Load characters ─────────────────────────────────────────────────────────
  const loadCharacters = useCallback(async () => {
    setPhase('loading')
    setErrorMsg(null)
    try {
      const res = await ipc.listCharacters(accountToken)
      const items = res.items ?? []
      setCharacters(items)
      setIndex(0)
      setPhase('list')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setPhase('error')
    }
  }, [accountToken])

  useEffect(() => { loadCharacters() }, [loadCharacters])

  // ── Fetch the focused character's skin (3D) ──────────────────────────────────
  const current = characters[index]
  useEffect(() => {
    if (!current) return
    let cancelled = false
    setSkin('')
    const url = current.skinUrl || '/default-skin.png'
    ipc.fetchSkin(url)
      .then(d => { if (!cancelled) setSkin(d) })
      .catch(() => { if (!cancelled) setSkin('/default-skin.png') })
    return () => { cancelled = true }
  }, [current])

  const flip = useCallback((delta: number) => {
    if (characters.length < 2) return
    setDir(delta)
    setIndex(i => (i + delta + characters.length) % characters.length)
  }, [characters.length])

  // ── Pick a character → mint session → authorize bridge ───────────────────────
  const handlePick = useCallback(async () => {
    const char = characters[index]
    if (!char) return
    setPhase('authorizing')
    setErrorMsg(null)
    try {
      const session = await ipc.createSession(accountToken, char.id)
      await ipc.selectAuthMethod('std')
      const authRes = await ipc.authorize('', session.minecraftAccessToken)
      setUser(authRes.user)
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      storeSetError(msg)
      setPhase('error')
    }
  }, [characters, index, accountToken, setUser, storeSetError, onSuccess])

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
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        gap: 14,
        padding: '14px 24px',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 22, color: 'var(--text-hi)', margin: 0 }}>{t('characterSelect.title')}</h2>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', marginTop: 6 }}>{t('characterSelect.subtitle')}</p>
      </div>

      {/* Loading */}
      {phase === 'loading' && (
        <div style={{ padding: 60 }}>
          <Loader2 size={30} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div style={{ width: 360, textAlign: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            color: 'var(--error)', fontSize: 13, textAlign: 'left',
            background: 'rgba(255,154,128,0.1)', padding: '10px 12px',
            borderRadius: 'var(--radius-control)', marginBottom: 14,
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{errorMsg}</span>
          </div>
          <button onClick={loadCharacters} style={primaryBtn}>{t('common.retry')}</button>
          <button onClick={onRelogin} style={ghostBtn}>{t('characterSelect.relogin')}</button>
        </div>
      )}

      {/* Empty */}
      {phase === 'list' && characters.length === 0 && (
        <p style={{ color: 'var(--text-mid)', fontSize: 14, padding: 40, textAlign: 'center', maxWidth: 320 }}>
          {t('characterSelect.empty')}
        </p>
      )}

      {/* Carousel */}
      {(phase === 'list' || phase === 'authorizing') && characters.length > 0 && current && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ArrowBtn dir="left" disabled={characters.length < 2} onClick={() => flip(-1)} />

            <div style={{
              width: 300, height: 396,
              position: 'relative',
              background: 'linear-gradient(180deg, var(--bg-elev-1), var(--bg-elev-2))',
              border: '1px solid var(--border-strong)',
              clipPath: 'var(--cut-corners)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '22px 18px 18px',
              boxShadow: 'var(--glow-primary)',
              overflow: 'hidden',
            }}>
              {/* 3D skin */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                <AnimatePresence mode="wait" custom={dir}>
                  <motion.div
                    key={current.id}
                    custom={dir}
                    initial={{ opacity: 0, x: dir * 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: dir * -40 }}
                    transition={{ duration: 0.22 }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {skin
                      ? <SkinPreview skin={skin} model={current.skinModel} width={186} height={266} />
                      : <div style={{ width: 186, height: 266, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Loader2 size={26} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
                        </div>}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Name + race */}
              <div style={{ textAlign: 'center', width: '100%' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--text-hi)' }}>
                  {current.name || current.generatedNickname}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {current.generatedNickname}
                </div>
                <div style={{ fontSize: 13, color: 'var(--primary)', marginTop: 8 }}>
                  {current.race?.name}{current.alias ? ` · ${current.alias}` : ''}
                </div>
              </div>
            </div>

            <ArrowBtn dir="right" disabled={characters.length < 2} onClick={() => flip(1)} />
          </div>

          {/* Dots */}
          {characters.length > 1 && (
            <div style={{ display: 'flex', gap: 7 }}>
              {characters.map((c, i) => (
                <span key={c.id} style={{
                  width: i === index ? 18 : 7, height: 7, borderRadius: 4,
                  background: i === index ? 'var(--primary)' : 'var(--border-strong)',
                  transition: 'width 0.2s, background 0.2s',
                }} />
              ))}
            </div>
          )}

          {/* Enter button */}
          <button onClick={handlePick} disabled={phase === 'authorizing'} style={{
            ...primaryBtn, width: 260, height: 46, marginTop: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            opacity: phase === 'authorizing' ? 0.7 : 1, fontSize: 15,
          }}>
            {phase === 'authorizing'
              ? <><Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} />{t('characterSelect.authorizing')}</>
              : <><Play size={16} />{t('characterSelect.enter')}</>}
          </button>
        </>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  )
}

function ArrowBtn({ dir, onClick, disabled }: { dir: 'left' | 'right'; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 44, height: 44, borderRadius: '50%',
        background: 'var(--bg-elev-2)',
        border: '1px solid var(--border)',
        color: disabled ? 'var(--text-lo)' : 'var(--text-hi)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        flexShrink: 0,
      }}
    >
      {dir === 'left' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
    </button>
  )
}

const primaryBtn: CSSProperties = {
  width: '100%', height: 42,
  borderRadius: 'var(--radius-control)',
  background: 'var(--primary)', color: 'var(--on-primary)',
  clipPath: 'var(--cut-corners)',
  fontWeight: 600, fontSize: 14, cursor: 'pointer',
}

const ghostBtn: CSSProperties = {
  width: '100%', height: 36, marginTop: 10,
  borderRadius: 'var(--radius-control)',
  background: 'transparent', border: '1px solid var(--border)',
  color: 'var(--text-lo)', fontSize: 13, cursor: 'pointer',
}
