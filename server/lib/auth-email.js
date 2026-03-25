import { setLatestPasswordReset } from '../auth-debug.js'

export function buildResetPasswordEmail({ user, url }) {
  const safeName = user?.name ? String(user.name).trim() : 'there'
  const emailText = [
    `Hi ${safeName},`,
    '',
    'Use the link below to reset your Golf Homiez password:',
    url,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n')

  const emailHtml = `
    <div>
      <p>Hi ${safeName},</p>
      <p>Use the link below to reset your Golf Homiez password:</p>
      <p><a href="${url}">${url}</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `.trim()

  return {
    subject: 'Reset your Golf Homiez password',
    text: emailText,
    html: emailHtml,
  }
}

export function buildVerificationEmail({ user, url }) {
  const safeName = user?.name ? String(user.name).trim() : 'there'
  const emailText = [
    `Hi ${safeName},`,
    '',
    'Welcome to Golf Homiez.',
    'Use the link below to verify your email address:',
    url,
  ].join('\n')

  const emailHtml = `
    <div>
      <p>Hi ${safeName},</p>
      <p>Welcome to Golf Homiez.</p>
      <p>Use the link below to verify your email address:</p>
      <p><a href="${url}">${url}</a></p>
    </div>
  `.trim()

  return {
    subject: 'Verify your Golf Homiez email',
    text: emailText,
    html: emailHtml,
  }
}

export async function sendResetPasswordEmail({ sendMail, user, url, token, expiresAt }) {
  setLatestPasswordReset({
    email: user.email,
    token,
    url,
    expiresAt: expiresAt || null,
  })

  const message = buildResetPasswordEmail({ user, url })
  return sendMail({ to: user.email, ...message })
}

export async function sendVerificationEmail({ sendMail, user, url }) {
  const message = buildVerificationEmail({ user, url })
  return sendMail({ to: user.email, ...message })
}
