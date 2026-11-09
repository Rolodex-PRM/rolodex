export const font = 'Segoe UI, Inter, ui-sans-serif, system-ui, sans-serif'

export type Scheme = 'light' | 'dark'

const light = {
  bg: '#f4f4f4',
  surface: '#ffffff',
  raised: '#ececec',
  text: '#1a1a1a',
  muted: '#6b6b6b',
  border: '#e4e4e4',
  accent: '#1a1a1a',
  accentMuted: '#f0f0f0',
  danger: '#b91c1c',
  ink: '#111111',
  on: '#ffffff',
  hover: '#f0f0f0',
  shadow: '0 12px 32px rgba(17, 17, 17, 0.08)',
  glass: 'rgba(255,255,255,0.78)',
  header: 'rgba(255,255,255,0.92)',
  dock: 'rgba(255,255,255,0.94)',
  dockBorder: 'rgba(255,255,255,0.8)',
  plus: '#e4e4e7',
  plusIcon: '#3f3f46',
  popoverBorder: 'rgba(255,255,255,0.7)',
  line: 'rgba(17,17,17,0.08)',
}

const dark: typeof light = {
  bg: '#121212',
  surface: '#1e1e1e',
  raised: '#2a2a2a',
  text: '#ffffff',
  muted: '#d0d0d0',
  border: '#3a3a3a',
  accent: '#ffffff',
  accentMuted: '#2a2a2a',
  danger: '#ff8a80',
  ink: '#111111',
  on: '#121212',
  hover: '#323232',
  shadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
  glass: 'rgba(30,30,30,0.94)',
  header: '#111111',
  dock: 'rgba(30,30,30,0.96)',
  dockBorder: 'rgba(255,255,255,0.1)',
  plus: '#3a3a3a',
  plusIcon: '#f5f5f5',
  popoverBorder: 'rgba(255,255,255,0.12)',
  line: 'rgba(255,255,255,0.1)',
}

function cssName(key: string) {
  return `--rx-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

export const theme = Object.fromEntries(Object.keys(light).map((key) => [key, `var(${cssName(key)})`])) as { [Key in keyof typeof light]: string }

const storageKey = 'rolodex.scheme'

export function readScheme(): Scheme {
  if (typeof localStorage === 'undefined') return 'light'
  return localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light'
}

function schemeSheet(scheme: Scheme) {
  const palette = scheme === 'dark' ? dark : light
  const variables = Object.entries(palette).map(([key, value]) => `${cssName(key)}:${value}`).join(';')
  return [
    `html{${variables};background:${palette.bg};color-scheme:${scheme};color:${palette.text};transition:background-color 120ms ease,color 120ms ease}`,
    `body{background:${palette.bg};color:${palette.text};transition:background-color 120ms ease,color 120ms ease}`,
    'input,textarea{caret-color:var(--rx-text)}',
  ].join('')
}

export function applyScheme(scheme: Scheme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.scheme = scheme
  let node = document.getElementById('rolodex-scheme') as HTMLStyleElement | null
  if (!node) {
    node = document.createElement('style')
    node.id = 'rolodex-scheme'
    document.head.prepend(node)
  }
  node.textContent = schemeSheet(scheme)
}

if (typeof document !== 'undefined') applyScheme(readScheme())
