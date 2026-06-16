import { create } from 'zustand'
import type { ClientProfileSettings, JavaVersion } from '../ipc/types'

interface SettingsStore {
  profileSettings: ClientProfileSettings | null
  availableJava: JavaVersion[]
  dirty: boolean
  // actions
  setProfileSettings: (s: ClientProfileSettings) => void
  updateRamMb: (mb: number) => void
  toggleFlag: (flag: keyof ClientProfileSettings['flags']) => void
  toggleOptional: (name: string) => void
  setAvailableJava: (java: JavaVersion[]) => void
  setSelectedJava: (index: number, path: string) => void
  markClean: () => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  profileSettings: null,
  availableJava: [],
  dirty: false,
  setProfileSettings: (s) => set({ profileSettings: s, dirty: false }),
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
    return { dirty: true, profileSettings: { ...st.profileSettings, enabledOptionals: next } }
  }),
  setAvailableJava: (java) => set({ availableJava: java }),
  setSelectedJava: (index, path) => set(st => ({
    dirty: true,
    profileSettings: st.profileSettings
      ? { ...st.profileSettings, selectedJavaMajor: index, selectedJavaPath: path }
      : null,
  })),
  markClean: () => set({ dirty: false }),
}))
