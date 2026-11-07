import { describe, expect, it } from 'vitest'
import { createAuthClient } from './client'
import { createSignInFlow, stepAfter, type FlowState } from './flow'

const session = { user: { id: 'u1', email: 'ana@acme.com', name: 'Ana', emailVerified: true, restricted: false }, tenantId: 't1', roles: [], organizations: [], expiresAt: '2026-11-07T20:00:00Z' }

/** The application's server: `answers` by path; `strict: false` is a backend that sends no `next`. */
function backend(answers: Record<string, { status?: number; body: Record<string, unknown> }>, strict = true) {
  const asked: string[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^\/api\/auth/, '').split('?')[0]
    asked.push(`${init?.method ?? 'GET'} ${path}`)
    const a = answers[path] ?? { status: 404, body: { error: { code: 'not_found', message: 'No such route.' } } }
    const body = strict ? a.body : Object.fromEntries(Object.entries(a.body).filter(([k]) => k !== 'next'))
    return Response.json(body, { status: a.status ?? 200, headers: strict ? { 'cauthy-protocol': '1' } : {} })
  }) as unknown as typeof globalThis.fetch
  return { asked, auth: createAuthClient({ fetch, onProtocolMismatch: () => {} }) }
}

describe('the sign-in flow', () => {
  it('goes from the password to done when nothing more is asked', async () => {
    const { auth } = backend({ '/sign-in/email': { body: { status: 'signed_in', session, next: 'done' } } })
    const flow = createSignInFlow(auth)
    expect(flow.get()).toEqual({ step: { name: 'start' }, busy: false, error: null })
    const s = await flow.password({ email: 'ana@acme.com', password: 'right-password' })
    expect(s).toEqual({ step: { name: 'done', session }, busy: false, error: null })
  })

  it('asks for the second step, then is done', async () => {
    const { auth, asked } = backend({
      '/sign-in/email': { body: { status: 'mfa_required', method: 'email', next: 'mfa' } },
      '/sign-in/mfa': { body: { status: 'signed_in', session, next: 'done' } },
    })
    const flow = createSignInFlow(auth)
    expect((await flow.password({ email: 'ana@acme.com', password: 'right-password' })).step).toEqual({ name: 'mfa', method: 'email' })
    expect((await flow.code('123456')).step).toEqual({ name: 'done', session })
    expect(asked).toEqual(['POST /sign-in/email', 'POST /sign-in/mfa'])
  })

  it("follows the server's next over its own reading of the status", async () => {
    const { auth } = backend({ '/sign-up/email': { body: { status: 'signed_in', email: 'ana@acme.com', next: 'verify_email' } } })
    const s = await createSignInFlow(auth).signUp({ email: 'ana@acme.com', password: 'a-long-enough-password' })
    expect(s.step).toEqual({ name: 'verify_email', email: 'ana@acme.com' })
  })

  it('derives next from the status when the backend does not send it', async () => {
    const { auth, asked } = backend({
      '/sign-in/magic-link': { body: { status: 'sent' } },
      '/sign-in/email-code': { body: { status: 'signed_in', session, returnTo: '/deals' } },
    }, false)
    const flow = createSignInFlow(auth)
    expect((await flow.magicLink({ email: 'ana@acme.com' })).step).toEqual({ name: 'code' })
    expect((await flow.code('123456')).step).toEqual({ name: 'done', session, returnTo: '/deals' })
    expect(asked).toEqual(['POST /sign-in/magic-link', 'POST /sign-in/email-code'])
  })

  it('keeps the step and says what went wrong, from the server or from the form', async () => {
    const { auth, asked } = backend({ '/sign-in/email': { status: 401, body: { error: { code: 'invalid_credentials', message: 'Wrong email or password.' } } } })
    const flow = createSignInFlow(auth)
    const refused = await flow.password({ email: 'ana@acme.com', password: 'wrong' })
    expect(refused).toEqual({ step: { name: 'start' }, busy: false, error: { code: 'invalid_credentials', message: 'Wrong email or password.', status: 401 } })
    const wrong = await flow.password({ email: 'nope', password: 'x' })
    expect(wrong.error).toMatchObject({ code: 'invalid_email', field: 'email' })
    expect(asked).toEqual(['POST /sign-in/email'])
  })

  it('ignores a second submit while one runs, and tells listeners each change', async () => {
    const { auth, asked } = backend({ '/sign-in/email': { body: { status: 'signed_in', session, next: 'done' } } })
    const flow = createSignInFlow(auth)
    const heard: string[] = []
    const stop = flow.subscribe((s: FlowState) => heard.push(`${s.step.name}:${s.busy}`))
    await Promise.all([flow.password({ email: 'ana@acme.com', password: 'p' }), flow.password({ email: 'ana@acme.com', password: 'p' })])
    stop()
    expect(asked).toEqual(['POST /sign-in/email'])
    expect(heard).toEqual(['start:true', 'done:false'])
  })

  it('refuses a code when none was asked for, and starts again on reset', async () => {
    const { auth, asked } = backend({ '/sign-in/email': { body: { status: 'mfa_required', next: 'mfa' } } })
    const flow = createSignInFlow(auth)
    expect((await flow.code('123456')).error?.code).toBe('step_expired')
    expect(asked).toEqual([])
    await flow.password({ email: 'ana@acme.com', password: 'p' })
    flow.reset()
    expect(flow.get()).toEqual({ step: { name: 'start' }, busy: false, error: null })
  })
})

describe('where a step may send the page', () => {
  it('keeps returnTo and location only when they are paths on this origin', () => {
    const start = { name: 'start' } as const
    expect(stepAfter({ ok: true, status: 'signed_in', next: 'done', returnTo: '/deals' }, start)).toEqual({ name: 'done', session: null, returnTo: '/deals' })
    expect(stepAfter({ ok: true, status: 'redirected', next: 'redirect', location: '/hosted' }, start)).toEqual({ name: 'redirect', location: '/hosted' })
    for (const bad of ['https://evil.example.com', '//evil.example.com', '/\\evil.example.com', '/\t/evil.example.com', 'javascript:alert(1)']) {
      expect(stepAfter({ ok: true, status: 'signed_in', next: 'done', returnTo: bad }, start), bad).toEqual({ name: 'done', session: null })
      expect(stepAfter({ ok: true, status: 'redirected', next: 'redirect', location: bad }, start), bad).toEqual({ name: 'redirect' })
    }
  })
})

describe('starting again while a request runs', () => {
  it('wins: the late answer does not move the flow', async () => {
    let release: () => void = () => {}
    const fetch = (async () => {
      await new Promise<void>((r) => (release = r))
      return Response.json({ status: 'signed_in', session, next: 'done' }, { headers: { 'cauthy-protocol': '1' } })
    }) as unknown as typeof globalThis.fetch
    const flow = createSignInFlow(createAuthClient({ fetch }))
    const running = flow.password({ email: 'ana@acme.com', password: 'right-password' })
    await new Promise((r) => setTimeout(r, 0))
    expect(flow.get().busy).toBe(true)
    flow.reset()
    release()
    expect(await running).toEqual({ step: { name: 'start' }, busy: false, error: null })
    expect(flow.get()).toEqual({ step: { name: 'start' }, busy: false, error: null })
    // And it can be used again at once.
    expect(flow.get().busy).toBe(false)
  })
})
