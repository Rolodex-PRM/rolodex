import { createElement, useEffect, useRef, type ReactNode } from 'react'
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { BrandLockup, RolodexMark } from './logo'
import { mountParticles } from './particles'
import { font, theme } from './theme'

export function AuthFrame({
  title,
  subtitle,
  busy,
  children,
  footer,
}: {
  title: string
  subtitle: string
  busy?: boolean
  children: ReactNode
  footer?: ReactNode
}) {
  const wide = useWindowDimensions().width >= 960
  const card = (
    <View style={[styles.card, Platform.OS === 'web' && styles.cardShadow]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {children}
      {footer}
    </View>
  )
  if (!wide) {
    return (
      <View style={styles.mobilePage}>
        <BrandLockup spinning={busy} size={52} />
        {card}
      </View>
    )
  }
  return (
    <View style={styles.pageWide}>
      <View style={styles.brand}>
        <ParticleField />
        <View style={styles.brandCopy}>
          <View style={styles.brandRow}>
            <RolodexMark size={64} spinning={busy} tone="paper" />
            <Text style={styles.word}>rolodex</Text>
          </View>
          <Text style={styles.tagline}>your people. your books.</Text>
        </View>
      </View>
      <View style={styles.formSide}>{card}</View>
    </View>
  )
}

function ParticleField() {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!canvas.current) return
    return mountParticles(canvas.current)
  }, [])
  if (Platform.OS !== 'web') return null
  return createElement('canvas', {
    ref: canvas,
    style: { position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' },
  })
}

const styles = StyleSheet.create({
  mobilePage: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 28 },
  pageWide: { flex: 1, flexDirection: 'row', backgroundColor: theme.bg },
  brand: { flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 48 },
  brandCopy: { zIndex: 1, alignItems: 'center', gap: 14 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  word: { fontFamily: font, color: '#ffffff', fontSize: 48, fontWeight: '700', letterSpacing: -1.4 },
  tagline: { fontFamily: font, color: '#ffffff', fontSize: 28, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center' },
  formSide: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: theme.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 28,
    gap: 14,
  },
  cardShadow: { boxShadow: '0 16px 40px rgba(17, 17, 17, 0.06)' } as object,
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
  subtitle: { fontFamily: font, color: theme.muted, marginTop: -6, marginBottom: 6 },
})
