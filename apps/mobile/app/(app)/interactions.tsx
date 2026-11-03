import { StyleSheet, View } from 'react-native'
import { useAuth } from '../../src/auth'
import { Timeline } from '../../src/timeline'

export default function InteractionsPage() {
  const { workspace } = useAuth()
  const canWrite = workspace?.role === 'owner' || workspace?.role === 'administrator' || workspace?.role === 'editor'
  if (!workspace) return null
  return (
    <View style={styles.page}>
      <Timeline workspaceId={workspace.id} canWrite={canWrite} title="Interactions" />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 16 },
})
