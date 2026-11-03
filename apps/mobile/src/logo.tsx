import { createElement, useEffect, useRef } from 'react'
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native'
import { font, theme } from './theme'

const fan = [
  { angle: 14, lift: 0, shade: 0 },
  { angle: 28, lift: 0.1, shade: 1 },
  { angle: 42, lift: 0.2, shade: 2 },
]

function ensureSpinStyle() {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById('rolodex-spin')) return
  const style = document.createElement('style')
  style.id = 'rolodex-spin'
  style.textContent = [
    '@keyframes rolodex-spin {',
    'from { transform: perspective(800px) rotateX(var(--card-angle)); }',
    'to { transform: perspective(800px) rotateX(calc(var(--card-angle) + 360deg)); }',
    '}',
  ].join(' ')
  document.head.appendChild(style)
}

export function RolodexMark({
  size = 48,
  spinning = false,
  tone = 'ink',
}: {
  size?: number
  spinning?: boolean
  tone?: 'ink' | 'paper'
}) {
  const turn = useRef(new Animated.Value(0)).current
  const paper = tone === 'paper'
  const card = paper ? '#f5f5f5' : '#ffffff'
  const edge = paper ? '#ffffff' : theme.ink
  const line = paper ? 'rgba(17,17,17,0.28)' : '#d4d4d4'
  const base = paper ? '#ffffff' : theme.ink
  const cardWidth = size * 0.72
  const cardHeight = size * 0.5

  useEffect(() => {
    ensureSpinStyle()
    if (Platform.OS === 'web') return
    if (!spinning) {
      turn.stopAnimation()
      Animated.timing(turn, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
      return
    }
    turn.setValue(0)
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: false }))
    loop.start()
    return () => loop.stop()
  }, [spinning, turn])

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      <View style={{ width: size, height: size * 0.78, alignItems: 'center', justifyContent: 'flex-end' }}>
        {[...fan].reverse().map((item) =>
          Platform.OS === 'web' ? (
            createElement(
              'div',
              {
                key: item.angle,
                ref: (node: HTMLDivElement | null) => node?.style.setProperty('--card-angle', `${item.angle}deg`),
                style: {
                  position: 'absolute',
                  bottom: size * (0.14 + item.lift),
                  width: cardWidth,
                  height: cardHeight,
                  background: item.shade === 0 ? card : item.shade === 1 ? (paper ? '#e7e7e7' : '#f3f3f3') : paper ? '#d6d6d6' : '#e7e7e7',
                  border: `1.5px solid ${edge}`,
                  borderRadius: Math.max(3, size * 0.06),
                  boxSizing: 'border-box',
                  transformOrigin: 'center bottom',
                  transform: `perspective(800px) rotateX(${item.angle}deg)`,
                  animation: spinning ? 'rolodex-spin 1.1s linear infinite' : 'none',
                },
              },
              createElement('div', {
                style: { margin: `${Math.max(3, size * 0.1)}px ${size * 0.12}px 0`, height: Math.max(1, size * 0.045), borderRadius: 1, background: line },
              }),
              createElement('div', {
                style: {
                  margin: `${Math.max(2, size * 0.06)}px ${size * 0.12}px 0`,
                  height: Math.max(1, size * 0.045),
                  width: '55%',
                  borderRadius: 1,
                  background: line,
                },
              }),
            )
          ) : (
            <NativeCard key={item.angle} angle={item.angle} turn={turn} width={cardWidth} height={cardHeight} card={card} edge={edge} line={line} />
          ),
        )}
      </View>
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          width: size * 0.92,
          height: size * 0.16,
          backgroundColor: base,
          borderRadius: size * 0.08,
        }}
      />
    </View>
  )
}

function NativeCard({
  angle,
  turn,
  width,
  height,
  card,
  edge,
  line,
}: {
  angle: number
  turn: Animated.Value
  width: number
  height: number
  card: string
  edge: string
  line: string
}) {
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: [`${angle}deg`, `${angle + 360}deg`] })
  return (
    <Animated.View
      style={{
        position: 'absolute',
        bottom: 0,
        width,
        height: height * 2,
        alignItems: 'center',
        transform: [{ perspective: 800 }, { rotateX: rotate }],
      }}
    >
      <View style={{ width, height, backgroundColor: card, borderWidth: 1.5, borderColor: edge, borderRadius: 4 }}>
        <View style={{ marginTop: 6, marginHorizontal: 6, height: 2, backgroundColor: line }} />
      </View>
    </Animated.View>
  )
}

export function Loader({ caption }: { caption?: string }) {
  return (
    <View style={styles.loader}>
      <RolodexMark size={96} spinning />
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  )
}

export function BrandLockup({ spinning = false, size = 54 }: { spinning?: boolean; size?: number }) {
  return (
    <View style={styles.lockup}>
      <View style={styles.lockupRow}>
        <RolodexMark size={size} spinning={spinning} />
        <Text style={styles.word}>rolodex</Text>
      </View>
      <Text style={styles.tagline}>your people. your books.</Text>
    </View>
  )
}

export function Splash() {
  return (
    <View style={styles.splash}>
      <BrandLockup spinning size={64} />
    </View>
  )
}

const styles = StyleSheet.create({
  loader: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 10 },
  caption: { fontFamily: font, color: theme.muted, fontSize: 14, letterSpacing: 0.4 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
  lockup: { alignItems: 'center', gap: 8 },
  lockupRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  word: { fontFamily: font, color: theme.text, fontSize: 40, fontWeight: '700', letterSpacing: -1.2 },
  tagline: { fontFamily: font, color: '#a3a3a3', fontSize: 16 },
})
