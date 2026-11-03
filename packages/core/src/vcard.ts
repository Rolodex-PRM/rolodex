export type VCardValue = {
  label: string
  value: string
}

export type VCardAddress = {
  label: string
  street: string
  street2: string
  city: string
  region: string
  postalCode: string
  country: string
}

export type VCardName = {
  last: string
  first: string
  middle: string
  prefix: string
  suffix: string
}

export type ParsedCard = {
  uid?: string
  fn?: string
  n: VCardName
  nickname?: string
  organization?: string
  department?: string
  title?: string
  position?: string
  note?: string
  url?: string
  birthday?: string
  anniversary?: string
  emails: VCardValue[]
  phones: VCardValue[]
  socials: VCardValue[]
  addresses: VCardAddress[]
  unknown: string[]
}

const KNOWN = new Set([
  'BEGIN',
  'END',
  'VERSION',
  'PRODID',
  'UID',
  'FN',
  'N',
  'NICKNAME',
  'ORG',
  'TITLE',
  'ROLE',
  'NOTE',
  'URL',
  'BDAY',
  'ANNIVERSARY',
  'X-ANNIVERSARY',
  'TEL',
  'EMAIL',
  'ADR',
  'X-SOCIALPROFILE',
  'REV',
])

const PHONE_TYPES: Record<string, string> = {
  mobile: 'CELL',
  cell: 'CELL',
  home: 'HOME',
  personal: 'HOME',
  work: 'WORK',
  professional: 'WORK',
  fax: 'FAX',
  pager: 'PAGER',
  main: 'MAIN',
  iphone: 'IPHONE',
  other: 'OTHER',
}

const EMAIL_TYPES: Record<string, string> = {
  home: 'HOME',
  personal: 'HOME',
  work: 'WORK',
  professional: 'WORK',
  other: 'OTHER',
}

const ADDRESS_TYPES: Record<string, string> = {
  home: 'HOME',
  work: 'WORK',
  mailing: 'POSTAL',
  billing: 'BILLING',
  other: 'OTHER',
}

type Param = { name: string; value: string }
type LogicalLine = { group?: string; prop: string; params: Param[]; value: string; raw: string }

export function emptyCard(): ParsedCard {
  return {
    n: { last: '', first: '', middle: '', prefix: '', suffix: '' },
    emails: [],
    phones: [],
    socials: [],
    addresses: [],
    unknown: [],
  }
}

export function parseVcards(input: string): ParsedCard[] {
  const unfolded = unfold(input)
  const cards: string[][] = []
  let current: string[] | null = null
  for (const line of unfolded) {
    if (/^BEGIN:VCARD/i.test(line)) {
      current = [line]
      continue
    }
    if (!current) continue
    current.push(line)
    if (/^END:VCARD/i.test(line)) {
      cards.push(current)
      current = null
    }
  }
  return cards.map(parseCard)
}

export function serializeVcard(card: ParsedCard): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Rolodex//CardDAV//EN']
  if (card.uid) lines.push(`UID:${escapeText(card.uid)}`)
  lines.push(`FN:${escapeText(card.fn?.trim() || displayFallback(card))}`)
  lines.push(
    `N:${[card.n.last, card.n.first, card.n.middle, card.n.prefix, card.n.suffix].map(escapeText).join(';')}`,
  )
  if (card.nickname) lines.push(`NICKNAME:${escapeText(card.nickname)}`)
  if (card.organization || card.department) {
    lines.push(`ORG:${escapeText(card.organization ?? '')};${escapeText(card.department ?? '')}`)
  }
  if (card.title) lines.push(`TITLE:${escapeText(card.title)}`)
  if (card.position) lines.push(`ROLE:${escapeText(card.position)}`)
  if (card.note) lines.push(`NOTE:${escapeText(card.note)}`)
  if (card.url) lines.push(`URL:${escapeText(card.url)}`)
  if (card.birthday) lines.push(`BDAY:${card.birthday}`)
  if (card.anniversary) lines.push(`X-ANNIVERSARY:${card.anniversary}`)

  let item = 1
  const pushMethod = (prop: 'TEL' | 'EMAIL', entry: VCardValue, types: Record<string, string>) => {
    const type = types[entry.label.trim().toLowerCase()]
    if (type) {
      lines.push(`${prop};TYPE=${type}:${escapeText(entry.value)}`)
      return
    }
    const group = `item${item++}`
    lines.push(`${group}.${prop}:${escapeText(entry.value)}`)
    lines.push(`${group}.X-ABLabel:${escapeText(entry.label.trim() || 'Other')}`)
  }
  for (const email of card.emails) pushMethod('EMAIL', email, EMAIL_TYPES)
  for (const phone of card.phones) pushMethod('TEL', phone, PHONE_TYPES)
  for (const social of card.socials) {
    const type = social.label.trim().toLowerCase()
    const value = escapeText(social.value.trim())
    if (/^[a-z0-9-]+$/.test(type)) {
      lines.push(`X-SOCIALPROFILE;TYPE=${type}:${value}`)
    } else {
      const group = `item${item++}`
      lines.push(`${group}.X-SOCIALPROFILE:${value}`)
      lines.push(`${group}.X-ABLabel:${escapeText(social.label.trim() || 'Other')}`)
    }
  }
  for (const address of card.addresses) {
    const type = ADDRESS_TYPES[address.label.trim().toLowerCase()]
    const value = ['', address.street2, address.street, address.city, address.region, address.postalCode, address.country]
      .map(escapeText)
      .join(';')
    if (type) {
      lines.push(`ADR;TYPE=${type}:${value}`)
    } else {
      const group = `item${item++}`
      lines.push(`${group}.ADR:${value}`)
      lines.push(`${group}.X-ABLabel:${escapeText(address.label.trim() || 'Other')}`)
    }
  }
  for (const unknown of card.unknown) lines.push(unknown)
  lines.push('END:VCARD')
  return `${lines.map(fold).join('\r\n')}\r\n`
}

export function cardDisplayName(card: ParsedCard) {
  return card.fn?.trim() || displayFallback(card)
}

export function structuredName(card: ParsedCard) {
  const named = [card.n.prefix, card.n.first, card.n.middle, card.n.last, card.n.suffix].some((part) => part.trim())
  if (named || !card.fn?.trim()) return card.n
  const fn = card.fn.trim()
  const split = fn.lastIndexOf(' ')
  if (split < 0) return { ...card.n, first: fn }
  return { ...card.n, first: fn.slice(0, split), last: fn.slice(split + 1) }
}

function displayFallback(card: ParsedCard) {
  const parts = [card.n.prefix, card.n.first, card.n.middle, card.n.last, card.n.suffix].filter((part) => part.trim())
  if (parts.length) return parts.join(' ')
  if (card.organization?.trim()) return card.organization.trim()
  return 'Unnamed'
}

function parseCard(lines: string[]): ParsedCard {
  const card = emptyCard()
  const logical: LogicalLine[] = []
  for (const raw of lines) {
    const colon = indexOfUnescaped(raw, ':')
    if (colon < 0) continue
    const parsed = parseName(raw.slice(0, colon))
    let value = raw.slice(colon + 1)
    if (parsed.params.some((param) => param.name === 'ENCODING' && param.value.toUpperCase() === 'QUOTED-PRINTABLE')) {
      value = decodeQuotedPrintable(value)
    }
    logical.push({ ...parsed, value, raw })
  }

  const groups = new Map<string, { label?: string; lines: LogicalLine[] }>()
  for (const line of logical) {
    if (!line.group) continue
    const bucket = groups.get(line.group) ?? { lines: [] }
    if (line.prop === 'X-ABLABEL') bucket.label = unescapeText(line.value).trim()
    else bucket.lines.push(line)
    groups.set(line.group, bucket)
  }

  const consumed = new Set<LogicalLine>()
  for (const bucket of groups.values()) {
    for (const line of bucket.lines) {
      if (line.prop === 'TEL' || line.prop === 'EMAIL' || line.prop === 'ADR' || line.prop === 'X-SOCIALPROFILE') {
        applyContactLine(card, line, bucket.label)
        consumed.add(line)
      }
    }
  }

  for (const line of logical) {
    if (line.group) {
      if (!consumed.has(line) && line.prop !== 'X-ABLABEL') card.unknown.push(line.raw)
      continue
    }
    if (!KNOWN.has(line.prop)) {
      card.unknown.push(line.raw)
      continue
    }
    applyKnown(card, line)
  }
  return card
}

function applyKnown(card: ParsedCard, line: LogicalLine) {
  const value = unescapeText(line.value)
  switch (line.prop) {
    case 'UID':
      card.uid = value.trim()
      return
    case 'FN':
      card.fn = value.trim()
      return
    case 'N': {
      const [last = '', first = '', middle = '', prefix = '', suffix = ''] = splitUnescaped(line.value, ';').map(unescapeText)
      card.n = { last, first, middle, prefix, suffix }
      return
    }
    case 'NICKNAME':
      card.nickname = value.trim()
      return
    case 'ORG': {
      const [organization = '', department = ''] = splitUnescaped(line.value, ';').map(unescapeText)
      card.organization = organization.trim()
      card.department = department.trim()
      return
    }
    case 'TITLE':
      card.title = value.trim()
      return
    case 'ROLE':
      card.position = value.trim()
      return
    case 'NOTE':
      card.note = value
      return
    case 'URL':
      card.url = value.trim()
      return
    case 'BDAY':
      card.birthday = parseDate(value)
      return
    case 'ANNIVERSARY':
    case 'X-ANNIVERSARY':
      card.anniversary = parseDate(value)
      return
    case 'TEL':
      applyContactLine(card, line)
      return
    case 'EMAIL':
      applyContactLine(card, line)
      return
    case 'ADR':
      applyContactLine(card, line)
      return
    case 'X-SOCIALPROFILE':
      applyContactLine(card, line)
      return
    default:
      return
  }
}

function applyContactLine(card: ParsedCard, line: LogicalLine, groupLabel?: string) {
  if (line.prop === 'TEL') {
    card.phones.push({ label: phoneLabel(typesOf(line.params), groupLabel), value: unescapeText(line.value).trim() })
  } else if (line.prop === 'EMAIL') {
    card.emails.push({ label: emailLabel(typesOf(line.params), groupLabel), value: unescapeText(line.value).trim() })
  } else if (line.prop === 'ADR') {
    const [po = '', extended = '', street = '', city = '', region = '', postal = '', country = ''] = splitUnescaped(
      line.value,
      ';',
    ).map(unescapeText)
    card.addresses.push({
      label: addressLabel(typesOf(line.params), groupLabel),
      street: street.trim(),
      street2: [po, extended].filter((part) => part.trim()).join(' ').trim(),
      city: city.trim(),
      region: region.trim(),
      postalCode: postal.trim(),
      country: country.trim(),
    })
  } else if (line.prop === 'X-SOCIALPROFILE') {
    const types = typesOf(line.params)
    const value = unescapeText(line.value).trim().replace(/^x-apple:/i, '')
    if (value) card.socials.push({ label: groupLabel || types[0] || 'other', value })
  }
}

function phoneLabel(types: string[], groupLabel?: string) {
  if (groupLabel) return groupLabel
  for (const type of types) {
    if (type === 'cell' || type === 'mobile') return 'mobile'
    if (['home', 'work', 'fax', 'pager', 'main', 'iphone', 'other'].includes(type)) return type
  }
  return 'other'
}

function emailLabel(types: string[], groupLabel?: string) {
  if (groupLabel) return groupLabel
  if (types.includes('work')) return 'work'
  if (types.includes('home')) return 'home'
  return 'other'
}

function addressLabel(types: string[], groupLabel?: string) {
  if (groupLabel) return groupLabel
  if (types.includes('work')) return 'work'
  if (types.includes('billing')) return 'billing'
  if (types.includes('postal') || types.includes('mailing')) return 'mailing'
  return 'home'
}

function typesOf(params: Param[]) {
  const types: string[] = []
  for (const param of params) {
    if (param.name !== 'TYPE') continue
    for (const piece of param.value.split(',')) {
      const type = piece.trim().toLowerCase()
      if (type && type !== 'voice' && type !== 'internet' && type !== 'pref') types.push(type)
    }
  }
  return types
}

function parseName(left: string) {
  const bits = splitUnescaped(left, ';')
  const head = bits[0] ?? ''
  const dot = head.indexOf('.')
  const group = dot >= 0 ? head.slice(0, dot) : undefined
  const prop = (dot >= 0 ? head.slice(dot + 1) : head).toUpperCase()
  const params: Param[] = []
  for (const bit of bits.slice(1)) {
    const eq = bit.indexOf('=')
    if (eq < 0) params.push({ name: bit.toUpperCase(), value: bit })
    else params.push({ name: bit.slice(0, eq).toUpperCase(), value: bit.slice(eq + 1).replace(/^"|"$/g, '') })
  }
  return { group, prop, params }
}

function unfold(input: string) {
  const physical = input.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  const logical: string[] = []
  for (const line of physical) {
    if (!line) continue
    if ((line.startsWith(' ') || line.startsWith('\t')) && logical.length) {
      logical[logical.length - 1] += line.slice(1)
    } else {
      logical.push(line)
    }
  }
  return logical
}

function fold(line: string) {
  if (line.length <= 75) return line
  let output = line.slice(0, 75)
  for (let index = 75; index < line.length; index += 73) {
    output += `\r\n ${line.slice(index, index + 73)}`
  }
  return output
}

function indexOfUnescaped(value: string, separator: string) {
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '\\') {
      index += 1
      continue
    }
    if (value[index] === separator) return index
  }
  return -1
}

function splitUnescaped(value: string, separator: string) {
  const parts: string[] = []
  let current = ''
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '\\' && index + 1 < value.length) {
      current += value[index]! + value[index + 1]!
      index += 1
      continue
    }
    if (value[index] === separator) {
      parts.push(current)
      current = ''
      continue
    }
    current += value[index]
  }
  parts.push(current)
  return parts
}

export function unescapeText(value: string) {
  let output = ''
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '\\' && index + 1 < value.length) {
      const next = value[index + 1]
      if (next === 'n' || next === 'N') output += '\n'
      else if (next === ',') output += ','
      else if (next === ';') output += ';'
      else output += next
      index += 1
    } else {
      output += value[index]
    }
  }
  return output
}

export function escapeText(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;')
}

function parseDate(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 8) return undefined
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function decodeQuotedPrintable(value: string) {
  const bytes: number[] = []
  const collapsed = value.replace(/=\r?\n/g, '')
  for (let index = 0; index < collapsed.length; index++) {
    if (collapsed[index] === '=' && /[0-9A-Fa-f]{2}/.test(collapsed.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(collapsed.slice(index + 1, index + 3), 16))
      index += 2
    } else {
      bytes.push(collapsed.charCodeAt(index))
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes))
}
