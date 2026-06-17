import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ClientProfileSettings, JavaVersion } from '../ipc/types'

interface SettingsStore {
  profileSettings: ClientProfileSettings | null
  availableJava: JavaVersion[]
  dirty: boolean
  /**
   * Per-profile optional-mod selection, persisted to localStorage so the choice
   * survives a relaunch / re-auth (D26). Keyed by profileUuid. This is the source
   * of truth on load: setProfileSettings() restores from here over whatever the
   * bridge returns.
   */
  optionalsByProfile: Record<string, string[]>
  /**
   * Show the in-game console after launch (debug mode). When false (default), the
   * launcher hides to the system tray while the game runs (D25). App-level, persisted.
   */
  debugConsole: boolean
  // actions
  setProfileSettings: (s: ClientProfileSettings) => void
  updateRamMb: (mb: number) => void
  toggleFlag: (flag: keyof ClientProfileSettings['flags']) => void
  toggleOptional: (name: string) => void
  setAvailableJava: (java: JavaVersion[]) => void
  setSelectedJava: (index: number, path: string) => void
  setDebugConsole: (v: boolean) => void
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
      setProfileSettings: (s) => set(st => {
        // Restore the user's saved optional-mod selection for this profile, if any,
        // so toggles survive relaunches even when the bridge returns defaults.
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
      setAvailableJava: (java) => set({ availableJava: java }),
      setSelectedJava: (index, path) => set(st => ({
        dirty: true,
        profileSettings: st.profileSettings
          ? { ...st.profileSettings, selectedJavaMajor: index, selectedJavaPath: path }
          : null,
      })),
      setDebugConsole: (v) => set({ debugConsole: v }),
      markClean: () => set({ dirty: false }),
    }),
    {
      name: 'varryal-settings',
      storage: createJSONStorage(() => localStorage),
      // The per-profile optional-mod selection and the debug-console preference
      // persist; the rest is reloaded from the bridge each session.
      partialize: (s) => ({ optionalsByProfile: s.optionalsByProfile, debugConsole: s.debugConsole }),
    },
  ),
)
