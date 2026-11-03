import { Link, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { api, ApiError } from '../../src/api'
import { AuthFrame } from '../../src/auth-screen'
import { useAuth } from '../../src/auth'
import { font, theme } from '../../src/theme'
import { Button, Field, Notice } from '../../src/ui'

export default function SignUp() {
  const { signUp } = useAuth()
  const params = useLocalSearchParams<{ invite?: string }>()
  const invite = Array.isArray(params.invite) ? params.invite[0] ?? '' : params.invite ?? ''
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancel = false
    api<{ inviteOnly: boolean }>('/api/auth/registration')
      .then((policy) => {
        if (!cancel) setInviteOnly(policy.inviteOnly)
      })
      .catch(() => {
        if (!cancel) setInviteOnly(false)
      })
      .finally(() => {
        if (!cancel && !invite) setReady(true)
      })
    if (invite) {
      api<{ email: string; workspaceName: string }>(`/api/auth/invites/preview?token=${encodeURIComponent(invite)}`)
        .then((preview) => {
          if (cancel) return
          setEmail(preview.email)
          setWorkspaceName(preview.workspaceName)
        })
        .catch((caught: unknown) => {
          if (!cancel) setError(caught instanceof ApiError ? caught.message : 'This invitation is no longer valid')
        })
        .finally(() => {
          if (!cancel) setReady(true)
        })
    }
    return () => {
      cancel = true
    }
  }, [invite])

  async function submit() {
    setPending(true)
    setError('')
    try {
      await signUp(email.trim(), password, displayName.trim(), invite)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the account')
    } finally {
      setPending(false)
    }
  }

  const closed = inviteOnly && !invite
  const subtitle = workspaceName ? `Join ${workspaceName}` : 'A personal workspace and address book come with it.'

  return (
    <AuthFrame
      title="Create account"
      subtitle={subtitle}
      busy={pending || !ready}
      footer={
        <Text style={styles.footer}>
          Already have an account? <Link href="/sign-in" style={styles.link}>Sign in</Link>
        </Text>
      }
    >
      {error ? <Notice text={error} /> : null}
      {closed ? <Text style={styles.closed}>Registration requires an invitation.</Text> : (
        <>
          <Field label="Name" value={displayName} onChangeText={setDisplayName} />
          <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@email.com" editable={!invite} />
          <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
          <Button label={pending ? 'Creating' : 'Create account'} onPress={submit} disabled={pending || !ready} />
        </>
      )}
    </AuthFrame>
  )
}

const styles = StyleSheet.create({
  footer: { fontFamily: font, color: theme.muted, textAlign: 'center', marginTop: 4 },
  link: { fontFamily: font, color: theme.text, fontWeight: '700' },
  closed: { fontFamily: font, color: theme.text, fontSize: 15 },
})
