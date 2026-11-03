import { AppError, createRateLimiter, userForSession, type PublicUser } from '@rolodex/core'
import type { Database } from '@rolodex/db'
import { type ArgumentsHost, type CanActivate, type ExceptionFilter, Inject, Injectable } from '@nestjs/common'
import type { Request, Response } from 'express'

export const DB = Symbol('DB')
export const STORAGE = Symbol('STORAGE')
const COOKIE = 'rolodex_session'

export type AuthedRequest = Request & { user: PublicUser; token: string }

export const loginLimiter = createRateLimiter(20, 60_000)

export function readToken(req: Request) {
  const header = req.headers.authorization
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  const cookie = req.headers.cookie
  if (!cookie) return undefined
  const pair = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
  return pair ? decodeURIComponent(pair.slice(COOKIE.length + 1)) : undefined
}

export function sessionCookie(token: string, maxAgeSeconds: number) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
}

export function clearSessionCookie() {
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Database) {}

  async canActivate(context: { switchToHttp: () => { getRequest: () => AuthedRequest } }) {
    const req = context.switchToHttp().getRequest()
    const token = readToken(req)
    if (!token) throw new AppError(401, 'Sign in required')
    const user = await userForSession(this.db, token)
    if (!user) throw new AppError(401, 'Sign in required')
    req.user = user
    req.token = token
    return true
  }
}

@Injectable()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()
    if (exception instanceof AppError) {
      response.status(exception.status).json({ error: exception.message })
      return
    }
    const status = typeof exception === 'object' && exception && 'getStatus' in exception && typeof exception.getStatus === 'function'
      ? (exception.getStatus() as number)
      : 500
    const message = status === 500 ? 'Internal server error' : exception instanceof Error ? exception.message : 'Request failed'
    if (status === 500) console.error(exception)
    response.status(status).json({ error: message })
  }
}
