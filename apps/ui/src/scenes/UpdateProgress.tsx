import { useEffect, useCallback, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { X, Download, AlertCircle } from 'lucide-react'
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
    readyProfileId, phase, stage,
    totalBytes, downloadedBytes, canCancel, error,
    start, setPhase, setStage, setTotal, setDownloaded, setCanCancel, complete, setError,
  } = useDownloadStore()

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

  useEffect(() => {
    ipc.downloadProfile(profile.uuid, settings)
      .then(res => start(res.readyProfileId))
      .catch(e => setError(String(e)))
  }, [])

  const handleCancel = useCallback(async () => {
    if (readyProfileId) await ipc.cancelDownload(readyProfileId).catch(() => {})
    onBack()
  }, [readyProfileId, onBack])

  const phaseLabel = phase ? t(`download.phase_${phase}`) : t('common.loading')
  const progress = totalBytes > 0 ? Math.min(downloadedBytes / totalBytes, 1) : 0
  const pct = Math.round(progress * 100)
  const downloadedMb = (downloadedBytes / 1024 / 1024).toFixed(1)
  const totalMb = (totalBytes / 1024 / 1024).toFixed(1)

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', padding: 40 }}
    >
      <div style={{ width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, color: 'var(--text-hi)', margin: 0 }}>{t('download.title')}</h2>
          <p style={{ fontSize: 14, color: 'var(--text-mid)', marginTop: 6 }}>{profile.title}</p>
        </div>

        {error ? (
          <div style={{ width: '100%' }}>
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, color: 'var(--error)', fontSize: 14,
              background: 'rgba(255,154,128,0.1)', border: '1px solid rgba(255,154,128,0.25)',
              padding: '16px 18px', borderRadius: 'var(--radius-card)', marginBottom: 18,
              maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', lineHeight: 1.5,
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
            <button onClick={handleCancel} style={ctrlBtn}><X size={16} />{t('common.back')}</button>
          </div>
        ) : (
          <div style={{
            width: '100%', background: 'rgba(14,18,24,0.72)', border: '1px solid var(--border-strong)',
            clipPath: 'var(--cut-corners)', padding: '30px 34px', display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            {/* Phase + big percentage */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 17, fontWeight: 600, color: 'var(--text-hi)' }}>
                  <Download size={18} color="var(--primary)" />
                  {phaseLabel}
                </div>
                {stage && <div style={{ fontSize: 12, color: 'var(--text-lo)', marginTop: 5, fontFamily: 'var(--font-mono)' }}>{stage}</div>}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 700, color: 'var(--primary)', lineHeight: 1 }}>
                {pct}<span style={{ fontSize: 22 }}>%</span>
              </div>
            </div>

            {/* Thick progress bar */}
            <div style={{ height: 12, background: 'var(--bg-elev-3)', borderRadius: 6, overflow: 'hidden' }}>
              <motion.div
                style={{ height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--primary))', borderRadius: 6, boxShadow: '0 0 12px rgba(240,201,130,0.5)' }}
                animate={{ width: `${(progress * 100).toFixed(1)}%` }}
                transition={{ ease: 'linear', duration: 0.3 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-mid)' }}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{downloadedMb} / {totalMb} MB</span>
              {totalBytes === 0 && <span style={{ color: 'var(--text-lo)' }}>{t('common.loading')}</span>}
            </div>
          </div>
        )}

        {!error && canCancel && (
          <button onClick={handleCancel} style={{ ...ctrlBtn, maxWidth: 280 }}><X size={16} />{t('download.cancel')}</button>
        )}
      </div>
    </motion.div>
  )
}

const ctrlBtn: CSSProperties = {
  width: '100%', height: 42, borderRadius: 'var(--radius-control)',
  background: 'var(--bg-elev-3)', color: 'var(--text-mid)', border: '1px solid var(--border)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
}
