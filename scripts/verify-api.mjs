// Live API/SSE verification against the DEPLOYED functions (not localhost).
// Checks f (grounded chat SSE + honest no-data), j (VIEWER write rejected server-side),
// k (share link public render + no leak), m (graceful malformed/unauth failures).
const API_KEY = 'AIzaSyCoqf7-ty_z-0VI6EDGs56MHy-RH_5giN8' // public web config key (safe)
const FN = 'https://us-central1-productreinvention.cloudfunctions.net'
const PREVIEW = process.env.PREVIEW_URL
const results = []
const rec = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id} — ${detail}`) }

async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })
  const j = await r.json()
  if (!j.idToken) throw new Error('signin failed: ' + JSON.stringify(j))
  return j.idToken
}

async function chatSSE(token, content) {
  const r = await fetch(`${FN}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: [{ role: 'user', content }] }) })
  let text = '', tools = 0, errors = []; const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
  while (true) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true })
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2)
      if (!line.startsWith('data:')) continue
      try { const ev = JSON.parse(line.slice(5).trim()); if (ev.t === 'token') text += ev.v; else if (ev.t === 'tool') tools++; else if (ev.t === 'error') errors.push(ev.message) } catch { /* */ } } }
  return { status: r.status, text, tools, errors }
}

const CITE = /\[(HO[\s.][A-Z0-9][A-Z0-9.\s]*?)\]/

async function main() {
  const admin = await signIn('admin@productfactory.app', 'admin123')

  // ── f: grounded chat ──
  try {
    const g = await chatSSE(admin, 'Trace the premium for the default HO-3 worked example and name which rating tables feed steps 1-3. Cite refIds.')
    const cited = CITE.exec(g.text)
    rec('f-grounded', g.status === 200 && g.text.length > 40 && !!cited && g.errors.length === 0,
      `status=${g.status} tools=${g.tools} chars=${g.text.length} cite=${cited ? cited[1] : 'NONE'} err=${g.errors.join('|') || 'none'}`)
  } catch (e) { rec('f-grounded', false, 'threw: ' + e.message) }

  // ── f: ungroundable → honest ──
  try {
    const u = await chatSSE(admin, 'What is our commercial cyber-liability breach premium for policies written in Japan?')
    const honest = /\b(no|not|don't|cannot|couldn't|unable|isn't|no data|no such|not find|no information)\b/i.test(u.text)
    const invented = /\$\s?\d{2,}|premium is \$|HO\.CYBER|CYBER\.\d/.test(u.text)
    rec('f-nodata', u.status === 200 && honest && !invented, `honest=${honest} invented=${invented} sample="${u.text.slice(0, 90).replace(/\n/g, ' ')}"`)
  } catch (e) { rec('f-nodata', false, 'threw: ' + e.message) }

  // ── j: VIEWER write rejected server-side (Firestore rules) — target ZZTEST doc for safety ──
  try {
    const viewer = await signIn('viewer@productfactory.app', 'viewer123')
    const url = `https://firestore.googleapis.com/v1/projects/productreinvention/databases/(default)/documents/products/ZZTEST-PROD-001?updateMask.fieldPaths=description&key=${API_KEY}`
    const r = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${viewer}` }, body: JSON.stringify({ fields: { description: { stringValue: 'viewer-should-not-write' } } }) })
    rec('j-role', r.status === 403, `VIEWER PATCH status=${r.status} (expect 403 PERMISSION_DENIED)`)
  } catch (e) { rec('j-role', false, 'threw: ' + e.message) }

  // ── k: share link → public render, no private leak (share the ZZTEST product) ──
  try {
    const r = await fetch(`${FN}/createShareLink`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` }, body: JSON.stringify({ data: { productId: 'ZZTEST-PROD-001' } }) })
    const j = await r.json()
    const token = j?.result?.token
    if (!token) { rec('k-share', false, 'createShareLink returned ' + JSON.stringify(j).slice(0, 120)); }
    else {
      const pub = await fetch(`${PREVIEW}/share/${token}`)
      const html = await pub.text()
      const renders = pub.status === 200 && /ZZTEST/.test(html)
      const leaks = /admin@productfactory|viewer123|editor123|sk-ant|password|customClaims|rev":/i.test(html)
      rec('k-share', renders && !leaks, `pub status=${pub.status} rendersProduct=${renders} leaks=${leaks} token=${token.slice(0, 8)}…`)
      globalThis.__shareToken = token
    }
  } catch (e) { rec('k-share', false, 'threw: ' + e.message) }

  // ── m: resilience — malformed (empty messages) + unauthenticated ──
  try {
    const empty = await chatSSE(admin, '')  // trims to empty → server should send a graceful error event
    const gracefulEmpty = empty.status === 200 && empty.errors.some(m => /no message/i.test(m)) && !/\n\s*at\s|sk-ant/i.test(JSON.stringify(empty))
    const noAuth = await fetch(`${FN}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) })
    const noAuthBody = await noAuth.text()
    const gracefulAuth = noAuth.status === 401 && !/\bat\s.+:\d+:\d+|sk-ant/i.test(noAuthBody)
    rec('m-resilience', gracefulEmpty && gracefulAuth, `emptyGraceful=${gracefulEmpty}(err="${empty.errors.join('|')}") noauth=${noAuth.status} noauthGraceful=${gracefulAuth}`)
  } catch (e) { rec('m-resilience', false, 'threw: ' + e.message) }

  console.log('\n=== API SUMMARY ===')
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}`)
  console.log(JSON.stringify({ shareToken: globalThis.__shareToken ?? null }))
}
main().catch(e => { console.error('verify-api crashed:', e); process.exit(1) })
