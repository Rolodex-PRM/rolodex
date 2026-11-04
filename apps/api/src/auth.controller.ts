import {
  AppError,
  appPasswordSchema,
  beginOauth,
  createAppPassword,
  deletePushSubscription,
  exchangeOauthCode,
  finishOauth,
  listAppPasswords,
  authenticatePassword,
  confirmEnrollment,
  disableTwoFactor,
  finishSecondFactor,
  gateUser,
  sendLoginEmailCode,
  sendTwoFactorTest,
  loginSchema,
  logoutUser,
  mfaSchema,
  mfaTicketSchema,
  openSession,
  startEnrollment,
  totpCodeSchema,
  totpConfirmSchema,
  twoFactorStatus,
  oauthExchangeSchema,
  parseBody,
  publicOauth,
  pushPublic,
  pushSubscriptionSchema,
  acceptInvite,
  passwordResetSchema,
  previewInvite,
  publicAppearance,
  registrationPolicy,
  registerSchema,
  createFirstAdmin,
  registerUser,
  setupRequired,
  resetPassword,
  revokeAppPassword,
  savePushSubscription,
} from '@rolodex/core'
import type { Database } from '@rolodex/db'
import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { networkInterfaces } from 'node:os'
import type { Response } from 'express'
import { AuthGuard, clearSessionCookie, DB, loginLimiter, sessionCookie, type AuthedRequest } from './http'

function publicCarddavUrl(req: AuthedRequest) {
  const configured = process.env.PUBLIC_URL?.trim().replace(/\/$/, '')
  if (configured) return configured
  const host = firstHeader(req.get('x-forwarded-host')) || req.get('host')
  if (process.env.DOCKER_SITE === 'true' && host) {
    const proto = firstHeader(req.get('x-forwarded-proto')) || req.protocol || 'http'
    return `${proto}://${host}`
  }
  return process.env.PUBLIC_CARDDAV_URL || 'http://localhost:4101'
}

function firstHeader(value: string | undefined) {
  return value?.split(',')[0]?.trim() || ''
}

function carddavPhoneUrl(configured: string) {
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    return null
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  const published = process.env.PUBLIC_HOST
  if (local && published && published !== 'localhost' && published !== '127.0.0.1') {
    url.hostname = published
    return url.toString().replace(/\/$/, '')
  }
  if (!local) return configured.replace(/\/$/, '')
  const ip = lanIpv4()
  if (!ip) return null
  url.hostname = ip
  return url.toString().replace(/\/$/, '')
}

function lanIpv4() {
  const skip = /virtual|vethernet|wsl|hyper-v|vmware|virtualbox|loopback|bluetooth|tailscale/i
  const found: string[] = []
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (skip.test(name)) continue
    for (const entry of entries ?? []) {
      const family = entry.family as string | number
      if (entry.internal || (family !== 'IPv4' && family !== 4)) continue
      found.push(entry.address)
    }
  }
  return found.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) ?? found[0] ?? null
}

@Controller()
export class AuthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('health')
  health() {
    return { ok: true }
  }

  @Get('appearance')
  appearance() {
    return publicAppearance(this.db)
  }

  @Get('auth/registration')
  registration() {
    return registrationPolicy(this.db)
  }

  @Get('auth/setup')
  setup() {
    return setupRequired(this.db)
  }

  @Post('auth/setup')
  async createSetup(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    if (!loginLimiter(req.ip || 'local')) throw new AppError(429, 'Too many attempts. Try again in a minute.')
    const input = parseBody(registerSchema, body)
    const result = await createFirstAdmin(this.db, input)
    res.setHeader('Set-Cookie', sessionCookie(result.token, 30 * 24 * 60 * 60, req))
    return result
  }

  @Get('auth/invites/preview')
  invitePreview(@Query('token') token: string | undefined) {
    return previewInvite(this.db, token ?? '')
  }

  @Post('auth/reset')
  reset(@Body() body: unknown, @Req() req: AuthedRequest) {
    if (!loginLimiter(req.ip || 'local')) throw new AppError(429, 'Too many attempts. Try again in a minute.')
    return resetPassword(this.db, parseBody(passwordResetSchema, body))
  }

  @Post('auth/register')
  async register(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    if (!loginLimiter(req.ip || 'local')) throw new AppError(429, 'Too many attempts. Try again in a minute.')
    const input = parseBody(registerSchema, body)
    if (!input.invite && (await registrationPolicy(this.db)).inviteOnly) throw new AppError(403, 'Registration requires an invitation')
    const result = input.invite ? await acceptInvite(this.db, input) : await registerUser(this.db, input)
    res.setHeader('Set-Cookie', sessionCookie(result.token, 30 * 24 * 60 * 60, req))
    return result
  }

  @Get('auth/oauth')
  oauth() {
    return publicOauth(this.db)
  }

  @Get('auth/oauth/start')
  async startOauth(@Query('client') client: string | undefined, @Res() res: Response) {
    const location = await beginOauth(this.db, client === 'mobile' ? 'mobile' : 'web')
    res.redirect(location)
  }

  @Get('auth/oauth/callback')
  async oauthCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const location = await finishOauth(this.db, { code: code ?? '', state: state ?? '', error: error ?? '' })
    res.redirect(location)
  }

  @Post('auth/oauth/exchange')
  async exchangeOauth(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const input = parseBody(oauthExchangeSchema, body)
    const result = await exchangeOauthCode(this.db, input.code)
    const gate = await gateUser(this.db, result.user.id)
    if (gate.kind !== 'session') {
      await logoutUser(this.db, result.token)
      return gate
    }
    res.setHeader('Set-Cookie', sessionCookie(result.token, 30 * 24 * 60 * 60, req))
    return result
  }

  @Get('notifications/push')
  @UseGuards(AuthGuard)
  push(@Req() _req: AuthedRequest) {
    return pushPublic(this.db)
  }

  @Post('notifications/push')
  @UseGuards(AuthGuard)
  subscribePush(@Req() req: AuthedRequest, @Body() body: unknown) {
    return savePushSubscription(this.db, req.user.id, parseBody(pushSubscriptionSchema, body))
  }

  @Delete('notifications/push')
  @UseGuards(AuthGuard)
  unsubscribePush(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(pushSubscriptionSchema.pick({ endpoint: true }), body)
    return deletePushSubscription(this.db, req.user.id, input.endpoint)
  }

  @Post('auth/login')
  async login(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    if (!loginLimiter(req.ip || 'local')) throw new AppError(429, 'Too many attempts. Try again in a minute.')
    const input = parseBody(loginSchema, body)
    const user = await authenticatePassword(this.db, input.email, input.password)
    const gate = await gateUser(this.db, user.id)
    if (gate.kind !== 'session') return gate
    const result = await openSession(this.db, user.id)
    res.setHeader('Set-Cookie', sessionCookie(result.token, 30 * 24 * 60 * 60, req))
    return result
  }

  @Post('auth/login/mfa')
  async loginMfa(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    if (!loginLimiter(req.ip || 'local')) throw new AppError(429, 'Too many attempts. Try again in a minute.')
    const input = parseBody(mfaSchema, body)
    const result = await finishSecondFactor(this.db, input.ticket, input.code)
    res.setHeader('Set-Cookie', sessionCookie(result.token, 30 * 24 * 60 * 60, req))
    return result
  }

  @Post('auth/login/email-code')
  loginEmailCode(@Body() body: unknown) {
    const input = parseBody(mfaTicketSchema, body)
    return sendLoginEmailCode(this.db, input.ticket)
  }

  @Get('auth/two-factor')
  @UseGuards(AuthGuard)
  twoFactor(@Req() req: AuthedRequest) {
    return twoFactorStatus(this.db, req.user.id)
  }

  @Post('auth/two-factor/setup')
  @UseGuards(AuthGuard)
  twoFactorSetup(@Req() req: AuthedRequest) {
    return startEnrollment(req.user.email)
  }

  @Post('auth/two-factor/confirm')
  @UseGuards(AuthGuard)
  twoFactorConfirm(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(totpConfirmSchema, body)
    return confirmEnrollment(this.db, req.user.id, input.secret, input.code)
  }

  @Post('auth/two-factor/email-test')
  @UseGuards(AuthGuard)
  twoFactorEmailTest(@Req() req: AuthedRequest) {
    return sendTwoFactorTest(this.db, req.user.id)
  }

  @Delete('auth/two-factor')
  @UseGuards(AuthGuard)
  twoFactorDisable(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(totpCodeSchema, body)
    return disableTwoFactor(this.db, req.user.id, input.code)
  }

  @Post('auth/logout')
  @UseGuards(AuthGuard)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await logoutUser(this.db, req.token)
    res.setHeader('Set-Cookie', clearSessionCookie())
    return { ok: true }
  }

  @Get('auth/me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest) {
    const carddavUrl = publicCarddavUrl(req)
    return {
      user: req.user,
      carddavUrl,
      carddavPhoneUrl: carddavPhoneUrl(carddavUrl),
    }
  }

  @Get('app-passwords')
  @UseGuards(AuthGuard)
  listPasswords(@Req() req: AuthedRequest) {
    return listAppPasswords(this.db, req.user.id)
  }

  @Post('app-passwords')
  @UseGuards(AuthGuard)
  createPassword(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(appPasswordSchema, body)
    return createAppPassword(this.db, req.user.id, input.label)
  }

  @Delete('app-passwords/:id')
  @UseGuards(AuthGuard)
  async revokePassword(@Req() req: AuthedRequest, @Param('id') id: string) {
    await revokeAppPassword(this.db, req.user.id, id)
    return { ok: true }
  }
}

