import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb, users, workspaces } from '@rolodex/db'
import {
  addMember,
  createAppPassword,
  createContact,
  listContacts,
  listWorkspaces,
  registerUser,
  updateContact,
} from '@rolodex/core'
import { handleDav } from './dav'

for (const path of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match?.[1] && process.env[match[1]] == null) process.env[match[1]] = match[2] ?? ''
  }
}

const databaseUrl = process.env.DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('CardDAV and contact sync', () => {
  const { db, client } = createDb(databaseUrl || 'postgres://invalid')
  const stamp = Date.now()
  const createdUsers: string[] = []
  const createdWorkspaces: string[] = []

  afterAll(async () => {
    for (const id of createdWorkspaces) await db.delete(workspaces).where(eq(workspaces.id, id))
    for (const id of createdUsers) await db.delete(users).where(eq(users.id, id))
    await client.end()
  })

  function basic(email: string, password: string) {
    return `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`
  }

  async function call(email: string, password: string, method: string, path: string, body = '', headers: Record<string, string> = {}) {
    return handleDav(db, {
      method,
      path,
      body,
      headers: { authorization: basic(email, password), ...headers },
    })
  }

  it('synchronizes creates, edits, deletes, and conflicts', async () => {
    const ownerEmail = `owner-${stamp}@example.com`
    const viewerEmail = `viewer-${stamp}@example.com`
    const owner = await registerUser(db, { email: ownerEmail, password: 'correct-horse', displayName: 'Owner' })
    const viewer = await registerUser(db, { email: viewerEmail, password: 'correct-horse', displayName: 'Viewer' })
    createdUsers.push(owner.user.id, viewer.user.id)
    const [workspace] = await listWorkspaces(db, owner.user.id)
    expect(workspace).toBeTruthy()
    if (!workspace) return
    createdWorkspaces.push(workspace.id, ...(await listWorkspaces(db, viewer.user.id)).map((item) => item.id))
    await addMember(db, owner.user.id, workspace.id, viewerEmail, 'viewer')
    const ownerPassword = await createAppPassword(db, owner.user.id, 'iPhone')
    const viewerPassword = await createAppPassword(db, viewer.user.id, 'iPhone')

    const created = await createContact(db, owner.user.id, workspace.id, {
      firstName: 'Web',
      lastName: 'Person',
      howWeMet: 'Conference',
      methods: [{ kind: 'email', label: 'work', value: `web-${stamp}@example.com` }],
    })
    expect(created.etag).toBeTruthy()

    const principal = await call(ownerEmail, ownerPassword.password, 'PROPFIND', '/')
    expect(principal.status).toBe(207)
    expect(principal.body).toContain(`/carddav/principals/${owner.user.id}/`)
    expect(principal.body).toContain(`addressbook-home-set`)
    expect(principal.body).toContain(`/carddav/addressbooks/${owner.user.id}/`)
    expect(principal.body).toContain(`calendar-home-set`)
    expect(principal.body).toContain(`/caldav/calendars/${owner.user.id}/`)

    const home = await call(ownerEmail, ownerPassword.password, 'PROPFIND', `/addressbooks/${owner.user.id}/`, '', { depth: '1' })
    expect(home.status).toBe(207)
    const segment = home.body.match(/\/addressbooks\/[0-9a-f-]+\/([0-9a-f-]+)\//i)?.[1]
    expect(segment).toBeTruthy()
    if (!segment) return

    const initial = await call(
      ownerEmail,
      ownerPassword.password,
      'REPORT',
      `/addressbooks/${owner.user.id}/${segment}/`,
      `<?xml version="1.0"?><sync-collection xmlns="DAV:"><sync-token/><sync-level>1</sync-level><prop><getetag/><address-data xmlns="urn:ietf:params:xml:ns:carddav"/></prop></sync-collection>`,
    )
    expect(initial.status).toBe(207)
    expect(initial.body).toContain('Web Person')
    const firstToken = initial.body.match(/<d:sync-token>([^<]+)<\/d:sync-token>/)?.[1]

    const uid = `phone-${stamp}`
    const createdCard = await call(
      ownerEmail,
      ownerPassword.password,
      'PUT',
      `/addressbooks/${owner.user.id}/${segment}/${uid}.vcf`,
      `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Phone Person\r\nN:Person;Phone;;;\r\nEMAIL;TYPE:HOME:phone-${stamp}@example.com\r\nX-KEEP:yes\r\nEND:VCARD\r\n`,
    )
    expect(createdCard.status).toBe(201)
    const etag = createdCard.headers.ETag
    expect(etag).toBeTruthy()

    const listed = await listContacts(db, owner.user.id, workspace.id, { q: 'Phone Person' })
    expect(listed.contacts.some((contact) => contact.displayName === 'Phone Person')).toBe(true)

    const fetched = await call(ownerEmail, ownerPassword.password, 'GET', `/addressbooks/${owner.user.id}/${segment}/${uid}.vcf`)
    expect(fetched.status).toBe(200)
    expect(fetched.body).toContain('X-KEEP:yes')
    expect(fetched.body).not.toContain('Conference')

    const conflict = await call(
      ownerEmail,
      ownerPassword.password,
      'PUT',
      `/addressbooks/${owner.user.id}/${segment}/${uid}.vcf`,
      fetched.body.replace('Phone Person', 'Stale Person'),
      { 'if-match': '"not-the-etag"' },
    )
    expect(conflict.status).toBe(412)

    const edited = await call(
      ownerEmail,
      ownerPassword.password,
      'PUT',
      `/addressbooks/${owner.user.id}/${segment}/${uid}.vcf`,
      fetched.body.replace('FN:Phone Person', 'FN:Phone Edited'),
      { 'if-match': fetched.headers.ETag || etag || '' },
    )
    expect(edited.status).toBe(204)
    const afterPhone = await listContacts(db, owner.user.id, workspace.id, { q: 'Phone Edited' })
    expect(afterPhone.contacts).toHaveLength(1)

    await updateContact(db, owner.user.id, workspace.id, created.id, { firstName: 'Web', lastName: 'Updated' })
    const delta = await call(
      ownerEmail,
      ownerPassword.password,
      'REPORT',
      `/addressbooks/${owner.user.id}/${segment}/`,
      `<?xml version="1.0"?><sync-collection xmlns="DAV:"><sync-token>${firstToken}</sync-token><sync-level>1</sync-level><prop><getetag/><address-data xmlns="urn:ietf:params:xml:ns:carddav"/></prop></sync-collection>`,
    )
    expect(delta.status).toBe(207)
    expect(delta.body).toContain('Web Updated')
    const preserved = await call(ownerEmail, ownerPassword.password, 'GET', `/addressbooks/${owner.user.id}/${segment}/${uid}.vcf`)
    expect(preserved.body).toContain('X-KEEP:yes')

    const denied = await call(
      viewerEmail,
      viewerPassword.password,
      'PUT',
      `/addressbooks/${viewer.user.id}/${segment}/${uid}.vcf`,
      preserved.body,
      { 'if-match': preserved.headers.ETag || '' },
    )
    expect(denied.status).toBe(403)

    const removed = await call(ownerEmail, ownerPassword.password, 'DELETE', `/addressbooks/${owner.user.id}/${segment}/${uid}.vcf`)
    expect(removed.status).toBe(204)
    const afterDelete = await call(
      ownerEmail,
      ownerPassword.password,
      'REPORT',
      `/addressbooks/${owner.user.id}/${segment}/`,
      `<?xml version="1.0"?><sync-collection xmlns="DAV:"><sync-token>${firstToken}</sync-token><sync-level>1</sync-level></sync-collection>`,
    )
    expect(afterDelete.body).toContain('404 Not Found')
    const gone = await listContacts(db, owner.user.id, workspace.id, { q: 'Phone Edited' })
    expect(gone.contacts).toHaveLength(0)
  })

  it('syncs a typed calendar event over CalDAV', async () => {
    const email = `cal-${stamp}@example.com`
    const user = await registerUser(db, { email, password: 'correct-horse', displayName: 'Calendar' })
    createdUsers.push(user.user.id)
    const [workspace] = await listWorkspaces(db, user.user.id)
    if (!workspace) throw new Error('missing workspace')
    createdWorkspaces.push(workspace.id)
    const password = await createAppPassword(db, user.user.id, 'Phone')
    const principal = await call(email, password.password, 'PROPFIND', `/principals/${user.user.id}/`)
    expect(principal.body).toContain(`/calendars/${user.user.id}/`)
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:lunch-1\r\nSUMMARY:Lunch\r\nDTSTART;VALUE=DATE:20261103\r\nDTEND;VALUE=DATE:20261104\r\nCATEGORIES:meal\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    const put = await call(email, password.password, 'PUT', `/calendars/${user.user.id}/rolodex/lunch-1.ics`, ics)
    expect(put.status).toBe(201)
    const got = await call(email, password.password, 'GET', `/calendars/${user.user.id}/rolodex/lunch-1.ics`)
    expect(got.status).toBe(200)
    expect(got.body).toContain('CATEGORIES:meal')
    expect(got.body).toContain('SUMMARY:Lunch')
    const removed = await call(email, password.password, 'DELETE', `/calendars/${user.user.id}/rolodex/lunch-1.ics`)
    expect(removed.status).toBe(204)
    const todo = 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:call-ada\r\nSUMMARY:Call Ada\r\nDUE;VALUE=DATE:20261103\r\nPRIORITY:1\r\nDESCRIPTION:Ask about the engine\r\nRRULE:FREQ=MONTHLY\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n'
    const taskHome = await call(email, password.password, 'PROPFIND', `/calendars/${user.user.id}/`)
    expect(taskHome.body).toContain(`/calendars/${user.user.id}/tasks/`)
    const putTask = await call(email, password.password, 'PUT', `/calendars/${user.user.id}/tasks/call-ada.ics`, todo)
    expect(putTask.status).toBe(201)
    const gotTask = await call(email, password.password, 'GET', `/calendars/${user.user.id}/tasks/call-ada.ics`)
    expect(gotTask.status).toBe(200)
    expect(gotTask.body).toContain('SUMMARY:Call Ada')
    expect(gotTask.body).toContain('PRIORITY:1')
    expect(gotTask.body).toContain('RRULE:FREQ=MONTHLY')
    const removedTask = await call(email, password.password, 'DELETE', `/calendars/${user.user.id}/tasks/call-ada.ics`)
    expect(removedTask.status).toBe(204)
  })
})
