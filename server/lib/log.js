'use strict'
// log.js -- minimal structured JSON logger for server/lib/*.
//
// Outputs newline-delimited JSON to stdout (info/debug) or stderr (warn/error)
// so Azure App Insights / Log Analytics can parse them as structured records.
//
// RISK-015 foundation: this replaces ad-hoc console.log/warn calls for key
// security events. Full OpenTelemetry + App Insights SDK migration is REQ-12g (S3).
//
// Usage:
//   const log = require('./log')
//   log.info('auth', 'user signed in', { uid, tenantId })
//   log.warn('auth', 'rate limit hit', { ip, endpoint })
//   log.error('ai', 'upstream error', { status, detail })

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 }
const currentLevel = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 2

function emit(level, tag, msg, meta) {
  if ((LEVELS[level] ?? 2) > currentLevel) return
  const line = JSON.stringify({ ts: new Date().toISOString(), level, tag, msg, ...(meta || {}) })
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

module.exports = {
  error: (tag, msg, meta) => emit('error', tag, msg, meta),
  warn:  (tag, msg, meta) => emit('warn',  tag, msg, meta),
  info:  (tag, msg, meta) => emit('info',  tag, msg, meta),
  debug: (tag, msg, meta) => emit('debug', tag, msg, meta),
}
