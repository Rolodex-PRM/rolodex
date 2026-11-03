import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { api, send } from '../../src/api'
import { useAccent } from '../../src/accent'
import { useAuth } from '../../src/auth'
import { AuthImage } from '../../src/immich-photos'
import { font, theme } from '../../src/theme'
import { Button, DateField, Field, Panel } from '../../src/ui'

type MonthEvent = {
  date: string
  kind: string
  title: string
  contactId: string | null
  eventId?: string | null
  description?: string
  location?: string
  status?: string
  priority?: number
  rrule?: string | null
  url?: string
  allDay?: boolean
  startTime?: string | null
  endTime?: string | null
  endDate?: string | null
  readOnly?: boolean
}

type Person = { id: string; workspaceId: string; displayName: string; hasPhoto: boolean }

type Draft = {
  eventId: string | null
  date: string
  endDate: string
  allDay: boolean
  startTime: string
  endTime: string
  type: string
  summary: string
  location: string
  status: string
  priority: number
  repeat: string
  url: string
  description: string
  contactId: string | null
}

const categories = ['meeting', 'call', 'meal', 'birthday', 'anniversary', 'task', 'personal', 'reminder', 'date'] as const

const labels: Record<string, string> = {
  meeting: 'Meeting',
  call: 'Call',
  meal: 'Meal',
  birthday: 'Birthday',
  anniversary: 'Anniversary',
  task: 'Task',
  personal: 'Personal',
  reminder: 'Reminder',
  date: 'Important date',
  email: 'Email',
}

const colors: Record<string, { bg: string; text: string }> = {
  meeting: { bg: '#e8eefc', text: '#2747c4' },
  call: { bg: '#e7f6ee', text: '#1d7a45' },
  meal: { bg: '#fff4d6', text: '#8a5a00' },
  birthday: { bg: '#fde8e8', text: '#b42318' },
  anniversary: { bg: '#e7f6ee', text: '#1d7a45' },
  task: { bg: '#fff1e6', text: '#b45309' },
  personal: { bg: '#eef2ff', text: '#3730a3' },
  reminder: { bg: '#f3e8ff', text: '#7e22ce' },
  date: { bg: '#e6f7f5', text: '#0f766e' },
  email: { bg: '#f3f4f6', text: '#3f3f46' },
}

const statuses = [
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'TENTATIVE', label: 'Tentative' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

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

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'

export default function Calendar() {
  const { workspace } = useAuth()
  const { accent, onAccent } = useAccent()
  const windowWidth = useWindowDimensions().width
  const narrow = windowWidth < 880
  const today = new Date()
  const todayIso = isoDate(today)
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 })
  const [selected, setSelected] = useState(todayIso)
  const [events, setEvents] = useState<MonthEvent[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [categoryOn, setCategoryOn] = useState<Set<string>>(() => new Set(categories))
  const [contactOn, setContactOn] = useState<Set<string> | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [anchor, setAnchor] = useState({ x: 80, y: 80 })
  const [error, setError] = useState('')

  function load() {
    if (!workspace) return
    api<{ events: MonthEvent[] }>(`/api/workspaces/${workspace.id}/calendar?year=${cursor.year}&month=${cursor.month}`)
      .then((result) => setEvents(result.events))
      .catch(() => setEvents([]))
    api<{ contacts: Person[] }>(`/api/workspaces/${workspace.id}/contacts?limit=200`)
      .then((result) => setPeople(result.contacts))
      .catch(() => setPeople([]))
  }

  useEffect(load, [workspace, cursor])

  const sheetKey = draft ? `${draft.eventId || 'new'}-${draft.date}` : ''
  useEffect(() => {
    if (!narrow || !sheetKey || Platform.OS !== 'web') return
    document.getElementById('calendar-event-sheet')?.scrollIntoView({ block: 'start' })
  }, [narrow, sheetKey])

  const kinds = useMemo(() => {
    const extra = events.map((event) => event.kind).filter((kind) => !categories.includes(kind as (typeof categories)[number]))
    return [...categories, ...new Set(extra)]
  }, [events])

  function contactVisible(id: string | null) {
    if (!contactOn) return true
    return contactOn.has(id ?? 'none')
  }

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const visible = events.filter((event) => categoryOn.has(event.kind) && contactVisible(event.contactId))
  const dayEvents = visible
    .filter((event) => event.date === selected)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title))

  function personFor(id: string | null, label: string) {
    if (!id || !workspace) return undefined
    return peopleById.get(id) ?? { id, workspaceId: workspace.id, displayName: label, hasPhoto: true }
  }
  const cells = monthCells(cursor.year, cursor.month)
  const weeks: (typeof cells)[] = []
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7))
  const label = new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  function shift(by: number) {
    const next = new Date(cursor.year, cursor.month - 1 + by, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() + 1 })
  }

  function openNew(date: string, x: number, y: number) {
    setSelected(date)
    setError('')
    setAnchor(place(x, y))
    setDraft({
      eventId: null,
      date,
      endDate: date,
      allDay: true,
      startTime: '09:00',
      endTime: '10:00',
      type: 'meeting',
      summary: '',
      location: '',
      status: 'CONFIRMED',
      priority: 0,
      repeat: '',
      url: '',
      description: '',
      contactId: null,
    })
  }

  function openEdit(event: MonthEvent, x: number, y: number) {
    if (!event.eventId || event.readOnly) return
    setSelected(event.date)
    setError('')
    setAnchor(place(x, y))
    const repeat = /FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/i.exec(event.rrule || '')?.[1]?.toUpperCase() || ''
    setDraft({
      eventId: event.eventId,
      date: event.date,
      endDate: event.endDate || event.date,
      allDay: event.allDay !== false,
      startTime: event.startTime || '09:00',
      endTime: event.endTime || '10:00',
      type: event.kind,
      summary: event.title,
      location: event.location || '',
      status: event.status || 'CONFIRMED',
      priority: event.priority || 0,
      repeat,
      url: event.url || '',
      description: event.description || '',
      contactId: event.contactId,
    })
  }

  async function save() {
    if (!workspace || !draft) return
    setError('')
    const body = {
      type: draft.type,
      summary: draft.summary.trim(),
      description: draft.description,
      date: draft.date,
      endDate: draft.endDate,
      allDay: draft.allDay,
      startTime: draft.allDay ? null : draft.startTime,
      endTime: draft.allDay ? null : draft.endTime,
      location: draft.location,
      status: draft.status,
      priority: draft.priority,
      rrule: draft.repeat ? `FREQ=${draft.repeat}` : null,
      url: draft.url,
      contactId: draft.contactId,
    }
    try {
      if (draft.eventId) await send(`/api/workspaces/${workspace.id}/calendar/events/${draft.eventId}`, 'PATCH', body)
      else await send(`/api/workspaces/${workspace.id}/calendar/events`, 'POST', body)
      setDraft(null)
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the event')
    }
  }

  async function remove(eventId: string) {
    if (!workspace) return
    await send(`/api/workspaces/${workspace.id}/calendar/events/${eventId}`, 'DELETE')
    setDraft(null)
    load()
  }

  async function download() {
    if (!workspace || typeof sessionStorage === 'undefined') return
    const raw = sessionStorage.getItem('rolodex.session')
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : ''
    const response = await fetch(`${API_URL}/api/workspaces/${workspace.id}/calendar.ics?year=${cursor.year}&month=${cursor.month}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'rolodex.ics'
    link.click()
    URL.revokeObjectURL(url)
  }

  function toggleCategory(kind: string) {
    setCategoryOn((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  function toggleContact(id: string) {
    setContactOn((current) => {
      const base = current ?? new Set(['none', ...people.map((person) => person.id)])
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filters = (
    <>
      <View>
        <Text style={styles.section}>Categories</Text>
        {kinds.map((kind) => (
          <Check key={kind} on={categoryOn.has(kind)} color={(colors[kind] || colors.personal).text} label={labels[kind] || kind} onPress={() => toggleCategory(kind)} />
        ))}
      </View>
      <View>
        <Text style={styles.section}>Contacts</Text>
        <Check on={!contactOn || contactOn.has('none')} color={theme.muted} label="No contact" onPress={() => toggleContact('none')} />
        {people.map((person) => (
          <Check key={person.id} on={!contactOn || contactOn.has(person.id)} color={accent} label={person.displayName} onPress={() => toggleContact(person.id)} avatar={<ContactAvatar person={person} size={22} />} />
        ))}
      </View>
    </>
  )

  return (
    <View style={styles.page}>
      <Text style={styles.kicker}>Calendar</Text>
      <View style={styles.heading}>
        <Text style={styles.title}>Calendar</Text>
        <Button label="Download" tone="ghost" onPress={() => void download()} />
      </View>
      {narrow ? (
        <View style={styles.stack}>
          <Panel>
            <MonthBar label={label} onPrev={() => shift(-1)} onNext={() => shift(1)} />
            <View style={styles.miniWeek}>
              {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => (
                <Text key={day} style={styles.miniWeekday}>{day}</Text>
              ))}
            </View>
            <View style={styles.miniGrid}>
              {cells.map((cell) => {
                const items = visible.filter((event) => event.date === cell.date)
                const on = cell.date === selected
                return (
                  <PhoneCell
                    key={cell.date}
                    label={cell.date}
                    onPress={() => { setSelected(cell.date); if (cell.outside) setCursor(monthOf(cell.date)) }}
                    onDoubleClick={(x, y) => openNew(cell.date, x, y)}
                  >
                    <View style={[styles.miniDay, on && { backgroundColor: accent }, cell.date === todayIso && !on && styles.todayRing]}>
                      <Text style={[styles.miniDayText, cell.outside && styles.outside, on && { color: onAccent }]}>{cell.day}</Text>
                    </View>
                    <View style={styles.markRow}>
                      {items.slice(0, 3).map((event, index) => (
                        <View key={`${event.eventId || event.kind}-${event.title}`} style={index ? styles.markOverlap : undefined}>
                          {event.contactId
                            ? <ContactAvatar person={personFor(event.contactId, event.title)} size={14} />
                            : <View style={[styles.dot, { backgroundColor: (colors[event.kind] || colors.personal).text }]} />}
                        </View>
                      ))}
                    </View>
                  </PhoneCell>
                )
              })}
            </View>
          </Panel>
          <View style={styles.agendaHead}>
            <Text style={styles.agendaDate}>{dayTitle(selected)}</Text>
            <Button label="Add" onPress={() => openNew(selected, 16, 80)} />
          </View>
          {dayEvents.length === 0 ? <Text style={styles.empty}>Nothing scheduled for this day.</Text> : dayEvents.map((event) => {
            const tone = colors[event.kind] || colors.personal
            return (
              <Pressable key={`${event.eventId || event.kind}-${event.title}`} onPress={() => openEdit(event, 16, 120)} style={[styles.agenda, { borderLeftColor: tone.text }]}>
                {event.contactId
                  ? <ContactAvatar person={personFor(event.contactId, event.title)} size={36} />
                  : <View style={[styles.kindMark, { backgroundColor: tone.bg }]}><View style={[styles.dot, { backgroundColor: tone.text }]} /></View>}
                <View style={styles.agendaCopy}>
                  <Text style={styles.agendaTitle}>{event.allDay === false && event.startTime ? `${event.startTime} ` : ''}{event.title}</Text>
                  <Text style={styles.agendaMeta}>{labels[event.kind] || event.kind}</Text>
                </View>
              </Pressable>
            )
          })}
          {draft ? (
            <View nativeID="calendar-event-sheet" style={styles.sheet}>
              <EventForm draft={draft} people={people} error={error} onChange={setDraft} onSave={() => void save()} onCancel={() => setDraft(null)} onRemove={(id) => void remove(id)} />
            </View>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => setFiltersOpen((open) => !open)} style={styles.filterToggle}>
            <Text style={styles.section}>Filters</Text>
            <Text style={styles.agendaMeta}>{filtersOpen ? 'Hide' : 'Categories and contacts'}</Text>
          </Pressable>
          {filtersOpen ? filters : null}
        </View>
      ) : (
      <View style={styles.layout}>
        <View style={styles.side}>
          <Panel>
            <MonthBar label={label} onPrev={() => shift(-1)} onNext={() => shift(1)} />
            <View style={styles.miniWeek}>
              {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => (
                <Text key={day} style={styles.miniWeekday}>{day}</Text>
              ))}
            </View>
            <View style={styles.miniGrid}>
              {cells.map((cell) => {
                const on = cell.date === selected
                const marked = visible.some((event) => event.date === cell.date)
                return (
                  <Pressable key={cell.date} accessibilityLabel={cell.date} onPress={() => { setSelected(cell.date); if (cell.outside) setCursor(monthOf(cell.date)) }} style={styles.miniCell}>
                    <View style={[styles.miniDay, on && { backgroundColor: accent }]}>
                      <Text style={[styles.miniDayText, cell.outside && styles.outside, on && { color: onAccent }]}>{cell.day}</Text>
                    </View>
                    {marked ? <View style={[styles.dot, { backgroundColor: accent, marginTop: 2 }]} /> : <View style={styles.miniSpacer} />}
                  </Pressable>
                )
              })}
            </View>
          </Panel>
          {filters}
        </View>
        <View style={styles.board}>
          <View style={styles.week}>
            <Text style={styles.weekGutter} />
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <Text key={day} style={styles.weekday}>{day}</Text>
            ))}
          </View>
          {weeks.map((week) => (
            <View key={week[0]?.date} style={styles.weekRow}>
              <Text style={styles.weekNumber}>{week[0] ? isoWeek(week[0].date) : ''}</Text>
              {week.map((cell) => {
                const items = visible.filter((event) => event.date === cell.date)
                const shown = items.slice(0, 4)
                return (
                  <DayCell key={cell.date} onDoubleClick={(x, y) => openNew(cell.date, x, y)} style={[styles.cell, cell.date === todayIso && styles.todayCell]}>
                    <Text style={[styles.day, cell.outside && styles.outside, cell.date === selected && styles.dayOn]}>{cell.day}</Text>
                    {shown.map((event) => {
                      const tone = colors[event.kind] || colors.personal
                      return (
                        <EventChip
                          key={`${event.eventId || event.kind}-${event.title}-${event.date}`}
                          label={`${event.allDay === false && event.startTime ? `${event.startTime} ` : ''}${event.title}`}
                          background={tone.bg}
                          color={tone.text}
                          onOpen={(x, y) => openEdit(event, x, y)}
                          avatar={event.contactId ? <ContactAvatar person={personFor(event.contactId, event.title)} size={16} /> : undefined}
                        />
                      )
                    })}
                    {items.length > shown.length ? <Text style={styles.more}>+{items.length - shown.length}</Text> : null}
                  </DayCell>
                )
              })}
            </View>
          ))}
        </View>
      </View>
      )}
      {!narrow && draft ? (
        <>
          <Pressable accessibilityLabel="Close event" onPress={() => setDraft(null)} style={styles.backdrop} />
          <View style={[styles.popover, { top: anchor.y, left: anchor.x }]}>
            <EventForm draft={draft} people={people} error={error} onChange={setDraft} onSave={() => void save()} onCancel={() => setDraft(null)} onRemove={(id) => void remove(id)} />
          </View>
        </>
      ) : null}
    </View>
  )
}

function EventForm({
  draft,
  people,
  error,
  onChange,
  onSave,
  onCancel,
  onRemove,
}: {
  draft: Draft
  people: Person[]
  error: string
  onChange: (next: Draft) => void
  onSave: () => void
  onCancel: () => void
  onRemove: (id: string) => void
}) {
  return (
    <>
      <Text style={styles.popoverTitle}>{draft.eventId ? 'Edit event' : 'New event'}</Text>
      <Field label="Title" value={draft.summary} onChangeText={(summary) => onChange({ ...draft, summary })} />
      <Text style={styles.fieldLabel}>Category</Text>
      <View style={styles.chips}>
        {categories.filter((kind) => kind !== 'date').map((kind) => (
          <Pressable key={kind} onPress={() => onChange({ ...draft, type: kind })} style={[styles.chip, draft.type === kind && { backgroundColor: (colors[kind] || colors.personal).bg }]}>
            <Text style={[styles.chipText, draft.type === kind && { color: (colors[kind] || colors.personal).text }]}>{labels[kind]}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => onChange({ ...draft, allDay: !draft.allDay })} style={styles.check}>
        <View style={[styles.box, draft.allDay && styles.boxOn]}>{draft.allDay ? <Text style={styles.mark}>✓</Text> : null}</View>
        <Text style={styles.checkLabel}>All day</Text>
      </Pressable>
      <DateField label="Starts" value={draft.date} onChange={(date) => onChange({ ...draft, date, endDate: draft.endDate < date ? date : draft.endDate })} />
      {draft.allDay ? null : <Field label="Start time" value={draft.startTime} onChangeText={(startTime) => onChange({ ...draft, startTime })} placeholder="09:00" />}
      <DateField label="Ends" value={draft.endDate} onChange={(endDate) => onChange({ ...draft, endDate })} />
      {draft.allDay ? null : <Field label="End time" value={draft.endTime} onChangeText={(endTime) => onChange({ ...draft, endTime })} placeholder="10:00" />}
      <Text style={styles.fieldLabel}>Repeats</Text>
      <View style={styles.chips}>
        {repeats.map((item) => (
          <Pressable key={item.label} onPress={() => onChange({ ...draft, repeat: item.value })} style={[styles.chip, draft.repeat === item.value && styles.chipOn]}>
            <Text style={[styles.chipText, draft.repeat === item.value && styles.chipTextOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.fieldLabel}>Status</Text>
      <View style={styles.chips}>
        {statuses.map((item) => (
          <Pressable key={item.value} onPress={() => onChange({ ...draft, status: item.value })} style={[styles.chip, draft.status === item.value && styles.chipOn]}>
            <Text style={[styles.chipText, draft.status === item.value && styles.chipTextOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.fieldLabel}>Priority</Text>
      <View style={styles.chips}>
        {priorities.map((item) => (
          <Pressable key={item.label} onPress={() => onChange({ ...draft, priority: item.value })} style={[styles.chip, draft.priority === item.value && styles.chipOn]}>
            <Text style={[styles.chipText, draft.priority === item.value && styles.chipTextOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="Location" value={draft.location} onChangeText={(location) => onChange({ ...draft, location })} />
      <Text style={styles.fieldLabel}>Contact</Text>
      <View style={styles.chips}>
        <Pressable onPress={() => onChange({ ...draft, contactId: null })} style={[styles.chip, !draft.contactId && styles.chipOn]}>
          <Text style={[styles.chipText, !draft.contactId && styles.chipTextOn]}>None</Text>
        </Pressable>
        {people.map((person) => (
          <Pressable key={person.id} onPress={() => onChange({ ...draft, contactId: person.id })} style={[styles.chip, styles.chipPerson, draft.contactId === person.id && styles.chipOn]}>
            <ContactAvatar person={person} size={18} />
            <Text style={[styles.chipText, draft.contactId === person.id && styles.chipTextOn]}>{person.displayName}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="URL" value={draft.url} onChangeText={(url) => onChange({ ...draft, url })} placeholder="https://" />
      <Field label="Notes" value={draft.description} onChangeText={(description) => onChange({ ...draft, description })} multiline />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.popoverActions}>
        <Button label="Save" onPress={onSave} />
        <Button label="Cancel" tone="ghost" onPress={onCancel} />
        {draft.eventId ? <Button label="Remove" tone="danger" onPress={() => onRemove(draft.eventId || '')} /> : null}
      </View>
    </>
  )
}

function ContactAvatar({ person, size }: { person?: Person; size: number }) {
  const letter = (person?.displayName || '?').slice(0, 1).toUpperCase()
  const fallback = (
    <View style={[styles.letterAvatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.letter, { fontSize: Math.max(9, Math.round(size * 0.45)) }]}>{letter}</Text>
    </View>
  )
  if (!person?.hasPhoto || !person.workspaceId) return fallback
  return <AuthImage path={`/api/workspaces/${person.workspaceId}/contacts/${person.id}/photo`} size={size} radius={size / 2} fallback={fallback} />
}

function Check({ on, color, label, onPress, avatar }: { on: boolean; color: string; label: string; onPress: () => void; avatar?: ReactNode }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={onPress} style={styles.check}>
      <View style={[styles.box, on && styles.boxOn]}>{on ? <Text style={styles.mark}>✓</Text> : null}</View>
      {avatar ?? <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text style={styles.checkLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

function MonthBar({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <View style={styles.monthBar}>
      <Pressable accessibilityLabel="Previous month" onPress={onPrev} style={styles.arrow}>
        <Text style={styles.arrowText}>‹</Text>
      </Pressable>
      <Text style={styles.month}>{label}</Text>
      <Pressable accessibilityLabel="Next month" onPress={onNext} style={styles.arrow}>
        <Text style={styles.arrowText}>›</Text>
      </Pressable>
    </View>
  )
}

function PhoneCell({ label, onPress, onDoubleClick, children }: { label: string; onPress: () => void; onDoubleClick: (x: number, y: number) => void; children: ReactNode }) {
  if (Platform.OS === 'web') {
    return (
      <div
        role="button"
        aria-label={label}
        onClick={onPress}
        onDoubleClick={(event) => onDoubleClick(event.clientX, event.clientY)}
        style={{ width: '14.28%', maxWidth: '14.28%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4, paddingBottom: 4, cursor: 'pointer' }}
      >
        {children}
      </div>
    )
  }
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} onLongPress={() => onDoubleClick(0, 80)} style={styles.phoneCell}>
      {children}
    </Pressable>
  )
}

function DayCell({ onDoubleClick, style, children }: { onDoubleClick: (x: number, y: number) => void; style?: object; children: ReactNode }) {
  if (Platform.OS === 'web') {
    return (
      <div onDoubleClick={(event) => onDoubleClick(event.clientX, event.clientY)} style={StyleSheet.flatten(style) as never}>
        {children}
      </div>
    )
  }
  return <View style={style as never}>{children}</View>
}

function EventChip({ label, background, color, onOpen, avatar }: { label: string; background: string; color: string; onOpen: (x: number, y: number) => void; avatar?: ReactNode }) {
  if (Platform.OS === 'web') {
    return (
      <div
        onClick={(event) => {
          event.stopPropagation()
          onOpen(event.clientX, event.clientY)
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', gap: 4, background, color, borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '2px 6px', marginTop: 3, overflow: 'hidden', cursor: 'pointer', minWidth: 0 }}
      >
        {avatar}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{label}</span>
      </div>
    )
  }
  return (
    <Pressable onPress={() => onOpen(0, 80)} style={[styles.eventChip, { backgroundColor: background }]}>
      {avatar}
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

function place(x: number, y: number) {
  if (typeof window === 'undefined') return { x: 24, y: 80 }
  const left = Math.max(16, Math.min(x, window.innerWidth - 400))
  const top = y > window.innerHeight * 0.5 ? 64 : Math.max(16, y)
  return { x: left, y: top }
}

function monthOf(value: string) {
  const [year, month] = value.split('-').map(Number)
  return { year: year || 2026, month: month || 1 }
}

function dayTitle(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year || 2026, (month || 1) - 1, day || 1).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function monthCells(year: number, month: number) {
  const first = new Date(year, month - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const count = new Date(year, month, 0).getDate()
  const cells: { date: string; day: number; outside: boolean }[] = []
  for (let index = lead; index > 0; index -= 1) {
    const date = new Date(year, month - 1, 1 - index)
    cells.push({ date: isoDate(date), day: date.getDate(), outside: true })
  }
  for (let day = 1; day <= count; day += 1) cells.push({ date: isoDate(new Date(year, month - 1, day)), day, outside: false })
  let extra = 1
  while (cells.length % 7) {
    const date = new Date(year, month, extra)
    cells.push({ date: isoDate(date), day: date.getDate(), outside: true })
    extra += 1
  }
  return cells
}

function isoWeek(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year || 2026, (month || 1) - 1, day || 1))
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - start.getTime()) / 86400000 + 1) / 7)
}

const styles = StyleSheet.create({
  page: { gap: 8 },
  kicker: { fontFamily: font, color: theme.muted, fontSize: 13 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { fontFamily: font, fontSize: 34, fontWeight: '700', color: theme.text },
  layout: { flexDirection: 'row', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' },
  stack: { gap: 14, width: '100%' },
  side: { width: 250, gap: 16 },
  board: { flex: 1, minWidth: 680, borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.surface },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  month: { fontFamily: font, color: theme.text, fontWeight: '700', fontSize: 16 },
  arrow: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontFamily: font, color: theme.text, fontSize: 22 },
  miniWeek: { flexDirection: 'row' },
  miniWeekday: { flex: 1, textAlign: 'center', fontFamily: font, color: theme.muted, fontSize: 11, marginBottom: 4 },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  miniCell: { width: '14.28%', alignItems: 'center', paddingVertical: 3 },
  miniDay: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  miniDayText: { fontFamily: font, color: theme.text, fontSize: 13 },
  miniSpacer: { width: 8, height: 8, marginTop: 2 },
  phoneCell: { width: '14.28%', alignItems: 'center', paddingVertical: 4 },
  todayRing: { borderWidth: 1, borderColor: theme.text },
  markRow: { flexDirection: 'row', height: 16, marginTop: 2, alignItems: 'center', justifyContent: 'center' },
  markOverlap: { marginLeft: -6 },
  agendaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  agendaDate: { fontFamily: font, fontSize: 18, fontWeight: '700', color: theme.text, flex: 1 },
  agenda: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderLeftWidth: 4, borderRadius: 12, padding: 12 },
  agendaCopy: { flex: 1, gap: 2 },
  agendaTitle: { fontFamily: font, fontSize: 15, fontWeight: '700', color: theme.text },
  agendaMeta: { fontFamily: font, fontSize: 12, color: theme.muted },
  empty: { fontFamily: font, color: theme.muted, fontSize: 14 },
  filterToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheet: { backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16 },
  letterAvatar: { backgroundColor: theme.accentMuted, alignItems: 'center', justifyContent: 'center' },
  letter: { fontFamily: font, fontWeight: '700', color: theme.text },
  kindMark: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  eventChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 3 },
  section: { fontFamily: font, color: theme.text, fontWeight: '700', fontSize: 14, marginBottom: 8 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  box: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface },
  boxOn: { backgroundColor: theme.text, borderColor: theme.text },
  mark: { color: theme.on, fontSize: 11, fontFamily: font, lineHeight: 14 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  checkLabel: { fontFamily: font, color: theme.text, fontSize: 14, flex: 1 },
  week: { flexDirection: 'row', backgroundColor: theme.surface },
  weekGutter: { width: 36 },
  weekday: { flex: 1, fontFamily: font, color: theme.muted, fontSize: 13, paddingVertical: 8, paddingHorizontal: 8 },
  weekRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.border },
  weekNumber: { width: 36, fontFamily: font, color: theme.muted, fontSize: 12, paddingTop: 8, textAlign: 'center' },
  cell: { flex: 1, minHeight: 112, borderLeftWidth: 1, borderLeftColor: theme.border, padding: 6 },
  todayCell: { backgroundColor: theme.hover },
  day: { fontFamily: font, color: theme.text, fontSize: 13, fontWeight: '600' },
  dayOn: { fontWeight: '700' },
  outside: { color: theme.muted },
  more: { fontFamily: font, color: theme.muted, fontSize: 11, marginTop: 2 },
  backdrop: { position: 'fixed' as 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 30 },
  popover: {
    position: 'fixed' as 'absolute',
    zIndex: 31,
    width: 360,
    maxHeight: '76%' as unknown as number,
    overflow: 'auto' as 'scroll',
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    boxShadow: theme.shadow,
  },
  popoverTitle: { fontFamily: font, fontSize: 18, fontWeight: '700', color: theme.text, marginBottom: 8 },
  fieldLabel: { fontFamily: font, color: theme.muted, fontSize: 12, marginBottom: 6, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: theme.surface },
  chipPerson: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipOn: { backgroundColor: theme.text, borderColor: theme.text },
  chipText: { fontFamily: font, color: theme.text, fontSize: 12 },
  chipTextOn: { color: theme.on },
  popoverActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  error: { fontFamily: font, color: theme.danger, marginTop: 6 },
})
