import { useEffect, useState, type ReactNode } from 'react'
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { EnrichedText, useApprovedFields } from './ai-enrich'
import { AddressMap } from './address-map'
import { api, send, type Contact, type OrgMembership } from './api'
import { Icon } from './icons'
import { socialHref, socialTitle, SocialIcon } from './socials'
import { font, theme } from './theme'
import { DateField, Field, Panel } from './ui'

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

export function ImportantDates({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const [dates, setDates] = useState<ImportantDate[]>([])
  const [label, setLabel] = useState('')
  const [occursOn, setOccursOn] = useState('')

  function load() {
    api<ImportantDate[]>(`/api/workspaces/${workspaceId}/contacts/${contactId}/dates`).then(setDates).catch(() => setDates([]))
  }

  useEffect(() => { void load() }, [workspaceId, contactId])

  return (
    <Panel>
      <Text style={styles.section}>Important dates</Text>
      {dates.map((date) => (
        <View key={date.id} style={[styles.dateLine, styles.dateLineFlush]}>
          <Text style={styles.dateLabel}>{date.label}</Text>
          <Text style={styles.dateValue}>{formatDate(date.occursOn)}</Text>
          <Pressable onPress={() => void send(`/api/workspaces/${workspaceId}/contacts/${contactId}/dates/${date.id}`, 'DELETE').then(load)} accessibilityLabel={`Remove ${date.label}`}>
            <Text style={styles.remove}>×</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.dateForm}>
        <View style={styles.dateField}>
          <Field label="Category" value={label} onChangeText={setLabel} placeholder="Anniversary" />
        </View>
        <View style={styles.dateField}>
          <DateField label="Date" value={occursOn} onChange={setOccursOn} />
        </View>
        <Pressable
          accessibilityLabel="Add date"
          disabled={!label.trim() || !occursOn}
          onPress={() => void send(`/api/workspaces/${workspaceId}/contacts/${contactId}/dates`, 'POST', { label: label.trim(), occursOn }).then(() => { setLabel(''); setOccursOn(''); load() })}
          style={[styles.addDate, (!label.trim() || !occursOn) && styles.addDateOff]}
        >
          <Icon name="plus" color={theme.on} size={18} />
        </Pressable>
      </View>
    </Panel>
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
  
  if (value.startsWith('--')) {
    const [_, month, day] = value.split('-').map(Number)
    if (!month || !day) return value
    const currentYear = new Date().getFullYear()
    return new Date(currentYear, month - 1, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  }
  
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
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  pill: { fontFamily: font, fontSize: 12, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tag: { fontFamily: font, fontSize: 12, color: theme.text, backgroundColor: theme.accentMuted, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
})
