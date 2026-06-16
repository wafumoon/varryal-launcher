import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SelfUser, AuthMethod } from '../ipc/types'

export type AuthState = 'idle' | 'loading' | 'error' | 'authed'

interface AuthStore {
  state: AuthState
  user: SelfUser | null
  /**
   * Account access token received from credentials login (portal /launcher/auth/login).
   * Used as Bearer token for portal /launcher/me/* endpoints. Persisted across
   * launches (localStorage) so the user lands on character select, not the login
   * form, until the token expires. NOT the per-character minecraft access token.
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

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'varryal-auth',
      storage: createJSONStorage(() => localStorage),
      // Only the long-lived account token survives a relaunch; everything else is
      // session-runtime state and starts fresh.
      partialize: (s) => ({ accountToken: s.accountToken }),
    },
  ),
)
