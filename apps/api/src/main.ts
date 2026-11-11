import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { dispatchDueNotifications, loadEnv, syncDueImmich } from '@rolodex/core'
import { createDb } from '@rolodex/db'
import { AuthController } from './auth.controller'
import { DataController } from './data.controller'
import { PluginsController } from './plugins.controller'
import { AppExceptionFilter, DB, STORAGE } from './http'
import { mountMcp } from './mcp'
import { ensureBucket, objectStorage } from './storage'

@Module({
  controllers: [AuthController, DataController, PluginsController],
  providers: [
    {
      provide: DB,
      useFactory: () => createDb(process.env.DATABASE_URL || '').db,
    },
    {
      provide: STORAGE,
      useFactory: () => objectStorage(),
    },
  ],
})
class AppModule {}

async function main() {
  loadEnv()
  process.env.DATABASE_URL ||= 'postgres://rolodex:rolodex@localhost:5472/rolodex'
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })
  app.useBodyParser('json', { limit: '8mb' })
  app.useBodyParser('urlencoded', { extended: true, limit: '8mb' })
  const expressApp = app.getHttpAdapter().getInstance() as { set: (key: string, value: number) => void }
  expressApp.set('trust proxy', 1)
  app.setGlobalPrefix('api')
  app.useGlobalFilters(new AppExceptionFilter())
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:4181,http://localhost:4180')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  })
  const database = app.get<ReturnType<typeof createDb>['db']>(DB)
  mountMcp(app.getHttpAdapter().getInstance(), database)
  try {
    await ensureBucket(app.get(STORAGE))
    console.log('Object storage bucket is ready.')
  } catch (error) {
    console.warn('Object storage is not reachable yet. Contact photos will fail until it is.')
    console.warn(error instanceof Error ? error.message : error)
  }
  const port = Number(process.env.API_PORT || 4100)
  await app.listen(port, '0.0.0.0')
  console.log(`API listening on ${port}`)
  console.log(`MCP listening on /mcp`)
  const syncImmich = () => {
    void syncDueImmich(database).catch((error: unknown) => {
      console.warn(error instanceof Error ? error.message : 'Immich sync failed')
    })
  }
  syncImmich()
  setInterval(syncImmich, 30 * 60 * 1000)
  const dispatchNotifications = () => {
    void dispatchDueNotifications(database).catch((error: unknown) => {
      console.warn(error instanceof Error ? error.message : 'Notification dispatch failed')
    })
  }
  dispatchNotifications()
  setInterval(dispatchNotifications, 5 * 60 * 1000)
}

void main()
