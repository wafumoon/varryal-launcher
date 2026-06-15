import { create } from 'zustand'
import type { SelfUser, AuthMethod } from '../ipc/types'

export type AuthState = 'idle' | 'loading' | 'error' | 'authed'

interface AuthStore {
  state: AuthState
  user: SelfUser | null
  authMethods: AuthMethod[]
  selectedMethod: string
  error: string | null
  // actions
  setAuthMethods: (methods: AuthMethod[]) => void
  setSelectedMethod: (name: string) => void
  setLoading: () => void
  setUser: (user: SelfUser) => void
  setError: (msg: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  state: 'idle',
  user: null,
  authMethods: [],
  selectedMethod: 'std',
  error: null,
  setAuthMethods: (methods) => set({ authMethods: methods }),
  setSelectedMethod: (name) => set({ selectedMethod: name }),
  setLoading: () => set({ state: 'loading', error: null }),
  setUser: (user) => set({ state: 'authed', user, error: null }),
  setError: (msg) => set({ state: 'error', error: msg }),
  logout: () => set({ state: 'idle', user: null, error: null }),
}))
