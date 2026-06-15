import { create } from 'zustand'
import type { UpdatePhase, DownloadStage } from '../ipc/types'

export type DownloadStatus = 'idle' | 'downloading' | 'done' | 'error' | 'cancelled'

interface DownloadStore {
  status: DownloadStatus
  readyProfileId: string | null
  phase: UpdatePhase | null
  stage: DownloadStage | null
  totalBytes: number
  downloadedBytes: number
  canCancel: boolean
  error: string | null
  // actions
  start: (readyProfileId: string) => void
  setPhase: (phase: UpdatePhase) => void
  setStage: (stage: DownloadStage) => void
  setTotal: (bytes: number) => void
  setDownloaded: (bytes: number) => void
  setCanCancel: (v: boolean) => void
  complete: () => void
  setError: (msg: string) => void
  reset: () => void
}

const INITIAL: Omit<DownloadStore, keyof { start: unknown; setPhase: unknown; setStage: unknown; setTotal: unknown; setDownloaded: unknown; setCanCancel: unknown; complete: unknown; setError: unknown; reset: unknown }> = {
  status: 'idle',
  readyProfileId: null,
  phase: null,
  stage: null,
  totalBytes: 0,
  downloadedBytes: 0,
  canCancel: false,
  error: null,
}

export const useDownloadStore = create<DownloadStore>((set) => ({
  ...INITIAL,
  start: (readyProfileId) => set({ ...INITIAL, status: 'downloading', readyProfileId }),
  setPhase: (phase) => set({ phase }),
  setStage: (stage) => set({ stage }),
  setTotal: (bytes) => set({ totalBytes: bytes }),
  setDownloaded: (bytes) => set({ downloadedBytes: bytes }),
  setCanCancel: (v) => set({ canCancel: v }),
  complete: () => set({ status: 'done', canCancel: false }),
  setError: (msg) => set({ status: 'error', error: msg }),
  reset: () => set(INITIAL),
}))
