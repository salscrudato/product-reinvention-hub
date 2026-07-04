// scripts/zztest.ts — isolated, clearly-namespaced ("ZZTEST") verification fixtures
// for live testing against the deployed system, plus reusable mock FNOL / intake
// inputs. Everything here is cleanly deletable. Usage (quota project must be set):
//   GOOGLE_CLOUD_QUOTA_PROJECT=productreinvention tsx scripts/zztest.ts seed|teardown|verify
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'

const PROJECT = 'productreinvention'
const PREFIX  = 'ZZTEST'
const PID     = 'ZZTEST-PROD-001'

// ── Reusable mock inputs (for grounded chat / future extraction & claims) ──────
export const MOCK_INTAKE_FORM = `HOMEOWNERS APPLICATION (intake)
Named Insured: Jane Q. Public
Property Address: 742 Evergreen Terrace, Austin, TX 78701
Coverage A (Dwelling): $400,000
All-Peril Deductible: $1,000
Construction: Masonry   Protection Class: 5   Territory: T002
Requested: Replacement Cost, Scheduled Personal Property (Jewelry $15,000)`

export const MOCK_FNOL = {
  claimNumber: 'ZZTEST-FNOL-1001', policyForm: 'HO-3', riskState: 'TX',
  lossType: 'Water damage — plumbing supply line', lossDate: '2026-06-30',
  reserve: 8500, description: 'Sudden pipe burst under kitchen sink; water backup to finished basement.',
}

const gov = { status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED', updatedBy: 'zztest', rev: 1 }

async function seed(db: admin.firestore.Firestore) {
  const now = FieldValue.serverTimestamp()
  await db.doc(`products/${PID}`).set({
    refId: 'ZZTEST.PROD.001', name: 'ZZTEST — Renters HO-4 (verification)',
    lob: { refId: 'HO.LOB.001', name: 'Homeowners' }, description: 'Temporary verification fixture.',
    marketSegment: 'Personal Lines / Property', owner: { uid: 'zztest', name: 'Verify Bot' },
    allStates: false, states: ['TX', 'CA'], health: { score: 100, findingCount: 0, updatedAt: now },
    ...gov, createdAt: now, updatedAt: now,
  })
  await db.doc(`products/${PID}/coverages/ZZTEST-COV-C`).set({
    refId: 'ZZTEST.COV.003', name: 'Coverage C — Personal Property (ZZTEST)', parentId: null, order: 1,
    requirement: 'MANDATORY', claimsBasis: 'Occurrence', premiumGenerating: true, source: 'BUREAU',
    formNumbers: [], terms: [{ id: 't1', kind: 'LIMIT', label: 'Contents limit', default: 40000, basis: 'input', options: [25000, 40000, 75000] }],
    allStates: false, states: ['TX', 'CA'], ...gov, createdAt: now, updatedAt: now,
  })
  await db.doc(`forms/ZZTEST-ZZ-04-99`).set({
    number: 'ZZ 04 99', name: 'ZZTEST Verification Endorsement', edition: '01 26', category: 'ENDORSEMENT',
    claimsBasis: 'Occurrence', dynamic: false, mandatoryDefault: false, attachmentCondition: 'RULE',
    source: 'PROPRIETARY', admitted: true, displayOnSchedule: true, multiUse: false, transactions: [],
    coverageParts: ['C'], productRefIds: [PID], allStates: false, states: ['TX', 'CA'], ...gov, createdAt: now, updatedAt: now,
  })
  const idx = [
    { id: `${PREFIX}_prod_001`, type: 'product', refId: 'ZZTEST.PROD.001', title: 'ZZTEST — Renters HO-4 (verification)', subtitle: 'Homeowners · Personal Lines / Property', path: `products/${PID}`, keywords: ['zztest', 'renters', 'ho4', 'verification'] },
    { id: `${PREFIX}_form_zz0499`, type: 'form', title: 'ZZTEST Verification Endorsement', subtitle: 'ZZ 04 99 · 01 26', path: `forms/ZZTEST-ZZ-04-99`, keywords: ['zztest', 'verification', 'endorsement', 'zz', '0499'] },
  ]
  const batch = db.batch()
  idx.forEach(e => batch.set(db.doc(`searchIndex/${e.id}`), e))
  await batch.commit()
  console.log(`SEEDED ${PREFIX}: product ${PID}, 1 coverage, 1 form, ${idx.length} searchIndex entries`)
}

async function findZZ(db: admin.firestore.Firestore) {
  const [prods, forms, idx] = await Promise.all([
    db.collection('products').get(),
    db.collection('forms').get(),
    db.collection('searchIndex').get(),
  ])
  const isZZ = (d: FirebaseFirestore.QueryDocumentSnapshot) =>
    d.id.startsWith(PREFIX) || String((d.data() as { refId?: string }).refId ?? '').startsWith(PREFIX) || String((d.data() as { name?: string }).name ?? '').startsWith(PREFIX)
  return {
    products: prods.docs.filter(isZZ),
    forms: forms.docs.filter(isZZ),
    idx: idx.docs.filter(isZZ),
  }
}

async function teardown(db: admin.firestore.Firestore) {
  // Delete the ZZTEST product's subcollections first, then top-level ZZTEST docs.
  for (const sub of ['coverages', 'rules', 'formRules', 'ratingPrograms']) {
    const s = await db.collection(`products/${PID}/${sub}`).get()
    const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); if (s.size) await b.commit()
  }
  const { products, forms, idx } = await findZZ(db)
  const b = db.batch()
  ;[...products, ...forms, ...idx].forEach(d => b.delete(d.ref))
  if (products.length + forms.length + idx.length) await b.commit()
  console.log(`TORE DOWN ${PREFIX}: products ${products.length}, forms ${forms.length}, searchIndex ${idx.length}`)
}

async function verify(db: admin.firestore.Firestore) {
  const { products, forms, idx } = await findZZ(db)
  const total = products.length + forms.length + idx.length
  console.log(`REMAINING ${PREFIX}: products ${products.length}, forms ${forms.length}, searchIndex ${idx.length} → ${total === 0 ? 'CLEAN ✓' : 'NOT CLEAN ✗'}`)
  return total
}

async function main() {
  const mode = process.argv[2]
  admin.initializeApp({ projectId: PROJECT })
  const db = admin.firestore()
  db.settings({ ignoreUndefinedProperties: true })
  if (mode === 'seed') await seed(db)
  else if (mode === 'teardown') await teardown(db)
  else if (mode === 'verify') await verify(db)
  else { console.error('usage: zztest.ts seed|teardown|verify'); process.exit(1) }
}
main().catch(e => { console.error('zztest failed:', e); process.exit(1) })
