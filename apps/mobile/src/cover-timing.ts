const storageKey = 'rolodex.coverSeconds'

export const defaultCoverSeconds = 60

export function readCoverSeconds() {
  if (typeof localStorage === 'undefined') return defaultCoverSeconds
  const raw = localStorage.getItem(storageKey)
  if (raw == null || raw.trim() === '') return defaultCoverSeconds
  const value = Number(raw)
  if (!Number.isFinite(value)) return defaultCoverSeconds
  return clampCoverSeconds(value)
}

export function writeCoverSeconds(seconds: number) {
  const next = clampCoverSeconds(seconds)
  localStorage.setItem(storageKey, String(next))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('rolodex-cover-seconds'))
  return next
}

export function clampCoverSeconds(seconds: number) {
  return Math.min(600, Math.max(1, Math.round(seconds)))
}
