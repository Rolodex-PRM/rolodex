import { useState } from 'react'
import { Image } from 'react-native'

export function OrgLogo({ uri, size = 40 }: { uri: string | null; size?: number }) {
  const [hidden, setHidden] = useState(false)
  if (!uri || hidden) return null
  return <Image accessibilityLabel="" onError={() => setHidden(true)} source={{ uri }} style={{ width: size, height: size, borderRadius: Math.round(size / 4), backgroundColor: '#f5f5f5' }} />
}
