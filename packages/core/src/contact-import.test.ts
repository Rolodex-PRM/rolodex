import { describe, expect, it } from 'vitest'
import { parseContactSource, rolodexContactTemplate } from './contact-import'

describe('contact import', () => {
  it('reads the Rolodex template', () => {
    const [card] = parseContactSource(rolodexContactTemplate())
    expect(card?.n).toMatchObject({ first: 'Ada', middle: 'Augusta', last: 'Lovelace', prefix: 'Lady' })
    expect(card?.organization).toBe('Analytical Engines')
    expect(card?.department).toBe('Research')
    expect(card?.title).toBe('Mathematician')
    expect(card?.birthday).toBe('1815-12-10')
    expect(card?.emails).toEqual([{ label: 'work', value: 'ada@example.com' }])
    expect(card?.phones[0]).toMatchObject({ label: 'mobile', value: '+1 555 0100' })
    expect(card?.addresses[0]).toMatchObject({ label: 'work', city: 'London', postalCode: 'SW1A 1AA' })
    expect(card?.categories).toEqual(['friends'])
  })

  it('reads an Outlook spreadsheet, including a quoted address', () => {
    const header = ['First Name', 'Middle Name', 'Last Name', 'Title', 'Suffix', 'Web Page', 'Birthday', 'Anniversary', 'Notes', 'E-mail Address', 'E-mail 2 Address', 'E-mail 3 Address', 'Primary Phone', 'Home Phone', 'Home Phone 2', 'Mobile Phone', 'Pager', 'Home Fax', 'Home Address', 'Home Street', 'Home Street 2', 'Home Street 3', 'Home Address PO Box', 'Home City', 'Home State', 'Home Postal Code', 'Home Country', 'Spouse', 'Children', 'Categories']
    const angela = blank(header.length)
    fill(angela, header, {
      'First Name': 'Angela',
      'Last Name': 'Kline',
      Title: 'Mrs.',
      Birthday: '10/15/1997',
      Notes: 'Hello, neighbor',
      'E-mail Address': 'imabrady@example.com',
      'E-mail 2 Address': 'angela@example.com',
      'Mobile Phone': '(281) 757-1494',
      'Home Address': '3506 Whispering Brook Dr\nKingwood, TX 77345\nUnited States',
      'Home Street': '3506 Whispering Brook Dr',
      'Home City': 'Kingwood',
      'Home State': 'TX',
      'Home Postal Code': '77345',
      'Home Country': 'United States',
      Categories: 'myContacts',
    })
    const andrew = blank(header.length)
    fill(andrew, header, { 'First Name': 'Andrew', 'Last Name': 'Bullard', Birthday: '11/8', 'Mobile Phone': '+1 469-288-5030', Categories: 'friends' })
    const csv = [header, angela, andrew].map((row) => row.map(csvCell).join(',')).join('\n')
    const cards = parseContactSource(csv)
    expect(cards).toHaveLength(2)
    expect(cards[0]?.n).toMatchObject({ first: 'Angela', last: 'Kline', prefix: 'Mrs.' })
    expect(cards[0]?.birthday).toBe('1997-10-15')
    expect(cards[0]?.emails.map((entry) => entry.value)).toEqual(['imabrady@example.com', 'angela@example.com'])
    expect(cards[0]?.phones[0]?.value).toBe('(281) 757-1494')
    expect(cards[0]?.addresses[0]).toMatchObject({ street: '3506 Whispering Brook Dr', city: 'Kingwood', region: 'TX', postalCode: '77345' })
    expect(cards[0]?.note).toContain('Hello, neighbor')
    expect(cards[0]?.categories).toEqual(['myContacts'])
    expect(cards[1]?.birthday).toBeUndefined()
    expect(cards[1]?.note).toBe('Birthday: 11/8')
    expect(cards[1]?.phones[0]?.label).toBe('mobile')
  })

  it('reads a vCard file', () => {
    const cards = parseContactSource('BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEMAIL:ada@example.com\nCATEGORIES:friends,myContacts\nEND:VCARD\n')
    expect(cards).toHaveLength(1)
    expect(cards[0]?.fn).toBe('Ada Lovelace')
    expect(cards[0]?.categories).toEqual(['friends', 'myContacts'])
  })

  it('rejects a spreadsheet without contact columns', () => {
    expect(() => parseContactSource('Color,Size\nRed,Large\n')).toThrow(/contact columns/)
  })
})

function blank(length: number) {
  return Array.from({ length }, () => '')
}

function fill(row: string[], header: string[], values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) row[header.indexOf(key)] = value
}

function csvCell(value: string) {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}
