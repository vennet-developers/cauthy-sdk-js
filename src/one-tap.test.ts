// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadGoogleIdentity, promptGoogleOneTap } from './one-tap'

type Callback = (r: { credential?: string }) => void
type Listener = (moment: Record<string, () => unknown>) => void

/** Google's script, as far as One Tap uses it: `onPrompt` plays what Google does once the prompt is asked for. */
function google(onPrompt: (callback: Callback, listener: Listener) => void) {
  let callback: Callback = () => {}
  const id = {
    config: null as Record<string, unknown> | null,
    cancelled: false,
    initialize(c: Record<string, unknown>) {
      id.config = c
      callback = c.callback as Callback
    },
    prompt(listener: Listener) {
      onPrompt(callback, listener)
    },
    cancel() {
      id.cancelled = true
    },
  }
  ;(window as unknown as { google: unknown }).google = { accounts: { id } }
  return id
}
afterEach(() => {
  delete (window as unknown as { google?: unknown }).google
})

describe('Google One Tap', () => {
  it('answers the credential the person picked, with the nonce Cauthy gave', async () => {
    const id = google((callback) => callback({ credential: 'google-jwt' }))
    expect(await promptGoogleOneTap({ clientId: 'acme.apps.example.com', nonce: 'n1' })).toBe('google-jwt')
    expect(id.config).toMatchObject({ client_id: 'acme.apps.example.com', nonce: 'n1', context: 'signin', auto_select: false, use_fedcm_for_prompt: true })
  })

  it('answers null when the prompt was not shown, or the person closed it', async () => {
    google((_callback, listener) => listener({ isNotDisplayed: () => true }))
    expect(await promptGoogleOneTap({ clientId: 'c', nonce: 'n' })).toBeNull()
    google((_callback, listener) => listener({ isDismissedMoment: () => true, getDismissedReason: () => 'cancel_called' }))
    expect(await promptGoogleOneTap({ clientId: 'c', nonce: 'n', context: 'signup' })).toBeNull()
  })

  it("cancels Google's prompt when the page aborts", async () => {
    const id = google(() => {})
    const ctl = new AbortController()
    const waiting = promptGoogleOneTap({ clientId: 'c', nonce: 'n', signal: ctl.signal })
    ctl.abort()
    expect(await waiting).toBeNull()
    expect(id.cancelled).toBe(true)
  })
})

describe("Google's script", () => {
  const added: HTMLScriptElement[] = []
  const realAppend = document.head.appendChild.bind(document.head)
  afterEach(() => {
    added.length = 0
    document.head.appendChild = realAppend
  })
  const watchScripts = () => {
    document.head.appendChild = (<T extends Node>(node: T): T => {
      added.push(node as unknown as HTMLScriptElement)
      return node
    }) as typeof document.head.appendChild
  }

  it('carries the page CSP nonce when given one', async () => {
    watchScripts()
    const loading = loadGoogleIdentity({ nonce: 'csp-n1' })
    expect(added[0].getAttribute('nonce')).toBe('csp-n1')
    google(() => {})
    added[0].onload!(new Event('load'))
    await loading
  })

  it('is fetched again after a load that left no google behind', async () => {
    watchScripts()
    const first = loadGoogleIdentity()
    added[0].onload!(new Event('load'))
    await expect(first).rejects.toThrow(/did not load/)
    const second = loadGoogleIdentity()
    expect(added).toHaveLength(2)
    google(() => {})
    added[1].onload!(new Event('load'))
    await expect(second).resolves.toBeDefined()
  })

  it('stops listening to the page signal once the prompt settled', async () => {
    const id = google((callback) => callback({ credential: 'google-jwt' }))
    const ctl = new AbortController()
    const remove = vi.spyOn(ctl.signal, 'removeEventListener')
    expect(await promptGoogleOneTap({ clientId: 'c', nonce: 'n', signal: ctl.signal })).toBe('google-jwt')
    ctl.abort()
    expect(id.cancelled).toBe(false)
    expect(remove).toHaveBeenCalled()
  })
})
