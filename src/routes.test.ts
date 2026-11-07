import { describe, expect, it } from 'vitest'
import { PREFIX, PROTOCOL, ROUTES, type PostRouteId, type RouteBodies, type RouteId } from './generated/routes'

describe('the route table', () => {
  it('is auth-bff version 1, with its 75 routes under /api/auth', () => {
    expect(PROTOCOL).toBe(1)
    expect(PREFIX).toBe('/api/auth')
    expect(Object.keys(ROUTES)).toHaveLength(75)
  })

  it('names every route group.name, with one method and a path', () => {
    for (const [id, r] of Object.entries(ROUTES)) {
      expect(id).toMatch(/^[a-z-]+\.[a-z_]+$/)
      expect(['GET', 'POST']).toContain(r.method)
      expect(r.path.startsWith('/')).toBe(true)
    }
  })

  it('types the body of a POST route', () => {
    const id: PostRouteId = 'sign-in.email'
    const body: RouteBodies[typeof id] = { email: 'ana@acme.com', password: 'right-password', remember: true }
    expect(ROUTES[id].method).toBe('POST')
    expect(body.email).toBe('ana@acme.com')
  })

  it('marks the three routes version 2 removes', () => {
    const deprecated = (Object.keys(ROUTES) as RouteId[]).filter((id) => ROUTES[id].deprecated).sort()
    expect(deprecated).toEqual(['me.upgrade', 'me.upgrade_social', 'sign-in.anonymous'])
  })

  it('says which answers are redirects and which stream', () => {
    expect(ROUTES['hosted.login'].redirect).toBe(true)
    expect(ROUTES['sign-in.mfa_push_events'].stream).toBe(true)
    expect(ROUTES['session.get'].fields).toEqual({ session: 'object?', status: 'string' })
  })
})
