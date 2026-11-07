// How this package speaks to the application's server. Every call goes to
// `basePath` on the page's own origin, with the page's cookies, never to
// Cauthy. A POST carries `X-Cauthy-Request: 1`, the protocol's defence
// against cross-site requests; every answer is checked for
// `Cauthy-Protocol: 1`; a sign-in answer gets its `next`.

import { errorFrom, UNAVAILABLE, type AuthError } from './errors'
import { ROUTES, type GetRouteId, type PostRouteId, type RouteBodies, type RouteId } from './generated/routes'
import { nextFrom, REQUEST_HEADER, watchProtocol, type ProtocolMismatch } from './protocol'
import { withoutTrailingSlashes } from './url'
import type { FieldProblem } from './validate'

export interface TransportOptions {
  /** Where the server mounted the routes. Default: `/api/auth`. */
  basePath?: string
  fetch?: typeof fetch
  /** The language the person reads, sent as `X-Cauthy-Locale`. Default: `<html lang>`. */
  locale?: string | (() => string | undefined)
  /** Told once when an answer does not say `Cauthy-Protocol: 1`. Default: one console warning. */
  onProtocolMismatch?: ProtocolMismatch
}

export type Query = Record<string, string | undefined>

export interface Transport {
  /** `basePath`, without trailing slashes. */
  readonly base: string
  /** The address of a route, with its query; `provider` fills `{provider}`. Undefined query values are left out. */
  href(id: RouteId, query?: Query, provider?: string): string
  /** Sends a POST route's body. `bad`: what the form found wrong, answered without sending. */
  post<I extends PostRouteId>(id: I, body: RouteBodies[I], bad?: FieldProblem | null, captchaToken?: string): Promise<any>
  /** Reads a GET route: its JSON, or null when refused or unreachable. */
  read(id: GetRouteId, query?: Query): Promise<any | null>
  /** Reads a GET route, saying why when it was refused. */
  get(id: GetRouteId, query?: Query): Promise<{ ok: true; body: any } | { ok: false; error: AuthError }>
}

/**
 * `basePath` without trailing slashes. It must be a path on the page's own
 * origin: an absolute URL, a protocol-relative one (`//host`, `/\host`) or a
 * relative path would send the session's requests elsewhere, so it throws.
 */
export function mountPoint(basePath: string = '/api/auth'): string {
  if (typeof basePath !== 'string' || !basePath.startsWith('/') || basePath.startsWith('//') || basePath.startsWith('/\\')) {
    throw new TypeError(`@cauthyhq/js: basePath must be a path on this origin, starting with "/" (not "//" or "/\\"); got ${JSON.stringify(basePath)}`)
  }
  return withoutTrailingSlashes(basePath)
}

export function createTransport(options: TransportOptions = {}): Transport {
  const base = mountPoint(options.basePath)
  const doFetch: typeof fetch = (...args) => (options.fetch ?? fetch)(...args)
  const watch = watchProtocol(base, options.onProtocolMismatch)
  const lang = (): Record<string, string> => {
    const said = typeof options.locale === 'function' ? options.locale() : options.locale
    const l = (said ?? (typeof document === 'undefined' ? '' : document.documentElement?.lang) ?? '').trim()
    return l ? { 'x-cauthy-locale': l } : {}
  }

  function href(id: RouteId, query: Query = {}, provider?: string): string {
    let path: string = ROUTES[id].path
    if (path.includes('{provider}')) path = path.replace('{provider}', encodeURIComponent(provider ?? ''))
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, v)
    const s = q.toString()
    return `${base}${path}${s === '' ? '' : `?${s}`}`
  }

  async function post<I extends PostRouteId>(id: I, body: RouteBodies[I], bad: FieldProblem | null = null, captchaToken?: string): Promise<any> {
    if (bad) return { ok: false, error: { code: bad.code, message: bad.message, field: bad.field } }
    const path: string = ROUTES[id].path
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          [REQUEST_HEADER]: '1',
          ...lang(),
          ...(captchaToken ? { 'x-cauthy-captcha': captchaToken } : {}),
        },
        body: JSON.stringify(body),
      })
      watch(res)
      const answer = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (res.ok && answer && typeof answer.status === 'string') {
        const next = nextFrom(path, answer)
        return { ok: true, ...answer, ...(next ? { next } : {}) }
      }
      return { ok: false, error: errorFrom(res.status, answer) }
    } catch {
      return { ok: false, error: UNAVAILABLE }
    }
  }

  async function get(id: GetRouteId, query?: Query): Promise<{ ok: true; body: any } | { ok: false; error: AuthError }> {
    try {
      const res = await doFetch(href(id, query), { credentials: 'same-origin', headers: { accept: 'application/json', ...lang() } })
      watch(res)
      const body = await res.json().catch(() => null)
      return res.ok ? { ok: true, body } : { ok: false, error: errorFrom(res.status, body) }
    } catch {
      return { ok: false, error: UNAVAILABLE }
    }
  }

  async function read(id: GetRouteId, query?: Query): Promise<any | null> {
    const r = await get(id, query)
    return r.ok ? r.body : null
  }

  return { base, href, post, read, get }
}
