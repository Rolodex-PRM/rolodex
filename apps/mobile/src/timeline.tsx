import { useRouter } from 'expo-router'
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { api, apiUrl, send, type Activity, type ContactSummary, type ImmichGallery, type InteractionFile, type Note } from './api'
import { AuthImage } from './immich-photos'
import { Choice, MentionField, mentionParts } from './people'
import { font, theme } from './theme'
import { Button, DateField, Notice } from './ui'

const kinds = ['note', 'call', 'email', 'meeting', 'meal'] as const
type Kind = (typeof kinds)[number]

let activeDictation: SpeechEngine | null = null

function dictate(listening: boolean, setListening: (value: boolean) => void, text: string, setText: (value: string) => void, setError: (value: string) => void) {
  const host = window as unknown as { SpeechRecognition?: new () => SpeechEngine; webkitSpeechRecognition?: new () => SpeechEngine }
  const Engine = host.SpeechRecognition || host.webkitSpeechRecognition
  if (!Engine) {
    setError('This browser cannot take dictation.')
    return
  }
  if (listening) {
    activeDictation?.stop()
    activeDictation = null
    setListening(false)
    return
  }
  activeDictation?.stop()
  const engine = new Engine()
  engine.lang = 'en-US'
  engine.onresult = (event) => {
    const said = [...Array(event.results.length)].map((_, index) => event.results[index]?.[0]?.transcript ?? '').join(' ')
    setText(`${text} ${said}`.trim())
    setListening(false)
  }
  engine.onerror = () => setListening(false)
  engine.onend = () => {
    if (activeDictation === engine) activeDictation = null
    setListening(false)
  }
  activeDictation = engine
  setListening(true)
  engine.start()
}

type SpeechEngine = {
  lang: string
  start: () => void
  stop: () => void
  onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void
  onerror: () => void
  onend: () => void
}
type Filter = 'all' | Kind

type Person = { id: string; name: string }
type Entry = {
  id: string
  source: 'note' | 'activity'
  kind: string
  at: string
  body: string
  visibility: string
  people: Person[]
  files: InteractionFile[]
}

export function Timeline({
  workspaceId,
  contactId,
  canWrite,
  about,
  title,
  attachments,
}: {
  workspaceId: string
  contactId?: string
  canWrite: boolean
  about?: ReactNode
  title?: string
  attachments?: Array<{ activityId: string; assetId: string }>
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'timeline' | 'about'>('timeline')
  const [filter, setFilter] = useState<Filter>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [events, setEvents] = useState<Activity[]>([])
  const [people, setPeople] = useState<ContactSummary[]>([])
  const [photos, setPhotos] = useState(attachments ?? [])
  const [text, setText] = useState('')
  const [mentioned, setMentioned] = useState<string[]>([])
  const [kind, setKind] = useState<Kind>('note')
  const [shared, setShared] = useState(true)
  const [remindOn, setRemindOn] = useState(false)
  const [remind, setRemind] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [listening, setListening] = useState(false)
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')

  function load() {
    const notesPath = contactId
      ? `/api/workspaces/${workspaceId}/contacts/${contactId}/notes`
      : `/api/workspaces/${workspaceId}/notes`
    const eventsPath = `/api/workspaces/${workspaceId}/activities${contactId ? `?contactId=${contactId}` : ''}`
    Promise.all([
      api<Note[]>(notesPath),
      api<Activity[]>(eventsPath),
      api<{ contacts: ContactSummary[] }>(`/api/workspaces/${workspaceId}/contacts?limit=200`),
    ])
      .then(([nextNotes, nextEvents, directory]) => {
        setNotes(nextNotes)
        setEvents(nextEvents)
        setPeople(directory.contacts)
        setError('')
      })
      .catch((caught: Error) => setError(caught.message))
    if (contactId) {
      api<ImmichGallery>(`/api/workspaces/${workspaceId}/contacts/${contactId}/immich`)
        .then((gallery) => setPhotos(gallery.enabled ? gallery.attachments : []))
        .catch(() => setPhotos([]))
    }
  }

  useEffect(load, [workspaceId, contactId])
  useEffect(() => {
    if (attachments?.length) setPhotos(attachments)
  }, [attachments])

  async function publish() {
    const body = text.trim()
    if (!body) return
    const ids = [...new Set([...(contactId ? [contactId] : []), ...mentioned])]
    if (!ids.length) {
      setError('Mention someone so this has a person to stay with.')
      return
    }
    if (remindOn && remind && !/^(\d{4}|--)?\d{2}-\d{2}$/.test(remind)) {
      setError('Use a YYYY-MM-DD or --MM-DD date for the reminder.')
      return
    }
    const primary = contactId ?? ids[0]!
    const visibility = shared ? 'workspace' : 'private'
    setError('')
    try {
      let target: { kind: 'notes' | 'activities'; id: string }
      if (kind === 'note') {
        const note = await send<{ id: string }>(`/api/workspaces/${workspaceId}/notes`, 'POST', { body, contactId: primary, visibility })
        target = { kind: 'notes', id: note.id }
        const extras = ids.filter((id) => id !== primary)
        if (shared && extras.length) {
          await send(`/api/workspaces/${workspaceId}/activities`, 'POST', {
            type: 'note',
            occurredAt: new Date().toISOString(),
            description: body,
            contactIds: ids,
            visibility,
          })
        }
      } else {
        const activity = await send<{ id: string }>(`/api/workspaces/${workspaceId}/activities`, 'POST', {
          type: kind,
          occurredAt: new Date().toISOString(),
          description: body,
          contactIds: ids,
          visibility,
        })
        target = { kind: 'activities', id: activity.id }
      }
      for (const file of pendingFiles) {
        const form = new FormData()
        form.append('file', file)
        await api(`/api/workspaces/${workspaceId}/${target.kind}/${target.id}/files`, { method: 'POST', body: form })
      }
      if (remindOn && remind) {
        await send(`/api/workspaces/${workspaceId}/reminders`, 'POST', {
          type: 'follow-up',
          remindAt: new Date(`${remind}T09:00:00`).toISOString(),
          contactId: primary,
        })
      }
      setText('')
      setMentioned([])
      setRemind('')
      setRemindOn(false)
      setPendingFiles([])
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save')
    }
  }

  const entries = merge(notes, events).filter((entry) => filter === 'all' || entry.kind === filter)
  const blocks = group(entries)

  return (
    <View style={styles.stack}>
      <View style={styles.bar}>
        {about ? (
          <View style={styles.tabs}>
            <Pressable onPress={() => setTab('timeline')} style={[styles.tab, tab === 'timeline' && styles.tabOn]}>
              <Text style={[styles.tabText, tab === 'timeline' && styles.tabTextOn]}>Timeline</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setTab('about')} style={[styles.tab, tab === 'about' && styles.tabOn]}>
              <Text style={[styles.tabText, tab === 'about' && styles.tabTextOn]}>About</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.title}>{title ?? 'Interactions'}</Text>
        )}
        {tab === 'timeline' || !about ? (
          <Pressable onPress={() => setFiltersOpen((open) => !open)} style={styles.filterButton}>
            <Text style={styles.filterLabel}>{filter === 'all' ? 'Filter' : filter}</Text>
          </Pressable>
        ) : <View />}
      </View>
      {about && tab === 'about' ? about : (
        <View style={styles.stack}>
          {error ? <Notice text={error} /> : null}
          {filtersOpen ? (
            <View style={styles.filters}>
              <Choice label="All" on={filter === 'all'} onPress={() => setFilter('all')} />
              {kinds.map((item) => (
                <Choice key={item} label={item[0]!.toUpperCase() + item.slice(1)} on={filter === item} onPress={() => setFilter(item)} />
              ))}
            </View>
          ) : null}
          {canWrite ? (
            <View style={styles.composer}>
              <MentionField
                plain
                workspaceId={workspaceId}
                value={text}
                placeholder="Add a note, set a reminder, mention people..."
                onChange={(next, ids) => {
                  setText(next)
                  setMentioned(ids.filter((id) => id !== contactId))
                }}
              />
              {remindOn ? <DateField label="Remind on" value={remind} onChange={setRemind} /> : null}
              {pendingFiles.length ? (
                <View style={styles.extra}>
                  {pendingFiles.map((file) => (
                    <Pressable key={file.name} onPress={() => setPendingFiles((current) => current.filter((item) => item !== file))}>
                      <Text style={styles.meta}>{file.name} ×</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.composerBar}>
                {Platform.OS === 'web' ? (
                  <Pressable accessibilityLabel="Speak a note" onPress={() => dictate(listening, setListening, text, setText, setError)} style={[styles.clock, listening && styles.clockOn]}>
                    <Text style={styles.clockText}>{listening ? 'Stop' : 'Speak'}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityLabel="Set a reminder" onPress={() => setRemindOn((on) => !on)} style={[styles.clock, remindOn && styles.clockOn]}>
                  <Text style={styles.clockText}>◷</Text>
                </Pressable>
                {Platform.OS === 'web' ? createElement('label', { style: { cursor: 'pointer' } }, createElement('input', {
                  type: 'file',
                  multiple: true,
                  style: { display: 'none' },
                  onChange: (event: { target: { files?: FileList | null; value: string } }) => {
                    const next = [...(event.target.files ?? [])]
                    if (next.length) setPendingFiles((current) => [...current, ...next])
                    event.target.value = ''
                  },
                }), createElement('span', { style: { fontFamily: font, fontSize: 13, color: 'var(--rx-muted)' } }, 'Attach')) : null}
                <View style={styles.kinds}>
                  {kinds.map((item) => (
                    <Pressable key={item} onPress={() => setKind(item)}>
                      <Text style={[styles.kind, kind === item && styles.kindOn]}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable accessibilityLabel={shared ? 'Shared with the workspace' : 'Private to you'} onPress={() => setShared((current) => !current)}>
                  <Text style={[styles.kind, styles.kindOn]}>{shared ? 'Shared' : 'Private'}</Text>
                </Pressable>
                <Button label="Add" disabled={!text.trim()} onPress={() => void publish()} />
              </View>
            </View>
          ) : null}
          {!entries.length ? <Text style={styles.meta}>Nothing here yet.</Text> : null}
          {blocks.map((block) => {
            if (block.type === 'group') {
              const shut = closed[block.key]
              return (
                <View key={block.key} style={styles.group}>
                  <Pressable onPress={() => setClosed((current) => ({ ...current, [block.key]: !current[block.key] }))}>
                    <Text style={styles.groupLabel}>{block.entries.length} {plural(block.kind)}</Text>
                  </Pressable>
                  {shut ? null : block.entries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} people={people} photos={photos} workspaceId={workspaceId} canWrite={canWrite} onOpen={(id) => router.push(`/contacts/${id}`)} onDelete={() => void remove(workspaceId, entry).then(load).catch((caught: Error) => setError(caught.message))} onChange={() => load()} />
                  ))}
                </View>
              )
            }
            return (
              <EntryRow key={block.entry.id} entry={block.entry} people={people} photos={photos} workspaceId={workspaceId} canWrite={canWrite} onOpen={(id) => router.push(`/contacts/${id}`)} onDelete={() => void remove(workspaceId, block.entry).then(load).catch((caught: Error) => setError(caught.message))} onChange={() => load()} />
            )
          })}
        </View>
      )}
    </View>
  )
}

function EntryRow({
  entry,
  people,
  photos,
  workspaceId,
  canWrite,
  onOpen,
  onDelete,
  onChange,
}: {
  entry: Entry
  people: ContactSummary[]
  photos: Array<{ activityId: string; assetId: string }>
  workspaceId: string
  canWrite: boolean
  onOpen: (id: string) => void
  onDelete: () => void
  onChange: () => void
}) {
  const parts = mentionParts(entry.body, people)
  const named = new Set(parts.flatMap((part) => (part.id ? [part.id] : [])))
  const extra = entry.people.filter((person) => !named.has(person.id))
  const shots = entry.source === 'activity' ? photos.filter((item) => item.activityId === entry.id) : []
  return (
    <View style={styles.item}>
      <View style={styles.mark}><Text style={styles.markText}>{mark(entry.kind)}</Text></View>
      <View style={styles.itemBody}>
        <View style={styles.itemHead}>
          <Text style={styles.action}>{action(entry.kind)}{entry.visibility === 'private' ? ' · private' : ''}</Text>
          <Text style={styles.when}>{relative(entry.at)}</Text>
          {canWrite ? <Pressable onPress={onDelete}><Text style={styles.delete}>Delete</Text></Pressable> : null}
        </View>
        {entry.body ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>
              {parts.map((part, index) => part.id ? (
                <Text key={`${part.id}-${index}`} style={styles.mention} onPress={() => onOpen(part.id!)}>{part.text}</Text>
              ) : (
                <Text key={`text-${index}`}>{part.text}</Text>
              ))}
            </Text>
            {extra.length ? (
              <View style={styles.extra}>
                {extra.map((person) => (
                  <Pressable key={person.id} onPress={() => onOpen(person.id)}>
                    <Text style={styles.mention}>@{person.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {shots.length ? (
              <View style={styles.extra}>
                {shots.map((item) => (
                  <AuthImage key={item.assetId} path={`/api/workspaces/${workspaceId}/immich/assets/${item.assetId}/thumbnail`} size={72} />
                ))}
              </View>
            ) : null}
            {entry.files.length ? (
              <View style={styles.extra}>
                {entry.files.map((file) => file.contentType.startsWith('image/') ? (
                  <View key={file.id} style={styles.file}>
                    <AuthImage path={`/api/workspaces/${workspaceId}/files/${file.id}`} size={72} />
                    {canWrite ? <Pressable onPress={() => void send(`/api/workspaces/${workspaceId}/files/${file.id}`, 'DELETE').then(onChange)}><Text style={styles.delete}>Remove</Text></Pressable> : null}
                  </View>
                ) : (
                  <Pressable key={file.id} onPress={() => void openFile(workspaceId, file)}>
                    <Text style={styles.mention}>{file.filename}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {canWrite && Platform.OS === 'web' ? createElement('label', { style: { cursor: 'pointer' } }, createElement('input', {
              type: 'file',
              multiple: true,
              style: { display: 'none' },
              onChange: (event: { target: { files?: FileList | null; value: string } }) => {
                const next = [...(event.target.files ?? [])]
                event.target.value = ''
                void uploadFiles(workspaceId, entry, next).then(onChange)
              },
            }), createElement('span', { style: { fontFamily: font, fontSize: 12, color: 'var(--rx-muted)' } }, 'Add file')) : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}

function merge(notes: Note[], events: Activity[]) {
  const entries: Entry[] = notes.map((note) => ({
    id: note.id,
    source: 'note',
    kind: 'note',
    at: note.createdAt,
    body: note.body,
    visibility: note.visibility,
    people: note.contactId ? [{ id: note.contactId, name: note.contactName ?? '' }] : [],
    files: note.files ?? [],
  }))
  for (const event of events) {
    const twin = event.type === 'note'
      ? entries.find((entry) => entry.source === 'note' && entry.body.trim() === (event.description ?? '').trim() && Math.abs(new Date(entry.at).getTime() - new Date(event.occurredAt).getTime()) < 120_000)
      : undefined
    if (twin) {
      for (const person of event.people) {
        if (!twin.people.some((item) => item.id === person.contactId)) twin.people.push({ id: person.contactId, name: person.displayName })
      }
      for (const file of event.files ?? []) {
        if (!twin.files.some((item) => item.id === file.id)) twin.files.push(file)
      }
      continue
    }
    entries.push({
      id: event.id,
      source: 'activity',
      kind: event.type,
      at: event.occurredAt,
      body: event.description ?? '',
      visibility: event.visibility,
      people: event.people.map((person) => ({ id: person.contactId, name: person.displayName })),
      files: event.files ?? [],
    })
  }
  return entries.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
}

function group(entries: Entry[]) {
  const blocks: Array<{ type: 'single'; entry: Entry } | { type: 'group'; key: string; kind: string; entries: Entry[] }> = []
  let index = 0
  while (index < entries.length) {
    const kind = entries[index]!.kind
    let end = index + 1
    while (end < entries.length && entries[end]!.kind === kind) end += 1
    const run = entries.slice(index, end)
    if (run.length >= 3 && index > 0) blocks.push({ type: 'group', key: `group-${run[0]!.id}`, kind, entries: run })
    else run.forEach((entry) => blocks.push({ type: 'single', entry }))
    index = end
  }
  return blocks
}

function uploadFiles(workspaceId: string, entry: Entry, files: File[]) {
  const path = entry.source === 'note' ? 'notes' : 'activities'
  return Promise.all(files.map((file) => {
    const form = new FormData()
    form.append('file', file)
    return api(`/api/workspaces/${workspaceId}/${path}/${entry.id}/files`, { method: 'POST', body: form })
  }))
}

async function openFile(workspaceId: string, file: InteractionFile) {
  const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/files/${file.id}`, {
    headers: authHeader(),
    credentials: 'include',
  })
  if (!response.ok) return
  const url = URL.createObjectURL(await response.blob())
  window.open(url, '_blank', 'noopener')
}

function authHeader() {
  if (typeof sessionStorage === 'undefined') return undefined
  const raw = sessionStorage.getItem('rolodex.session')
  const parsed = raw ? (JSON.parse(raw) as { token?: string }) : null
  return parsed?.token ? { Authorization: `Bearer ${parsed.token}` } : undefined
}

function remove(workspaceId: string, entry: Entry) {
  const path = entry.source === 'note' ? 'notes' : 'activities'
  return send(`/api/workspaces/${workspaceId}/${path}/${entry.id}`, 'DELETE')
}

function action(kind: string) {
  if (kind === 'note') return 'You added a note'
  if (kind === 'call') return 'You logged a call'
  if (kind === 'meeting') return 'You logged a meeting'
  if (kind === 'meal') return 'You logged a meal'
  return `You logged a ${kind}`
}

function mark(kind: string) {
  if (kind === 'call') return 'C'
  if (kind === 'meeting') return 'M'
  if (kind === 'meal') return 'F'
  return 'N'
}

function plural(kind: string) {
  if (kind === 'note') return 'NOTES'
  return `${kind.toUpperCase()}S`
}

function relative(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d`
  return new Date(iso).toLocaleDateString()
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  bar: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: theme.border },
  tabs: { flexDirection: 'row', gap: 18 },
  tab: { paddingBottom: 10 },
  tabOn: { borderBottomWidth: 2, borderBottomColor: theme.text, marginBottom: -1 },
  tabText: { fontFamily: font, fontSize: 16, color: theme.muted, fontWeight: '600' },
  tabTextOn: { color: theme.text },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text, paddingBottom: 8 },
  filterButton: { paddingBottom: 10, paddingHorizontal: 4 },
  filterLabel: { fontFamily: font, fontSize: 12, letterSpacing: 1, color: theme.muted, fontWeight: '700', textTransform: 'uppercase' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  composer: { borderWidth: 1, borderColor: theme.border, borderRadius: 16, backgroundColor: theme.surface, padding: 14, gap: 8 },
  composerBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  clock: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  clockOn: { backgroundColor: theme.bg },
  clockText: { fontFamily: font, fontSize: 18, color: theme.muted },
  kinds: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kind: { fontFamily: font, fontSize: 13, color: theme.muted, textTransform: 'capitalize' },
  kindOn: { color: theme.text, fontWeight: '700' },
  meta: { fontFamily: font, color: theme.muted, fontSize: 14 },
  group: { gap: 12 },
  groupLabel: { fontFamily: font, fontSize: 12, letterSpacing: 0.8, color: theme.muted, fontWeight: '700' },
  item: { flexDirection: 'row', gap: 12 },
  mark: { width: 28, height: 28, borderRadius: 8, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  markText: { fontFamily: font, fontSize: 12, fontWeight: '700', color: theme.muted },
  itemBody: { flex: 1, gap: 8 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  action: { fontFamily: font, fontSize: 14, fontWeight: '700', color: theme.text, flex: 1 },
  when: { fontFamily: font, fontSize: 13, color: theme.muted },
  delete: { fontFamily: font, fontSize: 12, color: theme.muted },
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  cardText: { fontFamily: font, fontSize: 15, lineHeight: 22, color: theme.text },
  mention: { fontFamily: font, fontSize: 15, lineHeight: 22, color: '#2563eb', fontWeight: '600' },
  extra: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  file: { gap: 4 },
})
