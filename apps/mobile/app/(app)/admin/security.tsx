import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SwitchRow } from '../../../src/admin-fields'
import { api, send } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { font, theme } from '../../../src/theme'
import { Notice } from '../../../src/ui'

type Policy = { required: boolean; authenticator: boolean; email: boolean }

export default function SecurityPage() {
  const { workspace } = useAuth()
  const [policy, setPolicy] = useState<Policy>({ required: false, authenticator: true, email: true })
  const [inviteOnly, setInviteOnly] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!workspace) return
    api<Policy>(`/api/workspaces/${workspace.id}/security`).then(setPolicy).catch((caught: Error) => setError(caught.message))
    api<{ inviteOnly: boolean }>(`/api/workspaces/${workspace.id}/registration`).then((row) => setInviteOnly(row.inviteOnly)).catch((caught: Error) => setError(caught.message))
  }, [workspace])

  function save(next: Policy, done: string) {
    if (!workspace) return
    if (next.required && !next.authenticator && !next.email) {
      setError('Keep an authenticator app or email codes while a second factor is required')
      return
    }
    const previous = policy
    setPolicy(next)
    setError('')
    void send<Policy>(`/api/workspaces/${workspace.id}/security`, 'PUT', next)
      .then((saved) => {
        setPolicy(saved)
        setNotice(done)
      })
      .catch((caught: Error) => {
        setPolicy(previous)
        setError(caught.message)
      })
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Security</Text>
      <Text style={styles.meta}>Registration and the second factor apply to the whole server.</Text>
      {error ? <Notice text={error} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <SwitchRow
        label="Require an invitation to register"
        detail="When this is on, the sign-in page does not offer Create an account. New people need an invitation from Users. Turn it off to let anyone with the address register."
        on={inviteOnly}
        onPress={() => {
          if (!workspace) return
          const next = !inviteOnly
          setInviteOnly(next)
          setError('')
          void send(`/api/workspaces/${workspace.id}/registration`, 'PUT', { inviteOnly: next })
            .then(() => setNotice(next ? 'Registration now requires an invitation' : 'Open registration is on'))
            .catch((caught: Error) => {
              setInviteOnly(!next)
              setError(caught.message)
            })
        }}
      />
      <SwitchRow
        label="Require a second factor"
        detail="After the password or single sign-on, the person enters a code. People without an authenticator app set one up at the next sign-in, or use an email code when that method is on."
        on={policy.required}
        onPress={() => save({ ...policy, required: !policy.required }, !policy.required ? 'A second factor is required' : 'A second factor is optional')}
      />
      <SwitchRow
        label="Authenticator app"
        detail="Microsoft Authenticator, Google Authenticator, Authentik, 1Password, and any other TOTP app. The person scans a setup code or types the secret."
        on={policy.authenticator}
        onPress={() => save({ ...policy, authenticator: !policy.authenticator }, !policy.authenticator ? 'Authenticator apps are on' : 'Authenticator apps are off')}
      />
      <SwitchRow
        label="Email a sign-in code"
        detail="Sends a 6-digit code to the person's sign-in email. Turn on email under Notifications first, then send a test from Settings."
        on={policy.email}
        onPress={() => save({ ...policy, email: !policy.email }, !policy.email ? 'Email codes are on' : 'Email codes are off')}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 12 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 14 },
  notice: { fontFamily: font, color: theme.text, fontSize: 14 },
})
