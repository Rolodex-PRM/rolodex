import { describe, expect, it } from 'vitest'
import { decideContactAccess } from './permissions'

const user = '11111111-1111-1111-1111-111111111111'

describe('contact access', () => {
  it('lets workspace members read a shared contact', () => {
    const access = decideContactAccess({
      visibility: 'workspace',
      ownerId: 'other',
      userId: user,
      workspaceRole: 'viewer',
      grant: null,
      bookRole: null,
    })
    expect(access.read).toBe(true)
    expect(access.write).toBe(false)
  })

  it('hides a restricted contact from someone without a grant', () => {
    const access = decideContactAccess({
      visibility: 'restricted',
      ownerId: 'other',
      userId: user,
      workspaceRole: 'editor',
      grant: null,
      bookRole: 'editor',
    })
    expect(access.read).toBe(false)
    expect(access.write).toBe(false)
  })

  it('lets an editor grant change a restricted contact', () => {
    const access = decideContactAccess({
      visibility: 'restricted',
      ownerId: 'other',
      userId: user,
      workspaceRole: 'viewer',
      grant: 'editor',
      bookRole: null,
    })
    expect(access.read).toBe(true)
    expect(access.write).toBe(true)
    expect(access.manage).toBe(false)
  })

  it('lets the owner manage access', () => {
    const access = decideContactAccess({
      visibility: 'restricted',
      ownerId: user,
      userId: user,
      workspaceRole: 'editor',
      grant: null,
      bookRole: null,
    })
    expect(access).toEqual({ read: true, write: true, manage: true })
  })

  it('lets a workspace administrator open a restricted contact', () => {
    const access = decideContactAccess({
      visibility: 'restricted',
      ownerId: 'other',
      userId: user,
      workspaceRole: 'administrator',
      grant: null,
      bookRole: null,
    })
    expect(access.manage).toBe(true)
    expect(access.read).toBe(true)
  })
})
