// scripts/seed.ts — Seeds the reference products (HO-3 and General Liability) into Firestore.
// Both products flow through the SAME seeding path, so audit/version/searchIndex parity
// holds for each. Default target: emulators (env vars set before admin init).
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
import {
  GL_PRODUCT, GL_COVERAGES, GL_LD_TABLES, GL_RT_TABLES,
  GL_RATING_PROGRAM, GL_FORMS, GL_RULES, GL_FORM_RULES,
  GL_DICTIONARY, GL_WORKED_EXAMPLE,
  makeGLRtGetter, makeGLLdGetter,
} from '../shared/src/seed/gl'
import { evaluate } from '../shared/src/rating/evaluator'
import type { SearchEntityType } from '../shared/src/types'
import * as readline from 'readline'

// ─── Types ────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>
interface IndexEntry { type: SearchEntityType; refId?: string; title: string; subtitle: string; path: string; keywords: string[] }

// A reference product bundle — everything one product owns (its own doc + subcollections)
// plus the global tables/forms/dictionary it contributes. Both HO-3 and GL fill this shape,
// so the seeding loop treats every line identically (no Homeowners special-casing).
interface ProductBundle {
  productKeywords: string[]
  product:       typeof HO3_PRODUCT | typeof GL_PRODUCT
  coverages:     ReadonlyArray<Doc>
  ldTables:      Record<string, Doc>
  rtTables:      Record<string, Doc>
  ratingProgram: Doc & { refId: string }
  forms:         ReadonlyArray<Doc & { number: string }>
  rules:         ReadonlyArray<Doc>
  formRules:     ReadonlyArray<Doc>
  dictionary:    ReadonlyArray<Doc & { name: string }>
}

// ─── CLI flag parsing ─────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const projectFlag = args[args.indexOf('--project') + 1]
const targetProd  = projectFlag === 'productreinvention'
// Optional: seed a single line by refId prefix (e.g. --only ho / --only gl). Omit for both.
const onlyFlag    = args.includes('--only') ? args[args.indexOf('--only') + 1]?.toLowerCase() : undefined

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

  // ── Reference product bundles (each seeded identically) ────────────────────
  let bundles: ProductBundle[] = [
    {
      productKeywords: ['homeowners', 'ho3', 'ho-3'],
      product: HO3_PRODUCT, coverages: HO3_COVERAGES,
      ldTables: HO3_LD_TABLES as Record<string, Doc>, rtTables: HO3_RT_TABLES as Record<string, Doc>,
      ratingProgram: HO3_RATING_PROGRAM as unknown as Doc & { refId: string },
      forms: HO3_FORMS, rules: HO3_RULES, formRules: HO3_FORM_RULES, dictionary: HO3_DICTIONARY,
    },
    {
      productKeywords: ['general', 'liability', 'gl', 'cgl', 'commercial'],
      product: GL_PRODUCT, coverages: GL_COVERAGES,
      ldTables: GL_LD_TABLES as Record<string, Doc>, rtTables: GL_RT_TABLES as Record<string, Doc>,
      ratingProgram: GL_RATING_PROGRAM as unknown as Doc & { refId: string },
      forms: GL_FORMS, rules: GL_RULES, formRules: GL_FORM_RULES, dictionary: GL_DICTIONARY,
    },
  ]

  // Optional single-line filter (e.g. --only ho seeds just the Homeowners bundle).
  if (onlyFlag) {
    bundles = bundles.filter(b => b.product.refId!.toLowerCase().startsWith(onlyFlag))
    if (bundles.length === 0) { console.error(`No bundle matches --only ${onlyFlag}`); process.exit(1) }
    console.log(`🎯 --only ${onlyFlag}: seeding ${bundles.map(b => b.product.refId).join(', ')}`)
  }

  // ── Wipe (idempotent re-seed to a known state) ─────────────────────────────
  console.log('🧹 Wiping…')
  await Promise.all([
    'products', 'forms', 'ldTables', 'rtTables',
    'dictionary', 'tasks', 'taskTemplates', 'feedback', 'searchIndex', 'seedReports',
  ].map(c => deleteAll(db, c)))
  for (const b of bundles) {
    const pid = b.product.refId!
    for (const sub of ['coverages', 'rules', 'formRules', 'ratingPrograms']) {
      await deleteAll(db, `products/${pid}/${sub}`)
    }
  }

  // ── Seed each product bundle through the same path ─────────────────────────
  const seededDictionary = new Set<string>()

  for (const b of bundles) {
    const pid = b.product.refId!
    console.log(`\n📦 Seeding ${pid} — ${b.product.name}`)

    // Product
    await db.doc(`products/${pid}`).set(withTs(b.product as Doc, now))
    inc('products')
    addIdx({ type: 'product', refId: pid, title: b.product.name,
      subtitle: `${b.product.lob.name} · ${b.product.marketSegment}`,
      path: `products/${pid}`,
      keywords: [...keywords(b.product.name), ...b.productKeywords, pid.toLowerCase()],
    })

    // Coverages
    for (const cov of b.coverages) {
      const refId = cov['refId'] as string
      const id = refId.replace(/\./g, '-')
      await db.doc(`products/${pid}/coverages/${id}`).set(withTs(cov, now))
      inc('coverages')
      addIdx({ type: 'coverage', refId, title: cov['name'] as string,
        subtitle: refId, path: `products/${pid}/coverages/${id}`,
        keywords: keywords(cov['name'] as string) })
    }

    // LD Tables (global collection; ids preserved verbatim)
    for (const [refId, tbl] of Object.entries(b.ldTables)) {
      await db.doc(`ldTables/${refId}`).set(tbl)
      inc('ldTables')
      addIdx({ type: 'ldTable', refId, title: tbl['name'] as string, subtitle: refId,
        path: `ldTables/${refId}`, keywords: [...keywords(tbl['name'] as string), ...keywords(refId)] })
    }

    // RT Tables (global collection; ids preserved verbatim)
    for (const [refId, tbl] of Object.entries(b.rtTables)) {
      await db.doc(`rtTables/${refId}`).set(tbl)
      inc('rtTables')
      addIdx({ type: 'rtTable', refId, title: tbl['name'] as string, subtitle: refId,
        path: `rtTables/${refId}`, keywords: [...keywords(tbl['name'] as string), ...keywords(refId)] })
    }

    // Rating Program
    const rpId = b.ratingProgram.refId.replace(/\./g, '-')
    await db.doc(`products/${pid}/ratingPrograms/${rpId}`).set(withTs(b.ratingProgram, now))
    inc('ratingPrograms')

    // Forms (global; keyed by normalized form number)
    for (const form of b.forms) {
      const key = form.number.replace(/\s+/g, '-')
      await db.doc(`forms/${key}`).set(withTs(form, now))
      inc('forms')
      // refId stores the owning product so Explorer/palette can route to the right tab.
      addIdx({ type: 'form', refId: pid, title: form['name'] as string,
        subtitle: `${form.number} · ${form['edition']}`,
        path: `forms/${key}`,
        keywords: [...keywords(form['name'] as string), ...keywords(form.number)] })
    }

    // Product Rules
    for (const rule of b.rules) {
      const id = (rule['refId'] as string).replace(/\./g, '-')
      await db.doc(`products/${pid}/rules/${id}`).set(withTs(rule, now))
      inc('rules')
    }

    // Form Rules
    for (const fr of b.formRules) {
      const id = (fr['refId'] as string).replace(/\./g, '-')
      await db.doc(`products/${pid}/formRules/${id}`).set(withTs(fr, now))
      inc('formRules')
    }

    // Dictionary (global; de-duplicated by name across bundles)
    for (const entry of b.dictionary) {
      const id = entry.name.toLowerCase().replace(/\s+/g, '-')
      if (seededDictionary.has(id)) continue
      seededDictionary.add(id)
      await db.doc(`dictionary/${id}`).set(withTs(entry, now))
      inc('dictionary')
      // refId is indexed so a cited definition (e.g. [HO.DEF.003]) resolves to this entry.
      const dictRefId = entry['refId'] as string | undefined
      addIdx({ type: 'dictionary', refId: dictRefId, title: entry.name, subtitle: dictRefId ?? (entry['type'] as string),
        path: `dictionary/${id}`,
        keywords: [...keywords(entry.name), ...(dictRefId ? keywords(dictRefId) : []), ...(entry['tags'] as string[]), ...((entry['aliases'] as string[] | undefined) ?? []).flatMap(keywords)] })
    }
  }

  // ── Default Tasks (HO-3 templates; tied to the HO-3 product) ───────────────
  const base = new Date()
  for (let i = 0; i < HO3_DEFAULT_TASK_TEMPLATES.length; i++) {
    const tmpl  = HO3_DEFAULT_TASK_TEMPLATES[i]!
    const dueAt = new Date(base)
    dueAt.setDate(dueAt.getDate() + tmpl.daysOffset)
    await db.collection('tasks').add({
      title: tmpl.title, column: tmpl.column,
      productId: HO3_PRODUCT.refId, checklist: [], order: i,
      dueAt: Timestamp.fromDate(dueAt),
      status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
      updatedBy: 'seed', rev: 1, createdAt: now, updatedAt: now,
    })
    inc('tasks')
  }

  // ── Task Templates (SLA config — editable by ADMIN, fallback for NewProductModal) ──
  {
    const tmplBatch = db.batch()
    for (let i = 0; i < HO3_DEFAULT_TASK_TEMPLATES.length; i++) {
      const tmpl = HO3_DEFAULT_TASK_TEMPLATES[i]!
      tmplBatch.set(db.doc(`taskTemplates/default-${i}`), {
        title: tmpl.title, column: tmpl.column,
        daysOffset: tmpl.daysOffset, slaLabel: tmpl.slaLabel,
        order: i, createdAt: now, updatedAt: now,
      })
    }
    await tmplBatch.commit()
    inc('taskTemplates', HO3_DEFAULT_TASK_TEMPLATES.length)
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
  console.log('\n👤 Creating auth users…')
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

  // ── Verify worked examples → the two canaries ($1,528 and $2,789) ─────────
  console.log('\n🧮 Verifying worked examples…')
  const workedExamplePremiums: Record<string, number> = {}

  const ho3 = evaluate(HO3_RATING_PROGRAM, HO3_WORKED_EXAMPLE, makeHO3RtGetter(HO3_RT_TABLES), makeHO3LdGetter(HO3_LD_TABLES))
  workedExamplePremiums[HO3_PRODUCT.refId!] = ho3.finalPremium
  if (ho3.finalPremium !== 1528) {
    warnings.push(`CRITICAL: HO-3 worked example = ${ho3.finalPremium}, expected $1,528`)
    console.error(`  ✗ HO-3 got $${ho3.finalPremium} — expected $1,528!`)
  } else console.log('  ✓ HO-3 $1,528 confirmed')

  const gl = evaluate(GL_RATING_PROGRAM, GL_WORKED_EXAMPLE, makeGLRtGetter(GL_RT_TABLES), makeGLLdGetter(GL_LD_TABLES))
  workedExamplePremiums[GL_PRODUCT.refId!] = gl.finalPremium
  if (gl.finalPremium !== 2789) {
    warnings.push(`CRITICAL: GL worked example = ${gl.finalPremium}, expected $2,789`)
    console.error(`  ✗ GL got $${gl.finalPremium} — expected $2,789!`)
  } else console.log('  ✓ GL $2,789 confirmed')

  // ── Seed Report ───────────────────────────────────────────────────────────
  await db.collection('seedReports').add({
    counts, warnings,
    workedExamplePremium: ho3.finalPremium, // HO-3 canary (back-compat)
    workedExamplePremiums,
    at: now,
  })

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete.')
  console.log('   Counts:')
  for (const [k, v] of Object.entries(counts)) console.log(`     ${k}: ${v}`)
  if (warnings.length) console.warn('\n   Warnings:', warnings)
  console.log('\n   💰 Worked example premiums:')
  for (const [pid, prem] of Object.entries(workedExamplePremiums)) {
    console.log(`     ${pid}: $${prem.toLocaleString()}`)
  }
}

main().catch(err => { console.error('Seed failed:', err); process.exit(1) })
