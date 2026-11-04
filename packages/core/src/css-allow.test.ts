import { describe, expect, it } from 'vitest'
import { cleanCss } from './css-allow'

describe('cleanCss', () => {
  it('keeps appearance rules and custom properties', () => {
    const css = cleanCss('html { --rx-bg: #101010; color: #fff; } button { border-radius: 4px; }')
    expect(css).toContain('--rx-bg: #101010')
    expect(css).toContain('border-radius: 4px')
  })

  it('drops scripts, remote urls, and unknown properties', () => {
    const css = cleanCss('body { background: url(https://evil.test/x); } html { color: red; } </style><script>alert(1)</script> div { position: fixed; }')
    expect(css).not.toContain('url')
    expect(css).not.toContain('script')
    expect(css).not.toContain('position')
    expect(css).toContain('color: red')
  })
})
