// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { canUsePasskeys, ceremonyError, getPasskey, makePasskey } from './passkey'

const define = (target: object, name: string, value: unknown) => Object.defineProperty(target, name, { configurable: true, writable: true, value })
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).PublicKeyCredential
  delete (navigator as unknown as Record<string, unknown>).credentials
})
const buf = (...b: number[]) => new Uint8Array(b).buffer

describe('passkeys in the browser', () => {
  it('cannot be used where the browser has no WebAuthn', () => {
    expect(canUsePasskeys()).toBe(false)
  })

  it('asks the browser with bytes, and answers Cauthy in base64url', async () => {
    let asked: any
    define(window, 'PublicKeyCredential', function PublicKeyCredential() {})
    define(navigator, 'credentials', {
      get: async (o: unknown) => {
        asked = o
        return { id: 'c1', rawId: buf(251, 255), type: 'public-key', response: { authenticatorData: buf(1), clientDataJSON: buf(2), signature: buf(3), userHandle: null }, getClientExtensionResults: () => ({}) }
      },
    })
    expect(canUsePasskeys()).toBe(true)
    const r = await getPasskey({ challenge: '-_8', allowCredentials: [{ id: 'AQ', type: 'public-key' }] })
    expect([...new Uint8Array(asked.publicKey.challenge)]).toEqual([251, 255])
    expect([...new Uint8Array(asked.publicKey.allowCredentials[0].id)]).toEqual([1])
    expect(r).toEqual({ id: 'c1', rawId: '-_8', type: 'public-key', response: { authenticatorData: 'AQ', clientDataJSON: 'Ag', signature: 'Aw', userHandle: null }, clientExtensionResults: {} })
  })

  it('makes a passkey with the user id in bytes, and says its transports', async () => {
    let asked: any
    define(window, 'PublicKeyCredential', function PublicKeyCredential() {})
    define(navigator, 'credentials', {
      create: async (o: unknown) => {
        asked = o
        return { id: 'c2', rawId: buf(2), type: 'public-key', response: { clientDataJSON: buf(2), attestationObject: buf(3), getTransports: () => ['internal'] }, getClientExtensionResults: () => ({}) }
      },
    })
    const r = await makePasskey({ challenge: 'AQ', user: { id: 'Ag', name: 'ana@acme.com', displayName: 'Ana' }, excludeCredentials: [] })
    expect([...new Uint8Array(asked.publicKey.user.id)]).toEqual([2])
    expect(r).toMatchObject({ id: 'c2', response: { attestationObject: 'Aw', transports: ['internal'] } })
  })

  it('says what a refusal means', () => {
    expect(ceremonyError(new DOMException('x', 'NotAllowedError')).code).toBe('cancelled')
    expect(ceremonyError(new DOMException('x', 'AbortError')).code).toBe('cancelled')
    expect(ceremonyError(new DOMException('x', 'InvalidStateError')).code).toBe('passkey_exists')
    expect(ceremonyError(new DOMException('x', 'SecurityError')).code).toBe('passkey_unavailable')
    expect(ceremonyError(new Error('boom')).code).toBe('passkey_failed')
  })
})
