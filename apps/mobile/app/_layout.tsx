import { Stack, useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'
import { useWindowDimensions, View } from 'react-native'
import { AccentProvider } from '../src/accent'
import { AuthProvider, useAuth } from '../src/auth'
import { ColorSchemeProvider } from '../src/color-scheme'
import { CustomCss } from '../src/custom-css'
import { Loader, Splash } from '../src/logo'
import { theme } from '../src/theme'

function Gate() {
  const { ready, session } = useAuth()
  const segments = useSegments()
  const router = useRouter()
  const narrow = useWindowDimensions().width < 880
  useEffect(() => {
    if (!ready) return
    const inAuth = segments[0] === '(auth)'
    if (!session && !inAuth) router.replace('/sign-in')
    if (session && inAuth) router.replace('/')
  }, [ready, session, segments, router])
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        {narrow ? <Splash /> : <Loader caption="rolodex" />}
      </View>
    )
  }
  return <Stack screenOptions={{ headerShown: false }} />
}

function ThemedGate() {
  const { session } = useAuth()
  return (
    <AccentProvider userId={session?.id}>
      <Gate />
    </AccentProvider>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ColorSchemeProvider>
        <CustomCss />
        <ThemedGate />
      </ColorSchemeProvider>
    </AuthProvider>
  )
}
