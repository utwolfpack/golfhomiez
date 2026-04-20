import { logSmtp, getCorrelationId } from './lib/logger.js'
import net from 'net'
import tls from 'tls'

function getBrevoApiKey() {
  return process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY || ''
}

function getSmtpConfig() {
  const from =
    process.env.SMTP_FROM ||
    (process.env.BREVO_SENDER_EMAIL
      ? `${process.env.BREVO_SENDER_NAME || 'Golf Homiez'} <${process.env.BREVO_SENDER_EMAIL}>`
      : '')

  return {
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    user: process.env.SMTP_USER || process.env.BREVO_SMTP_LOGIN || '',
    pass: process.env.SMTP_PASS || process.env.BREVO_SMTP_KEY || '',
    from,
    clientName: process.env.SMTP_CLIENT_NAME || 'localhost',
  }
}

function hasSmtpConfig(config = getSmtpConfig()) {
  return Boolean(config.host && config.port && config.from)
}

function onceLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/).filter(Boolean)
      const last = lines[lines.length - 1] || ''
      if (/^\d{3} /.test(last)) {
        cleanup()
        resolve(lines)
      }
    }
    const onError = (err) => {
      cleanup()
      reject(err)
    }
    const onClose = () => {
      cleanup()
      reject(new Error('SMTP connection closed unexpectedly'))
    }
    const cleanup = () => {
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    socket.on('data', onData)
    socket.on('error', onError)
    socket.on('close', onClose)
  })
}

function getCode(lines) {
  const last = lines[lines.length - 1] || ''
  return Number(last.slice(0, 3))
}

async function sendCommand(socket, command, expected = []) {
  socket.write(`${command}\r\n`)
  const lines = await onceLine(socket)
  const code = getCode(lines)
  if (expected.length && !expected.includes(code)) {
    throw new Error(`SMTP ${command.split(' ')[0]} failed: ${lines.join(' | ')}`)
  }
  return lines
}

function toBase64(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64')
}

function buildMessage({ from, to, subject, text, html }) {
  const boundary = `boundary_${Date.now().toString(36)}`
  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text || '',
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html || `<pre>${text || ''}</pre>`,
    '',
    `--${boundary}--`,
    '',
  ]
  return parts.join('\r\n')
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host }, () => resolve(secureSocket))
    secureSocket.once('error', reject)
  })
}

function parseFrom(from) {
  const email = from.match(/<([^>]+)>/)?.[1] || from
  const name = from.includes('<') ? from.replace(/\s*<[^>]+>\s*$/, '').trim() : undefined
  return { email, name }
}

async function sendWithBrevoApi({ from, to, subject, text, html }) {
  const apiKey = getBrevoApiKey()
  if (!apiKey) return null

  const sender = parseFrom(from)
  const payload = {
    sender: sender.name ? sender : { email: sender.email },
    to: [{ email: to }],
    subject,
    textContent: text || '',
    htmlContent: html || `<pre>${text || ''}</pre>`,
  }

  logSmtp('smtp_api_send_started', { provider: 'brevo-api', correlationId: getCorrelationId(), sender: sender.email, to, subject })

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(payload),
  })


  if (!response.ok) {
    const body = await response.text()
    logSmtp('smtp_api_send_failed', { provider: 'brevo-api', correlationId: getCorrelationId(), to, subject, status: response.status, responseBody: body })
    throw new Error(`Brevo API send failed: ${response.status} ${body}`)
  }

  const body = await response.json().catch(() => ({}))
  logSmtp('smtp_api_send_succeeded', { provider: 'brevo-api', correlationId: getCorrelationId(), to, subject, messageId: body?.messageId || null })
  return {
    accepted: [to],
    provider: 'brevo-api',
    messageId: body?.messageId || null,
  }
}


async function sendWithSmtp({ from: overrideFrom, to, subject, text, html }) {
  const config = getSmtpConfig()
  const { host, port, secure, user, pass, from: configFrom, clientName } = config
  const from = overrideFrom || configFrom

  logSmtp('smtp_send_started', { provider: 'smtp', correlationId: getCorrelationId(), host, port, secure, from, to, subject, hasUser: Boolean(user), hasPass: Boolean(pass) })

  let socket = await new Promise((resolve, reject) => {
    const conn = secure
      ? tls.connect({ host, port, servername: host })
      : net.createConnection({ host, port })
    conn.once('error', reject)
    conn.once('connect', () => {
      if (!secure) resolve(conn)
    })
    if (secure) conn.once('secureConnect', () => resolve(conn))
  })

  try {
    const greeting = await onceLine(socket)
    if (getCode(greeting) !== 220) throw new Error(`SMTP greeting failed: ${greeting.join(' | ')}`)

    let ehlo = await sendCommand(socket, `EHLO ${clientName}`, [250])

    if (!secure) {
      const supportsStartTls = ehlo.some((line) => /STARTTLS/i.test(line))
      if (supportsStartTls) {
        await sendCommand(socket, 'STARTTLS', [220])
        socket = await upgradeToTls(socket, host)
        ehlo = await sendCommand(socket, `EHLO ${clientName}`, [250])
      }
    }

    if (user) {
      await sendCommand(socket, 'AUTH LOGIN', [334])
      await sendCommand(socket, toBase64(user), [334])
      await sendCommand(socket, toBase64(pass || ''), [235])
    }

    const envelopeFrom = parseFrom(from).email
    await sendCommand(socket, `MAIL FROM:<${envelopeFrom}>`, [250])
    await sendCommand(socket, `RCPT TO:<${to}>`, [250, 251])
    await sendCommand(socket, 'DATA', [354])
    socket.write(`${buildMessage({ from, to, subject, text, html })}\r\n.\r\n`)
    const accepted = await onceLine(socket)
    if (getCode(accepted) !== 250) throw new Error(`SMTP DATA failed: ${accepted.join(' | ')}`)
    await sendCommand(socket, 'QUIT', [221])
    socket.end()

    logSmtp('smtp_send_succeeded', { provider: 'smtp', correlationId: getCorrelationId(), host, port, secure, from, to, subject })
    return { accepted: [to], provider: 'smtp' }
  } catch (error) {
    logSmtp('smtp_send_failed', { provider: 'smtp', correlationId: getCorrelationId(), host, port, secure, from, to, subject, error })
    socket.destroy()
    throw error
  }
}

export async function sendMail({ to, subject, text, html, from: fromOverride }) {
  const smtpConfig = getSmtpConfig()
  const from = fromOverride || smtpConfig.from || 'Golf Homiez <no-reply@example.local>'
  const apiKey = getBrevoApiKey()

  if (apiKey) {
    return sendWithBrevoApi({ from, to, subject, text, html })
  }

  if (!hasSmtpConfig(smtpConfig)) {
    logSmtp('smtp_dev_fallback', { provider: 'dev-fallback', correlationId: getCorrelationId(), to, subject })
    return { accepted: [to], fallback: true }
  }

  try {
    return await sendWithSmtp({ from, to, subject, text, html })
  } catch (error) {
    if (/535\s+5\.7\.8/i.test(String(error?.message || ''))) {
      throw new Error(
        'Brevo SMTP authentication failed. Set BREVO_API_KEY to use the Brevo transactional API, or update SMTP_USER/SMTP_PASS (or BREVO_SMTP_LOGIN/BREVO_SMTP_KEY) with valid Brevo SMTP credentials.',
      )
    }
    throw error
  }
}
