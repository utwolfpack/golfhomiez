import net from 'net'
import tls from 'tls'

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM)
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

export async function sendMail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || 'Golf Homiez <no-reply@example.local>'

  if (!hasSmtpConfig()) {
    console.log(`[mail:dev-fallback] to=${to} subject=${subject}\n${text}\n`)
    return { accepted: [to], fallback: true }
  }

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 465)
  const secure = String(process.env.SMTP_SECURE || 'true') === 'true'

  const socket = await new Promise((resolve, reject) => {
    const conn = secure
      ? tls.connect({ host, port, servername: host })
      : net.createConnection({ host, port })
    conn.once('error', reject)
    conn.once('connect', () => resolve(conn))
    if (secure) conn.once('secureConnect', () => resolve(conn))
  })

  try {
    const greeting = await onceLine(socket)
    if (getCode(greeting) !== 220) throw new Error(`SMTP greeting failed: ${greeting.join(' | ')}`)
    await sendCommand(socket, `EHLO ${process.env.SMTP_CLIENT_NAME || 'localhost'}`, [250])

    if (process.env.SMTP_USER) {
      await sendCommand(socket, 'AUTH LOGIN', [334])
      await sendCommand(socket, toBase64(process.env.SMTP_USER), [334])
      await sendCommand(socket, toBase64(process.env.SMTP_PASS || ''), [235])
    }

    const envelopeFrom = from.match(/<([^>]+)>/)?.[1] || from
    await sendCommand(socket, `MAIL FROM:<${envelopeFrom}>`, [250])
    await sendCommand(socket, `RCPT TO:<${to}>`, [250, 251])
    await sendCommand(socket, 'DATA', [354])
    socket.write(`${buildMessage({ from, to, subject, text, html })}\r\n.\r\n`)
    const accepted = await onceLine(socket)
    if (getCode(accepted) !== 250) throw new Error(`SMTP DATA failed: ${accepted.join(' | ')}`)
    await sendCommand(socket, 'QUIT', [221])
    socket.end()
    return { accepted: [to] }
  } catch (error) {
    socket.destroy()
    throw error
  }
}
