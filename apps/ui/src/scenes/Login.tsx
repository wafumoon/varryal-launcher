import { useState, useCallback, type FormEvent, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { LogIn, AlertCircle, Loader2 } from 'lucide-react'
import { ipc } from '../ipc/client'
import { useAuthStore } from '../store/auth'
import { REGISTER_URL } from '../config'

interface LoginProps {
  /** Called with the account access token once credentials login succeeds. */
  onSuccess: (accountToken: string) => void
}

type LoginPhase = 'idle' | 'submitting' | 'error'

export function Login({ onSuccess }: LoginProps) {
  const { t } = useTranslation()
  const { setAccountToken, setDisplayName, setError } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<LoginPhase>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const submitting = phase === 'submitting'

  // ── Submit credentials → portal /launcher/auth/login → account token ───────
  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return

    const mail = email.trim()
    if (!mail || !password) {
      setPhase('error')
      setErrorMsg(t('login.emptyFields'))
      return
    }

    setPhase('submitting')
    setErrorMsg(null)
    try {
      const res = await ipc.portalLogin(mail, password)
      // Account token received — store it (+ the site display name for the navbar)
      // and advance to character selection.
      setAccountToken(res.accountAccessToken)
      if (res.displayName) setDisplayName(res.displayName)
      onSuccess(res.accountAccessToken)
    } catch (err) {
      // The rejected message is the portal's localized text (e.g. wrong password).
      const msg = err instanceof Error ? err.message : String(err)
      setPhase('error')
      setErrorMsg(msg)
      setError(msg)
    }
  }, [email, password, submitting, t, setAccountToken, setError, onSuccess])

  // ── Render ──────────────────────────────────────────────────────────────────
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
      <form
        onSubmit={handleSubmit}
        style={{
          width: 360,
          background: 'var(--bg-elev-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-modal)',
          padding: 32,
        }}
      >
        {/* Logo / title */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img
            src="/varryal-logo.png"
            alt="Varryal"
            width={70}
            height={70}
            style={{ display: 'inline-block', marginBottom: 14, filter: 'drop-shadow(0 0 16px rgba(101,212,223,0.4))' }}
          />
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-hi)', margin: 0 }}>
            {t('login.title')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-mid)', marginTop: 6 }}>
            {t('login.subtitle')}
          </p>
        </div>

        {/* Error block */}
        {phase === 'error' && errorMsg && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              color: 'var(--error)',
              fontSize: 13,
              background: 'rgba(229,87,92,0.1)',
              padding: '10px 12px',
              borderRadius: 'var(--radius-control)',
              marginBottom: 16,
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{errorMsg}</span>
          </motion.div>
        )}

        {/* Email field */}
        <label style={labelStyle}>{t('login.email')}</label>
        <input
          className="vy-input"
          type="email"
          autoComplete="email"
          autoFocus
          spellCheck={false}
          placeholder={t('login.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          style={inputStyle}
        />

        {/* Password field */}
        <label style={{ ...labelStyle, marginTop: 14 }}>{t('login.password')}</label>
        <input
          className="vy-input"
          type="password"
          autoComplete="current-password"
          placeholder={t('login.passwordPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          style={inputStyle}
        />

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            height: 44,
            marginTop: 22,
            borderRadius: 'var(--radius-control)',
            background: 'var(--primary)',
            color: 'var(--on-primary)',
            clipPath: 'var(--cut-corners)',
            fontWeight: 600,
            fontSize: 15,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            cursor: submitting ? 'default' : 'pointer',
            opacity: submitting ? 0.7 : 1,
            transition: 'background 0.15s, opacity 0.15s',
          }}
        >
          {submitting ? (
            <>
              <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} />
              {t('login.signingIn')}
            </>
          ) : (
            <>
              <LogIn size={17} />
              {t('login.submitBtn')}
            </>
          )}
        </button>

        {/* Registration link → opens the site in the system browser */}
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-mid)', marginTop: 16 }}>
          {t('login.noAccount')}{' '}
          <a
            href={REGISTER_URL}
            onClick={(e) => { e.preventDefault(); ipc.openExternalUrl(REGISTER_URL).catch(() => {}) }}
            style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
          >
            {t('login.register')}
          </a>
        </p>
      </form>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .vy-input:focus { border-color: var(--primary); outline: none; }
        .vy-input::placeholder { color: var(--text-lo); }
      `}</style>
    </motion.div>
  )
}

// ── Shared inline styles ─────────────────────────────────────────────────────

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-mid)',
  marginBottom: 6,
}

const inputStyle: CSSProperties = {
  width: '100%',
  height: 42,
  padding: '0 14px',
  borderRadius: 'var(--radius-control)',
  background: 'var(--bg-elev-2)',
  border: '1px solid var(--border)',
  color: 'var(--text-hi)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
}
