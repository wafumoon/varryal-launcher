import { create } from 'zustand'
import type { SelfUser, AuthMethod } from '../ipc/types'

export type AuthState = 'idle' | 'loading' | 'error' | 'authed'

interface AuthStore {
  state: AuthState
  user: SelfUser | null
  /**
   * Account access token received from the web-auth callback.
   * Used as Bearer token for portal /launcher/me/* endpoints.
   * NOT the per-character minecraft access token.
   */
  accountToken: string | null
  authMethods: AuthMethod[]
  selectedMethod: string
  error: string | null
  // actions
  setAuthMethods: (methods: AuthMethod[]) => void
  setSelectedMethod: (name: string) => void
  setLoading: () => void
  setUser: (user: SelfUser) => void
  setAccountToken: (token: string) => void
  setError: (msg: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  state: 'idle',
  user: null,
  accountToken: null,
  authMethods: [],
  selectedMethod: 'std',
  error: null,
  setAuthMethods: (methods) => set({ authMethods: methods }),
  setSelectedMethod: (name) => set({ selectedMethod: name }),
  setLoading: () => set({ state: 'loading', error: null }),
  setUser: (user) => set({ state: 'authed', user, error: null }),
  setAccountToken: (token) => set({ accountToken: token }),
  setError: (msg) => set({ state: 'error', error: msg }),
  logout: () => set({ state: 'idle', user: null, accountToken: null, error: null }),
}))
