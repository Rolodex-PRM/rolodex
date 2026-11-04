import { useEffect } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import { cleanCss } from './css-allow'

export type Appearance = { css: string; userCss: boolean }

export function userCssKey(userId: string) {
  return `rolodex.userCss.${userId}`
}

export function installCustomCss(server: string, personal: string) {
  if (typeof document === 'undefined') return
  let node = document.getElementById('rolodex-custom') as HTMLStyleElement | null
  if (!node) {
    node = document.createElement('style')
    node.id = 'rolodex-custom'
    document.head.appendChild(node)
  }
  node.textContent = `${cleanCss(server)}\n${cleanCss(personal)}`
  document.head.appendChild(node)
}

export function CustomCss() {
  const { session } = useAuth()
  useEffect(() => {
    let cancel = false
    api<Appearance>('/api/appearance')
      .then((appearance) => {
        if (cancel) return
        const personal = appearance.userCss && session && typeof localStorage !== 'undefined' ? localStorage.getItem(userCssKey(session.id)) || '' : ''
        installCustomCss(appearance.css, personal)
      })
      .catch(() => installCustomCss('', ''))
    return () => {
      cancel = true
    }
  }, [session])
  return null
}
