import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text } from 'react-native'
import { api, apiUrl, ApiError } from '../../src/api'
import { AuthenticatorSetup } from '../../src/authenticator-setup'
import { AuthFrame } from '../../src/auth-screen'
import { useAuth } from '../../src/auth'
import { font, theme } from '../../src/theme'
import { Button, Field, Notice } from '../../src/ui'

export default function SignIn() {
  const { completeOauth } = useAuth()
  const router = useRouter()
  const params = useLocalSearchParams<{ oauth?: string; oauthError?: string }>()
  const oauthCode = firstParam(params.oauth)
  const oauthError = firstParam(params.oauthError)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [error, setError] = useState(oauthError)
  const [pending, setPending] = useState(false)
  const [oauth, setOauth] = useState<{ enabled: boolean; buttonText: string; autoLaunch: boolean } | null>(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [mailed, setMailed] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    api<{ enabled: boolean; buttonText: string; autoLaunch: boolean }>('/api/auth/oauth').then(setOauth).catch(() => setOauth(null))
    api<{ inviteOnly: boolean }>('/api/auth/registration').then((policy) => setInviteOnly(policy.inviteOnly)).catch(() => setInviteOnly(false))
  }, [])

  useEffect(() => {
    if (!oauthCode || exchanged.has(oauthCode)) return
    exchanged.add(oauthCode)
    let cancel = false
    setPending(true)
    api<Challenge | { token: string }>('/api/auth/oauth/exchange', { method: 'POST', body: JSON.stringify({ code: oauthCode }) })
      .then(async (result) => {
        if ('kind' in result) {
          setChallenge(result)
          return
        }
        await completeOauth(result.token)
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

  useEffect(() => {
    if (!challenge || challenge.methods.includes('authenticator') || !challenge.methods.includes('email') || mailed === challenge.ticket) return
    setMailed(challenge.ticket)
    void api('/api/auth/login/email-code', { method: 'POST', body: JSON.stringify({ ticket: challenge.ticket }) })
      .then(() => setInfo('A code was sent to your sign-in email. It expires in 10 minutes.'))
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : 'Could not send the email code'))
  }, [challenge, mailed])

  async function emailCode() {
    if (!challenge) return
    setError('')
    setInfo('')
    try {
      await api('/api/auth/login/email-code', { method: 'POST', body: JSON.stringify({ ticket: challenge.ticket }) })
      setMailed(challenge.ticket)
      setInfo('A code was sent to your sign-in email. It expires in 10 minutes.')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send the email code')
    }
  }

  async function submit() {
    setPending(true)
    setError('')
    try {
      if (challenge) {
        const result = await api<{ token: string }>('/api/auth/login/mfa', { method: 'POST', body: JSON.stringify({ ticket: challenge.ticket, code }) })
        await completeOauth(result.token)
        router.replace('/')
        return
      }
      const result = await api<Challenge | { token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) })
      if ('kind' in result) {
        setChallenge(result)
        return
      }
      await completeOauth(result.token)
      router.replace('/')
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
      {info ? <Text style={styles.footer}>{info}</Text> : null}
      {challenge?.kind === 'enroll' ? <AuthenticatorSetup secret={challenge.secret} otpauth={challenge.otpauth} /> : null}
      {challenge ? (
        <Field
          label={challenge.methods.includes('authenticator') ? 'Authenticator or email code' : 'Email code'}
          keyboardType="number-pad"
          value={code}
          onChangeText={setCode}
          hint={challenge.methods.includes('authenticator') ? 'Six digits from the app, or from the email when you ask for one.' : 'Six digits from the email.'}
        />
      ) : (
        <>
          <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@email.com" />
          <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
        </>
      )}
      <Button label={pending ? 'Signing in' : challenge ? 'Confirm code' : 'Sign in'} onPress={submit} disabled={pending} />
      {challenge?.methods.includes('email') ? (
        <Button label="Email me a code" tone="ghost" onPress={() => void emailCode()} />
      ) : null}
      {!challenge && oauth?.enabled ? (
        <Button label={oauth.buttonText || 'Login with OAuth'} tone="ghost" onPress={() => { if (Platform.OS === 'web') window.location.assign(`${apiUrl}/api/auth/oauth/start`) }} />
      ) : null}
    </AuthFrame>
  )
}

type Method = 'authenticator' | 'email'
type Challenge = { kind: 'mfa'; ticket: string; methods: Method[] } | { kind: 'enroll'; ticket: string; secret: string; otpauth: string; methods: Method[] }

const exchanged = new Set<string>()

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

const styles = StyleSheet.create({
  footer: { fontFamily: font, color: theme.muted, textAlign: 'center', marginTop: 4 },
  link: { fontFamily: font, color: theme.text, fontWeight: '700' },
})
