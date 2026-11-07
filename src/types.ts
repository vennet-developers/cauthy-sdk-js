/** The person signed in. Every moment is UTC. */
export interface SessionUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
  /**
   * True when the account ran out of time to confirm its address: let it read
   * and refuse its writes.
   */
  restricted: boolean
  /** When an unconfirmed address stops being enough (ISO 8601, UTC), if there is a deadline. */
  emailVerifyBy?: string
  /** The language the person reads in ("es", "en-US"), when Cauthy knows it. */
  locale?: string
  /** A guest: a visitor's session before they sign up. No email; `account.upgrade` makes it an account, keeping `id`. */
  isAnonymous?: boolean
}

/** A value JSON can carry. What crosses from server to browser is typed as this, never `unknown`. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** An organization the person belongs to, with their role in it. */
export interface SessionOrganization {
  id: string
  system: string
  name: string
  kind: string
  externalId?: string
  role: string
  /** What the system keeps about the organization, as it filed it in Cauthy. */
  metadata: Record<string, JsonValue>
  /**
   * What the person may do here, as "resource:action" entries ("*" is any):
   * their role's permissions, what it inherits, and anything given to them
   * apart from it. Absent when the system keeps no catalog of roles in Cauthy.
   * Check with `can(organization, resource, action)`.
   */
  permissions?: string[]
  /** What the person is denied here, whatever else allows it. */
  denied?: string[]
  /**
   * Permissions that hold only when their condition does (an amount under a
   * limit, the person's own records…). They are in neither list above: `can`
   * answers no for them, and `auth.check` asks Cauthy. Present, maybe empty,
   * whenever `permissions` is.
   */
  conditional?: ConditionalPermission[]
}

/** A permission with a condition: Cauthy decides it per question (`auth.check`). */
export interface ConditionalPermission {
  resource: string
  action: string
  effect: 'allow' | 'deny'
}

/** What to ask Cauthy about: an action on a resource, with what the conditions read of it. */
export interface CheckQuestion {
  resource: string
  action: string
  /** What a condition reads as `resource.attrs`: `{ amount: 500 }`. */
  attributes?: Record<string, unknown>
  /** The record's id, as a condition reads it (`resource.id`). */
  resourceId?: string
  /** Whose the record is (`resource.owner_id`): `resource.owner_id == subject.id`. */
  ownerId?: string
}

/** An organization, by its id or as the session has it. */
export type OrganizationRef = string | { id: string }

/** The rule that decided a check. */
export interface CheckRule {
  /** A permission of the person's role, or an exception given to the person. */
  source: 'role' | 'exception'
  /** The role, when `source` is `role`. */
  role?: string
  kind: string
  resource: string
  action: string
  effect: 'allow' | 'deny'
  condition?: string
}

/** Cauthy's answer to a check. */
export interface CheckResult {
  allowed: boolean
  /** Why, in words: "allowed by role accountant: invoices:approve". */
  reason: string
  /** The rule that decided; absent when none did (nothing allows it). */
  rule?: CheckRule
}

/** What the browser is told of a session: who, and their organizations — never a token. */
export interface PublicSession {
  user: SessionUser
  tenantId: string
  roles: string[]
  organizations: SessionOrganization[]
  expiresAt: string
}
