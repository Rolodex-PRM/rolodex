import { useLocalSearchParams } from 'expo-router'
import { useWindowDimensions } from 'react-native'
import { PluginFrame } from '../../../src/plugin-frame'

export default function PluginPage() {
  const { id, contact } = useLocalSearchParams<{ id: string; contact?: string }>()
  const pluginId = typeof id === 'string' ? id : ''
  const contactId = typeof contact === 'string' ? contact : undefined
  const wide = useWindowDimensions().width >= 880
  const height = wide ? 'calc(100dvh - 190px)' : 'calc(100dvh - 280px)'
  return <PluginFrame pluginId={pluginId} contactId={contactId} showTitle bleed height={height} />
}
