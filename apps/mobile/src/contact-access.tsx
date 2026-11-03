import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api, send, type Member } from './api'
import { font, theme } from './theme'
import { Field, Notice, Panel } from './ui'

type Access = {
  visibility: string
  canManage: boolean
  owner: { userId: string; email: string; displayName: string } | null
  grants: { userId: string; email: string; displayName: string; role: string }[]
  groups: { groupId: string; name: string; role: string; members: { userId: string; displayName: string }[] }[]
}

type UserGroup = { id: string; name: string; members: { userId: string; displayName: string; email: string }[] }
type AuditRow = { id: string; action: string; actorName: string; createdAt: string; detail?: string | null }

const labels: Record<string, string> = {
  'contact.create': 'created this contact',
  'contact.update': 'updated this contact',
  'contact.delete': 'deleted this contact',
  'contact.access': 'changed who can see this contact',
  'contact.owner': 'changed the owner',
  'contact.grant': 'shared this contact',
  'contact.revoke': 'removed access',
  'note.create': 'added a note',
  'note.delete': 'deleted a note',
  'activity.create': 'logged an interaction',
  'activity.delete': 'deleted an interaction',
  'task.create': 'added a task',
  'task.complete': 'completed a task',
  'task.delete': 'deleted a task',
  'contact.ai_suggest': 'asked AI for field suggestions',
  'contact.ai_approve': 'approved an AI suggestion',
  'contact.ai_reject': 'dismissed an AI suggestion',
  'contact.ai_discard': 'refused an unverified AI suggestion',
  'calendar.create': 'added a calendar event',
  'calendar.delete': 'removed a calendar event',
}

export function ContactHistory({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const [history, setHistory] = useState<AuditRow[]>([])

  useEffect(() => {
    api<AuditRow[]>(`/api/workspaces/${workspaceId}/contacts/${contactId}/audit`).then(setHistory).catch(() => setHistory([]))
  }, [workspaceId, contactId])

  return (
    <Panel>
      <Text style={styles.section}>History</Text>
      {history.map((row, index) => (
        <View key={row.id} style={[styles.historyRow, index < history.length - 1 && styles.historyDivider]}>
          <Text style={styles.historyAction}>{row.actorName} {labels[row.action] ?? row.action}{row.detail ? ` · ${row.detail}` : ''}</Text>
          <Text style={styles.historyTime}>{when(row.createdAt)}</Text>
        </View>
      ))}
      {!history.length ? <Text style={styles.meta}>No activity yet.</Text> : null}
    </Panel>
  )
}

export function ContactShare({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const [access, setAccess] = useState<Access | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [groups, setGroups] = useState<UserGroup[]>([])
  const [query, setQuery] = useState('')
  const [ownerQuery, setOwnerQuery] = useState('')
  const [error, setError] = useState('')
  const aligning = useRef(false)

  function load() {
    return Promise.all([
      api<Access>(`/api/workspaces/${workspaceId}/contacts/${contactId}/access`),
      api<Member[]>(`/api/workspaces/${workspaceId}/members`),
      api<UserGroup[]>(`/api/workspaces/${workspaceId}/groups`),
    ])
      .then(([nextAccess, nextMembers, nextGroups]) => {
        setAccess(nextAccess)
        setMembers(nextMembers)
        setGroups(nextGroups)
        setError('')
      })
      .catch((caught: Error) => setError(caught.message))
  }

  useEffect(() => { void load() }, [workspaceId, contactId])

  useEffect(() => {
    if (!access?.canManage || aligning.current) return
    const shared = access.grants.length + access.groups.length > 0
    const next = shared ? 'restricted' : 'workspace'
    if (access.visibility === next) return
    aligning.current = true
    void send(`/api/workspaces/${workspaceId}/contacts/${contactId}/access`, 'PUT', { visibility: next })
      .then(load)
      .catch(() => undefined)
      .finally(() => {
        aligning.current = false
      })
  }, [access, workspaceId, contactId])

  async function run(action: () => Promise<unknown>) {
    setError('')
    try {
      await action()
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save')
    }
  }

  const grantedUsers = new Set(access?.grants.map((grant) => grant.userId) ?? [])
  const grantedGroups = new Set(access?.groups.map((group) => group.groupId) ?? [])
  const needle = query.trim().toLowerCase()
  const people = members.filter((member) => member.userId !== access?.owner?.userId && !grantedUsers.has(member.userId) && (!needle || member.displayName.toLowerCase().includes(needle) || member.email.toLowerCase().includes(needle)))
  const groupChoices = groups.filter((group) => !grantedGroups.has(group.id) && (!needle || group.name.toLowerCase().includes(needle)))
  const suggestions = needle ? [...groupChoices.map((group) => ({ kind: 'group' as const, id: group.id, label: group.name })), ...people.map((member) => ({ kind: 'user' as const, id: member.userId, label: member.displayName }))] : []
  const ownerNeedle = ownerQuery.trim().toLowerCase()
  const ownerChoices = members.filter((member) => member.userId !== access?.owner?.userId && (!ownerNeedle || member.displayName.toLowerCase().includes(ownerNeedle) || member.email.toLowerCase().includes(ownerNeedle)))

  return (
    <Panel>
      <Text style={styles.section}>Share contact</Text>
      {error ? <Notice text={error} /> : null}
      <View style={styles.owner}>
        <Avatar name={access?.owner?.displayName ?? '?'} />
        <View style={styles.ownerText}>
          <Text style={styles.ownerName}>{access?.owner?.displayName ?? 'Unassigned'}</Text>
          <Text style={styles.meta}>Owner</Text>
        </View>
      </View>
      {access?.canManage ? (
        <View style={styles.form}>
          <Field label="Change Contact Owner" value={ownerQuery} onChangeText={setOwnerQuery} placeholder="Workspace member" />
          {ownerQuery.trim() ? (
            ownerChoices.length ? (
              <View style={styles.suggestions}>
                {ownerChoices.slice(0, 6).map((member) => (
                  <Pressable
                    key={member.userId}
                    onPress={() => void run(async () => {
                      await send(`/api/workspaces/${workspaceId}/contacts/${contactId}/owner`, 'PUT', { userId: member.userId })
                      setOwnerQuery('')
                    })}
                    style={styles.suggestion}
                  >
                    <Text style={styles.body}>{member.displayName}</Text>
                    <Text style={styles.meta}>Make owner</Text>
                  </Pressable>
                ))}
              </View>
            ) : <Text style={styles.meta}>No other member matches.</Text>
          ) : null}
        </View>
      ) : null}
      <Text style={styles.meta}>
        {access && (access.grants.length || access.groups.length)
          ? 'Only the owner, workspace administrators, and the people or groups below can open this contact.'
          : 'Everyone in the workspace can open this contact. Add a person or group to limit who can open it.'}
      </Text>
      {access ? (
        <View style={styles.form}>
          {access.groups.map((group) => (
            <ShareRow
              key={group.groupId}
              name={group.name}
              role={group.role}
              members={group.members}
              onRemove={access.canManage ? () => void run(() => send(`/api/workspaces/${workspaceId}/contacts/${contactId}/groups/${group.groupId}`, 'DELETE')) : undefined}
              onRole={access.canManage ? (role) => void run(() => send(`/api/workspaces/${workspaceId}/contacts/${contactId}/grants`, 'POST', { groupId: group.groupId, role })) : undefined}
            />
          ))}
          {access.grants.map((grant) => (
            <ShareRow
              key={grant.userId}
              name={grant.displayName}
              role={grant.role}
              onRemove={access.canManage ? () => void run(() => send(`/api/workspaces/${workspaceId}/contacts/${contactId}/grants/${grant.userId}`, 'DELETE')) : undefined}
              onRole={access.canManage ? (role) => void run(() => send(`/api/workspaces/${workspaceId}/contacts/${contactId}/grants`, 'POST', { userId: grant.userId, role })) : undefined}
            />
          ))}
          {access.canManage ? (
            <>
              <Field label="Share with a person or group" value={query} onChangeText={setQuery} placeholder="Name or group" />
              {suggestions.length ? (
                <View style={styles.suggestions}>
                  {suggestions.slice(0, 8).map((item) => (
                    <Pressable
                      key={`${item.kind}-${item.id}`}
                      onPress={() => void run(async () => {
                        await send(`/api/workspaces/${workspaceId}/contacts/${contactId}/grants`, 'POST', item.kind === 'group' ? { groupId: item.id, role: 'viewer' } : { userId: item.id, role: 'viewer' })
                        setQuery('')
                      })}
                      style={styles.suggestion}
                    >
                      <Text style={styles.body}>{item.label}</Text>
                      <Text style={styles.meta}>{item.kind === 'group' ? 'Group' : 'Person'}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </Panel>
  )
}

function ShareRow({
  name,
  role,
  members,
  onRemove,
  onRole,
}: {
  name: string
  role: string
  members?: { userId: string; displayName: string }[]
  onRemove?: () => void
  onRole?: (role: 'viewer' | 'editor') => void
}) {
  return (
    <View style={styles.shareRow}>
      {onRemove ? (
        <Pressable onPress={onRemove} accessibilityLabel={`Remove ${name}`} style={styles.remove}>
          <Text style={styles.removeText}>×</Text>
        </Pressable>
      ) : null}
      <Text style={styles.body}>{name}</Text>
      {members ? <GroupInfo members={members} /> : null}
      <View style={styles.spacer} />
      <View style={styles.select}>
        <Pressable onPress={() => onRole?.('viewer')} style={[styles.option, role === 'viewer' && styles.optionOn]}>
          <Text style={[styles.optionText, role === 'viewer' && styles.optionTextOn]}>View</Text>
        </Pressable>
        <Pressable onPress={() => onRole?.('editor')} style={[styles.option, role === 'editor' && styles.optionOn]}>
          <Text style={[styles.optionText, role === 'editor' && styles.optionTextOn]}>Edit</Text>
        </Pressable>
      </View>
    </View>
  )
}

function GroupInfo({ members }: { members: { userId: string; displayName: string }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Pressable accessibilityLabel="Group members" onHoverIn={() => setOpen(true)} onHoverOut={() => setOpen(false)} style={styles.info}>
      <Text style={styles.infoMark}>i</Text>
      {open ? (
        <View style={styles.tip}>
          {members.length ? members.map((member) => <Text key={member.userId} style={styles.tipText}>{member.displayName}</Text>) : <Text style={styles.tipText}>No members yet</Text>}
        </View>
      ) : null}
    </Pressable>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  )
}

function when(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

const styles = StyleSheet.create({
  section: { fontFamily: font, fontSize: 13, color: theme.muted, marginBottom: 8, letterSpacing: 0.4 },
  body: { fontFamily: font, color: theme.text, fontSize: 15 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  form: { gap: 10, marginTop: 12 },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  ownerText: { flex: 1 },
  ownerName: { fontFamily: font, color: theme.text, fontSize: 16, fontWeight: '700' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.accentMuted, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font, color: theme.text, fontWeight: '700' },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border },
  remove: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontFamily: font, color: theme.muted, fontSize: 18, lineHeight: 20 },
  spacer: { flex: 1 },
  select: { flexDirection: 'row', borderWidth: 1, borderColor: theme.border, borderRadius: 999, overflow: 'hidden' },
  option: { paddingVertical: 6, paddingHorizontal: 10 },
  optionOn: { backgroundColor: theme.text },
  optionText: { fontFamily: font, color: theme.text, fontSize: 12 },
  optionTextOn: { color: theme.on },
  info: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  infoMark: { fontFamily: font, color: theme.muted, fontSize: 11, fontStyle: 'italic' },
  tip: { position: 'absolute', bottom: 24, left: 0, zIndex: 8, minWidth: 140, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 8, gap: 4, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8 },
  tipText: { fontFamily: font, color: theme.text, fontSize: 13 },
  suggestions: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: 'hidden' },
  suggestion: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingVertical: 10 },
  historyDivider: { borderBottomWidth: 1, borderBottomColor: theme.border },
  historyAction: { flex: 1, fontFamily: font, color: theme.text, fontSize: 14 },
  historyTime: { fontFamily: font, color: theme.muted, fontSize: 13 },
})
