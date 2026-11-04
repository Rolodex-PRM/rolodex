import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ChoiceRow, SwitchRow } from '../../../src/admin-fields'
import { api, send, type Member, type WorkspaceGroup } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { font, theme } from '../../../src/theme'
import { Button, Field, Notice } from '../../../src/ui'

const roles = [
  { id: 'administrator', label: 'Admin' },
  { id: 'editor', label: 'Editor' },
  { id: 'contributor', label: 'Contributor' },
  { id: 'viewer', label: 'Viewer' },
]

const access = [
  { id: 'viewer', label: 'View' },
  { id: 'editor', label: 'Edit' },
]

export default function UsersPage() {
  const { workspace } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [groups, setGroups] = useState<WorkspaceGroup[]>([])
  const [inviteOnly, setInviteOnly] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [role, setRole] = useState('editor')
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('editor')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupAccess, setGroupAccess] = useState<'viewer' | 'editor'>('viewer')
  const [newGroup, setNewGroup] = useState('')
  const [newAccess, setNewAccess] = useState<'viewer' | 'editor'>('viewer')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (!workspace) return
    Promise.all([
      api<Member[]>(`/api/workspaces/${workspace.id}/members`),
      api<WorkspaceGroup[]>(`/api/workspaces/${workspace.id}/groups`),
      api<{ inviteOnly: boolean }>(`/api/workspaces/${workspace.id}/registration`),
    ])
      .then(([people, listed, policy]) => {
        setMembers(people)
        setGroups(listed)
        setInviteOnly(policy.inviteOnly)
      })
      .catch((caught: Error) => setError(caught.message))
  }, [workspace])

  useEffect(() => {
    load()
  }, [load])

  async function run(action: () => Promise<unknown>, done: string) {
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(done)
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save that')
    }
  }

  const editingGroup = groups.find((group) => group.id === groupId) ?? null

  return (
    <View style={styles.page}>
      <Text style={styles.heading}>Users</Text>
      <Text style={styles.meta}>Owner runs the workspace, including backups. Admin manages users, invitations, and server settings. Editor adds and changes people. Contributor and Viewer can look and cannot change people.</Text>
      {error ? <Notice text={error} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <SwitchRow
        label="Require an invitation to register"
        detail="When this is on, the sign-in page does not offer Create an account. The same switch is under Security."
        on={inviteOnly}
        onPress={() => {
          if (!workspace) return
          const next = !inviteOnly
          setInviteOnly(next)
          void run(() => send(`/api/workspaces/${workspace.id}/registration`, 'PUT', { inviteOnly: next }), next ? 'Registration now requires an invitation' : 'Open registration is on')
        }}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
      <View style={styles.table}>
        <View style={[styles.tr, styles.head]}>
          <Text style={[styles.th, styles.name]}>Name</Text>
          <Text style={[styles.th, styles.email]}>Email</Text>
          <Text style={[styles.th, styles.role]}>Role</Text>
          <Text style={[styles.th, styles.count]}>Contacts</Text>
          <Text style={[styles.th, styles.reset]}>Reset password</Text>
          <Text style={[styles.th, styles.actions]}>Actions</Text>
        </View>
        {members.map((member) => (
          <View key={member.userId} style={styles.tr}>
            <Text style={[styles.td, styles.name]}>{member.displayName}</Text>
            <Text style={[styles.td, styles.email]}>{member.email}</Text>
            <View style={styles.role}>
              {editing === member.userId ? (
                <ChoiceRow label="" options={roles} value={role} onChange={setRole} />
              ) : (
                <Text style={styles.td}>{labelFor(member.role)}</Text>
              )}
            </View>
            <Text style={[styles.td, styles.count]}>{member.contactCount ?? 0}</Text>
            <View style={styles.reset}>
              <TextButton
                label="Send link"
                onPress={() => {
                  if (!workspace) return
                  void run(() => send(`/api/workspaces/${workspace.id}/members/${member.userId}/reset`, 'POST'), 'Password reset email sent')
                }}
              />
            </View>
            <View style={styles.actions}>
              {editing === member.userId ? (
                <>
                  <TextButton
                    label="Save"
                    onPress={() => {
                      if (!workspace) return
                      void run(async () => {
                        await send(`/api/workspaces/${workspace.id}/members/${member.userId}`, 'PATCH', { role })
                        setEditing(null)
                      }, 'Role updated')
                    }}
                  />
                  <TextButton label="Cancel" onPress={() => setEditing(null)} />
                </>
              ) : (
                <TextButton
                  label="Edit"
                  onPress={() => {
                    setEditing(member.userId)
                    setRole(roles.some((item) => item.id === member.role) ? member.role : 'editor')
                  }}
                />
              )}
              <TextButton
                label="Delete"
                danger
                onPress={() => {
                  if (!workspace) return
                  void run(() => send(`/api/workspaces/${workspace.id}/members/${member.userId}`, 'DELETE'), 'User removed from this workspace')
                }}
              />
            </View>
          </View>
        ))}
      </View>
      </ScrollView>
      <View style={styles.form}>
        <Text style={styles.sub}>Add a user</Text>
        <Text style={styles.meta}>This person must already have a Rolodex account. Use Invite for someone new.</Text>
        <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={addEmail} onChangeText={setAddEmail} placeholder="Existing account" />
        <ChoiceRow label="Role" options={roles} value={addRole} onChange={setAddRole} />
        <Button
          label="Add user"
          onPress={() => {
            if (!workspace || !addEmail.trim()) return
            void run(async () => {
              await send(`/api/workspaces/${workspace.id}/members`, 'POST', { email: addEmail.trim(), role: addRole })
              setAddEmail('')
            }, 'User added')
          }}
        />
      </View>
      <View style={styles.form}>
        <Text style={styles.sub}>Invite a new user</Text>
        <Text style={styles.meta}>Sends an email with a link to register. Turn on email in Notifications first.</Text>
        <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={inviteEmail} onChangeText={setInviteEmail} placeholder="name@email.com" />
        <ChoiceRow label="Role" options={roles} value={inviteRole} onChange={setInviteRole} />
        <Button
          label="Send invitation"
          onPress={() => {
            if (!workspace || !inviteEmail.trim()) return
            void run(async () => {
              await send(`/api/workspaces/${workspace.id}/invites`, 'POST', { email: inviteEmail.trim(), role: inviteRole })
              setInviteEmail('')
            }, 'Invitation sent')
          }}
        />
      </View>
      <Text style={styles.heading}>User groups</Text>
      <Text style={styles.meta}>A group lets you share one person with several accounts at once. View can see that person. Edit can change them.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
      <View style={styles.table}>
        <View style={[styles.tr, styles.head]}>
          <Text style={[styles.th, styles.grow]}>Group</Text>
          <Text style={[styles.th, styles.access]}>Min access</Text>
          <Text style={[styles.th, styles.actions]}>Actions</Text>
        </View>
        {groups.length ? groups.map((group) => (
          <View key={group.id} style={styles.tr}>
            <Text style={[styles.td, styles.grow]}>{group.name}</Text>
            <Text style={[styles.td, styles.access]}>{group.minRole === 'editor' ? 'Edit' : 'View'}</Text>
            <View style={styles.actions}>
              <TextButton
                label="Edit group"
                onPress={() => {
                  setGroupId(group.id)
                  setGroupName(group.name)
                  setGroupAccess(group.minRole === 'editor' ? 'editor' : 'viewer')
                }}
              />
              <TextButton
                label="Delete group"
                danger
                onPress={() => {
                  if (!workspace) return
                  void run(async () => {
                    await send(`/api/workspaces/${workspace.id}/groups/${group.id}`, 'DELETE')
                    if (groupId === group.id) setGroupId(null)
                  }, 'Group deleted')
                }}
              />
            </View>
          </View>
        )) : <Text style={styles.empty}>No groups yet.</Text>}
      </View>
      </ScrollView>
      {editingGroup ? (
        <View style={styles.form}>
          <Text style={styles.sub}>Edit {editingGroup.name}</Text>
          <Field label="Name" value={groupName} onChangeText={setGroupName} />
          <ChoiceRow label="Min access" options={access} value={groupAccess} onChange={(id) => setGroupAccess(id === 'editor' ? 'editor' : 'viewer')} />
          <Button
            label="Save group"
            onPress={() => {
              if (!workspace) return
              void run(() => send(`/api/workspaces/${workspace.id}/groups/${editingGroup.id}`, 'PATCH', { name: groupName.trim(), minRole: groupAccess }), 'Group updated')
            }}
          />
          <Text style={styles.meta}>Members</Text>
          {editingGroup.members.length ? editingGroup.members.map((member) => (
            <View key={member.userId} style={styles.memberLine}>
              <Text style={styles.td}>{member.displayName}</Text>
              <TextButton
                label="Remove"
                onPress={() => {
                  if (!workspace) return
                  void run(() => send(`/api/workspaces/${workspace.id}/groups/${editingGroup.id}/members/${member.userId}`, 'DELETE'), 'Removed from the group')
                }}
              />
            </View>
          )) : <Text style={styles.meta}>Nobody in this group yet.</Text>}
          <View style={styles.chips}>
            {members.filter((member) => !editingGroup.members.some((item) => item.userId === member.userId)).map((member) => (
              <Pressable
                key={member.userId}
                onPress={() => {
                  if (!workspace) return
                  void run(() => send(`/api/workspaces/${workspace.id}/groups/${editingGroup.id}/members`, 'POST', { userId: member.userId }), `${member.displayName} added`)
                }}
                style={styles.chip}
              >
                <Text style={styles.chipText}>Add {member.displayName}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.form}>
        <Text style={styles.sub}>New group</Text>
        <Field label="Name" value={newGroup} onChangeText={setNewGroup} />
        <ChoiceRow label="Min access" options={access} value={newAccess} onChange={(id) => setNewAccess(id === 'editor' ? 'editor' : 'viewer')} />
        <Button
          label="Create group"
          onPress={() => {
            if (!workspace || !newGroup.trim()) return
            void run(async () => {
              await send(`/api/workspaces/${workspace.id}/groups`, 'POST', { name: newGroup.trim(), minRole: newAccess })
              setNewGroup('')
            }, 'Group created')
          }}
        />
      </View>
    </View>
  )
}

function labelFor(role: string) {
  return roles.find((item) => item.id === role)?.label ?? role
}

function TextButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={styles.textButton}>
      <Text style={[styles.textButtonLabel, danger && styles.danger]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { gap: 16, width: '100%', maxWidth: '100%', minWidth: 0 },
  tableScroll: { width: '100%', maxWidth: '100%', alignSelf: 'stretch' },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  sub: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  notice: { fontFamily: font, color: theme.text, fontSize: 14 },
  table: { borderWidth: 1, borderColor: theme.border, borderRadius: 16, backgroundColor: theme.surface, overflow: 'hidden', minWidth: 760 },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.border },
  head: { borderTopWidth: 0, backgroundColor: theme.raised },
  th: { fontFamily: font, color: theme.muted, fontSize: 12, fontWeight: '700' },
  td: { fontFamily: font, color: theme.text, fontSize: 14 },
  name: { width: 140 },
  email: { flex: 1, minWidth: 140 },
  role: { width: 150 },
  count: { width: 72 },
  reset: { width: 110 },
  actions: { width: 170, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1 },
  access: { width: 100 },
  empty: { fontFamily: font, color: theme.muted, padding: 12 },
  form: { gap: 10, padding: 14, borderWidth: 1, borderColor: theme.border, borderRadius: 16, backgroundColor: theme.surface },
  memberLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 },
  chipText: { fontFamily: font, color: theme.text, fontSize: 13 },
  textButton: { paddingVertical: 4 },
  textButtonLabel: { fontFamily: font, color: theme.text, fontSize: 13, fontWeight: '700' },
  danger: { color: theme.danger },
})
