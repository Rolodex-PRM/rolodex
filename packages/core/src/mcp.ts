import type { Database } from '@rolodex/db'
import { addonEnabled } from './addons'
import { authenticateAppPassword, type PublicUser, userForSession } from './auth'
import { getContact, listContacts } from './contacts'
import { listActivities, listNotes, listRelationships, listTasks } from './crm'
import { AppError } from './errors'
import { personNetwork, searchNetworkGraph } from './network-graph'
import { listWorkspaces } from './workspaces'

export async function authenticateMcpAuth(db: Database, authorization: string | undefined): Promise<PublicUser | null> {
  if (!authorization) return null
  const [scheme, ...rest] = authorization.trim().split(/\s+/)
  const credential = rest.join(' ').trim()
  if (!scheme || !credential) return null
  if (scheme.toLowerCase() === 'bearer') return userForSession(db, credential)
  if (scheme.toLowerCase() !== 'basic') return null
  const decoded = Buffer.from(credential, 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  if (colon <= 0) return null
  return authenticateAppPassword(db, decoded.slice(0, colon), decoded.slice(colon + 1))
}

export async function resolveMcpWorkspace(db: Database, userId: string, workspaceId?: string) {
  const workspaces = await listWorkspaces(db, userId)
  if (!workspaces.length) throw new AppError(404, 'No workspace available')
  const workspace = workspaceId ? workspaces.find((row) => row.id === workspaceId) : workspaces[0]
  if (!workspace) throw new AppError(404, 'Workspace not found')
  if (!(await addonEnabled(db, workspace.id, 'mcp'))) {
    throw new AppError(403, 'Enable the MCP Server add-on in Admin → Add-ons')
  }
  return workspace
}

export async function mcpListWorkspaces(db: Database, userId: string) {
  const workspaces = await listWorkspaces(db, userId)
  const rows = []
  for (const workspace of workspaces) {
    rows.push({
      id: workspace.id,
      name: workspace.name,
      role: workspace.role,
      mcpEnabled: await addonEnabled(db, workspace.id, 'mcp'),
    })
  }
  return rows
}

export async function mcpSearchContacts(db: Database, userId: string, input: { workspaceId?: string; q?: string; limit?: number }) {
  const workspace = await resolveMcpWorkspace(db, userId, input.workspaceId)
  return listContacts(db, userId, workspace.id, { q: input.q, limit: input.limit ?? 25 })
}

export async function mcpGetContact(db: Database, userId: string, input: { workspaceId?: string; contactId: string }) {
  const workspace = await resolveMcpWorkspace(db, userId, input.workspaceId)
  return getContact(db, userId, workspace.id, input.contactId)
}

export async function mcpListRelationships(db: Database, userId: string, input: { workspaceId?: string; contactId: string }) {
  const workspace = await resolveMcpWorkspace(db, userId, input.workspaceId)
  return listRelationships(db, userId, workspace.id, input.contactId)
}

export async function mcpListInteractions(db: Database, userId: string, input: { workspaceId?: string; contactId?: string }) {
  const workspace = await resolveMcpWorkspace(db, userId, input.workspaceId)
  return listActivities(db, userId, workspace.id, input.contactId)
}

export async function mcpListNotes(db: Database, userId: string, input: { workspaceId?: string; contactId: string }) {
  const workspace = await resolveMcpWorkspace(db, userId, input.workspaceId)
  return listNotes(db, userId, workspace.id, input.contactId)
}

export async function mcpListTasks(db: Database, userId: string, input: { workspaceId?: string; contactId?: string }) {
  const workspace = await resolveMcpWorkspace(db, userId, input.workspaceId)
  return listTasks(db, userId, workspace.id, input.contactId)
}

export async function mcpContactNetwork(db: Database, userId: string, input: { workspaceId?: string; contactId: string }) {
  const workspace = await resolveMcpWorkspace(db, userId, input.workspaceId)
  return personNetwork(db, userId, workspace.id, input.contactId)
}

export async function mcpSearchNetwork(db: Database, userId: string, input: { workspaceId?: string; q: string }) {
  const workspace = await resolveMcpWorkspace(db, userId, input.workspaceId)
  return searchNetworkGraph(db, userId, workspace.id, input.q)
}
