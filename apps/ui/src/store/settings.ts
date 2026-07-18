import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ClientProfileSettings, JavaVersion } from '../ipc/types'
import type { MotionMode } from '../utils/launcherState.js'
import {
  canAcknowledgeSettingsSave,
  canRollbackOptionalSelection,
  dirtyAfterOptionalRollback,
  resolveOptionalRevisionOnProfileLoad,
} from '../utils/launcherState.js'

interface SettingsStore {
  profileSettings: ClientProfileSettings | null
  availableJava: JavaVersion[]
  dirty: boolean
  revision: number
  optionalsByProfile: Record<string, string[]>
  optionalsRevisionByProfile: Record<string, number>
  debugConsole: boolean
  motionMode: MotionMode
  setProfileSettings: (s: ClientProfileSettings) => void
  updateRamMb: (mb: number) => void
  toggleFlag: (flag: keyof ClientProfileSettings['flags']) => void
  toggleOptional: (name: string) => void
  setOptionals: (enabled: string[], dirty?: boolean) => void
  adoptCurrentOptionalsForSave: (profileUuid: string) => void
  rollbackOptionals: (profileUuid: string, enabled: string[], savedRevision: number, dirtyBefore: boolean) => void
  setAvailableJava: (java: JavaVersion[]) => void
  setSelectedJava: (index: number, path: string) => void
  setDebugConsole: (v: boolean) => void
  setMotionMode: (mode: MotionMode) => void
  markClean: (profileUuid: string, savedRevision: number) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      profileSettings: null,
      availableJava: [],
      dirty: false,
      revision: 0,
      optionalsByProfile: {},
      optionalsRevisionByProfile: {},
      debugConsole: false,
      motionMode: 'system',
      setProfileSettings: (s) => set(st => {
        const saved = st.optionalsByProfile[s.profileUuid]
        const profileSettings = saved ? { ...s, enabledOptionals: saved } : s
        const nextRevision = st.revision + 1
        return {
          profileSettings,
          dirty: false,
          revision: nextRevision,
          optionalsRevisionByProfile: {
            ...st.optionalsRevisionByProfile,
            [s.profileUuid]: resolveOptionalRevisionOnProfileLoad(
              st.optionalsRevisionByProfile[s.profileUuid],
              nextRevision,
            ),
          },
        }
      }),
      updateRamMb: (mb) => set(st => ({
        dirty: true,
        revision: st.revision + 1,
        profileSettings: st.profileSettings ? { ...st.profileSettings, reservedMemoryMb: mb } : null,
      })),
      toggleFlag: (flag) => set(st => {
        if (!st.profileSettings) return st
        return {
          dirty: true,
          revision: st.revision + 1,
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
        const nextRevision = st.revision + 1
        return {
          dirty: true,
          revision: nextRevision,
          profileSettings: { ...st.profileSettings, enabledOptionals: next },
          optionalsByProfile: { ...st.optionalsByProfile, [uuid]: next },
          optionalsRevisionByProfile: { ...st.optionalsRevisionByProfile, [uuid]: nextRevision },
        }
      }),
      setOptionals: (enabled, dirty = true) => set(st => {
        if (!st.profileSettings) return st
        const uuid = st.profileSettings.profileUuid
        const nextRevision = st.revision + 1
        return {
          dirty,
          revision: nextRevision,
          profileSettings: { ...st.profileSettings, enabledOptionals: [...enabled] },
          optionalsByProfile: { ...st.optionalsByProfile, [uuid]: [...enabled] },
          optionalsRevisionByProfile: { ...st.optionalsRevisionByProfile, [uuid]: nextRevision },
        }
      }),
      adoptCurrentOptionalsForSave: (profileUuid) => set(st => {
        if (!st.profileSettings || st.profileSettings.profileUuid !== profileUuid) return st
        const nextRevision = st.revision + 1
        return {
          revision: nextRevision,
          optionalsRevisionByProfile: {
            ...st.optionalsRevisionByProfile,
            [profileUuid]: nextRevision,
          },
        }
      }),
      rollbackOptionals: (profileUuid, enabled, savedRevision, dirtyBefore) => set(st => {
        if (!st.profileSettings || st.profileSettings.profileUuid !== profileUuid) return st
        if (!canRollbackOptionalSelection(
          savedRevision,
          st.optionalsRevisionByProfile[profileUuid],
        )) return st
        const nextRevision = st.revision + 1
        return {
          dirty: dirtyAfterOptionalRollback(savedRevision, st.revision, st.dirty, dirtyBefore),
          revision: nextRevision,
          profileSettings: { ...st.profileSettings, enabledOptionals: [...enabled] },
          optionalsByProfile: { ...st.optionalsByProfile, [profileUuid]: [...enabled] },
          optionalsRevisionByProfile: {
            ...st.optionalsRevisionByProfile,
            [profileUuid]: nextRevision,
          },
        }
      }),
      setAvailableJava: (java) => set({ availableJava: java }),
      setSelectedJava: (index, path) => set(st => ({
        dirty: true,
        revision: st.revision + 1,
        profileSettings: st.profileSettings
          ? { ...st.profileSettings, selectedJavaMajor: index, selectedJavaPath: path }
          : null,
      })),
      setDebugConsole: (v) => set({ debugConsole: v }),
      setMotionMode: (motionMode) => set({ motionMode }),
      markClean: (profileUuid, savedRevision) => set(st => (
        canAcknowledgeSettingsSave(
          profileUuid,
          savedRevision,
          st.profileSettings?.profileUuid,
          st.revision,
        ) ? { dirty: false } : st
      )),
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
