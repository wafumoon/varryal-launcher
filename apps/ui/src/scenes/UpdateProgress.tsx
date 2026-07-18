import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ChevronDown, Download, FileSearch, RefreshCw, X } from 'lucide-react'
import { ipc, onEvent } from '../ipc/client'
import { useDownloadStore } from '../store/download'
import type { ClientProfile, ClientProfileSettings, DownloadStage, UpdatePhase } from '../ipc/types'

interface UpdateProgressProps {
  profile: ClientProfile
  settings: ClientProfileSettings
  mode: 'play' | 'reinstall'
  onComplete: (readyProfileId: string) => void
  onBack: () => void
}

export function UpdateProgress({ profile, settings, mode, onComplete, onBack }: UpdateProgressProps) {
  const { t } = useTranslation()
  const [showDetails, setShowDetails] = useState(false)
  const initialStartRef = useRef(false)
  const {
    readyProfileId, phase, stage, totalBytes, downloadedBytes, canCancel, error,
    start, setPhase, setStage, setTotal, setDownloaded, setCanCancel, complete, setError, reset,
  } = useDownloadStore()

  const beginDownload = useCallback(async () => {
    reset()
    setShowDetails(false)
    try {
      const result = await ipc.downloadProfile(profile.uuid, settings)
      start(result.readyProfileId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [profile.uuid, settings, reset, start, setError])

  useEffect(() => {
    const unsubs = [
      onEvent('download', 'onStartPhase', data => setPhase((data as { phase: UpdatePhase }).phase)),
      onEvent('download', 'onStage', data => setStage((data as { stage: DownloadStage }).stage)),
      onEvent('download', 'onTotalDownload', data => setTotal((data as { bytes: number }).bytes)),
      onEvent('download', 'onCurrentDownloaded', data => setDownloaded((data as { bytes: number }).bytes)),
      onEvent('download', 'onCanCancel', () => setCanCancel(true)),
      onEvent('download', 'onComplete', data => {
        complete()
        onComplete((data as { readyProfileId: string }).readyProfileId)
      }),
      onEvent('download', 'onError', data => setError((data as { error: string }).error)),
    ]
    return () => unsubs.forEach(unsubscribe => unsubscribe())
  }, [complete, onComplete, setCanCancel, setDownloaded, setError, setPhase, setStage, setTotal])

  useEffect(() => {
    if (initialStartRef.current) return
    initialStartRef.current = true
    void beginDownload()
  }, [beginDownload])

  const handleCancel = useCallback(async () => {
    if (readyProfileId) await ipc.cancelDownload(readyProfileId).catch(() => {})
    reset()
    onBack()
  }, [readyProfileId, reset, onBack])

  const progress = totalBytes > 0 ? Math.min(downloadedBytes / totalBytes, 1) : 0
  const percent = Math.round(progress * 100)
  const downloadedMb = (downloadedBytes / 1024 / 1024).toFixed(1)
  const totalMb = (totalBytes / 1024 / 1024).toFixed(1)
  const phaseLabel = phase ? t(`download.phase_${phase}`) : 'Проверяем файлы клиента…'

  return (
    <motion.main className="vy-download" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <section className="vy-download-card">
        <header className="vy-download-card__header">
          <span className="vy-eyebrow">{mode === 'reinstall' ? 'Диагностика и восстановление' : 'Подготовка к запуску'}</span>
          <h1>{mode === 'reinstall' ? 'Переустановка клиента' : t('download.title')}</h1>
          <p>{profile.title} · Minecraft {profile.version}</p>
        </header>

        {error ? (
          <div className="vy-download-error">
            <span className="vy-download-error__icon"><AlertCircle size={24} /></span>
            <div className="vy-download-error__copy">
              <h2>Обновление не завершено</h2>
              <p>Контекст профиля сохранён. Повторите операцию или вернитесь в launcher; автоматический repair не запускается.</p>
            </div>
            <div className="vy-download-error__actions">
              <button className="vy-primary-action" onClick={() => void beginDownload()}><RefreshCw size={16} />Повторить</button>
              <button className="vy-secondary-action" onClick={() => setShowDetails(value => !value)}><FileSearch size={15} />Технические сведения<ChevronDown className={showDetails ? 'is-rotated' : ''} size={14} /></button>
              <button className="vy-text-button" onClick={() => void handleCancel()}>Вернуться</button>
            </div>
            {showDetails && <pre className="vy-diagnostics">{error}</pre>}
          </div>
        ) : (
          <div className="vy-download-progress">
            <div className="vy-download-progress__phase">
              <span><Download size={18} /></span>
              <div><strong>{phaseLabel}</strong><small>{stage ?? 'Инициализация'}</small></div>
              <b>{percent}%</b>
            </div>
            <div className="vy-progress-track vy-progress-track--large"><motion.i animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.3, ease: 'linear' }} /></div>
            <div className="vy-download-progress__meta">
              <span>{totalBytes > 0 ? `${downloadedMb} / ${totalMb} MB` : 'Определяем размер загрузки'}</span>
              <span>{phase === 'LAUNCH' ? 'Финальная проверка' : 'Проверка целостности включена'}</span>
            </div>
          </div>
        )}

        {!error && canCancel && <button className="vy-secondary-action vy-download-card__cancel" onClick={() => void handleCancel()}><X size={15} />{t('download.cancel')}</button>}
      </section>
    </motion.main>
  )
}
