import { Fragment, createElement, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { api, download, type AddressBook } from './api'
import { useAuth } from './auth'
import { font, theme } from './theme'
import { Button, Notice, Panel } from './ui'

type ImportRow = {
  fingerprint: string
  displayName: string
  email: string
  phone: string
  organization: string
  city: string
  birthday: string
  duplicates: { displayName: string; reason: string }[]
}

type Preview = { created: number; skipped: number; contacts: ImportRow[] }

const steps = ['Import contacts', 'Address book', 'Review']
const formats = [
  { name: 'vCard', detail: '.vcf files from Google, Apple, and other address books.' },
  { name: 'Outlook CSV', detail: '.csv files with columns such as First Name, E-mail Address, and Mobile Phone. A Google Contacts spreadsheet uses this layout.' },
  { name: 'Rolodex CSV', detail: 'The template below. Replace the example row, then import that file.' },
]
const columns = ['Name', 'Organization', 'Email', 'Phone', 'City', 'Birthday', 'Match'] as const

export function ImportContacts() {
  const { workspace } = useAuth()
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'administrator' || workspace?.role === 'editor'
  const fileRef = useRef<{ click: () => void; value: string } | null>(null)
  const [step, setStep] = useState(0)
  const [fileName, setFileName] = useState('')
  const [fileText, setFileText] = useState('')
  const [books, setBooks] = useState<AddressBook[]>([])
  const [bookId, setBookId] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [imported, setImported] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bookError, setBookError] = useState('')
  const [templateNote, setTemplateNote] = useState('')

  useEffect(() => {
    if (!workspace) return
    let cancel = false
    api<AddressBook[]>(`/api/workspaces/${workspace.id}/address-books`)
      .then((rows) => {
        if (cancel) return
        setBooks(rows)
        setBookId((current) => current || rows[0]?.id || '')
        setBookError('')
      })
      .catch((caught: Error) => {
        if (!cancel) setBookError(caught.message)
      })
    return () => {
      cancel = true
    }
  }, [workspace])

  const book = books.find((item) => item.id === bookId)
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const source = preview?.contacts ?? []
    if (!needle) return source
    return source.filter((row) =>
      [row.displayName, row.organization, row.email, row.phone, row.city, row.birthday, row.duplicates.map((item) => item.displayName).join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [preview, query])

  async function createBook(name: string) {
    if (!workspace || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      const created = await api<AddressBook>(`/api/workspaces/${workspace.id}/address-books`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      })
      setBooks((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)))
      setBookId(created.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the address book')
      throw caught
    } finally {
      setBusy(false)
    }
  }

  function continueBook() {
    if (!bookId) {
      setError('Choose an address book')
      return
    }
    setError('')
    setPreview(null)
    setImported(false)
    setStep(2)
  }

  useEffect(() => {
    if (step !== 2 || preview || !workspace || !bookId || !fileText) return
    let cancel = false
    setBusy(true)
    setError('')
    api<Preview>(`/api/workspaces/${workspace.id}/address-books/${bookId}/import`, {
      method: 'POST',
      body: JSON.stringify({ vcf: fileText, commit: false }),
    })
      .then((result) => {
        if (!cancel) setPreview(result)
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(caught instanceof Error ? caught.message : 'Could not read that file')
      })
      .finally(() => {
        if (!cancel) setBusy(false)
      })
    return () => {
      cancel = true
    }
  }, [step, bookId, fileText, workspace, preview])

  async function commit() {
    if (!workspace || !bookId || !fileText) return
    setBusy(true)
    setError('')
    try {
      const result = await api<Preview>(`/api/workspaces/${workspace.id}/address-books/${bookId}/import`, {
        method: 'POST',
        body: JSON.stringify({ vcf: fileText, commit: true }),
      })
      setPreview(result)
      setImported(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  if (!canEdit) return <Text style={styles.meta}>Editors can import contacts.</Text>

  return (
    <View style={styles.page}>
      <Stepper step={step} onStep={(index) => index < step && setStep(index)} />
      {error ? <Notice text={error} /> : null}

      {step === 0 ? (
        <Panel style={styles.stack}>
          <Text style={styles.name}>Import contacts</Text>
          <Text style={styles.kicker}>Supported formats</Text>
          <View style={styles.formats}>
            {formats.map((format) => (
              <View key={format.name} style={styles.format}>
                <Text style={styles.formatName}>{format.name}</Text>
                <Text style={styles.meta}>{format.detail}</Text>
              </View>
            ))}
          </View>
          <Button
            label="Download Rolodex template"
            tone="ghost"
            onPress={() => {
              setTemplateNote('')
              setError('')
              void download('/api/contacts/import-template', 'rolodex-contacts.csv', 'GET')
                .then(() => setTemplateNote('rolodex-contacts.csv downloaded. Replace the example row, then import that file.'))
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not download the template'))
            }}
          />
          {templateNote ? <Text style={styles.meta}>{templateNote}</Text> : null}
          {Platform.OS === 'web'
            ? createElement('input', {
                ref: (node: { click: () => void; value: string } | null) => {
                  fileRef.current = node
                },
                type: 'file',
                accept: '.vcf,.csv,text/vcard,text/csv,text/plain',
                style: { display: 'none' },
                onChange: async (event: { target: { files?: FileList | null; value: string } }) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  setFileName(file.name)
                  setFileText(await file.text())
                  setPreview(null)
                  setImported(false)
                  setError('')
                },
              })
            : null}
          <Button label={fileName ? 'Choose a different file' : 'Choose file'} onPress={() => fileRef.current?.click()} />
          {fileName ? <Text style={styles.meta}>{fileName} is ready.</Text> : null}
          <Button label="Continue" disabled={!fileText || busy} onPress={() => setStep(1)} />
        </Panel>
      ) : null}

      {step === 1 ? (
        <Panel style={styles.stack}>
          <Text style={styles.name}>Address book</Text>
          <Text style={styles.meta}>Choose where these contacts go. Type to narrow the list.</Text>
          {bookError ? <Notice text={bookError} /> : null}
          <AddressBookPicker books={books} bookId={bookId} busy={busy} onSelect={setBookId} onCreate={createBook} />
          <View style={styles.actions}>
            <Button label="Back" tone="ghost" onPress={() => setStep(0)} />
            <Button label="Continue" disabled={!bookId || busy} onPress={continueBook} />
          </View>
        </Panel>
      ) : null}

      {step === 2 ? (
        <Panel style={styles.stack}>
          <Text style={styles.name}>{book ? book.name : 'Review'}</Text>
          {busy && !preview ? <Text style={styles.meta}>Reading contacts…</Text> : null}
          {preview ? (
            <>
              <Text style={styles.meta}>
                {imported
                  ? `Added ${preview.created}. Skipped ${preview.skipped} that already match an email or phone.`
                  : `${preview.contacts.length} contacts. Matches on email or phone are skipped when you import.`}
              </Text>
              <TextInput value={query} onChangeText={setQuery} placeholder="Search this table" placeholderTextColor={theme.muted} style={styles.search} />
              <ScrollView horizontal style={styles.tableScroll}>
                <View>
                  <View style={styles.head}>
                    {columns.map((column) => (
                      <Text key={column} style={[styles.cell, styles.headText, column === 'Name' && styles.nameCell, column === 'Email' && styles.emailCell]}>
                        {column}
                      </Text>
                    ))}
                    {imported ? <Text style={[styles.cell, styles.headText]}>Status</Text> : null}
                  </View>
                  <ScrollView style={styles.body}>
                    {rows.map((row, index) => (
                      <View key={`${row.fingerprint}-${index}`} style={styles.row}>
                        <Text style={[styles.cell, styles.nameCell]}>{row.displayName}</Text>
                        <Text style={styles.cell}>{row.organization}</Text>
                        <Text style={[styles.cell, styles.emailCell]}>{row.email}</Text>
                        <Text style={styles.cell}>{row.phone}</Text>
                        <Text style={styles.cell}>{row.city}</Text>
                        <Text style={styles.cell}>{row.birthday}</Text>
                        <Text style={styles.cell}>{row.duplicates.map((item) => item.displayName).join(', ')}</Text>
                        {imported ? <Text style={styles.cell}>{row.duplicates.length ? 'Skipped' : 'Added'}</Text> : null}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </ScrollView>
            </>
          ) : null}
          <View style={styles.actions}>
            <Button label="Back" tone="ghost" onPress={() => setStep(1)} />
            <Button label={imported ? 'Imported' : busy ? 'Importing…' : 'Import'} disabled={!preview || imported || busy} onPress={() => void commit()} />
          </View>
        </Panel>
      ) : null}
    </View>
  )
}

function AddressBookPicker({
  books,
  bookId,
  busy,
  onSelect,
  onCreate,
}: {
  books: AddressBook[]
  bookId: string
  busy: boolean
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<void>
}) {
  const selected = books.find((item) => item.id === bookId)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const hold = useRef(false)
  const needle = filter.trim().toLowerCase()
  const shown = books.filter((item) => item.name.toLowerCase().includes(needle))

  function close() {
    setOpen(false)
    setCreating(false)
    setFilter('')
    setDraft('')
  }

  return (
    <View style={styles.picker}>
      <View style={styles.pickerField}>
        <TextInput
          accessibilityLabel="Address book"
          value={open ? filter : selected?.name ?? ''}
          placeholder={selected ? selected.name : 'Choose an address book'}
          placeholderTextColor={theme.muted}
          style={styles.pickerInput}
          onPressIn={() => setOpen(true)}
          onFocus={() => {
            setOpen(true)
            setFilter('')
            setCreating(false)
          }}
          onChangeText={(value) => {
            setFilter(value)
            setOpen(true)
            setCreating(false)
          }}
          onBlur={() => {
            setTimeout(() => {
              if (hold.current) {
                hold.current = false
                return
              }
              close()
            }, 180)
          }}
        />
        <Text style={styles.chevron}>▾</Text>
      </View>
      {open ? (
        <View style={styles.menu}>
          <ScrollView style={styles.menuList} keyboardShouldPersistTaps="handled">
            {shown.map((item) => (
              <Pressable
                key={item.id}
                accessibilityLabel={item.name}
                onPressIn={() => {
                  hold.current = true
                }}
                onPress={() => {
                  onSelect(item.id)
                  close()
                }}
                style={[styles.menuItem, item.id === bookId && styles.menuItemOn]}
              >
                <Text style={styles.menuText}>{item.name}</Text>
              </Pressable>
            ))}
            {shown.length === 0 ? <Text style={styles.menuEmpty}>No matching address books</Text> : null}
          </ScrollView>
          {creating ? (
            <View style={styles.createRow}>
              <TextInput
                accessibilityLabel="New address book name"
                autoFocus
                value={draft}
                placeholder="Address book name"
                placeholderTextColor={theme.muted}
                style={styles.pickerInput}
                onChangeText={setDraft}
                onFocus={() => {
                  hold.current = true
                }}
              />
              <Pressable
                accessibilityLabel="Create address book"
                disabled={busy || !draft.trim()}
                onPressIn={() => {
                  hold.current = true
                }}
                onPress={() => {
                  void onCreate(draft.trim())
                    .then(() => close())
                    .catch(() => {})
                }}
                style={[styles.createButton, (!draft.trim() || busy) && styles.createButtonOff]}
              >
                <Text style={styles.createButtonText}>Create</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityLabel="Create a new address book"
              onPressIn={() => {
                hold.current = true
              }}
              onPress={() => {
                setCreating(true)
                setDraft(filter.trim())
              }}
              style={styles.createItem}
            >
              <Text style={styles.createText}>+ Create a New Address Book</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  )
}

function Stepper({ step, onStep }: { step: number; onStep: (index: number) => void }) {
  return (
    <View style={styles.stepper}>
      {steps.map((label, index) => {
        const reached = index <= step
        const current = index === step
        return (
          <Fragment key={label}>
            <Pressable
              accessibilityLabel={`Step ${index + 1}, ${label}`}
              accessibilityState={{ selected: current, disabled: index > step }}
              disabled={index > step}
              onPress={() => onStep(index)}
              style={styles.stepHit}
            >
              <View style={[styles.bullet, reached && styles.bulletOn]}>
                <Text style={[styles.bulletText, reached && styles.bulletTextOn]}>{index < step ? '✓' : index + 1}</Text>
              </View>
              <Text style={[styles.stepLabel, current && styles.stepLabelOn, index > step && styles.stepLabelOff]}>{label}</Text>
            </Pressable>
            {index < steps.length - 1 ? <View style={[styles.connector, index < step && styles.connectorOn]} /> : null}
          </Fragment>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  stack: { gap: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepHit: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bullet: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletOn: { backgroundColor: theme.text, borderColor: theme.text },
  bulletText: { fontFamily: font, fontSize: 13, fontWeight: '700', color: theme.muted },
  bulletTextOn: { color: theme.on },
  stepLabel: { fontFamily: font, fontSize: 14, fontWeight: '600', color: theme.text },
  stepLabelOn: { fontWeight: '700' },
  stepLabelOff: { color: theme.muted, fontWeight: '500' },
  connector: { flexGrow: 1, flexShrink: 1, height: 2, minWidth: 24, marginHorizontal: 14, borderRadius: 1, backgroundColor: theme.border },
  connectorOn: { backgroundColor: theme.text },
  kicker: { fontFamily: font, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: theme.muted },
  formats: { gap: 8 },
  format: { gap: 2 },
  formatName: { fontFamily: font, fontSize: 14, fontWeight: '700', color: theme.text },
  name: { fontFamily: font, fontSize: 16, fontWeight: '600', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  picker: { gap: 6, zIndex: 2 },
  pickerField: { justifyContent: 'center' },
  pickerInput: {
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.raised,
    color: theme.text,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingRight: 36,
    fontFamily: font,
    fontSize: 15,
  },
  chevron: { position: 'absolute', right: 14, fontFamily: font, color: theme.muted, fontSize: 14 },
  menu: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 14, overflow: 'hidden' },
  menuList: { maxHeight: 220 },
  menuItem: { paddingHorizontal: 14, paddingVertical: 11 },
  menuItemOn: { backgroundColor: theme.accentMuted },
  menuText: { fontFamily: font, color: theme.text, fontSize: 15 },
  menuEmpty: { fontFamily: font, color: theme.muted, fontSize: 14, paddingHorizontal: 14, paddingVertical: 11 },
  createItem: { borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 14, paddingVertical: 12 },
  createText: { fontFamily: font, color: theme.text, fontSize: 15, fontWeight: '600' },
  createRow: { borderTopWidth: 1, borderTopColor: theme.border, padding: 10, gap: 8 },
  createButton: { backgroundColor: theme.text, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  createButtonOff: { opacity: 0.45 },
  createButtonText: { fontFamily: font, color: theme.on, fontSize: 14, fontWeight: '600' },
  search: {
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: font,
  },
  tableScroll: { borderWidth: 1, borderColor: theme.border, borderRadius: 12 },
  head: { flexDirection: 'row', backgroundColor: theme.raised },
  body: { maxHeight: 480 },
  row: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.border },
  cell: { width: 150, paddingHorizontal: 10, paddingVertical: 8, fontFamily: font, color: theme.text, fontSize: 13 },
  nameCell: { width: 190 },
  emailCell: { width: 230 },
  headText: { fontWeight: '600' },
})
