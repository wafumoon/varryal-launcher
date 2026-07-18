import { useState, useCallback, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowRight, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { ipc } from '../ipc/client'
import { useAuthStore } from '../store/auth'
import { REGISTER_URL } from '../config'
import { classifyRemoteError, type RemoteErrorKind } from '../utils/launcherState'

interface LoginProps {
  onSuccess: (accountToken: string) => void
}

type LoginPhase = 'idle' | 'submitting'
type LoginError = { message: string; kind: RemoteErrorKind } | null

export function Login({ onSuccess }: LoginProps) {
  const { t } = useTranslation()
  const { setAccountToken, setDisplayName, setError } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<LoginPhase>('idle')
  const [loginError, setLoginError] = useState<LoginError>(null)
  const submitting = phase === 'submitting'

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return

    const mail = email.trim()
    if (!mail || !password) {
      setLoginError({ message: t('login.emptyFields'), kind: 'credentials' })
      return
    }

    setPhase('submitting')
    setLoginError(null)
    try {
      const result = await ipc.portalLogin(mail, password)
      setAccountToken(result.accountAccessToken)
      if (result.displayName) setDisplayName(result.displayName)
      onSuccess(result.accountAccessToken)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const kind = classifyRemoteError(message)
      setLoginError({ message, kind })
      setError(message)
    } finally {
      setPhase('idle')
    }
  }, [email, password, submitting, t, setAccountToken, setDisplayName, setError, onSuccess])

  const credentialError = loginError?.kind === 'credentials' ? loginError.message : null
  const remoteError = loginError && loginError.kind !== 'credentials' ? loginError : null

  return (
    <motion.main
      className="vy-login"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.34 }}
    >
      <section className="vy-login__story" aria-label="Varryal">
        <div className="vy-wordmark">
          <img src="/varryal-logo.png" alt="" width={44} height={44} />
          <div>
            <span className="vy-wordmark__name">VARRYAL</span>
            <span className="vy-wordmark__edition">ROLEPLAY WORLD</span>
          </div>
        </div>
        <div className="vy-login__place">
          <span>Острог · Мыто</span>
          <i aria-hidden="true" />
        </div>
      </section>

      <section className="vy-login__panel-wrap">
        <motion.form
          className="vy-login-card"
          onSubmit={handleSubmit}
          initial={{ opacity: 0, x: 26 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 18 }}
          transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="vy-login-card__eyebrow">
            <ShieldCheck size={15} />
            <span>Безопасный вход</span>
          </div>
          <h1>{t('login.title')}</h1>
          <p className="vy-login-card__subtitle">{t('login.subtitle')}</p>

          {remoteError && (
            <motion.div className="vy-remote-error" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} role="alert">
              <AlertCircle size={18} />
              <div>
                <strong>{remoteError.kind === 'network' ? 'Сервер недоступен' : t('common.error')}</strong>
                <span>{remoteError.message}</span>
              </div>
              <button type="submit" disabled={submitting} aria-label={t('common.retry')}>
                <RefreshCw size={15} />
              </button>
            </motion.div>
          )}

          <label className="vy-field">
            <span>{t('login.email')}</span>
            <input
              className="vy-input"
              type="email"
              autoComplete="email"
              autoFocus
              spellCheck={false}
              placeholder={t('login.emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
            />
          </label>

          <label className="vy-field">
            <span>{t('login.password')}</span>
            <input
              className={`vy-input${credentialError ? ' vy-input--error' : ''}`}
              type="password"
              autoComplete="current-password"
              placeholder={t('login.passwordPlaceholder')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(credentialError)}
              aria-describedby={credentialError ? 'login-password-error' : undefined}
            />
            {credentialError && (
              <span className="vy-field__error" id="login-password-error" role="alert">
                <AlertCircle size={13} />{credentialError}
              </span>
            )}
          </label>

          <button className="vy-primary-action" type="submit" disabled={submitting}>
            {submitting ? (
              <><Loader2 className="vy-spin" size={18} />{t('login.signingIn')}</>
            ) : (
              <>{t('login.submitBtn')}<ArrowRight size={18} /></>
            )}
          </button>

          <div className="vy-login-card__divider"><span>V</span></div>
          <p className="vy-login-card__register">
            {t('login.noAccount')}{' '}
            <a
              href={REGISTER_URL}
              onClick={(event) => {
                event.preventDefault()
                ipc.openExternalUrl(REGISTER_URL).catch(() => {})
              }}
            >
              {t('login.register')}
            </a>
          </p>
        </motion.form>
      </section>
    </motion.main>
  )
}
