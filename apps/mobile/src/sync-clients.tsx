import { useEffect, useState, type ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { api, apiUrl, type AppPassword } from './api'
import { PhoneSync } from './phone-sync'
import { SyncStatus } from './sync-status'
import { useAuth } from './auth'
import { font, theme } from './theme'
import { Button, Field, Notice, Panel } from './ui'

export function SyncClients() {
  const { session } = useAuth()
  const phone = phoneTarget(session?.carddavPhoneUrl)
  const base = session?.carddavPhoneUrl || session?.carddavUrl || ''
  const [passwords, setPasswords] = useState<AppPassword[]>([])
  const [name, setName] = useState('')
  const [created, setCreated] = useState('')
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  const [openDevice, setOpenDevice] = useState(defaultDevice)

  function load() {
    api<AppPassword[]>('/api/app-passwords').then(setPasswords).catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [])

  async function create() {
    setError('')
    setCreated('')
    if (!name.trim()) {
      setError('Name the client first, such as iPhone or Thunderbird')
      return
    }
    try {
      const result = await api<AppPassword & { password: string }>('/api/app-passwords', {
        method: 'POST',
        body: JSON.stringify({ label: name.trim() }),
      })
      setCreated(result.password)
      setName('')
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create a client password')
    }
  }

  async function revoke(id: string) {
    await api(`/api/app-passwords/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <>
      <Panel>
        <Text style={styles.name}>Phone and computer sync</Text>
        <Text style={styles.meta}>CardDAV is the address book. CalDAV is the calendar and the tasks. Both use the same address as this website, your sign-in email, and a client password from the list below. The website password does not work in those apps.</Text>
        <Fact label="Username" value={session?.email || ''} />
        {phone ? (
          <>
            <Fact label="Server" value={phone.host} />
            <Fact label="Port" value={phone.port} />
            <Fact label="SSL" value={phone.ssl ? 'On' : 'Off'} />
            <Fact label="Base URL" value={base} nativeID="base-url" />
            <Text style={styles.meta}>{phone.ssl ? 'This address is HTTPS, so turn SSL on.' : 'This server is plain HTTP, so leave SSL off in the client.'}</Text>
          </>
        ) : (
          <Fact label="Server" value={session?.carddavUrl || ''} />
        )}
        {Platform.OS === 'web' && base ? (
          <Button label={copied || 'Copy base URL'} tone="ghost" onPress={() => void copyBase(base, setCopied)} />
        ) : null}
        <Device title="iPhone and iPad" open={openDevice === 'iphone'} onPress={() => setOpenDevice((current) => current === 'iphone' ? '' : 'iphone')}>
          {Platform.OS === 'web' && base ? (
            <>
              <Button label="Add contacts to iPhone" onPress={downloadIphoneProfile} />
              <Text style={styles.meta}>Safari downloads a profile with a new client password named iPhone. Install the profile when iOS asks. The contacts account and the calendar account then appear in Settings.</Text>
            </>
          ) : null}
          <Text style={styles.meta}>Or add the accounts by hand:</Text>
          <Steps items={iphoneSteps(phone)} />
        </Device>
        <Device title="Android" open={openDevice === 'android'} onPress={() => setOpenDevice((current) => current === 'android' ? '' : 'android')}>
          <Steps items={['Install DAVx5.', 'Add an account with the base URL, the email, and a client password.', 'Choose the address books and the calendars it offers.']} />
        </Device>
        <Device title="Mac" open={openDevice === 'mac'} onPress={() => setOpenDevice((current) => current === 'mac' ? '' : 'mac')}>
          <Steps items={['Open System Settings, Internet Accounts, Add Other Account.', 'Add a CardDAV account. Choose Manual.', 'Use the server, email, client password, port, and SSL above.', 'Add a CalDAV account with the same details.']} />
        </Device>
        <Device title="Thunderbird and other apps" open={openDevice === 'apps'} onPress={() => setOpenDevice((current) => current === 'apps' ? '' : 'apps')}>
          <Text style={styles.meta}>Any CardDAV or CalDAV app uses the base URL, the email, and a client password. People kept in iCloud or Google stay there until you export a vCard and import it on the Address books tab.</Text>
        </Device>
        <SyncStatus />
        <PhoneSync lastCheckedIn={passwords.reduce<string | null>((latest, item) => {
          if (!item.lastUsedAt) return latest
          if (!latest || item.lastUsedAt > latest) return item.lastUsedAt
          return latest
        }, null)} />
      </Panel>
      <Panel>
        <Text style={styles.name}>Sync clients</Text>
        <Text style={styles.meta}>A client password belongs to one phone, computer, or app. Name it after that device. The check-in time updates when that client syncs. Saving the account on the phone is not a sync. Revoking the password signs that client out.</Text>
        <Button label="Check again" tone="ghost" onPress={load} />
        {error ? <Notice text={error} /> : null}
        {created ? <Text style={styles.secret}>Copy this password now. It will not be shown again. {created}</Text> : null}
        {passwords.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={styles.copy}>
              <Text style={styles.value}>{item.label}</Text>
              <Text style={styles.meta}>{item.lastUsedAt ? `Last check-in ${new Date(item.lastUsedAt).toLocaleString()}` : 'Has not checked in'}</Text>
            </View>
            <Button label="Revoke" tone="danger" onPress={() => void revoke(item.id)} />
          </View>
        ))}
        {passwords.length === 0 ? <Text style={styles.meta}>No clients yet.</Text> : null}
        <Field label="Client name" value={name} onChangeText={setName} placeholder="iPhone, Mac, DAVx5" hint="The device or app that will use this password." />
        <Button label="Create client password" onPress={() => void create()} />
      </Panel>
    </>
  )
}

function downloadIphoneProfile() {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = `${apiUrl}/api/sync/iphone`
  document.body.appendChild(form)
  form.submit()
  form.remove()
}

async function copyBase(value: string, setCopied: (value: string) => void) {
  const copied = await copyText(value)
  setCopied(copied ? 'Copied' : 'Address selected')
}

async function copyText(value: string) {
  const node = document.getElementById('base-url')
  const selection = window.getSelection()
  if (node && selection) {
    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // This address is not a secure context, so the clipboard API refuses.
    }
  }
  try {
    return document.execCommand('copy')
  } catch {
    return false
  }
}

function iphoneSteps(phone: { port: string; ssl: boolean } | null) {
  const ssl = phone
    ? phone.ssl && phone.port === '443'
      ? 'Turn SSL on and leave the port at 443.'
      : `Open Advanced, turn SSL ${phone.ssl ? 'on' : 'off'}, and set the port to ${phone.port}.`
    : 'Open Advanced and match SSL and the port to the server above.'
  return [
    'Open Settings, Contacts, Accounts, Add Account, Other, Add CardDAV Account.',
    'In Server, enter only the host above. Leave the URL and the port out of that field.',
    'User Name is the email. Password is a client password.',
    ssl,
    'Add a CalDAV account from Calendar, Accounts, Add Account, Other, with the same host, email, password, and port. Events are the Rolodex calendar. Tasks are the Tasks calendar.',
    'After the account is saved, open Settings, Apps, Contacts, Contacts Accounts, turn Contacts off, wait a few seconds, and turn it on.',
    'Each address book becomes a list. Open Contacts, tap Lists, and turn on every Rolodex list.',
  ]
}

function defaultDevice() {
  if (Platform.OS === 'ios') return 'iphone'
  if (Platform.OS === 'android') return 'android'
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    const agent = navigator.userAgent
    if (/iPhone|iPad|iPod/i.test(agent)) return 'iphone'
    if (/Android/i.test(agent)) return 'android'
    if (/Mac/i.test(agent)) return 'mac'
  }
  return 'apps'
}

function Device({ title, open, onPress, children }: { title: string; open: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <View style={styles.deviceBlock}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress} style={styles.deviceRow}>
        <Text style={styles.device}>{title}</Text>
        <Text style={styles.deviceMark}>{open ? '−' : '+'}</Text>
      </Pressable>
      {open ? <View style={styles.deviceBody}>{children}</View> : null}
    </View>
  )
}

function Steps({ items }: { items: string[] }) {
  return (
    <View style={styles.steps}>
      {items.map((item, index) => (
        <View key={`${index}-${item.slice(0, 24)}`} style={styles.step}>
          <Text style={styles.stepNo}>{index + 1}.</Text>
          <Text style={styles.stepText}>{item}</Text>
        </View>
      ))}
    </View>
  )
}

function Fact({ label, value, nativeID }: { label: string; value: string; nativeID?: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text nativeID={nativeID} selectable style={styles.value}>{value}</Text>
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

const styles = StyleSheet.create({
  name: { fontFamily: font, fontSize: 16, fontWeight: '600', color: theme.text, marginBottom: 8 },
  deviceBlock: { borderTopWidth: 1, borderTopColor: theme.border },
  deviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  device: { fontFamily: font, fontSize: 14, fontWeight: '700', color: theme.text },
  deviceMark: { fontFamily: font, color: theme.muted, fontSize: 18, width: 18, textAlign: 'center' },
  deviceBody: { gap: 8, paddingBottom: 8 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  fact: { gap: 2 },
  factLabel: { fontFamily: font, color: theme.muted, fontSize: 12 },
  value: { fontFamily: font, color: theme.text, fontSize: 15 },
  secret: { fontFamily: font, color: theme.text, backgroundColor: theme.accentMuted, padding: 10, borderRadius: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  copy: { flex: 1, gap: 2 },
  steps: { gap: 6 },
  step: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  stepNo: { fontFamily: font, color: theme.text, fontSize: 13, width: 20 },
  stepText: { flex: 1, fontFamily: font, color: theme.muted, fontSize: 13 },
})
