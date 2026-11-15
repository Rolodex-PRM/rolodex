import { Link } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { ApiError, send } from '../../src/api'
import { AuthFrame } from '../../src/auth-screen'
import { font, theme } from '../../src/theme'
import { Button, Field, Notice } from '../../src/ui'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  async function submit() {
    setPending(true)
    setError('')
    try {
      await send('/api/auth/forgot', 'POST', { email: email.trim() })
      setDone(true)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send a reset email')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthFrame
      title="Forgot password"
      subtitle="We email a reset link when that address has an account."
      busy={pending}
      footer={
        <Text style={styles.footer}>
          <Link href="/sign-in" style={styles.link}>Back to sign in</Link>
        </Text>
      }
    >
      {error ? <Notice text={error} /> : null}
      {done ? (
        <Text style={styles.done}>If an account exists for that email, a reset link is on its way. It expires in 2 hours.</Text>
      ) : (
        <>
          <Field
            label="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            onSubmitEditing={() => void submit()}
          />
          <Button label={pending ? 'Sending' : 'Send reset link'} onPress={() => void submit()} disabled={pending || !email.trim()} />
        </>
      )}
    </AuthFrame>
  )
}

const styles = StyleSheet.create({
  footer: { fontFamily: font, color: theme.muted, textAlign: 'center', marginTop: 4 },
  link: { fontFamily: font, color: theme.text, fontWeight: '700' },
  done: { fontFamily: font, color: theme.text, fontSize: 15 },
})
