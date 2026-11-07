// Google One Tap: Google's prompt over the page offers the Google account the
// browser already has. This shows the prompt with the client id and nonce
// the server's `/sign-in/google-one-tap/begin` gave, and answers the
// credential the person picked; `signIn.googleOneTap` posts it.

interface GoogleMoment {
  isNotDisplayed?: () => boolean
  isSkippedMoment?: () => boolean
  isDismissedMoment?: () => boolean
  getDismissedReason?: () => string
}

/** Google Identity Services, as much of it as One Tap uses. */
export interface GoogleIdentity {
  initialize(config: Record<string, unknown>): void
  prompt(listener?: (moment: GoogleMoment) => void): void
  cancel(): void
}

let googleScript: Promise<GoogleIdentity> | null = null

/** Loads Google's script once per page. */
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const ready = () => (window as unknown as { google?: { accounts?: { id?: GoogleIdentity } } }).google?.accounts?.id
  if (ready()) return Promise.resolve(ready()!)
  googleScript ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => (ready() ? resolve(ready()!) : reject(new Error('google identity services did not load')))
    script.onerror = () => {
      googleScript = null
      reject(new Error('google identity services did not load'))
    }
    document.head.appendChild(script)
  })
  return googleScript
}

export interface OneTapPrompt {
  clientId: string
  nonce: string
  context?: 'signin' | 'signup' | 'use'
  signal?: AbortSignal
}

/**
 * Shows Google's One Tap prompt and answers the credential the person
 * picked, or null when it was not shown, they closed it, or `signal`
 * aborted. Throws when Google's script cannot load.
 */
export async function promptGoogleOneTap(o: OneTapPrompt): Promise<string | null> {
  if (o.signal?.aborted) return null
  const gis = await loadGoogleIdentity()
  return new Promise<string | null>((done) => {
    const stop = () => {
      gis.cancel()
      done(null)
    }
    if (o.signal?.aborted) return stop()
    o.signal?.addEventListener('abort', stop, { once: true })
    gis.initialize({
      client_id: o.clientId, nonce: o.nonce, context: o.context ?? 'signin',
      callback: (r: { credential?: string }) => done(r.credential ?? null),
      auto_select: false, cancel_on_tap_outside: true, itp_support: true, use_fedcm_for_prompt: true,
    })
    gis.prompt((moment) => {
      // The prompt was not shown, or the person closed it.
      if (moment.isNotDisplayed?.() || moment.isSkippedMoment?.()) done(null)
      else if (moment.isDismissedMoment?.() && moment.getDismissedReason?.() !== 'credential_returned') done(null)
    })
  })
}
