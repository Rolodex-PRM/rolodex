import { describe, expect, it } from 'vitest'
import { parseVcards, serializeVcard, structuredName } from './vcard'

const sample = `BEGIN:VCARD\r
VERSION:3.0\r
UID:11111111-1111-4111-8111-111111111111\r
FN:Ada Lovelace\r
N:Lovelace;Ada;Augusta;Lady;\r
NICKNAME:Ada\r
ORG:Analytical Engines;Research\r
TITLE:Mathematician\r
TEL;TYPE=CELL:+1 (555) 010-1000\r
EMAIL;TYPE=WORK:ada@example.com\r
item1.ADR:;;12 St James's Square;London;;SW1;UK\r
item1.X-ABLabel:Club\r
NOTE:Enjoys mathematics\r
X-CUSTOM:Keep me\r
BDAY:1815-12-10\r
END:VCARD\r
`

describe('vCard', () => {
  it('parses identity, methods, addresses, and unknown properties', () => {
    const [card] = parseVcards(sample)
    expect(card?.fn).toBe('Ada Lovelace')
    expect(card?.n).toMatchObject({ last: 'Lovelace', first: 'Ada', prefix: 'Lady' })
    expect(card?.organization).toBe('Analytical Engines')
    expect(card?.department).toBe('Research')
    expect(card?.emails).toEqual([{ label: 'work', value: 'ada@example.com' }])
    expect(card?.phones[0]?.label).toBe('mobile')
    expect(card?.addresses[0]).toMatchObject({ label: 'Club', city: 'London', street: "12 St James's Square" })
    expect(card?.birthday).toBe('1815-12-10')
    expect(card?.unknown).toEqual(['X-CUSTOM:Keep me'])
  })

  it('preserves unknown properties across a rebuild', () => {
    const [card] = parseVcards(sample)
    expect(card).toBeTruthy()
    if (!card) return
    card.fn = 'Ada King'
    const again = parseVcards(serializeVcard(card))[0]
    expect(again?.fn).toBe('Ada King')
    expect(again?.unknown).toContain('X-CUSTOM:Keep me')
    expect(again?.emails[0]?.value).toBe('ada@example.com')
  })

  it('unfolds long lines and splits multiple cards', () => {
    const input = 'BEGIN:VCARD\nVERSION:3.0\nFN:First\nNOTE:Hello \n there\nEND:VCARD\nBEGIN:VCARD\nVERSION:3.0\nFN:Second\nEND:VCARD\n'
    const cards = parseVcards(input)
    expect(cards).toHaveLength(2)
    expect(cards[0]?.note).toBe('Hello there')
    expect(cards[1]?.fn).toBe('Second')
  })

  it('uses the formatted name when a card has no structured name', () => {
    const [card] = parseVcards('BEGIN:VCARD\nVERSION:3.0\nFN:Katherine Johnson\nEMAIL:katherine@example.com\nEND:VCARD\n')
    expect(card).toBeTruthy()
    expect(structuredName(card!)).toMatchObject({ first: 'Katherine', last: 'Johnson' })
    const [named] = parseVcards(sample)
    expect(structuredName(named!).first).toBe('Ada')
  })

  it('keeps a social profile on the card', () => {
    const [card] = parseVcards('BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nX-SOCIALPROFILE;TYPE=linkedin:https://www.linkedin.com/in/ada\nEND:VCARD\n')
    expect(card?.socials).toEqual([{ label: 'linkedin', value: 'https://www.linkedin.com/in/ada' }])
    const again = parseVcards(serializeVcard(card!))[0]
    expect(again?.socials).toEqual([{ label: 'linkedin', value: 'https://www.linkedin.com/in/ada' }])
  })

  it('escapes commas in structured names', () => {
    const [card] = parseVcards('BEGIN:VCARD\nVERSION:3.0\nN:Doe\\, Jr.;Sam;;;\nFN:Sam Doe\nEND:VCARD\n')
    expect(card?.n.last).toBe('Doe, Jr.')
    const roundTrip = parseVcards(serializeVcard(card!))[0]
    expect(roundTrip?.n.last).toBe('Doe, Jr.')
  })
})
