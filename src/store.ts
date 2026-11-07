// Who is signed in, kept for the browser, with no framework in it.
// `@cauthyhq/react` is this store in React's terms; anything else (Angular,
// Vue, Svelte, a page with no framework) can use it as it is.
//
//   const store = createSessionStore()
//   const stop = store.subscribe(({ session, status }) => render(session))
//   await store.auth.signIn.email({ email, password })   // subscribers hear the new session
//
// While somebody listens it asks the server who is signed in, asks again
// shortly before the session's token runs out, and when the tab is looked at
// again. With nobody listening it does nothing.

import { createAuthClient, type AuthClient, type AuthClientOptions } from './client'
import { watchProtocol } from './protocol'
import { mountPoint } from './transport'
import type { PublicSession } from './types'

export interface SessionState {
  /** The signed-in person and their organizations, or null. */
  session: PublicSession | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
}

export interface SessionStoreOptions extends AuthClientOptions {
  /**
   * The session the server already read while rendering (SSR): the first
   * paint is then right, with no "loading". `null` means "nobody"; leave it
   * out when the server did not look.
   */
  initialSession?: PublicSession | null
}

export interface SessionStore {
  /** What is known now. The same object until it changes. */
  get(): SessionState
  /** Calls `listener` now and on every change. Answers how to stop. */
  subscribe(listener: (state: SessionState) => void): () => void
  /** Asks the server again who is signed in. */
  refresh(): Promise<PublicSession | null>
  /** Sends the browser to Cauthy's page to sign in, and back to `returnTo` (default: where it is now). */
  signIn(options?: { returnTo?: string; locale?: string; prompt?: 'login' }): void
  /** Where `signIn` sends the browser, for a plain link. */
  signInUrl(options?: { returnTo?: string; locale?: string; prompt?: 'login' }): string
  /** Signs out of this application and of Cauthy in this browser. */
  signOut(): void
  /** Where `signOut` sends the browser, for a plain link. */
  signOutUrl(): string
  /** Where the person looks after their account on Cauthy's page. */
  accountUrl(returnTo?: string): string
  /**
   * The functions of an application's own screens. They are
   * `createAuthClient()`'s, and what changes who is signed in is heard by the
   * subscribers with no reload.
   */
  auth: AuthClient
  /** Where the server mounted the routes. */
  basePath: string
}

/** Ask again this long before the session's token runs out. */
const AHEAD_MS = 60_000

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const base = mountPoint(options.basePath)
  const doFetch: typeof fetch = (...args) => (options.fetch ?? fetch)(...args)
  const watch = watchProtocol(base, options.onProtocolMismatch)
  const first = options.initialSession
  let state: SessionState = { session: first ?? null, status: first === undefined ? 'loading' : first === null ? 'unauthenticated' : 'authenticated' }
  const listeners = new Set<(state: SessionState) => void>()
  let asking: Promise<PublicSession | null> | null = null
  // Bumped by every call that changes who is signed in: an answer to an ask
  // made before the bump is stale, and the store asks again.
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let asked = first !== undefined

  const set = (next: SessionState) => {
    if (next.session === state.session && next.status === state.status) return
    state = next
    schedule()
    for (const l of [...listeners]) l(state)
  }

  function schedule(): void {
    clearTimeout(timer)
    timer = undefined
    if (listeners.size === 0 || state.session === null) return
    const wait = Math.max(new Date(state.session.expiresAt).getTime() - Date.now() - AHEAD_MS, 5_000)
    timer = setTimeout(() => void refresh(), wait)
  }

  /** One ask of the server: its answer, or null when it could not say. */
  async function askOnce(): Promise<{ session: PublicSession | null; status: string } | null> {
    try {
      const res = await doFetch(`${base}/session`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      watch(res)
      if (!res.ok) return null
      return (await res.json()) as { session: PublicSession | null; status: string }
    } catch {
      return null
    }
  }

  function refresh(): Promise<PublicSession | null> {
    asked = true
    asking ??= (async () => {
      try {
        for (;;) {
          const asOf = generation
          const body = await askOnce()
          // Who is signed in changed while this ask was out: ask again.
          if (asOf !== generation) continue
          if (body === null) {
            if (state.status === 'loading') set({ session: null, status: 'unauthenticated' })
            return null
          }
          // "expired" is the server unable to reach Cauthy: what is on screen
          // stays, and the next ask settles it.
          if (body.status !== 'expired') set({ session: body.session, status: body.session ? 'authenticated' : 'unauthenticated' })
          return body.session
        }
      } finally {
        asking = null
      }
    })()
    return asking
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') void refresh()
  }
  const inBrowser = () => typeof document !== 'undefined'
  const here = () => (typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search)

  const signInUrl = (o: { returnTo?: string; locale?: string; prompt?: 'login' } = {}) => {
    const q = new URLSearchParams({ return_to: o.returnTo ?? here() })
    if (o.locale) q.set('locale', o.locale)
    if (o.prompt) q.set('prompt', o.prompt)
    return `${base}/login?${q}`
  }
  const signOutUrl = () => `${base}/logout`

  const client = createAuthClient({ ...options, basePath: base })
  // What changes who is signed in is followed by asking again.
  const then = async <T,>(running: Promise<T>): Promise<T> => {
    const r = await running
    generation++
    await refresh()
    return r
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1 && inBrowser()) {
        document.addEventListener('visibilitychange', onVisible)
        schedule()
        if (!asked) void refresh()
      }
      listener(state)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          clearTimeout(timer)
          timer = undefined
          if (inBrowser()) document.removeEventListener('visibilitychange', onVisible)
        }
      }
    },
    refresh,
    signIn(o) {
      window.location.assign(signInUrl(o))
    },
    signInUrl,
    signOut() {
      window.location.assign(signOutUrl())
    },
    signOutUrl,
    accountUrl(returnTo) {
      return `${base}/account?return_to=${encodeURIComponent(returnTo ?? here())}`
    },
    auth: {
      ...client,
      signIn: {
        ...client.signIn,
        anonymously: (f) => then(client.signIn.anonymously(f)),
        email: (f) => then(client.signIn.email(f)),
        mfa: (f) => then(client.signIn.mfa(f)),
        mfaPushWait: (o) => then(client.signIn.mfaPushWait(o)),
        magicLinkVerify: (f) => then(client.signIn.magicLinkVerify(f)),
        emailCode: (f) => then(client.signIn.emailCode(f)),
        passkey: (o) => then(client.signIn.passkey(o)),
        passkeyAutofill: (o) => then(client.signIn.passkeyAutofill(o)),
        googleOneTap: (o) => then(client.signIn.googleOneTap(o)),
      },
      signUp: { email: (f) => then(client.signUp.email(f)) },
      // The invited person is signed in once they accept; a confirmed address may sign in from its link.
      acceptInvitation: (token, password) => then(client.acceptInvitation(token, password)),
      verifyEmail: (f) => then(client.verifyEmail(f)),
      signOut: () => then(client.signOut()),
      account: {
        ...client.account,
        // What is on screen says the new name, and knows when the session ended.
        update: (f) => then(client.account.update(f)),
        changePassword: (f) => then(client.account.changePassword(f)),
        signOutEverywhere: () => then(client.account.signOutEverywhere()),
        // The guest is now the account: what is on screen says so.
        upgrade: (f) => then(client.account.upgrade(f)),
      },
    },
    basePath: base,
  }
}
