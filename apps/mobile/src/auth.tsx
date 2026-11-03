import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { api, setToken, setUnauthorized, type Workspace } from './api'

type Session = { id: string; email: string; displayName: string; carddavUrl: string; carddavPhoneUrl: string | null }

function withCarddav(
  user: { id: string; email: string; displayName: string },
  me: { carddavUrl: string; carddavPhoneUrl?: string | null },
): Session {
  return { ...user, carddavUrl: me.carddavUrl, carddavPhoneUrl: me.carddavPhoneUrl ?? null }
}

type AuthValue = {
  ready: boolean
  needsSetup: boolean
  session: Session | null
  workspace: Workspace | null
  workspaces: Workspace[]
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string, invite?: string) => Promise<void>
  createAdmin: (email: string, password: string, displayName: string) => Promise<void>
  completeOauth: (token: string) => Promise<void>
  signOut: () => Promise<void>
  refreshWorkspaces: () => Promise<void>
  selectWorkspace: (workspace: Workspace) => void
}

const AuthContext = createContext<AuthValue | null>(null)
const storageKey = 'rolodex.session'

function readStored() {
  if (Platform.OS !== 'web' || typeof sessionStorage === 'undefined') return null
  const raw = sessionStorage.getItem(storageKey)
  return raw ? (JSON.parse(raw) as { token: string; session: Session; workspaceId?: string }) : null
}

function writeStored(value: { token: string; session: Session; workspaceId?: string } | null) {
  if (Platform.OS !== 'web' || typeof sessionStorage === 'undefined') return
  if (!value) sessionStorage.removeItem(storageKey)
  else sessionStorage.setItem(storageKey, JSON.stringify(value))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [token, setTokenState] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)

  async function loadWorkspaces(authToken: string, sessionValue: Session, preferredId?: string) {
    setToken(authToken)
    const rows = await api<Workspace[]>('/api/workspaces')
    const next = rows.find((item) => item.id === preferredId) ?? rows[0] ?? null
    setWorkspaces(rows)
    setWorkspace(next)
    setSession(sessionValue)
    setTokenState(authToken)
    writeStored({ token: authToken, session: sessionValue, workspaceId: next?.id })
  }

  useEffect(() => {
    let cancel = false
    setUnauthorized(() => {
      setToken(null)
      setTokenState(null)
      setSession(null)
      setWorkspace(null)
      writeStored(null)
    })
    const stored = readStored()
    const setupPromise = api<{ required: boolean }>('/api/auth/setup')
      .then((result) => result.required)
      .catch(() => false)
    if (!stored) {
      setupPromise
        .then((required) => {
          if (!cancel) setNeedsSetup(required)
        })
        .finally(() => {
          if (!cancel) setReady(true)
        })
      return () => {
        cancel = true
      }
    }
    setToken(stored.token)
    setupPromise
      .then(async (required) => {
        if (cancel) return
        setNeedsSetup(required)
        const me = await api<{ user: { id: string; email: string; displayName: string }; carddavUrl: string; carddavPhoneUrl?: string | null }>('/api/auth/me')
        if (cancel) return
        await loadWorkspaces(stored.token, withCarddav(me.user, me), stored.workspaceId)
      })
      .catch(() => {
        if (!cancel) writeStored(null)
      })
      .finally(() => {
        if (!cancel) setReady(true)
      })
    return () => {
      cancel = true
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      needsSetup,
      session,
      workspace,
      workspaces,
      async signIn(email, password) {
        const result = await api<{ token: string; user: { id: string; email: string; displayName: string } }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        })
        const me = await api<{ carddavUrl: string; carddavPhoneUrl?: string | null }>('/api/auth/me')
        await loadWorkspaces(result.token, withCarddav(result.user, me))
      },
      async createAdmin(email, password, displayName) {
        const result = await api<{ token: string; user: { id: string; email: string; displayName: string } }>('/api/auth/setup', {
          method: 'POST',
          body: JSON.stringify({ email, password, displayName }),
        })
        const me = await api<{ carddavUrl: string; carddavPhoneUrl?: string | null }>('/api/auth/me')
        await loadWorkspaces(result.token, withCarddav(result.user, me))
        setNeedsSetup(false)
      },
      async signUp(email, password, displayName, invite) {
        const result = await api<{ token: string; user: { id: string; email: string; displayName: string } }>(
          '/api/auth/register',
          { method: 'POST', body: JSON.stringify({ email, password, displayName, invite: invite || undefined }) },
        )
        const me = await api<{ carddavUrl: string; carddavPhoneUrl?: string | null }>('/api/auth/me')
        await loadWorkspaces(result.token, withCarddav(result.user, me))
      },
      async completeOauth(authToken) {
        setToken(authToken)
        const me = await api<{ user: { id: string; email: string; displayName: string }; carddavUrl: string; carddavPhoneUrl?: string | null }>('/api/auth/me')
        await loadWorkspaces(authToken, withCarddav(me.user, me))
      },
      async signOut() {
        let endSession = ''
        let clientId = ''
        try {
          const config = await api<{ endSessionEndpoint?: string; clientId?: string }>('/api/auth/oauth')
          endSession = config.endSessionEndpoint || ''
          clientId = config.clientId || ''
        } catch {
          endSession = ''
        }
        try {
          await api('/api/auth/logout', { method: 'POST' })
        } finally {
          setToken(null)
          setTokenState(null)
          setSession(null)
          setWorkspace(null)
          writeStored(null)
          if (endSession && Platform.OS === 'web') {
            const url = new URL(endSession)
            url.searchParams.set('post_logout_redirect_uri', `${window.location.origin}/sign-in`)
            if (clientId) url.searchParams.set('client_id', clientId)
            window.location.assign(url.toString())
          }
        }
      },
      async refreshWorkspaces() {
        if (!token || !session) return
        await loadWorkspaces(token, session, workspace?.id)
      },
      selectWorkspace(next) {
        setWorkspace(next)
        if (token && session) writeStored({ token, session, workspaceId: next.id })
      },
    }),
    [ready, needsSetup, session, workspace, workspaces, token],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider is missing')
  return value
}
