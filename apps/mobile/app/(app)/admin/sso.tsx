import { useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChoiceRow, SwitchRow } from '../../../src/admin-fields'
import { api, send, type OauthSettings } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { font, theme } from '../../../src/theme'
import { Button, Field, Notice } from '../../../src/ui'

const savedSecret = '*********'

export default function SsoPage() {
  const { workspace } = useAuth()
  const [draft, setDraft] = useState<OauthSettings | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirmUnlink, setConfirmUnlink] = useState(false)

  useEffect(() => {
    if (!workspace) return
    api<OauthSettings>(`/api/workspaces/${workspace.id}/server/oauth`).then(setDraft).catch((caught: Error) => setError(caught.message))
  }, [workspace])

  function patch(next: Partial<OauthSettings>) {
    setDraft((current) => (current ? { ...current, ...next } : current))
  }

  async function save() {
    if (!workspace || !draft) return
    setError('')
    setNotice('')
    try {
      const saved = await send<OauthSettings>(`/api/workspaces/${workspace.id}/server/oauth`, 'PUT', {
        ...draft,
        requestTimeoutMs: Number(draft.requestTimeoutMs),
      })
      setDraft(saved)
      setNotice('Sign-in settings saved')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save sign-in settings')
    }
  }

  async function unlink() {
    if (!workspace) return
    setError('')
    setNotice('')
    try {
      const result = await send<{ removed: number }>(`/api/workspaces/${workspace.id}/server/oauth/unlink`, 'POST')
      setConfirmUnlink(false)
      setNotice(result.removed ? `Unlinked ${result.removed} account${result.removed === 1 ? '' : 's'}` : 'No linked accounts')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not unlink accounts')
    }
  }

  if (!draft) {
    return (
      <View style={styles.card}>
        <Text style={styles.heading}>Sign-in</Text>
        {error ? <Notice text={error} /> : <Text style={styles.meta}>Loading sign-in settings.</Text>}
      </View>
    )
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Sign-in</Text>
      <Text style={styles.meta}>OAuth applies to the whole Rolodex server. Password sign-in stays available.</Text>
      {error ? <Notice text={error} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <SwitchRow label="Login with OAuth" detail="Show the provider button on the sign-in page." on={draft.enabled} onPress={() => patch({ enabled: !draft.enabled })} />
      {confirmUnlink ? (
        <View style={styles.unlink}>
          <Text style={styles.meta}>This signs nobody out. People will need to link again the next time they use the provider.</Text>
          <View style={styles.actions}>
            <Button label="Unlink all accounts" tone="danger" onPress={() => void unlink()} />
            <Button label="Cancel" tone="ghost" onPress={() => setConfirmUnlink(false)} />
          </View>
        </View>
      ) : (
        <Button label="Unlink all OAuth accounts" tone="ghost" onPress={() => setConfirmUnlink(true)} />
      )}
      <Field label="Issuer URL" autoCapitalize="none" value={draft.issuerUrl} onChangeText={(issuerUrl) => patch({ issuerUrl })} placeholder="https://id.example.com" />
      <Field label="Client ID" autoCapitalize="none" value={draft.clientId} onChangeText={(clientId) => patch({ clientId })} />
      <Field label="Client secret" autoCapitalize="none" secureTextEntry value={draft.clientSecret} onChangeText={(clientSecret) => patch({ clientSecret })} placeholder={draft.clientSecret === savedSecret ? savedSecret : 'Stored encrypted'} />
      <Text style={styles.meta}>Required for a confidential client. Public clients can use none, which relies on PKCE. Proof Key for Code Exchange is always sent.</Text>
      <ChoiceRow
        label="Token endpoint auth method"
        value={draft.tokenEndpointAuthMethod}
        onChange={(tokenEndpointAuthMethod) => patch({ tokenEndpointAuthMethod: tokenEndpointAuthMethod as OauthSettings['tokenEndpointAuthMethod'] })}
        options={[
          { id: 'client_secret_post', label: 'client_secret_post' },
          { id: 'client_secret_basic', label: 'client_secret_basic' },
          { id: 'none', label: 'none' },
        ]}
      />
      <Field label="Scope" autoCapitalize="none" value={draft.scope} onChangeText={(scope) => patch({ scope })} />
      <ChoiceRow
        label="ID token signed response alg"
        value={draft.idTokenSignedResponseAlg}
        onChange={(idTokenSignedResponseAlg) => patch({ idTokenSignedResponseAlg: idTokenSignedResponseAlg as OauthSettings['idTokenSignedResponseAlg'] })}
        options={['RS256', 'ES256', 'HS256'].map((id) => ({ id, label: id }))}
      />
      <ChoiceRow
        label="Userinfo signed response alg"
        value={draft.userinfoSignedResponseAlg}
        onChange={(userinfoSignedResponseAlg) => patch({ userinfoSignedResponseAlg: userinfoSignedResponseAlg as OauthSettings['userinfoSignedResponseAlg'] })}
        options={['none', 'RS256', 'ES256'].map((id) => ({ id, label: id }))}
      />
      <Field label="Prompt" autoCapitalize="none" value={draft.prompt} onChangeText={(prompt) => patch({ prompt })} placeholder="select_account" />
      <Field label="End session endpoint" autoCapitalize="none" value={draft.endSessionEndpoint} onChangeText={(endSessionEndpoint) => patch({ endSessionEndpoint })} placeholder="https://id.example.com/logout" />
      <Field label="Request timeout" keyboardType="number-pad" value={String(draft.requestTimeoutMs)} onChangeText={(value) => patch({ requestTimeoutMs: Number(value.replace(/\D/g, '')) || 0 })} />
      <SwitchRow label="Allow insecure requests" detail="Allows an http issuer and skips TLS certificate checks for that provider. This can expose the sign-in to network interception." on={draft.allowInsecureRequests} onPress={() => patch({ allowInsecureRequests: !draft.allowInsecureRequests })} />
      <Field label="Name claim" autoCapitalize="none" value={draft.nameClaim} onChangeText={(nameClaim) => patch({ nameClaim })} placeholder="preferred_username" />
      <Text style={styles.meta}>Used as the display name for a new account. Existing names stay as they are.</Text>
      <Field label="Role claim" autoCapitalize="none" value={draft.roleClaim} onChangeText={(roleClaim) => patch({ roleClaim })} placeholder="groups" />
      <Text style={styles.meta}>Optional. Rolodex stores the claim on the linked account and does not change workspace roles.</Text>
      <Field label="Button text" value={draft.buttonText} onChangeText={(buttonText) => patch({ buttonText })} />
      <Field label="Account management URL" autoCapitalize="none" value={draft.accountManagementUrl} onChangeText={(accountManagementUrl) => patch({ accountManagementUrl })} />
      <SwitchRow label="Auto register" detail="Create a Rolodex account the first time a confirmed email signs in." on={draft.autoRegister} onPress={() => patch({ autoRegister: !draft.autoRegister })} />
      <SwitchRow label="Auto launch" detail="Open the provider immediately on the sign-in page." on={draft.autoLaunch} onPress={() => patch({ autoLaunch: !draft.autoLaunch })} />
      <Field label="Rolodex URL" autoCapitalize="none" value={draft.appUrl} onChangeText={(appUrl) => patch({ appUrl })} />
      <Field label="Public API URL" autoCapitalize="none" value={draft.publicUrl} onChangeText={(publicUrl) => patch({ publicUrl })} />
      <Text style={styles.meta}>Redirect URI to register with the provider</Text>
      <View style={styles.redirect}>
        <Text style={styles.redirectText}>{draft.redirectUri}</Text>
        {Platform.OS === 'web' ? (
          <Pressable onPress={() => void navigator.clipboard.writeText(draft.redirectUri)}>
            <Text style={styles.copy}>Copy</Text>
          </Pressable>
        ) : null}
      </View>
      <SwitchRow label="Mobile redirect URI override" detail="Use a different redirect URI when a mobile client starts sign-in." on={draft.mobileRedirectOverride} onPress={() => patch({ mobileRedirectOverride: !draft.mobileRedirectOverride })} />
      {draft.mobileRedirectOverride ? <Field label="Mobile redirect URI" autoCapitalize="none" value={draft.mobileRedirectUri} onChangeText={(mobileRedirectUri) => patch({ mobileRedirectUri })} /> : null}
      <Button label="Save" onPress={() => void save()} />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 14 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  notice: { fontFamily: font, color: theme.text, fontSize: 14 },
  unlink: { gap: 8 },
  actions: { flexDirection: 'row', gap: 8 },
  redirect: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12 },
  redirectText: { flex: 1, fontFamily: font, color: theme.text, fontSize: 14 },
  copy: { fontFamily: font, color: theme.text, fontWeight: '700' },
})
