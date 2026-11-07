import { AppError, callPlugin, createRateLimiter, downloadPluginFile, listWorkspacePlugins, pluginDocument, setWorkspacePlugin, updatePluginSettings } from '@rolodex/core'
import { type Database } from '@rolodex/db'
import { Body, Controller, Get, Inject, Param, Put, Req, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { AuthGuard, DB, type AuthedRequest } from './http'

const calls = createRateLimiter(600, 60_000)

@Controller()
@UseGuards(AuthGuard)
export class PluginsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('workspaces/:workspaceId/plugins')
  list(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string) {
    return listWorkspacePlugins(this.db, req.user.id, workspaceId)
  }

  @Put('workspaces/:workspaceId/plugins/:pluginId')
  set(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('pluginId') pluginId: string, @Body() body: { enabled?: boolean }) {
    if (typeof body?.enabled !== 'boolean') throw new AppError(400, 'Choose whether the plugin is on')
    return setWorkspacePlugin(this.db, req.user.id, workspaceId, pluginId, body.enabled)
  }

  @Put('workspaces/:workspaceId/plugins/:pluginId/settings')
  settings(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('pluginId') pluginId: string, @Body() body: { values?: unknown }) {
    return updatePluginSettings(this.db, req.user.id, workspaceId, pluginId, body?.values)
  }

  @Get('workspaces/:workspaceId/plugins/:pluginId/files/:fileId')
  async file(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('pluginId') pluginId: string, @Param('fileId') fileId: string, @Res() res: Response) {
    const file = await downloadPluginFile(this.db, req.user.id, workspaceId, pluginId, fileId)
    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/"/g, '')}"`)
    res.send(Buffer.from(file.content, 'base64'))
  }

  @Get('workspaces/:workspaceId/plugins/:pluginId/document')
  document(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('pluginId') pluginId: string) {
    return pluginDocument(this.db, req.user.id, workspaceId, pluginId)
  }

  @Put('workspaces/:workspaceId/plugins/:pluginId/call')
  call(@Req() req: AuthedRequest, @Param('workspaceId') workspaceId: string, @Param('pluginId') pluginId: string, @Body() body: { method?: string; args?: unknown }) {
    if (!calls(`${req.user.id}:${pluginId}`)) throw new AppError(429, 'This plugin is calling too quickly')
    if (!body?.method) throw new AppError(400, 'Choose a plugin action')
    return callPlugin(this.db, req.user.id, workspaceId, pluginId, body.method, body.args)
  }
}
