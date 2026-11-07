import { describe, expect, it } from 'vitest'
import { CauthyError, errorFrom, isAuthError, PROTOCOL_ERROR_CODES, UNAVAILABLE, unwrap } from './errors'

describe('errors', () => {
  it('reads the protocol error shape, with its field, reasons and status', () => {
    expect(errorFrom(400, { error: { code: 'weak_password', message: 'Too weak.', field: 'password', reasons: ['too_short'] } }))
      .toEqual({ code: 'weak_password', message: 'Too weak.', field: 'password', reasons: ['too_short'], status: 400 })
    expect(errorFrom(403, { error: { code: 'csrf_required', message: 'Send X-Cauthy-Request.' } }))
      .toEqual({ code: 'csrf_required', message: 'Send X-Cauthy-Request.', status: 403 })
  })

  it('is unavailable, with the status, for any other body', () => {
    expect(errorFrom(404, null)).toEqual({ ...UNAVAILABLE, status: 404 })
    expect(errorFrom(502, { code: 'flat' })).toEqual({ ...UNAVAILABLE, status: 502 })
  })

  it('knows the codes of protocol 1, each once', () => {
    expect(PROTOCOL_ERROR_CODES).toContain('csrf_required')
    expect(PROTOCOL_ERROR_CODES).toContain('step_expired')
    expect(new Set(PROTOCOL_ERROR_CODES).size).toBe(PROTOCOL_ERROR_CODES.length)
  })

  it('unwraps a result, or throws a CauthyError with its code', () => {
    expect(unwrap({ ok: true as const, status: 'sent' as const })).toEqual({ ok: true, status: 'sent' })
    let thrown: unknown
    try {
      unwrap({ ok: false as const, error: { code: 'invalid_credentials', message: 'Wrong email or password.', status: 401 } })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(CauthyError)
    expect((thrown as CauthyError).code).toBe('invalid_credentials')
    expect((thrown as CauthyError).status).toBe(401)
    expect((thrown as CauthyError).message).toBe('Wrong email or password.')
  })

  it('tells an AuthError apart', () => {
    expect(isAuthError({ code: 'x', message: 'y' })).toBe(true)
    expect(isAuthError({ code: 1 })).toBe(false)
    expect(isAuthError(null)).toBe(false)
  })
})
