export type DavRequest = {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: string
  ip?: string
}

export type DavResult = {
  status: number
  headers: Record<string, string>
  body: string
}

export function requestOrigin(headers: DavRequest['headers']) {
  const hostHeader = headers.host ?? headers.Host
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)?.trim()
  if (!host) return ''
  const forwardedHeader = headers['x-forwarded-proto'] ?? headers['X-Forwarded-Proto']
  const forwarded = (Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader)?.split(',')[0]?.trim()
  const proto = forwarded === 'https' ? 'https' : 'http'
  return `${proto}://${host}`
}

export function absoluteHref(origin: string, path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return origin ? `${origin}${normalized}` : normalized
}
