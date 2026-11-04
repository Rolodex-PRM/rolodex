import type { Database } from '@rolodex/db'
import type { z } from 'zod'
import { requireManager } from './access'
import { readSettings, writeSettings } from './server-store'
import { cleanCss } from './css-allow'
import type { appearanceSchema } from './validation'

const settingKey = 'appearance'
const defaults = { css: '', userCss: false }

export { cleanCss }

export async function publicAppearance(db: Database) {
  const stored = await readSettings(db, settingKey, defaults)
  return { css: cleanCss(typeof stored.css === 'string' ? stored.css : ''), userCss: stored.userCss === true }
}

export async function setAppearance(db: Database, userId: string, workspaceId: string, input: z.infer<typeof appearanceSchema>) {
  await requireManager(db, userId, workspaceId)
  await writeSettings(db, settingKey, { css: cleanCss(input.css), userCss: input.userCss })
  return publicAppearance(db)
}
