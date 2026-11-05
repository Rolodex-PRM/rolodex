import { describe, expect, it } from 'vitest'
import { enrichmentPrompt, enrichmentQuery, parseSearchResultLinks } from './ai'

describe('enrichment search', () => {
  it('searches the saved name together with the title and company', () => {
    expect(enrichmentQuery({ name: 'Ada Lovelace', title: 'Engineer', organization: 'Analytical Engines' })).toBe('"Ada Lovelace" "Engineer" "Analytical Engines"')
    expect(enrichmentQuery({ name: 'Ada Lovelace', title: null, organization: '' })).toBe('"Ada Lovelace"')
  })

  it('asks the model to stay with that person at that company', () => {
    const prompt = enrichmentPrompt({
      name: 'Ada Lovelace',
      title: 'Engineer',
      organization: 'Analytical Engines',
      known: 'Ada Lovelace',
      pages: [{ url: 'https://example.com/ada', text: 'Ada Lovelace is an engineer at Analytical Engines.' }],
    })
    expect(prompt).toContain('Job title: Engineer')
    expect(prompt).toContain('Company: Analytical Engines')
    expect(prompt).toContain('at that company with that title')
    expect(prompt).toContain('https://example.com/ada')
  })

  it('reads public result links out of a search page', () => {
    const html = '<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fada&rut=1">Ada</a><a href="https://google.com/search?q=ada">skip</a>'
    expect(parseSearchResultLinks(html)).toEqual(['https://example.com/ada'])
  })
})
