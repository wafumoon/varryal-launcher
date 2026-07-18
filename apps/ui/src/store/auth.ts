import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SelfUser, AuthMethod, Character } from '../ipc/types'

export type AuthState = 'idle' | 'loading' | 'error' | 'authed'

interface AuthStore {
  state: AuthState
  user: SelfUser | null
  accountToken: string | null
  displayName: string | null
  authMethods: AuthMethod[]
  selectedMethod: string
  error: string | null
  lastCharId: string | null
  /** Last portal-confirmed character list, used only as read-only offline context. */
  cachedCharacters: Character[]
  setAuthMethods: (methods: AuthMethod[]) => void
  setSelectedMethod: (name: string) => void
  setLoading: () => void
  setUser: (user: SelfUser) => void
  setAccountToken: (token: string) => void
  setDisplayName: (name: string) => void
  setError: (msg: string) => void
  setLastCharId: (id: string | null) => void
  setCachedCharacters: (characters: Character[]) => void
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
      lastCharId: null,
      cachedCharacters: [],
      setAuthMethods: (methods) => set({ authMethods: methods }),
      setSelectedMethod: (name) => set({ selectedMethod: name }),
      setLoading: () => set({ state: 'loading', error: null }),
      setUser: (user) => set({ state: 'authed', user, error: null }),
      setAccountToken: (token) => set({ accountToken: token }),
      setDisplayName: (name) => set({ displayName: name }),
      setError: (msg) => set({ state: 'error', error: msg }),
      setLastCharId: (id) => set({ lastCharId: id }),
      setCachedCharacters: (cachedCharacters) => set({ cachedCharacters }),
      logout: () => set({
        state: 'idle', user: null, accountToken: null, displayName: null,
        lastCharId: null, cachedCharacters: [], error: null,
      }),
    }),
    {
      name: 'varryal-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        accountToken: s.accountToken,
        displayName: s.displayName,
        lastCharId: s.lastCharId,
        cachedCharacters: s.cachedCharacters,
      }),
      version: 2,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<AuthStore>
        if (version < 1) {
          return { accountToken: null, displayName: null, lastCharId: null, cachedCharacters: [] }
        }
        return { ...state, cachedCharacters: state.cachedCharacters ?? [] }
      },
    },
  ),
)
