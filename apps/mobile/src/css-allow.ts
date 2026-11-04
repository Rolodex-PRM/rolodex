const properties = new Set([
  'accent-color',
  'background',
  'background-color',
  'border',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-style',
  'border-bottom-width',
  'border-color',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-style',
  'border-top-width',
  'border-width',
  'box-shadow',
  'color',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'opacity',
  'outline',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'text-align',
  'text-decoration',
  'text-transform',
])

const unsafe = /url\s*\(|expression\s*\(|javascript:|@import|<\/|\\|behavior\s*:|-moz-binding/i

export function cleanCss(value: string) {
  const source = value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<\/style/gi, '').slice(0, 20000)
  const rules: string[] = []
  for (const part of source.split('}')) {
    const splitAt = part.indexOf('{')
    if (splitAt < 0) continue
    const selector = part.slice(0, splitAt).trim()
    const body = part.slice(splitAt + 1)
    if (!selector || selector.length > 300 || unsafe.test(selector)) continue
    if (!/^[\w\s.#:>,\-[\]="'*+~|()]+$/.test(selector)) continue
    const declarations: string[] = []
    for (const raw of body.split(';')) {
      const line = raw.trim()
      if (!line) continue
      const colon = line.indexOf(':')
      if (colon <= 0) continue
      const property = line.slice(0, colon).trim().toLowerCase()
      const declared = line.slice(colon + 1).trim()
      if (!declared || declared.length > 400 || unsafe.test(declared)) continue
      const custom = /^--[a-z0-9-]+$/.test(property)
      if (!custom && !properties.has(property)) continue
      declarations.push(`${property}: ${declared}`)
    }
    if (declarations.length) rules.push(`${selector} { ${declarations.join('; ')}; }`)
  }
  return rules.join('\n').slice(0, 20000)
}
