import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { api, type Contact, type ImmichGallery } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { Loader } from '../../../src/logo'
import { font, theme } from '../../../src/theme'
import { ContactHistory, ContactShare } from '../../../src/contact-access'
import { ContactCover } from '../../../src/cover'
import { ContactPortrait } from '../../../src/contact-photo'
import { ContactOverview } from '../../../src/contact-overview'
import { AiEnrich, EnrichedText, useApprovedFields } from '../../../src/ai-enrich'
import { ContactSummary } from '../../../src/summary'
import { RelationshipGraph } from '../../../src/relationship-graph'
import { ImmichPhotos } from '../../../src/immich-photos'
import { ProfileCrm } from '../../../src/profile-crm'
import { Timeline } from '../../../src/timeline'
import { Button, Panel } from '../../../src/ui'

export default function ContactProfile() {
  const { id, workspace: workspaceParam } = useLocalSearchParams<{ id: string; workspace?: string }>()
  const { workspace } = useAuth()
  const router = useRouter()
  const scope = (typeof workspaceParam === 'string' && workspaceParam) || workspace?.id
  const [contact, setContact] = useState<Contact | null>(null)
  const [error, setError] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [photoLinks, setPhotoLinks] = useState<ImmichGallery['attachments']>([])
  const canWrite = canEdit || workspace?.role === 'owner' || workspace?.role === 'administrator' || workspace?.role === 'editor'
  const enriched = useApprovedFields(scope || '', typeof id === 'string' ? id : '')

  function load() {
    if (!scope || !id) return
    api<Contact>(`/api/workspaces/${scope}/contacts/${id}`)
      .then(async (next) => {
        setContact(next)
        const books = await api<{ id: string; role: string }[]>(`/api/workspaces/${scope}/address-books`)
        const membership = new Set(next.addressBooks.map((book) => book.id))
        setCanEdit(books.some((book) => membership.has(book.id) && (book.role === 'editor' || book.role === 'administrator' || book.role === 'owner')))
      })
      .catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [scope, id])

  async function remove() {
    if (!scope || !id) return
    await api(`/api/workspaces/${scope}/contacts/${id}`, { method: 'DELETE' })
    router.replace('/')
  }

  if (!contact) return error ? <Text style={styles.muted}>{error}</Text> : <Loader />
  return (
    <View style={styles.page}>
      {scope ? (
        <ContactCover
          workspaceId={scope}
          contactId={contact.id}
          mode={contact.coverMode ?? 'cycle'}
          hasCover={Boolean(contact.hasCover)}
          revision={contact.updatedAt}
          canWrite={false}
          onChange={load}
        />
      ) : null}
      <View style={[styles.headerWrap, scope ? styles.headerOver : null]}>
        <View style={styles.header}>
          <View style={styles.identity}>
            {scope ? <ContactPortrait workspaceId={scope} contactId={contact.id} name={contact.displayName} hasPhoto={contact.hasPhoto} editing={false} /> : <View style={styles.avatar}><Text style={styles.avatarText}>{contact.displayName.slice(0, 1)}</Text></View>}
            <View style={styles.nameWrap}>
              <Text style={styles.title}>{contact.displayName}</Text>
              <Text style={styles.muted}>{[contact.title, contact.organizationName].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
        </View>
        {canEdit ? (
          <View style={styles.actions}>
            <Button label="Edit" tone="ghost" onPress={() => router.push(`/contacts/${contact.id}/edit?workspace=${scope}`)} />
            <Button label="Delete" tone="danger" onPress={() => void remove()} />
          </View>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {scope ? (
        <Timeline
          workspaceId={scope}
          contactId={contact.id}
          canWrite={canWrite}
          attachments={photoLinks}
          about={
            <View style={styles.page}>
              <ContactSummary workspaceId={scope} contactId={contact.id} />
              <AiEnrich workspaceId={scope} contactId={contact.id} canWrite={canWrite} onApplied={load} />
              <ContactOverview workspaceId={scope} contact={contact} />
              <RelationshipGraph workspaceId={scope} contactId={contact.id} name={contact.displayName} />
              <Panel>
                <Text style={styles.section}>Details</Text>
                <Text style={styles.body}>{contact.cardNote || 'No card note.'}</Text>
                {contact.howWeMet ? <Text style={styles.body}>How we met: {contact.howWeMet}</Text> : null}
                {contact.interests ? <EnrichedText on={enriched('interests', contact.interests)} style={styles.body}>Interests: {contact.interests}</EnrichedText> : null}
                <Text style={styles.muted}>Card note is the only note copied to CardDAV. Private notes stay in Rolodex.</Text>
              </Panel>
              <ImmichPhotos workspaceId={scope} contactId={contact.id} canWrite={canWrite} canChangePhoto={false} onAttachments={setPhotoLinks} onPhoto={load} />
              <ProfileCrm workspaceId={scope} contactId={contact.id} canWrite={canWrite} birthday={contact.birthday} followUpFrequency={contact.followUpFrequency} lastInteractionAt={contact.lastInteractionAt} />
              <ContactHistory workspaceId={scope} contactId={contact.id} />
              <ContactShare workspaceId={scope} contactId={contact.id} />
            </View>
          }
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  headerWrap: { gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' },
  headerOver: { marginTop: -64, paddingHorizontal: 12 },
  identity: { flexDirection: 'row', gap: 14, alignItems: 'center', flex: 1, minWidth: 0 },
  nameWrap: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
  section: { fontFamily: font, fontSize: 13, color: theme.muted, marginBottom: 8, letterSpacing: 0.4 },
  body: { fontFamily: font, color: theme.text, fontSize: 15, marginBottom: 6 },
  link: { fontFamily: font, color: theme.accent, fontSize: 15, marginBottom: 6 },
  muted: { fontFamily: font, color: theme.muted },
  error: { color: theme.danger, fontFamily: font },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.accentMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: theme.bg },
  avatarText: { fontFamily: font, fontSize: 28, color: theme.text, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pill: { fontFamily: font, fontSize: 12, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tag: { fontFamily: font, fontSize: 12, color: theme.on, backgroundColor: theme.text, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
})
