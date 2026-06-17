import { useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Square, Terminal } from 'lucide-react'
import { ipc, onEvent } from '../ipc/client'
import { useRunStore } from '../store/run'
import { useSettingsStore } from '../store/settings'

interface RunningProps {
  readyProfileId: string
  onExit: () => void
}

function base64ToUtf8(b64: string): string {
  try {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return b64
  }
}

export function Running({ readyProfileId, onExit }: RunningProps) {
  const { t } = useTranslation()
  const { status, canTerminate, exitCode, consoleLines, start, setCanTerminate, appendLine, setExited } = useRunStore()
  const consoleRef = useRef<HTMLDivElement>(null)

  // Subscribe to run events and start the game
  useEffect(() => {
    start(readyProfileId)

    const unsubs = [
      onEvent('run', 'onStarted', () => {
        // Console disabled → hide the launcher to the tray AND return to the
        // launcher view (selection is preserved in the store), so the user never
        // sits on the console. The game runs in the background; clicking the tray
        // icon brings the launcher back, already on the character screen.
        if (!useSettingsStore.getState().debugConsole) {
          ipc.hideToTray().catch(() => {})
          onExit()
        }
      }),
      onEvent('run', 'onCanTerminate', () => setCanTerminate(true)),
      onEvent('run', 'onNormalOutput', (d) => {
        const text = base64ToUtf8((d as { base64: string }).base64)
        text.split('\n').forEach(l => l && appendLine(l))
      }),
      onEvent('run', 'onErrorOutput', (d) => {
        const text = base64ToUtf8((d as { base64: string }).base64)
        text.split('\n').forEach(l => l && appendLine('[ERR] ' + l))
      }),
      // The Gravit client detaches once the game JVM takes over, so onFinished /
      // onReadyToExit can fire while the game is still running. Do NOT auto-navigate
      // away (that bounced the user to a fresh, unselected character screen) — just
      // record the exit code. In debug-console mode the user returns via the
      // "to launcher" button; in normal mode they're already on the launcher.
      onEvent('run', 'onFinished', (d) => setExited((d as { code: number }).code)),
    ]

    ipc.runProfile(readyProfileId).catch(e => appendLine('[BRIDGE] ' + String(e)))

    return () => unsubs.forEach(u => u())
  }, [readyProfileId])

  // Auto-scroll console
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [consoleLines])

  const handleTerminate = useCallback(async () => {
    await ipc.terminateGame(readyProfileId).catch(() => {})
  }, [readyProfileId])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', overflow: 'hidden' }}
    >
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elev-1)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <Terminal size={15} color="var(--text-mid)" />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-mid)' }}>
          {t('running.console')}
        </span>
        {status === 'exited' && (
          <span style={{ fontSize: 12, color: 'var(--text-lo)' }}>
            {t('running.exitedWith', { code: exitCode })}
          </span>
        )}
        {canTerminate && status === 'running' && (
          <button
            onClick={handleTerminate}
            style={{
              height: 30, padding: '0 12px',
              borderRadius: 'var(--radius-control)',
              background: 'rgba(229,87,92,0.15)',
              color: 'var(--error)',
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 500,
            }}
          >
            <Square size={12} />
            {t('running.terminate')}
          </button>
        )}
        <button
          onClick={onExit}
          style={{
            height: 30, padding: '0 12px', borderRadius: 'var(--radius-control)',
            background: 'var(--bg-elev-3)', color: 'var(--text-mid)',
            border: '1px solid var(--border)', fontSize: 12, fontWeight: 500,
          }}
        >
          {t('running.back')}
        </button>
      </div>

      {/* Console output */}
      <div
        ref={consoleRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--text-mid)',
          background: 'var(--bg-base)',
        }}
      >
        {consoleLines.length === 0 && (
          <span style={{ color: 'var(--text-lo)' }}>Waiting for output...</span>
        )}
        {consoleLines.map((line, i) => (
          <div key={i} style={{
            color: line.startsWith('[ERR]') ? 'var(--error)' :
                   line.startsWith('[WARN]') ? 'var(--warn)' :
                   'var(--text-mid)',
          }}>
            {line}
          </div>
        ))}
      </div>
    </motion.div>
  )
}
