import { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { SwitchRow } from '../../../src/admin-fields'
import { api, send } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { installCustomCss, userCssKey, type Appearance } from '../../../src/custom-css'
import { font, theme } from '../../../src/theme'
import { Button, Notice } from '../../../src/ui'

const variables = '--rx-bg, --rx-surface, --rx-raised, --rx-text, --rx-muted, --rx-border, --rx-hover'

export default function AppearancePage() {
  const { workspace, session } = useAuth()
  const [css, setCss] = useState('')
  const [userCss, setUserCss] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api<Appearance>('/api/appearance').then((appearance) => {
      setCss(appearance.css)
      setUserCss(appearance.userCss)
    }).catch((caught: Error) => setError(caught.message))
  }, [])

  async function save(next: { css: string; userCss: boolean }) {
    if (!workspace) return
    setError('')
    setNotice('')
    const saved = await send<Appearance>(`/api/workspaces/${workspace.id}/appearance`, 'PUT', next)
    setCss(saved.css)
    setUserCss(saved.userCss)
    const personal = saved.userCss && session && typeof localStorage !== 'undefined' ? localStorage.getItem(userCssKey(session.id)) || '' : ''
    installCustomCss(saved.css, personal)
    setNotice('Appearance saved')
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Appearance</Text>
      <Text style={styles.meta}>Custom CSS applies to everyone on this server, in both light and dark mode. You can restyle the app or override {variables}.</Text>
      {error ? <Notice text={error} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={styles.label}>Server CSS</Text>
      <TextInput
        multiline
        value={css}
        onChangeText={setCss}
        placeholder="html { --rx-bg: #101010; }"
        placeholderTextColor={theme.muted}
        style={styles.editor}
      />
      <SwitchRow
        label="Let each person add their own CSS"
        detail="People get a CSS box in Settings. It is saved in that browser and applied after the server CSS."
        on={userCss}
        onPress={() => {
          const next = !userCss
          setUserCss(next)
          void save({ css, userCss: next }).catch((caught: Error) => setError(caught.message))
        }}
      />
      <Button label="Save CSS" onPress={() => void save({ css, userCss }).catch((caught: Error) => setError(caught.message))} />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 12 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 14 },
  notice: { fontFamily: font, color: theme.text, fontSize: 14 },
  label: { fontFamily: font, color: theme.muted, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  editor: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.raised,
    color: theme.text,
    borderRadius: 14,
    padding: 14,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    textAlignVertical: 'top',
  },
})
