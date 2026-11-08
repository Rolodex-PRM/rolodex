import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { RegistryEntry } from '@rolodex/plugin-sdk'
import { discoverPlugins } from './plugins'
import { extractPluginZip, installRegistryRelease, isPrivateAddress, releaseArchiveUrl } from './plugin-release'

function zip(files: Record<string, Buffer>, method: 0 | 8 = 0) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = method === 8 ? deflateRawSync(content) : content
    const nameBytes = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const localFile = Buffer.concat([local, nameBytes, data])
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(localFile)
    centrals.push(Buffer.concat([central, nameBytes]))
    offset += localFile.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(centrals.length, 8)
  end.writeUInt16LE(centrals.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function entry(sha256: string, rolodex = '>=0.1.0 <1.0.0'): RegistryEntry {
  return {
    id: 'mailing-lists',
    name: 'Mailing Lists',
    version: '1.0.0',
    description: 'Lists.',
    entry: 'index.html',
    settings: [],
    permissions: ['contacts:read'],
    rolodex,
    repo: 'Rolodex-PRM/Rolodex-Plugin-Mailing-List',
    path: '',
    license: 'AGPL-3.0-only',
    release: 'v1.0.0',
    sha256,
    asset: 'plugin.zip',
  }
}

function manifest(rolodex = '>=0.1.0 <1.0.0') {
  return JSON.stringify({
    id: 'mailing-lists',
    name: 'Mailing Lists',
    version: '1.0.0',
    description: 'Lists.',
    entry: 'index.html',
    rolodex,
    permissions: ['contacts:read'],
  })
}

function responseFor(body: Buffer, status = 200, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(body), { status, headers })
}

describe('plugin releases', () => {
  it('builds a GitHub release address and refuses a private one', () => {
    expect(releaseArchiveUrl('Rolodex-PRM/Rolodex-Plugin-Mailing-List', 'v1.0.0')).toBe(
      'https://github.com/Rolodex-PRM/Rolodex-Plugin-Mailing-List/archive/refs/tags/v1.0.0.zip',
    )
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('10.1.1.1')).toBe(true)
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
  })

  it('follows the tag archive onto codeload and refuses a different host', async () => {
    const archive = zip({
      'Rolodex-Plugin-Mailing-List-1.0.0/rolodex-plugin.json': Buffer.from(manifest()),
      'Rolodex-Plugin-Mailing-List-1.0.0/index.html': Buffer.from('<p>Lists</p>'),
      'Rolodex-Plugin-Mailing-List-1.0.0/src/app.js': Buffer.from('ignored'),
    })
    const root = mkdtempSync(path.join(tmpdir(), 'rolodex-release-'))
    const codeload = 'https://codeload.github.com/Rolodex-PRM/Rolodex-Plugin-Mailing-List/zip/refs/tags/v1.0.0'
    await installRegistryRelease(entry(createHash('sha256').update(archive).digest('hex')), {
      root,
      version: '0.1.0',
      lookup: async () => ['8.8.8.8'],
      fetch: async (url) => String(url).includes('codeload.github.com')
        ? responseFor(archive)
        : responseFor(Buffer.alloc(0), 302, { location: codeload }),
    })
    expect(readFileSync(path.join(root, 'mailing-lists', 'index.html'), 'utf8')).toBe('<p>Lists</p>')
    await expect(installRegistryRelease(entry('c'.repeat(64)), {
      root: mkdtempSync(path.join(tmpdir(), 'rolodex-release-')),
      version: '0.1.0',
      lookup: async () => ['8.8.8.8'],
      fetch: async () => responseFor(Buffer.alloc(0), 302, { location: 'https://example.com/plugin.zip' }),
    })).rejects.toThrow(/not a GitHub release/)
  })

  it('unpacks a deflated release when the hash and Rolodex range match', async () => {
    const archive = zip({
      'rolodex-plugin.json': Buffer.from(manifest()),
      'index.html': Buffer.from('<p>Lists</p>'),
      'README.md': Buffer.from('ignore'),
    }, 8)
    const root = mkdtempSync(path.join(tmpdir(), 'rolodex-release-'))
    await installRegistryRelease(entry(createHash('sha256').update(archive).digest('hex')), {
      root,
      version: '0.1.0',
      lookup: async () => ['8.8.8.8'],
      fetch: async () => responseFor(archive),
    })
    const found = discoverPlugins([root])
    expect(found.map((plugin) => plugin.id)).toEqual(['mailing-lists'])
    expect(found[0]?.compatible).toBe(true)
    expect(readFileSync(path.join(root, 'mailing-lists', 'index.html'), 'utf8')).toBe('<p>Lists</p>')
    expect(existsSync(path.join(root, 'mailing-lists', 'README.md'))).toBe(false)
  })

  it('leaves the server empty when the pin, the path, or the Rolodex range is wrong', async () => {
    const archive = zip({
      'rolodex-plugin.json': Buffer.from(manifest()),
      'index.html': Buffer.from('<p>Lists</p>'),
      '../secret.html': Buffer.from('no'),
    })
    const slipped = extractFailure(archive)
    expect(slipped).toMatch(/leaves its folder/)
    const root = mkdtempSync(path.join(tmpdir(), 'rolodex-release-'))
    const pinned = entry(createHash('sha256').update(archive).digest('hex'))
    await expect(installRegistryRelease({ ...pinned, sha256: 'b'.repeat(64) }, {
      root,
      version: '0.1.0',
      lookup: async () => ['8.8.8.8'],
      fetch: async () => responseFor(archive),
    })).rejects.toThrow(/registry pin/)
    await installRegistryRelease(pinned, {
      root,
      version: '1.0.0',
      lookup: async () => ['8.8.8.8'],
      fetch: async () => responseFor(archive),
    })
    await expect(installRegistryRelease(pinned, {
      root,
      version: '0.1.0',
      lookup: async () => ['127.0.0.1'],
      fetch: async () => responseFor(archive),
    })).rejects.toThrow(/not public/)
    expect(discoverPlugins([root])).toEqual([])
  })
})

function extractFailure(archive: Buffer) {
  try {
    extractPluginZip(archive)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : ''
  }
}
