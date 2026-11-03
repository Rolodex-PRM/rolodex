import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'

export const accentPresets = [
  { name: 'Black', value: '#111111' },
  { name: 'Graphite', value: '#3f3f46' },
  { name: 'Slate', value: '#334155' },
  { name: 'Blue', value: '#1d4ed8' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Green', value: '#15803d' },
  { name: 'Amber', value: '#b45309' },
  { name: 'Red', value: '#b91c1c' },
]

function readable(hex: string) {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return '#ffffff'
  const red = Number.parseInt(raw.slice(0, 2), 16)
  const green = Number.parseInt(raw.slice(2, 4), 16)
  const blue = Number.parseInt(raw.slice(4, 6), 16)
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
  return luminance > 0.62 ? '#111111' : '#ffffff'
}

type AccentValue = { accent: string; onAccent: string; setAccent: (value: string) => void }

const AccentContext = createContext<AccentValue>({
  accent: '#111111',
  onAccent: '#ffffff',
  setAccent: () => {},
})

function storageKey(userId?: string | null) {
  return `rolodex.accent.${userId || 'local'}`
}

export function AccentProvider({ userId, children }: { userId?: string | null; children: ReactNode }) {
  const [accent, setAccentState] = useState('#111111')

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return
    const stored = localStorage.getItem(storageKey(userId))
    setAccentState(stored && /^#[0-9a-fA-F]{6}$/.test(stored) ? stored.toLowerCase() : '#111111')
  }, [userId])

  const value = useMemo<AccentValue>(
    () => ({
      accent,
      onAccent: readable(accent),
      setAccent(next) {
        const color = (next.startsWith('#') ? next : `#${next}`).toLowerCase()
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return
        setAccentState(color)
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(storageKey(userId), color)
      },
    }),
    [accent, userId],
  )

  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>
}

export function useAccent() {
  return useContext(AccentContext)
}

export function enrichmentColors(accent: string, scheme: 'light' | 'dark') {
  const background = mixHex(accent, scheme === 'dark' ? '#121212' : '#ffffff', 0.22)
  return { backgroundColor: background, color: readable(background) }
}

function mixHex(from: string, to: string, weight: number) {
  const left = rgb(from)
  const right = rgb(to)
  const channel = (index: number) => Math.round((left[index] ?? 0) * weight + (right[index] ?? 0) * (1 - weight)).toString(16).padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

function rgb(hex: string) {
  const raw = hex.replace('#', '')
  return [0, 2, 4].map((start) => Number.parseInt(raw.slice(start, start + 2), 16))
}
