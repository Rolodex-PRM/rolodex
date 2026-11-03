import { Link, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { ApiError, send } from '../../src/api'
import { AuthFrame } from '../../src/auth-screen'
import { font, theme } from '../../src/theme'
import { Button, Field, Notice } from '../../src/ui'

export default function ResetPassword() {
  const params = useLocalSearchParams<{ token?: string }>()
  const token = Array.isArray(params.token) ? params.token[0] ?? '' : params.token ?? ''
  const [password, setPassword] = useState('')
  const [error, setError] = useState(token ? '' : 'This reset link is missing its token')
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  async function submit() {
    setPending(true)
    setError('')
    try {
      await send('/api/auth/reset', 'POST', { token, password })
      setDone(true)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reset the password')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthFrame
      title="Choose a new password"
      subtitle="This signs you out of other sessions."
      busy={pending}
      footer={
        <Text style={styles.footer}>
          <Link href="/sign-in" style={styles.link}>Back to sign in</Link>
        </Text>
      }
    >
      {error ? <Notice text={error} /> : null}
      {done ? <Text style={styles.done}>Password updated. You can sign in with it now.</Text> : (
        <>
          <Field label="New password" secureTextEntry value={password} onChangeText={setPassword} />
          <Button label={pending ? 'Saving' : 'Save password'} onPress={submit} disabled={pending || !token} />
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
