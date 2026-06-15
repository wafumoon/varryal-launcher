import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { LogIn, AlertCircle } from 'lucide-react'
import { ipc } from '../ipc/client'
import { useAuthStore } from '../store/auth'

interface LoginProps {
  onSuccess: () => void
}

export function Login({ onSuccess }: LoginProps) {
  const { t } = useTranslation()
  const { state, error, setLoading, setUser, setError } = useAuthStore()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!login.trim() || !password) return
    setLoading()
    try {
      const res = await ipc.authorize(login.trim(), password)
      setUser(res.user)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [login, password, setLoading, setUser, setError, onSuccess])

  const isLoading = state === 'loading'

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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field
            label={t('login.login')}
            type="text"
            value={login}
            onChange={setLogin}
            disabled={isLoading}
            autoFocus
          />
          <Field
            label={t('login.password')}
            type="password"
            value={password}
            onChange={setPassword}
            disabled={isLoading}
          />

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--error)', fontSize: 13,
              background: 'rgba(229,87,92,0.1)',
              padding: '8px 12px', borderRadius: 'var(--radius-control)',
            }}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !login.trim() || !password}
            style={{
              marginTop: 8,
              height: 40,
              borderRadius: 'var(--radius-control)',
              background: 'var(--primary)',
              color: '#fff',
              fontWeight: 500,
              fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: isLoading || !login.trim() || !password ? 0.6 : 1,
              transition: 'opacity 0.15s, background 0.15s',
            }}
          >
            <LogIn size={15} />
            {isLoading ? t('login.loading') : t('login.loginBtn')}
          </button>
        </form>
      </div>
    </motion.div>
  )
}

function Field({
  label, type, value, onChange, disabled, autoFocus,
}: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--text-mid)', fontWeight: 500 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        style={{
          height: 38,
          padding: '0 12px',
          background: 'var(--bg-elev-3)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-control)',
          color: 'var(--text-hi)',
          fontSize: 14,
          opacity: disabled ? 0.6 : 1,
        }}
      />
    </div>
  )
}
