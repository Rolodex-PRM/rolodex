import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { api, type AddressBook, type ContactSummary } from '../../../src/api'
import { ContactsMap } from '../../../src/contacts-map'
import { ContactsTable } from '../../../src/contacts-table'
import { AuthImage } from '../../../src/immich-photos'
import { useAuth } from '../../../src/auth'
import { Loader } from '../../../src/logo'
import { font, theme } from '../../../src/theme'
import { Button } from '../../../src/ui'

const pageSize = 48

export default function Contacts() {
  const { workspace } = useAuth()
  const router = useRouter()
  const wide = useWindowDimensions().width >= 880
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [bookId, setBookId] = useState('')
  const [rows, setRows] = useState<ContactSummary[]>([])
  const [total, setTotal] = useState(0)
  const [books, setBooks] = useState<AddressBook[]>([])
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const generation = useRef(0)
  const loadingMoreRef = useRef(false)
  const [view, setView] = useState<'card' | 'table' | 'map'>('card')
  const canWrite = workspace?.role === 'owner' || workspace?.role === 'administrator' || workspace?.role === 'editor'

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const saved = sessionStorage.getItem('rolodex.contacts.view')
    if (saved === 'card' || saved === 'table' || saved === 'map') setView(saved)
  }, [])

  function chooseView(next: 'card' | 'table' | 'map') {
    setView(next)
    if (Platform.OS === 'web') sessionStorage.setItem('rolodex.contacts.view', next)
  }

  useEffect(() => {
    if (!workspace) return
    api<AddressBook[]>(`/api/workspaces/${workspace.id}/address-books`).then(setBooks).catch((caught: Error) => setError(caught.message))
    api<{ id: string; name: string }[]>(`/api/workspaces/${workspace.id}/tags`).then(setTags).catch(() => setTags([]))
  }, [workspace])

  const selectedBook = books.find((book) => book.id === bookId)

  function contactQuery(offset: number) {
    const scope = selectedBook?.workspaceId ?? workspace?.id
    const params = new URLSearchParams()
    params.set('limit', String(pageSize))
    params.set('offset', String(offset))
    if (q.trim()) params.set('q', q.trim())
    if (selectedBook) params.set('addressBookId', selectedBook.id)
    if (tag) params.set('tag', tag)
    return { scope, path: `/api/workspaces/${scope}/contacts?${params}` }
  }

  useEffect(() => {
    if (!workspace) return
    const id = ++generation.current
    loadingMoreRef.current = false
    setLoadingMore(false)
    const handle = setTimeout(() => {
      const query = contactQuery(0)
      if (!query.scope) return
      api<{ contacts: ContactSummary[]; total: number }>(query.path)
        .then((result) => {
          if (generation.current !== id) return
          setRows(result.contacts)
          setTotal(result.total)
          setError('')
        })
        .catch((caught: Error) => {
          if (generation.current !== id) return
          setError(caught.message)
        })
        .finally(() => {
          if (generation.current === id) setLoaded(true)
        })
    }, 200)
    return () => clearTimeout(handle)
  }, [workspace, q, selectedBook, tag])

  function loadMore() {
    if (!workspace || loadingMoreRef.current || rows.length >= total) return
    const id = generation.current
    const query = contactQuery(rows.length)
    if (!query.scope) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    api<{ contacts: ContactSummary[]; total: number }>(query.path)
      .then((result) => {
        if (generation.current !== id) return
        const seen = new Set(rows.map((contact) => contact.id))
        const added = result.contacts.filter((contact) => !seen.has(contact.id))
        if (!added.length) {
          setTotal(rows.length)
          return
        }
        setTotal(result.total)
        setRows([...rows, ...added])
      })
      .catch((caught: Error) => {
        if (generation.current === id) setError(caught.message)
      })
      .finally(() => {
        loadingMoreRef.current = false
        if (generation.current === id) setLoadingMore(false)
      })
  }

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>{workspace?.name}</Text>
          <Text style={styles.title}>Contacts</Text>
          <Text style={styles.meta}>{loaded ? `${total.toLocaleString()} ${total === 1 ? 'person' : 'people'}` : ''}</Text>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.filters}>
            {(['card', 'table', 'map'] as const).map((item) => (
              <Pressable key={item} onPress={() => chooseView(item)} style={[styles.filter, view === item && styles.filterActive]}>
                <Text style={[styles.filterText, view === item && styles.filterTextActive]}>{item[0]!.toUpperCase() + item.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
          <Button label="New contact" onPress={() => router.push('/contacts/new')} />
        </View>
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search people, companies, notes, or birthdays"
        placeholderTextColor={theme.muted}
        style={styles.search}
      />
      <View style={styles.filters}>
        <Pressable onPress={() => setBookId('')} style={[styles.filter, !bookId && styles.filterActive]}>
          <Text style={[styles.filterText, !bookId && styles.filterTextActive]}>All books</Text>
        </Pressable>
        {books.map((book) => (
          <Pressable key={book.id} onPress={() => setBookId(book.id === bookId ? '' : book.id)} style={[styles.filter, bookId === book.id && styles.filterActive]}>
            <Text style={[styles.filterText, bookId === book.id && styles.filterTextActive]}>{book.shared ? `${book.name} · shared` : book.name}</Text>
          </Pressable>
        ))}
      </View>
      {tags.length ? (
        <View style={styles.filters}>
          {tags.map((item) => (
            <Pressable key={item.id} onPress={() => setTag(tag === item.name ? '' : item.name)} style={[styles.tag, tag === item.name && styles.tagActive]}>
              <Text style={[styles.tagText, tag === item.name && styles.tagTextActive]}>{item.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loaded ? <Loader /> : null}
      {loaded && view === 'table' ? <ContactsTable contacts={rows} onOpen={(contact) => router.push(`/contacts/${contact.id}?workspace=${contact.workspaceId}`)} /> : null}
      {loaded && view === 'map' ? <ContactsMap contacts={rows} canWrite={canWrite} onOpen={(contact) => router.push(`/contacts/${contact.id}?workspace=${contact.workspaceId}`)} /> : null}
      {loaded && view === 'card' ? <View style={[styles.grid, wide && styles.gridWide]}>
        {rows.map((contact) => (
          <Pressable
            key={contact.id}
            onPress={() => router.push(`/contacts/${contact.id}?workspace=${contact.workspaceId}`)}
            style={styles.card}
          >
            <View style={styles.avatarSlot}>
              {contact.hasPhoto ? (
                <AuthImage
                  path={`/api/workspaces/${contact.workspaceId}/contacts/${contact.id}/photo`}
                  size={42}
                  radius={21}
                  fallback={
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text>
                    </View>
                  }
                />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
            </View>
            <Text style={styles.name}>{contact.displayName}</Text>
            <Text style={styles.detail}>{[contact.title, contact.organizationName].filter(Boolean).join(' · ') || 'No organization'}</Text>
            <Text style={styles.detail}>{contact.primaryEmail || contact.primaryPhone || 'No email or phone'}</Text>
            <View style={styles.cardTags}>
              {contact.addressBooks.map((book) => (
                <Text key={book.id} style={styles.book}>{book.name}</Text>
              ))}
              {contact.tags.map((item) => (
                <Text key={item.id} style={styles.cardTag}>{item.name}</Text>
              ))}
            </View>
          </Pressable>
        ))}
      </View> : null}
      {loaded && rows.length < total ? <LoadMore loading={loadingMore} onLoad={loadMore} /> : null}
      {loaded && !rows.length ? <Text style={styles.detail}>No contacts yet.</Text> : null}
    </View>
  )
}

function LoadMore({ loading, onLoad }: { loading: boolean; onLoad: () => void }) {
  const nodeRef = useRef<Element | null>(null)
  const onLoadRef = useRef(onLoad)
  onLoadRef.current = onLoad

  useEffect(() => {
    if (loading || Platform.OS !== 'web') return
    const node = nodeRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadRef.current()
    }, { rootMargin: '480px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [loading])

  return (
    <View ref={(node) => { nodeRef.current = node as unknown as Element | null }} style={styles.more}>
      <Button label={loading ? 'Loading…' : 'Load more'} tone="ghost" onPress={onLoad} disabled={loading} />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  kicker: { fontFamily: font, color: theme.muted, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontFamily: font, fontSize: 40, fontWeight: '700', color: theme.text, letterSpacing: -1 },
  meta: { fontFamily: font, color: theme.muted, marginTop: 4 },
  search: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 14, fontFamily: font, fontSize: 15, color: theme.text },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  filterActive: { backgroundColor: theme.text, borderColor: theme.text },
  filterText: { fontFamily: font, color: theme.text, fontSize: 13 },
  filterTextActive: { color: theme.on },
  tag: { backgroundColor: theme.accentMuted, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  tagActive: { backgroundColor: theme.text },
  tagText: { fontFamily: font, color: theme.text, fontSize: 12 },
  tagTextActive: { color: theme.on },
  grid: { gap: 12 },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { backgroundColor: theme.surface, borderRadius: 22, borderWidth: 1, borderColor: theme.border, padding: 18, gap: 6, width: '100%', maxWidth: 340 },
  avatarSlot: { marginBottom: 6 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.accentMuted, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: theme.text, fontFamily: font, fontWeight: '700' },
  name: { fontFamily: font, fontSize: 18, color: theme.text, fontWeight: '700' },
  detail: { fontFamily: font, color: theme.muted, fontSize: 13 },
  cardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  book: { fontFamily: font, fontSize: 12, color: theme.text, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  cardTag: { fontFamily: font, fontSize: 12, color: theme.on, backgroundColor: theme.text, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  error: { color: theme.danger, fontFamily: font },
  more: { alignItems: 'flex-start' },
})
