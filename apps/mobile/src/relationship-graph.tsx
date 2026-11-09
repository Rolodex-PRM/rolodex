import { Platform, StyleSheet, Text, View } from 'react-native'
import { NetworkExplorer } from './network-explorer'
import { font, theme } from './theme'
import { Panel } from './ui'

export function RelationshipGraph({
  workspaceId: _workspaceId,
  contactId,
  name: _name,
}: {
  workspaceId: string
  contactId: string
  name: string
}) {
  return (
    <Panel>
      <Text style={styles.section}>Relationships</Text>
      {Platform.OS === 'web' ? (
        <View style={styles.stage}>
          <NetworkExplorer height={420} focusId={contactId} embedded />
        </View>
      ) : (
        <Text style={styles.meta}>Open on web to explore this person’s network graph.</Text>
      )}
    </Panel>
  )
}

const styles = StyleSheet.create({
  section: { fontFamily: font, fontSize: 13, color: theme.muted, marginBottom: 8, letterSpacing: 0.4 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  stage: { marginHorizontal: -4 },
})
