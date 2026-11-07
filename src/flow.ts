// The sign-in as a sequence of steps the page follows. What the person typed
// goes to the server, and the answer's `next` says which screen comes after:
// a second step, a code from the mail, a confirmed address, or done. The page
// never guesses; with a backend from before protocol 1 strict, the client
// derives `next` from the answer's status, by the same table.
//
//   const flow = createSignInFlow(store.auth)
//   flow.subscribe(({ step, busy, error }) => render(step.name))
//   await flow.password({ email, password })   // step: 'mfa' or 'done'
//   await flow.code('123456')                  // step: 'done'
//
// `passkey` and `oneTap` run their whole ceremony and land on what follows.
// A ceremony the person closed ends with the error `cancelled`: a page
// usually shows nothing for it.

import type { AuthClient } from './client'
import { UNAVAILABLE, type AuthError } from './errors'
import type { NextStep } from './protocol'
import type { PublicSession } from './types'
import { isLocalPath } from './url'

export type FlowStep =
  | { name: 'start' }
  /** Ask for the second step. `method: 'email'`: its code was just mailed. */
  | { name: 'mfa'; method?: 'email' }
  /** The account must confirm `email` before it signs in. */
  | { name: 'verify_email'; email: string }
  /** A code (and a link) went out by mail: ask for the code. */
  | { name: 'code'; sentTo?: string }
  /** Signed in. `returnTo`: where a mailed link said to go; only ever a path on this origin. */
  | { name: 'done'; session: PublicSession | null; returnTo?: string }
  /** The browser is being sent elsewhere (a passkey on Cauthy's page). `location`, when given, is only ever a path on this origin. */
  | { name: 'redirect'; location?: string }

export interface FlowState {
  step: FlowStep
  /** A request is under way: every control waits. */
  busy: boolean
  /** What went wrong last; cleared by the next action. */
  error: AuthError | null
}

export interface SignInFlow {
  get(): FlowState
  /** Calls `listener` on every change. Answers how to stop. */
  subscribe(listener: (state: FlowState) => void): () => void
  password(form: Parameters<AuthClient['signIn']['email']>[0]): Promise<FlowState>
  signUp(form: Parameters<AuthClient['signUp']['email']>[0]): Promise<FlowState>
  magicLink(form: Parameters<AuthClient['signIn']['magicLink']>[0]): Promise<FlowState>
  /** The code asked for: the second step's in `mfa`, the mail's in `code`. */
  code(code: string): Promise<FlowState>
  /** In `mfa`: mail the code again. */
  sendEmailCode(): Promise<FlowState>
  /** In `mfa`: send a code to the account's phone. */
  sendPhoneCode(): Promise<FlowState>
  passkey(options?: Parameters<AuthClient['signIn']['passkey']>[0]): Promise<FlowState>
  oneTap(options?: Parameters<AuthClient['signIn']['googleOneTap']>[0]): Promise<FlowState>
  /** Back to the start, with nothing said. */
  reset(): void
}

type Ok = { ok: true; status: string; next?: NextStep; [key: string]: unknown }
type Answer = Ok | { ok: false; error: AuthError }

const START: FlowStep = { name: 'start' }
const NO_CODE: AuthError = { code: 'step_expired', message: 'No code was asked for: start again.' }

/** The step an answer leads to from `from`. */
export function stepAfter(answer: Ok, from: FlowStep): FlowStep {
  switch (answer.next) {
    case 'done':
      return { name: 'done', session: (answer.session as PublicSession | undefined) ?? null, ...(isLocalPath(answer.returnTo) ? { returnTo: answer.returnTo } : {}) }
    case 'mfa':
      // A code sent again keeps the step as it was.
      return from.name === 'mfa' ? from : { name: 'mfa', ...(answer.method === 'email' ? { method: 'email' as const } : {}) }
    case 'verify_email':
      return { name: 'verify_email', email: String(answer.email ?? '') }
    case 'code':
      return { name: 'code', ...(typeof answer.sentTo === 'string' ? { sentTo: answer.sentTo } : {}) }
    case 'redirect':
      return { name: 'redirect', ...(isLocalPath(answer.location) ? { location: answer.location } : {}) }
    default:
      return answer.status === 'redirected' ? { name: 'redirect' } : from
  }
}

export function createSignInFlow(auth: AuthClient): SignInFlow {
  let state: FlowState = { step: START, busy: false, error: null }
  const listeners = new Set<(s: FlowState) => void>()
  const set = (next: FlowState) => {
    state = next
    for (const l of [...listeners]) l(state)
  }

  async function run(action: () => Promise<unknown>): Promise<FlowState> {
    if (state.busy) return state
    set({ ...state, busy: true, error: null })
    let answer: Answer
    try {
      answer = (await action()) as Answer
    } catch {
      answer = { ok: false, error: UNAVAILABLE }
    }
    set(answer.ok ? { step: stepAfter(answer, state.step), busy: false, error: null } : { ...state, busy: false, error: answer.error })
    return state
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    password: (f) => run(() => auth.signIn.email(f)),
    signUp: (f) => run(() => auth.signUp.email(f)),
    magicLink: (f) => run(() => auth.signIn.magicLink(f)),
    code(code) {
      if (state.step.name === 'mfa') return run(() => auth.signIn.mfa({ code }))
      if (state.step.name === 'code') return run(() => auth.signIn.emailCode({ code }))
      set({ ...state, error: NO_CODE })
      return Promise.resolve(state)
    },
    sendEmailCode: () => run(() => auth.signIn.mfaSendEmail()),
    sendPhoneCode: () => run(() => auth.signIn.mfaSendCode()),
    passkey: (o) => run(() => auth.signIn.passkey(o)),
    oneTap: (o) => run(() => auth.signIn.googleOneTap(o)),
    reset() {
      set({ step: START, busy: false, error: null })
    },
  }
}
