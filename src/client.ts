// The application's own sign-in screens, in the browser.
//
//   const auth = createAuthClient()
//   const r = await auth.signIn.email({ email, password })
//   if (!r.ok) show(r.error.message)            // r.error.field says which input
//   else if (r.next === 'mfa') askForTheCode()
//
// Every call goes to the application's own server (`/api/auth/*`), never to
// Cauthy: the browser holds no token, before or after. A form is checked here
// before it is sent, with the rules the server checks again.

import { UNAVAILABLE, type AuthError, type AuthResult } from './errors'
import type { PostRouteId, RouteBodies } from './generated/routes'
import { promptGoogleOneTap } from './one-tap'
import { canAutofillPasskeys, canUsePasskeys, ceremonyError, getPasskey, makePasskey } from './passkey'
import { fromWire, type CauthyTheme } from './theme'
import { createTransport, type TransportOptions } from './transport'
import type { CheckQuestion, CheckResult, OrganizationRef, PublicSession } from './types'
import { checkCode, checkEmail, checkName, checkNewPassword, checkOrganization, checkOrganizationName, checkPassword, firstProblem, passwordPolicyOf, type PasswordPolicy } from './validate'

export type { AuthError, AuthResult } from './errors'
export type { CheckQuestion, CheckResult, CheckRule, OrganizationRef } from './types'
export { checkCode, checkEmail, checkName, checkNewPassword, checkPassword, describePasswordPolicy, explainPasswordProblems, passwordPolicyOf, passwordProblems, DEFAULT_PASSWORD_POLICY, MIN_PASSWORD, type AuthField, type FieldProblem, type PasswordClass, type PasswordLocale, type PasswordPolicy, type PasswordReason } from './validate'
export { canAutofillPasskeys, canUsePasskeys } from './passkey'

/** What the screen may offer. */
export interface AuthMethods {
  /**
   * The providers the workspace signs people in with and has turned on:
   * `{ id: 'google', name: 'Google', iconUrl: 'https://…/v1/social/icons/google.svg' }`.
   * `iconUrl` is the provider's logo, served by Cauthy; absent from a Cauthy
   * that does not serve logos.
   */
  providers: { id: string; name: string; iconUrl?: string }[]
  /**
   * Whether the workspace signs people in with a password. False: the
   * password field, "forgot your password" and a sign-up with a password are
   * not offered, and Cauthy refuses them (`password_disabled`). True from a
   * server that does not say. (`password` is something else: the policy a new
   * password must meet.)
   */
  passwordSignIn: boolean
  /**
   * Whether the application's client may keep people signed in when they ask
   * (an administrator turns it on in Cauthy). The ready-made sign-in shows
   * "Keep me signed in" by itself; absent from a Cauthy that does not say.
   */
  persistentSessions?: boolean
  /** Whether people may create an account themselves. */
  signUp: boolean
  /** Set when the application's system makes an organization per sign-up: the form asks the company's name. */
  organization?: { ask: boolean; required: boolean }
  magicLink: boolean
  /** Whether to offer a passkey. False when the workspace turned passkeys off. */
  passkey: boolean
  /**
   * Whether the passkey is used on this page itself. False: `signIn.passkey`
   * sends the person to Cauthy's page for that step alone, and they come back
   * signed in. That happens only when this page is outside the domain the
   * workspace's passkeys belong to.
   */
  passkeyHere: boolean
  /**
   * Whether Cauthy's page can use the passkey, for that step alone: where a
   * page that cannot, or a browser that refuses to here, sends the person.
   */
  passkeyOnCauthy: boolean
  /**
   * The workspace's Cloudflare Turnstile site key, when it asks for the
   * challenge: signing in, creating an account, and asking for a sign-in link
   * or a new password then take its answer (`captchaToken`). The ready-made
   * forms show it themselves.
   */
  captchaSiteKey?: string
  /**
   * Whether the workspace signs some people in through their company's SSO,
   * found by their work address (`signIn.ssoDiscover`, `signIn.sso`).
   */
  sso: boolean
  /**
   * Set when the workspace asks something of a sign-up: the legal documents
   * to accept (the terms, the privacy policy: show the links and a box, send
   * `acceptLegal: true`) and the consents to ask (one box each, sent as
   * `consents`; a required one must be ticked). The ready-made form shows them.
   */
  legal?: { documents: { kind: string; version: string; url: string }[]; consentPurposes: { key: string; label: string; required: boolean }[] }
  /**
   * What a new password must be in the workspace. Once `methods()` has
   * answered, this client checks new passwords against it before sending
   * them; until then, against the defaults (12 to 128 characters). Absent
   * from a server that does not say.
   */
  password?: PasswordPolicy
}

/** An invitation, as its page shows it before the person chooses a password. */
export interface Invitation {
  /** The address invited: the account the person signs in as. */
  email: string
  /** The workspace's name. */
  workspace: string
  /** The organization the person was invited to, when there is one. */
  organization?: string
}

/** A legal document the person owes: not yet accepted in its current version. */
export interface PendingLegal { kind: string; version: string; url: string }

/** A company's sign-in (an SSO connection of the workspace). */
export interface SSOConnection {
  /** What `signIn.sso({ connection })` takes. */
  id: string
  /** The company's name, for "Continue with …". */
  name: string
  /** The address can sign in no other way: a password, link or provider answers `sso_required`. */
  enforced: boolean
}

/**
 * What holds a passkey, as its authenticator says: a security key (a YubiKey),
 * one synced across the person's devices (iCloud Keychain, Google Password
 * Manager), one on a single device (Windows Hello), or unknown (made before
 * Cauthy kept this).
 */
export type PasskeyKind = 'security_key' | 'synced' | 'device' | 'unknown'

/** A passkey of the signed-in account. Moments are UTC. */
export interface Passkey {
  id: string
  /** What the person called it ("My laptop"), or "". */
  name: string
  kind: PasskeyKind
  createdAt: string
  /** When it last signed the person in, or null. */
  lastUsedAt: string | null
}

/** A person's own account, as their account screen shows it. */
export interface Account {
  id: string
  email: string
  name: string
  emailVerified: boolean
  /** False for an account that only signs in through a provider: it has no current password to ask for. */
  hasPassword: boolean
  mfaEnabled: boolean
}

/** Somewhere the person is signed in. Moments are UTC. */
/** An AI agent the person allowed to act for them on one of the workspace's servers. */
export interface ConnectedAgent {
  id: string
  /** The name the agent gave itself (Claude, Cursor…): not checked by anyone. */
  name: string
  /** Where the agent receives its access: the one thing about it that is sure. */
  redirectHost: string
  resource: { name: string; uri: string }
  /** What the person allowed it, in their words. */
  scopes: { name: string; description: string }[]
  /** UTC, ISO 8601. */
  connectedAt: string
  lastUsedAt: string
}

/** An organization the person belongs to, with what their role lets them do with it and its people. */
export interface OrganizationSeat {
  id: string
  /** The client system it is of (`acme-crm`). */
  system: string
  name: string
  kind: string
  /** The person's role in it. */
  role: string
  /**
   * Cauthy's reserved powers, from the system's catalog. `manageMembers`
   * (cauthy:members:manage) adds, invites and changes roles; removing another
   * member is `removeMembers` (cauthy:members:remove), and anybody may leave.
   * `update`, `archive` and `delete` are cauthy:organization's: rename it,
   * archive it, delete it for good.
   */
  can: { readMembers: boolean; manageMembers: boolean; removeMembers: boolean; update: boolean; archive: boolean; delete: boolean }
}

/** A person of an organization, as a member who may see them reads it. */
export interface OrganizationPerson {
  userId: string
  email: string
  name: string
  role: string
  /** The account's: `active`, `suspended`… A disabled member is still listed. */
  status: string
  /** Invited and not yet accepted. */
  invited: boolean
  /** Manages the organization's members. */
  manager: boolean
  /** The signed-in person. */
  you: boolean
  /** UTC, ISO 8601. */
  since: string
}

/** A role of the organization's system, as the catalog names it. */
export interface OrganizationRoleChoice {
  role: string
  name: string
  description: string
  /** Holding it manages the organization's members. */
  manager: boolean
}

/**
 * The signed-in person's organizations, and their people. Seeing them needs
 * cauthy:members read in the person's role; changing them needs manage, and
 * removing someone needs remove. The organization itself is renamed, archived
 * or deleted with cauthy:organization update, archive or delete. Only an
 * `owner` gives the owner role or changes an owner, and the last owner stays
 * (`last_owner`). Cauthy decides, with the person's own session: the
 * application authorizes nothing.
 */
export interface OrganizationsClient {
  /** The organizations the person belongs to; one system's only with `system`. */
  list(system?: string): Promise<OrganizationSeat[]>
  /** The people of one, or null when the person may not see them. */
  members(organizationId: string): Promise<OrganizationPerson[] | null>
  /** The roles a member may be given, or null when the person may not see them. */
  roles(organizationId: string): Promise<OrganizationRoleChoice[] | null>
  /**
   * Adds a person by their address; an address with no account gets one and
   * its invitation. It only adds: a person who already belongs keeps their
   * role and the result is the error `member_exists` (change it with `setRole`).
   */
  add(organizationId: string, form: { email: string; role: string; name?: string; locale?: string }): Promise<AuthResult<'added', { member: OrganizationPerson }>>
  setRole(organizationId: string, userId: string, role: string): Promise<AuthResult<'changed', { userId: string; role: string }>>
  /** Removes a member; the person themself may always leave. */
  remove(organizationId: string, userId: string): Promise<AuthResult<'removed', { userId: string }>>
  /** Sends a member's invitation again. */
  inviteAgain(organizationId: string, userId: string, form?: { locale?: string }): Promise<AuthResult<'sent', { userId: string }>>
  /** Gives the organization a new name (cauthy:organization update). */
  rename(organizationId: string, name: string): Promise<AuthResult<'renamed', { organization: OrganizationSeat }>>
  /** Archives the organization: its members no longer reach it, and only the workspace restores it. */
  archive(organizationId: string): Promise<AuthResult<'archived', { organizationId: string }>>
  /** Deletes the organization for good. */
  delete(organizationId: string): Promise<AuthResult<'deleted', { organizationId: string }>>
  /**
   * Asks Cauthy, through the application's server, whether the person may do
   * an action on a resource in the organization, with what its conditions
   * read. A question that could not be asked is a no, with `error` saying why.
   *
   *   const r = await organizations.check({ organization, resource: 'invoices', action: 'approve', attributes: { amount: 500 } })
   *   if (r.allowed) showApprove()
   */
  check(question: CheckQuestion & { organization: OrganizationRef }): Promise<CheckResult & { error?: AuthError }>
}

export interface AccountSession {
  /** "Mac · Chrome", or "" when the browser did not say. */
  device: string
  ip: string
  createdAt: string
  expiresAt: string
}

/**
 * The signed-in person's own account. What weakens it — the password, the
 * second step, its recovery codes — asks for the current password again.
 */
/** A provider the account can also sign in with. */
export interface LinkedIdentity {
  provider: string
  /** The address the provider has for the person, when it said. */
  email: string
  name: string
  /** When it was linked, in UTC (ISO 8601). */
  linkedAt: string
}

/** How an account takes its second step. */
export interface SecondStep {
  totp: boolean
  /** The phone codes are sent to, masked (`+57 ••• ••• 4567`). */
  phone: { number: string; channel: string } | null
  /** The ways the workspace sends codes to phones. */
  phoneChannels: string[]
}

export interface AccountClient {
  /** The account, or null when nobody is signed in. */
  get(): Promise<Account | null>
  update(form: { name: string }): Promise<AuthResult<'saved', { account: Account }>>
  /** Ends every other session of the account; this one stays signed in. */
  changePassword(form: { password: string; newPassword: string }): Promise<AuthResult<'changed', { signedIn: boolean }>>
  /**
   * The legal documents the person has not accepted in their current version
   * (a new version of the terms, say): show them and call `acceptLegal`.
   * Nothing stops the person meanwhile; the application decides what waits.
   */
  legal(): Promise<AuthResult<'ok', { pending: PendingLegal[] }>>
  /** Records the person's acceptance of the documents in force (the kinds named, or every one). */
  acceptLegal(form?: { kinds?: string[] }): Promise<AuthResult<'accepted'>>
  mfa: {
    /** Starts turning the second step on: show `qr` (the `otpauthUri` drawn by Cauthy, a PNG `data:` URI; empty from an older Cauthy) and `secret` to add to an authenticator app, then call `verify`. */
    setup(form: { password: string }): Promise<AuthResult<'started', { secret: string; otpauthUri: string; qr: string }>>
    /** Turns it on with a code from the app. `recoveryCodes` are shown this once. */
    verify(form: { code: string }): Promise<AuthResult<'enabled', { recoveryCodes: string[] }>>
    disable(form: { password: string }): Promise<AuthResult<'disabled'>>
    /** New recovery codes; the earlier ones stop working. */
    recoveryCodes(form: { password: string }): Promise<AuthResult<'renewed', { recoveryCodes: string[] }>>
    /**
     * How the account takes its second step: an authenticator app, a phone
     * (masked), and the ways the workspace sends codes to phones (`sms`,
     * `whatsapp`; none when it has no Twilio account for it).
     */
    factors(): Promise<SecondStep | null>
    /** Adds a phone as the second step: a code is sent to it, for `verifyPhone`. */
    addPhone(form: { phone: string; channel: 'sms' | 'whatsapp'; password: string }): Promise<AuthResult<'sent', { sentTo: string; channel: string }>>
    /** Proves the phone with the code it received. `recoveryCodes` come with a first second step, shown this once. */
    verifyPhone(form: { code: string }): Promise<AuthResult<'enabled', { recoveryCodes: string[] }>>
    removePhone(form: { password: string }): Promise<AuthResult<'removed'>>
  }
  /**
   * Asks to sign in with another address. Nothing changes yet: the new address
   * is mailed a link to confirm it, and once it is confirmed the old one is
   * told, with a link that undoes it. Both open Cauthy's own page.
   */
  changeEmail(form: { email: string; password: string }): Promise<AuthResult<'sent', { email: string }>>
  /** The providers (Google…) the account can also sign in with. */
  identities(): Promise<LinkedIdentity[]>
  /**
   * Sends the browser to the provider, to link it to the account; it comes back
   * at `returnTo` with `?linked=<provider>`, or `?auth_error=<code>`.
   */
  link(provider: string, options?: { returnTo?: string }): void
  /** Where `link` sends the browser, for a plain link. */
  linkUrl(provider: string, options?: { returnTo?: string }): string
  /** The account stops signing in with that provider. Refused when it would be left with no way to sign in. */
  unlink(provider: string): Promise<AuthResult<'unlinked', { provider: string }>>
  /**
   * A guest becomes an account of their own with an address and a password —
   * the same id, so what they did stays theirs. `email_taken`: the address has
   * an account already; offer to sign in with it.
   */
  upgrade(form: { email: string; password: string; name?: string }): Promise<AuthResult<'signed_in', { session: PublicSession }>>
  /** Where a guest goes to become the account of a provider's address (Google…). */
  upgradeUrl(provider: string, options?: { returnTo?: string }): string
  /** Sends a guest to `upgradeUrl`; they come back signed in as the account. */
  upgradeWith(provider: string, options?: { returnTo?: string }): void
  /** Where the account is signed in. */
  sessions(): Promise<AccountSession[]>
  /** Signs the account out everywhere, here too. */
  signOutEverywhere(): Promise<AuthResult<'signed_out'>>
  /** The AI agents the person connected. */
  agents(): Promise<ConnectedAgent[]>
  /** Disconnects an agent: it loses its access within minutes. */
  disconnectAgent(id: string): Promise<AuthResult<'disconnected', { id: string }>>
  /** The account's passkeys. */
  passkeys(): Promise<Passkey[]>
  /**
   * Makes a passkey on this device, on this page: the browser asks the person
   * for their fingerprint, face or screen lock. An account with a password
   * proves it again first. `cancelled`: the person closed the browser's prompt.
   * `kind` sends the browser straight to one: `'device'`, this device's
   * fingerprint, face or screen lock; `'security_key'`, a security key.
   * Without it, the browser offers all.
   */
  addPasskey(form?: { password?: string; name?: string; kind?: 'device' | 'security_key' }): Promise<AuthResult<'added', { passkey: Passkey }>>
  removePasskey(id: string): Promise<AuthResult<'removed', { id: string }>>
}

export interface AuthClient {
  signIn: {
    /**
     * A guest session, before the visitor signs up: the application keeps what
     * they do under `session.user.id`, and `account.upgrade` (or
     * `account.upgradeWith`) makes it their account, same id. Only where the
     * workspace allows guests (`anonymous_disabled` otherwise).
     */
    anonymously(form?: { captchaToken?: string }): Promise<AuthResult<'signed_in', { session: PublicSession }>>
    /**
     * With address and password. `mfa_required`: ask for the code and call
     * `signIn.mfa`. `method: 'email'` says the code was just mailed to the
     * account's address (it has no factor of its own and the workspace, or
     * the sign-in's risk, asked a second step): say so, and offer
     * `mfaSendEmail` for another.
     */
    email(form: { email: string; password: string; captchaToken?: string; remember?: boolean }): Promise<AuthResult<'signed_in', { session: PublicSession }> | AuthResult<'mfa_required', { method?: 'email' }>>
    /** The second step: the code of the authenticator app, the phone, the email, or a recovery code. */
    mfa(form: { code: string }): Promise<AuthResult<'signed_in', { session: PublicSession }>>
    /**
     * While the second step is asked for: whether the account has an
     * authenticator app, the phone (masked) a code can be sent to, phones
     * that approve sign-ins, and the address (masked) a code went to when
     * the step is by email.
     */
    mfaMethods(): Promise<AuthResult<'ok', { totp: boolean; phone: { number: string; channel: string } | null; push: { devices: number } | null; email: { to: string } | null }>>
    /** Mails the sign-in's code again, when its second step is by email; `mfa` takes it. A few per sign-in. */
    mfaSendEmail(): Promise<AuthResult<'sent', { sentTo: string }>>
    /**
     * Sends a push to the account's phones (the application's app, with
     * cauthy-expo): show `number`, which the person picks on the phone, then
     * call `mfaPushWait`.
     */
    mfaPush(): Promise<AuthResult<'sent', { number: number }>>
    /**
     * Waits for the phone's answer, listening (server-sent events) rather than
     * asking again and again, and signs in when it approves. `denied`: turned
     * down on the phone; `expired`: nobody answered in time.
     */
    mfaPushWait(o?: { signal?: AbortSignal }): Promise<AuthResult<'signed_in', { session: PublicSession }>>
    /** Sends a code to the account's phone, by SMS or WhatsApp; `mfa` takes it. A few per sign-in. */
    mfaSendCode(): Promise<AuthResult<'sent', { sentTo: string; channel: string }>>
    /**
     * Mails a link (and a code) that signs the person in. The answer is the
     * same whether or not the address has an account. `create`: an address
     * with no account gets one when the link or code is used, if the
     * workspace accepts new accounts — one screen signs people in and up.
     * `returnTo` (a path of this site) travels in the link: the page it opens
     * gets it as `?return_to=`, and `emailCode` answers it.
     */
    magicLink(form: { email: string; captchaToken?: string; create?: boolean; returnTo?: string; remember?: boolean }): Promise<AuthResult<'sent'>>
    /** Signs in with the token the mailed link opened the page with (`ml_token`). */
    magicLinkVerify(form: { token: string; remember?: boolean }): Promise<AuthResult<'signed_in', { session: PublicSession }>>
    /** Signs in with the code that came in the same mail as the link, for somebody reading it on another device. */
    emailCode(form: { code: string }): Promise<AuthResult<'signed_in', { session: PublicSession; returnTo?: string }>>
    /**
     * Signs in with a passkey, on this page: the browser asks the person for
     * their fingerprint, face or screen lock. When this page cannot use the
     * workspace's passkeys (`methods().passkeyHere` is false), the browser goes
     * to Cauthy's page for that step alone and comes back signed in, at
     * `returnTo`: then the answer is `redirected`. `cancelled`: the person
     * closed the browser's prompt. `email`, when the person typed it: the
     * browser is told which passkeys are theirs, so a security key that did
     * not keep its passkey (one made before cauthy-auth 0.18.0) is found too.
     */
    passkey(options?: { returnTo?: string; locale?: string; email?: string; remember?: boolean }): Promise<AuthResult<'signed_in', { session: PublicSession }> | AuthResult<'redirected'>>
    /**
     * Offers the person's passkeys in the browser's autofill of the email
     * field, which must carry `autocomplete="username webauthn"`, and signs in
     * with the one they pick. It waits until they pick one or `signal`
     * aborts: abort it before calling `passkey` or sending the form.
     * `cancelled`: aborted, or this browser or page cannot (then there is
     * nothing to offer, and the passkey button still works).
     */
    passkeyAutofill(options?: { signal?: AbortSignal; remember?: () => boolean }): Promise<AuthResult<'signed_in', { session: PublicSession }>>
    /**
     * Google One Tap: Google's prompt over the page offers the Google account
     * the browser already has, and signs in with it in one tap, as the Google
     * sign-in does (the same account). Needs the workspace's Google sign-in,
     * and the page's address among the Google client's authorized JavaScript
     * origins. Waits until the person picks an account or closes the prompt
     * (`cancelled`), or `signal` aborts. `one_tap_unavailable`: the workspace
     * has no Google sign-in.
     */
    googleOneTap(options?: { signal?: AbortSignal; context?: 'signin' | 'signup' | 'use'; remember?: () => boolean }): Promise<AuthResult<'signed_in', { session: PublicSession }>>
    /** Where `passkey` sends the browser when this page cannot use the passkey itself. */
    passkeyUrl(options?: { returnTo?: string; locale?: string }): string
    /** Sends the browser to the provider; it comes back signed in, at `returnTo`. */
    social(provider: string, options?: { returnTo?: string; remember?: boolean }): void
    /**
     * Which company's sign-in a work address uses, if any (`found`), or
     * `none`. It says so of the address's domain, never whether the address
     * has an account.
     */
    ssoDiscover(form: { email: string }): Promise<AuthResult<'found', { connection: SSOConnection }> | AuthResult<'none'>>
    /**
     * Sends the browser to the person's company (found by `email`, or named
     * by `connection`); it comes back signed in, at `returnTo`. A sign-in the
     * company refused comes back with `?auth_error=`. Any other way of
     * signing in answers `sso_required` for an address its company holds to
     * SSO: send it here then.
     */
    sso(target: { email: string } | { connection: string }, options?: { returnTo?: string; remember?: boolean }): void
    /** Where `sso` sends the browser, for a plain link. */
    ssoUrl(target: { email: string } | { connection: string }, options?: { returnTo?: string; remember?: boolean }): string
    /** Where `social` sends the browser, for a plain link. */
    socialUrl(provider: string, options?: { returnTo?: string; remember?: boolean }): string
  }
  signUp: {
    /**
     * `verification_required`: the account exists and must open the link Cauthy mailed before it can sign in.
     * `acceptLegal` and `consents` answer what `methods().legal` asks; a sign-up that leaves them out is refused.
     */
    email(form: { email: string; password: string; name?: string; organization?: string; acceptLegal?: boolean; consents?: Record<string, boolean>; captchaToken?: string }): Promise<AuthResult<'signed_in', { session: PublicSession }> | AuthResult<'verification_required', { email: string }>>
  }
  /** Mails a link to choose a new password. The answer is the same whether or not the address has an account. */
  forgotPassword(form: { email: string; captchaToken?: string }): Promise<AuthResult<'sent'>>
  /** Sets the new password, with the token the mailed link opened the page with (`token`). */
  resetPassword(form: { token: string; password: string }): Promise<AuthResult<'changed'>>
  /**
   * Who an invitation is for and to what, with the token the mailed link
   * opened the page with (`token`). Reading it does not spend it.
   * `invalid_token`: unknown, spent or expired.
   */
  invitation(token: string): Promise<AuthResult<'ok', { invitation: Invitation }>>
  /**
   * Accepts an invitation with the password the person chose (the workspace's
   * policy, as for a sign-up) and signs them in. `mfa_required`: the account
   * owes a second step; ask for the code and call `signIn.mfa`, as after
   * `signIn.email`. A password refused leaves the invitation good.
   */
  acceptInvitation(token: string, password: string): Promise<AuthResult<'signed_in', { session: PublicSession }> | AuthResult<'mfa_required', { method?: 'email' }>>
  /** Confirms the address a mailed link is for. The person is signed in from the link when their account asks no second step. */
  verifyEmail(form: { token: string }): Promise<AuthResult<'verified'> | AuthResult<'signed_in', { session: PublicSession }>>
  signOut(): Promise<AuthResult<'signed_out'>>
  /** The signed-in person's own account. */
  account: AccountClient
  /** The signed-in person's organizations, and their people. */
  organizations: OrganizationsClient
  /** Who is signed in, or null. */
  getSession(): Promise<PublicSession | null>
  methods(): Promise<AuthMethods>
  /**
   * How the workspace's forms look — colours, corners, typeface — as a person
   * set it in Cauthy's dashboard. Read once per page; null when Cauthy cannot say.
   */
  look(): Promise<CauthyTheme | null>
}

export interface AuthClientOptions extends TransportOptions {
  /** Where the server mounted the routes. Default: `/api/auth`. */
  basePath?: string
  fetch?: typeof fetch
  /**
   * The language the person reads, for what Cauthy mails them (a sign-in
   * link, a new password, a confirmation): a tag like `es` or `es-CO`, or a
   * function that answers it when the person can change it. Default: the
   * page's own (`<html lang>`), else the browser's.
   */
  locale?: string | (() => string | undefined)
  /**
   * Called once when an answer does not say `Cauthy-Protocol: 1`: a backend
   * SDK from before protocol 1 at level strict, or another handler answering
   * under `basePath`. Default: one console warning per page and mount point.
   */
  onProtocolMismatch?: (seen: string | null) => void
  /** The page's Content Security Policy nonce, put on Google's One Tap script when it loads. */
  scriptNonce?: string
}

/** How long Cauthy waits for a passkey ceremony to be answered. */
const PASSKEY_SECONDS = 300

const warned = new Set<string>()
/** One console warning per page for a call version 2 of the protocol removes. */
function deprecated(name: string): void {
  if (warned.has(name)) return
  warned.add(name)
  console.warn(`@cauthyhq/js: ${name} is deprecated: guest sessions leave the auth-bff protocol in version 2.`)
}

export function createAuthClient(options: AuthClientOptions = {}): AuthClient {
  const t = createTransport(options)
  const { post, read } = t
  let looked: Promise<CauthyTheme | null> | undefined
  // The workspace's password policy, once methods() has said it.
  let policy: PasswordPolicy | undefined

  const back = (o: { returnTo?: string } = {}) => ({ return_to: o.returnTo || undefined })
  const upgradeUrl = (provider: string, o: { returnTo?: string } = {}) => {
    deprecated('account.upgradeUrl')
    return t.href('me.upgrade_social', back(o), provider)
  }
  const linkUrl = (provider: string, o: { returnTo?: string } = {}) => t.href('me.identities_link', back(o), provider)
  const socialUrl = (provider: string, o: { returnTo?: string; remember?: boolean } = {}) =>
    t.href('sign-in.social', { ...back(o), remember: o.remember ? '1' : undefined }, provider)
  const ssoUrl = (target: { email: string } | { connection: string }, o: { returnTo?: string; remember?: boolean } = {}) =>
    t.href('sign-in.sso', { ...('connection' in target ? { connection: target.connection } : { email: target.email.trim() }), ...back(o), remember: o.remember ? '1' : undefined })
  const passkeyUrl = (o: { returnTo?: string; locale?: string } = {}) =>
    t.href('hosted.login', { method: 'passkey', ...back(o), locale: o.locale || undefined })

  async function methods(): Promise<AuthMethods> {
    // A server from before the passkey on the page does not say; then it is not.
    const m = (await read('other.methods')) as Partial<AuthMethods> | null
    if (m && typeof m === 'object') {
      // The workspace's password rule, for the checks before a password is sent.
      if (m.password) policy = passwordPolicyOf(m.password)
      return { providers: [], signUp: true, magicLink: false, passkey: false, ...m, ...(policy ? { password: policy } : {}), passwordSignIn: m.passwordSignIn !== false, passkeyHere: m.passkeyHere === true, passkeyOnCauthy: m.passkeyOnCauthy ?? m.passkey === true, sso: m.sso === true }
    }
    return { providers: [], signUp: true, passwordSignIn: true, magicLink: false, passkey: false, passkeyHere: false, passkeyOnCauthy: false, sso: false }
  }

  /** The two steps of a ceremony: what to ask the browser, then its answer. */
  async function ceremony<B extends PostRouteId, F extends PostRouteId>(begin: B, form: RouteBodies[B], finish: F, run: (options: any) => Promise<Record<string, unknown>>, more?: Omit<RouteBodies[F], 'credential'>): Promise<any> {
    const begun = await post(begin, form)
    if (!begun.ok) return begun
    let credential: Record<string, unknown>
    try {
      credential = await run(begun.options)
    } catch (e) {
      return { ok: false, error: ceremonyError(e) }
    }
    return post(finish, { ...more, credential } as RouteBodies[F])
  }

  return {
    signIn: {
      anonymously: (f = {}) => {
        deprecated('signIn.anonymously')
        return post('sign-in.anonymous', {}, null, f.captchaToken)
      },
      email: (f) => post('sign-in.email', { email: f.email, password: f.password, ...(f.remember ? { remember: true } : {}) }, firstProblem(checkEmail(f.email), checkPassword(f.password)), f.captchaToken),
      mfa: (f) => post('sign-in.mfa', { code: f.code }, checkCode(f.code)),
      mfaMethods: () => post('sign-in.mfa_methods', {}),
      mfaSendCode: () => post('sign-in.mfa_send', {}),
      mfaSendEmail: () => post('sign-in.mfa_email', {}),
      mfaPush: () => post('sign-in.mfa_push', {}),
      async mfaPushWait(o = {}) {
        const status = await new Promise<string>((resolve) => {
          if (o.signal?.aborted) return resolve('aborted')
          if (typeof EventSource !== 'function') return resolve('approved') // finish says whether it was
          const source = new EventSource(t.href('sign-in.mfa_push_events'), { withCredentials: true })
          const aborted = () => stop('aborted')
          const stop = (st: string) => {
            source.close()
            o.signal?.removeEventListener('abort', aborted)
            resolve(st)
          }
          o.signal?.addEventListener('abort', aborted, { once: true })
          source.addEventListener('status', (e) => {
            const st = (() => {
              try {
                return String(JSON.parse((e as MessageEvent).data).status)
              } catch {
                return ''
              }
            })()
            if (st && st !== 'pending') stop(st)
          })
          source.onerror = () => {
            if (source.readyState === EventSource.CLOSED) stop('expired')
          }
        })
        if (status === 'aborted') return { ok: false, error: { code: 'aborted', message: 'Stopped waiting.' } }
        if (status === 'denied') return { ok: false, error: { code: 'push_denied', message: 'The sign-in was turned down on the phone.' } }
        if (status === 'expired') return { ok: false, error: { code: 'push_expired', message: 'Nobody answered on the phone in time.' } }
        return post('sign-in.mfa_push_finish', {})
      },
      magicLink: (f) => post('sign-in.magic_link', { email: f.email, ...(f.create ? { create: true } : {}), ...(f.returnTo ? { returnTo: f.returnTo } : {}), ...(f.remember ? { remember: true } : {}) }, checkEmail(f.email), f.captchaToken),
      magicLinkVerify: (f) => post('sign-in.magic_link_verify', { token: f.token, ...(f.remember ? { remember: true } : {}) }),
      emailCode: (f) => post('sign-in.email_code', { code: f.code }, checkCode(f.code)),
      passkeyUrl,
      async passkey(o) {
        const m = await methods()
        if (m.passkeyHere && canUsePasskeys()) {
          const email = o?.email?.trim() ?? ''
          const r = await ceremony('sign-in.passkey_begin', { ...(email !== '' && checkEmail(email) === null ? { email } : {}), ...(o?.remember ? { remember: true } : {}) }, 'sign-in.passkey_finish', getPasskey)
          // A browser that does not read the domain's related origins refuses
          // this page: Cauthy's, then, when it can.
          if (r.ok || r.error.code !== 'passkey_unavailable' || !m.passkeyOnCauthy) return r
        } else if (!m.passkeyOnCauthy) {
          return { ok: false, error: { code: 'passkey_unavailable', message: 'Passkeys cannot be used here.' } }
        }
        window.location.assign(passkeyUrl(o))
        return { ok: true, status: 'redirected' }
      },
      async passkeyAutofill(o = {}) {
        const cancelled = { ok: false as const, error: { code: 'cancelled', message: 'No passkey was chosen.' } }
        const m = await methods()
        if (!m.passkeyHere || !(await canAutofillPasskeys())) return cancelled
        for (;;) {
          if (o.signal?.aborted) return cancelled
          const begun = await post('sign-in.passkey_begin', {})
          if (!begun.ok) return begun
          // Cauthy's challenge lives five minutes: a page left open asks for
          // a fresh one before it runs out.
          const renew = new AbortController()
          const stop = () => renew.abort()
          o.signal?.addEventListener('abort', stop, { once: true })
          const timer = setTimeout(stop, (PASSKEY_SECONDS - 30) * 1000)
          let credential: Record<string, unknown>
          try {
            credential = await getPasskey(begun.options, { mediation: 'conditional', signal: renew.signal })
          } catch (e) {
            if (o.signal?.aborted) return cancelled
            if (renew.signal.aborted) continue
            return { ok: false, error: ceremonyError(e) }
          } finally {
            clearTimeout(timer)
            o.signal?.removeEventListener('abort', stop)
          }
          return post('sign-in.passkey_finish', { credential, ...(o.remember?.() ? { remember: true } : {}) })
        }
      },
      async googleOneTap(o = {}) {
        const cancelled = { ok: false as const, error: { code: 'cancelled', message: 'No Google account was chosen.' } }
        if (typeof window === 'undefined' || o.signal?.aborted) return cancelled
        const begun = await post('sign-in.google_one_tap_begin', {})
        if (!begun.ok) return begun
        let credential: string | null
        try {
          credential = await promptGoogleOneTap({ clientId: begun.clientId, nonce: begun.nonce, context: o.context, signal: o.signal, scriptNonce: options.scriptNonce })
        } catch {
          return { ok: false, error: { code: 'unavailable', message: 'Google could not be reached. Try again, or sign in another way.' } }
        }
        if (credential === null) return cancelled
        return post('sign-in.google_one_tap', { credential, ...(o.remember?.() ? { remember: true } : {}) })
      },
      socialUrl,
      social(provider, o) {
        window.location.assign(socialUrl(provider, o))
      },
      ssoDiscover: (f) => post('sign-in.sso_discover', { email: f.email.trim() }, checkEmail(f.email)),
      ssoUrl,
      sso(target, o) {
        window.location.assign(ssoUrl(target, o))
      },
    },
    signUp: {
      email: (f) => post('sign-in.sign_up', { email: f.email, password: f.password, name: f.name, organization: f.organization, acceptLegal: f.acceptLegal, consents: f.consents },
        firstProblem(checkName(f.name), checkEmail(f.email), checkNewPassword(f.password, policy), checkOrganization(f.organization)), f.captchaToken),
    },
    forgotPassword: (f) => post('sign-in.forgot_password', { email: f.email }, checkEmail(f.email), f.captchaToken),
    resetPassword: (f) => post('sign-in.reset_password', { token: f.token, password: f.password }, checkNewPassword(f.password, policy)),
    verifyEmail: (f) => post('sign-in.verify_email', { token: f.token }),
    async invitation(token) {
      const bad = { ok: false as const, error: { code: 'invalid_token', message: 'This invitation is not valid, or it has expired.' } }
      if (typeof token !== 'string' || token.trim() === '') return bad
      const r = await t.get('sign-in.invitation', { token: token.trim() })
      if (!r.ok) return r
      return r.body?.invitation ? { ok: true as const, status: 'ok' as const, invitation: r.body.invitation as Invitation } : { ok: false as const, error: UNAVAILABLE }
    },
    acceptInvitation: (token, password) => post('sign-in.invitation_accept', { token, password }, checkNewPassword(password, policy)),
    signOut: () => post('session.sign_out', {}),
    organizations: {
      async list(system) {
        const body = await read('organizations.list', { system: system || undefined })
        return body && Array.isArray(body.organizations) ? (body.organizations as OrganizationSeat[]) : []
      },
      async members(id) {
        const body = await read('organizations.members', { id })
        return body && Array.isArray(body.members) ? (body.members as OrganizationPerson[]) : null
      },
      async roles(id) {
        const body = await read('organizations.roles', { id })
        return body && Array.isArray(body.roles) ? (body.roles as OrganizationRoleChoice[]) : null
      },
      add: (id, f) => post('organizations.members_add', { organizationId: id, email: f.email, role: f.role, name: f.name ?? '', locale: f.locale ?? '' }, checkEmail(f.email)),
      setRole: (id, userId, role) => post('organizations.members_role', { organizationId: id, userId, role }),
      remove: (id, userId) => post('organizations.members_remove', { organizationId: id, userId }),
      inviteAgain: (id, userId, f = {}) => post('organizations.members_invite', { organizationId: id, userId, locale: f.locale ?? '' }),
      rename: (id, name) => post('organizations.rename', { organizationId: id, name }, checkOrganizationName(name)),
      archive: (id) => post('organizations.archive', { organizationId: id }),
      delete: (id) => post('organizations.delete', { organizationId: id }),
      async check(q) {
        const organizationId = typeof q.organization === 'string' ? q.organization : (q.organization?.id ?? '')
        const r = await post('organizations.check', {
          organizationId, resource: q.resource, action: q.action,
          ...(q.attributes !== undefined ? { attributes: q.attributes } : {}),
          ...(q.resourceId !== undefined ? { resourceId: q.resourceId } : {}),
          ...(q.ownerId !== undefined ? { ownerId: q.ownerId } : {}),
        })
        if (!r.ok) return { allowed: false, reason: r.error.message, error: r.error as AuthError }
        return { allowed: r.allowed === true, reason: String(r.reason ?? ''), ...(r.rule ? { rule: r.rule } : {}) }
      },
    },
    account: {
      async get() {
        const body = await read('me.get')
        return body && typeof body.account === 'object' && body.account !== null ? (body.account as Account) : null
      },
      update: (f) => post('me.save', { name: f.name }, checkName(f.name)),
      async legal() {
        const body = await read('me.legal')
        if (!body) return { ok: false as const, error: { code: 'not_signed_in', message: 'Nobody is signed in.' } }
        return { ok: true as const, status: 'ok' as const, pending: Array.isArray(body.pending) ? body.pending : [] }
      },
      acceptLegal: (f = {}) => post('me.legal_accept', { kinds: f.kinds ?? [] }),
      changePassword: (f) => {
        const bad = checkNewPassword(f.newPassword, policy)
        return post('me.password', { password: f.password, newPassword: f.newPassword }, bad ? { ...bad, field: 'newPassword' } : null)
      },
      mfa: {
        setup: (f) => post('me.mfa_setup', { password: f.password }),
        verify: (f) => post('me.mfa_verify', { code: f.code }, checkCode(f.code)),
        disable: (f) => post('me.mfa_disable', { password: f.password }),
        recoveryCodes: (f) => post('me.mfa_recovery_codes', { password: f.password }),
        async factors() {
          const body = await read('me.mfa_factors')
          return body && typeof body.totp === 'boolean' ? (body as SecondStep) : null
        },
        addPhone: (f) => post('me.mfa_phone', { phone: f.phone, channel: f.channel, password: f.password }),
        verifyPhone: (f) => post('me.mfa_phone_verify', { code: f.code }, checkCode(f.code)),
        removePhone: (f) => post('me.mfa_phone_remove', { password: f.password }),
      },
      changeEmail: (f) => post('me.email', { email: f.email, password: f.password }, checkEmail(f.email)),
      async identities() {
        const body = await read('me.identities')
        return body && Array.isArray(body.identities) ? (body.identities as LinkedIdentity[]) : []
      },
      linkUrl,
      link(provider, o) {
        window.location.assign(linkUrl(provider, o))
      },
      unlink: (provider) => post('me.identities_unlink', { provider }),
      async sessions() {
        const body = await read('session.list')
        return body && Array.isArray(body.sessions) ? (body.sessions as AccountSession[]) : []
      },
      signOutEverywhere: () => post('session.end_all', {}),
      upgrade: (f) => {
        deprecated('account.upgrade')
        return post('me.upgrade', { email: f.email, password: f.password, name: f.name ?? '' }, firstProblem(checkName(f.name), checkEmail(f.email), checkNewPassword(f.password, policy)))
      },
      upgradeUrl,
      upgradeWith(provider, o) {
        deprecated('account.upgradeWith')
        window.location.assign(upgradeUrl(provider, o))
      },
      async agents() {
        const body = await read('me.agents')
        return body && Array.isArray(body.agents) ? (body.agents as ConnectedAgent[]) : []
      },
      disconnectAgent: (id) => post('me.agents_disconnect', { id }),
      async passkeys() {
        const body = await read('me.passkeys')
        return body && Array.isArray(body.passkeys) ? (body.passkeys as Passkey[]) : []
      },
      addPasskey(f = {}) {
        if (!canUsePasskeys()) return Promise.resolve({ ok: false, error: { code: 'passkey_unavailable', message: 'This browser cannot make passkeys.' } })
        return ceremony('me.passkeys_add_begin', { password: f.password ?? '', ...(f.kind ? { kind: f.kind } : {}) }, 'me.passkeys_add_finish', makePasskey, { name: f.name ?? '' })
      },
      removePasskey: (id) => post('me.passkeys_remove', { id }),
    },
    async getSession() {
      const body = await read('session.get')
      return body && typeof body === 'object' ? ((body.session ?? null) as PublicSession | null) : null
    },
    look() {
      looked ??= read('other.look').then((wire) => (wire && typeof wire === 'object' ? fromWire(wire) : null))
      return looked
    },
    methods,
  }
}
