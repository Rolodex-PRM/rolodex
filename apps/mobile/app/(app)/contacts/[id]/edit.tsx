import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { api, send, type Contact } from '../../../../src/api'
import { ContactForm } from '../../../../src/ContactForm'
import { ContactCover } from '../../../../src/cover'
import { ContactPortrait } from '../../../../src/contact-photo'
import { ImportantDates } from '../../../../src/contact-overview'
import { ImmichPhotos } from '../../../../src/immich-photos'
import { ProfileCrm } from '../../../../src/profile-crm'
import { useAuth } from '../../../../src/auth'
import { Loader } from '../../../../src/logo'
import { font, theme } from '../../../../src/theme'
import { Button, Notice } from '../../../../src/ui'

export default function EditContact() {
  const { id, workspace: workspaceParam } = useLocalSearchParams<{ id: string; workspace?: string }>()
  const { workspace } = useAuth()
  const router = useRouter()
  const scope = (typeof workspaceParam === 'string' && workspaceParam) || workspace?.id
  const [contact, setContact] = useState<Contact | null>(null)
  const [notice, setNotice] = useState('')

  async function enrich() {
    if (!scope || !contact) return
    try {
      const result = await send<{ changed: string[] }>(`/api/workspaces/${scope}/contacts/${contact.id}/enrich`, 'POST')
      setContact(await api<Contact>(`/api/workspaces/${scope}/contacts/${contact.id}`))
      setNotice(result.changed.length ? 'Filled the empty company fields from the work email.' : 'Nothing to fill. The company is already set, or the email is a personal address.')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Could not fill company fields')
    }
  }

  useEffect(() => {
    if (!scope || !id) return
    api<Contact>(`/api/workspaces/${scope}/contacts/${id}`).then(setContact).catch(() => setContact(null))
  }, [scope, id])

  if (!contact) return <Loader />
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text }}>Edit {contact.displayName}</Text>
      {scope ? (
        <ContactCover
          workspaceId={scope}
          contactId={contact.id}
          mode={contact.coverMode ?? 'cycle'}
          hasCover={Boolean(contact.hasCover)}
          revision={contact.updatedAt}
          canWrite
          onChange={() => {
            api<Contact>(`/api/workspaces/${scope}/contacts/${contact.id}`).then(setContact).catch(() => undefined)
          }}
        />
      ) : null}
      {scope ? <ContactPortrait workspaceId={scope} contactId={contact.id} name={contact.displayName} hasPhoto={contact.hasPhoto} editing /> : null}
      {scope ? <Button label="Fill company from email" tone="ghost" onPress={() => void enrich()} /> : null}
      {notice ? <Notice text={notice} /> : null}
      <ContactForm contact={contact} onSaved={(savedId) => router.replace(`/contacts/${savedId}?workspace=${scope}`)} />
      {scope ? <ImportantDates workspaceId={scope} contactId={contact.id} /> : null}
      {scope ? <ImmichPhotos workspaceId={scope} contactId={contact.id} canWrite canChangePhoto onPhoto={() => api<Contact>(`/api/workspaces/${scope}/contacts/${contact.id}`).then(setContact).catch(() => undefined)} /> : null}
      {scope ? (
        <ProfileCrm
          workspaceId={scope}
          contactId={contact.id}
          canWrite
          editorsOnly
          birthday={contact.birthday}
          followUpFrequency={contact.followUpFrequency}
          lastInteractionAt={contact.lastInteractionAt}
        />
      ) : null}
    </View>
  )
}
