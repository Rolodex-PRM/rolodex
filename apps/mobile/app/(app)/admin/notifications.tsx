import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SwitchRow } from '../../../src/admin-fields'
import { api, send, type NotificationSettings } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { font, theme } from '../../../src/theme'
import { Button, Field, Notice } from '../../../src/ui'

export default function NotificationsPage() {
  const { workspace } = useAuth()
  const [draft, setDraft] = useState<NotificationSettings | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!workspace) return
    api<NotificationSettings>(`/api/workspaces/${workspace.id}/server/notifications`).then(setDraft).catch((caught: Error) => setError(caught.message))
  }, [workspace])

  function patch(next: NotificationSettings) {
    setDraft(next)
  }

  async function save() {
    if (!workspace || !draft) return null
    setError('')
    setNotice('')
    const saved = await send<NotificationSettings>(`/api/workspaces/${workspace.id}/server/notifications`, 'PUT', {
      ...draft,
      email: { ...draft.email, port: Number(draft.email.port) },
    })
    setDraft(saved)
    return saved
  }

  async function test(channel: 'email' | 'push' | 'webhook') {
    if (!workspace) return
    try {
      await save()
      await send(`/api/workspaces/${workspace.id}/server/notifications/test`, 'POST', { channel })
      setNotice(channel === 'email' ? 'Test email sent' : channel === 'push' ? 'Test push sent' : 'Test webhook sent')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the test')
    }
  }

  if (!draft) {
    return (
      <View style={styles.card}>
        <Text style={styles.heading}>Notifications</Text>
        {error ? <Notice text={error} /> : <Text style={styles.meta}>Loading notification settings.</Text>}
      </View>
    )
  }

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.heading}>Notifications</Text>
        <Text style={styles.meta}>The server sends due reminders through every channel that is turned on. In-app reminders stay in the bell.</Text>
        {error ? <Notice text={error} /> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <Field label="Link URL" autoCapitalize="none" value={draft.appUrl} onChangeText={(appUrl) => patch({ ...draft, appUrl })} placeholder="https://rolodex.example.com" />
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>Email</Text>
        <Text style={styles.meta}>Settings for sending email notifications.</Text>
        <SwitchRow label="Enable email notifications" on={draft.email.enabled} onPress={() => patch({ ...draft, email: { ...draft.email, enabled: !draft.email.enabled } })} />
        <Field label="Host" autoCapitalize="none" value={draft.email.host} onChangeText={(host) => patch({ ...draft, email: { ...draft.email, host } })} placeholder="smtp.example.com" />
        <Field label="Port" keyboardType="number-pad" value={String(draft.email.port)} onChangeText={(value) => patch({ ...draft, email: { ...draft.email, port: Number(value.replace(/\D/g, '')) || 0 } })} />
        <Field label="Username" autoCapitalize="none" value={draft.email.username} onChangeText={(username) => patch({ ...draft, email: { ...draft.email, username } })} />
        <Field label="Password" autoCapitalize="none" secureTextEntry value={draft.email.password} onChangeText={(password) => patch({ ...draft, email: { ...draft.email, password } })} />
        <SwitchRow label="SMTPS" detail="Use SMTP over TLS, usually port 465." on={draft.email.secure} onPress={() => patch({ ...draft, email: { ...draft.email, secure: !draft.email.secure } })} />
        <SwitchRow label="Ignore certificate errors" detail="Ignore TLS certificate validation errors for this mail server." on={draft.email.ignoreCertificateErrors} onPress={() => patch({ ...draft, email: { ...draft.email, ignoreCertificateErrors: !draft.email.ignoreCertificateErrors } })} />
        <Field label="From address" autoCapitalize="none" value={draft.email.from} onChangeText={(from) => patch({ ...draft, email: { ...draft.email, from } })} placeholder="Rolodex <you@example.com>" />
        <Button label="Send test email and save" onPress={() => void test('email')} />
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>Push</Text>
        <Text style={styles.meta}>Web Push reaches browsers that turn it on in Settings. The private key stays on the server.</Text>
        <SwitchRow label="Enable push notifications" on={draft.push.enabled} onPress={() => patch({ ...draft, push: { ...draft.push, enabled: !draft.push.enabled } })} />
        <Field label="Subject" autoCapitalize="none" value={draft.push.subject} onChangeText={(subject) => patch({ ...draft, push: { ...draft.push, subject } })} placeholder="mailto:you@example.com" />
        {draft.push.publicKey ? <Text style={styles.meta}>Public key {draft.push.publicKey.slice(0, 18)}…</Text> : null}
        <Button label="Send test push and save" onPress={() => void test('push')} />
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>Webhook</Text>
        <Text style={styles.meta}>POST a JSON notification to another service, such as ntfy, Gotify, or a chat webhook.</Text>
        <SwitchRow label="Enable webhook" on={draft.webhook.enabled} onPress={() => patch({ ...draft, webhook: { ...draft.webhook, enabled: !draft.webhook.enabled } })} />
        <Field label="URL" autoCapitalize="none" value={draft.webhook.url} onChangeText={(url) => patch({ ...draft, webhook: { ...draft.webhook, url } })} placeholder="https://ntfy.example/rolodex" />
        <Field label="Secret" autoCapitalize="none" secureTextEntry value={draft.webhook.secret} onChangeText={(secret) => patch({ ...draft, webhook: { ...draft.webhook, secret } })} placeholder="Sent as a bearer token" />
        <Button label="Send test webhook and save" onPress={() => void test('webhook')} />
      </View>
      <Button label="Save" onPress={() => void save().then(() => setNotice('Notification settings saved')).catch((caught: Error) => setError(caught.message))} />
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 14 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  section: { fontFamily: font, fontSize: 18, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  notice: { fontFamily: font, color: theme.text, fontSize: 14 },
})
