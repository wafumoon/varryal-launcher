import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Globe, AlertCircle, Loader2, XCircle } from 'lucide-react'
import { ipc } from '../ipc/client'
import { useAuthStore } from '../store/auth'
import type { WebAuthResult } from '../ipc/types'

interface LoginProps {
  onSuccess: () => void
}

type LoginPhase = 'idle' | 'waiting' | 'authorizing' | 'error'

// Map portal / internal error codes to RU/EN i18n keys
const ERROR_KEY_MAP: Record<string, string> = {
  access_denied: 'login.error_access_denied',
  email_not_verified: 'login.error_email_not_verified',
  password_login_unavailable: 'login.error_password_login_unavailable',
  server_error: 'login.error_server_error',
  state_mismatch: 'login.error_state_mismatch',
  missing_token: 'login.error_missing_token',
  invalid_callback: 'login.error_invalid_callback',
}

export function Login({ onSuccess }: LoginProps) {
  const { t } = useTranslation()
  const { setLoading, setUser, setError, logout } = useAuthStore()
  const [phase, setPhase] = useState<LoginPhase>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // ── Handle the web_auth_result event emitted by Rust ─────────────────────

  const handleAuthResult = useCallback(async (result: WebAuthResult) => {
    if (!result.ok || !result.token) {
      const code = result.error ?? 'server_error'
      const i18nKey = ERROR_KEY_MAP[code] ?? 'login.error_server_error'
      const msg = t(i18nKey)
      setPhase('error')
      setErrorMsg(msg)
      setError(msg)
      return
    }

    // Token received — hand it to the bridge: selectAuthMethod('std') then authorize('', token)
    setPhase('authorizing')
    try {
      await ipc.selectAuthMethod('std')
      const res = await ipc.authorize('', result.token)
      setUser(res.user)
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setPhase('error')
      setErrorMsg(msg)
      setError(msg)
    }
  }, [t, setUser, setError, onSuccess])

  // Subscribe to web_auth_result on mount, unsubscribe on unmount
  useEffect(() => {
    const unsub = ipc.listenWebAuthResult(handleAuthResult)
    return unsub
  }, [handleAuthResult])

  // ── Button handler ────────────────────────────────────────────────────────

  const handleLogin = useCallback(async () => {
    setPhase('waiting')
    setErrorMsg(null)
    setLoading()
    try {
      await ipc.startWebAuth()
      // Now waiting for the deep-link callback; phase stays 'waiting'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setPhase('error')
      setErrorMsg(msg)
      setError(msg)
    }
  }, [setLoading, setError])

  const handleCancel = useCallback(() => {
    setPhase('idle')
    setErrorMsg(null)
    logout()
  }, [logout])

  // ── Render ────────────────────────────────────────────────────────────────

  const isWaiting = phase === 'waiting' || phase === 'authorizing'

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
        background: 'var(--bg-base)',
      }}
    >
      <div style={{
        width: 360,
        background: 'var(--bg-elev-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-modal)',
        padding: 32,
      }}>
        {/* Logo / title */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56,
            borderRadius: 16,
            background: 'var(--primary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            fontWeight: 700,
            color: '#fff',
            marginBottom: 14,
          }}>V</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-hi)' }}>
            {t('login.title')}
          </h1>
        </div>

        {/* Waiting state */}
        {isWaiting && (
          <motion.div
            key="waiting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              padding: '8px 0 4px',
            }}
          >
            <Loader2
              size={32}
              style={{
                color: 'var(--primary)',
                animation: 'spin 1s linear infinite',
              }}
            />
            <p style={{
              fontSize: 14,
              color: 'var(--text-mid)',
              textAlign: 'center',
              lineHeight: 1.5,
            }}>
              {phase === 'authorizing'
                ? t('login.authorizing')
                : t('login.waiting')}
            </p>
            <button
              onClick={handleCancel}
              style={{
                marginTop: 4,
                height: 36,
                padding: '0 20px',
                borderRadius: 'var(--radius-control)',
                background: 'var(--bg-elev-3)',
                border: '1px solid var(--border)',
                color: 'var(--text-mid)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t('common.cancel')}
            </button>
          </motion.div>
        )}

        {/* Error state */}
        {phase === 'error' && errorMsg && (
          <motion.div
            key="error"
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
              marginBottom: 14,
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{errorMsg}</span>
          </motion.div>
        )}

        {/* Idle / error: show the login button */}
        {!isWaiting && (
          <button
            onClick={handleLogin}
            style={{
              width: '100%',
              height: 44,
              borderRadius: 'var(--radius-control)',
              background: 'var(--primary)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 15,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              cursor: 'pointer',
              transition: 'background 0.15s, opacity 0.15s',
            }}
          >
            <Globe size={17} />
            {phase === 'error'
              ? t('login.retryBtn')
              : t('login.webAuthBtn')}
          </button>
        )}

        {/* Dismiss error without retrying */}
        {phase === 'error' && (
          <button
            onClick={handleCancel}
            style={{
              width: '100%',
              marginTop: 10,
              height: 36,
              borderRadius: 'var(--radius-control)',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-lo)',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <XCircle size={13} />
            {t('common.cancel')}
          </button>
        )}
      </div>

      {/* CSS keyframes for spinner */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  )
}
