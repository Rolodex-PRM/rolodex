import { describe, expect, it } from 'vitest'
import type { Database } from '@rolodex/db'
import { handleDav } from './dav'

const db = null as unknown as Database

describe('iPhone service discovery', () => {
  it('redirects CardDAV and CalDAV discovery to this host and port', async () => {
    for (const path of ['/.well-known/carddav', '/.well-known/caldav']) {
      const result = await handleDav(db, {
        method: 'PROPFIND',
        path,
        headers: { host: '192.168.1.140:4101' },
        body: '',
        ip: '192.168.1.20',
      })
      expect(result.status).toBe(301)
      expect(result.headers.Location).toBe('http://192.168.1.140:4101/')
    }
  })

  it('keeps the service root behind the application password', async () => {
    const result = await handleDav(db, {
      method: 'PROPFIND',
      path: '/',
      headers: { host: '192.168.1.140:4101' },
      body: '',
    })
    expect(result.status).toBe(401)
    expect(result.headers['WWW-Authenticate']).toContain('Basic')
  })
})
