// 0.42's option and data types assign to ours, and our client assigns to
// what 0.42 code expects: moving from `cauthy-auth/client` is an import change.
import type * as Old from 'cauthy-auth/client'
import type * as New from '../src/index'

export const options: New.AuthClientOptions = {} as Old.AuthClientOptions
export const storeOptions: New.SessionStoreOptions = {} as Old.SessionStoreOptions
export const methods: New.AuthMethods = {} as Old.AuthMethods
export const client: Old.AuthClient = {} as New.AuthClient
export const store: Old.SessionStore = {} as New.SessionStore
export const error: New.AuthError = {} as Old.AuthError
export const seat: Old.OrganizationSeat = {} as New.OrganizationSeat
