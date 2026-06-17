import { create } from 'zustand'
import type { ClientProfile, ServerPingInfo } from '../ipc/types'

interface ProfilesStore {
  profiles: ClientProfile[]
  selected: ClientProfile | null
  /**
   * The character the user authorized as (id). Lifted out of the Launcher's local
   * state so it survives scene changes — e.g. returning to the launcher after a
   * game run must NOT reset to "no character selected" (D25).
   */
  activeCharId: string | null
  loading: boolean
  error: string | null
  pings: Record<string, ServerPingInfo>
  setProfiles: (profiles: ClientProfile[]) => void
  selectProfile: (profile: ClientProfile) => void
  setActiveCharId: (id: string | null) => void
  setLoading: (v: boolean) => void
  setError: (msg: string | null) => void
  setPing: (uuid: string, ping: ServerPingInfo) => void
}

export const useProfilesStore = create<ProfilesStore>((set) => ({
  profiles: [],
  selected: null,
  activeCharId: null,
  loading: false,
  error: null,
  pings: {},
  setProfiles: (profiles) => set({ profiles }),
  selectProfile: (profile) => set({ selected: profile }),
  setActiveCharId: (id) => set({ activeCharId: id }),
  setLoading: (v) => set({ loading: v }),
  setError: (msg) => set({ error: msg }),
  setPing: (uuid, ping) => set(s => ({ pings: { ...s.pings, [uuid]: ping } })),
}))
