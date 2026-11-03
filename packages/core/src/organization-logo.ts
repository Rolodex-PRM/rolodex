export function organizationLogoUrl(website: string | null | undefined): string | null {
  const domain = websiteDomain(website)
  return domain ? `https://logos.hunter.io/${domain}` : null
}

export function websiteDomain(website: string | null | undefined): string | null {
  const raw = website?.trim()
  if (!raw) return null
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const host = new URL(withProtocol).hostname.replace(/\.$/, '').replace(/^www\./i, '').toLowerCase()
    if (!host || host.includes('/') || !host.includes('.')) return null
    return host
  } catch {
    return null
  }
}
