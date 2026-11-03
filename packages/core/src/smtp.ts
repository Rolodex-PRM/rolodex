import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { AppError } from './errors'

export type SmtpConfig = {
  host: string
  port: number
  username: string
  password: string
  secure: boolean
  ignoreCertificateErrors: boolean
}

export function mailboxAddress(value: string) {
  const trimmed = value.trim()
  const wrapped = trimmed.match(/<([^>]+)>/)
  const email = (wrapped?.[1] ?? trimmed).trim()
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new AppError(400, 'Enter an email address like Name <you@example.com>')
  return email
}

export function formatData(message: { from: string; to: string; subject: string; text: string }) {
  const lines = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    message.text,
  ]
  return lines
    .join('\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n')
}

export async function sendSmtp(config: SmtpConfig, message: { from: string; to: string; subject: string; text: string }) {
  const from = mailboxAddress(message.from)
  const to = mailboxAddress(message.to)
  let socket: Socket = config.secure
    ? tlsConnect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: !config.ignoreCertificateErrors })
    : netConnect({ host: config.host, port: config.port })
  socket.setTimeout(20_000)
  let session = createReader(socket)
  try {
    await waitForConnect(socket)
    await session.expect(220)
    let greeting = await session.command(`EHLO rolodex`)
    if (!config.secure && greeting.lines.some((line) => line.toUpperCase().includes('STARTTLS'))) {
      await session.command('STARTTLS')
      socket.removeAllListeners('data')
      socket = tlsConnect({ socket, servername: config.host, rejectUnauthorized: !config.ignoreCertificateErrors })
      session = createReader(socket)
      await waitForConnect(socket)
      greeting = await session.command('EHLO rolodex')
    }
    if (config.username) {
      await session.command('AUTH LOGIN')
      await session.command(Buffer.from(config.username).toString('base64'))
      await session.command(Buffer.from(config.password).toString('base64'))
    }
    await session.command(`MAIL FROM:<${from}>`)
    await session.command(`RCPT TO:<${to}>`)
    await session.command('DATA')
    socket.write(`${formatData({ ...message, from: message.from, to: message.to })}\r\n.\r\n`)
    await session.expect(250)
    await session.command('QUIT')
  } catch (error) {
    socket.destroy()
    if (error instanceof AppError) throw error
    const text = error instanceof Error ? error.message : 'Mail delivery failed'
    throw new AppError(502, text.startsWith('4') || text.startsWith('5') ? `The mail server refused the message` : 'Could not reach the mail server')
  } finally {
    socket.end()
  }
}

function waitForConnect(socket: Socket) {
  return new Promise<void>((resolve, reject) => {
    if (!socket.connecting) {
      resolve()
      return
    }
    const fail = (error: Error) => reject(error)
    socket.once('secureConnect', () => resolve())
    socket.once('connect', () => {
      if ((socket as Socket & { encrypted?: boolean }).encrypted === undefined) resolve()
    })
    socket.once('error', fail)
    socket.once('timeout', () => reject(new Error('The mail server did not respond')))
  })
}

function createReader(socket: Socket) {
  let buffer = ''
  const waiters: Array<(line: string) => void> = []
  const onData = (chunk: Buffer | string) => {
    buffer += chunk.toString()
    pump()
  }
  socket.on('data', onData)
  function pump() {
    let index = buffer.indexOf('\n')
    while (index >= 0 && waiters.length) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      waiters.shift()?.(line)
      index = buffer.indexOf('\n')
    }
  }
  function readLine() {
    const pending = buffer.indexOf('\n')
    if (pending >= 0 && waiters.length === 0) {
      const line = buffer.slice(0, pending).replace(/\r$/, '')
      buffer = buffer.slice(pending + 1)
      return Promise.resolve(line)
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The mail server did not respond')), 20_000)
      waiters.push((line) => {
        clearTimeout(timer)
        resolve(line)
      })
      pump()
    })
  }
  async function readReply() {
    const lines: string[] = []
    for (;;) {
      const line = await readLine()
      lines.push(line)
      if (line.length < 4 || line[3] === ' ') break
    }
    return { code: Number(lines[0]?.slice(0, 3)), lines }
  }
  async function expect(code: number) {
    const reply = await readReply()
    if (reply.code !== code) throw new Error(reply.lines.join(' '))
    return reply
  }
  async function command(text: string) {
    socket.write(`${text}\r\n`)
    const reply = await readReply()
    if (reply.code >= 400) throw new Error(reply.lines.join(' '))
    return reply
  }
  return { expect, command }
}
