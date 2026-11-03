import { useEffect, useState } from 'react'
import { Text } from 'react-native'
import { api, send } from './api'
import { font, theme } from './theme'
import { Button, Field, Notice } from './ui'

type Settings = { enabled: boolean; baseUrl: string; model: string; hasKey: boolean }

export function AiAdmin({ workspaceId }: { workspaceId: string }) {
  const [draft, setDraft] = useState<Settings>({ enabled: true, baseUrl: '', model: '', hasKey: false })
  const [apiKey, setApiKey] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api<Settings>(`/api/workspaces/${workspaceId}/ai`).then(setDraft).catch((caught: Error) => setError(caught.message))
  }, [workspaceId])

  async function save() {
    setError('')
    setNotice('')
    try {
      const saved = await send<Settings>(`/api/workspaces/${workspaceId}/ai`, 'PUT', { baseUrl: draft.baseUrl, model: draft.model, apiKey })
      setDraft(saved)
      setApiKey('')
      setNotice('AI settings saved')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save AI settings')
    }
  }

  async function test() {
    setError('')
    setNotice('')
    try {
      await send(`/api/workspaces/${workspaceId}/ai/test`, 'POST')
      setNotice('The AI server answered')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The AI server did not answer')
    }
  }

  return (
    <>
      <Text style={styles.meta}>Use an OpenAI-compatible server. Suggestions are shown only when the value is on the source page, and someone still has to approve them.</Text>
      <Field label="Server" autoCapitalize="none" value={draft.baseUrl} onChangeText={(baseUrl) => setDraft({ ...draft, baseUrl })} placeholder="https://api.openai.com/v1" />
      <Field label="Model" autoCapitalize="none" value={draft.model} onChangeText={(model) => setDraft({ ...draft, model })} placeholder="gpt-4.1-mini" />
      <Field label={draft.hasKey ? 'API key, leave blank to keep the saved key' : 'API key'} autoCapitalize="none" secureTextEntry value={apiKey} onChangeText={setApiKey} />
      {error ? <Notice text={error} /> : null}
      {notice ? <Text style={styles.meta}>{notice}</Text> : null}
      <Button label="Save" onPress={() => void save()} />
      <Button label="Test connection" tone="ghost" onPress={() => void test()} />
    </>
  )
}

const styles = { meta: { fontFamily: font, color: theme.muted, fontSize: 14, marginBottom: 8 } }
