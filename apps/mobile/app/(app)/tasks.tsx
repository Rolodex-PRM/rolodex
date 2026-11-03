import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { api, send, type Task } from '../../src/api'
import { useAuth } from '../../src/auth'
import { font, theme } from '../../src/theme'
import { Choice } from '../../src/people'
import { Button, Field, Notice, Panel } from '../../src/ui'

export default function TasksPage() {
  const { workspace } = useAuth()
  const canWrite = workspace?.role === 'owner' || workspace?.role === 'administrator' || workspace?.role === 'editor'
  const [rows, setRows] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [notes, setNotes] = useState('')
  const [priority, setPriority] = useState(0)
  const [repeat, setRepeat] = useState('')
  const [shared, setShared] = useState(true)
  const [error, setError] = useState('')

  function load() {
    if (!workspace) return
    api<Task[]>(`/api/workspaces/${workspace.id}/tasks`).then(setRows).catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [workspace?.id])

  const open = rows.filter((row) => !row.completedAt)
  const done = rows.filter((row) => row.completedAt)

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Tasks</Text>
      {error ? <Notice text={error} /> : null}
      {open.map((row) => {
        const overdue = row.dueAt ? new Date(row.dueAt).getTime() < Date.now() : false
        return (
          <Panel key={row.id}>
            <Text style={styles.name}>{row.title}</Text>
            <Text style={styles.meta}>
              {row.dueAt ? (overdue ? `Overdue · ${row.dueAt.slice(0, 10)}` : `Due ${row.dueAt.slice(0, 10)}`) : 'No due date'}
              {` · ${priorityLabel(row.priority)}`}
              {row.rrule ? ` · ${repeatLabel(row.rrule)}` : ''}
              {` · ${row.visibility === 'private' ? 'private' : 'shared'}`}
            </Text>
            {row.notes ? <Text style={styles.meta}>{row.notes}</Text> : null}
            {canWrite ? (
              <Button label="Complete" onPress={() => void send(`/api/workspaces/${workspace?.id}/tasks/${row.id}/complete`, 'POST', { completed: true }).then(load)} />
            ) : null}
          </Panel>
        )
      })}
      {!open.length ? <Text style={styles.meta}>Nothing open.</Text> : null}
      {done.slice(0, 6).map((row) => (
        <Text key={row.id} style={styles.meta}>Done · {row.title}</Text>
      ))}
      {canWrite && workspace ? (
        <Panel>
          <Field label="Title" value={title} onChangeText={setTitle} />
          <Field label="Due date" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" />
          <Text style={styles.meta}>Priority</Text>
          <View style={styles.chips}>
            {priorities.map((item) => (
              <Choice key={item.label} label={item.label} on={priority === item.value} onPress={() => setPriority(item.value)} />
            ))}
          </View>
          <Text style={styles.meta}>Repeats</Text>
          <View style={styles.chips}>
            {repeats.map((item) => (
              <Choice key={item.label} label={item.label} on={repeat === item.value} onPress={() => setRepeat(item.value)} />
            ))}
          </View>
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
          <Choice label={shared ? 'Shared with the workspace' : 'Private'} on={shared} onPress={() => setShared((current) => !current)} />
          <Button
            label="Add task"
            disabled={!title.trim()}
            onPress={() =>
              void send(`/api/workspaces/${workspace.id}/tasks`, 'POST', {
                title: title.trim(),
                dueAt: due || null,
                priority,
                notes,
                rrule: repeat ? `FREQ=${repeat}` : null,
                visibility: shared ? 'workspace' : 'private',
              })
                .then(() => {
                  setTitle('')
                  setDue('')
                  setNotes('')
                  setPriority(0)
                  setRepeat('')
                  load()
                })
                .catch((caught: Error) => setError(caught.message))
            }
          />
        </Panel>
      ) : null}
    </View>
  )
}

const priorities = [
  { value: 0, label: 'None' },
  { value: 1, label: 'High' },
  { value: 5, label: 'Medium' },
  { value: 9, label: 'Low' },
]

const repeats = [
  { value: '', label: 'Does not repeat' },
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
]

function priorityLabel(value: number) {
  return priorities.find((item) => item.value === value)?.label ?? 'None'
}

function repeatLabel(rule: string) {
  const freq = /FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/i.exec(rule)?.[1]?.toUpperCase() || ''
  return repeats.find((item) => item.value === freq)?.label || 'Repeats'
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  title: { fontFamily: font, fontSize: 32, fontWeight: '700', color: theme.text },
  name: { fontFamily: font, fontSize: 18, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
