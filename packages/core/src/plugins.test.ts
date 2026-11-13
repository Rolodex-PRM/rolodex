import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { clearRegistryCache, composePluginDocument, discoverPlugins, loadRegistry, parseRegistryIndex, readRegistry } from './plugins'

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
      settings: [
        { key: 'heading', label: 'Heading', type: 'text' },
        { key: 'bad', label: '', type: 'text' },
      ],
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
    expect(found[0]?.settings).toEqual([{ key: 'heading', label: 'Heading', type: 'text' }])
  })

  it('reads a registry entry and skips a path that leaves the repository', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rolodex-registry-'))
    writeFileSync(path.join(root, 'field-notes.json'), JSON.stringify({
      id: 'field-notes',
      name: 'Field notes',
      version: '1.0.0',
      description: 'Notes.',
      entry: 'index.html',
      repo: 'ada/field-notes',
      path: 'plugins/field-notes',
      rolodex: '>=0.1.0 <1.0.0',
    }))
    writeFileSync(path.join(root, 'escape.json'), JSON.stringify({
      id: 'escape',
      name: 'Escape',
      version: '1.0.0',
      description: 'No.',
      repo: 'ada/escape',
      path: '../secret',
    }))
    expect(readRegistry([root]).map((entry) => entry.id)).toEqual(['field-notes'])
  })

  it('parses a remote index.json catalog and prefers it over local dirs', async () => {
    clearRegistryCache()
    const previous = process.env.PLUGIN_REGISTRY_URL
    process.env.PLUGIN_REGISTRY_URL = 'https://example.test/index.json'
    const root = mkdtempSync(path.join(tmpdir(), 'rolodex-registry-local-'))
    writeFileSync(path.join(root, 'local-only.json'), JSON.stringify({
      id: 'local-only',
      name: 'Local',
      version: '1.0.0',
      description: 'Fallback.',
      entry: 'index.html',
      repo: 'ada/local-only',
      rolodex: '>=0.1.0 <1.0.0',
    }))
    try {
      const remote = await loadRegistry({
        dirs: [root],
        fetch: async () =>
          new Response(JSON.stringify({
            schemaVersion: 1,
            generatedAt: '2026-11-13T00:00:00.000Z',
            plugins: [{
              id: 'mailing-lists',
              name: 'Mailing Lists',
              version: '1.0.1',
              description: 'Lists.',
              entry: 'index.html',
              repo: 'Rolodex-PRM/Rolodex-Plugin-Mailing-List',
              release: 'v1.0.1',
              sha256: 'a'.repeat(64),
              rolodex: '>=0.1.0 <1.0.0',
            }],
          }), { status: 200 }),
      })
      expect(remote.map((entry) => entry.id)).toEqual(['mailing-lists'])
      expect(parseRegistryIndex({ plugins: remote }).map((entry) => entry.id)).toEqual(['mailing-lists'])
    } finally {
      if (previous == null) delete process.env.PLUGIN_REGISTRY_URL
      else process.env.PLUGIN_REGISTRY_URL = previous
      clearRegistryCache()
    }
  })

  it('falls back to local registry dirs when the remote catalog is empty', async () => {
    clearRegistryCache()
    const previous = process.env.PLUGIN_REGISTRY_URL
    process.env.PLUGIN_REGISTRY_URL = 'https://example.test/empty.json'
    const root = mkdtempSync(path.join(tmpdir(), 'rolodex-registry-fallback-'))
    writeFileSync(path.join(root, 'field-notes.json'), JSON.stringify({
      id: 'field-notes',
      name: 'Field notes',
      version: '1.0.0',
      description: 'Notes.',
      entry: 'index.html',
      repo: 'ada/field-notes',
      rolodex: '>=0.1.0 <1.0.0',
    }))
    try {
      const entries = await loadRegistry({
        dirs: [root],
        fetch: async () => new Response(JSON.stringify({ schemaVersion: 1, plugins: [] }), { status: 200 }),
      })
      expect(entries.map((entry) => entry.id)).toEqual(['field-notes'])
    } finally {
      if (previous == null) delete process.env.PLUGIN_REGISTRY_URL
      else process.env.PLUGIN_REGISTRY_URL = previous
      clearRegistryCache()
    }
  })

  it('wraps the page so it cannot call the network and can talk to Rolodex', () => {
    const html = composePluginDocument('<p>Hello</p>')
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain('window.rolodex')
    expect(html).toContain('rolodex:ready')
  })
})
