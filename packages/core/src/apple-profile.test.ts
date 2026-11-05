import { describe, expect, it } from 'vitest'
import { buildAppleSyncProfile } from './apple-profile'

describe('buildAppleSyncProfile', () => {
  it('writes the CardDAV and CalDAV accounts for the phone address', () => {
    const profile = buildAppleSyncProfile({
      email: 'ada@example.com',
      password: 'secret<1>&2',
      url: 'http://192.168.1.60:4101',
    })
    expect(profile).toContain('<key>CardDAVHostName</key><string>192.168.1.60</string>')
    expect(profile).toContain('<key>CardDAVPort</key><integer>4101</integer>')
    expect(profile).toContain('<key>CardDAVUseSSL</key><false/>')
    expect(profile).toContain('<key>CardDAVPrincipalURL</key><string>http://192.168.1.60:4101/</string>')
    expect(profile).toContain('<key>CalDAVHostName</key><string>192.168.1.60</string>')
    expect(profile).toContain('<string>secret&lt;1&gt;&amp;2</string>')
    expect(profile).toContain('com.apple.carddav.account')
    expect(profile).toContain('com.apple.caldav.account')
  })
})
