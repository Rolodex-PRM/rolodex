export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>()
  return (key: string) => {
    const now = Date.now()
    const current = hits.get(key)
    if (!current || current.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs })
      return true
    }
    current.count += 1
    if (hits.size > 10_000) {
      for (const [entry, value] of hits) {
        if (value.reset < now) hits.delete(entry)
      }
    }
    return current.count <= max
  }
}
