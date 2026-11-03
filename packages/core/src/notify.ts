import { contacts, notificationDeliveries, pushSubscriptions, reminders, users, type Database } from '@rolodex/db'
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm'
import type { z } from 'zod'
import { requireManager } from './access'
import { AppError } from './errors'
import { mailboxAddress, sendSmtp } from './smtp'
import { createPushKeys, encryptPushPayload, postPush, vapidAuthorization, type PushKeys } from './web-push'
import { credentialsKey, keepSecret, readSecret, readSettings, savedSecret, writeSecret, writeSettings } from './server-store'
import type { notificationSettingsSchema, pushSubscriptionSchema } from './validation'

const settingKey = 'notifications'
const emailSecret = 'notify.email.password'
const webhookSecret = 'notify.webhook.secret'
const pushSecret = 'notify.push.private'

type EmailSettings = {
  enabled: boolean
  host: string
  port: number
  username: string
  secure: boolean
  ignoreCertificateErrors: boolean
  from: string
}

type PushSettings = {
  enabled: boolean
  subject: string
  publicKey: string
}

type WebhookSettings = {
  enabled: boolean
  url: string
}

export type NotificationSettings = {
  appUrl: string
  email: EmailSettings
  push: PushSettings
  webhook: WebhookSettings
}

const defaults: NotificationSettings = {
  appUrl: 'http://localhost:8081',
  email: { enabled: false, host: '', port: 465, username: '', secure: true, ignoreCertificateErrors: false, from: '' },
  push: { enabled: false, subject: '', publicKey: '' },
  webhook: { enabled: false, url: '' },
}

type Notice = { title: string; body: string; href: string; email: string }

export async function getNotificationSettings(db: Database, userId: string, workspaceId: string) {
  await requireManager(db, userId, workspaceId)
  return present(db)
}

export async function setNotificationSettings(db: Database, userId: string, workspaceId: string, input: z.infer<typeof notificationSettingsSchema>) {
  await requireManager(db, userId, workspaceId)
  const current = await readNotificationSettings(db)
  const emailPassword = keepSecret(input.email.password, await readSecret(db, emailSecret))
  const hookSecret = keepSecret(input.webhook.secret, await readSecret(db, webhookSecret))
  let push = { ...current.push, enabled: input.push.enabled, subject: input.push.subject.trim() }
  const settings: NotificationSettings = {
    appUrl: input.appUrl.replace(/\/$/, ''),
    email: {
      enabled: input.email.enabled,
      host: input.email.host.trim(),
      port: input.email.port,
      username: input.email.username.trim(),
      secure: input.email.secure,
      ignoreCertificateErrors: input.email.ignoreCertificateErrors,
      from: input.email.from.trim(),
    },
    push,
    webhook: { enabled: input.webhook.enabled, url: input.webhook.url.trim() },
  }
  if (settings.push.enabled && !settings.push.publicKey) {
    const keys = createPushKeys()
    settings.push = { ...settings.push, publicKey: keys.publicKey }
    await writeSecret(db, pushSecret, keys.privateKey)
  }
  assertReady(settings, emailPassword)
  await writeSettings(db, settingKey, settings)
  await writeSecret(db, emailSecret, emailPassword)
  await writeSecret(db, webhookSecret, hookSecret)
  return present(db)
}

export async function pushPublic(db: Database) {
  const settings = await readNotificationSettings(db)
  return { enabled: settings.push.enabled, publicKey: settings.push.publicKey }
}

export async function savePushSubscription(db: Database, userId: string, input: z.infer<typeof pushSubscriptionSchema>) {
  const settings = await readNotificationSettings(db)
  if (!settings.push.enabled || !settings.push.publicKey) throw new AppError(400, 'Push is turned off')
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth } })
  return { ok: true }
}

export async function deletePushSubscription(db: Database, userId: string, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
  return { ok: true }
}

export async function sendNotificationTest(db: Database, userId: string, workspaceId: string, channel: 'email' | 'push' | 'webhook') {
  await requireManager(db, userId, workspaceId)
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new AppError(404, 'Account not found')
  const settings = await readNotificationSettings(db)
  const notice: Notice = {
    title: 'Rolodex test',
    body: 'This is a test notification from Rolodex.',
    href: settings.appUrl || defaults.appUrl,
    email: user.email,
  }
  if (channel === 'email') await deliverEmail(db, settings, notice)
  if (channel === 'push') await deliverPush(db, settings, user.id, notice, false)
  if (channel === 'webhook') await deliverWebhook(db, settings, notice)
  return { ok: true }
}

export async function dispatchDueNotifications(db: Database) {
  const settings = await readNotificationSettings(db)
  const channels = (['email', 'push', 'webhook'] as const).filter((channel) => settings[channel].enabled)
  if (!channels.length) return { sent: 0 }
  const earliest = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  const due = await db
    .select()
    .from(reminders)
    .where(and(isNull(reminders.completedAt), gte(reminders.remindAt, earliest), lte(reminders.remindAt, new Date()), or(isNull(reminders.snoozedUntil), lte(reminders.snoozedUntil, new Date()))))
    .limit(30)
  let sent = 0
  for (const reminder of due) {
    if (!reminder.assigneeId) continue
    const [user] = await db.select().from(users).where(eq(users.id, reminder.assigneeId)).limit(1)
    if (!user) continue
    let who = ''
    if (reminder.contactId) {
      const [contact] = await db.select({ displayName: contacts.displayName }).from(contacts).where(eq(contacts.id, reminder.contactId)).limit(1)
      who = contact?.displayName ?? ''
    }
    const notice: Notice = {
      title: who ? `${reminder.type} · ${who}` : reminder.type,
      body: 'A reminder in Rolodex is due.',
      href: reminder.contactId && settings.appUrl ? `${settings.appUrl}/contacts/${reminder.contactId}` : settings.appUrl,
      email: user.email,
    }
    for (const channel of channels) {
      const dedupeKey = `reminder:${reminder.id}`
      const [already] = await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(and(eq(notificationDeliveries.channel, channel), eq(notificationDeliveries.dedupeKey, dedupeKey)))
        .limit(1)
      if (already) continue
      try {
        if (channel === 'email') await deliverEmail(db, settings, notice)
        if (channel === 'push' && (await deliverPush(db, settings, user.id, notice, true)) === 'skipped') continue
        if (channel === 'webhook') await deliverWebhook(db, settings, notice)
        await db.insert(notificationDeliveries).values({ channel, dedupeKey }).onConflictDoNothing()
        sent += 1
      } catch (error) {
        console.warn(error instanceof Error ? error.message : 'Notification failed')
      }
    }
  }
  return { sent }
}

async function present(db: Database) {
  const settings = await readNotificationSettings(db)
  const emailPassword = await readSecret(db, emailSecret)
  const hookSecret = await readSecret(db, webhookSecret)
  return {
    ...settings,
    email: { ...settings.email, password: emailPassword ? savedSecret : '' },
    webhook: { ...settings.webhook, secret: hookSecret ? savedSecret : '' },
  }
}

async function readNotificationSettings(db: Database) {
  const stored = await readSettings(db, settingKey, defaults as unknown as Record<string, unknown>)
  return {
    ...defaults,
    ...stored,
    email: { ...defaults.email, ...(stored.email as Partial<EmailSettings> | undefined) },
    push: { ...defaults.push, ...(stored.push as Partial<PushSettings> | undefined) },
    webhook: { ...defaults.webhook, ...(stored.webhook as Partial<WebhookSettings> | undefined) },
  }
}

function assertReady(settings: NotificationSettings, emailPassword: string) {
  if (settings.appUrl) assertUrl(settings.appUrl, true, 'Enter a link URL')
  if (settings.email.enabled) {
    if (!settings.email.host) throw new AppError(400, 'Enter the email server host')
    mailboxAddress(settings.email.from)
    if (settings.email.username && !emailPassword) throw new AppError(400, 'Enter the email password')
  }
  if (settings.push.enabled && !/^(mailto:.+@.+|https:\/\/.+)/i.test(settings.push.subject)) {
    throw new AppError(400, 'Push subject must be a mailto: address or an https URL')
  }
  if (settings.webhook.enabled) assertUrl(settings.webhook.url, true, 'Enter a webhook URL')
}

export async function publicAppUrl(db: Database) {
  const settings = await readNotificationSettings(db)
  return (settings.appUrl || defaults.appUrl).replace(/\/$/, '')
}

export async function sendAccountEmail(db: Database, to: string, subject: string, text: string) {
  const settings = await readNotificationSettings(db)
  if (!settings.email.enabled) throw new AppError(400, 'Turn on email first')
  const password = await readSecret(db, emailSecret)
  await sendSmtp({ ...settings.email, password }, { from: settings.email.from, to, subject, text })
}

async function deliverEmail(db: Database, settings: NotificationSettings, notice: Notice) {
  if (!settings.email.enabled) throw new AppError(400, 'Turn on email first')
  const password = await readSecret(db, emailSecret)
  await sendSmtp(
    { ...settings.email, password },
    { from: settings.email.from, to: notice.email, subject: notice.title, text: `${notice.body}\n\n${notice.href}` },
  )
}

async function deliverPush(db: Database, settings: NotificationSettings, userId: string, notice: Notice, quiet: boolean) {
  if (!settings.push.enabled || !settings.push.publicKey) throw new AppError(400, 'Turn on push first')
  const privateKey = await readSecret(db, pushSecret)
  if (!privateKey) throw new AppError(400, 'Turn on push first')
  const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  if (!rows.length) {
    if (quiet) return 'skipped' as const
    throw new AppError(400, 'Turn on push for this browser in Settings, then send the test again')
  }
  const keys: PushKeys = { publicKey: settings.push.publicKey, privateKey }
  const payload = JSON.stringify({ title: notice.title, body: notice.body, href: notice.href })
  for (const row of rows) {
    const body = encryptPushPayload(payload, row)
    const authorization = vapidAuthorization(row.endpoint, keys, settings.push.subject)
    const result = await postPush(row.endpoint, body, authorization).catch((error: unknown) => {
      throw new AppError(502, error instanceof Error && error.message.startsWith('Push service') ? error.message : 'Could not reach the push service')
    })
    if (result === 'gone') await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id))
  }
  return 'sent' as const
}

async function deliverWebhook(db: Database, settings: NotificationSettings, notice: Notice) {
  if (!settings.webhook.enabled) throw new AppError(400, 'Turn on the webhook first')
  const secret = await readSecret(db, webhookSecret)
  const response = await fetch(settings.webhook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(notice),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new AppError(502, 'Could not reach the webhook')
  })
  if (!response.ok) throw new AppError(502, 'The webhook did not accept the notification')
}

function assertUrl(value: string, allowHttp: boolean, message: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError(400, message)
  }
  if (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) return
  throw new AppError(400, message)
}
