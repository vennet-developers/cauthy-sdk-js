// @vitest-environment jsdom
//
// Every route of auth-bff version 1 is reachable from this package: called by
// a method of the client or the store, or built as an address the browser is
// sent to. The few the browser never asks for itself say why. A route the
// spec adds fails here until the client reaches it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore } from './store'
import { ROUTES, type RouteId } from './generated/routes'

const NOT_CALLED: Partial<Record<RouteId, string>> = {
  'hosted.callback': 'Cauthy sends the browser there after the hosted sign-in',
  'hosted.logout_post': 'a plain HTML form posts it; the store uses GET /logout',
  'hosted.refresh': 'the backend redirects a page there to renew its session',
  'sign-in.social_callback': 'the provider sends the browser there',
  'sign-in.sso_callback': 'the company sends the browser there',
}

function routeOf(method: string, url: string): RouteId | undefined {
  const path = new URL(url, 'http://app.test').pathname.replace(/^\/api\/auth/, '')
  return (Object.keys(ROUTES) as RouteId[]).find((id) => {
    const r = ROUTES[id]
    return r.method === method && new RegExp(`^${r.path.replace('{provider}', '[^/]+')}$`).test(path)
  })
}

const SESSION = {
  user: { id: 'u1', email: 'ana@acme.com', name: 'Ana', emailVerified: true, restricted: false },
  tenantId: 't1', roles: [], organizations: [], expiresAt: new Date(Date.now() + 600_000).toISOString(),
}
function answer(path: string): unknown {
  switch (path) {
    case '/methods': return { providers: [], passwordSignIn: true, signUp: true, magicLink: true, passkey: true, passkeyHere: true, passkeyOnCauthy: false, sso: true }
    case '/session': return { session: SESSION, status: 'authenticated' }
    case '/sign-in/passkey/begin': return { status: 'started', options: { challenge: 'AQ', allowCredentials: [] } }
    case '/me/passkeys/add/begin': return { status: 'started', options: { challenge: 'AQ', user: { id: 'Ag', name: 'ana@acme.com', displayName: 'Ana' }, excludeCredentials: [] } }
    case '/sign-in/google-one-tap/begin': return { status: 'started', clientId: 'acme.apps.example.com', nonce: 'n1' }
    case '/invitation': return { status: 'ok', invitation: { email: 'ana@acme.com', workspace: 'Acme' } }
    case '/me': return { status: 'saved', account: { id: 'u1' } }
    default: return { status: 'ok', session: SESSION, organizations: [], members: [], roles: [], identities: [], sessions: [], agents: [], passkeys: [], pending: [], totp: false, phoneChannels: [] }
  }
}

const asked: { method: string; url: string; headers: Record<string, string> }[] = []
const buf = () => new Uint8Array([1, 2, 3]).buffer
const define = (target: object, name: string, value: unknown) => Object.defineProperty(target, name, { configurable: true, writable: true, value })

beforeEach(() => {
  asked.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    asked.push({ method: init?.method ?? 'GET', url: String(url), headers: { ...(init?.headers as Record<string, string>) } })
    return Response.json(answer(String(url).split('?')[0].replace(/^\/api\/auth/, '')), { headers: { 'cauthy-protocol': '1' } })
  })
  define(window, 'PublicKeyCredential', Object.assign(function PublicKeyCredential() {}, { isConditionalMediationAvailable: async () => true }))
  define(navigator, 'credentials', {
    get: async () => ({ id: 'c1', rawId: buf(), type: 'public-key', response: { authenticatorData: buf(), clientDataJSON: buf(), signature: buf(), userHandle: null }, getClientExtensionResults: () => ({}) }),
    create: async () => ({ id: 'c1', rawId: buf(), type: 'public-key', response: { clientDataJSON: buf(), attestationObject: buf(), getTransports: () => ['internal'] }, getClientExtensionResults: () => ({}) }),
  })
  let callback: (r: { credential?: string }) => void = () => {}
  define(window, 'google', { accounts: { id: { initialize: (c: { callback: typeof callback }) => { callback = c.callback }, prompt: () => callback({ credential: 'google-jwt' }), cancel: () => {} } } })
  vi.stubGlobal('EventSource', class {
    static CLOSED = 2
    readyState = 1
    onerror: (() => void) | null = null
    private on: Record<string, (e: MessageEvent) => void> = {}
    constructor(url: string) {
      asked.push({ method: 'GET', url, headers: {} })
      setTimeout(() => this.on.status?.(new MessageEvent('status', { data: '{"status":"approved"}' })), 0)
    }
    addEventListener(name: string, f: (e: MessageEvent) => void) {
      this.on[name] = f
    }
    close() {}
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const name of ['PublicKeyCredential', 'google']) delete (window as unknown as Record<string, unknown>)[name]
  delete (navigator as unknown as Record<string, unknown>).credentials
})

describe('the route table, from the browser', () => {
  it('reaches every route of auth-bff version 1', async () => {
    const store = createSessionStore()
    const auth = store.auth
    const org = '3b2f6c1e-8d4a-4c7e-9f10-2a6b5c8d9e01'
    const user = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
    const password = 'a-long-enough-password'

    await store.refresh()
    await auth.methods()
    await auth.look()
    await auth.getSession()
    await auth.signIn.anonymously()
    await auth.signIn.email({ email: 'ana@acme.com', password })
    await auth.signIn.mfa({ code: '123456' })
    await auth.signIn.mfaMethods()
    await auth.signIn.mfaSendCode()
    await auth.signIn.mfaSendEmail()
    await auth.signIn.mfaPush()
    await auth.signIn.mfaPushWait()
    await auth.signIn.magicLink({ email: 'ana@acme.com' })
    await auth.signIn.magicLinkVerify({ token: 't' })
    await auth.signIn.emailCode({ code: '123456' })
    await auth.signIn.passkey()
    await auth.signIn.googleOneTap()
    await auth.signIn.ssoDiscover({ email: 'ana@acme.com' })
    await auth.signUp.email({ email: 'new@acme.com', password })
    await auth.forgotPassword({ email: 'ana@acme.com' })
    await auth.resetPassword({ token: 't', password })
    await auth.verifyEmail({ token: 't' })
    await auth.invitation('t')
    await auth.acceptInvitation('t', password)
    await auth.signOut()

    const a = auth.account
    await a.get()
    await a.update({ name: 'Ana' })
    await a.changePassword({ password: 'old', newPassword: password })
    await a.legal()
    await a.acceptLegal()
    await a.mfa.factors()
    await a.mfa.setup({ password: 'p' })
    await a.mfa.verify({ code: '123456' })
    await a.mfa.disable({ password: 'p' })
    await a.mfa.recoveryCodes({ password: 'p' })
    await a.mfa.addPhone({ phone: '+15555550100', channel: 'sms', password: 'p' })
    await a.mfa.verifyPhone({ code: '123456' })
    await a.mfa.removePhone({ password: 'p' })
    await a.changeEmail({ email: 'ana.new@acme.com', password: 'p' })
    await a.identities()
    await a.unlink('google')
    await a.upgrade({ email: 'ana@acme.com', password })
    await a.sessions()
    await a.signOutEverywhere()
    await a.agents()
    await a.disconnectAgent(user)
    await a.passkeys()
    await a.addPasskey()
    await a.removePasskey(user)

    const o = auth.organizations
    await o.list()
    await o.members(org)
    await o.roles(org)
    await o.check({ organization: org, resource: 'deals', action: 'read' })
    await o.rename(org, 'Acme Sales')
    await o.archive(org)
    await o.delete(org)
    await o.add(org, { email: 'bo@acme.com', role: 'member' })
    await o.setRole(org, user, 'member')
    await o.remove(org, user)
    await o.inviteAgain(org, user)

    const addresses = [
      auth.signIn.socialUrl('google'), auth.signIn.ssoUrl({ email: 'ana@acme.com' }), auth.signIn.passkeyUrl(),
      a.linkUrl('google'), a.upgradeUrl('google'), store.signInUrl(), store.signOutUrl(), store.accountUrl(),
    ]

    const reached = new Set<RouteId>()
    for (const r of asked) {
      const id = routeOf(r.method, r.url)
      expect(id, `${r.method} ${r.url} is not a route of the table`).toBeDefined()
      reached.add(id!)
    }
    for (const url of addresses) {
      const id = routeOf('GET', url)
      expect(id, `${url} is not a route of the table`).toBeDefined()
      reached.add(id!)
    }
    const missing = (Object.keys(ROUTES) as RouteId[]).filter((id) => !reached.has(id) && !(id in NOT_CALLED))
    expect(missing).toEqual([])
    expect([...reached].filter((id) => id in NOT_CALLED)).toEqual([])
    expect(reached.size + Object.keys(NOT_CALLED).length).toBe(75)

    // Every mutation carried the protocol's request header.
    for (const r of asked.filter((x) => x.method === 'POST')) expect(r.headers['x-cauthy-request'], r.url).toBe('1')
  })
})
