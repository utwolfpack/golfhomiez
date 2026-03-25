import net from 'net'
import tls from 'tls'

export function resolveMailConfig(env = process.env) {
  const brevoApiKey = String(env.BREVO_API_KEY || '').trim()
  const smtpHost = String(env.SMTP_HOST || env.BREVO_SMTP_HOST || '').trim()
  const smtpPort = Number(env.SMTP_PORT || env.BREVO_SMTP_PORT || 0)
  const smtpUser = String(env.SMTP_USER || env.BREVO_SMTP_LOGIN || '').trim()
  const smtpPass = String(env.SMTP_PASS || env.BREVO_SMTP_KEY || '').trim()
  const smtpSecure = String(env.SMTP_SECURE || '').trim()
  const secure = smtpSecure ? smtpSecure === 'true' : smtpPort === 465
  const fromEmail = String(env.BREVO_SENDER_EMAIL || env.SMTP_FROM_EMAIL || '').trim()
  const fromName = String(env.BREVO_SENDER_NAME || env.SMTP_FROM_NAME || 'Golf Homiez').trim()
  const from = String(env.SMTP_FROM || (fromEmail ? `${fromName} <${fromEmail}>` : '')).trim()

  return {
    mode: brevoApiKey ? 'brevo-api' : (smtpHost && smtpPort && from ? 'smtp' : 'fallback'),
    brevoApiKey,
    host: smtpHost,
    port: smtpPort,
    secure,
    user: smtpUser,
    pass: smtpPass,
    from: from || 'Golf Homiez <no-reply@example.local>',
    clientName: String(env.SMTP_CLIENT_NAME || 'localhost').trim(),
  }
}

export function hasSmtpConfig(env = process.env) {
  return resolveMailConfig(env).mode === 'smtp'
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

export function buildMessage({ from, to, subject, text, html }) {
  const boundary = `boundary_${Date.now().toString(36)}`
  return [
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
  ].join('\r\n')
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host }, () => resolve(secureSocket))
    secureSocket.once('error', reject)
  })
}

async function connectSocket(config) {
  return new Promise((resolve, reject) => {
    const conn = config.secure
      ? tls.connect({ host: config.host, port: config.port, servername: config.host })
      : net.createConnection({ host: config.host, port: config.port })
    conn.once('error', reject)
    conn.once(config.secure ? 'secureConnect' : 'connect', () => resolve(conn))
  })
}

async function sendViaSmtp(config, { to, subject, text, html }) {
  let socket = await connectSocket(config)

  try {
    const greeting = await onceLine(socket)
    if (getCode(greeting) !== 220) throw new Error(`SMTP greeting failed: ${greeting.join(' | ')}`)

    let ehlo = await sendCommand(socket, `EHLO ${config.clientName}`, [250])
    const supportsStartTls = ehlo.some((line) => /^250[ -]STARTTLS$/i.test(line))

    if (!config.secure && supportsStartTls) {
      await sendCommand(socket, 'STARTTLS', [220])
      socket = await upgradeToTls(socket, config.host)
      ehlo = await sendCommand(socket, `EHLO ${config.clientName}`, [250])
    }

    if (config.user) {
      await sendCommand(socket, 'AUTH LOGIN', [334])
      await sendCommand(socket, toBase64(config.user), [334])
      const authReply = await sendCommand(socket, toBase64(config.pass || ''), [235, 535])
      if (getCode(authReply) === 535) {
        throw new Error('SMTP authentication failed. Check your Brevo SMTP login/key or SMTP credentials.')
      }
    }

    const envelopeFrom = config.from.match(/<([^>]+)>/)?.[1] || config.from
    await sendCommand(socket, `MAIL FROM:<${envelopeFrom}>`, [250])
    await sendCommand(socket, `RCPT TO:<${to}>`, [250, 251])
    await sendCommand(socket, 'DATA', [354])
    socket.write(`${buildMessage({ from: config.from, to, subject, text, html })}\r\n.\r\n`)
    const accepted = await onceLine(socket)
    if (getCode(accepted) !== 250) throw new Error(`SMTP DATA failed: ${accepted.join(' | ')}`)
    await sendCommand(socket, 'QUIT', [221])
    socket.end()
    return { accepted: [to], transport: 'smtp' }
  } catch (error) {
    socket.destroy()
    throw error
  }
}

async function sendViaBrevoApi(config, { to, subject, text, html }) {
  const senderEmail = config.from.match(/<([^>]+)>/)?.[1] || config.from
  const senderName = config.from.match(/^([^<]+)</)?.[1]?.trim() || 'Golf Homiez'

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'api-key': config.brevoApiKey,
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to }],
      subject,
      textContent: text || '',
      htmlContent: html || `<pre>${text || ''}</pre>`,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Brevo API send failed (${response.status}): ${body}`)
  }

  return { accepted: [to], transport: 'brevo-api' }
}

export async function sendMail(message) {
  const config = resolveMailConfig(process.env)

  if (config.mode === 'brevo-api') return sendViaBrevoApi(config, message)
  if (config.mode === 'smtp') return sendViaSmtp(config, message)

  console.log(`[mail:dev-fallback] to=${message.to} subject=${message.subject}\n${message.text}\n`)
  return { accepted: [message.to], fallback: true, transport: 'console' }
}
