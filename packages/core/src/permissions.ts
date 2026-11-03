import type { ContactGrantRole, WorkspaceRole } from '@rolodex/db'

const rank: Record<WorkspaceRole, number> = {
  viewer: 0,
  contributor: 1,
  editor: 2,
  administrator: 3,
  owner: 4,
}

export function roleAtLeast(role: WorkspaceRole, minimum: WorkspaceRole) {
  return rank[role] >= rank[minimum]
}

export function canWriteContacts(role: WorkspaceRole) {
  return roleAtLeast(role, 'editor')
}

export function canManageMembers(role: WorkspaceRole) {
  return roleAtLeast(role, 'administrator')
}

export function decideContactAccess(input: {
  visibility: string
  ownerId: string | null
  userId: string
  workspaceRole: WorkspaceRole | null
  grant: ContactGrantRole | null
  bookRole: WorkspaceRole | null
}) {
  const manage =
    input.ownerId === input.userId || input.workspaceRole === 'owner' || input.workspaceRole === 'administrator'
  if (input.visibility === 'restricted') {
    return {
      read: manage || input.grant != null,
      write: manage || input.grant === 'editor',
      manage,
    }
  }
  const read = input.workspaceRole != null || input.bookRole != null
  const write =
    (input.workspaceRole != null && canWriteContacts(input.workspaceRole)) ||
    (input.bookRole != null && canWriteContacts(input.bookRole))
  return { read, write, manage }
}
