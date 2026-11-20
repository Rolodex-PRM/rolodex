import parsePhoneNumberFromString, {
  formatIncompletePhoneNumber,
  type CountryCode,
} from 'libphonenumber-js/min'

function regionFromTag(tag: string): CountryCode | undefined {
  try {
    const locale = new Intl.Locale(tag)
    if (locale.region && /^[A-Z]{2}$/.test(locale.region)) return locale.region as CountryCode
    if (typeof locale.maximize === 'function') {
      const region = locale.maximize().region
      if (region && /^[A-Z]{2}$/.test(region)) return region as CountryCode
    }
  } catch {
    /* ignore */
  }
  const match = /^[a-zA-Z]{2,3}[-_]([A-Za-z]{2})\b/.exec(tag)
  if (match?.[1]) return match[1].toUpperCase() as CountryCode
  return undefined
}

function localeCountry(): CountryCode | undefined {
  const tags: string[] = []
  if (typeof navigator !== 'undefined') {
    if (navigator.language) tags.push(navigator.language)
    if (Array.isArray(navigator.languages)) tags.push(...navigator.languages)
  }
  try {
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale)
  } catch {
    /* ignore */
  }
  for (const tag of tags) {
    const region = regionFromTag(tag)
    if (region) return region
  }
  return undefined
}

function fallbackFormat(value: string) {
  const digits = value.replace(/\D/g, '')
  if (value.trim().startsWith('+') && digits.length >= 8) return `+${digits}`
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length === 10) {
    const local = `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
    return digits.length === 11 ? `+1 ${local}` : local
  }
  return value
}

/** Display formatting only. Keeps the original string when the number cannot be parsed. */
export function formatPhone(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return trimmed

  try {
    const international = /^\+|00/.test(trimmed)
    const country = localeCountry()
    const parsed =
      parsePhoneNumberFromString(trimmed) ??
      (international || !country ? undefined : parsePhoneNumberFromString(trimmed, country))
    if (parsed && (parsed.isValid() || parsed.isPossible())) {
      return international ? parsed.formatInternational() : parsed.formatNational()
    }
    if (!international && country) {
      const incomplete = formatIncompletePhoneNumber(trimmed, country)
      if (incomplete && incomplete !== trimmed) return incomplete
    }
  } catch {
    /* fall through */
  }

  return fallbackFormat(trimmed)
}
