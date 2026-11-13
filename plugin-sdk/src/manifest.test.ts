import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createMockHost } from './host'
import { explainPluginManifest, parseRegistryEntry, rolodexRangeIncludes } from './manifest'

describe('plugin manifest', () => {
  it('keeps a valid page and drops a setting that has no label', () => {
    const explained = explainPluginManifest({
      id: 'scratch-pad',
      name: 'Scratch pad',
      version: '1.0.0',
      description: 'A note.',
      entry: 'index.html',
      settings: [
        { key: 'heading', label: 'Heading', type: 'text' },
        { key: 'bad', label: '', type: 'text' },
      ],
    })
    expect(explained.manifest?.settings).toEqual([{ key: 'heading', label: 'Heading', type: 'text' }])
    expect(explained.problems).toHaveLength(1)
  })

  it('grants only known permissions', () => {
    const explained = explainPluginManifest({
      id: 'mailing-lists',
      name: 'Mailing Lists',
      version: '1.0.0',
      description: 'Lists.',
      permissions: ['contacts:read', 'data:own', 'files:own', 'ai:suggest', 'profile:section', 'contacts:write'],
    })
    expect(explained.manifest?.permissions).toEqual(['contacts:read', 'data:own', 'files:own', 'ai:suggest', 'profile:section'])
    expect(explained.problems).toEqual(['Drop the permission contacts:write'])
  })

  it('rejects an entry that leaves the folder name', () => {
    const explained = explainPluginManifest({
      id: 'escape',
      name: 'Escape',
      version: '1.0.0',
      description: 'No.',
      entry: '../secret.html',
    })
    expect(explained.manifest).toBeNull()
  })

  it('reads a registry entry shaped like the community catalog', () => {
    const parsed = parseRegistryEntry({
      id: 'scratch-pad',
      name: 'Scratch pad',
      version: '1.0.0',
      description: 'A note that stays inside this plugin.',
      entry: 'index.html',
      repo: 'example/scratch-pad',
      release: 'v1.0.0',
      sha256: 'b'.repeat(64),
      rolodex: '>=0.1.0 <1.0.0',
      license: 'AGPL-3.0-only',
    })
    expect(parsed.problems).toEqual([])
    expect(parsed.entry).toMatchObject({
      id: 'scratch-pad',
      repo: 'example/scratch-pad',
      release: 'v1.0.0',
      rolodex: '>=0.1.0 <1.0.0',
    })
  })

  it('accepts this Rolodex line and refuses the next major version', () => {
    expect(rolodexRangeIncludes('>=0.1.0 <1.0.0', '0.1.0')).toBe(true)
    expect(rolodexRangeIncludes('>=0.1.0 <1.0.0', 'v0.9.1')).toBe(true)
    expect(rolodexRangeIncludes('v0.1.0, <1.0.0', '0.1.0')).toBe(true)
    expect(rolodexRangeIncludes('>=0.1.0 <1.0.0', '1.0.0')).toBe(false)
    expect(rolodexRangeIncludes('>=0.1.0 <1.0.0', '0.0.9')).toBe(false)
    const parsed = parseRegistryEntry({
      id: 'mailing-lists',
      name: 'Mailing Lists',
      version: '1.0.0',
      description: 'Lists.',
      rolodex: '>=0.1.0 <1.0.0',
      repo: 'Rolodex-PRM/Rolodex-Plugin-Mailing-List',
      release: 'v1.0.0',
      sha256: 'a'.repeat(64),
    })
    expect(parsed.problems).toEqual([])
    expect(parsed.entry?.asset).toBe('plugin.zip')
    expect(parseRegistryEntry({ ...parsed.entry, sha256: 'nope' }).entry).toBeNull()
  })
})

describe('mock host', () => {
  it('returns names and keeps a note for this plugin only', async () => {
    const host = createMockHost({
      displayName: 'Ada',
      contacts: [{ id: '1', displayName: 'Grace' }],
      settings: { heading: 'Notes' },
    })
    await expect(host.me()).resolves.toEqual({ displayName: 'Ada' })
    await expect(host.contacts()).resolves.toEqual([{ id: '1', displayName: 'Grace' }])
    await expect(host.settings()).resolves.toEqual({ heading: 'Notes' })
    await expect(host.get('note')).resolves.toBeNull()
    await host.set('note', 'hello')
    await expect(host.get('note')).resolves.toBe('hello')
    await expect(host.set('../secret', 'no')).rejects.toThrow(/short key/)
  })

  it('keeps workspace records only after data:own is granted', async () => {
    const host = createMockHost({ grants: ['data:own', 'contacts:read'] })
    await expect(host.records.put('households', { name: 'Smith' }, 'smiths')).resolves.toMatchObject({ id: 'smiths' })
    await expect(host.records.list('households')).resolves.toMatchObject({ total: 1 })
    await expect(host.suggest('group these')).rejects.toThrow(/not allowed/)
    const plain = createMockHost()
    await expect(plain.contactsPage()).rejects.toThrow(/not allowed/)
  })
})

describe('cli', () => {
  it('scaffolds a plugin the validator accepts', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rolodex-plugin-'))
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const cli = path.join(packageRoot, 'src', 'cli.ts')
    const tsx = path.join(packageRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const created = spawnSync(process.execPath, [tsx, cli, 'create', 'field-notes'], { cwd: root, encoding: 'utf8' })
    expect(created.status, created.stderr).toBe(0)
    const dir = path.join(root, 'field-notes')
    expect(existsSync(path.join(dir, 'rolodex-plugin.json'))).toBe(true)
    const checked = spawnSync(process.execPath, [tsx, cli, 'validate', dir], { cwd: root, encoding: 'utf8' })
    expect(checked.status, checked.stderr).toBe(0)
    rmSync(root, { recursive: true, force: true })
  })
})
