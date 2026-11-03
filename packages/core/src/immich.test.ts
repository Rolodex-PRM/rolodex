import { describe, expect, it } from 'vitest'
import { immichBaseUrl, immichNameScore, parseImmichAssets, parseImmichPeople } from './immich'

describe('Immich parsing', () => {
  it('reads a paged people response and an older array response', () => {
    expect(parseImmichPeople({ people: [{ id: 'p1', name: 'Ada Lovelace', thumbnailPath: 'a', isHidden: false }], hasNextPage: true })).toEqual({
      people: [{ id: 'p1', name: 'Ada Lovelace', thumbnailPath: 'a', isHidden: false }],
      hasNextPage: true,
    })
    expect(parseImmichPeople([{ id: 'p2', name: 'Grace' }]).people).toHaveLength(1)
  })

  it('reads both search result shapes', () => {
    expect(parseImmichAssets({ assets: { total: 4, items: [{ id: 'a1', type: 'VIDEO', fileCreatedAt: '2020-01-01' }] } })).toEqual({
      items: [{ id: 'a1', type: 'VIDEO', takenAt: '2020-01-01' }],
      total: 4,
    })
    expect(parseImmichAssets({ assets: [{ id: 'a2', type: 'IMAGE' }] }).total).toBe(1)
  })

  it('suggests a full name and skips a first name alone', () => {
    expect(immichNameScore('Ada Lovelace', ['Ada Lovelace'])).toBe(100)
    expect(immichNameScore('Lovelace Ada', ['Ada Lovelace'])).toBe(80)
    expect(immichNameScore('Ada', ['Ada Lovelace'])).toBe(0)
  })

  it('rejects a URL that tries to carry the API key', () => {
    expect(immichBaseUrl('https://photos.example.com/')).toBe('https://photos.example.com')
    expect(() => immichBaseUrl('https://key@photos.example.com')).toThrow(/API key/)
  })
})
