import { useEffect, useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { AuthenticatorSetup } from './authenticator-setup'
import { api, send } from './api'
import { font, theme } from './theme'
import { Button, Field, Notice, Panel } from './ui'

type Status = { required: boolean; enabled: boolean; authenticator: boolean; email: boolean }

export function TwoFactorPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [secret, setSecret] = useState('')
  const [otpauth, setOtpauth] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  function load() {
    api<Status>('/api/auth/two-factor').then(setStatus).catch(() => setStatus(null))
  }

  useEffect(() => { load() }, [])

  async function begin() {
    setError('')
    setNotice('')
    const started = await send<{ secret: string; otpauth: string }>('/api/auth/two-factor/setup', 'POST')
    setSecret(started.secret)
    setOtpauth(started.otpauth)
  }

  return (
    <Panel>
      <Text style={styles.name}>Second factor</Text>
      <Text style={styles.meta}>
        {status?.required
          ? 'An administrator requires a second factor at sign-in. Use an authenticator app, or a code emailed to this account when email codes are on.'
          : 'Add an authenticator app now, so sign-in is ready if an administrator requires a second factor.'}
      </Text>
      {error ? <Notice text={error} /> : null}
      {notice ? <Text style={styles.meta}>{notice}</Text> : null}
      {status?.enabled ? (
        status.required && !status.email ? <Text style={styles.meta}>This account has an authenticator app. It stays on while a second factor is required and email codes are off.</Text> : (
          <>
            <Text style={styles.meta}>An authenticator app is on for this account.</Text>
            <Field label="Current code" keyboardType="number-pad" value={code} onChangeText={setCode} hint="The 6-digit code currently shown in the app." />
            <Button
              label="Turn off authenticator"
              tone="danger"
              onPress={() => void send('/api/auth/two-factor', 'DELETE', { code }).then(() => { setNotice('Authenticator turned off'); setCode(''); load() }).catch((caught: Error) => setError(caught.message))}
            />
          </>
        )
      ) : (
        <>
          <Button label="Set up authenticator app" tone="ghost" onPress={() => void begin().catch((caught: Error) => setError(caught.message))} />
          {secret ? (
            <>
              <AuthenticatorSetup secret={secret} otpauth={otpauth} />
              <Field label="Code" keyboardType="number-pad" value={code} onChangeText={setCode} hint="Enter the 6-digit code from the app to finish setup." />
              <Button
                label="Confirm code"
                onPress={() => void send('/api/auth/two-factor/confirm', 'POST', { secret, code }).then(() => { setSecret(''); setOtpauth(''); setCode(''); setNotice('Authenticator app is on'); load() }).catch((caught: Error) => setError(caught.message))}
              />
            </>
          ) : null}
        </>
      )}
      <Text style={styles.meta}>Email codes use the address you sign in with. Turn on email under Admin, Notifications, before relying on them.</Text>
      <Button
        label="Send a test email"
        tone="ghost"
        onPress={() => {
          setError('')
          setNotice('')
          void send('/api/auth/two-factor/email-test', 'POST')
            .then(() => setNotice('A test message was sent to your sign-in email. It is not a sign-in code.'))
            .catch((caught: Error) => setError(caught.message))
        }}
      />
    </Panel>
  )
}

const styles = StyleSheet.create({
  name: { fontFamily: font, fontSize: 16, fontWeight: '600', color: theme.text, marginBottom: 8 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
})
