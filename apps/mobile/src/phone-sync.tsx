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

  async function readFile(file: File) {
    setError('')
    setMessage('')
    setPending(true)
    try {
      const text = await file.text()
      setVcf(text)
      const result = await api<Preview>(`/api/workspaces/${workspace?.id}/address-books/${bookId}/import`, {
        method: 'POST',
        body: JSON.stringify({ vcf: text, commit: false }),
      })
      setPreview(result)
      setSelected(result.contacts.filter((contact) => contact.duplicates.length === 0).map((contact) => contact.fingerprint))
    } catch (caught) {
      setPreview(null)
      setError(caught instanceof Error ? caught.message : 'Could not read that file')
    } finally {
      setPending(false)
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
      <Text style={styles.meta}>The iPhone downloads this account. Open Contacts on the phone and pull down to refresh. People in Rolodex arrive on the phone, and edits made in the Rolodex account come back here.</Text>
      <Text style={styles.meta}>{checkedIn && !Number.isNaN(checkedIn.getTime()) ? `The phone last checked in ${checkedIn.toLocaleString()}.` : 'The phone has not checked in yet.'}</Text>
      {canEdit ? (
        <>
          <Text style={styles.heading}>Choose people on the iPhone</Text>
          <Text style={styles.meta}>People kept in iCloud stay there until you share them. On the iPhone, open Contacts, tap Select, choose people, tap Share, and save the vCard. Choose that file here.</Text>
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
