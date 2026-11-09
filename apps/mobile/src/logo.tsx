import React, { useEffect, useId, useMemo, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { useAccent } from './accent'
import { font, theme } from './theme'

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

type Tone = 'ink' | 'paper'
type Motion = 'idle' | 'intro' | 'busy' | 'search'
type MarkVariant = 'symbol' | 'compact'

type Palette = {
  frame: string
  knob: string
  cardFront: string
  cardNear: string
  cardMid: string
  cardFar: string
  detail: string
  lines: string
}

/**
 * Desk Rolodex mark.
 * Cards are real 3D panels hinged on the horizontal spindle (rotateX).
 * Busy / search / intro flip them over the drum the way a Rolodex actually moves.
 *
 * Rest pose: every top edge sits on the drum row. Mild negative rotateX tucks
 * the fan behind/under without lifting cards above the spindle. The last card
 * is face-on in front with the contact glyph.
 */
const REST_X = [-38, -28, -20, -12, -6, 0]
const DELAYS = ['0ms', '80ms', '160ms', '240ms', '320ms', '400ms']

const inkPalette: Palette = {
  frame: '#1B2A4A',
  knob: '#6B9AD8',
  cardFront: '#FFFFFF',
  cardNear: '#D7E4F5',
  cardMid: '#B7CCEA',
  cardFar: '#93B0D9',
  detail: '#1B2A4A',
  lines: '#8AB0D9',
}

const paperTone: Palette = {
  frame: '#FFFFFF',
  knob: '#C4CAD3',
  cardFront: '#FFFFFF',
  cardNear: '#E8EBF0',
  cardMid: '#C4CAD3',
  cardFar: '#8B95A3',
  detail: '#1B2A4A',
  lines: '#C4CAD3',
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

export function logoPalette(accent: string, tone: Tone = 'ink'): Palette {
  if (tone === 'paper') {
    if (isNearGray(accent)) return paperTone
    return {
      frame: mix(accent, '#ffffff', 0.92),
      knob: mix(accent, '#ffffff', 0.55),
      cardFront: '#ffffff',
      cardNear: mix(accent, '#ffffff', 0.88),
      cardMid: mix(accent, '#ffffff', 0.72),
      cardFar: mix(accent, '#ffffff', 0.55),
      detail: mix(accent, '#0a0a0a', 0.45),
      lines: mix(accent, '#ffffff', 0.5),
    }
  }
  if (!isNearGray(accent)) {
    return {
      frame: mix(accent, '#0a1220', 0.55),
      knob: mix(accent, '#ffffff', 0.35),
      cardFront: '#ffffff',
      cardNear: mix(accent, '#ffffff', 0.88),
      cardMid: mix(accent, '#ffffff', 0.72),
      cardFar: mix(accent, '#ffffff', 0.52),
      detail: mix(accent, '#0a1220', 0.45),
      lines: mix(accent, '#ffffff', 0.42),
    }
  }
  return inkPalette
}

function prefersReducedMotion() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function faceFill(i: number, n: number) {
  if (i === n - 1) return 'var(--rx-front)'
  const t = i / Math.max(1, n - 2)
  if (t < 0.35) return 'var(--rx-far)'
  if (t < 0.7) return 'var(--rx-mid)'
  return 'var(--rx-near)'
}

/** Design-space width. The whole mark is authored at this size, then scaled. */
const BASE_W = 240
const BASE_H = 180
const BASE_H_WORD = 210

function ensureStyles(uid: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return
  const id = `rx-logo-${uid}`
  document.getElementById(id)?.remove()
  const el = document.createElement('style')
  el.id = id
  el.textContent = `
    .rx-${uid} {
      display: block;
      line-height: 0;
      position: relative;
      width: var(--rx-size, ${BASE_W}px);
      height: calc(var(--rx-size, ${BASE_W}px) * ${BASE_H} / ${BASE_W});
      overflow: visible;
    }
    .rx-${uid}[data-word='1'] {
      height: calc(var(--rx-size, ${BASE_W}px) * ${BASE_H_WORD} / ${BASE_W});
    }
    /*
     * Fixed design space + uniform scale. Perspective / translateZ stay stable
     * at every size, so cards don't drift off the drum when shrinking.
     */
    .rx-${uid} .rx-viewport {
      position: absolute;
      left: 0;
      top: 0;
      width: ${BASE_W}px;
      height: ${BASE_H}px;
      transform: scale(var(--rx-scale, 1));
      transform-origin: 0 0;
      perspective: 640px;
      perspective-origin: 50% 38%;
    }
    .rx-${uid}[data-word='1'] .rx-viewport { height: ${BASE_H_WORD}px; }
    .rx-${uid} .rx-scene {
      position: absolute;
      inset: 0;
      transform-style: preserve-3d;
      transform: rotateY(-18deg) rotateX(10deg);
    }
    .rx-${uid} .rx-stand,
    .rx-${uid} .rx-axle {
      position: absolute;
      left: 0;
      top: 0;
      width: ${BASE_W}px;
      height: ${BASE_H}px;
      overflow: visible;
      pointer-events: none;
      transform-style: preserve-3d;
    }
    .rx-${uid} .rx-stand { transform: translateZ(-14px); }
    /* Card pack top edge sits on the drum centerline (y = 55). */
    .rx-${uid} .rx-cards {
      position: absolute;
      left: 69px;
      top: 55px;
      width: 102px;
      height: 86px;
      transform-style: preserve-3d;
    }
    .rx-${uid} .rx-axle { transform: translateZ(10px); }
    .rx-${uid} .rx-card {
      position: absolute;
      inset: 0;
      transform-style: preserve-3d;
      transform: translateZ(var(--z, 0px));
    }
    .rx-${uid} .rx-hinge {
      position: absolute;
      inset: 0;
      transform-style: preserve-3d;
      transform-origin: 50% 0%;
      transform: rotateX(var(--rx, 0deg));
      will-change: transform;
    }
    .rx-${uid} .rx-face {
      position: absolute;
      inset: 0;
      border-radius: 7px;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      box-shadow: 0 1px 0 rgba(27, 42, 74, 0.08);
    }
    .rx-${uid} .rx-face-front {
      background: var(--face, var(--rx-front));
      border: 0.5px solid rgba(27, 42, 74, 0.1);
    }
    .rx-${uid} .rx-face-back {
      background: var(--rx-mid);
      border: 0.5px solid rgba(27, 42, 74, 0.08);
      transform: rotateX(180deg);
    }
    .rx-${uid} .rx-glyph {
      position: absolute;
      left: 14%;
      top: 16%;
      width: 72%;
      height: 58%;
    }
    .rx-${uid} .rx-glyph svg { width: 100%; height: 100%; display: block; }
    .rx-${uid} .rx-word {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 8px;
      text-align: center;
      font: 650 18px/1 "Segoe UI", Inter, system-ui, sans-serif;
      letter-spacing: -0.04em;
      color: var(--rx-frame);
      z-index: 4;
    }
    .rx-${uid}[data-motion='intro'] .rx-hinge,
    .rx-${uid}[data-motion='search'] .rx-hinge,
    .rx-${uid}[data-motion='busy'] .rx-hinge {
      animation: rx-flip-${uid} var(--dur, 1.15s) cubic-bezier(.4,.05,.2,1) var(--loop, both);
      animation-delay: var(--d, 0ms);
    }
    .rx-${uid}[data-motion='intro'] .rx-hinge { --dur: 1.2s; --loop: both; }
    .rx-${uid}[data-motion='search'] .rx-hinge { --dur: .75s; --loop: both; }
    .rx-${uid}[data-motion='busy'] .rx-hinge { --dur: 1.15s; --loop: infinite; }
    .rx-${uid}[data-motion='idle'] .rx-hinge { animation: none; }
    @keyframes rx-flip-${uid} {
      from { transform: rotateX(var(--rx, 0deg)); }
      to   { transform: rotateX(calc(var(--rx, 0deg) - 360deg)); }
    }
    @media (prefers-reduced-motion: reduce) {
      .rx-${uid} .rx-hinge { animation: none !important; transform: rotateX(var(--rx, 0deg)) !important; }
      .rx-${uid} .rx-scene { transform: rotateY(-16deg) rotateX(8deg) !important; }
    }
  `
  document.head.appendChild(el)
}

function ContactGlyph() {
  return (
    <div className="rx-glyph">
      <svg viewBox="0 0 80 56" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <circle cx={18} cy={16} r={10} fill="var(--rx-detail)" />
        <path d="M2 48 Q2 30 18 30 Q34 30 34 48 Z" fill="var(--rx-detail)" />
        <rect x={42} y={10} width={34} height={6} rx={3} fill="var(--rx-line)" />
        <rect x={42} y={24} width={26} height={6} rx={3} fill="var(--rx-line)" />
      </svg>
    </div>
  )
}

export default function RolodexLogo({
  accentColor,
  animateOnLoad = true,
  searching = false,
  busy = false,
  tone = 'ink',
  variant = 'full',
  size = 240,
  className = '',
  title = 'Rolodex',
}: RolodexLogoProps) {
  const uid = useId().replace(/:/g, '')
  const compact = variant === 'compact'
  const showWordmark = variant === 'full'
  const reduced = prefersReducedMotion()
  const palette = logoPalette(accentColor ?? '#6B9AD8', tone)

  useEffect(() => {
    ensureStyles(uid)
  }, [uid])

  const motion: Motion = reduced
    ? 'idle'
    : busy
      ? 'busy'
      : searching
        ? 'search'
        : animateOnLoad
          ? 'intro'
          : 'idle'

  const rests = compact ? [REST_X[0]!, REST_X[2]!, REST_X[5]!] : REST_X
  const front = rests.length - 1
  const sizeNum = typeof size === 'number' ? size : Number.parseFloat(String(size)) || BASE_W
  const sizePx = typeof size === 'number' ? `${size}px` : String(size)
  const scale = sizeNum / BASE_W

  const style = {
    '--rx-frame': palette.frame,
    '--rx-knob': palette.knob,
    '--rx-front': palette.cardFront,
    '--rx-near': palette.cardNear,
    '--rx-mid': palette.cardMid,
    '--rx-far': palette.cardFar,
    '--rx-detail': palette.detail,
    '--rx-line': palette.lines,
    '--rx-size': sizePx,
    '--rx-scale': String(scale),
  } as React.CSSProperties

  return (
    <div
      className={`rx-${uid} ${className}`}
      data-motion={motion}
      data-word={showWordmark ? '1' : '0'}
      style={style}
      role="img"
      aria-label={title}
    >
      <div className="rx-viewport">
        <div className="rx-scene">
          <svg className="rx-stand" viewBox={`0 0 ${BASE_W} ${BASE_H}`} width={BASE_W} height={BASE_H} aria-hidden>
            <path
              d="M48 58 L24 168 L216 168 L192 58"
              fill="none"
              stroke="var(--rx-frame)"
              strokeWidth={14}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.2}
            />
            <path
              d="M45 55 L20 165 L220 165 L195 55"
              fill="none"
              stroke="var(--rx-frame)"
              strokeWidth={11}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M20 165 L220 165" fill="none" stroke="var(--rx-frame)" strokeWidth={11} strokeLinecap="round" />
          </svg>

          <div className="rx-cards">
            {rests.map((angle, i) => {
              // Fan behind the drum; front contact card closest to camera.
              const depth = i === front ? 20 : -6 - (front - i) * 8
              // Cascade from front to back with a short overlapping stagger.
              const flipOrder = front - i
              return (
                <div
                  key={i}
                  className="rx-card"
                  style={
                    {
                      ['--z' as string]: `${depth}px`,
                      ['--face' as string]: faceFill(i, rests.length),
                      zIndex: i + 1,
                    } as React.CSSProperties
                  }
                >
                  <div
                    className="rx-hinge"
                    style={
                      {
                        ['--rx' as string]: `${angle}deg`,
                        ['--d' as string]: DELAYS[flipOrder] ?? `${flipOrder * 80}ms`,
                      } as React.CSSProperties
                    }
                  >
                    <div className="rx-face rx-face-front">{i === front ? <ContactGlyph /> : null}</div>
                    <div className="rx-face rx-face-back" />
                  </div>
                </div>
              )
            })}
          </div>

          <svg className="rx-axle" viewBox={`0 0 ${BASE_W} ${BASE_H}`} width={BASE_W} height={BASE_H} aria-hidden>
            {/* Drum between the hubs — the cylinder cards flip over */}
            <rect x={52} y={44} width={136} height={22} rx={11} fill="var(--rx-frame)" />
            <rect x={56} y={47} width={128} height={6} rx={3} fill="var(--rx-knob)" opacity={0.35} />
            <circle cx={39} cy={55} r={15} fill="var(--rx-frame)" />
            <circle cx={201} cy={55} r={15} fill="var(--rx-frame)" />
            <circle cx={39} cy={55} r={5.5} fill="var(--rx-knob)" />
            <circle cx={201} cy={55} r={5.5} fill="var(--rx-knob)" />
          </svg>
        </div>
        {showWordmark ? <div className="rx-word">rolodex</div> : null}
      </div>
    </div>
  )
}

export function RolodexMark({
  size = 48,
  spinning = false,
  tone = 'ink',
  motion,
  variant = 'symbol',
}: {
  size?: number
  spinning?: boolean
  tone?: Tone
  motion?: Motion
  variant?: MarkVariant
}) {
  const { accent } = useAccent()
  const colors = useMemo(() => logoPalette(accent, tone), [accent, tone])
  const reduced = prefersReducedMotion()
  const compact = variant === 'compact' || size <= 28
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

  if (Platform.OS !== 'web') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: size * 0.55, height: size * 0.03, borderRadius: size, backgroundColor: colors.frame }} />
        <View
          style={{
            width: size * 0.34,
            height: size * 0.3,
            marginTop: 2,
            backgroundColor: colors.cardFront,
            borderRadius: 2,
            transform: [{ rotate: '-10deg' }],
          }}
        />
        <View style={{ width: size * 0.62, height: size * 0.04, marginTop: 4, borderRadius: 2, backgroundColor: colors.frame }} />
      </View>
    )
  }

  const accentForLogo = isNearGray(accent) ? undefined : accent

  return (
    <RolodexLogo
      accentColor={accentForLogo}
      animateOnLoad={phase === 'intro'}
      searching={phase === 'search'}
      busy={phase === 'busy'}
      tone={tone}
      variant={compact ? 'compact' : 'icon'}
      size={size}
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

const styles = StyleSheet.create({
  loader: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 10 },
  caption: { fontFamily: font, color: theme.muted, fontSize: 14, letterSpacing: 0.4 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
  lockup: { alignItems: 'center', gap: 8 },
  lockupRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  word: { fontFamily: font, color: theme.text, fontSize: 40, fontWeight: '700', letterSpacing: -1.2 },
  tagline: { fontFamily: font, color: '#a3a3a3', fontSize: 16 },
})
