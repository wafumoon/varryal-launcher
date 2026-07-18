import { useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Circle, Square, Terminal } from 'lucide-react'
import { ipc, onEvent } from '../ipc/client'
import { useRunStore } from '../store/run'
import { useSettingsStore } from '../store/settings'
import { matchesReadyProfile } from '../utils/launcherState'

interface RunningProps {
  readyProfileId: string
  onExit: () => void
}

function base64ToUtf8(value: string): string {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return value
  }
}

export function Running({ readyProfileId, onExit }: RunningProps) {
  const { t } = useTranslation()
  const { status, canTerminate, exitCode, consoleLines, start, setCanTerminate, appendLine, setExited } = useRunStore()
  const consoleRef = useRef<HTMLDivElement>(null)
  const startedProfileRef = useRef<string | null>(null)

  useEffect(() => {
    const accepts = (data: Record<string, unknown>) => matchesReadyProfile(data, readyProfileId)
    const unsubs = [
      onEvent('run', 'onStarted', data => {
        if (!accepts(data)) return
        if (!useSettingsStore.getState().debugConsole) {
          ipc.hideToTray().catch(() => {})
          onExit()
        }
      }),
      onEvent('run', 'onCanTerminate', data => {
        if (accepts(data)) setCanTerminate(true)
      }),
      onEvent('run', 'onNormalOutput', data => {
        if (!accepts(data)) return
        base64ToUtf8((data as { base64: string }).base64).split('\n').forEach(line => line && appendLine(line))
      }),
      onEvent('run', 'onErrorOutput', data => {
        if (!accepts(data)) return
        base64ToUtf8((data as { base64: string }).base64).split('\n').forEach(line => line && appendLine(`[ERR] ${line}`))
      }),
      onEvent('run', 'onFinished', data => {
        if (accepts(data)) setExited((data as { code: number }).code)
      }),
    ]
    return () => unsubs.forEach(unsubscribe => unsubscribe())
  }, [readyProfileId, onExit, setCanTerminate, appendLine, setExited])

  useEffect(() => {
    if (startedProfileRef.current === readyProfileId) return
    startedProfileRef.current = readyProfileId
    start(readyProfileId)
    ipc.runProfile(readyProfileId).catch(error => appendLine(`[BRIDGE] ${String(error)}`))
  }, [readyProfileId, start, appendLine])

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [consoleLines])

  const handleTerminate = useCallback(async () => {
    await ipc.terminateGame(readyProfileId).catch(() => {})
  }, [readyProfileId])

  return (
    <motion.main className="vy-running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <header className="vy-running__header">
        <div className="vy-running__title"><span><Terminal size={18} /></span><div><strong>{t('running.console')}</strong><small>Debug output · {readyProfileId.slice(0, 8)}</small></div></div>
        <div className="vy-running__state"><Circle size={8} fill="currentColor" /><span>{status === 'running' ? 'Игра запущена' : t('running.exitedWith', { code: exitCode })}</span></div>
        {canTerminate && status === 'running' && <button className="vy-danger-action" onClick={() => void handleTerminate()}><Square size={12} />{t('running.terminate')}</button>}
        <button className="vy-secondary-action" onClick={onExit}><ArrowLeft size={14} />{t('running.back')}</button>
      </header>
      <div className="vy-console" ref={consoleRef}>
        {consoleLines.length === 0 && <span className="vy-console__empty">Ожидаем вывод процесса…</span>}
        {consoleLines.map((line, index) => <div key={`${index}-${line.slice(0, 18)}`} className={line.startsWith('[ERR]') ? 'is-error' : line.startsWith('[WARN]') ? 'is-warning' : ''}><span>{String(index + 1).padStart(4, '0')}</span><code>{line}</code></div>)}
      </div>
    </motion.main>
  )
}
