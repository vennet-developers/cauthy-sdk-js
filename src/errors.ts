// What went wrong, in a form a screen can show and a program can branch on.

import type { NextStep } from './protocol'
import type { AuthField } from './validate'

/** What went wrong, in a form the screen can show. */
export interface AuthError {
  /**
   * Stable, for translating. The server's are the protocol's
   * (`invalid_credentials`, `invalid_email`, `email_taken`, `unavailable`…);
   * the checks this package runs before sending add their own, such as
   * `too_short` (those come with no `status`). The set is open: handle an
   * unknown code by its `status`.
   */
  code: string
  message: string
  /** The input it is about, when it is about one. */
  field?: AuthField
  /** `weak_password`: the rules of the workspace's password policy it failed (`too_short`, `needs_digit`, …). */
  reasons?: string[]
  /** The HTTP status the server answered with; absent when nothing was sent or nothing came back. */
  status?: number
}

/** An answer: `ok` with its `status` (and `next` on a sign-in answer), or the error. */
export type AuthResult<S extends string, More = unknown> = ({ ok: true; status: S; next?: NextStep } & More) | { ok: false; error: AuthError }

export const UNAVAILABLE: AuthError = Object.freeze({ code: 'unavailable', message: 'Sign-in is unavailable right now. Try again in a moment.' })

/** The codes auth-bff version 1 names (auth-bff.md, "Errors"). */
export const PROTOCOL_ERROR_CODES = [
  'bad_request', 'required', 'invalid_email', 'too_long', 'weak_password', 'step_expired', 'step_up_required',
  'invalid_credentials', 'invalid_token', 'unauthenticated', 'cross_site', 'not_configured', 'csrf_required',
  'unavailable', 'validation_error', 'email_unchanged', 'email_taken', 'member_exists', 'invalid_organization',
  'invalid_member', 'invalid_role', 'invalid_agent', 'invalid_passkey', 'invalid_provider', 'passkey_failed',
] as const
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number]

/**
 * A refusal as the protocol sends it, or `unavailable` when the body is not
 * one. `unavailable` with a 4xx `status` (a 404 most often) means the answer
 * did not come from a Cauthy backend: the route is not mounted under
 * `basePath`, or another handler answered it.
 */
export function errorFrom(status: number, body: unknown): AuthError {
  const e = (body as { error?: { code?: unknown; message?: unknown; field?: unknown; reasons?: unknown } } | null)?.error
  if (!e || typeof e.code !== 'string') return { ...UNAVAILABLE, status }
  return {
    code: e.code,
    message: String(e.message ?? ''),
    ...(typeof e.field === 'string' && e.field !== '' ? { field: e.field as AuthField } : {}),
    ...(Array.isArray(e.reasons) ? { reasons: e.reasons.map(String) } : {}),
    status,
  }
}

export function isAuthError(v: unknown): v is AuthError {
  return typeof v === 'object' && v !== null && typeof (v as AuthError).code === 'string' && typeof (v as AuthError).message === 'string'
}

/** An AuthError as an exception, for code that prefers `try`. */
export class CauthyError extends Error {
  readonly code: string
  readonly status?: number
  readonly field?: AuthField
  readonly reasons?: string[]
  constructor(e: AuthError) {
    super(e.message || e.code)
    this.name = 'CauthyError'
    this.code = e.code
    if (e.status !== undefined) this.status = e.status
    if (e.field !== undefined) this.field = e.field
    if (e.reasons !== undefined) this.reasons = e.reasons
  }
}

/**
 * The answer when it is `ok`; otherwise throws its error as a `CauthyError`.
 *
 *   const { session } = unwrap(await auth.signIn.email({ email, password }))
 */
export function unwrap<R extends { ok: true } | { ok: false; error: AuthError }>(r: R): Extract<R, { ok: true }> {
  if (r.ok) return r as Extract<R, { ok: true }>
  throw new CauthyError((r as { ok: false; error: AuthError }).error)
}
