import { createHash, createHmac, createPublicKey, createVerify, randomBytes, timingSafeEqual } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { oauthAccounts, oauthExchanges, oauthStates, users, type Database } from '@rolodex/db'
import { and, eq, lt } from 'drizzle-orm'
import { requireManager } from './access'
import { createOauthUser, openSession, userForSession } from './auth'
import { consumeInvite, pendingInvite, registrationPolicy } from './invites'
import { AppError } from './errors'
import { normalizeEmail } from './normalize'
import { decryptSecret, encryptSecret, hashToken } from './secrets'
import { credentialsKey, keepSecret, readSecret, readSettings, savedSecret, writeSecret, writeSettings } from './server-store'
import type { z } from 'zod'
import { oauthSettingsSchema } from './validation'

const settingKey = 'oauth'
const secretKey = 'oauth.clientSecret'

export type OauthSettings = {
  enabled: boolean
  issuerUrl: string
  clientId: string
  tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic' | 'none'
  scope: string
  idTokenSignedResponseAlg: 'RS256' | 'ES256' | 'HS256'
  userinfoSignedResponseAlg: 'none' | 'RS256' | 'ES256'
  prompt: string
  endSessionEndpoint: string
  requestTimeoutMs: number
  allowInsecureRequests: boolean
  nameClaim: string
  roleClaim: string
  buttonText: string
  accountManagementUrl: string
  autoRegister: boolean
  autoLaunch: boolean
  appUrl: string
  publicUrl: string
  mobileRedirectOverride: boolean
  mobileRedirectUri: string
}

const defaults: OauthSettings = {
  enabled: false,
  issuerUrl: '',
  clientId: '',
  tokenEndpointAuthMethod: 'client_secret_post',
  scope: 'openid email profile',
  idTokenSignedResponseAlg: 'RS256',
  userinfoSignedResponseAlg: 'none',
  prompt: '',
  endSessionEndpoint: '',
  requestTimeoutMs: 30000,
  allowInsecureRequests: false,
  nameClaim: 'preferred_username',
  roleClaim: '',
  buttonText: 'Login with OAuth',
  accountManagementUrl: '',
  autoRegister: true,
  autoLaunch: false,
  appUrl: 'http://localhost:8081',
  publicUrl: 'http://localhost:3000',
  mobileRedirectOverride: false,
  mobileRedirectUri: '',
}

type Discovery = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
  jwks_uri: string
  end_session_endpoint?: string
}

type JsonWebKey = Record<string, unknown>

const discoveryCache = new Map<string, { at: number; value: Discovery; jwks: JsonWebKey[] }>()

export async function getOauthSettings(db: Database, userId: string, workspaceId: string) {
  await requireManager(db, userId, workspaceId)
  const settings = await readOauth(db)
  const secret = await readSecret(db, secretKey)
  return present(settings, secret)
}

export async function setOauthSettings(db: Database, userId: string, workspaceId: string, input: z.infer<typeof oauthSettingsSchema>) {
  await requireManager(db, userId, workspaceId)
  const current = await readOauth(db)
  const previous = await readSecret(db, secretKey)
  const secret = keepSecret(input.clientSecret, previous).trim()
  const settings: OauthSettings = {
    ...current,
    enabled: input.enabled,
    issuerUrl: input.issuerUrl.replace(/\/$/, ''),
    clientId: input.clientId,
    tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
    scope: input.scope,
    idTokenSignedResponseAlg: input.idTokenSignedResponseAlg,
    userinfoSignedResponseAlg: input.userinfoSignedResponseAlg,
    prompt: input.prompt,
    endSessionEndpoint: input.endSessionEndpoint,
    requestTimeoutMs: input.requestTimeoutMs,
    allowInsecureRequests: input.allowInsecureRequests,
    nameClaim: input.nameClaim || 'preferred_username',
    roleClaim: input.roleClaim,
    buttonText: input.buttonText,
    accountManagementUrl: input.accountManagementUrl,
    autoRegister: input.autoRegister,
    autoLaunch: input.autoLaunch,
    appUrl: input.appUrl.replace(/\/$/, ''),
    publicUrl: input.publicUrl.replace(/\/$/, ''),
    mobileRedirectOverride: input.mobileRedirectOverride,
    mobileRedirectUri: input.mobileRedirectUri,
  }
  assertReady(settings, secret)
  await writeSettings(db, settingKey, settings)
  await writeSecret(db, secretKey, secret)
  return present(settings, secret)
}

export async function publicOauth(db: Database) {
  const settings = await readOauth(db)
  if (!settings.enabled) return { enabled: false, buttonText: settings.buttonText, autoLaunch: false, endSessionEndpoint: '', clientId: '' }
  return {
    enabled: true,
    buttonText: settings.buttonText,
    autoLaunch: settings.autoLaunch,
    endSessionEndpoint: settings.endSessionEndpoint,
    clientId: settings.clientId,
  }
}

export async function unlinkOauthAccounts(db: Database, userId: string, workspaceId: string) {
  await requireManager(db, userId, workspaceId)
  const removed = await db.delete(oauthAccounts).returning({ id: oauthAccounts.id })
  return { removed: removed.length }
}

export async function beginOauth(db: Database, client: 'web' | 'mobile') {
  const settings = await readOauth(db)
  try {
    if (!settings.enabled) throw new AppError(404, 'OAuth sign-in is off')
    const secret = await readSecret(db, secretKey)
    assertReady(settings, secret)
    const discovery = await discover(settings)
    const state = randomBytes(24).toString('base64url')
    const nonce = randomBytes(24).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const redirectUri = client === 'mobile' && settings.mobileRedirectOverride ? settings.mobileRedirectUri : callbackUrl(settings)
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()))
    await db.insert(oauthStates).values({ state, nonce, verifier, redirectUri, expiresAt: new Date(Date.now() + 10 * 60 * 1000) })
    const url = new URL(discovery.authorization_endpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', settings.clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', settings.scope)
    url.searchParams.set('state', state)
    url.searchParams.set('nonce', nonce)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    if (settings.prompt) url.searchParams.set('prompt', settings.prompt)
    return url.toString()
  } catch (error) {
    return failureRedirect(settings, error)
  }
}

export async function finishOauth(db: Database, input: { code: string; state: string; error: string }) {
  const settings = await readOauth(db)
  try {
    if (!settings.enabled) throw new AppError(404, 'OAuth sign-in is off')
    if (input.error) throw new AppError(400, 'The identity provider declined the sign-in')
    if (!input.code || !input.state) throw new AppError(400, 'The sign-in response was incomplete')
    const [saved] = await db.select().from(oauthStates).where(eq(oauthStates.state, input.state)).limit(1)
    if (saved) await db.delete(oauthStates).where(eq(oauthStates.state, saved.state))
    if (!saved || saved.expiresAt.getTime() < Date.now()) throw new AppError(400, 'This sign-in attempt expired. Try again.')
    const secret = await readSecret(db, secretKey)
    const discovery = await discover(settings)
    const tokens = await exchangeCode(settings, discovery, secret, input.code, saved.redirectUri, saved.verifier)
    const claims = await verifySignedJwt(tokens.idToken, {
      alg: settings.idTokenSignedResponseAlg,
      issuer: discovery.issuer,
      audience: settings.clientId,
      nonce: saved.nonce,
      jwks: discoveryCache.get(cacheKey(settings))?.jwks ?? [],
      secret,
    })
    const profile = await identityProfile(settings, discovery, secret, tokens.accessToken, claims)
    const user = await linkAccount(db, settings, discovery.issuer, profile)
    const session = await openSession(db, user.id)
    const code = randomBytes(24).toString('base64url')
    const sealed = encryptExchange(session.token)
    await db.delete(oauthExchanges).where(lt(oauthExchanges.expiresAt, new Date()))
    await db.insert(oauthExchanges).values({ codeHash: hashToken(code), ...sealed, expiresAt: new Date(Date.now() + 2 * 60 * 1000) })
    return `${settings.appUrl}/sign-in?oauth=${encodeURIComponent(code)}`
  } catch (error) {
    return failureRedirect(settings, error)
  }
}

export async function exchangeOauthCode(db: Database, code: string) {
  const [row] = await db.select().from(oauthExchanges).where(eq(oauthExchanges.codeHash, hashToken(code))).limit(1)
  if (!row || row.expiresAt.getTime() < Date.now()) throw new AppError(400, 'This sign-in link expired. Try again.')
  await db.delete(oauthExchanges).where(eq(oauthExchanges.codeHash, row.codeHash))
  const token = decryptExchange(row)
  const user = await userForSession(db, token)
  if (!user) throw new AppError(400, 'This sign-in link expired. Try again.')
  return { token, user }
}

export async function verifySignedJwt(
  token: string,
  options: { alg: string; issuer: string; audience: string; nonce?: string; jwks: JsonWebKey[]; secret?: string },
) {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new AppError(400, 'The identity token was not valid')
  const header = parseJson<JwtHeader>(parts[0])
  const claims = parseJson<Record<string, unknown>>(parts[1])
  if (!header || !claims) throw new AppError(400, 'The identity token was not valid')
  if (!header.alg || header.alg === 'none' || header.alg !== options.alg) throw new AppError(400, 'The identity token used an unexpected signature')
  const signed = `${parts[0]}.${parts[1]}`
  const signature = Buffer.from(parts[2], 'base64url')
  if (header.alg === 'HS256') {
    if (!options.secret) throw new AppError(400, 'The identity token could not be verified')
    const expected = createHmac('sha256', options.secret).update(signed).digest()
    if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) throw new AppError(400, 'The identity token could not be verified')
  } else {
    const jwk = options.jwks.find((key) => key.kty && (!header.kid || key.kid === header.kid) && (!key.alg || key.alg === header.alg))
    if (!jwk) throw new AppError(400, 'The identity token could not be verified')
    const key = createPublicKey({ key: jwk as never, format: 'jwk' })
    const verifier = createVerify(header.alg === 'RS256' ? 'RSA-SHA256' : 'SHA256')
    verifier.update(signed)
    const der = header.alg === 'ES256' ? rawToDer(signature) : signature
    if (!verifier.verify(key, der)) throw new AppError(400, 'The identity token could not be verified')
  }
  const now = Math.floor(Date.now() / 1000)
  if (typeof claims.exp === 'number' && claims.exp < now - 60) throw new AppError(400, 'The identity token expired')
  if (typeof claims.nbf === 'number' && claims.nbf > now + 60) throw new AppError(400, 'The identity token is not valid yet')
  if (normalizeIssuer(String(claims.iss ?? '')) !== normalizeIssuer(options.issuer)) throw new AppError(400, 'The identity token came from an unexpected issuer')
  const audience = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud ?? '')]
  if (!audience.includes(options.audience)) throw new AppError(400, 'The identity token was issued for a different application')
  if (options.nonce && claims.nonce !== options.nonce) throw new AppError(400, 'The identity token could not be verified')
  return claims
}

function present(settings: OauthSettings, secret: string) {
  return { ...settings, clientSecret: secret ? savedSecret : '', redirectUri: callbackUrl(settings) }
}

async function readOauth(db: Database) {
  return readSettings(db, settingKey, defaults)
}

function callbackUrl(settings: OauthSettings) {
  return `${settings.publicUrl}/api/auth/oauth/callback`
}

function assertReady(settings: OauthSettings, secret: string) {
  if (!settings.enabled) return
  assertHttpUrl(settings.issuerUrl, settings.allowInsecureRequests, 'Enter an https issuer URL')
  if (!settings.clientId) throw new AppError(400, 'Enter a client ID')
  if (!settings.scope.split(/\s+/).includes('openid')) throw new AppError(400, 'Scope must include openid')
  if (settings.tokenEndpointAuthMethod !== 'none' && !secret) throw new AppError(400, 'Enter a client secret, or choose none for a public client')
  assertHttpUrl(settings.appUrl, true, 'Enter the Rolodex URL')
  assertHttpUrl(settings.publicUrl, true, 'Enter the public API URL')
  if (settings.endSessionEndpoint) assertHttpUrl(settings.endSessionEndpoint, settings.allowInsecureRequests, 'Enter an https end session endpoint')
  if (settings.accountManagementUrl) assertHttpUrl(settings.accountManagementUrl, true, 'Enter an account management URL')
  if (settings.mobileRedirectOverride && !settings.mobileRedirectUri) throw new AppError(400, 'Enter a mobile redirect URI')
}

function assertHttpUrl(value: string, allowHttp: boolean, message: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError(400, message)
  }
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && allowHttp) return
  throw new AppError(400, message)
}

async function discover(settings: OauthSettings) {
  const key = cacheKey(settings)
  const cached = discoveryCache.get(key)
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.value
  const response = await requestText(`${settings.issuerUrl}/.well-known/openid-configuration`, {
    method: 'GET',
    timeoutMs: settings.requestTimeoutMs,
    insecure: settings.allowInsecureRequests,
  })
  if (response.status >= 400) throw new AppError(502, 'The issuer did not return a discovery document')
  const document = parseBody<Discovery>(response.text)
  if (!document?.authorization_endpoint || !document.token_endpoint || !document.jwks_uri || !document.issuer) {
    throw new AppError(502, 'The issuer discovery document is missing sign-in endpoints')
  }
  const keys = await requestText(document.jwks_uri, { method: 'GET', timeoutMs: settings.requestTimeoutMs, insecure: settings.allowInsecureRequests })
  const jwks = parseBody<{ keys?: JsonWebKey[] }>(keys.text)
  discoveryCache.set(key, { at: Date.now(), value: document, jwks: jwks?.keys ?? [] })
  return document
}

function cacheKey(settings: OauthSettings) {
  return `${settings.issuerUrl}|${settings.allowInsecureRequests ? 'insecure' : 'secure'}`
}

async function exchangeCode(settings: OauthSettings, discovery: Discovery, secret: string, code: string, redirectUri: string, verifier: string) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  if (settings.tokenEndpointAuthMethod === 'client_secret_basic') {
    headers.Authorization = `Basic ${Buffer.from(`${settings.clientId}:${secret}`).toString('base64')}`
  } else {
    body.set('client_id', settings.clientId)
    if (settings.tokenEndpointAuthMethod === 'client_secret_post') body.set('client_secret', secret)
  }
  const response = await requestText(discovery.token_endpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
    timeoutMs: settings.requestTimeoutMs,
    insecure: settings.allowInsecureRequests,
  })
  if (response.status >= 400) throw new AppError(502, 'The identity provider rejected the sign-in')
  const parsed = parseBody<{ id_token?: string; access_token?: string }>(response.text)
  if (!parsed?.id_token) throw new AppError(502, 'The identity provider did not return an ID token')
  return { idToken: parsed.id_token, accessToken: parsed.access_token ?? '' }
}

async function identityProfile(settings: OauthSettings, discovery: Discovery, secret: string, accessToken: string, claims: Record<string, unknown>) {
  let source = claims
  const name = stringClaim(claims, settings.nameClaim) || stringClaim(claims, 'name')
  if ((!stringClaim(claims, 'email') || !name) && accessToken && discovery.userinfo_endpoint) {
    const response = await requestText(discovery.userinfo_endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      timeoutMs: settings.requestTimeoutMs,
      insecure: settings.allowInsecureRequests,
    })
    if (response.status < 400) {
      if (settings.userinfoSignedResponseAlg !== 'none' && response.text.split('.').length === 3) {
        source = { ...claims, ...(await verifySignedJwt(response.text, { alg: settings.userinfoSignedResponseAlg, issuer: discovery.issuer, audience: settings.clientId, jwks: discoveryCache.get(cacheKey(settings))?.jwks ?? [], secret })) }
      } else if (settings.userinfoSignedResponseAlg === 'none') {
        source = { ...claims, ...(parseBody<Record<string, unknown>>(response.text) ?? {}) }
      }
    }
  }
  const subject = stringClaim(source, 'sub')
  if (!subject) throw new AppError(400, 'The identity token did not include a subject')
  const email = stringClaim(source, 'email')
  const verified = source.email_verified
  return {
    subject,
    email,
    emailVerified: verified === true || verified === 'true' ? true : verified === false || verified === 'false' ? false : undefined,
    name: stringClaim(source, settings.nameClaim) || stringClaim(source, 'name') || stringClaim(source, 'preferred_username') || email.split('@')[0] || 'User',
    role: settings.roleClaim ? stringClaim(source, settings.roleClaim) : '',
  }
}

async function linkAccount(
  db: Database,
  settings: OauthSettings,
  issuer: string,
  profile: { subject: string; email: string; emailVerified: boolean | undefined; name: string; role: string },
) {
  const normalizedIssuer = normalizeIssuer(issuer)
  const [linked] = await db
    .select()
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.issuer, normalizedIssuer), eq(oauthAccounts.subject, profile.subject)))
    .limit(1)
  if (linked) {
    await db.update(oauthAccounts).set({ email: profile.email || null, role: profile.role || null }).where(eq(oauthAccounts.id, linked.id))
    return { id: linked.userId }
  }
  if (!profile.email) throw new AppError(400, 'The identity provider did not share an email address')
  const email = normalizeEmail(profile.email)
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (existing && profile.emailVerified !== true) throw new AppError(400, 'The identity provider did not confirm this email, so it was not linked')
  if (!existing && !settings.autoRegister) throw new AppError(403, 'This account is not registered')
  if (!existing && profile.emailVerified === false) throw new AppError(400, 'The identity provider did not confirm this email')
  const invite = existing ? null : await pendingInvite(db, email)
  if (!existing && (await registrationPolicy(db)).inviteOnly && !invite) throw new AppError(403, 'Registration requires an invitation')
  const user = existing ?? (await createOauthUser(db, email, profile.name))
  if (invite) await consumeInvite(db, invite.id, user.id)
  await db.insert(oauthAccounts).values({ userId: user.id, issuer: normalizedIssuer, subject: profile.subject, email, role: profile.role || null })
  return { id: user.id }
}

function encryptExchange(token: string) {
  return encryptSecret(token, credentialsKey())
}

function decryptExchange(row: { ciphertext: string; nonce: string }) {
  return decryptSecret(row, credentialsKey())
}

function failureRedirect(settings: OauthSettings, error: unknown) {
  const app = (settings.appUrl || defaults.appUrl).replace(/\/$/, '')
  const message = error instanceof AppError ? error.message : 'Could not sign in with OAuth'
  return `${app}/sign-in?oauthError=${encodeURIComponent(message)}`
}

function stringClaim(claims: Record<string, unknown>, name: string) {
  if (!name) return ''
  const value = claims[name]
  return typeof value === 'string' ? value : ''
}

function normalizeIssuer(value: string) {
  return value.replace(/\/$/, '')
}

type JwtHeader = { alg?: string; kid?: string }

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

function parseBody<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function rawToDer(raw: Buffer) {
  if (raw.length !== 64) throw new AppError(400, 'The identity token could not be verified')
  const integer = (bytes: Buffer) => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1
    const body = bytes[start]! & 0x80 ? Buffer.concat([Buffer.from([0]), bytes.subarray(start)]) : bytes.subarray(start)
    return Buffer.concat([Buffer.from([0x02, body.length]), body])
  }
  const body = Buffer.concat([integer(raw.subarray(0, 32)), integer(raw.subarray(32))])
  return Buffer.concat([Buffer.from([0x30, body.length]), body])
}

function requestText(url: string, options: { method: string; headers?: Record<string, string>; body?: string; timeoutMs: number; insecure: boolean }) {
  const parsed = new URL(url)
  const secure = parsed.protocol === 'https:'
  if (!secure && !options.insecure) return Promise.reject(new AppError(400, 'Use an https issuer, or turn on insecure requests'))
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = (secure ? httpsRequest : httpRequest)(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (secure ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method,
        headers: options.headers,
        rejectUnauthorized: !options.insecure,
        timeout: options.timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    request.on('error', () => reject(new AppError(502, 'Could not reach the identity provider')))
    request.on('timeout', () => {
      request.destroy()
      reject(new AppError(504, 'The identity provider timed out'))
    })
    if (options.body) request.write(options.body)
    request.end()
  })
}
