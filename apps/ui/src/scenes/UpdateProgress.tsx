import { useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { ipc, onEvent } from '../ipc/client'
import { useDownloadStore } from '../store/download'
import type { ClientProfile, ClientProfileSettings, UpdatePhase, DownloadStage } from '../ipc/types'

interface UpdateProgressProps {
  profile: ClientProfile
  settings: ClientProfileSettings
  onComplete: (readyProfileId: string) => void
  onBack: () => void
}

export function UpdateProgress({ profile, settings, onComplete, onBack }: UpdateProgressProps) {
  const { t } = useTranslation()
  const {
    status, readyProfileId, phase, stage,
    totalBytes, downloadedBytes, canCancel, error,
    start, setPhase, setStage, setTotal, setDownloaded, setCanCancel, complete, setError,
  } = useDownloadStore()

  // Subscribe to download events
  useEffect(() => {
    const unsubs = [
      onEvent('download', 'onStartPhase', (d) => setPhase((d as { phase: UpdatePhase }).phase)),
      onEvent('download', 'onStage', (d) => setStage((d as { stage: DownloadStage }).stage)),
      onEvent('download', 'onTotalDownload', (d) => setTotal((d as { bytes: number }).bytes)),
      onEvent('download', 'onCurrentDownloaded', (d) => setDownloaded((d as { bytes: number }).bytes)),
      onEvent('download', 'onCanCancel', () => setCanCancel(true)),
      onEvent('download', 'onComplete', (d) => {
        complete()
        onComplete((d as { readyProfileId: string }).readyProfileId)
      }),
      onEvent('download', 'onError', (d) => setError((d as { error: string }).error)),
    ]
    return () => unsubs.forEach(u => u())
  }, [])

  // Start download on mount
  useEffect(() => {
    ipc.downloadProfile(profile.uuid, settings)
      .then(res => start(res.readyProfileId))
      .catch(e => setError(String(e)))
  }, [])

  const handleCancel = useCallback(async () => {
    if (readyProfileId) {
      await ipc.cancelDownload(readyProfileId).catch(() => {})
    }
    onBack()
  }, [readyProfileId, onBack])

  const phaseLabel = phase ? t(`download.phase_${phase}`) : t('common.loading')
  const progress = totalBytes > 0 ? Math.min(downloadedBytes / totalBytes, 1) : 0
  const downloadedMb = (downloadedBytes / 1024 / 1024).toFixed(1)
  const totalMb = (totalBytes / 1024 / 1024).toFixed(1)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}
    >
      <div style={{
        width: 420,
        background: 'var(--bg-elev-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-modal)',
        padding: 32,
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-hi)', marginBottom: 6 }}>
          {t('download.title')}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 24 }}>{profile.title}</p>

        {error ? (
          <div style={{ color: 'var(--error)', fontSize: 14, marginBottom: 16 }}>{error}</div>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 12 }}>{phaseLabel}</p>
            {stage && (
              <p style={{ fontSize: 11, color: 'var(--text-lo)', marginBottom: 10 }}>{stage}</p>
            )}
            {/* Progress bar */}
            <div style={{
              height: 6, background: 'var(--bg-elev-3)',
              borderRadius: 3, overflow: 'hidden', marginBottom: 10,
            }}>
              <motion.div
                style={{ height: '100%', background: 'var(--primary)', borderRadius: 3 }}
                animate={{ width: `${(progress * 100).toFixed(1)}%` }}
                transition={{ ease: 'linear', duration: 0.3 }}
              />
            </div>
            {totalBytes > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-lo)', textAlign: 'right', marginBottom: 20 }}>
                {downloadedMb} {t('download.of')} {totalMb} MB
              </p>
            )}
          </>
        )}

        {(canCancel || error) && (
          <button
            onClick={handleCancel}
            style={{
              width: '100%', height: 36,
              borderRadius: 'var(--radius-control)',
              background: 'var(--bg-elev-3)',
              color: 'var(--text-mid)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontSize: 13, fontWeight: 500,
            }}
          >
            <X size={14} />
            {error ? t('common.back') : t('download.cancel')}
          </button>
        )}
      </div>
    </motion.div>
  )
}
