import { useRouter } from 'expo-router'
import { createElement, useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { api, type AddressBook, type Member } from '../../src/api'
import { useAuth } from '../../src/auth'
import { font, theme } from '../../src/theme'
import { Button, Field, Notice, Panel } from '../../src/ui'

type Preview = {
  created: number
  skipped: number
  contacts: { fingerprint: string; displayName: string; duplicates: { displayName: string; reason: string }[] }[]
}

export function AddressBooksPage() {
  const { workspace } = useAuth()
  const [books, setBooks] = useState<AddressBook[]>([])
  const [name, setName] = useState('')
  const [vcf, setVcf] = useState('')
  const [bookId, setBookId] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'administrator' || workspace?.role === 'editor'

  function load() {
    if (!workspace) return
    api<AddressBook[]>(`/api/workspaces/${workspace.id}/address-books`)
      .then((rows) => {
        setBooks(rows)
        setBookId((current) => current || rows[0]?.id || '')
      })
      .catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [workspace])

  async function create() {
    if (!workspace || !name.trim()) return
    await api(`/api/workspaces/${workspace.id}/address-books`, { method: 'POST', body: JSON.stringify({ name }) })
    setName('')
    load()
  }

  async function previewImport(commit: boolean, decisions?: { fingerprint: string; action: 'create' | 'skip' }[]) {
    if (!bookId) return
    setError('')
    try {
      const result = await api<Preview>(`/api/workspaces/${workspace?.id}/address-books/${bookId}/import`, {
        method: 'POST',
        body: JSON.stringify({ vcf, commit, decisions }),
      })
      setPreview(result)
      setMessage(commit ? `Imported ${result.created}. Skipped ${result.skipped}.` : 'Review possible duplicates before importing.')
      if (commit) load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed')
    }
  }

  async function download(id = bookId) {
    if (!workspace || !id || Platform.OS !== 'web') return
    const token = sessionStorage.getItem('rolodex.session')
    const parsed = token ? (JSON.parse(token) as { token: string }) : null
    const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/workspaces/${workspace.id}/address-books/${id}/export`, {
      headers: parsed ? { Authorization: `Bearer ${parsed.token}` } : undefined,
      credentials: 'include',
    })
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'contacts.vcf'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Address books</Text>
      {error ? <Notice text={error} /> : null}
      {books.map((book) => (
        <BookCard key={book.id} book={book} onChanged={load} onExport={(id) => { setBookId(id); void download(id) }} />
      ))}
      {canEdit ? (
        <Panel>
          <Text style={styles.name}>New address book</Text>
          <Field label="Name" value={name} onChangeText={setName} />
          <Button label="Create" onPress={() => void create()} />
        </Panel>
      ) : null}
      {canEdit ? (
        <Panel>
          <Text style={styles.name}>Import</Text>
          {books.map((book) => (
            <Text key={book.id} onPress={() => setBookId(book.id)} style={[styles.choice, bookId === book.id && styles.choiceActive]}>
              {book.name}
            </Text>
          ))}
          {Platform.OS === 'web'
            ? createElement('input', {
                type: 'file',
                accept: '.vcf,text/vcard,text/plain',
                onChange: async (event: { target: { files?: FileList | null } }) => {
                  const file = event.target.files?.[0]
                  if (file) setVcf(await file.text())
                },
              })
            : null}
          <Field label="vCard text" multiline value={vcf} onChangeText={setVcf} />
          <Button label="Preview" tone="ghost" onPress={() => void previewImport(false)} />
          {preview?.contacts.some((contact) => contact.duplicates.length) ? (
            <View style={{ gap: 8 }}>
              {preview.contacts.filter((contact) => contact.duplicates.length).map((contact) => (
                <Text key={contact.fingerprint} style={styles.meta}>
                  {contact.displayName} matches {contact.duplicates.map((item) => item.displayName).join(', ')}
                </Text>
              ))}
              <Button
                label="Import new, skip matches"
                onPress={() =>
                  void previewImport(
                    true,
                    preview.contacts.map((contact) => ({ fingerprint: contact.fingerprint, action: contact.duplicates.length ? 'skip' : 'create' })),
                  )
                }
              />
            </View>
          ) : (
            <Button label="Import" onPress={() => void previewImport(true)} />
          )}
          {message ? <Text style={styles.meta}>{message}</Text> : null}
        </Panel>
      ) : null}
    </View>
  )
}

function BookCard({ book, onChanged, onExport }: { book: AddressBook; onChanged: () => void; onExport: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(book.name)
  const [description, setDescription] = useState(book.description ?? '')
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const canWrite = book.role === 'owner' || book.role === 'administrator' || book.role === 'editor'
  const canShare = book.role === 'owner' || book.role === 'administrator'

  useEffect(() => {
    setName(book.name)
    setDescription(book.description ?? '')
  }, [book.name, book.description])

  async function save() {
    setNote('')
    try {
      await api(`/api/workspaces/${book.workspaceId}/address-books/${book.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      })
      setEditing(false)
      onChanged()
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : 'Could not rename the address book')
    }
  }

  async function remove() {
    setNote('')
    try {
      await api(`/api/workspaces/${book.workspaceId}/address-books/${book.id}`, { method: 'DELETE' })
      onChanged()
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : 'Could not delete the address book')
    }
  }

  return (
    <Panel>
      {editing ? (
        <View style={{ gap: 8 }}>
          <Field label="Name" value={name} onChangeText={setName} />
          <Field label="Description" value={description} onChangeText={setDescription} />
          <View style={styles.shareRow}>
            <Button label="Save" onPress={() => void save()} />
            <Button label="Cancel" tone="ghost" onPress={() => { setEditing(false); setName(book.name); setDescription(book.description ?? '') }} />
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.name}>{book.name}{book.shared ? ' · shared with you' : ''}</Text>
          {book.description ? <Text style={styles.meta}>{book.description}</Text> : null}
          <Text style={styles.meta}>Sync token {book.syncToken}</Text>
        </>
      )}
      {confirming ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.meta}>Delete {book.name}? People stay in the workspace. This book and its cards leave CardDAV.</Text>
          <View style={styles.shareRow}>
            <Button label="Delete address book" tone="danger" onPress={() => void remove()} />
            <Button label="Cancel" tone="ghost" onPress={() => setConfirming(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.shareRow}>
          {canWrite ? <Button label="Rename" tone="ghost" onPress={() => setEditing(true)} /> : null}
          <Button label="Export vCard" tone="ghost" onPress={() => onExport(book.id)} />
          {canWrite ? <Button label="Delete" tone="danger" onPress={() => setConfirming(true)} /> : null}
        </View>
      )}
      {note ? <Notice text={note} /> : null}
      {canShare ? <ShareBook book={book} /> : null}
    </Panel>
  )
}

function ShareBook({ book }: { book: AddressBook }) {
  const { workspace } = useAuth()
  const [shares, setShares] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer')
  const [note, setNote] = useState('')

  function load() {
    if (!workspace) return
    api<Member[]>(`/api/workspaces/${book.workspaceId}/address-books/${book.id}/shares`).then(setShares).catch((caught: Error) => setNote(caught.message))
  }

  useEffect(load, [book.id, book.workspaceId, workspace])

  async function share() {
    setNote('')
    try {
      await api(`/api/workspaces/${book.workspaceId}/address-books/${book.id}/shares`, {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      })
      setEmail('')
      load()
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : 'Could not share the address book')
    }
  }

  return (
    <View style={{ gap: 8, marginTop: 12 }}>
      <Text style={styles.name}>Share</Text>
      {shares.map((member) => (
        <View key={member.userId} style={styles.shareRow}>
          <Text style={styles.meta}>{member.displayName} · {member.email}</Text>
          <Button
            label="Viewer"
            tone={member.role === 'viewer' ? 'primary' : 'ghost'}
            onPress={() => {
              void api(`/api/workspaces/${book.workspaceId}/address-books/${book.id}/shares`, {
                method: 'POST',
                body: JSON.stringify({ email: member.email, role: 'viewer' }),
              }).then(load)
            }}
          />
          <Button
            label="Editor"
            tone={member.role === 'editor' ? 'primary' : 'ghost'}
            onPress={() => {
              void api(`/api/workspaces/${book.workspaceId}/address-books/${book.id}/shares`, {
                method: 'POST',
                body: JSON.stringify({ email: member.email, role: 'editor' }),
              }).then(load)
            }}
          />
          <Button
            label="Remove"
            tone="danger"
            onPress={() => {
              void api(`/api/workspaces/${book.workspaceId}/address-books/${book.id}/shares/${member.userId}`, { method: 'DELETE' }).then(load)
            }}
          />
        </View>
      ))}
      <Field label="Email" autoCapitalize="none" value={email} onChangeText={setEmail} />
      <View style={styles.shareRow}>
        <Button label="Viewer" tone={role === 'viewer' ? 'primary' : 'ghost'} onPress={() => setRole('viewer')} />
        <Button label="Editor" tone={role === 'editor' ? 'primary' : 'ghost'} onPress={() => setRole('editor')} />
      </View>
      <Button label="Share address book" onPress={() => void share()} />
      {note ? <Text style={styles.meta}>{note}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
  name: { fontFamily: font, fontSize: 16, fontWeight: '600', color: theme.text, marginBottom: 6 },
  meta: { fontFamily: font, color: theme.muted, marginBottom: 8 },
  choice: { fontFamily: font, color: theme.muted, paddingVertical: 4 },
  choiceActive: { color: theme.accent },
  shareRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
})

export default function AddressBooksRoute() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings?tab=books')
  }, [router])
  return null
}
