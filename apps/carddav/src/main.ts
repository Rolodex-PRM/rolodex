import 'reflect-metadata'
import { existsSync, readFileSync } from 'node:fs'
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
  process.env.DATABASE_URL ||= 'postgres://rolodex:rolodex@localhost:5472/rolodex'
  const cert = process.env.CARDDAV_TLS_CERT
  const key = process.env.CARDDAV_TLS_KEY
  const httpsOptions = cert && key && existsSync(cert) && existsSync(key) ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined
  const app = await NestFactory.create(AppModule, { bodyParser: false, httpsOptions })
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
  const port = Number(process.env.CARDDAV_PORT || 4101)
  await app.listen(port, '0.0.0.0')
  console.log(`CardDAV listening on ${port}`)
}

void main()
