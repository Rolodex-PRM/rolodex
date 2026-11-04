import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { AddressBooksPage } from './books'
import { DuplicatesPage } from './duplicates'
import { OrganizationsPage } from './organizations'
import { accentPresets, useAccent } from '../../src/accent'
import { readCoverSeconds, writeCoverSeconds } from '../../src/cover-timing'
import { api, type AppPassword } from '../../src/api'
import { useAuth } from '../../src/auth'
import { installCustomCss, userCssKey, type Appearance } from '../../src/custom-css'
import { font, theme } from '../../src/theme'
import { PhoneSync } from '../../src/phone-sync'
import { Button, Field, Notice, Panel } from '../../src/ui'

const tabs = [
  { id: 'general', label: 'General' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'books', label: 'Address books' },
  { id: 'duplicates', label: 'Duplicates' },
] as const

export default function Settings() {
  const params = useLocalSearchParams<{ tab?: string }>()
  const requested = typeof params.tab === 'string' ? params.tab : 'general'
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>(tabs.some((item) => item.id === requested) ? requested as (typeof tabs)[number]['id'] : 'general')
  useEffect(() => {
    if (tabs.some((item) => item.id === requested)) setTab(requested as (typeof tabs)[number]['id'])
  }, [requested])
  const { session } = useAuth()
  const phone = phoneTarget(session?.carddavPhoneUrl)
  const { accent, setAccent } = useAccent()
  const [draft, setDraft] = useState(accent)
  const [colorError, setColorError] = useState('')
  const [coverSeconds, setCoverSeconds] = useState('60')
  const [coverNotice, setCoverNotice] = useState('')

  useEffect(() => setDraft(accent), [accent])
  useEffect(() => setCoverSeconds(String(readCoverSeconds())), [])
  const [passwords, setPasswords] = useState<AppPassword[]>([])
  const [label, setLabel] = useState('iPhone')
  const [created, setCreated] = useState('')
  const [error, setError] = useState('')
  const [backup, setBackup] = useState('')
  const [backupError, setBackupError] = useState('')
  const [userCssAllowed, setUserCssAllowed] = useState(false)
  const [personalCss, setPersonalCss] = useState('')
  const [cssNotice, setCssNotice] = useState('')

  useEffect(() => {
    api<Appearance>('/api/appearance').then((appearance) => setUserCssAllowed(appearance.userCss)).catch(() => setUserCssAllowed(false))
  }, [])

  useEffect(() => {
    if (!session || typeof localStorage === 'undefined') return
    setPersonalCss(localStorage.getItem(userCssKey(session.id)) || '')
  }, [session])

  function load() {
    api<AppPassword[]>('/api/app-passwords').then(setPasswords).catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [])

  async function create() {
    setError('')
    try {
      const result = await api<AppPassword & { password: string }>('/api/app-passwords', {
        method: 'POST',
        body: JSON.stringify({ label }),
      })
      setCreated(result.password)
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create a password')
    }
  }

  async function revoke(id: string) {
    await api(`/api/app-passwords/${id}`, { method: 'DELETE' })
    load()
  }

  async function runBackup() {
    setBackup('')
    setBackupError('')
    try {
      const result = await api<{ path: string }>('/api/backups', { method: 'POST' })
      setBackup(`Backup written to ${result.path}`)
    } catch (caught) {
      setBackupError(caught instanceof Error ? caught.message : 'Backup failed')
    }
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.tabs}>
        {tabs.map((item) => (
          <Pressable key={item.id} accessibilityLabel={item.label} onPress={() => setTab(item.id)} style={[styles.tab, tab === item.id && styles.tabOn]}>
            <Text style={[styles.tabText, tab === item.id && styles.tabTextOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'organizations' ? <OrganizationsPage /> : null}
      {tab === 'books' ? <AddressBooksPage /> : null}
      {tab === 'duplicates' ? <DuplicatesPage /> : null}
      {tab === 'general' ? <>
      <Panel>
        <Text style={styles.name}>Accent color</Text>
        <Text style={styles.meta}>Buttons use this color. It is saved for this account in this browser.</Text>
        <View style={styles.swatches}>
          {accentPresets.map((preset) => (
            <Pressable
              key={preset.value}
              accessibilityLabel={preset.name}
              onPress={() => {
                setAccent(preset.value)
                setDraft(preset.value)
                setColorError('')
              }}
              style={[styles.swatch, { backgroundColor: preset.value }, accent === preset.value && styles.swatchOn]}
            />
          ))}
        </View>
        <Field label="Custom hex" autoCapitalize="none" value={draft} onChangeText={setDraft} placeholder="#1d4ed8" />
        <Button
          label="Use this color"
          onPress={() => {
            const next = draft.startsWith('#') ? draft : `#${draft}`
            if (!/^#[0-9a-fA-F]{6}$/.test(next)) {
              setColorError('Use a color like #1d4ed8')
              return
            }
            setColorError('')
            setAccent(next)
          }}
        />
        {colorError ? <Notice text={colorError} /> : null}
      </Panel>
      <Panel>
        <Text style={styles.name}>Cover photos</Text>
        <Text style={styles.meta}>Each cover photo stays on screen for this many seconds, then fades into the next. Saved in this browser.</Text>
        <Field label="Seconds on screen" keyboardType="number-pad" value={coverSeconds} onChangeText={setCoverSeconds} placeholder="60" />
        <Button
          label="Save timing"
          onPress={() => {
            const value = Number(coverSeconds)
            if (!Number.isFinite(value)) return
            const saved = writeCoverSeconds(value)
            setCoverSeconds(String(saved))
            setCoverNotice(`Each photo stays for ${saved} seconds`)
          }}
        />
        {coverNotice ? <Text style={styles.meta}>{coverNotice}</Text> : null}
      </Panel>
      {userCssAllowed ? (
        <Panel>
          <Text style={styles.name}>Your CSS</Text>
          <Text style={styles.meta}>This is saved in this browser and applied after the server CSS.</Text>
          <TextInput multiline value={personalCss} onChangeText={setPersonalCss} placeholder="button { border-radius: 4px; }" placeholderTextColor={theme.muted} style={styles.editor} />
          {cssNotice ? <Text style={styles.meta}>{cssNotice}</Text> : null}
          <Button
            label="Save CSS"
            onPress={() => {
              if (!session || typeof localStorage === 'undefined') return
              localStorage.setItem(userCssKey(session.id), personalCss)
              void api<Appearance>('/api/appearance').then((appearance) => {
                installCustomCss(appearance.css, personalCss)
                setCssNotice('Your CSS is saved in this browser')
              })
            }}
          />
        </Panel>
      ) : null}
      <Panel>
        <Text style={styles.name}>Push on this browser</Text>
        <Text style={styles.meta}>An administrator turns on server push. This browser then receives reminder notifications.</Text>
        <PushOptIn />
      </Panel>
      <Panel>
        <Text style={styles.name}>iPhone contacts</Text>
        <Text style={styles.meta}>The iPhone checks this account on its own schedule. Create an application password below and type that on the iPhone.</Text>
        <Text style={styles.meta}>Username</Text>
        <Text style={styles.value}>{session?.email}</Text>
        {phone ? (
          <>
            <Text style={styles.meta}>Server</Text>
            <Text style={styles.value}>{phone.host}</Text>
            <Text style={styles.meta}>{phone.ssl ? `Port ${phone.port}. Leave SSL on.` : `Port ${phone.port}. Turn SSL off.`}</Text>
            <Text style={styles.meta}>
              On the iPhone, open Settings, Contacts, Accounts, Add Account, Other, Add CardDAV Account. The Server field is only {phone.host}. Leave http:// and the port out of that field. User Name is the email above, and the password is an application password. Open Advanced, turn SSL off, and set the port to {phone.port}. The Contacts address book is the one that already has your Rolodex people. Add a separate CalDAV account in Calendar with the same server, email, password, and port. Events are the Rolodex calendar. Tasks are the Tasks calendar.
            </Text>
          </>
        ) : (
          <Text style={styles.meta}>Server {session?.carddavUrl}</Text>
        )}
        <PhoneSync
          lastCheckedIn={passwords.reduce<string | null>((latest, item) => {
            if (!item.lastUsedAt) return latest
            if (!latest || item.lastUsedAt > latest) return item.lastUsedAt
            return latest
          }, null)}
        />
        {Platform.OS === 'web' && session ? (
          <Button
            label="Copy server address"
            tone="ghost"
            onPress={() => {
              void navigator.clipboard.writeText(phone?.host || session.carddavUrl)
            }}
          />
        ) : null}
      </Panel>
      <Panel>
        <Text style={styles.name}>Application passwords</Text>
        {error ? <Notice text={error} /> : null}
        {created ? <Text style={styles.secret}>Copy this password now. It will not be shown again. {created}</Text> : null}
        {passwords.map((item) => (
          <View key={item.id} style={styles.row}>
            <Text style={styles.value}>{item.label}</Text>
            <Button label="Revoke" tone="danger" onPress={() => void revoke(item.id)} />
          </View>
        ))}
        <Field label="Label" value={label} onChangeText={setLabel} />
        <Button label="Create password" onPress={() => void create()} />
      </Panel>
      <Panel>
        <Text style={styles.name}>Backup</Text>
        <Text style={styles.meta}>Owners can dump the database here when pg_dump is installed. scripts/backup.sh also archives photos.</Text>
        <Button label="Create database backup" tone="ghost" onPress={() => void runBackup()} />
        {backupError ? <Notice text={backupError} /> : null}
        {backup ? <Text style={styles.meta}>{backup}</Text> : null}
      </Panel>
      </> : null}
    </View>
  )
}

function PushOptIn() {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function enable() {
    setError('')
    setMessage('')
    if (Platform.OS !== 'web' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setError('This browser cannot receive push notifications')
      return
    }
    const config = await api<{ enabled: boolean; publicKey: string }>('/api/notifications/push')
    if (!config.enabled || !config.publicKey) {
      setError('An administrator has not turned on push')
      return
    }
    const registration = await navigator.serviceWorker.register('/push-sw.js')
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesFromBase64(config.publicKey) })
    const json = subscription.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
      setError('The browser did not return a push subscription')
      return
    }
    await api('/api/notifications/push', { method: 'POST', body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) })
    setMessage('This browser will receive push notifications')
  }

  return (
    <View>
      {error ? <Notice text={error} /> : null}
      {message ? <Text style={styles.meta}>{message}</Text> : null}
      <Button label="Enable on this browser" tone="ghost" onPress={() => void enable().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not enable push'))} />
    </View>
  )
}

function phoneTarget(value?: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    return { host: url.hostname, port, ssl: url.protocol === 'https:' }
  } catch {
    return null
  }
}

function bytesFromBase64(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  tabOn: { backgroundColor: theme.text, borderColor: theme.text },
  tabText: { fontFamily: font, color: theme.text, fontSize: 13 },
  tabTextOn: { color: theme.on },
  name: { fontFamily: font, fontSize: 16, fontWeight: '600', color: theme.text, marginBottom: 8 },
  meta: { fontFamily: font, color: theme.muted, marginBottom: 6 },
  value: { fontFamily: font, color: theme.text, fontSize: 15, marginBottom: 8 },
  secret: { fontFamily: font, color: theme.text, backgroundColor: theme.accentMuted, padding: 10, borderRadius: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: theme.text },
  editor: {
    minHeight: 160,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.raised,
    color: theme.text,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    textAlignVertical: 'top',
  },
})
