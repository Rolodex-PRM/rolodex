import { randomUUID } from 'node:crypto'
import { AppError } from './errors'

export function buildAppleSyncProfile(input: { email: string; password: string; url: string }) {
  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    throw new AppError(400, 'The phone address is not a URL')
  }
  const ssl = parsed.protocol === 'https:'
  const port = Number(parsed.port || (ssl ? 443 : 80))
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError(400, 'The phone address has no port')
  const principal = `${parsed.protocol}//${parsed.host}/`
  const details = {
    host: parsed.hostname,
    email: input.email,
    password: input.password,
    port,
    principal,
    ssl,
  }
  const profileId = randomUUID()
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>PayloadContent</key>
<array>
${account('com.apple.carddav.account', 'CardDAV', 'Rolodex Contacts', details)}
${account('com.apple.caldav.account', 'CalDAV', 'Rolodex Calendar', details)}
</array>
<key>PayloadDisplayName</key>
<string>Rolodex</string>
<key>PayloadDescription</key>
<string>Contacts and calendar for Rolodex</string>
<key>PayloadIdentifier</key>
<string>com.rolodex.sync.${profileId}</string>
<key>PayloadRemovalDisallowed</key>
<false/>
<key>PayloadType</key>
<string>Configuration</string>
<key>PayloadUUID</key>
<string>${profileId}</string>
<key>PayloadVersion</key>
<integer>1</integer>
</dict>
</plist>
`
}

function account(type: string, prefix: 'CardDAV' | 'CalDAV', title: string, details: { host: string; email: string; password: string; port: number; principal: string; ssl: boolean }) {
  const id = randomUUID()
  return `<dict>
<key>${prefix}AccountDescription</key><string>${xml(title)}</string>
<key>${prefix}HostName</key><string>${xml(details.host)}</string>
<key>${prefix}Username</key><string>${xml(details.email)}</string>
<key>${prefix}Password</key><string>${xml(details.password)}</string>
<key>${prefix}Port</key><integer>${details.port}</integer>
<key>${prefix}PrincipalURL</key><string>${xml(details.principal)}</string>
<key>${prefix}UseSSL</key>${details.ssl ? '<true/>' : '<false/>'}
<key>PayloadDescription</key><string>${xml(title)}</string>
<key>PayloadDisplayName</key><string>${xml(title)}</string>
<key>PayloadIdentifier</key><string>com.rolodex.${prefix.toLowerCase()}.${id}</string>
<key>PayloadType</key><string>${type}</string>
<key>PayloadUUID</key><string>${id}</string>
<key>PayloadVersion</key><integer>1</integer>
</dict>`
}

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
