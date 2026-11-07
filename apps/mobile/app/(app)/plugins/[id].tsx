import { useLocalSearchParams } from 'expo-router'
import { PluginFrame } from '../../../src/plugin-frame'

export default function PluginPage() {
  const { id, contact } = useLocalSearchParams<{ id: string; contact?: string }>()
  const pluginId = typeof id === 'string' ? id : ''
  const contactId = typeof contact === 'string' ? contact : undefined
  return <PluginFrame pluginId={pluginId} contactId={contactId} showTitle />
}
