import { createElement, useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { api, type AddressBook } from './api'
import { useAuth } from './auth'
import { font, theme } from './theme'
import { Button, Notice } from './ui'

type PreviewContact = {
  fingerprint: string
  displayName: string
  emails: string[]
  phones: string[]
  duplicates: { displayName: string; reason: string }[]
}

type Preview = { created: number; skipped: number; contacts: PreviewContact[] }

export function PhoneSync({ lastCheckedIn }: { lastCheckedIn: string | null }) {
  const { workspace } = useAuth()
  const [books, setBooks] = useState<AddressBook[]>([])
  const [bookId, setBookId] = useState('')
  const [vcf, setVcf] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'administrator' || workspace?.role === 'editor'
  const checkedIn = lastCheckedIn ? new Date(lastCheckedIn) : null

  useEffect(() => {
    if (!workspace) return
    api<AddressBook[]>(`/api/workspaces/${workspace.id}/address-books`)
      .then((rows) => {
        const writable = rows.filter((book) => book.role === 'owner' || book.role === 'administrator' || book.role === 'editor')
        setBooks(writable)
        setBookId((current) => current || writable[0]?.id || '')
      })
      .catch((caught: Error) => setError(caught.message))
  }, [workspace])

  async function previewVcf(text: string, failure: string) {
    setError('')
    setMessage('')
    setPending(true)
    try {
      setVcf(text)
      const result = await api<Preview>(`/api/workspaces/${workspace?.id}/address-books/${bookId}/import`, {
        method: 'POST',
        body: JSON.stringify({ vcf: text, commit: false }),
      })
      setPreview(result)
      setSelected(result.contacts.filter((contact) => contact.duplicates.length === 0).map((contact) => contact.fingerprint))
    } catch (caught) {
      setPreview(null)
      setError(caught instanceof Error ? caught.message : failure)
    } finally {
      setPending(false)
    }
  }

  async function readFile(file: File) {
    try {
      await previewVcf(await file.text(), 'Could not read that file')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read that file')
    }
  }

  async function chooseContacts() {
    const picker = contactPicker()
    if (!picker || !bookId) return
    setError('')
    try {
      const people = await picker.select(['name', 'email', 'tel', 'address'], { multiple: true })
      if (!people.length) return
      await previewVcf(peopleToVcard(people), 'Could not read those contacts')
    } catch (caught) {
      if (caught instanceof DOMException && (caught.name === 'AbortError' || caught.name === 'InvalidStateError')) return
      setError(caught instanceof Error ? caught.message : 'Could not open Contacts')
    }
  }

  async function addSelected() {
    if (!preview || !bookId) return
    setPending(true)
    setError('')
    try {
      const result = await api<Preview>(`/api/workspaces/${workspace?.id}/address-books/${bookId}/import`, {
        method: 'POST',
        body: JSON.stringify({
          vcf,
          commit: true,
          decisions: preview.contacts.map((contact) => ({
            fingerprint: contact.fingerprint,
            action: selected.includes(contact.fingerprint) ? 'create' : 'skip',
          })),
        }),
      })
      setMessage(`Added ${result.created}. Left out ${result.skipped}. The iPhone picks these up the next time it checks in.`)
      setPreview(null)
      setVcf('')
      setSelected([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the selected people')
    } finally {
      setPending(false)
    }
  }

  function toggle(fingerprint: string) {
    setSelected((current) => (current.includes(fingerprint) ? current.filter((item) => item !== fingerprint) : [...current, fingerprint]))
  }

  return (
    <View style={styles.block}>
      <Text style={styles.heading}>Send Rolodex to the iPhone</Text>
      <Text style={styles.meta}>Saving the account does not download people. The iPhone fetches on its own schedule, and Rolodex cannot start that fetch. To fetch now, open Settings, Apps, Contacts, Contacts Accounts, tap this account, turn Contacts off, wait a few seconds, and turn it on. On an older iPhone that list is under Settings, Contacts, Accounts.</Text>
      <Text style={styles.meta}>Each Rolodex address book then shows up as its own list. In the Contacts app, tap Lists and turn on every Rolodex list. A list that is off stays hidden. Edits made in that account come back here on the next fetch.</Text>
      <Text style={styles.meta}>{checkedIn && !Number.isNaN(checkedIn.getTime()) ? `The phone last checked in ${checkedIn.toLocaleString()}.` : 'The phone has not checked in yet. The check-in time updates after that fetch reaches Rolodex.'}</Text>
      {canEdit ? (
        <>
          <Text style={styles.heading}>Choose people from Contacts</Text>
          <Text style={styles.meta}>{contactPicker() ? 'Choose the people on this device. They are added to the address book you pick here.' : 'This browser cannot open the Contacts app. On an iPhone, people in the Rolodex account come and go through CardDAV. A vCard file still works if you already have one.'}</Text>
          {books.length > 1 ? (
            <View style={styles.books}>
              {books.map((book) => (
                <Pressable key={book.id} accessibilityRole="button" onPress={() => setBookId(book.id)} style={[styles.choice, bookId === book.id && styles.choiceOn]}>
                  <Text style={[styles.choiceText, bookId === book.id && styles.choiceTextOn]}>{book.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {books.length === 0 ? <Text style={styles.meta}>Create an address book before adding people.</Text> : null}
          {contactPicker() && bookId ? <Button label={pending ? 'Opening Contacts' : 'Choose from Contacts'} onPress={() => void chooseContacts()} disabled={pending} /> : null}
          {Platform.OS === 'web' && bookId ? <Text style={styles.meta}>Or choose a vCard file.</Text> : null}
          {Platform.OS === 'web' && bookId
            ? createElement('input', {
                type: 'file',
                accept: '.vcf,text/vcard,text/x-vcard,text/plain',
                onChange: (event: { target: { files?: FileList | null } }) => {
                  const file = event.target.files?.[0]
                  if (file) void readFile(file)
                },
              })
            : null}
          {preview ? (
            <View style={styles.list}>
              <View style={styles.tools}>
                <Button label="Select all" tone="ghost" onPress={() => setSelected(preview.contacts.map((contact) => contact.fingerprint))} />
                <Button label="Clear" tone="ghost" onPress={() => setSelected([])} />
              </View>
              {preview.contacts.map((contact) => {
                const on = selected.includes(contact.fingerprint)
                const detail = [...contact.emails, ...contact.phones].slice(0, 2).join(' · ')
                return (
                  <Pressable key={contact.fingerprint} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(contact.fingerprint)} style={styles.person}>
                    <Text style={styles.mark}>{on ? '✓' : ''}</Text>
                    <View style={styles.personCopy}>
                      <Text style={styles.personName}>{contact.displayName}</Text>
                      {detail ? <Text style={styles.meta}>{detail}</Text> : null}
                      {contact.duplicates.length ? <Text style={styles.meta}>Already here: {contact.duplicates.map((item) => item.displayName).join(', ')}</Text> : null}
                    </View>
                  </Pressable>
                )
              })}
              <Button label={pending ? 'Adding' : `Add ${selected.length} selected`} onPress={() => void addSelected()} disabled={pending || selected.length === 0} />
            </View>
          ) : null}
          {error ? <Notice text={error} /> : null}
          {message ? <Text style={styles.meta}>{message}</Text> : null}
        </>
      ) : null}
    </View>
  )
}

type PickedAddress = { addressLine?: string[]; city?: string; region?: string; postalCode?: string; country?: string }
type PickedContact = { name?: string[]; email?: string[]; tel?: string[]; address?: PickedAddress[] }
type ContactPicker = { select: (properties: string[], options: { multiple: boolean }) => Promise<PickedContact[]> }

function contactPicker() {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return null
  const contacts = (navigator as Navigator & { contacts?: ContactPicker }).contacts
  return typeof contacts?.select === 'function' ? contacts : null
}

function peopleToVcard(people: PickedContact[]) {
  return people.map((person) => {
    const name = person.name?.[0]?.trim() || 'Unknown'
    const split = name.lastIndexOf(' ')
    const first = split > 0 ? name.slice(0, split) : name
    const last = split > 0 ? name.slice(split + 1) : ''
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vcardEscape(name)}`, `N:${vcardEscape(last)};${vcardEscape(first)};;;`]
    for (const email of person.email ?? []) if (email.trim()) lines.push(`EMAIL:${vcardEscape(email.trim())}`)
    for (const tel of person.tel ?? []) if (tel.trim()) lines.push(`TEL:${vcardEscape(tel.trim())}`)
    for (const address of person.address ?? []) {
      const street = (address.addressLine ?? []).filter(Boolean).join(', ')
      const value = ['', '', street, address.city || '', address.region || '', address.postalCode || '', address.country || ''].map(vcardEscape).join(';')
      lines.push(`ADR:${value}`)
    }
    lines.push('END:VCARD')
    return lines.join('\r\n')
  }).join('\r\n')
}

function vcardEscape(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,')
}

const styles = StyleSheet.create({
  block: { gap: 8, marginTop: 8 },
  heading: { fontFamily: font, color: theme.text, fontSize: 15, fontWeight: '700' },
  meta: { fontFamily: font, color: theme.muted },
  books: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  choiceOn: { backgroundColor: theme.text, borderColor: theme.text },
  choiceText: { fontFamily: font, color: theme.text, fontSize: 13 },
  choiceTextOn: { color: theme.on },
  list: { gap: 8 },
  tools: { flexDirection: 'row', gap: 8 },
  person: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 10 },
  mark: { width: 22, height: 22, borderWidth: 1, borderColor: theme.border, borderRadius: 6, textAlign: 'center', color: theme.text, fontFamily: font, lineHeight: 20 },
  personCopy: { flex: 1, gap: 2 },
  personName: { fontFamily: font, color: theme.text, fontWeight: '600' },
})
