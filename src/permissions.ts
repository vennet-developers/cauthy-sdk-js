// What a person may do in an organization.
//
// When a system keeps its catalog of roles in Cauthy, each of a person's
// organizations arrives with what their role — and anything given or denied to
// them apart from it — lets them do. Checking is a lookup in that list: no
// call to Cauthy, on the server or in the browser.

import type { CheckQuestion, CheckResult, CheckRule, ConditionalPermission, OrganizationRef } from './types'

/** The part of an organization that says what its member may do. */
export interface Permitted {
  /** "resource:action" entries the person is allowed; "*" is any. Absent when the system keeps no catalog in Cauthy. */
  permissions?: string[]
  /** Entries the person is denied whatever else allows them. */
  denied?: string[]
  /** Permissions with a condition: in neither list, so `can` never counts them. Ask with `auth.check`. */
  conditional?: ConditionalPermission[]
}

function matches(entry: string, resource: string, action: string): boolean {
  // The resource may itself hold a colon: the action is what follows the last one.
  const i = entry.lastIndexOf(':')
  if (i < 0) return false
  const r = entry.slice(0, i)
  const a = entry.slice(i + 1)
  return (r === '*' || r === resource) && (a === '*' || a === action)
}

/**
 * Whether the person may do an action on a resource in an organization:
 * allowed by some entry, and denied by none. A denial wins.
 *
 * An organization of a system that keeps no catalog in Cauthy carries no
 * permissions, and the answer is `false`: decide by its `role` instead.
 *
 * A permission with a condition (`organization.conditional`) is not in the
 * lists, so `can` answers `false` for what only it allows: the condition reads
 * the record at hand, which only Cauthy can weigh. Ask with `auth.check`
 * (`organizations.check` in the browser).
 *
 *   if (!can(organization, 'invoicing', 'write')) return forbidden()
 */
export function can(organization: Permitted | null | undefined, resource: string, action: string): boolean {
  if (!organization?.permissions) return false
  if ((organization.denied ?? []).some((d) => matches(d, resource, action))) return false
  return organization.permissions.some((p) => matches(p, resource, action))
}

// ── A system's catalog of roles ────────────────────────────────────────────

/** Something a role may do: an action on a resource, in organizations of a kind ("*", the default, is every kind). */
export interface PolicyPermission {
  kind?: string
  resource: string
  action: string
  /**
   * When it holds, in CEL: `resource.attrs.amount <= 1000000`. A permission
   * with one is decided by Cauthy per question (`auth.check`), never by `can`.
   */
  condition?: string
}

/** The type of an attribute a condition may read: `list` is any JSON array. */
export type AttributeType = 'string' | 'number' | 'bool' | 'list'

/** A resource of a system's catalog: the actions done on it and the attributes its conditions read. */
export interface CatalogResource {
  resource: string
  description?: string
  actions: string[]
  /** Name → type, as `resource.attrs.<name>` in a condition. */
  attributes?: Record<string, AttributeType>
}

export interface PolicyRole {
  role: string
  name?: string
  description?: string
  /** Roles whose permissions this one has as well. */
  inherits?: string[]
  permissions?: PolicyPermission[]
}

// ── The catalog, with its types ────────────────────────────────────────────
//
// A catalog written down once gives the roles and the permissions their
// names: `can(org, 'ledger:write')` then takes only a permission the catalog
// has, the editor offers them, and a typo does not compile.
//
//   export const policy = definePolicy([
//     { role: 'reader', permissions: [{ resource: 'ledger', action: 'read' }] },
//     { role: 'accountant', inherits: ['reader'], permissions: [{ resource: 'ledger', action: 'write' }] },
//   ])
//   export const { can, hasRole } = policy
//
//   can(organization, 'ledger:write')        // 'ledger:wirte' does not compile
//   hasRole(organization, 'accountant')
//
// A system that declares its resources gives them too, with their actions and
// the attributes a condition reads, and a check is typed by them:
//
//   export const policy = definePolicy({
//     catalog: [{ resource: 'invoices', actions: ['read', 'approve'], attributes: { amount: 'number' } }],
//     roles: [{ role: 'accountant', permissions: [{ resource: 'invoices', action: 'approve', condition: 'resource.attrs.amount <= 1000' }] }],
//   })
//
//   await policy.check(auth, request, { organization, resource: 'invoices', action: 'approve', attributes: { amount: 500 } })
//
// Write it by hand, or write it on a server from the catalog Cauthy has
// (`pullPolicy` and `policySource` of `@cauthyhq/node`).

type PermissionShape = { readonly kind?: string; readonly resource: string; readonly action: string; readonly condition?: string }

/** A role as `definePolicy` reads it: any `PolicyRole`, kept as written. */
type RoleShape = {
  readonly role: string
  readonly name?: string
  readonly description?: string
  readonly inherits?: readonly string[]
  readonly permissions?: readonly PermissionShape[]
}

/** A resource as `definePolicy` reads it: any `CatalogResource`, kept as written. */
type ResourceShape = {
  readonly resource: string
  readonly description?: string
  readonly actions: readonly string[]
  readonly attributes?: { readonly [name: string]: AttributeType }
}

// "*" in a catalog is "any": the name it stands for is any text.
type Named<S extends string> = S extends '*' ? string : S

type PermissionsIn<R> = R extends { readonly permissions: readonly (infer P)[] }
  ? P extends { readonly resource: infer Res extends string; readonly action: infer Act extends string } ? `${Named<Res>}:${Named<Act>}` : never
  : never

type ValueOf<T> = T extends 'string' ? string : T extends 'number' ? number : T extends 'bool' ? boolean : T extends 'list' ? unknown[] : never

/** What a check may say about one declared resource. */
type QuestionAbout<E> = E extends { readonly resource: infer R extends string; readonly actions: readonly (infer A extends string)[] }
  ? {
      resource: R
      action: A
      attributes?: E extends { readonly attributes: infer T } ? { [K in keyof T]?: ValueOf<T[K]> } : Record<string, never>
      resourceId?: string
      ownerId?: string
    }
  : never

/**
 * What a role of a catalog that declares its resources may name: a declared
 * resource with one of its actions, or "*", or one of Cauthy's own powers.
 */
type PermissionFor<C extends readonly ResourceShape[]> = { readonly kind?: string; readonly condition?: string } & (
  | (C[number] extends infer E ? E extends { readonly resource: infer R extends string; readonly actions: readonly (infer A extends string)[] } ? { readonly resource: R; readonly action: A | '*' } : never : never)
  | { readonly resource: '*'; readonly action: string }
  | { readonly resource: `cauthy:${string}`; readonly action: string }
)
type RoleFor<C extends readonly ResourceShape[]> = Omit<RoleShape, 'permissions'> & { readonly permissions?: readonly PermissionFor<C>[] }

/** The roles a catalog names: `RoleOf<typeof policy>`. */
export type RoleOf<P> = P extends Policy<infer R, any, any> ? R : never
/** The "resource:action" permissions a catalog names: `PermissionOf<typeof policy>`. */
export type PermissionOf<P> = P extends Policy<any, infer X, any> ? X : never
/** What a check about this catalog may ask: `CheckOf<typeof policy>`. Any resource when it declares none. */
export type CheckOf<P> = P extends Policy<any, any, infer Q> ? Q : never

/** The fields of a question: whatever else the asker takes (the organization, the person) passes through. */
type QuestionKeys = keyof CheckQuestion

export interface Policy<Role extends string = string, Permission extends string = string, Question extends CheckQuestion = CheckQuestion> {
  /** The catalog as Cauthy takes it, for a server to push with `@cauthyhq/node`. */
  roles: PolicyRole[]
  /** The resources the system declares, as Cauthy takes them; empty when it declares none. */
  catalog: CatalogResource[]
  /** Every role's name. */
  roleNames: Role[]
  /** Every permission some role has, as "resource:action". */
  permissions: Permission[]
  /**
   * Whether the person may do this in the organization: `can(org, 'ledger:write')`.
   * It reads what Cauthy sent with the session, so a catalog edited in Cauthy
   * since this file was written is still what decides. A permission with a
   * condition is not there: ask with `check`.
   */
  can(organization: Permitted | null | undefined, permission: Permission): boolean
  /** Whether the person's role in the organization is one of these. */
  hasRole(organization: { role: string } | null | undefined, ...roles: Role[]): boolean
  /**
   * What a role may do by this catalog, with what it inherits: for showing a
   * role, never for deciding about a person (their exceptions are not here).
   */
  permissionsOf(role: Role): Permission[]
  /**
   * Asks Cauthy, with the resource, action and attributes typed by the
   * catalog. Give it whoever asks: the server's `auth` with the request,
   * the browser's `organizations`, or the application's `system`.
   *
   *   await policy.check(auth, request, { organization, resource: 'invoices', action: 'approve', attributes: { amount: 500 } })
   *   await policy.check(auth.system, { organizationId, userId, resource: 'invoices', action: 'read' })
   */
  check<I extends CheckQuestion>(asker: { check(input: I): Promise<CheckResult> }, input: Omit<I, QuestionKeys> & Question): Promise<CheckResult>
  check<R, I extends CheckQuestion>(asker: { check(request: R, input: I): Promise<CheckResult> }, request: R, input: Omit<I, QuestionKeys> & Question): Promise<CheckResult>
}

/** A catalog with its resources declared, for `definePolicy`. */
export interface PolicyDefinition<C extends readonly ResourceShape[], T extends readonly RoleShape[]> {
  catalog: C
  roles: T
}

/** Gives a catalog of roles its types. See the top of this section. */
export function definePolicy<const T extends readonly RoleShape[]>(roles: T): Policy<T[number]['role'], PermissionsIn<T[number]>>
/** Gives a catalog of resources and roles its types: a role names only what the catalog declares. */
export function definePolicy<const C extends readonly ResourceShape[], const T extends readonly RoleFor<C>[]>(
  definition: PolicyDefinition<C, T>,
): Policy<T[number]['role'], PermissionsIn<T[number]>, QuestionAbout<C[number]>>
export function definePolicy(given: readonly RoleShape[] | PolicyDefinition<readonly ResourceShape[], readonly RoleShape[]>): Policy {
  const roles: readonly RoleShape[] = Array.isArray(given) ? given : (given as PolicyDefinition<readonly ResourceShape[], readonly RoleShape[]>).roles
  const resources: readonly ResourceShape[] = Array.isArray(given) ? [] : (given as PolicyDefinition<readonly ResourceShape[], readonly RoleShape[]>).catalog ?? []
  const entry = (p: { resource: string; action: string }) => `${p.resource}:${p.action}`
  const byName = new Map(roles.map((r) => [r.role, r]))
  const split = (permission: string): [string, string] => {
    const i = permission.lastIndexOf(':')
    return i < 0 ? [permission, ''] : [permission.slice(0, i), permission.slice(i + 1)]
  }
  return {
    roles: roles.map((r) => ({
      role: r.role,
      ...(r.name !== undefined ? { name: r.name } : {}),
      ...(r.description !== undefined ? { description: r.description } : {}),
      ...(r.inherits ? { inherits: [...r.inherits] } : {}),
      ...(r.permissions ? { permissions: r.permissions.map((p) => ({ ...p })) } : {}),
    })),
    catalog: resources.map((c) => ({
      resource: c.resource,
      ...(c.description !== undefined ? { description: c.description } : {}),
      actions: [...c.actions],
      ...(c.attributes ? { attributes: { ...c.attributes } } : {}),
    })),
    roleNames: roles.map((r) => r.role),
    permissions: [...new Set(roles.flatMap((r) => (r.permissions ?? []).map(entry)))],
    can(organization, permission) {
      const [resource, action] = split(permission)
      return can(organization, resource, action)
    },
    hasRole(organization, ...wanted) {
      return organization != null && wanted.includes(organization.role)
    },
    permissionsOf(role) {
      const seen = new Set<string>()
      const out = new Set<string>()
      const walk = (name: string) => {
        if (seen.has(name)) return // a catalog that inherits in a circle still ends
        seen.add(name)
        const r = byName.get(name)
        for (const p of r?.permissions ?? []) out.add(entry(p))
        for (const parent of r?.inherits ?? []) walk(parent)
      }
      walk(role)
      return [...out]
    },
    // The types did the work; this only hands the question on, as a method of
    // the asker so it keeps its `this`.
    check(asker: { check(...args: unknown[]): Promise<CheckResult> }, ...args: unknown[]) {
      return asker.check(...args)
    },
  }
}
