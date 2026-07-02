// scripts/seed.ts — Seeds the full HO-3 dataset into Firestore.
// Default target: emulators (env vars set before admin init).
// Pass --project productreinvention to target production (typed confirmation required).
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { Auth } from 'firebase-admin/auth'
import {
  HO3_PRODUCT, HO3_COVERAGES, HO3_LD_TABLES, HO3_RT_TABLES,
  HO3_RATING_PROGRAM, HO3_FORMS, HO3_RULES, HO3_FORM_RULES,
  HO3_DICTIONARY, HO3_DEFAULT_TASK_TEMPLATES, HO3_SEED_USERS,
  HO3_SAMPLE_FEEDBACK, HO3_WORKED_EXAMPLE,
  makeHO3RtGetter, makeHO3LdGetter,
} from '../shared/src/seed/ho3'
import { evaluate } from '../shared/src/rating/evaluator'
import type { SearchEntityType } from '../shared/src/types'
import * as readline from 'readline'

// ─── Types ────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>
interface IndexEntry { type: SearchEntityType; refId?: string; title: string; subtitle: string; path: string; keywords: string[] }

// ─── CLI flag parsing ─────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const projectFlag = args[args.indexOf('--project') + 1]
const targetProd  = projectFlag === 'productreinvention'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTs(obj: Doc, now: FieldValue): Doc {
  const out = { ...obj }
  for (const k of ['createdAt', 'updatedAt', 'at']) {
    if (k in out && out[k] === null) out[k] = now
  }
  if (typeof out['health'] === 'object' && out['health'] !== null) {
    const h = out['health'] as Doc
    if (h['updatedAt'] === null) out['health'] = { ...h, updatedAt: now }
  }
  return out
}

function keywords(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(k => k.length > 2)
}

function promptConfirm(q: string, expected: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(q, answer => { rl.close(); resolve(answer.trim() === expected) })
  })
}

async function deleteAll(db: Firestore, collPath: string): Promise<void> {
  const snap = await db.collection(collPath).get()
  if (snap.empty) return
  const batch = db.batch()
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {

  // ── Target setup ──────────────────────────────────────────────────────────
  if (!targetProd) {
    // Set BEFORE initializeApp so the admin SDK connects to emulators
    process.env['FIRESTORE_EMULATOR_HOST']     = '127.0.0.1:8080'
    process.env['FIREBASE_AUTH_EMULATOR_HOST']  = '127.0.0.1:9099'
    console.log('🔌 Targeting EMULATORS (Firestore :8080, Auth :9099)')
  } else {
    const ok = await promptConfirm(
      '⚠️  Seeding PRODUCTION "productreinvention". Type "seed-production" to confirm: ',
      'seed-production',
    )
    if (!ok) { console.log('Aborted.'); process.exit(0) }
    console.log('⚡ Targeting PRODUCTION')
  }

  admin.initializeApp({ projectId: 'productreinvention' })
  const db:   Firestore = admin.firestore()
  // Ignore undefined fields in seed data (optional fields typed as foo?: X may be undefined)
  db.settings({ ignoreUndefinedProperties: true })
  const auth: Auth      = admin.auth()
  const now             = FieldValue.serverTimestamp()

  const counts: Record<string, number> = {}
  const warnings: string[] = []
  const searchEntries: { id: string; data: IndexEntry }[] = []

  const inc   = (col: string, n = 1) => { counts[col] = (counts[col] ?? 0) + n }
  const addIdx = (e: IndexEntry) => searchEntries.push({ id: e.path.replace(/\//g, '_'), data: e })

  const pid = HO3_PRODUCT.refId!

  // ── Wipe ──────────────────────────────────────────────────────────────────
  console.log('🧹 Wiping…')
  await Promise.all([
    'products', 'forms', 'ldTables', 'rtTables',
    'dictionary', 'tasks', 'feedback', 'searchIndex', 'seedReports',
  ].map(c => deleteAll(db, c)))
  for (const sub of ['coverages', 'rules', 'formRules', 'ratingPrograms']) {
    await deleteAll(db, `products/${pid}/${sub}`)
  }

  // ── Product ───────────────────────────────────────────────────────────────
  await db.doc(`products/${pid}`).set(withTs(HO3_PRODUCT as Doc, now))
  inc('products')
  addIdx({ type: 'product', refId: pid, title: HO3_PRODUCT.name,
    subtitle: `${HO3_PRODUCT.lob.name} · ${HO3_PRODUCT.marketSegment}`,
    path: `products/${pid}`,
    keywords: [...keywords(HO3_PRODUCT.name), 'homeowners', 'ho3', 'ho-3', pid.toLowerCase()],
  })

  // ── Coverages ─────────────────────────────────────────────────────────────
  for (const cov of HO3_COVERAGES) {
    const id = cov.refId!.replace(/\./g, '-')
    await db.doc(`products/${pid}/coverages/${id}`).set(withTs(cov as Doc, now))
    inc('coverages')
    addIdx({ type: 'coverage', refId: cov.refId ?? undefined, title: cov.name,
      subtitle: cov.refId ?? '', path: `products/${pid}/coverages/${id}`,
      keywords: keywords(cov.name),
    })
  }

  // ── LD Tables ─────────────────────────────────────────────────────────────
  for (const [refId, tbl] of Object.entries(HO3_LD_TABLES)) {
    await db.doc(`ldTables/${refId}`).set(tbl as Doc)
    inc('ldTables')
  }

  // ── RT Tables ─────────────────────────────────────────────────────────────
  for (const [refId, tbl] of Object.entries(HO3_RT_TABLES)) {
    await db.doc(`rtTables/${refId}`).set(tbl as Doc)
    inc('rtTables')
  }

  // ── Rating Program ────────────────────────────────────────────────────────
  const rpId = HO3_RATING_PROGRAM.refId.replace(/\./g, '-')
  await db.doc(`products/${pid}/ratingPrograms/${rpId}`)
    .set(withTs(HO3_RATING_PROGRAM as Doc, now))
  inc('ratingPrograms')

  // ── Forms ─────────────────────────────────────────────────────────────────
  for (const form of HO3_FORMS) {
    const key = form.number.replace(/\s+/g, '-')
    await db.doc(`forms/${key}`).set(withTs(form as Doc, now))
    inc('forms')
    addIdx({ type: 'form', title: form.name,
      subtitle: `${form.number} · ${form.edition}`,
      path: `forms/${key}`,
      keywords: [...keywords(form.name), ...keywords(form.number)],
    })
  }

  // ── Product Rules ─────────────────────────────────────────────────────────
  for (const rule of HO3_RULES) {
    const id = rule.refId!.replace(/\./g, '-')
    await db.doc(`products/${pid}/rules/${id}`).set(withTs(rule as Doc, now))
    inc('rules')
  }

  // ── Form Rules ────────────────────────────────────────────────────────────
  for (const fr of HO3_FORM_RULES) {
    const id = fr.refId!.replace(/\./g, '-')
    await db.doc(`products/${pid}/formRules/${id}`).set(withTs(fr as Doc, now))
    inc('formRules')
  }

  // ── Dictionary ────────────────────────────────────────────────────────────
  for (const entry of HO3_DICTIONARY) {
    const id = entry.name.toLowerCase().replace(/\s+/g, '-')
    await db.doc(`dictionary/${id}`).set(withTs(entry as Doc, now))
    inc('dictionary')
    addIdx({ type: 'dictionary', title: entry.name, subtitle: entry.type,
      path: `dictionary/${id}`, keywords: [...keywords(entry.name), ...entry.tags],
    })
  }

  // ── Default Tasks ─────────────────────────────────────────────────────────
  const base = new Date()
  for (let i = 0; i < HO3_DEFAULT_TASK_TEMPLATES.length; i++) {
    const tmpl  = HO3_DEFAULT_TASK_TEMPLATES[i]
    const dueAt = new Date(base)
    dueAt.setDate(dueAt.getDate() + tmpl.daysOffset)
    await db.collection('tasks').add({
      title: tmpl.title, column: tmpl.column,
      productId: pid, checklist: [], order: i,
      dueAt: Timestamp.fromDate(dueAt),
      status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
      updatedBy: 'seed', rev: 1, createdAt: now, updatedAt: now,
    })
    inc('tasks')
  }

  // ── Sample Feedback ───────────────────────────────────────────────────────
  for (const fb of HO3_SAMPLE_FEEDBACK) {
    await db.collection('feedback').add(withTs(fb as Doc, now))
    inc('feedback')
  }

  // ── Search Index (batched) ────────────────────────────────────────────────
  for (let i = 0; i < searchEntries.length; i += 400) {
    const batch = db.batch()
    for (const { id, data } of searchEntries.slice(i, i + 400)) {
      batch.set(db.doc(`searchIndex/${id}`), data)
    }
    await batch.commit()
  }
  inc('searchIndex', searchEntries.length)

  // ── Auth Users ────────────────────────────────────────────────────────────
  console.log('👤 Creating auth users…')
  for (const u of HO3_SEED_USERS) {
    try {
      try {
        const existing = await auth.getUserByEmail(u.email)
        await auth.deleteUser(existing.uid)
      } catch { /* not yet created */ }

      const created = await auth.createUser({ email: u.email, password: u.password, displayName: u.name })
      await auth.setCustomUserClaims(created.uid, { role: u.role })
      await db.doc(`users/${created.uid}`).set({
        email: u.email, name: u.name, role: u.role,
        active: u.active, mustChangePassword: u.mustChangePassword,
        createdAt: now,
      })
      inc('users')
      console.log(`  ✓ ${u.email} (${u.role})`)
    } catch (e) {
      const msg = `  ✗ ${u.email}: ${(e as Error).message}`
      console.warn(msg); warnings.push(msg)
    }
  }

  // ── Verify worked example → must equal $1,528 ────────────────────────────
  console.log('\n🧮 Verifying worked example…')
  const rtGetter = makeHO3RtGetter(HO3_RT_TABLES)
  const ldGetter = makeHO3LdGetter(HO3_LD_TABLES)
  const { finalPremium } = evaluate(HO3_RATING_PROGRAM, HO3_WORKED_EXAMPLE, rtGetter, ldGetter)

  if (finalPremium !== 1528) {
    warnings.push(`CRITICAL: worked example premium = ${finalPremium}, expected $1,528`)
    console.error(`  ✗ Got $${finalPremium} — expected $1,528!`)
  } else {
    console.log('  ✓ $1,528 confirmed')
  }

  // ── Seed Report ───────────────────────────────────────────────────────────
  await db.collection('seedReports').add({ counts, warnings, workedExamplePremium: finalPremium, at: now })

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete.')
  console.log('   Counts:')
  for (const [k, v] of Object.entries(counts)) console.log(`     ${k}: ${v}`)
  if (warnings.length) console.warn('\n   Warnings:', warnings)
  console.log(`\n   💰 Worked example premium: $${finalPremium.toLocaleString()}`)
}

main().catch(err => { console.error('Seed failed:', err); process.exit(1) })
