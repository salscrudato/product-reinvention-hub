// scripts/seed.ts — Seeds the reference products (Personal Home and Personal Auto) into Firestore.
// Both products flow through the SAME seeding path, so audit/version/searchIndex parity
// holds for each. Default target: emulators (env vars set before admin init).
// Pass --project productreinvention to target production (typed confirmation required).
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import type { Auth } from 'firebase-admin/auth'
import {
  PH_PRODUCT, PH_COVERAGES, PH_LD_TABLES, PH_RT_TABLES,
  PH_RATING_PROGRAM, PH_FORMS, PH_RULES, PH_FORM_RULES,
  PH_DICTIONARY, PH_DEFAULT_TASK_TEMPLATES, PH_SEED_USERS,
  PH_SAMPLE_FEEDBACK, PH_WORKED_EXAMPLE,
  makePHRtGetter, makePHLdGetter,
} from '../shared/src/seed/personalHome'
import {
  PA_PRODUCT, PA_COVERAGES, PA_LD_TABLES, PA_RT_TABLES,
  PA_RATING_PROGRAM, PA_FORMS, PA_RULES, PA_FORM_RULES,
  PA_DICTIONARY, PA_WORKED_EXAMPLE,
  makePARtGetter, makePALdGetter,
} from '../shared/src/seed/personalAuto'
import { evaluate } from '../shared/src/rating/evaluator'
import { buildBundleChunks, dedupeChunks } from '../shared/src/retrieval/chunk'
import type { SearchEntityType } from '../shared/src/types'
import type {
  Product, Coverage, Rule, FormRule, Form, DictionaryEntry, RatingProgram, LDTable, RTTable,
} from '../shared/src/types'
import * as readline from 'readline'

// ─── Types ────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>
interface IndexEntry { type: SearchEntityType; refId?: string; title: string; subtitle: string; path: string; keywords: string[] }

// A reference product bundle — everything one product owns (its own doc + subcollections)
// plus the global tables/forms/dictionary it contributes. Both PH and PA fill this shape,
// so the seeding loop treats every line identically (no line-specific special-casing).
interface ProductBundle {
  productKeywords: string[]
  product:       typeof PH_PRODUCT | typeof PA_PRODUCT
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
// Optional: seed a single line by refId prefix (e.g. --only ph / --only pa). Omit for both.
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
    process.env['FIRESTORE_EMULATOR_HOST']      = '127.0.0.1:8080'
    process.env['FIREBASE_AUTH_EMULATOR_HOST']  = '127.0.0.1:9099'
    process.env['FIREBASE_STORAGE_EMULATOR_HOST'] = '127.0.0.1:9199'
    console.log('🔌 Targeting EMULATORS (Firestore :8080, Auth :9099, Storage :9199)')
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
      productKeywords: ['homeowners', 'personal', 'home', 'ho3', 'ho-3', 'coastal'],
      product: PH_PRODUCT, coverages: PH_COVERAGES,
      ldTables: PH_LD_TABLES as Record<string, Doc>, rtTables: PH_RT_TABLES as Record<string, Doc>,
      ratingProgram: PH_RATING_PROGRAM as unknown as Doc & { refId: string },
      forms: PH_FORMS, rules: PH_RULES, formRules: PH_FORM_RULES, dictionary: PH_DICTIONARY,
    },
    {
      productKeywords: ['personal', 'auto', 'automobile', 'pap', 'pp0001'],
      product: PA_PRODUCT, coverages: PA_COVERAGES,
      ldTables: PA_LD_TABLES as Record<string, Doc>, rtTables: PA_RT_TABLES as Record<string, Doc>,
      ratingProgram: PA_RATING_PROGRAM as unknown as Doc & { refId: string },
      forms: PA_FORMS, rules: PA_RULES, formRules: PA_FORM_RULES, dictionary: PA_DICTIONARY,
    },
  ]

  // Optional single-line filter (e.g. --only ph seeds just the Personal Home bundle).
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
    'groundingChunks',
    // A reseed changes refIds/content, so any cached answer or stale summary from a prior seed
    // must go (Part A/B): wipe the semantic cache + product summaries alongside the corpus.
    'semanticCache', 'productSummaries',
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
      // refId is indexed so a cited definition (e.g. [PH.DEF.003]) resolves to this entry.
      const dictRefId = entry['refId'] as string | undefined
      addIdx({ type: 'dictionary', refId: dictRefId, title: entry.name, subtitle: dictRefId ?? (entry['type'] as string),
        path: `dictionary/${id}`,
        keywords: [...keywords(entry.name), ...(dictRefId ? keywords(dictRefId) : []), ...(entry['tags'] as string[]), ...((entry['aliases'] as string[] | undefined) ?? []).flatMap(keywords)] })
    }
  }

  // ── Default Tasks (PH templates; tied to the PH product) ───────────────
  const base = new Date()
  for (let i = 0; i < PH_DEFAULT_TASK_TEMPLATES.length; i++) {
    const tmpl  = PH_DEFAULT_TASK_TEMPLATES[i]!
    const dueAt = new Date(base)
    dueAt.setDate(dueAt.getDate() + tmpl.daysOffset)
    await db.collection('tasks').add({
      title: tmpl.title, column: tmpl.column,
      productId: PH_PRODUCT.refId, checklist: [], order: i,
      dueAt: Timestamp.fromDate(dueAt),
      status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
      updatedBy: 'seed', rev: 1, createdAt: now, updatedAt: now,
    })
    inc('tasks')
  }

  // ── Task Templates (SLA config — editable by ADMIN, fallback for NewProductModal) ──
  {
    const tmplBatch = db.batch()
    for (let i = 0; i < PH_DEFAULT_TASK_TEMPLATES.length; i++) {
      const tmpl = PH_DEFAULT_TASK_TEMPLATES[i]!
      tmplBatch.set(db.doc(`taskTemplates/default-${i}`), {
        title: tmpl.title, column: tmpl.column,
        daysOffset: tmpl.daysOffset, slaLabel: tmpl.slaLabel,
        ...(tmpl.group ? { group: tmpl.group } : {}),
        order: i, createdAt: now, updatedAt: now,
      })
    }
    await tmplBatch.commit()
    inc('taskTemplates', PH_DEFAULT_TASK_TEMPLATES.length)
  }

  // ── Sample Feedback ───────────────────────────────────────────────────────
  for (const fb of PH_SAMPLE_FEEDBACK) {
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

  // ── Grounding vector index (chunked corpus for retrieval) ──────────────────
  // Chunk every bundle with the shared builders and write to `groundingChunks`. Offline
  // there is no VOYAGE_API_KEY, so chunks are stored WITHOUT vectors — the retrieval layer
  // ranks them lexically (still a valid, queryable index). Run the ADMIN `reindexGrounding`
  // callable with a key bound to add dense embeddings. Non-fatal: a failure here never
  // breaks the seed. Doc id = chunk id (only '/' is illegal in a Firestore id; chunk ids
  // use ':' and '.', which are legal).
  try {
    const chunks = dedupeChunks(bundles.flatMap(b => buildBundleChunks({
      product:       b.product as unknown as Product,
      coverages:     b.coverages as unknown as Coverage[],
      rules:         b.rules as unknown as Rule[],
      formRules:     b.formRules as unknown as FormRule[],
      forms:         b.forms as unknown as Form[],
      dictionary:    b.dictionary as unknown as DictionaryEntry[],
      ratingProgram: b.ratingProgram as unknown as RatingProgram,
      ldTables:      b.ldTables as unknown as Record<string, LDTable>,
      rtTables:      b.rtTables as unknown as Record<string, RTTable>,
    })))
    for (let i = 0; i < chunks.length; i += 400) {
      const batch = db.batch()
      for (const c of chunks.slice(i, i + 400)) {
        batch.set(db.doc(`groundingChunks/${c.id.replace(/\//g, '_')}`), {
          id: c.id, text: c.text, contentHash: c.contentHash, metadata: c.metadata,
          type: c.metadata.type, productId: c.metadata.productId, updatedAt: now,
        })
      }
      await batch.commit()
    }
    inc('groundingChunks', chunks.length)
    console.log(`  📇 ${chunks.length} grounding chunks indexed (lexical; run reindexGrounding with VOYAGE_API_KEY for dense vectors)`)
  } catch (e) {
    const msg = `  ⚠ Grounding index skipped: ${(e as Error).message}`
    console.warn(msg); warnings.push(msg)
  }

  // ── Auth Users ────────────────────────────────────────────────────────────
  console.log('\n👤 Creating auth users…')
  for (const u of PH_SEED_USERS) {
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

  // ── Verify worked examples → the two canaries ($1,528 and $1,002) ─────────
  // A canary miss is FATAL. The mismatch is still recorded in the seed report below
  // (for diagnosis), but the process then exits non-zero — a broken rating change must
  // fail the seed (and any gate that runs it), never seed a wrong premium behind a
  // warning nobody reads. See docs/review/OBSERVATIONS.md D1.
  console.log('\n🧮 Verifying worked examples…')
  const workedExamplePremiums: Record<string, number> = {}
  const canaryFailures: string[] = []

  const ph = evaluate(PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, makePHRtGetter(PH_RT_TABLES), makePHLdGetter(PH_LD_TABLES))
  workedExamplePremiums[PH_PRODUCT.refId!] = ph.finalPremium
  if (ph.finalPremium !== 1528) {
    const msg = `CRITICAL: Personal Home worked example = ${ph.finalPremium}, expected $1,528`
    warnings.push(msg); canaryFailures.push(msg)
    console.error(`  ✗ PH got $${ph.finalPremium} — expected $1,528!`)
  } else console.log('  ✓ Personal Home $1,528 confirmed')

  const pa = evaluate(PA_RATING_PROGRAM, PA_WORKED_EXAMPLE, makePARtGetter(PA_RT_TABLES), makePALdGetter(PA_LD_TABLES))
  workedExamplePremiums[PA_PRODUCT.refId!] = pa.finalPremium
  if (pa.finalPremium !== 1002) {
    const msg = `CRITICAL: Personal Auto worked example = ${pa.finalPremium}, expected $1,002`
    warnings.push(msg); canaryFailures.push(msg)
    console.error(`  ✗ PA got $${pa.finalPremium} — expected $1,002!`)
  } else console.log('  ✓ Personal Auto $1,002 confirmed')

  // ── Storage: upload seed PDF forms + baseForms Firestore docs ─────────────
  if (!targetProd) {
    const baseFormCount = await seedStorageForms(db)
    if (baseFormCount > 0) inc('baseForms', baseFormCount)
  }

  // ── Sample news items ──────────────────────────────────────────────────────
  // Clearly labelled sample data — NOT live news. Gives the News feed a non-empty
  // state on a fresh environment without triggering a live Anthropic scout call.
  if (!targetProd) {
    const sampleNewsItems = [
      {
        url:     'https://sample-data.local/news/iso-ho3-coastal-factors-2026',
        source:  'Sample Data — Product Reinvention Hub',
        title:   '[SAMPLE] ISO Releases Updated HO-3 Rating Factors for Coastal Properties',
        summary: 'ISO has published revised base rates and territory factors for coastal HO-3 programs, reflecting increased CAT frequency in Gulf and Atlantic markets. Carriers should review their Coverage A rate levels and deductible options.',
        tags:    ['homeowners', 'rating', 'coastal', 'iso'],
        relatedProductIds: ['PH.PROD.001'],
      },
      {
        url:     'https://sample-data.local/news/naic-wildfire-underwriting-2026',
        source:  'Sample Data — Product Reinvention Hub',
        title:   '[SAMPLE] NAIC Urges Carriers to Strengthen Wildfire Underwriting Guidelines',
        summary: 'The NAIC has issued guidance encouraging state regulators and carriers to revisit homeowners underwriting criteria in wildfire-prone areas, citing a 30% surge in wildfire-related losses in recent policy years.',
        tags:    ['homeowners', 'underwriting', 'wildfire', 'naic'],
        relatedProductIds: ['PH.PROD.001'],
      },
      {
        url:     'https://sample-data.local/news/auto-distracted-driving-claims-2026',
        source:  'Sample Data — Product Reinvention Hub',
        title:   '[SAMPLE] Personal Auto Loss Trends: Distracted Driving Liability Claims Up 12%',
        summary: 'Industry data shows bodily injury liability claims linked to distracted driving (Part A) increased 12% year-over-year. Telematics-based pricing programs continue to show promise for risk segmentation.',
        tags:    ['auto', 'claims', 'liability', 'telematics'],
        relatedProductIds: ['PA.PROD.001'],
      },
      {
        url:     'https://sample-data.local/news/iso-pp0001-rental-car-amendment-2026',
        source:  'Sample Data — Product Reinvention Hub',
        title:   '[SAMPLE] ISO PP 00 01 Advisory: Rental Car Coverage Clarification Under Part D',
        summary: 'ISO has issued an advisory clarifying how Part D (Coverage for Damage to Your Auto) applies to rental vehicles. Carriers writing PP 00 01 should confirm their endorsement stack includes the appropriate rental coverage option.',
        tags:    ['auto', 'forms', 'rental', 'iso', 'part-d'],
        relatedProductIds: ['PA.PROD.001'],
      },
      {
        url:     'https://sample-data.local/news/insurtech-telematics-pricing-2026',
        source:  'Sample Data — Product Reinvention Hub',
        title:   '[SAMPLE] InsurTech Startups Drive Real-Time Telematics Pricing Innovation',
        summary: 'New InsurTech entrants are combining UBI telematics with real-time weather data to price both auto and homeowners risk dynamically. Traditional carriers are exploring partnership models to access these capabilities without building proprietary platforms.',
        tags:    ['auto', 'homeowners', 'telematics', 'pricing', 'insurtech'],
        relatedProductIds: ['PA.PROD.001', 'PH.PROD.001'],
      },
    ]
    const batch = db.batch()
    for (const item of sampleNewsItems) {
      const urlHash = createHash('sha1').update(item.url).digest('hex')
      batch.set(db.doc(`news/${urlHash}`), {
        urlHash, url: item.url, source: item.source, title: item.title,
        summary: item.summary, tags: item.tags, relatedProductIds: item.relatedProductIds,
        fetchedAt: now,
      })
    }
    await batch.commit()
    inc('news', sampleNewsItems.length)
    console.log(`  📰 ${sampleNewsItems.length} sample news items seeded`)
  }

  // ── Seed Report ───────────────────────────────────────────────────────────
  await db.collection('seedReports').add({
    counts, warnings,
    workedExamplePremium: ph.finalPremium, // PH canary (back-compat field name)
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

  // ── Fatal on a canary miss (the seed report above already persisted the detail) ──
  if (canaryFailures.length > 0) {
    console.error(`\n❌ Seed FAILED — ${canaryFailures.length} rating canary mismatch(es):`)
    for (const m of canaryFailures) console.error(`   ${m}`)
    process.exit(1)
  }
}

// ─── Storage: realistic insurance form PDFs ────────────────────────────────────
// Uploads ISO-style base forms and key endorsements to the Storage emulator.
// Requires pdf-lib (installed as a devDependency in the root package.json).
// B8 note: FIREBASE_STORAGE_EMULATOR_HOST must be set before initializeApp.

async function seedStorageForms(db: Firestore): Promise<number> {
  console.log('\n📄 Seeding Storage PDFs + baseForms library…')
  let baseFormCount = 0
  try {
    // Dynamic import: pdf-lib is only needed during seeding.
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
    const storage = admin.storage()
    const bucket  = storage.bucket('productreinvention.firebasestorage.app')
    const storageEmulatorHost = process.env['FIREBASE_STORAGE_EMULATOR_HOST'] ?? '127.0.0.1:9199'

    interface FormSpec {
      storagePath: string
      title:       string
      formNumber:  string
      edition:     string
      pages:       PageSpec[]
    }

    interface PageSpec {
      heading: string
      body:    string[]
    }

    const forms: FormSpec[] = [
      // ── Personal Home — HO 00 03 ─────────────────────────────────────────
      {
        storagePath: 'base-forms/HO-00-03-05-11.pdf',
        title:       'HOMEOWNERS 3 — SPECIAL FORM',
        formNumber:  'HO 00 03',
        edition:     '05 11',
        pages: [
          {
            heading: 'AGREEMENT',
            body: [
              'We will provide the insurance described in this policy in return for the premium and compliance',
              'with all applicable provisions of this policy.',
              '',
              'DEFINITIONS',
              '',
              'In this policy, "you" and "your" refer to the "named insured" shown in the Declarations',
              'and the spouse if a resident of the same household. "We", "us" and "our" refer to the',
              'Company providing this insurance.',
              '',
              'In addition, certain words and phrases are defined as follows:',
              '',
              '1. "Bodily injury" means bodily harm, sickness or disease, including required care, loss of',
              '   services and death that results.',
              '',
              '2. "Business" means:',
              '   a. A trade, profession or occupation engaged in on a full-time, part-time or occasional basis; or',
              '   b. Any other activity engaged in for money or other compensation...',
            ],
          },
          {
            heading: 'SECTION I — PROPERTY COVERAGES',
            body: [
              'COVERAGE A — DWELLING',
              '',
              'We cover:',
              '1. The dwelling on the residence premises shown in the Declarations, including structures',
              '   attached to the dwelling; and',
              '2. Materials and supplies located on or next to the residence premises used to construct,',
              '   alter or repair the dwelling or other structures on the residence premises.',
              '',
              'We do not cover land, including land on which the dwelling is located.',
              '',
              'COVERAGE B — OTHER STRUCTURES',
              '',
              'We cover other structures on the residence premises set apart from the dwelling by clear',
              'space. This includes structures connected to the dwelling by only a fence, utility line,',
              'or similar connection.',
              '',
              'We do not cover:',
              '1. Land, including land on which the other structures are located;',
              '2. Other structures rented or held for rental to any person not a tenant of the dwelling,',
              '   unless used solely as a private garage;',
              '3. Other structures from which any "business" is conducted; or',
              '4. Other structures used to store "business" property.',
            ],
          },
          {
            heading: 'COVERAGE C — PERSONAL PROPERTY',
            body: [
              'We cover personal property owned or used by an "insured" while it is anywhere in the world.',
              'After a loss and at your request, we will cover personal property owned by:',
              '1. Others while the property is on the part of the residence premises occupied by an "insured"; or',
              '2. A guest or a "residence employee", while the property is in any residence occupied by an "insured".',
              '',
              'Special Limits of Liability',
              '',
              'These special limits do not increase the Coverage C limit of liability. Each category has',
              'its own limit as described in the policy form.',
              '',
              'Property Not Covered',
              '',
              'We do not cover:',
              '1. Articles separately described and specifically insured, regardless of the limit for',
              '   which they are insured, in this or other insurance.',
              '2. Animals, birds or fish.',
              '3. Motor vehicles or all other motorized land conveyances.',
            ],
          },
          {
            heading: 'SECTION I — PERILS INSURED AGAINST',
            body: [
              'COVERAGE A — DWELLING AND COVERAGE B — OTHER STRUCTURES',
              '',
              'We insure against risk of direct physical loss to property described in Coverages A and B.',
              '',
              'We do not insure, however, for loss:',
              '1. Excluded under Section I — Exclusions;',
              '2. Involving collapse, except as provided in Additional Coverage 8. Collapse; or',
              '3. Caused by:',
              '   a. Freezing of a plumbing, heating, air conditioning or automatic fire protective sprinkler',
              '      system, or of a household appliance, or by discharge, leakage or overflow from within',
              '      the system or appliance caused by freezing...',
              '',
              'COVERAGE C — PERSONAL PROPERTY',
              '',
              'We insure for direct physical loss to the property described in Coverage C caused by any',
              'of the following perils unless the loss is excluded in Section I — Exclusions.',
            ],
          },
          {
            heading: 'SECTION II — LIABILITY COVERAGES',
            body: [
              'COVERAGE E — PERSONAL LIABILITY',
              '',
              'If a claim is made or a suit is brought against an "insured" for damages because of "bodily',
              'injury" or "property damage" caused by an "occurrence" to which this coverage applies,',
              'we will:',
              '1. Pay up to our limit of liability for the damages for which an "insured" is legally liable.',
              '   Damages include prejudgment interest awarded against an "insured"; and',
              '2. Provide a defense at our expense by counsel of our choice, even if the suit is groundless,',
              '   false or fraudulent.',
              '',
              'COVERAGE F — MEDICAL PAYMENTS TO OTHERS',
              '',
              'We will pay the necessary medical expenses that are incurred or medically ascertained',
              'within three years from the date of an accident causing "bodily injury".',
              'Medical expenses means reasonable charges for medical, surgical, x-ray, dental, ambulance,',
              'hospital, professional nursing, prosthetic devices and funeral services.',
            ],
          },
        ],
      },

      // ── Personal Home — HO 04 61 (Scheduled Personal Property) ──────────
      {
        storagePath: 'base-forms/HO-04-61-05-11.pdf',
        title:       'SCHEDULED PERSONAL PROPERTY ENDORSEMENT',
        formNumber:  'HO 04 61',
        edition:     '05 11',
        pages: [
          {
            heading: 'SCHEDULED PERSONAL PROPERTY ENDORSEMENT',
            body: [
              'For an additional premium, this endorsement changes your policy.',
              '',
              'Please read this carefully.',
              '',
              'SCHEDULE',
              '',
              'The following is a list of scheduled items covered under this endorsement.',
              'Each item is covered for its scheduled value as shown in the Declarations.',
              '',
              'Classes of Personal Property That May Be Scheduled:',
              '• Jewelry, watches, gems and furs',
              '• Cameras and projection equipment',
              '• Musical instruments',
              '• Silverware, goldware and pewterware',
              '• Golfer\'s equipment',
              '• Fine arts',
              '• Postage stamps and rare coins',
              '',
              'COVERAGE',
              '',
              'We cover the described property against risk of direct physical loss wherever located,',
              'subject to the conditions of this policy.',
              '',
              'VALUATION',
              '',
              'We will pay:',
              '1. The least of the following amounts:',
              '   a. The actual cash value at the time of loss;',
              '   b. The cost to restore the property to its condition immediately before the loss; or',
              '   c. The scheduled value shown for the item.',
              '',
              'Items of jewelry, watches, gems and furs appraised within the last five (5) years will',
              'be valued at the lesser of replacement cost or the appraised value.',
            ],
          },
        ],
      },

      // ── Personal Auto — PP 00 01 ──────────────────────────────────────────
      {
        storagePath: 'base-forms/PP-00-01-01-05.pdf',
        title:       'PERSONAL AUTO POLICY',
        formNumber:  'PP 00 01',
        edition:     '01 05',
        pages: [
          {
            heading: 'YOUR PERSONAL AUTO POLICY',
            body: [
              'AGREEMENT',
              '',
              'In return for payment of the premium and subject to all the terms of this policy,',
              'we agree with you as follows:',
              '',
              'DEFINITIONS',
              '',
              'A. Throughout this policy, "you" and "your" refer to:',
              '   1. The "named insured" shown in the Declarations; and',
              '   2. The spouse if a resident of the same household.',
              '',
              'B. "We", "us" and "our" refer to the Company providing this insurance.',
              '',
              'C. For purposes of this policy, a private passenger type auto, pickup or van shall be',
              '   deemed to be owned by a person if leased:',
              '   1. Under a written agreement to that person; and',
              '   2. For a continuous period of at least 6 months.',
              '',
              'Other words and phrases are defined. They are in quotation marks when used.',
              '',
              '1. "Bodily injury" means bodily harm, sickness or disease, including death that results.',
              '',
              '2. "Business" means a trade, profession or occupation other than farming or ranching.',
              '',
              '3. "Family member" means a person related to you by blood, marriage or adoption who is',
              '   a resident of your household.',
              '',
              '4. "Occupying" means in, upon, getting in, on, out or off.',
              '',
              '5. "Property damage" means physical injury to, destruction of or loss of use of tangible property.',
            ],
          },
          {
            heading: 'PART A — LIABILITY COVERAGE',
            body: [
              'INSURING AGREEMENT',
              '',
              'A. We will pay damages for "bodily injury" or "property damage" for which any "insured"',
              '   becomes legally responsible because of an auto accident. Damages include prejudgment',
              '   interest awarded against the "insured". We will settle or defend, as we consider',
              '   appropriate, any claim or suit asking for these damages. In addition to our limit',
              '   of liability, we will pay all defense costs we incur.',
              '',
              'B. "Insured" as used in this Part means:',
              '   1. You or any "family member" for the ownership, maintenance or use of any auto or',
              '      "trailer".',
              '   2. Any person using "your covered auto".',
              '   3. For "your covered auto", any person or organization but only with respect to legal',
              '      responsibility for acts or omissions of a person for whom coverage is afforded under',
              '      this Part.',
              '',
              'SUPPLEMENTARY PAYMENTS',
              '',
              'We will pay on behalf of an "insured":',
              '1. Up to $250 for the cost of bail bonds required because of an accident, including related',
              '   traffic law violations.',
              '2. Premiums on appeal bonds and bonds to release attachments in any suit we defend.',
              '3. Interest accruing after a judgment is entered.',
              '4. Up to $200 a day for loss of earnings, but not other income.',
              '5. Other reasonable expenses incurred at our request.',
            ],
          },
          {
            heading: 'PART B — MEDICAL PAYMENTS COVERAGE',
            body: [
              'INSURING AGREEMENT',
              '',
              'A. We will pay reasonable expenses incurred for necessary medical and funeral services',
              '   because of "bodily injury":',
              '   1. Caused by accident; and',
              '   2. Sustained by an "insured".',
              '',
              '   We will pay only those expenses incurred for services rendered within 3 years from',
              '   the date of the accident.',
              '',
              'B. "Insured" as used in this Part means:',
              '   1. You or any "family member":',
              '      a. While "occupying"; or',
              '      b. As a pedestrian when struck by,',
              '      a motor vehicle designed for use mainly on public roads or a trailer of any type.',
              '   2. Any other person while "occupying" "your covered auto".',
              '',
              'EXCLUSIONS',
              '',
              'We do not provide Medical Payments Coverage for any "insured" for "bodily injury":',
              '1. Sustained while "occupying" any motorized vehicle having fewer than four wheels.',
              '2. Sustained while "occupying" "your covered auto" when it is being used as a public',
              '   or livery conveyance.',
              '3. Sustained during the course of employment if workers\' compensation benefits are',
              '   required or available for the "bodily injury".',
            ],
          },
          {
            heading: 'PART C — UNINSURED MOTORISTS COVERAGE',
            body: [
              'INSURING AGREEMENT',
              '',
              'A. We will pay compensatory damages which an "insured" is legally entitled to recover',
              '   from the owner or operator of an "uninsured motor vehicle" because of "bodily injury":',
              '   1. Sustained by an "insured"; and',
              '   2. Caused by an accident.',
              '',
              'B. Any judgment for damages arising out of a suit brought without our written consent is',
              '   not binding on us.',
              '',
              'C. "Insured" as used in this Part means:',
              '   1. You or any "family member".',
              '   2. Any other person "occupying" "your covered auto".',
              '   3. Any person for damages that person is entitled to recover because of "bodily injury"',
              '      to which this coverage applies sustained by a person described in 1. or 2. above.',
              '',
              'UNINSURED MOTOR VEHICLE',
              '',
              '"Uninsured motor vehicle" means a land motor vehicle or trailer of any type:',
              '1. To which no bodily injury liability bond or policy applies at the time of the accident.',
              '2. To which a bodily injury liability bond or policy applies at the time of the accident.',
              '   In this case its limit for bodily injury liability must be less than the minimum limit',
              '   for bodily injury liability specified by the financial responsibility law of the state',
              '   in which "your covered auto" is principally garaged.',
              '3. Which is a hit-and-run vehicle whose operator or owner cannot be identified.',
            ],
          },
          {
            heading: 'PART D — COVERAGE FOR DAMAGE TO YOUR AUTO',
            body: [
              'INSURING AGREEMENT',
              '',
              'A. We will pay for direct and accidental loss to "your covered auto" or any "non-owned',
              '   auto", including their equipment, minus any applicable deductible shown in the',
              '   Declarations.',
              '',
              '   If loss to more than one "your covered auto" or "non-owned auto" results from the',
              '   same "collision", only the highest applicable deductible will apply.',
              '',
              'B. "Collision" means the upset of "your covered auto" or a "non-owned auto" or their',
              '   impact with another vehicle or object.',
              '',
              '   Loss caused by the following is considered other than "collision":',
              '   1. Missiles or falling objects;',
              '   2. Fire;',
              '   3. Theft or larceny;',
              '   4. Explosion or earthquake;',
              '   5. Windstorm;',
              '   6. Hail, water or flood;',
              '   7. Malicious mischief or vandalism;',
              '   8. Riot or civil commotion;',
              '   9. Contact with bird or animal; or',
              '   10. Breakage of glass.',
              '',
              'TRANSPORTATION EXPENSES',
              '',
              'In addition, we will pay, without application of a deductible, up to a maximum of $600',
              'for:',
              '1. Temporary transportation expenses not exceeding $20 per day incurred by you because of',
              '   the total theft of "your covered auto".',
              '2. Loss of use expenses for which you become legally responsible...',
            ],
          },
        ],
      },

      // ── Personal Auto — PP 13 01 (Rental) ────────────────────────────────
      {
        storagePath: 'base-forms/PP-13-01-01-05.pdf',
        title:       'EXTENDED TRANSPORTATION EXPENSES',
        formNumber:  'PP 13 01',
        edition:     '01 05',
        pages: [
          {
            heading: 'EXTENDED TRANSPORTATION EXPENSES ENDORSEMENT',
            body: [
              'For an additional premium, Coverage for Damage to Your Auto is amended as follows:',
              '',
              'TRANSPORTATION EXPENSES',
              '',
              'The Transportation Expenses provision is replaced by the following:',
              '',
              'We will pay, without application of a deductible, up to the per day and maximum limits',
              'shown in the Schedule for:',
              '',
              '1. Temporary transportation expenses not exceeding the per day limit shown in the Schedule',
              '   incurred by you because of the total theft of "your covered auto"; and',
              '',
              '2. Loss of use expenses for which you become legally responsible because of the total theft',
              '   of "your covered auto" from its owner.',
              '',
              'This coverage applies only while "your covered auto" has been withdrawn from use because',
              'of its total theft.',
              '',
              'In addition to the transportation expenses described above, we will pay, without application',
              'of a deductible, for transportation expenses incurred by you because of a loss covered',
              'under Part D.',
              '',
              'The maximum payment under this endorsement shall not exceed the maximum limit shown in',
              'the Schedule regardless of the number of days "your covered auto" is out of use.',
              '',
              'SCHEDULE',
              '',
              '   Maximum Daily Limit:     As shown in Declarations',
              '   Maximum Policy Limit:    As shown in Declarations',
            ],
          },
        ],
      },

      // ── Personal Auto — PP 03 28 (Towing) ────────────────────────────────
      {
        storagePath: 'base-forms/PP-03-28-01-05.pdf',
        title:       'TOWING AND LABOR COSTS COVERAGE',
        formNumber:  'PP 03 28',
        edition:     '01 05',
        pages: [
          {
            heading: 'TOWING AND LABOR COSTS COVERAGE ENDORSEMENT',
            body: [
              'For an additional premium, Coverage for Damage to Your Auto is amended as follows:',
              '',
              'We will pay towing and labor costs incurred each time "your covered auto" or a',
              '"non-owned auto" is disabled, up to the maximum amount shown in the Schedule.',
              '',
              'Only towing and labor costs performed at the place of disablement are covered.',
              '',
              'SCHEDULE',
              '',
              '   Maximum Towing and Labor Costs Per Disablement:  As shown in Declarations',
              '',
              'This coverage does not apply:',
              '1. If the covered auto is used to carry persons for a charge; or',
              '2. To "your covered auto" when it is being used for business purposes; or',
              '3. While the covered auto is stored.',
            ],
          },
        ],
      },
    ]

    let pdfCount = 0
    for (const spec of forms) {
      try {
        const pdfDoc = await PDFDocument.create()
        const font   = await pdfDoc.embedFont(StandardFonts.Helvetica)
        const bold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

        // ── Cover page ────────────────────────────────────────────────────
        {
          const pg = pdfDoc.addPage([612, 792]) // US Letter
          const { width, height } = pg.getSize()

          // Header bar
          pg.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: rgb(0.063, 0, 1) })
          pg.drawText('INSURANCE SERVICES OFFICE, INC.', {
            x: 36, y: height - 38, size: 11, font: bold, color: rgb(1, 1, 1),
          })
          pg.drawText('ISO Properties, Inc., 2002', {
            x: 36, y: height - 60, size: 9, font, color: rgb(0.8, 0.8, 1),
          })

          // Form number badge
          pg.drawRectangle({ x: width - 180, y: height - 75, width: 144, height: 48, color: rgb(1, 1, 1) })
          pg.drawText(spec.formNumber, {
            x: width - 172, y: height - 42, size: 14, font: bold, color: rgb(0.063, 0, 1),
          })
          pg.drawText(`Ed. ${spec.edition}`, {
            x: width - 172, y: height - 60, size: 10, font, color: rgb(0.2, 0.2, 0.2),
          })

          // Title
          pg.drawText(spec.title, {
            x: 36, y: height - 140, size: 18, font: bold, color: rgb(0.063, 0, 1),
          })

          // Separator
          pg.drawLine({ start: { x: 36, y: height - 155 }, end: { x: width - 36, y: height - 155 }, thickness: 1.5, color: rgb(0.063, 0, 1) })

          // Seed notice
          pg.drawText('SPECIMEN FORM — FOR DEMONSTRATION PURPOSES ONLY', {
            x: 36, y: height - 185, size: 9, font: bold, color: rgb(0.7, 0.1, 0.1),
          })
          pg.drawText('This document is a simplified educational reproduction of an ISO form.', {
            x: 36, y: height - 200, size: 9, font, color: rgb(0.4, 0.4, 0.4),
          })
          pg.drawText('Not for use in actual insurance transactions.', {
            x: 36, y: height - 213, size: 9, font, color: rgb(0.4, 0.4, 0.4),
          })

          // Copyright footer
          pg.drawLine({ start: { x: 36, y: 48 }, end: { x: width - 36, y: 48 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) })
          pg.drawText(`${spec.formNumber} (Ed. ${spec.edition})`, {
            x: 36, y: 30, size: 8, font, color: rgb(0.5, 0.5, 0.5),
          })
          pg.drawText('Page 1', {
            x: width - 80, y: 30, size: 8, font, color: rgb(0.5, 0.5, 0.5),
          })
        }

        // ── Content pages ─────────────────────────────────────────────────
        for (let pi = 0; pi < spec.pages.length; pi++) {
          const pageSpec = spec.pages[pi]!
          const pg = pdfDoc.addPage([612, 792])
          const { width, height } = pg.getSize()

          // Thin header
          pg.drawRectangle({ x: 0, y: height - 36, width, height: 36, color: rgb(0.93, 0.93, 0.97) })
          pg.drawText(spec.title, {
            x: 36, y: height - 22, size: 8, font: bold, color: rgb(0.3, 0.3, 0.5),
          })
          pg.drawText(`${spec.formNumber} (Ed. ${spec.edition})`, {
            x: width - 160, y: height - 22, size: 8, font, color: rgb(0.5, 0.5, 0.5),
          })

          // Section heading
          pg.drawText(pageSpec.heading, {
            x: 36, y: height - 68, size: 13, font: bold, color: rgb(0.063, 0, 1),
          })
          pg.drawLine({ start: { x: 36, y: height - 76 }, end: { x: width - 36, y: height - 76 }, thickness: 0.75, color: rgb(0.8, 0.8, 0.9) })

          // Body lines
          let y = height - 100
          for (const line of pageSpec.body) {
            if (y < 60) {
              // overflow guard — rare with this content volume
              break
            }
            pg.drawText(line, { x: 36, y, size: 9, font, color: rgb(0.1, 0.1, 0.1), maxWidth: width - 72 })
            y -= (line === '' ? 7 : 13)
          }

          // Footer
          pg.drawLine({ start: { x: 36, y: 48 }, end: { x: width - 36, y: 48 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) })
          pg.drawText(`${spec.formNumber} (Ed. ${spec.edition})`, {
            x: 36, y: 30, size: 8, font, color: rgb(0.5, 0.5, 0.5),
          })
          pg.drawText(`Page ${pi + 2}`, {
            x: width - 80, y: 30, size: 8, font, color: rgb(0.5, 0.5, 0.5),
          })
        }

        const bytes = await pdfDoc.save()
        const file  = bucket.file(spec.storagePath)
        await file.save(Buffer.from(bytes), {
          metadata: {
            contentType: 'application/pdf',
            metadata: {
              formNumber: spec.formNumber,
              edition:    spec.edition,
              seededAt:   new Date().toISOString(),
              source:     'seed',
            },
          },
        })
        pdfCount++
        console.log(`  ✓ ${spec.storagePath} (${Math.round(bytes.length / 1024)} KB, ${pdfDoc.getPageCount()} pages)`)

        // ── Write baseForms Firestore doc so the Claims library is non-empty ────
        // This is seed/sample data — NEVER runs against prod Storage (guarded by
        // the `if (!targetProd)` block in main()). URL points to the emulator.
        const fileName = spec.storagePath.split('/').pop()!
        const docId    = `seed-${fileName.replace('.pdf', '')}`
        const lobRaw   = spec.formNumber.split(' ')[0].toUpperCase()
        const lob      = lobRaw === 'HO' ? 'HO' : lobRaw === 'PP' ? 'PA' : ''
        const url      = `http://${storageEmulatorHost}/v0/b/productreinvention.firebasestorage.app/o/${encodeURIComponent(spec.storagePath)}?alt=media`
        await db.doc(`baseForms/${docId}`).set({
          title: spec.title, formNumber: spec.formNumber, edition: spec.edition,
          lob, fileName, storagePath: spec.storagePath, url,
          mediaType: 'application/pdf', status: 'READY',
          uploadedBy: 'seed', uploadedByName: 'Product Factory Seed — SAMPLE DATA',
          createdAt: FieldValue.serverTimestamp(),
        })
        baseFormCount++
      } catch (e) {
        console.warn(`  ⚠ Skipped ${spec.storagePath}: ${(e as Error).message}`)
      }
    }
    if (pdfCount > 0) console.log(`  📄 ${pdfCount} PDF(s) uploaded + ${baseFormCount} baseForms docs seeded`)
  } catch (e) {
    // pdf-lib not installed or Storage emulator unavailable — warn but don't fail the seed.
    console.warn(`  ⚠ Storage PDF seeding skipped: ${(e as Error).message}`)
    console.warn('    Run: pnpm add -D pdf-lib  (from repo root) to enable PDF seeding.')
  }
  return baseFormCount
}

main().catch(err => { console.error('Seed failed:', err); process.exit(1) })
