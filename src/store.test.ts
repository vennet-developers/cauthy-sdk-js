import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore } from './store'
import type { PublicSession } from './types'

const ana = (over: Partial<PublicSession> = {}): PublicSession => ({
  user: { id: 'u1', email: 'ana@acme.com', name: 'Ana', emailVerified: true, restricted: false },
  tenantId: 't1', roles: [], organizations: [], expiresAt: new Date(Date.now() + 600_000).toISOString(), ...over,
})

// The application's server, as the browser sees it.
function server(start: PublicSession | null = null) {
  const world = { session: start, status: 'ok' as 'ok' | 'expired' | 'down', asked: [] as string[] }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = String(input)
    world.asked.push(`${init?.method ?? 'GET'} ${path}`)
    if (world.status === 'down') throw new Error('offline')
    if (path === '/api/auth/session') {
      return Response.json({ session: world.status === 'expired' ? null : world.session, status: world.status === 'expired' ? 'expired' : world.session ? 'authenticated' : 'unauthenticated' })
    }
    if (path === '/api/auth/sign-in/email') {
      world.session = ana()
      return Response.json({ status: 'signed_in', session: world.session })
    }
    if (path === '/api/auth/sign-out') {
      world.session = null
      return Response.json({ status: 'signed_out' })
    }
    if (path === '/api/auth/me') {
      world.session = ana({ user: { ...ana().user, name: 'Ana María' } })
      return Response.json({ status: 'saved', account: {} })
    }
    return new Response('not found', { status: 404 })
  }
  return { world, fetch }
}

// A page, as far as the store asks of one.
let visibility: (() => void) | undefined
beforeEach(() => {
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (_: string, fn: () => void) => { visibility = fn },
    removeEventListener: () => { visibility = undefined },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  visibility = undefined
})
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('who is signed in, kept for the browser', () => {
  it('asks the server once somebody listens, and tells every change', async () => {
    const { world, fetch } = server(ana())
    const store = createSessionStore({ fetch })
    expect(store.get()).toEqual({ session: null, status: 'loading' })
    expect(world.asked).toEqual([]) // nobody listening: nothing asked

    const heard: string[] = []
    const stop = store.subscribe((s) => heard.push(`${s.status}:${s.session?.user.name ?? '-'}`))
    await settle()
    expect(heard).toEqual(['loading:-', 'authenticated:Ana'])
    expect(world.asked).toEqual(['GET /api/auth/session'])

    // An application's own screen: what changes who is signed in is heard at once.
    await store.auth.account.update({ name: 'Ana María' })
    expect(heard.at(-1)).toBe('authenticated:Ana María')
    await store.auth.signOut()
    expect(heard.at(-1)).toBe('unauthenticated:-')
    await store.auth.signIn.email({ email: 'ana@acme.com', password: 'right-password' })
    expect(heard.at(-1)).toBe('authenticated:Ana')

    stop()
    expect(visibility).toBeUndefined()
  })

  it('starts from what the server rendered with, and asks nothing', async () => {
    const { world, fetch } = server(ana())
    const known = createSessionStore({ fetch, initialSession: ana() })
    const nobody = createSessionStore({ fetch, initialSession: null })
    known.subscribe(() => undefined)
    nobody.subscribe(() => undefined)
    await settle()
    expect(known.get().status).toBe('authenticated')
    expect(nobody.get()).toEqual({ session: null, status: 'unauthenticated' })
    expect(world.asked).toEqual([])
  })

  it('asks again shortly before the session runs out, and when the tab is looked at again', async () => {
    vi.useFakeTimers()
    const { world, fetch } = server(ana())
    const store = createSessionStore({ fetch, initialSession: ana({ expiresAt: new Date(Date.now() + 120_000).toISOString() }) })
    const stop = store.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(world.asked).toEqual([])
    await vi.advanceTimersByTimeAsync(2_000) // one minute before it runs out
    expect(world.asked).toEqual(['GET /api/auth/session'])
    visibility?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(world.asked).toHaveLength(2)
    stop()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(world.asked).toHaveLength(2) // nobody listening: nothing more asked
  })

  it('keeps what is on screen when the server cannot reach Cauthy, or cannot be reached', async () => {
    const { world, fetch } = server(ana())
    const store = createSessionStore({ fetch, initialSession: ana() })
    store.subscribe(() => undefined)
    world.status = 'expired'
    await store.refresh()
    expect(store.get().status).toBe('authenticated')
    world.status = 'down'
    await store.refresh()
    expect(store.get().session?.user.email).toBe('ana@acme.com')
    // But somebody never known is nobody, not "loading" for ever.
    const fresh = createSessionStore({ fetch })
    fresh.subscribe(() => undefined)
    await settle()
    expect(fresh.get()).toEqual({ session: null, status: 'unauthenticated' })
  })
})

describe('the store of @cauthyhq/js', () => {
  it('builds the hosted addresses, for a link or a redirect', () => {
    const store = createSessionStore({ basePath: '/auth///' })
    expect(store.signInUrl({ returnTo: '/deals', locale: 'es', prompt: 'login' })).toBe('/auth/login?return_to=%2Fdeals&locale=es&prompt=login')
    expect(store.signOutUrl()).toBe('/auth/logout')
    expect(store.accountUrl('/deals')).toBe('/auth/account?return_to=%2Fdeals')
    expect(store.basePath).toBe('/auth')
  })

  it('hears the session after an invitation, a confirmed address and a guest that became an account', async () => {
    let session: PublicSession | null = null
    const fetch = (async (url: string) => {
      const path = String(url)
      if (path === '/api/auth/session') return Response.json({ session, status: session ? 'authenticated' : 'unauthenticated' }, { headers: { 'cauthy-protocol': '1' } })
      session = ana({ user: { ...ana().user, name: path.split('/').pop()! } })
      return Response.json({ status: 'signed_in', session }, { headers: { 'cauthy-protocol': '1' } })
    }) as unknown as typeof globalThis.fetch
    const store = createSessionStore({ fetch, initialSession: null })
    const heard: string[] = []
    const stop = store.subscribe((s) => heard.push(s.session?.user.name ?? '-'))
    await store.auth.acceptInvitation('t', 'a-long-enough-password')
    await store.auth.verifyEmail({ token: 't' })
    await store.auth.account.upgrade({ email: 'ana@acme.com', password: 'a-long-enough-password' })
    stop()
    expect(heard).toEqual(['-', 'accept', 'verify-email', 'upgrade'])
  })

  it('passes the locale and the protocol check to its client', async () => {
    const asked: Record<string, string>[] = []
    const fetch = (async (_url: string, init?: RequestInit) => {
      asked.push({ ...(init?.headers as Record<string, string>) })
      return Response.json({ status: 'sent' })
    }) as unknown as typeof globalThis.fetch
    const told: (string | null)[] = []
    const store = createSessionStore({ fetch, locale: 'es-CO', onProtocolMismatch: (seen) => told.push(seen) })
    await store.auth.forgotPassword({ email: 'ana@acme.com' })
    expect(asked[0]['x-cauthy-locale']).toBe('es-CO')
    expect(asked[0]['x-cauthy-request']).toBe('1')
    expect(told).toEqual([null])
  })
})

describe('the store mount point', () => {
  it('refuses a basePath on another origin', () => {
    expect(() => createSessionStore({ basePath: '//evil.example.com' })).toThrow(TypeError)
  })
})
