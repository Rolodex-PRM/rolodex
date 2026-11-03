import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text } from 'react-native'
import { api, apiUrl, ApiError } from '../../src/api'
import { AuthFrame } from '../../src/auth-screen'
import { useAuth } from '../../src/auth'
import { font, theme } from '../../src/theme'
import { Button, Field, Notice } from '../../src/ui'

export default function SignIn() {
  const { signIn, completeOauth } = useAuth()
  const router = useRouter()
  const params = useLocalSearchParams<{ oauth?: string; oauthError?: string }>()
  const oauthCode = firstParam(params.oauth)
  const oauthError = firstParam(params.oauthError)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(oauthError)
  const [pending, setPending] = useState(false)
  const [oauth, setOauth] = useState<{ enabled: boolean; buttonText: string; autoLaunch: boolean } | null>(null)
  const [inviteOnly, setInviteOnly] = useState(false)

  useEffect(() => {
    api<{ enabled: boolean; buttonText: string; autoLaunch: boolean }>('/api/auth/oauth').then(setOauth).catch(() => setOauth(null))
    api<{ inviteOnly: boolean }>('/api/auth/registration').then((policy) => setInviteOnly(policy.inviteOnly)).catch(() => setInviteOnly(false))
  }, [])

  useEffect(() => {
    if (!oauthCode || exchanged.has(oauthCode)) return
    exchanged.add(oauthCode)
    let cancel = false
    setPending(true)
    api<{ token: string }>('/api/auth/oauth/exchange', { method: 'POST', body: JSON.stringify({ code: oauthCode }) })
      .then((result) => completeOauth(result.token))
      .then(() => {
        if (!cancel) router.replace('/')
      })
      .catch((caught: unknown) => {
        exchanged.delete(oauthCode)
        if (!cancel) setError(caught instanceof ApiError ? caught.message : 'Could not finish signing in')
      })
      .finally(() => {
        if (!cancel) setPending(false)
      })
    return () => {
      cancel = true
    }
  }, [oauthCode, completeOauth, router])

  useEffect(() => {
    if (!oauth?.enabled || !oauth.autoLaunch || oauthCode || oauthError || Platform.OS !== 'web') return
    if (sessionStorage.getItem('rolodex.oauth.autolaunch')) return
    sessionStorage.setItem('rolodex.oauth.autolaunch', '1')
    window.location.assign(`${apiUrl}/api/auth/oauth/start`)
  }, [oauth, oauthCode, oauthError])

  async function submit() {
    setPending(true)
    setError('')
    try {
      await signIn(email.trim(), password)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Welcome back"
      busy={pending}
      footer={
        inviteOnly ? undefined : (
          <Text style={styles.footer}>
            Don't have an account? <Link href="/sign-up" style={styles.link}>Create one</Link>
          </Text>
        )
      }
    >
      {error ? <Notice text={error} /> : null}
      <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@email.com" />
      <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Button label={pending ? 'Signing in' : 'Sign in'} onPress={submit} disabled={pending} />
      {oauth?.enabled ? (
        <Button label={oauth.buttonText || 'Login with OAuth'} tone="ghost" onPress={() => { if (Platform.OS === 'web') window.location.assign(`${apiUrl}/api/auth/oauth/start`) }} />
      ) : null}
    </AuthFrame>
  )
}

const exchanged = new Set<string>()

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

const styles = StyleSheet.create({
  footer: { fontFamily: font, color: theme.muted, textAlign: 'center', marginTop: 4 },
  link: { fontFamily: font, color: theme.text, fontWeight: '700' },
})
