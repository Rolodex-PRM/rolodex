import { createElement } from 'react'
import { Platform, Text } from 'react-native'

type Name = 'home' | 'contacts' | 'plus' | 'more' | 'bell' | 'settings' | 'logout' | 'phone' | 'mail' | 'pin' | 'briefcase' | 'building' | 'gift' | 'interactions' | 'task' | 'sun' | 'moon' | 'link' | 'search' | 'calendar' | 'sparkle' | 'undo' | 'redo' | 'reset' | 'eye'

export function Icon({ name, color, size }: { name: Name; color: string; size: number }) {
  if (Platform.OS !== 'web') return <Text style={{ color, fontSize: size * 0.7, lineHeight: size }}>{fallback[name]}</Text>
  if (name === 'sparkle') {
    return createElement(
      'svg',
      { width: size, height: size, viewBox: '0 0 20 20', fill: color, 'aria-hidden': true },
      createElement('path', { key: 's', d: 'M8.334 3.668a.5.5 0 0 1 .492.41l.969 5.295l5.296.969a.5.5 0 0 1 0 .984l-5.296.969l-.969 5.296a.5.5 0 0 1-.984 0l-.969-5.296l-5.295-.969a.5.5 0 0 1 0-.984l5.295-.969l.969-5.295a.5.5 0 0 1 .492-.41m-.54 6.225a.5.5 0 0 1-.401.402l-2.948.539l2.948.54a.5.5 0 0 1 .402.402l.539 2.947l.54-2.947l.02-.075a.5.5 0 0 1 .382-.327l2.947-.54l-2.947-.54a.5.5 0 0 1-.402-.401l-.54-2.948zm8.04-8.725a.5.5 0 0 1 .49.395l.372 1.742l1.743.374a.5.5 0 0 1 0 .978l-1.743.373l-.373 1.743a.5.5 0 0 1-.978 0L14.97 5.03l-1.742-.373a.5.5 0 0 1 0-.978l1.742-.374l.374-1.743l.026-.083a.5.5 0 0 1 .463-.311m0 2.789a.5.5 0 0 1-.211.211c.09.047.164.12.211.21a.5.5 0 0 1 .21-.21a.5.5 0 0 1-.21-.211' }),
    )
  }
  return createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
    ...paths(name, color),
  )
}

const fallback: Record<Name, string> = {
  home: '⌂',
  contacts: '•',
  plus: '+',
  more: '≡',
  bell: '!',
  settings: '⚙',
  logout: '→',
  phone: '☎',
  mail: '@',
  pin: '•',
  briefcase: '□',
  building: '⌂',
  gift: '✶',
  interactions: '✎',
  task: '✓',
  sun: '☀',
  moon: '☾',
  link: '⧉',
  search: '⌕',
  calendar: '▦',
  sparkle: '✦',
  undo: '↺',
  redo: '↻',
  reset: '⟳',
  eye: '◉',
}

function paths(name: Name, color: string) {
  if (name === 'home') return [createElement('path', { key: 'h', d: 'M4 11.2 12 4.5l8 6.7V20a1 1 0 0 1-1 1h-5.2v-5.6H10.2V21H5a1 1 0 0 1-1-1z' })]
  if (name === 'contacts') {
    return [
      createElement('circle', { key: 'h', cx: 12, cy: 8, r: 3.2 }),
      createElement('path', { key: 'b', d: 'M5.5 19.2c1.3-3.3 3.6-4.8 6.5-4.8s5.2 1.5 6.5 4.8' }),
    ]
  }
  if (name === 'plus') return [createElement('path', { key: 'p', d: 'M12 5v14M5 12h14' })]
  if (name === 'more') return [createElement('path', { key: 'a', d: 'M4 7h16M4 12h16M4 17h16' })]
  if (name === 'bell') {
    return [
      createElement('path', { key: 'b', d: 'M6 9.2a6 6 0 0 1 12 0c0 4.2 1.6 5.6 1.6 5.6H4.4S6 13.4 6 9.2z' }),
      createElement('path', { key: 'c', d: 'M10 18.2a2 2 0 0 0 4 0' }),
    ]
  }
  if (name === 'settings') {
    return [
      createElement('path', { key: 'g', d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }),
      createElement('circle', { key: 'c', cx: 12, cy: 12, r: 3 }),
    ]
  }
  if (name === 'logout') return [createElement('path', { key: 'l', d: 'M10 7V5.5A1.5 1.5 0 0 1 11.5 4h6A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 10 18.5V17M4 12h10M11 9l3 3-3 3' })]
  if (name === 'phone') return [createElement('path', { key: 'p', d: 'M8 4.5h2.2l1.1 2.6-1.5 1a12 12 0 0 0 5.1 5.1l1-1.5 2.6 1.1V15a2 2 0 0 1-2.2 2A13.5 13.5 0 0 1 6 6.7 2 2 0 0 1 8 4.5z' })]
  if (name === 'mail') return [createElement('path', { key: 'm', d: 'M4 7.5h16v10H4zM4 8l8 6 8-6' })]
  if (name === 'pin') return [createElement('path', { key: 'n', d: 'M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z' }), createElement('circle', { key: 'c', cx: 12, cy: 11, r: 2 })]
  if (name === 'briefcase') return [createElement('path', { key: 'b', d: 'M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7M4.5 7h15v11h-15zM4.5 12h15' })]
  if (name === 'building') return [createElement('path', { key: 'b', d: 'M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20M15 10h3.2A1.3 1.3 0 0 1 19.5 11.3V20M3.5 20h17M8 8h2M8 12h2M8 16h2' })]
  if (name === 'gift') return [createElement('path', { key: 'g', d: 'M5 11h14v9H5zM4 8h16v3H4zM12 8v12M12 8c-1.5-2.5-4.5-2.2-4.5 0S12 8 12 8zM12 8c1.5-2.5 4.5-2.2 4.5 0S12 8 12 8z' })]
  if (name === 'interactions') return [createElement('path', { key: 'i', d: 'M5 6.5h14v8.5H8.2L5 18.2z' })]
  if (name === 'task') return [createElement('path', { key: 't', d: 'M8 6.5h8M8 4.8h8A1.5 1.5 0 0 1 17.5 6.3V19L12 16.2 6.5 19V6.3A1.5 1.5 0 0 1 8 4.8zM9 10.5l2 2 4-4' })]
  if (name === 'sun') {
    return [
      createElement('circle', { key: 'c', cx: 12, cy: 12, r: 3.5 }),
      createElement('path', { key: 'r', d: 'M12 3.2v2.1M12 18.7v2.1M3.2 12h2.1M18.7 12h2.1M5.8 5.8l1.5 1.5M16.7 16.7l1.5 1.5M18.2 5.8l-1.5 1.5M7.3 16.7l-1.5 1.5' }),
    ]
  }
  if (name === 'moon') return [createElement('path', { key: 'm', d: 'M16.8 14.6A6.6 6.6 0 0 1 9.4 4.2 7.2 7.2 0 1 0 19.8 14a6.6 6.6 0 0 1-3 0.6z' })]
  if (name === 'link') return [createElement('path', { key: 'l', d: 'M10 13.2a4.2 4.2 0 0 0 6 .4l1.8-1.8a4.2 4.2 0 0 0-6-6L10.4 7.2M14 10.8a4.2 4.2 0 0 0-6-.4l-1.8 1.8a4.2 4.2 0 0 0 6 6l1.4-1.4' })]
  if (name === 'search') return [createElement('circle', { key: 'c', cx: 11, cy: 11, r: 6 }), createElement('path', { key: 'h', d: 'M15.5 15.5 20 20' })]
  if (name === 'calendar') return [createElement('path', { key: 'c', d: 'M5 6.5h14v13H5zM5 10.5h14M8 4.5v3M16 4.5v3' })]
  if (name === 'undo') return [createElement('path', { key: 'u', d: 'M9 14 4 9l5-5' }), createElement('path', { key: 'p', d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H12' })]
  if (name === 'redo') return [createElement('path', { key: 'u', d: 'm15 14 5-5-5-5' }), createElement('path', { key: 'p', d: 'M20 9H9.5a5.5 5.5 0 0 0 0 11H12' })]
  if (name === 'reset') return [createElement('path', { key: 'r', d: 'M20 12a8 8 0 1 1-2.3-5.7L20 8' }), createElement('path', { key: 'a', d: 'M20 3.5V8h-4.5' })]
  if (name === 'eye') return [createElement('path', { key: 'e', d: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z' }), createElement('circle', { key: 'c', cx: 12, cy: 12, r: 2.6 })]
  return [0, 1, 2].map((dot) => createElement('circle', { key: dot, cx: 6 + dot * 6, cy: 12, r: 1.3, fill: color, stroke: 'none' }))
}
