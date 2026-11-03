import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { dispatchDueNotifications, loadEnv, syncDueImmich } from '@rolodex/core'
import { createDb } from '@rolodex/db'
import { AuthController } from './auth.controller'
import { DataController } from './data.controller'
import { AppExceptionFilter, DB, STORAGE } from './http'
import { ensureBucket, objectStorage } from './storage'

@Module({
  controllers: [AuthController, DataController],
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
  process.env.DATABASE_URL ||= 'postgres://rolodex:rolodex@localhost:5434/rolodex'
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api')
  app.useGlobalFilters(new AppExceptionFilter())
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:8081,http://localhost:8787,http://localhost:8080')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  })
  try {
    await ensureBucket(app.get(STORAGE))
    console.log('Object storage bucket is ready.')
  } catch (error) {
    console.warn('Object storage is not reachable yet. Contact photos will fail until it is.')
    console.warn(error instanceof Error ? error.message : error)
  }
  const port = Number(process.env.API_PORT || 3000)
  await app.listen(port)
  console.log(`API listening on ${port}`)
  const database = app.get<ReturnType<typeof createDb>['db']>(DB)
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
