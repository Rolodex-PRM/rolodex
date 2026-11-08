import { AppError } from './errors'
import { normalizeEmail, normalizePhone } from './normalize'
import { emptyCard, parseVcards, type ParsedCard, type VCardAddress, type VCardValue } from './vcard'

export const ROLODEX_CONTACT_HEADER = [
  'First name',
  'Middle name',
  'Last name',
  'Prefix',
  'Suffix',
  'Nickname',
  'Organization',
  'Department',
  'Job title',
  'Website',
  'Birthday',
  'Anniversary',
  'Notes',
  'Email',
  'Email label',
  'Email 2',
  'Email 2 label',
  'Email 3',
  'Email 3 label',
  'Phone',
  'Phone label',
  'Phone 2',
  'Phone 2 label',
  'Phone 3',
  'Phone 3 label',
  'Street',
  'Street 2',
  'City',
  'State',
  'Postal code',
  'Country',
  'Address label',
  'Tags',
] as const

const EXAMPLE = [
  'Ada',
  'Augusta',
  'Lovelace',
  'Lady',
  '',
  'Ada',
  'Analytical Engines',
  'Research',
  'Mathematician',
  'https://example.com',
  '1815-12-10',
  '',
  'Replace this row with your contacts.',
  'ada@example.com',
  'work',
  '',
  '',
  '',
  '',
  '+1 555 0100',
  'mobile',
  '',
  '',
  '',
  '',
  '12 King Street',
  '',
  'London',
  '',
  'SW1A 1AA',
  'United Kingdom',
  'work',
  'friends',
]

const OUTLOOK_HINTS = new Set([
  'e mail address',
  'e mail 2 address',
  'mobile phone',
  'primary phone',
  'home street',
  'home address',
  'business phone',
  'company main phone',
  'categories',
])

export function rolodexContactTemplate() {
  return `${csvRow([...ROLODEX_CONTACT_HEADER])}\r\n${csvRow(EXAMPLE)}\r\n`
}

export function parseContactSource(text: string): ParsedCard[] {
  const source = text.replace(/^\uFEFF/, '')
  if (!source.trim()) throw new AppError(400, 'Choose a contact file')
  if (/^\s*BEGIN:VCARD/i.test(source)) {
    const cards = parseVcards(source).filter(hasContent)
    if (!cards.length) throw new AppError(400, 'No contacts were found in that file')
    return cards
  }
  return parseContactCsv(source)
}

function parseContactCsv(text: string): ParsedCard[] {
  const rows = parseCsv(text)
  const headers = rows[0]
  if (!headers?.length) throw new AppError(400, 'The spreadsheet needs a header row')
  const keys = headers.map(normalizeHeader)
  const known = keys.some((key) => key && (COLUMN_KEYS.has(key) || OUTLOOK_HINTS.has(key)))
  if (!known) throw new AppError(400, 'This spreadsheet is missing contact columns. Download the Rolodex template to see them.')
  const outlook = keys.some((key) => OUTLOOK_HINTS.has(key))
  const titleIsPrefix = outlook || keys.includes('job title')
  const cards: ParsedCard[] = []
  for (const cells of rows.slice(1)) {
    const record = new Map<string, string>()
    keys.forEach((key, index) => {
      const value = clean(cells[index] ?? '')
      if (key && value && !record.has(key)) record.set(key, value)
    })
    const card = cardFromRecord(record, titleIsPrefix)
    if (hasContent(card)) cards.push(card)
  }
  if (!cards.length) throw new AppError(400, 'No contacts were found in that file')
  return cards
}

const COLUMN_KEYS = new Set([
  'first name',
  'given name',
  'middle name',
  'last name',
  'family name',
  'surname',
  'prefix',
  'suffix',
  'nickname',
  'full name',
  'name',
  'display name',
  'organization',
  'company',
  'department',
  'job title',
  'position',
  'website',
  'web page',
  'url',
  'birthday',
  'anniversary',
  'notes',
  'note',
  'email',
  'email address',
  'e mail address',
  'email 2',
  'e mail 2 address',
  'email 3',
  'e mail 3 address',
  'email label',
  'email 2 label',
  'email 3 label',
  'phone',
  'phone number',
  'phone label',
  'phone 2',
  'phone 2 label',
  'phone 3',
  'phone 3 label',
  'mobile',
  'mobile phone',
  'cell',
  'cell phone',
  'primary phone',
  'home phone',
  'home phone 2',
  'business phone',
  'business phone 2',
  'company main phone',
  'other phone',
  'pager',
  'home fax',
  'business fax',
  'other fax',
  'assistants phone',
  'callback',
  'car phone',
  'isdn',
  'radio phone',
  'tty tdd phone',
  'telex',
  'street',
  'street 2',
  'city',
  'state',
  'region',
  'postal code',
  'zip',
  'country',
  'address label',
  'tags',
  'categories',
  'title',
  'home street',
  'home street 2',
  'home street 3',
  'home address po box',
  'home city',
  'home state',
  'home postal code',
  'home country',
  'home address',
  'business street',
  'business street 2',
  'business street 3',
  'business address po box',
  'business city',
  'business state',
  'business postal code',
  'business country',
  'business address',
  'other street',
  'other street 2',
  'other street 3',
  'other address po box',
  'other city',
  'other state',
  'other postal code',
  'other country',
  'other address',
  'spouse',
  'children',
  'managers name',
  'assistants name',
  'referred by',
])

function cardFromRecord(record: Map<string, string>, titleIsPrefix: boolean): ParsedCard {
  const card = emptyCard()
  const read = (...names: string[]) => {
    for (const name of names) {
      const value = record.get(name)
      if (value) return value
    }
    return ''
  }
  card.n = {
    first: clip(read('first name', 'given name'), 120),
    middle: clip(read('middle name'), 120),
    last: clip(read('last name', 'family name', 'surname'), 120),
    prefix: clip(read('prefix') || (titleIsPrefix ? read('title') : ''), 40),
    suffix: clip(read('suffix'), 40),
  }
  const full = read('full name', 'name', 'display name')
  if (!card.n.first && !card.n.middle && !card.n.last && full) card.fn = clip(full, 300)
  card.nickname = clip(read('nickname'), 120) || undefined
  card.organization = clip(read('organization', 'company'), 200) || undefined
  card.department = clip(read('department'), 120) || undefined
  card.title = clip(read('job title') || (titleIsPrefix ? '' : read('title')), 120) || undefined
  card.position = clip(read('position'), 120) || undefined
  card.url = clip(read('website', 'web page', 'url'), 500) || undefined
  const notes: string[] = []
  const written = read('notes', 'note')
  if (written) notes.push(written)
  const birthday = read('birthday')
  const anniversary = read('anniversary')
  card.birthday = isoDate(birthday)
  card.anniversary = isoDate(anniversary)
  if (birthday && !card.birthday) notes.push(`Birthday: ${birthday}`)
  if (anniversary && !card.anniversary) notes.push(`Anniversary: ${anniversary}`)
  for (const [key, label] of [
    ['spouse', 'Spouse'],
    ['children', 'Children'],
    ['managers name', "Manager's name"],
    ['assistants name', "Assistant's name"],
    ['referred by', 'Referred by'],
  ] as const) {
    const value = read(key)
    if (value) notes.push(`${label}: ${value}`)
  }
  if (notes.length) card.note = clip(notes.join('\n'), 8000)

  pushMethod(card.emails, read('email', 'email address', 'e mail address'), read('email label') || 'other')
  pushMethod(card.emails, read('email 2', 'e mail 2 address'), read('email 2 label') || 'other')
  pushMethod(card.emails, read('email 3', 'e mail 3 address'), read('email 3 label') || 'other')
  const seenEmails = new Set(card.emails.map((entry) => normalizeEmail(entry.value)))
  card.emails = card.emails.filter((entry) => {
    const key = normalizeEmail(entry.value)
    if (!key || seenEmails.has(`used:${key}`)) return false
    seenEmails.add(`used:${key}`)
    return true
  })

  pushPhone(card, read('mobile', 'mobile phone', 'cell', 'cell phone'), 'mobile')
  pushPhone(card, read('primary phone'), 'other')
  pushPhone(card, read('phone', 'phone number'), read('phone label') || 'mobile')
  pushPhone(card, read('phone 2'), read('phone 2 label') || 'other')
  pushPhone(card, read('phone 3'), read('phone 3 label') || 'other')
  pushPhone(card, read('home phone'), 'home')
  pushPhone(card, read('home phone 2'), 'home')
  pushPhone(card, read('business phone'), 'work')
  pushPhone(card, read('business phone 2'), 'work')
  pushPhone(card, read('company main phone'), 'work')
  pushPhone(card, read('other phone'), 'other')
  pushPhone(card, read('pager'), 'pager')
  pushPhone(card, read('home fax'), 'fax')
  pushPhone(card, read('business fax'), 'fax')
  pushPhone(card, read('other fax'), 'fax')
  pushPhone(card, read('assistants phone'), 'assistant')
  pushPhone(card, read('callback'), 'callback')
  pushPhone(card, read('car phone'), 'car')
  pushPhone(card, read('isdn'), 'isdn')
  pushPhone(card, read('radio phone'), 'radio')
  pushPhone(card, read('tty tdd phone'), 'tty')
  pushPhone(card, read('telex'), 'telex')

  pushAddress(card, read('address label') || 'home', {
    street: read('street'),
    street2: read('street 2'),
    city: read('city'),
    region: read('state', 'region'),
    postalCode: read('postal code', 'zip'),
    country: read('country'),
  })
  pushAddress(card, 'home', {
    street: read('home street') || read('home address'),
    street2: [read('home street 2'), read('home street 3'), read('home address po box')].filter(Boolean).join(', '),
    city: read('home city'),
    region: read('home state'),
    postalCode: read('home postal code'),
    country: read('home country'),
  })
  pushAddress(card, 'work', {
    street: read('business street') || read('business address'),
    street2: [read('business street 2'), read('business street 3'), read('business address po box')].filter(Boolean).join(', '),
    city: read('business city'),
    region: read('business state'),
    postalCode: read('business postal code'),
    country: read('business country'),
  })
  pushAddress(card, 'other', {
    street: read('other street') || read('other address'),
    street2: [read('other street 2'), read('other street 3'), read('other address po box')].filter(Boolean).join(', '),
    city: read('other city'),
    region: read('other state'),
    postalCode: read('other postal code'),
    country: read('other country'),
  })

  const tags = splitList(read('tags', 'categories'))
  if (tags.length) card.categories = tags
  return card
}

function pushMethod(list: VCardValue[], value: string, label: string) {
  const text = clip(value, 500)
  if (!text) return
  list.push({ label: clip(label, 40) || 'other', value: text })
}

function pushPhone(card: ParsedCard, value: string, label: string) {
  const text = clip(value, 500)
  const key = normalizePhone(text)
  if (!text || !key) return
  if (card.phones.some((entry) => normalizePhone(entry.value) === key)) return
  card.phones.push({ label: clip(label, 40) || 'other', value: text })
}

function pushAddress(card: ParsedCard, label: string, input: Omit<VCardAddress, 'label'>) {
  const address: VCardAddress = {
    label: clip(label, 40) || 'home',
    street: clip(flatten(input.street), 200),
    street2: clip(flatten(input.street2), 200),
    city: clip(input.city, 120),
    region: clip(input.region, 120),
    postalCode: clip(input.postalCode, 40),
    country: clip(input.country, 120),
  }
  if (![address.street, address.street2, address.city, address.region, address.postalCode, address.country].some(Boolean)) return
  if (card.addresses.some((item) => item.street === address.street && item.city === address.city && item.postalCode === address.postalCode && item.label === address.label)) return
  card.addresses.push(address)
}

function hasContent(card: ParsedCard) {
  return Boolean(
    card.fn?.trim() ||
      card.n.first.trim() ||
      card.n.middle.trim() ||
      card.n.last.trim() ||
      card.organization?.trim() ||
      card.emails.length ||
      card.phones.length,
  )
}

function splitList(value: string) {
  return value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 50)
}

function isoDate(value: string) {
  const text = value.trim()
  if (!text) return undefined
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (compact) return validDate(Number(compact[1]), Number(compact[2]), Number(compact[3]))
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text)
  if (!us) return undefined
  const yearText = us[3]
  if (!yearText) return undefined
  let year = Number(yearText)
  if (yearText.length <= 2) year += year >= 30 ? 1900 : 2000
  return validDate(year, Number(us[1]), Number(us[2]))
}

function validDate(year: number, month: number, day: number) {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function flatten(value: string) {
  return value.replace(/\s*\n\s*/g, ', ').replace(/\s{2,}/g, ' ').trim()
}

function clean(value: string) {
  return value.replace(/[\u00a0\u202f]/g, ' ').trim()
}

function clip(value: string, max: number) {
  return clean(value).slice(0, max)
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"'
          index += 1
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((entry) => entry.trim())) rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += char
  }
  if (cell.length || row.length) {
    row.push(cell)
    if (row.some((entry) => entry.trim())) rows.push(row)
  }
  return rows
}

function csvRow(cells: string[]) {
  return cells.map(csvCell).join(',')
}

function csvCell(value: string) {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}
