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
      expect(result.headers.Location).toBe(path.endsWith('caldav') ? 'http://192.168.1.140:4101/caldav/' : 'http://192.168.1.140:4101/carddav/')
    }
  })

  it('keeps the website scheme when a proxy terminates TLS', async () => {
    const result = await handleDav(db, {
      method: 'PROPFIND',
      path: '/.well-known/carddav',
      headers: { host: 'rolodex.demo.com', 'x-forwarded-proto': 'https' },
      body: '',
    })
    expect(result.status).toBe(301)
    expect(result.headers.Location).toBe('https://rolodex.demo.com/carddav/')
  })

  it('keeps both sync paths behind the application password', async () => {
    for (const path of ['/carddav/', '/caldav/']) {
      const result = await handleDav(db, {
        method: 'PROPFIND',
        path,
        headers: { host: 'rolodex.demo.com', 'x-forwarded-proto': 'https' },
        body: '',
      })
      expect(result.status).toBe(401)
      expect(result.headers['WWW-Authenticate']).toContain('Basic')
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
