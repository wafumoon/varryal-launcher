import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ClientProfileSettings, JavaVersion } from '../ipc/types'
import type { MotionMode } from '../utils/launcherState'

interface SettingsStore {
  profileSettings: ClientProfileSettings | null
  availableJava: JavaVersion[]
  dirty: boolean
  optionalsByProfile: Record<string, string[]>
  debugConsole: boolean
  motionMode: MotionMode
  setProfileSettings: (s: ClientProfileSettings) => void
  updateRamMb: (mb: number) => void
  toggleFlag: (flag: keyof ClientProfileSettings['flags']) => void
  toggleOptional: (name: string) => void
  setOptionals: (enabled: string[], dirty?: boolean) => void
  setAvailableJava: (java: JavaVersion[]) => void
  setSelectedJava: (index: number, path: string) => void
  setDebugConsole: (v: boolean) => void
  setMotionMode: (mode: MotionMode) => void
  markClean: () => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      profileSettings: null,
      availableJava: [],
      dirty: false,
      optionalsByProfile: {},
      debugConsole: false,
      motionMode: 'system',
      setProfileSettings: (s) => set(st => {
        const saved = st.optionalsByProfile[s.profileUuid]
        const profileSettings = saved ? { ...s, enabledOptionals: saved } : s
        return { profileSettings, dirty: false }
      }),
      updateRamMb: (mb) => set(st => ({
        dirty: true,
        profileSettings: st.profileSettings ? { ...st.profileSettings, reservedMemoryMb: mb } : null,
      })),
      toggleFlag: (flag) => set(st => {
        if (!st.profileSettings) return st
        return {
          dirty: true,
          profileSettings: {
            ...st.profileSettings,
            flags: { ...st.profileSettings.flags, [flag]: !st.profileSettings.flags[flag] },
          },
        }
      }),
      toggleOptional: (name) => set(st => {
        if (!st.profileSettings) return st
        const cur = st.profileSettings.enabledOptionals ?? []
        const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]
        const uuid = st.profileSettings.profileUuid
        return {
          dirty: true,
          profileSettings: { ...st.profileSettings, enabledOptionals: next },
          optionalsByProfile: { ...st.optionalsByProfile, [uuid]: next },
        }
      }),
      setOptionals: (enabled, dirty = true) => set(st => {
        if (!st.profileSettings) return st
        const uuid = st.profileSettings.profileUuid
        return {
          dirty,
          profileSettings: { ...st.profileSettings, enabledOptionals: [...enabled] },
          optionalsByProfile: { ...st.optionalsByProfile, [uuid]: [...enabled] },
        }
      }),
      setAvailableJava: (java) => set({ availableJava: java }),
      setSelectedJava: (index, path) => set(st => ({
        dirty: true,
        profileSettings: st.profileSettings
          ? { ...st.profileSettings, selectedJavaMajor: index, selectedJavaPath: path }
          : null,
      })),
      setDebugConsole: (v) => set({ debugConsole: v }),
      setMotionMode: (motionMode) => set({ motionMode }),
      markClean: () => set({ dirty: false }),
    }),
    {
      name: 'varryal-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        optionalsByProfile: s.optionalsByProfile,
        debugConsole: s.debugConsole,
        motionMode: s.motionMode,
      }),
      version: 2,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<SettingsStore>
        return { ...state, motionMode: state.motionMode ?? 'system' }
      },
    },
  ),
)
