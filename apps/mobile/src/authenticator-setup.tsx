import { useEffect, useState } from 'react'
import { Image, Platform, StyleSheet, Text, View } from 'react-native'
import { font, theme } from './theme'

export function AuthenticatorSetup({ secret, otpauth }: { secret: string; otpauth: string }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    if (Platform.OS !== 'web' || !otpauth) return
    let cancel = false
    void import('qrcode')
      .then((qr) => qr.toDataURL(otpauth, { margin: 1, width: 180, color: { dark: '#111111', light: '#ffffff' } }))
      .then((url) => {
        if (!cancel) setSrc(url)
      })
      .catch(() => setSrc(''))
    return () => {
      cancel = true
    }
  }, [otpauth])

  return (
    <View style={styles.block}>
      <Text style={styles.meta}>
        Scan this with Microsoft Authenticator, Google Authenticator, Authentik, 1Password, or any other authenticator app. You can also type the secret by hand.
      </Text>
      {src ? (
        <View style={styles.frame}>
          <Image accessibilityLabel="Authenticator setup code" source={{ uri: src }} style={styles.code} />
        </View>
      ) : null}
      <Text selectable style={styles.secret}>{secret}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  frame: { alignSelf: 'flex-start', backgroundColor: '#ffffff', padding: 8, borderRadius: 12 },
  code: { width: 180, height: 180 },
  secret: { fontFamily: font, color: theme.text, fontSize: 16, fontWeight: '700' },
})
