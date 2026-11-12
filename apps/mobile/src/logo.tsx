import { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import Logo, { type LogoProps } from '../logo'
import { useAccent } from './accent'
import { font, theme } from './theme'

type Tone = 'ink' | 'paper'
type Motion = 'idle' | 'intro' | 'busy' | 'search'
type MarkVariant = 'symbol' | 'compact'

export type RolodexLogoProps = {
  accentColor?: string
  animateOnLoad?: boolean
  searching?: boolean
  busy?: boolean
  tone?: Tone
  variant?: 'full' | 'icon' | 'compact'
  className?: string
  size?: number | string
  title?: string
}

function rgb(hex: string) {
  const raw = hex.replace('#', '')
  return [0, 2, 4].map((start) => Number.parseInt(raw.slice(start, start + 2), 16) || 0) as [number, number, number]
}

function toHex(channels: [number, number, number]) {
  return `#${channels.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`
}

function mix(from: string, to: string, weight: number) {
  const left = rgb(from)
  const right = rgb(to)
  return toHex([0, 1, 2].map((index) => left[index]! * (1 - weight) + right[index]! * weight) as [number, number, number])
}

function isNearGray(hex: string) {
  const [red, green, blue] = rgb(hex)
  return Math.max(red, green, blue) - Math.min(red, green, blue) < 30
}

function luminance(hex: string) {
  const [red, green, blue] = rgb(hex)
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
}

/** Monochrome ink + surface for the SVG mark. Every shade is mixed from these two. */
export function markColors(accent: string, tone: Tone = 'ink'): { color: string; background: string } {
  if (tone === 'paper') {
    // Light mark for dark surfaces: keep a readable ink tinted by accent.
    if (isNearGray(accent) || luminance(accent) < 0.35) {
      return { color: '#ffffff', background: mix('#ffffff', '#111111', 0.18) }
    }
    return { color: mix(accent, '#ffffff', 0.55), background: '#ffffff' }
  }
  return { color: accent, background: '#ffffff' }
}

function prefersReducedMotion() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function NativeMark({ size, color, background }: { size: number; color: string; background: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.55, height: size * 0.03, borderRadius: size, backgroundColor: color }} />
      <View
        style={{
          width: size * 0.34,
          height: size * 0.3,
          marginTop: 2,
          backgroundColor: background,
          borderColor: color,
          borderWidth: 1,
          borderRadius: 2,
          transform: [{ rotate: '-10deg' }],
        }}
      />
      <View style={{ width: size * 0.62, height: size * 0.04, marginTop: 4, borderRadius: 2, backgroundColor: color }} />
    </View>
  )
}

function Mark({
  size = 48,
  color,
  background,
  loading = false,
  title = 'Rolodex',
  className,
}: {
  size?: number
  color: string
  background: string
  loading?: boolean
  title?: string
  className?: string
}) {
  if (Platform.OS !== 'web') {
    return <NativeMark size={size} color={color} background={background} />
  }
  return (
    <Logo
      size={size}
      color={color}
      background={background}
      loading={loading}
      title={title}
      className={className}
    />
  )
}

/** Direct accent-colored mark; prefer RolodexMark for app chrome. */
export default function RolodexLogo({
  accentColor,
  animateOnLoad = true,
  searching = false,
  busy = false,
  tone = 'ink',
  size = 240,
  className = '',
  title = 'Rolodex',
}: RolodexLogoProps) {
  const colors = markColors(accentColor ?? '#111111', tone)
  const reduced = prefersReducedMotion()
  const [intro, setIntro] = useState(() => Boolean(animateOnLoad) && !reduced && !busy && !searching)

  useEffect(() => {
    if (!intro) return
    const timer = setTimeout(() => setIntro(false), 1900)
    return () => clearTimeout(timer)
  }, [intro])

  const loading = !reduced && (busy || searching || intro)
  const sizeNum = typeof size === 'number' ? size : Number.parseFloat(String(size)) || 64
  return (
    <Mark
      size={sizeNum}
      color={colors.color}
      background={colors.background}
      loading={loading}
      title={title}
      className={className}
    />
  )
}

export function RolodexMark({
  size = 48,
  spinning = false,
  tone = 'ink',
  motion,
  variant: _variant = 'symbol',
}: {
  size?: number
  spinning?: boolean
  tone?: Tone
  motion?: Motion
  variant?: MarkVariant
}) {
  const { accent } = useAccent()
  const colors = markColors(accent, tone)
  const reduced = prefersReducedMotion()
  const desired: Motion = motion ?? (spinning ? 'busy' : 'idle')
  const [phase, setPhase] = useState<Motion>(() => {
    if (reduced) return 'idle'
    if (desired === 'busy' || desired === 'search' || desired === 'intro') return desired
    return 'idle'
  })

  useEffect(() => {
    if (reduced) {
      setPhase('idle')
      return
    }
    if (desired === 'intro') {
      setPhase('intro')
      const timer = setTimeout(() => setPhase('idle'), 1900)
      return () => clearTimeout(timer)
    }
    if (desired === 'search') {
      setPhase('search')
      const timer = setTimeout(() => setPhase('idle'), 900)
      return () => clearTimeout(timer)
    }
    setPhase(desired)
  }, [desired, reduced])

  const loading = phase === 'busy' || phase === 'search' || phase === 'intro'

  return (
    <Mark
      size={size}
      color={colors.color}
      background={colors.background}
      loading={loading}
      title="Rolodex"
    />
  )
}

export function Loader({ caption }: { caption?: string }) {
  return (
    <View style={styles.loader}>
      <RolodexMark size={80} motion="busy" />
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  )
}

export function BrandLockup({
  spinning = false,
  size = 54,
  motion,
}: {
  spinning?: boolean
  size?: number
  motion?: Motion
}) {
  return (
    <View style={styles.lockup}>
      <View style={styles.lockupRow}>
        <RolodexMark size={size} motion={motion ?? (spinning ? 'busy' : 'idle')} />
        <Text style={styles.word}>rolodex</Text>
      </View>
      <Text style={styles.tagline}>your people. your books.</Text>
    </View>
  )
}

export function Splash() {
  return (
    <View style={styles.splash}>
      <BrandLockup size={64} motion="intro" />
    </View>
  )
}

/** Re-export mark primitive for callers that want raw SVG props. */
export type { LogoProps }

const styles = StyleSheet.create({
  loader: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 10 },
  caption: { fontFamily: font, color: theme.muted, fontSize: 14, letterSpacing: 0.4 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
  lockup: { alignItems: 'center', gap: 8 },
  lockupRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  word: { fontFamily: font, color: theme.text, fontSize: 40, fontWeight: '700', letterSpacing: -1.2 },
  tagline: { fontFamily: font, color: '#a3a3a3', fontSize: 16 },
})
