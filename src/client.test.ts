// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthClient } from './client'
import { resetProtocolWarnings } from './protocol'

type Answer = { status?: number; body: unknown }
let routes: Record<string, (body: Record<string, unknown>) => Answer>
let sent: { method: string; path: string; body: Record<string, unknown> }[]

beforeEach(() => {
  routes = {}
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^\/api\/auth/, '')
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    sent.push({ method: init?.method ?? 'GET', path, body })
    const route = routes[path] ?? routes[path.split('?')[0]]
    const a = route ? route(body) : { status: 404, body: {} }
    return Response.json(a.body, { status: a.status ?? 200, headers: { 'cauthy-protocol': '1' } })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetProtocolWarnings()
})

describe('the client', () => {
  it("reads what the workspace offers, and an older server's silence as no", async () => {
    routes['/methods'] = () => ({ body: { providers: [{ id: 'google', name: 'Google' }], signUp: false, passkey: true } })
    expect(await createAuthClient().methods()).toMatchObject({
      providers: [{ id: 'google', name: 'Google' }], signUp: false, passwordSignIn: true, passkey: true,
      passkeyHere: false, passkeyOnCauthy: true, sso: false, magicLink: false,
    })
    routes['/methods'] = () => ({ status: 500, body: {} })
    expect(await createAuthClient().methods()).toEqual({ providers: [], signUp: true, passwordSignIn: true, magicLink: false, passkey: false, passkeyHere: false, passkeyOnCauthy: false, sso: false })
  })

  it("checks a new password against the workspace's policy once methods() said it, without sending it", async () => {
    routes['/methods'] = () => ({ body: { password: { min: 16, max: 128, requires: [], min_classes: 0, reject_breached: false } } })
    const auth = createAuthClient()
    await auth.methods()
    expect(await auth.signUp.email({ email: 'ana@acme.com', password: 'only-fifteen-ch' })).toMatchObject({ ok: false, error: { code: 'too_short', field: 'password' } })
    expect(sent.filter((s) => s.method === 'POST')).toEqual([])
  })

  it('signs in with what the form holds, and says what comes next', async () => {
    routes['/sign-in/email'] = (b) => ({ body: b.password === 'right-password' ? { status: 'mfa_required', next: 'mfa' } : {} })
    expect(await createAuthClient().signIn.email({ email: 'ana@acme.com', password: 'right-password', remember: true })).toEqual({ ok: true, status: 'mfa_required', next: 'mfa' })
    expect(sent[0]).toEqual({ method: 'POST', path: '/sign-in/email', body: { email: 'ana@acme.com', password: 'right-password', remember: true } })
  })

  it('answers who is signed in, or null', async () => {
    routes['/session'] = () => ({ body: { session: null, status: 'unauthenticated' } })
    expect(await createAuthClient().getSession()).toBeNull()
    routes['/session'] = () => ({ status: 503, body: {} })
    expect(await createAuthClient().getSession()).toBeNull()
  })

  it('says an invitation is not valid without asking when there is no token, and says why when the server refused it', async () => {
    expect(await createAuthClient().invitation('  ')).toEqual({ ok: false, error: { code: 'invalid_token', message: 'This invitation is not valid, or it has expired.' } })
    expect(sent).toEqual([])
    routes['/invitation'] = () => ({ status: 422, body: { error: { code: 'invalid_token', message: 'Spent.' } } })
    expect(await createAuthClient().invitation('t1')).toEqual({ ok: false, error: { code: 'invalid_token', message: 'Spent.', status: 422 } })
    expect(sent[0].path).toBe('/invitation?token=t1')
  })

  it('refuses a passkey where neither this page nor Cauthy\'s can use one', async () => {
    routes['/methods'] = () => ({ body: { passkey: false } })
    expect(await createAuthClient().signIn.passkey()).toEqual({ ok: false, error: { code: 'passkey_unavailable', message: 'Passkeys cannot be used here.' } })
  })

  it('asks Cauthy about a permission through the server, and a question that failed is a no', async () => {
    routes['/me/organizations/check'] = (b) => ({ body: { status: 'decided', allowed: b.action === 'read', reason: 'allowed by role member: deals:read' } })
    const auth = createAuthClient()
    expect(await auth.organizations.check({ organization: { id: 'o1' }, resource: 'deals', action: 'read' })).toEqual({ allowed: true, reason: 'allowed by role member: deals:read' })
    expect(sent[0].body).toEqual({ organizationId: 'o1', resource: 'deals', action: 'read' })
    routes['/me/organizations/check'] = () => ({ status: 401, body: { error: { code: 'unauthenticated', message: 'Sign in first.' } } })
    expect(await auth.organizations.check({ organization: 'o1', resource: 'deals', action: 'read' }))
      .toEqual({ allowed: false, reason: 'Sign in first.', error: { code: 'unauthenticated', message: 'Sign in first.', status: 401 } })
  })

  it('warns once per page when a guest session is used: version 2 removes it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    routes['/sign-in/anonymous'] = () => ({ body: { status: 'signed_in', session: {} } })
    const auth = createAuthClient()
    await auth.signIn.anonymously()
    await auth.signIn.anonymously()
    auth.account.upgradeUrl('google')
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      '@cauthyhq/js: signIn.anonymously is deprecated: guest sessions leave the auth-bff protocol in version 2.',
      '@cauthyhq/js: account.upgradeUrl is deprecated: guest sessions leave the auth-bff protocol in version 2.',
    ])
  })
})
