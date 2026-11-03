import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { applyScheme, readScheme, type Scheme } from './theme'

type ColorSchemeValue = { scheme: Scheme; toggleScheme: () => void }

const ColorSchemeContext = createContext<ColorSchemeValue>({ scheme: 'light', toggleScheme: () => {} })

export function ColorSchemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<Scheme>(readScheme)

  const value = useMemo<ColorSchemeValue>(
    () => ({
      scheme,
      toggleScheme() {
        setScheme((current) => {
          const next = current === 'dark' ? 'light' : 'dark'
          applyScheme(next)
          if (typeof localStorage !== 'undefined') localStorage.setItem('rolodex.scheme', next)
          return next
        })
      },
    }),
    [scheme],
  )

  return <ColorSchemeContext.Provider value={value}>{children}</ColorSchemeContext.Provider>
}

export function useColorScheme() {
  return useContext(ColorSchemeContext)
}
