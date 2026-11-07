import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROUTES } from './generated/routes'
import { nextFrom, nextOf, PROTOCOL_VERSION, resetProtocolWarnings, SIGN_IN_PATHS, watchProtocol } from './protocol'

describe('next', () => {
  it('maps every sign-in status as the protocol table does', () => {
    expect(nextOf('/sign-in/email', 'signed_in')).toBe('done')
    expect(nextOf('/sign-in/email', 'mfa_required')).toBe('mfa')
    expect(nextOf('/sign-up/email', 'verification_required')).toBe('verify_email')
    expect(nextOf('/sign-in/mfa/send', 'sent')).toBe('mfa')
    expect(nextOf('/sign-in/magic-link', 'sent')).toBe('code')
    expect(nextOf('/sign-in/google-one-tap/begin', 'started')).toBe('one_tap')
    expect(nextOf('/sign-in/passkey/begin', 'started')).toBe('passkey')
    expect(nextOf('/sign-in/email', 'saved')).toBeUndefined()
  })

  it("takes the server's next over its own reading, and adds none outside the sign-in routes", () => {
    expect(nextFrom('/sign-in/email', { status: 'signed_in', next: 'mfa' })).toBe('mfa')
    expect(nextFrom('/sign-in/email', { status: 'signed_in', next: 'teleport' })).toBe('done')
    expect(nextFrom('/me', { status: 'saved', next: 'done' })).toBeUndefined()
  })

  it('names only POST routes of the table as sign-in routes', () => {
    const posts = new Set(Object.values(ROUTES).filter((r) => r.method === 'POST').map((r) => r.path as string))
    for (const p of SIGN_IN_PATHS) expect(posts.has(p), p).toBe(true)
    expect(SIGN_IN_PATHS.size).toBe(17)
  })
})

describe('the protocol header', () => {
  afterEach(() => {
    resetProtocolWarnings()
    vi.restoreAllMocks()
  })
  const answer = (header?: string) => new Response('{}', { headers: header ? { 'cauthy-protocol': header } : {} })

  it('says nothing when the server speaks protocol 1', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    watchProtocol('/api/auth')(answer(PROTOCOL_VERSION))
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns once per mount point when the header is missing, naming both causes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    watchProtocol('/api/auth')(answer())
    watchProtocol('/api/auth')(answer())
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/Cauthy-Protocol/)
    expect(String(warn.mock.calls[0][0])).toMatch(/another handler/)
    watchProtocol('/auth')(answer())
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('warns of a version it does not speak', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    watchProtocol('/api/auth')(answer('2'))
    expect(String(warn.mock.calls[0][0])).toMatch(/protocol 2/)
  })

  it('hands the mismatch to the application instead, once per client', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const told: (string | null)[] = []
    const watch = watchProtocol('/api/auth', (seen) => told.push(seen))
    watch(answer())
    watch(answer('2'))
    expect(told).toEqual([null])
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('a mismatch handler that throws', () => {
  it('never escapes the check', () => {
    const watch = watchProtocol('/api/auth', () => {
      throw new Error('boom')
    })
    expect(() => watch(new Response('{}'))).not.toThrow()
  })
})
