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
  /**
   * Site account display name (from portal /launcher/auth/login `displayName`).
   * Shown in the navbar instead of the per-character minecraft nickname (D27).
   * Persisted so it survives a relaunch that skips the login screen.
   */
  displayName: string | null
  authMethods: AuthMethod[]
  selectedMethod: string
  error: string | null
  // actions
  setAuthMethods: (methods: AuthMethod[]) => void
  setSelectedMethod: (name: string) => void
  setLoading: () => void
  setUser: (user: SelfUser) => void
  setAccountToken: (token: string) => void
  setDisplayName: (name: string) => void
  setError: (msg: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      state: 'idle',
      user: null,
      accountToken: null,
      displayName: null,
      authMethods: [],
      selectedMethod: 'std',
      error: null,
      setAuthMethods: (methods) => set({ authMethods: methods }),
      setSelectedMethod: (name) => set({ selectedMethod: name }),
      setLoading: () => set({ state: 'loading', error: null }),
      setUser: (user) => set({ state: 'authed', user, error: null }),
      setAccountToken: (token) => set({ accountToken: token }),
      setDisplayName: (name) => set({ displayName: name }),
      setError: (msg) => set({ state: 'error', error: msg }),
      logout: () => set({ state: 'idle', user: null, accountToken: null, displayName: null, error: null }),
    }),
    {
      name: 'varryal-auth',
      storage: createJSONStorage(() => localStorage),
      // The long-lived account token + the site display name survive a relaunch;
      // everything else is session-runtime state and starts fresh.
      partialize: (s) => ({ accountToken: s.accountToken, displayName: s.displayName }),
      // v1: the site display name (navbar) is only captured at login. Sessions
      // persisted before this feature have no displayName, so drop them once to
      // force a single fresh login that records it (D27). Cheap one-time re-auth.
      version: 1,
      migrate: () => ({ accountToken: null, displayName: null }),
    },
  ),
)
