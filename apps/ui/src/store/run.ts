import { create } from 'zustand'

export type RunStatus = 'idle' | 'running' | 'exited' | 'error'

interface RunStore {
  status: RunStatus
  readyProfileId: string | null
  canTerminate: boolean
  exitCode: number | null
  consoleLines: string[]
  error: string | null
  // actions
  start: (readyProfileId: string) => void
  setCanTerminate: (v: boolean) => void
  appendLine: (line: string) => void
  setExited: (code: number) => void
  setError: (msg: string) => void
  reset: () => void
}

export const useRunStore = create<RunStore>((set) => ({
  status: 'idle',
  readyProfileId: null,
  canTerminate: false,
  exitCode: null,
  consoleLines: [],
  error: null,
  start: (readyProfileId) => set({ status: 'running', readyProfileId, canTerminate: false, exitCode: null, consoleLines: [], error: null }),
  setCanTerminate: (v) => set({ canTerminate: v }),
  appendLine: (line) => set(s => ({
    // Keep last 2000 lines to avoid unbounded memory
    consoleLines: s.consoleLines.length > 2000
      ? [...s.consoleLines.slice(-1900), line]
      : [...s.consoleLines, line],
  })),
  setExited: (code) => set({ status: 'exited', exitCode: code, canTerminate: false }),
  setError: (msg) => set({ status: 'error', error: msg }),
  reset: () => set({ status: 'idle', readyProfileId: null, canTerminate: false, exitCode: null, consoleLines: [], error: null }),
}))
