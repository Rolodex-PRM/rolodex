import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { composePluginDocument, discoverPlugins } from './plugins'

describe('plugins', () => {
  it('discovers a folder with a manifest and ignores a path that leaves the folder', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rolodex-plugins-'))
    const good = path.join(root, 'scratch-pad')
    mkdirSync(good)
    writeFileSync(path.join(good, 'index.html'), '<p>Hello</p>')
    writeFileSync(path.join(good, 'rolodex-plugin.json'), JSON.stringify({
      id: 'scratch-pad',
      name: 'Scratch pad',
      version: '1.0.0',
      description: 'A note.',
      entry: 'index.html',
    }))
    const bad = path.join(root, 'escape')
    mkdirSync(bad)
    writeFileSync(path.join(bad, 'rolodex-plugin.json'), JSON.stringify({
      id: 'escape',
      name: 'Escape',
      version: '1.0.0',
      description: 'No.',
      entry: '../secret.html',
    }))
    const found = discoverPlugins([root])
    expect(found.map((plugin) => plugin.id)).toEqual(['scratch-pad'])
  })

  it('wraps the page so it cannot call the network and can talk to Rolodex', () => {
    const html = composePluginDocument('<p>Hello</p>')
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain('window.rolodex')
    expect(html).toContain('rolodex:ready')
  })
})
