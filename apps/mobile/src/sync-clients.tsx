import { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { api, type AppPassword } from './api'
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
  const [error, setError] = useState('')

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
            <Fact label="Base URL" value={base} />
            <Text style={styles.meta}>{phone.ssl ? 'This address is HTTPS, so turn SSL on.' : 'This server is plain HTTP, so leave SSL off in the client.'}</Text>
          </>
        ) : (
          <Fact label="Server" value={session?.carddavUrl || ''} />
        )}
        {Platform.OS === 'web' && base ? (
          <Button label="Copy base URL" tone="ghost" onPress={() => void navigator.clipboard.writeText(base)} />
        ) : null}
        <Text style={styles.device}>iPhone and iPad</Text>
        <Text style={styles.meta}>Settings, Contacts, Accounts, Add Account, Other, Add CardDAV Account. The Server field is only the host above. Leave the URL and the port out of that field. User Name is the email. Password is a client password. {phone ? (phone.ssl && phone.port === '443' ? 'Turn SSL on and leave the port at 443.' : `Open Advanced, turn SSL ${phone.ssl ? 'on' : 'off'}, and set the port to ${phone.port}.`) : ''} Then add a CalDAV account from Calendar, Accounts, Add Account, Other, with the same host, email, password, and port. Events are the Rolodex calendar. Tasks are the Tasks calendar.</Text>
        <Text style={styles.device}>Android</Text>
        <Text style={styles.meta}>DAVx5 finds both. Add an account with the base URL, the email, and a client password. Choose the address book and the calendars it offers.</Text>
        <Text style={styles.device}>Mac</Text>
        <Text style={styles.meta}>System Settings, Internet Accounts, Add Other Account. Add a CardDAV account, then a CalDAV account. Choose Manual. Use the server, email, client password, port, and SSL above.</Text>
        <Text style={styles.device}>Thunderbird and other apps</Text>
        <Text style={styles.meta}>Any CardDAV or CalDAV app uses the base URL, the email, and a client password. People kept in iCloud or Google stay there until you export a vCard and import it on the Address books tab.</Text>
        <SyncStatus />
        <PhoneSync lastCheckedIn={passwords.reduce<string | null>((latest, item) => {
          if (!item.lastUsedAt) return latest
          if (!latest || item.lastUsedAt > latest) return item.lastUsedAt
          return latest
        }, null)} />
      </Panel>
      <Panel>
        <Text style={styles.name}>Sync clients</Text>
        <Text style={styles.meta}>A client password belongs to one phone, computer, or app. Name it after that device. The check-in time updates when that client syncs. Revoking it signs that client out.</Text>
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text selectable style={styles.value}>{value}</Text>
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
  device: { fontFamily: font, fontSize: 14, fontWeight: '700', color: theme.text, marginTop: 8 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  fact: { gap: 2 },
  factLabel: { fontFamily: font, color: theme.muted, fontSize: 12 },
  value: { fontFamily: font, color: theme.text, fontSize: 15 },
  secret: { fontFamily: font, color: theme.text, backgroundColor: theme.accentMuted, padding: 10, borderRadius: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  copy: { flex: 1, gap: 2 },
})
