import { Fragment } from 'react'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  api,
  send,
  type CustomField,
  type OrgMembership,
  type Relationship,
  type RelationshipType,
  type Task,
} from './api'
import { cadenceLabel } from './cadence'
import { font, theme } from './theme'
import { Button, Field, Notice, Panel } from './ui'
import { IndustryField } from './fields'
import { OrgLogo } from './org-logo'
import { Choice, PersonPicker } from './people'

export function ProfileCrm({
  workspaceId,
  contactId,
  canWrite,
  birthday,
  followUpFrequency,
  lastInteractionAt,
  editorsOnly = false,
}: {
  workspaceId: string
  contactId: string
  canWrite: boolean
  birthday: string | null
  followUpFrequency: string | null
  lastInteractionAt: string | null
  editorsOnly?: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [links, setLinks] = useState<Relationship[]>([])
  const [relationTypes, setRelationTypes] = useState<RelationshipType[]>([])
  const [orgs, setOrgs] = useState<OrgMembership[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [fields, setFields] = useState<CustomField[]>([])
  const [allOrgs, setAllOrgs] = useState<{ id: string; name: string }[]>([])
  const [relationKey, setRelationKey] = useState('')
  const [person, setPerson] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskShared, setTaskShared] = useState(true)
  const [taskDue, setTaskDue] = useState('')
  const [orgId, setOrgId] = useState('')
  const [orgTitle, setOrgTitle] = useState('')
  const [newOrg, setNewOrg] = useState('')
  const [newOrgIndustry, setNewOrgIndustry] = useState('')
  const [newOrgWebsite, setNewOrgWebsite] = useState('')
  const [fieldLabel, setFieldLabel] = useState('')
  const [fieldType, setFieldType] = useState<'text' | 'number' | 'date' | 'boolean'>('text')
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  function load() {
    const base = `/api/workspaces/${workspaceId}`
    Promise.all([
      api<Relationship[]>(`${base}/contacts/${contactId}/relationships`),
      api<RelationshipType[]>(`${base}/relationship-types`),
      api<OrgMembership[]>(`${base}/contacts/${contactId}/organizations`),
      api<Task[]>(`${base}/tasks?contactId=${contactId}`),
      api<CustomField[]>(`${base}/contacts/${contactId}/fields`),
      api<{ id: string; name: string }[]>(`${base}/organizations`),
    ])
      .then(([nextLinks, nextTypes, nextOrgs, nextTasks, nextFields, orgsList]) => {
        setLinks(nextLinks)
        setRelationTypes(nextTypes)
        setOrgs(nextOrgs)
        setTasks(nextTasks)
        setFields(nextFields)
        setAllOrgs(orgsList)
        setDrafts(Object.fromEntries(nextFields.map((field) => [field.id, field.value == null ? '' : String(field.value)])))
        setError('')
      })
      .catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [workspaceId, contactId])

  async function run(action: () => Promise<unknown>) {
    setError('')
    try {
      await action()
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save')
    }
  }

  const sides = relationTypes.flatMap((type) => {
    const options: { key: string; typeId: string; side: 'label' | 'reciprocal'; word: string }[] = [
      { key: `${type.id}:label`, typeId: type.id, side: 'label', word: type.label },
    ]
    if (type.label.toLowerCase() !== type.reciprocalLabel.toLowerCase()) {
      options.push({ key: `${type.id}:reciprocal`, typeId: type.id, side: 'reciprocal', word: type.reciprocalLabel })
    }
    return options
  })
  const chosen = sides.find((side) => side.key === relationKey) ?? sides[0]
  const cadence = cadenceLabel(followUpFrequency)
  const latest = lastInteractionAt
  const daysSince = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000) : null
  const due = Boolean(cadence && followUpFrequency && (daysSince === null || daysSince >= Number(followUpFrequency)))

  return (
    <View style={styles.stack}>
      {error ? <Notice text={error} /> : null}
      {editorsOnly ? null : <Panel>
        <Text style={styles.section}>Stay in touch</Text>
        {cadence ? (
          <Text style={[styles.body, due && styles.due]}>
            {cadence}.{daysSince === null ? ' No interaction logged yet.' : daysSince === 0 ? ' Last interaction was today.' : ` Last interaction was ${daysSince} days ago.`}
          </Text>
        ) : (
          <Text style={styles.meta}>No cadence yet. Set one when you edit this contact.</Text>
        )}
      </Panel>}
      {editorsOnly ? <Fragment>
      <Panel>
        <Text style={styles.section}>Relationships</Text>
        {links.map((link) => (
          <View key={link.id} style={styles.row}>
            <Pressable onPress={() => router.push(`/contacts/${link.contactId}`)}>
              <Text style={styles.link}>is the {link.type} of {link.displayName}{link.inferred ? ' · suggested' : ''}</Text>
            </Pressable>
            {canWrite ? <Button label="Remove" tone="ghost" onPress={() => void run(() => send(`/api/workspaces/${workspaceId}/relationships/${link.id}`, 'DELETE'))} /> : null}
          </View>
        ))}
        {!links.length ? <Text style={styles.meta}>No relationships yet.</Text> : null}
        {canWrite ? (
          <View style={styles.form}>
            <Text style={styles.meta}>This person is the</Text>
            <View style={styles.chips}>
              {sides.map((side) => (
                <Choice key={side.key} label={side.word} on={chosen?.key === side.key} onPress={() => setRelationKey(side.key)} />
              ))}
            </View>
            {!sides.length ? <Text style={styles.meta}>Define relationship pairs in Admin first.</Text> : null}
            <PersonPicker workspaceId={workspaceId} exclude={contactId} selected={person ? [person] : []} onToggle={(id) => setPerson(id === person ? '' : id)} />
            <Button
              label="Link person"
              disabled={!person || !chosen}
              onPress={() => void run(async () => {
                if (!chosen) return
                await send(`/api/workspaces/${workspaceId}/contacts/${contactId}/relationships`, 'POST', { toContactId: person, typeId: chosen.typeId, side: chosen.side })
                setPerson('')
              })}
            />
          </View>
        ) : null}
      </Panel>
      <Panel>
        <Text style={styles.section}>Organizations</Text>
        {orgs.map((org) => (
          <View key={org.id} style={styles.identity}>
            <OrgLogo uri={org.logoUrl} />
            <Text style={styles.body}>{org.name}{[org.title, org.department].filter(Boolean).length ? ` · ${[org.title, org.department].filter(Boolean).join(', ')}` : ''}</Text>
          </View>
        ))}
        {!orgs.length ? <Text style={styles.meta}>No organization records. The company on the card stays the vCard organization.</Text> : null}
        {canWrite ? (
          <View style={styles.form}>
            <View style={styles.chips}>
              {allOrgs.map((org) => (
                <Choice key={org.id} label={org.name} on={orgId === org.id} onPress={() => setOrgId(org.id)} />
              ))}
            </View>
            <Field label="Title" value={orgTitle} onChangeText={setOrgTitle} />
            <Button
              label="Add to organization"
              disabled={!orgId}
              onPress={() => void run(() => send(`/api/workspaces/${workspaceId}/organizations/${orgId}/members`, 'POST', { contactId, title: orgTitle || null }))}
            />
            <Field label="New organization" value={newOrg} onChangeText={setNewOrg} />
            <IndustryField value={newOrgIndustry} onChange={setNewOrgIndustry} />
            <Field label="Website" autoCapitalize="none" value={newOrgWebsite} onChangeText={setNewOrgWebsite} placeholder="https://example.com" />
            <Button
              label="Create organization"
              disabled={!newOrg.trim()}
              onPress={() => void run(async () => {
                const created = await send<{ id: string }>(`/api/workspaces/${workspaceId}/organizations`, 'POST', { name: newOrg.trim(), industry: newOrgIndustry || null, website: newOrgWebsite || null })
                await send(`/api/workspaces/${workspaceId}/organizations/${created.id}/members`, 'POST', { contactId, title: orgTitle || null })
                setNewOrg('')
                setNewOrgIndustry('')
                setNewOrgWebsite('')
              })}
            />
          </View>
        ) : null}
      </Panel>
      </Fragment> : null}
      {editorsOnly ? null : <Fragment>
      <Panel>
        <Text style={styles.section}>Tasks</Text>
        {tasks.filter((task) => !task.completedAt).map((task) => (
          <View key={task.id} style={styles.row}>
            <Text style={styles.body}>{task.title}{task.dueAt ? ` · ${task.dueAt.slice(0, 10)}` : ''} · {task.visibility === 'private' ? 'private' : 'shared'}</Text>
            {canWrite ? <Button label="Done" tone="ghost" onPress={() => void run(() => send(`/api/workspaces/${workspaceId}/tasks/${task.id}/complete`, 'POST', { completed: true }))} /> : null}
          </View>
        ))}
        {canWrite ? (
          <View style={styles.form}>
            <Field label="Task" value={taskTitle} onChangeText={setTaskTitle} />
            <Field label="Due date" value={taskDue} onChangeText={setTaskDue} placeholder="YYYY-MM-DD" />
            <Choice label={taskShared ? 'Shared with the workspace' : 'Private'} on={taskShared} onPress={() => setTaskShared((current) => !current)} />
            <Button
              label="Add task"
              disabled={!taskTitle.trim()}
              onPress={() => void run(async () => {
                await send(`/api/workspaces/${workspaceId}/tasks`, 'POST', { title: taskTitle.trim(), dueAt: taskDue || null, contactId, visibility: taskShared ? 'workspace' : 'private' })
                setTaskTitle('')
                setTaskDue('')
              })}
            />
            {birthday ? (
              <Button
                label="Remind me about this birthday"
                tone="ghost"
                onPress={() => void run(() => send(`/api/workspaces/${workspaceId}/reminders`, 'POST', { type: 'birthday', remindAt: nextDate(birthday), contactId }))}
              />
            ) : null}
          </View>
        ) : null}
      </Panel>
      <Panel>
        <Text style={styles.section}>Custom fields</Text>
        {fields.map((field) => (
          <View key={field.id} style={styles.form}>
            <Field label={field.label} value={drafts[field.id] ?? ''} onChangeText={(value) => setDrafts((current) => ({ ...current, [field.id]: value }))} />
            {canWrite ? (
              <Button
                label="Save"
                tone="ghost"
                onPress={() => void run(() => send(`/api/workspaces/${workspaceId}/contacts/${contactId}/fields/${field.id}`, 'PUT', { value: castField(field.fieldType, drafts[field.id] ?? '') }))}
              />
            ) : null}
          </View>
        ))}
        {canWrite ? (
          <View style={styles.form}>
            <Field label="New field" value={fieldLabel} onChangeText={setFieldLabel} />
            <View style={styles.chips}>
              {(['text', 'number', 'date', 'boolean'] as const).map((item) => (
                <Choice key={item} label={item} on={fieldType === item} onPress={() => setFieldType(item)} />
              ))}
            </View>
            <Button
              label="Define field"
              disabled={!fieldLabel.trim()}
              onPress={() => void run(async () => {
                await send(`/api/workspaces/${workspaceId}/fields`, 'POST', { label: fieldLabel.trim(), fieldType })
                setFieldLabel('')
              })}
            />
          </View>
        ) : null}
      </Panel>
      </Fragment>}
    </View>
  )
}

function castField(type: string, value: string) {
  if (!value.trim()) return null
  if (type === 'number') return Number(value)
  if (type === 'boolean') return /^(1|true|yes)$/i.test(value.trim())
  return value.trim()
}

function nextDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return new Date().toISOString()
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const target = new Date()
  target.setHours(9, 0, 0, 0)
  target.setMonth(month, day)
  if (target.getTime() < Date.now()) target.setFullYear(target.getFullYear() + 1)
  return target.toISOString()
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  section: { fontFamily: font, fontSize: 13, color: theme.muted, marginBottom: 8, letterSpacing: 0.4 },
  body: { fontFamily: font, color: theme.text, fontSize: 15 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  due: { color: theme.text, fontWeight: '700' },
  link: { fontFamily: font, color: theme.text, fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  block: { gap: 2, marginBottom: 10 },
  form: { gap: 10, marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
