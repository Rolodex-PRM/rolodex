import { useState } from 'react'
import { ApiError } from '../../src/api'
import { AuthFrame } from '../../src/auth-screen'
import { useAuth } from '../../src/auth'
import { Button, Field, Notice } from '../../src/ui'

export default function Setup() {
  const { createAdmin } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit() {
    if (password !== confirm) {
      setError('Those passwords do not match')
      return
    }
    setPending(true)
    setError('')
    try {
      await createAdmin(email.trim(), password, displayName.trim())
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the administrator')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthFrame title="Create the administrator" subtitle="This server has no accounts yet. This person owns the first workspace." busy={pending}>
      {error ? <Notice text={error} /> : null}
      <Field label="Name" value={displayName} onChangeText={setDisplayName} />
      <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@email.com" />
      <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Field label="Confirm password" secureTextEntry value={confirm} onChangeText={setConfirm} />
      <Button label={pending ? 'Creating' : 'Create administrator'} onPress={submit} disabled={pending || !displayName.trim() || !email.trim() || password.length < 8} />
    </AuthFrame>
  )
}
