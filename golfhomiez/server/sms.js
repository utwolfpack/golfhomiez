function hasTwilioConfig() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
}

export async function sendSms({ to, body }) {
  if (!hasTwilioConfig()) {
    console.log(`[sms:dev-fallback] to=${to} body=${body}`)
    return { sid: 'dev-fallback', status: 'logged' }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio SMS failed (${res.status}): ${text}`)
  }

  return res.json()
}
