import { afterEach, describe, expect, it } from 'vitest'
import { resetProtocolWarnings } from './protocol'
import { createTransport } from './transport'

type Call = { url: string; init?: RequestInit }
function server(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return answer(String(url), init)
  }) as unknown as typeof globalThis.fetch
  return { calls, fetch }
}
const strict = { 'cauthy-protocol': '1' }
afterEach(() => resetProtocolWarnings())

describe('the transport', () => {
  it('posts JSON on the same origin with X-Cauthy-Request: 1, and the locale when there is one', async () => {
    const { calls, fetch } = server(() => Response.json({ status: 'sent' }, { headers: strict }))
    const t = createTransport({ fetch, locale: () => 'es-CO' })
    expect(await t.post('sign-in.forgot_password', { email: 'ana@acme.com' })).toEqual({ ok: true, status: 'sent' })
    const headers = calls[0].init!.headers as Record<string, string>
    expect(calls[0].url).toBe('/api/auth/forgot-password')
    expect(calls[0].init!.method).toBe('POST')
    expect(calls[0].init!.credentials).toBe('same-origin')
    expect(headers['x-cauthy-request']).toBe('1')
    expect(headers['content-type']).toBe('application/json')
    expect(headers['x-cauthy-locale']).toBe('es-CO')
    expect(JSON.parse(String(calls[0].init!.body))).toEqual({ email: 'ana@acme.com' })
  })

  it('adds next to a sign-in answer: the server\'s, or derived from its status', async () => {
    const said = server(() => Response.json({ status: 'mfa_required', next: 'mfa' }, { headers: strict }))
    expect(await createTransport({ fetch: said.fetch }).post('sign-in.email', { email: 'ana@acme.com', password: 'p' }))
      .toEqual({ ok: true, status: 'mfa_required', next: 'mfa' })
    const older = server(() => Response.json({ status: 'sent' }))
    expect(await createTransport({ fetch: older.fetch, onProtocolMismatch: () => {} }).post('sign-in.magic_link', { email: 'ana@acme.com' }))
      .toEqual({ ok: true, status: 'sent', next: 'code' })
    const notSignIn = server(() => Response.json({ status: 'saved', account: {} }, { headers: strict }))
    expect(await createTransport({ fetch: notSignIn.fetch }).post('me.save', { name: 'Ana' })).toEqual({ ok: true, status: 'saved', account: {} })
  })

  it('refuses before sending when the form is wrong', async () => {
    const { calls, fetch } = server(() => Response.json({ status: 'signed_in' }))
    const r = await createTransport({ fetch }).post('sign-in.email', { email: 'nope', password: 'p' }, { code: 'invalid_email', message: 'Enter a valid email.', field: 'email' })
    expect(r).toEqual({ ok: false, error: { code: 'invalid_email', message: 'Enter a valid email.', field: 'email' } })
    expect(calls).toEqual([])
  })

  it('turns a refusal into an AuthError, and a failed network into unavailable', async () => {
    const refused = server(() => Response.json({ error: { code: 'invalid_credentials', message: 'Wrong email or password.' } }, { status: 401, headers: strict }))
    expect(await createTransport({ fetch: refused.fetch }).post('sign-in.email', { email: 'ana@acme.com', password: 'p' }))
      .toEqual({ ok: false, error: { code: 'invalid_credentials', message: 'Wrong email or password.', status: 401 } })
    const down = server(() => { throw new TypeError('fetch failed') })
    expect(await createTransport({ fetch: down.fetch }).post('session.sign_out', {}))
      .toEqual({ ok: false, error: { code: 'unavailable', message: 'Sign-in is unavailable right now. Try again in a moment.' } })
  })

  it('reads a GET route with its query, and null when refused', async () => {
    const { calls, fetch } = server((url) => (url.includes('members') ? Response.json({ members: [] }, { headers: strict }) : new Response('', { status: 401, headers: strict })))
    const t = createTransport({ fetch })
    expect(await t.read('organizations.members', { id: 'o1' })).toEqual({ members: [] })
    expect(calls[0].url).toBe('/api/auth/me/organizations/members?id=o1')
    expect(calls[0].init!.method).toBeUndefined()
    expect(await t.read('me.get')).toBeNull()
    expect(await t.get('me.get')).toEqual({ ok: false, error: { code: 'unavailable', message: 'Sign-in is unavailable right now. Try again in a moment.', status: 401 } })
  })

  it('builds addresses, the provider in the path and empty values left out', () => {
    const t = createTransport({ basePath: '/auth///' })
    expect(t.base).toBe('/auth')
    expect(t.href('sign-in.social', { return_to: '/deals', remember: undefined }, 'google')).toBe('/auth/sign-in/social/google?return_to=%2Fdeals')
    expect(t.href('session.get')).toBe('/auth/session')
  })
})

describe('the mount point', () => {
  it('is a path on this origin, or the transport refuses to start, naming the value', () => {
    for (const bad of ['https://evil.example.com/api/auth', '//evil.example.com/api/auth', '/\\evil.example.com', 'api/auth', '']) {
      expect(() => createTransport({ basePath: bad }), bad).toThrow(TypeError)
      expect(() => createTransport({ basePath: bad }), bad).toThrow(JSON.stringify(bad))
    }
    expect(createTransport({ basePath: '/auth' }).href('session.get')).toBe('/auth/session')
  })
})

describe('an application handler that throws', () => {
  it('does not change the answer of the request', async () => {
    const { fetch } = server(() => Response.json({ status: 'sent' }))
    const t = createTransport({ fetch, onProtocolMismatch: () => { throw new Error('boom') } })
    expect(await t.post('sign-in.forgot_password', { email: 'ana@acme.com' })).toEqual({ ok: true, status: 'sent' })
    const r = server(() => Response.json({ members: [] }))
    expect(await createTransport({ fetch: r.fetch, onProtocolMismatch: () => { throw new Error('boom') } }).read('organizations.members', { id: 'o1' })).toEqual({ members: [] })
  })
})

describe('what the server says of ok and next', () => {
  it('cannot override ok, and only a valid next on a sign-in route survives', async () => {
    const odd = server(() => Response.json({ status: 'saved', ok: false, next: 'teleport', account: {} }, { headers: strict }))
    expect(await createTransport({ fetch: odd.fetch }).post('me.save', { name: 'Ana' })).toEqual({ ok: true, status: 'saved', account: {} })
    const notStep = server(() => Response.json({ status: 'signed_in', ok: false, next: 'teleport' }, { headers: strict }))
    expect(await createTransport({ fetch: notStep.fetch }).post('sign-in.email', { email: 'ana@acme.com', password: 'p' })).toEqual({ ok: true, status: 'signed_in', next: 'done' })
    const noStep = server(() => Response.json({ status: 'saved', next: 'teleport' }, { headers: strict }))
    expect(await createTransport({ fetch: noStep.fetch }).post('sign-in.email', { email: 'ana@acme.com', password: 'p' })).toEqual({ ok: true, status: 'saved' })
  })
})
