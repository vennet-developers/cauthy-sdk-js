// @cauthyhq/js: the browser client of the Cauthy auth-bff protocol, version 1.
// No framework, no runtime dependency, no token: every call goes to the
// application's own server under `basePath`.

export * from './client'
export { createSessionStore, type SessionState, type SessionStore, type SessionStoreOptions } from './store'
export { createSignInFlow, stepAfter, type FlowState, type FlowStep, type SignInFlow } from './flow'
export { ceremonyError, getPasskey, makePasskey } from './passkey'
export { loadGoogleIdentity, promptGoogleOneTap, type GoogleIdentity, type OneTapPrompt } from './one-tap'
export { CauthyError, errorFrom, isAuthError, PROTOCOL_ERROR_CODES, UNAVAILABLE, unwrap, type ProtocolErrorCode } from './errors'
export { nextOf, PROTOCOL_HEADER, PROTOCOL_VERSION, REQUEST_HEADER, SIGN_IN_PATHS, type NextStep, type ProtocolMismatch } from './protocol'
export { PREFIX, PROTOCOL, ROUTES, type GetRouteId, type PostRouteId, type RouteBodies, type RouteId, type RouteInfo, type RouteQueries } from './generated/routes'
export { checkOrganization, checkOrganizationName, firstProblem, MAX_ORGANIZATION } from './validate'
export { can, definePolicy, type AttributeType, type CatalogResource, type CheckOf, type Permitted, type PermissionOf, type Policy, type PolicyDefinition, type PolicyPermission, type PolicyRole, type RoleOf } from './permissions'
export type { ConditionalPermission, JsonValue, PublicSession, SessionOrganization, SessionUser } from './types'
