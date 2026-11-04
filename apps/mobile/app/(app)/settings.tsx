import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { AddressBooksPage } from './books'
import { DuplicatesPage } from './duplicates'
import { OrganizationsPage } from './organizations'
import { accentPresets, useAccent } from '../../src/accent'
import { readCoverSeconds, writeCoverSeconds } from '../../src/cover-timing'
import { AccountsPanel } from '../../src/accounts-panel'
import { api, download } from '../../src/api'
import { SyncClients } from '../../src/sync-clients'
import { TrashPanel } from '../../src/trash-panel'
import { TwoFactorPanel } from '../../src/two-factor-panel'
import { useAuth } from '../../src/auth'
import { installCustomCss, userCssKey, type Appearance } from '../../src/custom-css'
import { font, theme } from '../../src/theme'
import { Button, Field, Notice, Panel } from '../../src/ui'

const tabs = [
  { id: 'general', label: 'General' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'books', label: 'Address books' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'trash', label: 'Trash' },
  { id: 'accounts', label: 'Mail and calendars' },
] as const

export default function Settings() {
  const params = useLocalSearchParams<{ tab?: string }>()
  const requested = typeof params.tab === 'string' ? params.tab : 'general'
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>(tabs.some((item) => item.id === requested) ? requested as (typeof tabs)[number]['id'] : 'general')
  useEffect(() => {
    if (tabs.some((item) => item.id === requested)) setTab(requested as (typeof tabs)[number]['id'])
  }, [requested])
  const { session, workspace } = useAuth()
  const canManage = workspace?.role === 'owner' || workspace?.role === 'administrator'
  const { accent, setAccent } = useAccent()
  const [draft, setDraft] = useState(accent)
  const [colorError, setColorError] = useState('')
  const [coverSeconds, setCoverSeconds] = useState('60')
  const [coverNotice, setCoverNotice] = useState('')

  useEffect(() => setDraft(accent), [accent])
  useEffect(() => setCoverSeconds(String(readCoverSeconds())), [])
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

  async function runBackup() {
    setBackup('')
    setBackupError('')
    try {
      await download('/api/backups', `rolodex-${new Date().toISOString().slice(0, 10)}.sql`)
      setBackup('The database backup downloaded.')
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
      {tab === 'trash' ? <TrashPanel /> : null}
      {tab === 'accounts' ? (canManage ? <AccountsPanel /> : <Text style={styles.meta}>Only owners and administrators can connect a mailbox or calendar.</Text>) : null}
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
      <SyncClients />
      <TwoFactorPanel />
      <Panel>
        <Text style={styles.name}>Backup</Text>
        <Text style={styles.meta}>Owners can download a database backup when pg_dump is installed. scripts/backup.sh also archives photos.</Text>
        <Button label="Download database backup" tone="ghost" onPress={() => void runBackup()} />
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
