'use strict'
// email.js — email sending adapter seam.
//
// EMAIL_PROVIDER: smtp (default) | acs | none
//   smtp: EMAIL_SMTP_HOST, EMAIL_SMTP_PORT (587), EMAIL_SMTP_SECURE (false),
//         EMAIL_SMTP_USER, EMAIL_SMTP_PASS, EMAIL_FROM
//   acs:  AZURE_ACS_CONNECTION_STRING, EMAIL_FROM  (requires @azure/communication-email)
//   none: dev/CI mode — does NOT send; returns true silently (no code is logged)
//
// OTP codes are NEVER written to stdout, stderr, App Insights, or any log stream.
// Do not add any logging that includes the code parameter.

const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase()
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@prodhub.local'

async function sendOtp(to, code) {
  const subject = 'Your Product Hub sign-in code'
  const text = `Your one-time sign-in code is: ${code}\n\nThis code expires in 10 minutes. Do not share it.`
  const html = `<p>Your one-time sign-in code is:</p>
<p style="font-size:2em;letter-spacing:.25em;font-weight:700;font-family:monospace">${code}</p>
<p>This code expires in 10 minutes. Do not share it with anyone.</p>`

  if (EMAIL_PROVIDER === 'none') return true   // dev/CI: swallow silently, code is not logged
  if (EMAIL_PROVIDER === 'smtp') return _sendSmtp(to, subject, text, html)
  if (EMAIL_PROVIDER === 'acs')  return _sendAcs(to, subject, text, html)
  throw new Error(`[email] Unknown EMAIL_PROVIDER "${EMAIL_PROVIDER}". Set to smtp, acs, or none.`)
}

async function _sendSmtp(to, subject, text, html) {
  let nodemailer
  try { nodemailer = require('nodemailer') } catch {
    throw new Error('[email] nodemailer is required for SMTP. Run: pnpm --filter prodhub-azure-host add nodemailer')
  }
  const transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_SMTP_HOST,
    port:   parseInt(process.env.EMAIL_SMTP_PORT || '587', 10),
    secure: process.env.EMAIL_SMTP_SECURE === 'true',
    auth:   process.env.EMAIL_SMTP_USER
      ? { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASS }
      : undefined,
  })
  await transporter.sendMail({ from: EMAIL_FROM, to, subject, text, html })
  return true
}

async function _sendAcs(to, subject, text, html) {
  let EmailClient
  try { ({ EmailClient } = require('@azure/communication-email')) } catch {
    throw new Error('[email] @azure/communication-email is required for ACS. Run: pnpm --filter prodhub-azure-host add @azure/communication-email')
  }
  const conn = process.env.AZURE_ACS_CONNECTION_STRING
  if (!conn) throw new Error('[email] AZURE_ACS_CONNECTION_STRING is required for ACS provider')
  const client = new EmailClient(conn)
  const poller = await client.beginSend({
    senderAddress: EMAIL_FROM,
    recipients: { to: [{ address: to }] },
    content: { subject, plainText: text, html },
  })
  await poller.pollUntilDone()
  return true
}

module.exports = { sendOtp }
