import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api, type AddressBook, type Contact } from './api'
import { useAuth } from './auth'
import { AddressEditor } from './address-editor'
import { cadences } from './cadence'
import { TagField } from './fields'
import { Choice } from './people'
import { MethodList, type MethodDraft } from './methods'
import { SocialList } from './socials'
import { OrganizationField } from './organization-field'
import { font, theme } from './theme'
import { Button, DateField, Field, Notice } from './ui'

export function ContactForm({
  contact,
  onSaved,
}: {
  contact?: Contact
  onSaved: (id: string) => void
}) {
  const { workspace } = useAuth()
  const [books, setBooks] = useState<AddressBook[]>([])
  const [addressBookIds, setAddressBookIds] = useState<string[]>(
    contact?.addressBooks?.map((book) => book.id) ?? (contact?.addressBookId ? [contact.addressBookId] : []),
  )
  const [knownTags, setKnownTags] = useState<string[]>([])
  const [firstName, setFirstName] = useState(contact?.firstName ?? '')
  const [lastName, setLastName] = useState(contact?.lastName ?? '')
  const [preferredName, setPreferredName] = useState(contact?.preferredName ?? '')
  const [organizationName, setOrganizationName] = useState(contact?.organizationName ?? '')
  const [title, setTitle] = useState(contact?.title ?? '')
  const [website, setWebsite] = useState(contact?.website ?? '')
  const [birthday, setBirthday] = useState(contact?.birthday ?? '')
  const [cardNote, setCardNote] = useState(contact?.cardNote ?? '')
  const [howWeMet, setHowWeMet] = useState(contact?.howWeMet ?? '')
  const [interests, setInterests] = useState(contact?.interests ?? '')
  const [cadence, setCadence] = useState(contact?.followUpFrequency ?? '')
  const [emails, setEmails] = useState<MethodDraft[]>(
    contact?.methods.filter((method) => method.kind === 'email').map((method) => ({ label: method.label, value: method.value })) ?? [
      { label: 'home', value: '' },
    ],
  )
  const [phones, setPhones] = useState<MethodDraft[]>(
    contact?.methods.filter((method) => method.kind === 'phone').map((method) => ({ label: method.label, value: method.value })) ?? [
      { label: 'home', value: '' },
    ],
  )
  const [socials, setSocials] = useState<MethodDraft[]>(
    contact?.methods.filter((method) => method.kind === 'social').map((method) => ({ label: method.label, value: method.value })) ?? [
      { label: 'linkedin', value: '' },
    ],
  )
  const [street, setStreet] = useState(contact?.addresses[0]?.street ?? '')
  const [city, setCity] = useState(contact?.addresses[0]?.city ?? '')
  const [region, setRegion] = useState(contact?.addresses[0]?.region ?? '')
  const [postalCode, setPostalCode] = useState(contact?.addresses[0]?.postalCode ?? '')
  const [country, setCountry] = useState(contact?.addresses[0]?.country ?? '')
  const [tagNames, setTagNames] = useState<string[]>(contact?.tags.map((tag) => tag.name) ?? [])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!workspace) return
    api<AddressBook[]>(`/api/workspaces/${workspace.id}/address-books`)
      .then((rows) => {
        const own = rows.filter((book) => book.workspaceId === workspace.id)
        setBooks(own)
        if (!contact) setAddressBookIds((current) => (current.length ? current : own[0] ? [own[0].id] : []))
      })
      .catch((caught: Error) => setError(caught.message))
    api<{ name: string }[]>(`/api/workspaces/${workspace.id}/tags`)
      .then((rows) => setKnownTags(rows.map((row) => row.name)))
      .catch(() => setKnownTags([]))
  }, [workspace, contact])

  async function save() {
    if (!workspace) return
    if (!addressBookIds.length) {
      setError('Choose at least one address book')
      return
    }
    setPending(true)
    setError('')
    const methods = [
      ...emails.map((method) => ({ kind: 'email' as const, ...method })),
      ...phones.map((method) => ({ kind: 'phone' as const, ...method })),
      ...socials.map((method) => ({ kind: 'social' as const, ...method })),
    ].filter((method) => method.value.trim())
    const body = {
      addressBookIds,
      firstName,
      lastName,
      preferredName,
      organizationName,
      title,
      website,
      birthday: birthday.trim() || null,
      cardNote,
      howWeMet,
      interests,
      followUpFrequency: cadence || null,
      methods,
      addresses: street || city || region || postalCode || country ? [{ label: 'home', street, city, region, postalCode, country }] : [],
      tagNames,
    }
    try {
      const saved = contact
        ? await api<Contact>(`/api/workspaces/${workspace.id}/contacts/${contact.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api<Contact>(`/api/workspaces/${workspace.id}/contacts`, { method: 'POST', body: JSON.stringify(body) })
      onSaved(saved.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the contact')
    } finally {
      setPending(false)
    }
  }

  return (
    <View style={styles.form}>
      {error ? <Notice text={error} /> : null}
      <Text style={styles.section}>Address books</Text>
      <BookSelect books={books} selected={addressBookIds} onChange={setAddressBookIds} />
      <View style={styles.row}>
        <Field style={styles.grow} label="First name" value={firstName} onChangeText={setFirstName} />
        <Field style={styles.grow} label="Last name" value={lastName} onChangeText={setLastName} />
      </View>
      <View style={styles.row}>
        <Field label="Preferred name" value={preferredName} onChangeText={setPreferredName} hint="How you refer to them. The phone still uses the first and last name." />
        <Field label="Title" value={title} onChangeText={setTitle} hint="Job title, such as Director." />
      </View>
      <OrganizationField value={organizationName} onChange={setOrganizationName} onError={setError} />
      <MethodList key="email" kind="email" rows={emails} onChange={setEmails} />
      <MethodList key="phone" kind="phone" rows={phones} onChange={setPhones} />
      <SocialList rows={socials.length ? socials : [{ label: 'linkedin', value: '' }]} onChange={setSocials} />
      <AddressEditor
        workspaceId={workspace?.id}
        value={{ street, city, region, postalCode, country }}
        onChange={(next) => {
          setStreet(next.street)
          setCity(next.city)
          setRegion(next.region)
          setPostalCode(next.postalCode)
          setCountry(next.country)
        }}
      />
      <DateField label="Birthday" value={birthday} onChange={setBirthday} />
      <Field label="Website" autoCapitalize="none" value={website} onChangeText={setWebsite} />
      <Field label="Card note" multiline value={cardNote} onChangeText={setCardNote} hint="This note syncs to the phone. Private notes on the person stay in Rolodex." />
      <Field label="How we met" value={howWeMet} onChangeText={setHowWeMet} hint="Stays in Rolodex. It is not sent to the phone." />
      <Field label="Interests" value={interests} onChangeText={setInterests} hint="Stays in Rolodex. It is not sent to the phone." />
      <Text style={styles.section}>Reach out</Text>
      <Text style={styles.hint}>Home uses this to suggest when to get back in touch.</Text>
      <View style={styles.chips}>
        <Choice label="No cadence" on={!cadence} onPress={() => setCadence('')} />
        {cadences.map((item) => (
          <Choice key={item.id} label={item.label} on={cadence === item.id} onPress={() => setCadence(item.id)} />
        ))}
      </View>
      <TagField tags={tagNames} suggestions={knownTags} onChange={setTagNames} />
      <Button label={pending ? 'Saving' : 'Save contact'} onPress={save} disabled={pending} />
    </View>
  )
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  section: { fontFamily: font, color: theme.muted, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  hint: { fontFamily: font, color: theme.muted, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})

function BookSelect({
  books,
  selected,
  onChange,
}: {
  books: AddressBook[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<View>(null)
  const names = books.filter((book) => selected.includes(book.id)).map((book) => book.name)

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const close = (event: PointerEvent) => {
      const node = root.current as unknown as { contains?: (target: Node) => boolean } | null
      if (node?.contains && event.target instanceof Node && node.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <View ref={root as never} style={bookStyles.wrap}>
      <Pressable accessibilityLabel="Address books" onPress={() => setOpen((current) => !current)} style={bookStyles.control}>
        <Text style={[bookStyles.value, !names.length && bookStyles.placeholder]}>{names.length ? names.join(', ') : 'Choose address books'}</Text>
        <Text style={bookStyles.chevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open ? (
        <View style={bookStyles.menu}>
          {books.map((book) => {
            const on = selected.includes(book.id)
            return (
              <Pressable
                key={book.id}
                onPress={() => onChange(on ? selected.filter((id) => id !== book.id) : [...selected, book.id])}
                style={bookStyles.option}
              >
                <View style={[bookStyles.box, on && bookStyles.boxOn]}>
                  {on ? <Text style={bookStyles.check}>✓</Text> : null}
                </View>
                <Text style={bookStyles.optionText}>{book.name}</Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

const bookStyles = StyleSheet.create({
  wrap: { gap: 6 },
  control: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  value: { flex: 1, fontFamily: font, fontSize: 15, color: theme.text },
  placeholder: { color: theme.muted },
  chevron: { fontFamily: font, fontSize: 14, color: theme.muted },
  menu: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  optionText: { fontFamily: font, fontSize: 15, color: theme.text },
  box: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: theme.text, borderColor: theme.text },
  check: { color: theme.on, fontSize: 12, fontWeight: '700', lineHeight: 14 },
})
