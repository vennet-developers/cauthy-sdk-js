// The auth-bff protocol, version 1, as the browser speaks it: the version
// every answer must say, the header every POST carries, and the step a
// sign-in answer says comes next.

/** The protocol version this client speaks. */
export const PROTOCOL_VERSION = '1'
/** The header on every answer of a protocol-1 backend. */
export const PROTOCOL_HEADER = 'cauthy-protocol'
/** The header on every POST: the protocol's defence against cross-site requests. */
export const REQUEST_HEADER = 'x-cauthy-request'

/**
 * What the page does after a sign-in answer:
 *
 * - `done`: signed in; go on.
 * - `mfa`: ask for the second step.
 * - `verify_email`: the address must be confirmed first.
 * - `code`: a code (or link) was mailed; ask for the code.
 * - `passkey`, `one_tap`: a ceremony began. The client's own `signIn.passkey`
 *   and `signIn.googleOneTap` run it and answer what follows.
 * - `redirect`: go to the answer's `location`. No route of version 1 answers it yet.
 */
export type NextStep = 'done' | 'mfa' | 'verify_email' | 'code' | 'passkey' | 'one_tap' | 'redirect'

const STEPS: ReadonlySet<string> = new Set(['done', 'mfa', 'verify_email', 'code', 'passkey', 'one_tap', 'redirect'])

/** The routes whose answers are sign-in answers (auth-bff.md, "Sign-in answers"). */
export const SIGN_IN_PATHS: ReadonlySet<string> = new Set([
  '/sign-in/email', '/sign-in/mfa', '/sign-in/mfa/send', '/sign-in/mfa/email', '/sign-in/mfa/push', '/sign-in/mfa/push/finish',
  '/sign-up/email', '/invitation/accept', '/sign-in/magic-link', '/sign-in/email-code', '/sign-in/magic-link/verify',
  '/sign-in/passkey/begin', '/sign-in/passkey/finish', '/sign-in/google-one-tap/begin', '/sign-in/google-one-tap',
  '/sign-in/anonymous', '/me/upgrade',
])

/** The step after a sign-in answer of `path` with `status`, as a strict backend would say it. */
export function nextOf(path: string, status: unknown): NextStep | undefined {
  switch (status) {
    case 'signed_in': return 'done'
    case 'mfa_required': return 'mfa'
    case 'verification_required': return 'verify_email'
    case 'sent': return path.startsWith('/sign-in/mfa') ? 'mfa' : 'code'
    case 'started': return path === '/sign-in/google-one-tap/begin' ? 'one_tap' : 'passkey'
    default: return undefined
  }
}

/** The `next` of an answer: the server's when it sent a valid one, else derived from `status`. Undefined outside the sign-in routes. */
export function nextFrom(path: string, body: { status?: unknown; next?: unknown } | null | undefined): NextStep | undefined {
  if (!SIGN_IN_PATHS.has(path)) return undefined
  const said = body?.next
  if (typeof said === 'string' && STEPS.has(said)) return said as NextStep
  return nextOf(path, body?.status)
}

/** Told once when an answer does not say `Cauthy-Protocol: 1`, with what it said instead (null: nothing). */
export type ProtocolMismatch = (seen: string | null) => void

const warned = new Set<string>()

/** For tests: forget which mount points were warned about. */
export function resetProtocolWarnings(): void {
  warned.clear()
}

/**
 * A check for every answer from `base`. A missing or different
 * `Cauthy-Protocol` header is told to `onMismatch` once, or warned about
 * once per page and mount point.
 */
export function watchProtocol(base: string, onMismatch?: ProtocolMismatch): (res: Response) => void {
  let told = false
  return (res) => {
    const seen = res.headers.get(PROTOCOL_HEADER)
    if (seen === PROTOCOL_VERSION) return
    if (onMismatch) {
      if (!told) {
        told = true
        onMismatch(seen)
      }
      return
    }
    if (warned.has(base)) return
    warned.add(base)
    console.warn(
      seen === null
        ? `@cauthyhq/js: ${base} answered without the Cauthy-Protocol header. Either the backend SDK predates auth-bff protocol ${PROTOCOL_VERSION} at level strict (update it), or another handler answers under ${base} (move it, or mount Cauthy elsewhere with basePath).`
        : `@cauthyhq/js: ${base} speaks auth-bff protocol ${seen}; this client speaks ${PROTOCOL_VERSION}. Update whichever is behind.`,
    )
  }
}
