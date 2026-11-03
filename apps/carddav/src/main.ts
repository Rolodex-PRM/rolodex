import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { loadEnv } from '@rolodex/core'
import { createDb, type Database } from '@rolodex/db'
import express from 'express'
import { handleDav } from './dav'

const DB = Symbol('DB')

@Module({
  providers: [{ provide: DB, useFactory: () => createDb(process.env.DATABASE_URL || '').db }],
})
class AppModule {}

async function main() {
  loadEnv()
  process.env.DATABASE_URL ||= 'postgres://rolodex:rolodex@localhost:5434/rolodex'
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  const server = app.getHttpAdapter().getInstance() as express.Express
  server.use(express.text({ type: () => true, limit: '20mb' }))
  const db = app.get<Database>(DB)
  server.use(async (req, res) => {
    const result = await handleDav(db, {
      method: req.method,
      path: req.originalUrl,
      headers: req.headers,
      body: typeof req.body === 'string' ? req.body : '',
      ip: req.ip,
    })
    res.status(result.status)
    for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value)
    res.send(result.body)
  })
  const port = Number(process.env.CARDDAV_PORT || 3001)
  await app.listen(port)
  console.log(`CardDAV listening on ${port}`)
}

void main()
