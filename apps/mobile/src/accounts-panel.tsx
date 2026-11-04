import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { api, send } from './api'
import { useAuth } from './auth'
import { font, theme } from './theme'
import { Button, Field, Notice, Panel } from './ui'

type Message = { id: string; subject: string; correspondent: string; occurredAt: string; contactId: string | null }
type Account = {
  id: string
  kind: string
  name: string
  status: string
  lastSyncedAt: string | null
  settings: { host?: string; port?: number; secure?: boolean; username?: string; url?: string }
  messages: Message[]
}

export function AccountsPanel() {
  const { workspace } = useAuth()
  const [rows, setRows] = useState<Account[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mailName, setMailName] = useState('Mailbox')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('993')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [calName, setCalName] = useState('Calendar')
  const [url, setUrl] = useState('')
  const [calUser, setCalUser] = useState('')
  const [calPassword, setCalPassword] = useState('')

  const load = useCallback(() => {
    if (!workspace) return
    api<Account[]>(`/api/workspaces/${workspace.id}/accounts`).then(setRows).catch((caught: Error) => setError(caught.message))
  }, [workspace])

  useEffect(() => { load() }, [load])

  if (!workspace) return null

  return (
    <View style={styles.page}>
      <Panel>
        <Text style={styles.name}>Mail and outside calendars</Text>
        <Text style={styles.meta}>This is not a Rolodex sign-in and not a phone sync client. A mailbox is an IMAP account, such as Gmail with an app password. A calendar is a CalDAV or ICS address, such as iCloud, Fastmail, or a subscribed calendar. Checking an account imports recent mail and events into this workspace.</Text>
        {error ? <Notice text={error} /> : null}
        {notice ? <Text style={styles.meta}>{notice}</Text> : null}
      </Panel>
      {rows.map((account) => (
        <Panel key={account.id}>
          <Text style={styles.name}>{account.name}</Text>
          <Text style={styles.meta}>{account.kind === 'mailbox' ? `${account.settings.username} at ${account.settings.host}` : account.settings.url}</Text>
          <Text style={styles.meta}>{account.status}{account.lastSyncedAt ? ` · last checked ${new Date(account.lastSyncedAt).toLocaleString()}` : ''}</Text>
          {account.messages.map((message) => (
            <Text key={message.id} style={styles.line}>{message.subject} · {message.correspondent}</Text>
          ))}
          <View style={styles.actions}>
            <Button
              label="Check now"
              onPress={() => {
                setError('')
                void send<{ imported: number }>(`/api/workspaces/${workspace.id}/accounts/${account.id}/sync`, 'POST')
                  .then((result) => { setNotice(`Imported ${result.imported}`); load() })
                  .catch((caught: Error) => setError(caught.message))
              }}
            />
            <Button
              label="Remove"
              tone="danger"
              onPress={() => void send(`/api/workspaces/${workspace.id}/accounts/${account.id}`, 'DELETE').then(() => load()).catch((caught: Error) => setError(caught.message))}
            />
          </View>
        </Panel>
      ))}
      <Panel>
        <Text style={styles.name}>Add a mailbox</Text>
        <Field label="Name" value={mailName} onChangeText={setMailName} />
        <Field label="IMAP host" autoCapitalize="none" value={host} onChangeText={setHost} placeholder="imap.gmail.com" />
        <Field label="Port" keyboardType="number-pad" value={port} onChangeText={setPort} />
        <Field label="Username" autoCapitalize="none" value={username} onChangeText={setUsername} />
        <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
        <Button
          label="Save mailbox"
          onPress={() => {
            if (!host.trim() || !username.trim()) return
            void send(`/api/workspaces/${workspace.id}/accounts/mailbox`, 'POST', {
              name: mailName.trim() || 'Mailbox',
              host: host.trim(),
              port: Number(port) || 993,
              secure: true,
              username: username.trim(),
              password,
            }).then(() => { setPassword(''); setNotice('Mailbox saved'); load() }).catch((caught: Error) => setError(caught.message))
          }}
        />
      </Panel>
      <Panel>
        <Text style={styles.name}>Add a calendar</Text>
        <Field label="Name" value={calName} onChangeText={setCalName} />
        <Field label="CalDAV or ICS address" autoCapitalize="none" value={url} onChangeText={setUrl} placeholder="https://caldav.example.com/calendars/home/" />
        <Field label="Username" autoCapitalize="none" value={calUser} onChangeText={setCalUser} />
        <Field label="Password" secureTextEntry value={calPassword} onChangeText={setCalPassword} />
        <Button
          label="Save calendar"
          onPress={() => {
            if (!url.trim() || !calUser.trim()) return
            void send(`/api/workspaces/${workspace.id}/accounts/calendar`, 'POST', {
              name: calName.trim() || 'Calendar',
              url: url.trim(),
              username: calUser.trim(),
              password: calPassword,
            }).then(() => { setCalPassword(''); setNotice('Calendar saved'); load() }).catch((caught: Error) => setError(caught.message))
          }}
        />
      </Panel>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  name: { fontFamily: font, fontSize: 16, fontWeight: '600', color: theme.text, marginBottom: 8 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  line: { fontFamily: font, color: theme.text, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
})
