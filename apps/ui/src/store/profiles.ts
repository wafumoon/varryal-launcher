import { create } from 'zustand'
import type { ClientProfile, ServerPingInfo } from '../ipc/types'

interface ProfilesStore {
  profiles: ClientProfile[]
  selected: ClientProfile | null
  loading: boolean
  error: string | null
  pings: Record<string, ServerPingInfo>
  setProfiles: (profiles: ClientProfile[]) => void
  selectProfile: (profile: ClientProfile) => void
  setLoading: (v: boolean) => void
  setError: (msg: string | null) => void
  setPing: (uuid: string, ping: ServerPingInfo) => void
}

export const useProfilesStore = create<ProfilesStore>((set) => ({
  profiles: [],
  selected: null,
  loading: false,
  error: null,
  pings: {},
  setProfiles: (profiles) => set({ profiles }),
  selectProfile: (profile) => set({ selected: profile }),
  setLoading: (v) => set({ loading: v }),
  setError: (msg) => set({ error: msg }),
  setPing: (uuid, ping) => set(s => ({ pings: { ...s.pings, [uuid]: ping } })),
}))
