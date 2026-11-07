import * as oldClient from 'cauthy-auth/client'
import * as oldTheme from 'cauthy-auth/theme'
import { describe, expect, it } from 'vitest'
import * as ours from '../src/index'
import * as ourTheme from '../src/theme'

describe('compatibility with cauthy-auth 0.42', () => {
  it('exports every runtime name of cauthy-auth/client, of the same kind', () => {
    for (const [name, value] of Object.entries(oldClient)) {
      expect(ours, name).toHaveProperty(name)
      expect(typeof (ours as Record<string, unknown>)[name], name).toBe(typeof value)
    }
  })

  it('exports every name of cauthy-auth/theme a browser needs; pushTheme stays on the server', () => {
    for (const name of Object.keys(oldTheme)) {
      if (name === 'pushTheme') expect(ourTheme).not.toHaveProperty(name)
      else expect(ourTheme, name).toHaveProperty(name)
    }
  })

  it('builds the same addresses as 0.42', () => {
    const a = oldClient.createAuthClient()
    const b = ours.createAuthClient()
    expect(b.signIn.socialUrl('google', { returnTo: '/deals', remember: true })).toBe(a.signIn.socialUrl('google', { returnTo: '/deals', remember: true }))
    expect(b.signIn.ssoUrl({ email: 'ana@acme.com' }, { returnTo: '/deals' })).toBe(a.signIn.ssoUrl({ email: 'ana@acme.com' }, { returnTo: '/deals' }))
    expect(b.signIn.ssoUrl({ connection: 'c1' })).toBe(a.signIn.ssoUrl({ connection: 'c1' }))
    expect(b.signIn.passkeyUrl({ returnTo: '/deals', locale: 'es' })).toBe(a.signIn.passkeyUrl({ returnTo: '/deals', locale: 'es' }))
    expect(b.account.linkUrl('google', { returnTo: '/deals' })).toBe(a.account.linkUrl('google', { returnTo: '/deals' }))
  })

  it('exports what is new in 1.0', () => {
    for (const name of ['createSignInFlow', 'promptGoogleOneTap', 'getPasskey', 'makePasskey', 'CauthyError', 'unwrap', 'errorFrom', 'ROUTES', 'PROTOCOL_VERSION', 'nextOf', 'can', 'definePolicy', 'checkOrganization']) {
      expect(ours, name).toHaveProperty(name)
    }
  })
})
