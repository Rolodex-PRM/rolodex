import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { EnrichedText, useApprovedFields } from './ai-enrich'
import { AddressMap } from './address-map'
import { api, send, type Contact, type OrgMembership } from './api'
import { useAccent } from './accent'
import { Icon } from './icons'
import { socialHref, socialTitle, SocialIcon } from './socials'
import { font, theme } from './theme'
import { DateField, Panel } from './ui'

type ImportantDate = { id: string; label: string; occursOn: string }

export function ContactOverview({ workspaceId, contact }: { workspaceId: string; contact: Contact }) {
  const [orgs, setOrgs] = useState<OrgMembership[]>([])
  const [dates, setDates] = useState<ImportantDate[]>([])
  const enriched = useApprovedFields(workspaceId, contact.id)

  useEffect(() => {
    api<OrgMembership[]>(`/api/workspaces/${workspaceId}/contacts/${contact.id}/organizations`).then(setOrgs).catch(() => setOrgs([]))
    api<ImportantDate[]>(`/api/workspaces/${workspaceId}/contacts/${contact.id}/dates`).then(setDates).catch(() => setDates([]))
  }, [workspaceId, contact.id])

  const phones = contact.methods.filter((method) => method.kind === 'phone')
  const emails = contact.methods.filter((method) => method.kind === 'email')
  const socials = contact.methods.filter((method) => method.kind === 'social')
  const occupation = [contact.title, contact.position].filter(Boolean).join(' · ')
  const organizations = [
    ...(contact.organizationName && !orgs.some((org) => org.name === contact.organizationName)
      ? [{ id: 'card', name: contact.organizationName, logoUrl: null as string | null }]
      : []),
    ...orgs.map((org) => ({ id: org.id, name: [org.name, org.title].filter(Boolean).join(' · '), logoUrl: org.logoUrl })),
  ]
  const located = contact.addresses.find((address) => address.lat != null && address.lon != null)

  return (
    <Panel>
      <Text style={styles.section}>Overview</Text>
      {contact.userRelationship ? (
        <Category icon="contacts" title="Your relationship" empty={false}>
          <Text style={styles.value}>{contact.userRelationship}</Text>
        </Category>
      ) : null}
      <Category icon="phone" title="Phone numbers" empty={!phones.length}>
        {phones.map((method) => (
          <Text key={method.id} style={styles.value} onPress={() => void Linking.openURL(`tel:${method.value}`)}>
            {method.label ? `${method.label} · ` : ''}{formatPhone(method.value)}
          </Text>
        ))}
      </Category>
      <Category icon="link" title="Social" empty={!socials.length}>
        {socials.map((method) => (
          <Pressable key={method.id} style={styles.socialLine} onPress={() => void Linking.openURL(socialHref(method.label, method.value))}>
            <SocialIcon name={method.label} size={16} />
            <Text style={styles.socialText}>{socialTitle(method.label)} · {method.value}</Text>
          </Pressable>
        ))}
      </Category>
      <Category icon="mail" title="Emails" empty={!emails.length}>
        {emails.map((method) => (
          <Text key={method.id} style={styles.value} onPress={() => void Linking.openURL(`mailto:${method.value}`)}>
            {method.label ? `${method.label} · ` : ''}{method.value}
          </Text>
        ))}
      </Category>
      <Category icon="pin" title="Addresses" empty={!contact.addresses.length}>
        {contact.addresses.map((address) => (
          <Text key={address.id} style={styles.value}>
            {[address.label, address.street, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(', ')}
          </Text>
        ))}
        {located?.lat != null && located.lon != null ? <AddressMap lat={located.lat} lon={located.lon} /> : null}
      </Category>
      <Category icon="briefcase" title="Occupation" empty={!occupation && !contact.department}>
        {occupation ? <EnrichedText on={enriched('title', contact.title)} style={styles.value}>{occupation}</EnrichedText> : null}
        {contact.department ? <EnrichedText on={enriched('department', contact.department)} style={styles.value}>{contact.department}</EnrichedText> : null}
      </Category>
      <Category icon="building" title="Organization" empty={!organizations.length && !contact.website}>
        {organizations.map((org) => (
          <View key={org.id} style={styles.orgRow}>
            <OrgAvatar name={org.name} uri={org.logoUrl} />
            <EnrichedText on={org.id === 'card' && enriched('organizationName', contact.organizationName)} style={styles.orgName}>{org.name}</EnrichedText>
          </View>
        ))}
        {contact.website ? (
          <Pressable accessibilityLabel="Open website" onPress={() => void Linking.openURL(contact.website!)}>
            <EnrichedText on={enriched('website', contact.website)} style={styles.value}>{contact.website}</EnrichedText>
          </Pressable>
        ) : null}
      </Category>
      <Category icon="gift" title="Birthday" empty={!contact.birthday}>
        <Text style={styles.value}>{formatDate(contact.birthday)}</Text>
      </Category>
      <Category icon="gift" title="Important dates" empty={!contact.anniversary && !dates.length}>
        {contact.anniversary ? <DateLine label="Anniversary" value={formatDate(contact.anniversary)} /> : null}
        {dates.map((date) => <DateLine key={date.id} label={date.label} value={formatDate(date.occursOn)} />)}
      </Category>
      {contact.addressBooks?.length || contact.tags.length ? (
        <View style={styles.pills}>
          {contact.addressBooks?.map((book) => <Text key={book.id} style={styles.pill}>{book.name}</Text>)}
          {contact.tags.map((tag) => <Text key={tag.id} style={styles.tag}>{tag.name}</Text>)}
        </View>
      ) : null}
    </Panel>
  )
}

const datePresets = ['Anniversary', 'Birthday', 'First met', 'Graduation']
const dateLabelKey = 'rolodex.date-labels'

function storedDateLabels() {
  if (typeof localStorage === 'undefined') return []
  try {
    const value = JSON.parse(localStorage.getItem(dateLabelKey) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0 && !datePresets.some((preset) => preset.toLowerCase() === item.trim().toLowerCase()))
  } catch {
    return []
  }
}

function rememberDateLabel(label: string) {
  const next = label.trim()
  if (!next || datePresets.some((preset) => preset.toLowerCase() === next.toLowerCase()) || typeof localStorage === 'undefined') return storedDateLabels()
  const labels = [...new Set([...storedDateLabels(), next])]
  localStorage.setItem(dateLabelKey, JSON.stringify(labels))
  return labels
}

function dateTitle(label: string) {
  return datePresets.find((preset) => preset.toLowerCase() === label.trim().toLowerCase()) ?? (label.trim() || 'Category')
}

export function ImportantDates({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const [dates, setDates] = useState<ImportantDate[]>([])
  const [label, setLabel] = useState('')
  const [occursOn, setOccursOn] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<string[]>(() => storedDateLabels())
  const [error, setError] = useState('')
  const base = `/api/workspaces/${workspaceId}/contacts/${contactId}/dates`

  function load() {
    api<ImportantDate[]>(base).then(setDates).catch(() => setDates([]))
  }

  useEffect(() => { void load() }, [workspaceId, contactId])

  function save(id: string, body: { label: string; occursOn: string }) {
    setCatalog(rememberDateLabel(body.label))
    return send(`${base}/${id}`, 'PATCH', body).then(load).catch((caught: Error) => setError(caught.message))
  }

  const ready = Boolean(label.trim() && /^\d{4}-\d{2}-\d{2}$/.test(occursOn))

  return (
    <Panel>
      <Text style={styles.section}>Important dates</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {dates.map((date) => (
        <DateRow
          key={date.id}
          date={date}
          open={open === date.id}
          catalog={catalog}
          onOpen={() => setOpen(open === date.id ? null : date.id)}
          onClose={() => setOpen(null)}
          onRemember={(next) => setCatalog(rememberDateLabel(next))}
          onSave={(body) => void save(date.id, body)}
          onRemove={() => void send(`${base}/${date.id}`, 'DELETE').then(load)}
        />
      ))}
      <View style={styles.dateForm}>
        <View style={styles.dateField}>
          <DateCategory
            value={label}
            open={open === 'new'}
            catalog={catalog}
            onOpen={() => setOpen(open === 'new' ? null : 'new')}
            onChoose={(next) => {
              setLabel(next)
              setCatalog(rememberDateLabel(next))
              setOpen(null)
            }}
          />
        </View>
        <View style={styles.dateField}>
          <DateField label="Date" value={occursOn} onChange={setOccursOn} />
        </View>
        <Pressable
          accessibilityLabel="Add date"
          disabled={!ready}
          onPress={() => void send(base, 'POST', { label: label.trim(), occursOn }).then(() => { setLabel(''); setOccursOn(''); setOpen(null); load() }).catch((caught: Error) => setError(caught.message))}
          style={[styles.addDate, !ready && styles.addDateOff]}
        >
          <Icon name="plus" color={theme.on} size={18} />
        </Pressable>
      </View>
    </Panel>
  )
}

function DateRow({
  date,
  open,
  catalog,
  onOpen,
  onClose,
  onRemember,
  onSave,
  onRemove,
}: {
  date: ImportantDate
  open: boolean
  catalog: string[]
  onOpen: () => void
  onClose: () => void
  onRemember: (label: string) => void
  onSave: (body: { label: string; occursOn: string }) => void
  onRemove: () => void
}) {
  const [label, setLabel] = useState(date.label)
  const [occursOn, setOccursOn] = useState(date.occursOn.slice(0, 10))
  const saved = useRef({ label: date.label, occursOn: date.occursOn.slice(0, 10) })

  useEffect(() => {
    const nextLabel = label.trim()
    const nextDate = occursOn.trim()
    if (nextLabel === saved.current.label && nextDate === saved.current.occursOn) return
    if (!nextLabel || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return
    const handle = setTimeout(() => {
      saved.current = { label: nextLabel, occursOn: nextDate }
      onRemember(nextLabel)
      onSave({ label: nextLabel, occursOn: nextDate })
    }, 400)
    return () => clearTimeout(handle)
  }, [label, occursOn])

  return (
    <View style={styles.dateForm}>
      <View style={styles.dateField}>
        <DateCategory
          value={label}
          open={open}
          catalog={catalog}
          onOpen={onOpen}
          onChoose={(next) => {
            setLabel(next)
            onClose()
          }}
        />
      </View>
      <View style={styles.dateField}>
        <DateField label="Date" value={occursOn} onChange={setOccursOn} />
      </View>
      <Pressable accessibilityLabel={`Remove ${date.label}`} onPress={onRemove} style={styles.addDate}>
        <Text style={styles.removeMark}>×</Text>
      </Pressable>
    </View>
  )
}

function DateCategory({
  value,
  open,
  catalog,
  onOpen,
  onChoose,
}: {
  value: string
  open: boolean
  catalog: string[]
  onOpen: () => void
  onChoose: (label: string) => void
}) {
  const { accent } = useAccent()
  const [custom, setCustom] = useState('')
  const extras = catalog.filter((label) => !datePresets.some((preset) => preset.toLowerCase() === label.toLowerCase()))
  const current = value.trim().toLowerCase()

  return (
    <View>
      <Text style={styles.fieldLabel}>Category</Text>
      <Pressable onPress={() => { setCustom(''); onOpen() }} style={styles.categoryButton}>
        <Text style={[styles.categoryText, { color: value.trim() ? accent : theme.muted }]} numberOfLines={1}>{dateTitle(value)}</Text>
        <Text style={[styles.chevron, { color: accent }]}>›</Text>
      </Pressable>
      {open ? (
        <View style={styles.menu}>
          {datePresets.map((item) => (
            <Pressable key={item} onPress={() => onChoose(item)} style={styles.option}>
              <Text style={[styles.optionText, current === item.toLowerCase() && styles.optionOn]}>{item}</Text>
            </Pressable>
          ))}
          {extras.map((item) => (
            <Pressable key={item} onPress={() => onChoose(item)} style={styles.option}>
              <Text style={[styles.optionText, current === item.toLowerCase() && styles.optionOn]}>{item}</Text>
            </Pressable>
          ))}
          <View style={styles.custom}>
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder="Custom label"
              placeholderTextColor={theme.muted}
              style={styles.customInput}
              onSubmitEditing={() => { if (custom.trim()) onChoose(custom.trim()) }}
            />
            <Pressable onPress={() => { if (custom.trim()) onChoose(custom.trim()) }} style={styles.use}>
              <Text style={[styles.useText, { color: accent }]}>Use</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  )
}

function OrgAvatar({ name, uri }: { name: string; uri: string | null }) {
  const [failed, setFailed] = useState(false)
  if (uri && !failed) {
    return <Image accessibilityLabel="" onError={() => setFailed(true)} source={{ uri }} style={styles.orgImage} />
  }
  return (
    <View style={styles.orgMark}>
      <Text style={styles.orgMarkText}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  )
}

function DateLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dateLine}>
      <Text style={styles.dateLabel}>{label}</Text>
      <Text style={styles.dateValue}>{value}</Text>
    </View>
  )
}

function Category({ icon, title, empty, children }: { icon: 'phone' | 'mail' | 'pin' | 'briefcase' | 'building' | 'gift' | 'link'; title: string; empty?: boolean; children: ReactNode }) {
  if (empty) return null
  return (
    <View style={styles.category}>
      <View style={styles.head}>
        <Icon name={icon} color={theme.text} size={16} />
        <Text style={styles.title}>{title}</Text>
      </View>
      {children}
    </View>
  )
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length === 10) {
    const formatted = `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
    return digits.length === 11 ? `+1 ${formatted}` : formatted
  }
  return value
}

function formatDate(value: string | null) {
  if (!value) return ''
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return value
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

const styles = StyleSheet.create({
  section: { fontFamily: font, fontSize: 13, color: theme.muted, marginBottom: 4, letterSpacing: 0.4 },
  category: { gap: 4, paddingTop: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: font, color: theme.text, fontSize: 14, fontWeight: '700' },
  value: { fontFamily: font, color: theme.text, fontSize: 15, marginLeft: 24 },
  socialLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 24 },
  socialText: { flex: 1, fontFamily: font, color: theme.text, fontSize: 15 },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 24 },
  orgImage: { width: 28, height: 28, borderRadius: 8, backgroundColor: theme.accentMuted },
  orgMark: { width: 28, height: 28, borderRadius: 8, backgroundColor: theme.accentMuted, alignItems: 'center', justifyContent: 'center' },
  orgMarkText: { fontFamily: font, color: theme.text, fontSize: 13, fontWeight: '700' },
  orgName: { fontFamily: font, color: theme.text, fontSize: 15, flex: 1 },
  dateLine: { flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: 24 },
  dateLineFlush: { marginLeft: 0 },
  dateLabel: { flex: 1, fontFamily: font, color: theme.text, fontSize: 15 },
  dateValue: { fontFamily: font, color: theme.muted, fontSize: 15 },
  remove: { fontFamily: font, color: theme.muted, fontSize: 18, paddingHorizontal: 6 },
  dateForm: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 8 },
  dateField: { flex: 1 },
  addDate: { width: 44, height: 44, borderRadius: 14, backgroundColor: theme.text, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  addDateOff: { opacity: 0.4 },
  removeMark: { color: theme.on, fontFamily: font, fontSize: 22, fontWeight: '700', marginTop: -2 },
  fieldLabel: { color: theme.muted, fontSize: 11, fontFamily: font, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 },
  categoryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  categoryText: { flex: 1, fontFamily: font, fontSize: 15 },
  chevron: { fontSize: 18, lineHeight: 20 },
  menu: { marginTop: 6, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 14, overflow: 'hidden' },
  option: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  optionText: { fontFamily: font, fontSize: 15, color: theme.text },
  optionOn: { fontWeight: '700' },
  custom: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  customInput: { flex: 1, fontFamily: font, fontSize: 15, color: theme.text, backgroundColor: theme.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  use: { paddingHorizontal: 8, paddingVertical: 8 },
  useText: { fontFamily: font, fontSize: 15, fontWeight: '700' },
  error: { color: theme.danger, fontFamily: font, fontSize: 13 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  pill: { fontFamily: font, fontSize: 12, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tag: { fontFamily: font, fontSize: 12, color: theme.text, backgroundColor: theme.accentMuted, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
})
