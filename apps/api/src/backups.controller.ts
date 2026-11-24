import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import type { Response } from 'express'
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import {
  AppError,
  backupPolicy,
  backupPolicySchema,
  backupRestoreSchema,
  createBackupDownloadStream,
  createCompleteBackup,
  deleteBackup,
  importBackupArchive,
  listBackupSummaries,
  listWorkspaces,
  parseBody,
  restoreBackup,
  setBackupPolicy,
} from '@rolodex/core'
import type { Database } from '@rolodex/db'
import { AuthGuard, DB, type AuthedRequest } from './http'

@Controller()
@UseGuards(AuthGuard)
export class BackupsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('backups')
  async list(@Req() req: AuthedRequest) {
    const workspaces = await listWorkspaces(this.db, req.user.id)
    const canManage = workspaces.some((workspace) => workspace.role === 'owner')
    const canView = canManage || workspaces.some((workspace) => workspace.role === 'administrator')
    if (!canView) throw new AppError(403, 'Only owners and administrators can view backups')
    return { policy: await backupPolicy(this.db), backups: listBackupSummaries(), canManage }
  }

  @Put('backups/policy')
  savePolicy(@Req() req: AuthedRequest, @Body() body: unknown) {
    return setBackupPolicy(this.db, req.user.id, parseBody(backupPolicySchema, body))
  }

  @Post('backups')
  create(@Req() req: AuthedRequest) {
    return createCompleteBackup(this.db, req.user.id)
  }

  @Post('backups/database')
  async databaseOnly(@Req() req: AuthedRequest, @Res() res: Response) {
    const workspaces = await listWorkspaces(this.db, req.user.id)
    if (!workspaces.some((workspace) => workspace.role === 'owner')) {
      throw new AppError(403, 'Only an owner can create a backup')
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const sql = await dumpDatabaseSql()
    res.setHeader('Content-Type', 'application/sql; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="rolodex-${stamp}.sql"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    res.send(sql)
  }

  @Get('backups/:id/download')
  async download(@Req() req: AuthedRequest, @Param('id') id: string, @Res() res: Response) {
    const workspaces = await listWorkspaces(this.db, req.user.id)
    if (!workspaces.some((workspace) => workspace.role === 'owner' || workspace.role === 'administrator')) {
      throw new AppError(403, 'Only owners and administrators can download backups')
    }
    const pack = await createBackupDownloadStream(id)
    try {
      res.setHeader('Content-Type', 'application/gzip')
      res.setHeader('Content-Disposition', `attachment; filename="${pack.filename}"`)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cache-Control', 'no-store')
      await pipeline(createReadStream(pack.archive), res)
    } finally {
      pack.cleanup()
    }
  }

  @Post('backups/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = path.join(tmpdir(), 'rolodex-backup-uploads')
          mkdirSync(dir, { recursive: true })
          cb(null, dir)
        },
        filename: (_req, file, cb) => {
          const safe = (file.originalname || 'backup.tar.gz').replace(/[^\w.-]+/g, '_').slice(0, 120)
          cb(null, `${randomUUID()}-${safe}`)
        },
      }),
    }),
  )
  async upload(
    @Req() req: AuthedRequest,
    @UploadedFile() file?: { path: string; originalname: string; size: number },
  ) {
    if (!file?.path || !existsSync(file.path)) throw new AppError(400, 'A backup archive file is required')
    try {
      return await importBackupArchive(this.db, req.user.id, file.path)
    } finally {
      try {
        unlinkSync(file.path)
      } catch {
        // ignore cleanup errors
      }
    }
  }

  @Post('backups/:id/restore')
  async restore(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    parseBody(backupRestoreSchema, body)
    const result = await restoreBackup(this.db, req.user.id, id)
    setTimeout(() => process.exit(0), 750)
    return result
  }

  @Delete('backups/:id')
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return deleteBackup(this.db, req.user.id, id)
  }
}

function dumpDatabaseSql() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new AppError(500, 'DATABASE_URL is not configured')
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('pg_dump', ['--dbname', databaseUrl, '--clean', '--if-exists', '--no-owner'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    let errorText = ''
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      errorText += chunk.toString()
    })
    child.on('error', () => {
      reject(new AppError(501, 'pg_dump is not available. Run scripts/backup.sh from a host with PostgreSQL client tools.'))
    })
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new AppError(500, errorText.trim() || 'Backup failed'))
        return
      }
      resolve(Buffer.concat(chunks))
    })
  })
}
