import { describe, expect, it } from 'vitest'
import { can, definePolicy } from './permissions'

describe('what a person may do in an organization', () => {
  it('is allowed by an entry and denied by none', () => {
    const org = { permissions: ['deals:read', 'deals:write', 'invoicing:*'], denied: ['deals:write'] }
    expect(can(org, 'deals', 'read')).toBe(true)
    expect(can(org, 'deals', 'write')).toBe(false)
    expect(can(org, 'invoicing', 'send')).toBe(true)
    expect(can(org, 'users', 'read')).toBe(false)
  })

  it('answers no where the system keeps no catalog, and for nobody', () => {
    expect(can({}, 'deals', 'read')).toBe(false)
    expect(can(null, 'deals', 'read')).toBe(false)
  })

  it('types a catalog of roles and answers by it', () => {
    const policy = definePolicy([
      { role: 'owner', permissions: [{ resource: 'deals', action: '*' }] },
      { role: 'member', inherits: ['viewer'], permissions: [{ resource: 'deals', action: 'write' }] },
      { role: 'viewer', permissions: [{ resource: 'deals', action: 'read' }] },
    ])
    expect(policy.roleNames).toEqual(['owner', 'member', 'viewer'])
    expect(policy.permissionsOf('member').sort()).toEqual(['deals:read', 'deals:write'])
    expect(policy.can({ permissions: ['deals:write'] }, 'deals:write')).toBe(true)
    expect(policy.hasRole({ role: 'viewer' }, 'owner', 'viewer')).toBe(true)
  })
})
