// migrate-to-cosmos.ts — populate Azure Cosmos DB with the canonical dataset.
//
// This is the DATA MIGRATION: it writes the same reference products, coverages,
// tables, forms, rules, dictionary, tasks, feedback, search index and grounding
// chunks that scripts/seed.ts writes to Firestore — but into the Cosmos `docs`
// container, at the SAME paths, in the entity shape the /api/db layer reads.
//
// Source of truth is the deterministic seed (shared/src/seed/*), which is what
// the whole app + the $1,528 / $1,002 / $2,635 canaries are built on. A live
// Firestore export (if GCP read creds are present) is a documented follow-up;
// the RUNTIME has zero Firebase/GCloud connection either way.
//
// Run:  COSMOS_ENDPOINT=... COSMOS_KEY=... NODE_PATH=server/node_modules \
//         pnpm tsx scripts/migrate-to-cosmos.ts

import { CosmosClient } from '@azure/cosmos'
import {
  PH_PRODUCT, PH_COVERAGES, PH_LD_TABLES, PH_RT_TABLES, PH_RATING_PROGRAM,
  PH_FORMS, PH_RULES, PH_FORM_RULES, PH_DICTIONARY, PH_DEFAULT_TASK_TEMPLATES,
  PH_SAMPLE_FEEDBACK,
} from '../shared/src/seed/personalHome'
import {
  PA_PRODUCT, PA_COVERAGES, PA_LD_TABLES, PA_RT_TABLES, PA_RATING_PROGRAM,
  PA_FORMS, PA_RULES, PA_FORM_RULES, PA_DICTIONARY,
} from '../shared/src/seed/personalAuto'
import {
  GL_PRODUCT, GL_COVERAGES, GL_LD_TABLES, GL_RT_TABLES, GL_RATING_PROGRAM,
  GL_FORMS, GL_RULES, GL_FORM_RULES, GL_DICTIONARY,
} from '../shared/src/seed/generalLiability'
import { buildBundleChunks, dedupeChunks } from '../shared/src/retrieval/chunk'

type Doc = Record<string, unknown>

const endpoint = process.env.COSMOS_ENDPOINT!
const key = process.env.COSMOS_KEY!
if (!endpoint || !key) { console.error('COSMOS_ENDPOINT / COSMOS_KEY required'); process.exit(1) }
const docs = new CosmosClient({ endpoint, key }).database(process.env.COSMOS_DB || 'prodhub').container('docs')

// COSMOS_TENANT controls which tenant partition the seed corpus is written into.
// Must match the tenantId in the JWT of the tenant that should see this seed data.
// Default 'default' aligns with the local/smoke bootstrap tenant.
const tenantId = process.env.COSMOS_TENANT || 'default'

const NOW = new Date().toISOString()
const segs = (p: string) => p.split('/').filter(Boolean)
const baseKey = (p: string) => { const s = segs(p); return (s[0] === 'products' && s[1]) ? s[1]! : (s[0] || 'root') }
// pkFor mirrors data.js: ${tenantId}|${baseKey(path)} so tenant-scoped reads find seed docs.
const pkFor = (p: string) => `${tenantId}|${baseKey(p)}`
const collOf = (p: string) => segs(p).slice(0, -1).join('/')
const san = (p: string) => p.replace(/[/\\?#]/g, '~')
const kw = (t: string) => t.toLowerCase().split(/\W+/).filter((k) => k.length > 2)

// null timestamp placeholders → ISO now (the app coerces Timestamp | ISO | millis)
function withTs(obj: Doc): Doc {
  const out: Doc = { ...obj }
  for (const k of ['createdAt', 'updatedAt', 'at']) if (k in out && out[k] === null) out[k] = NOW
  const h = out['health']
  if (h && typeof h === 'object' && (h as Doc)['updatedAt'] === null) out['health'] = { ...(h as Doc), updatedAt: NOW }
  return out
}

const ops: { path: string; entityType: string; data: Doc }[] = []
const idx: Doc[] = []
const add = (path: string, entityType: string, data: Doc) => ops.push({ path, entityType, data: withTs(data) })
const addIdx = (e: Doc) => idx.push(e)

const bundles = [
  { pid: PH_PRODUCT.refId!, kws: ['homeowners', 'personal', 'home', 'ho3', 'ho-3', 'coastal'], product: PH_PRODUCT as Doc, coverages: PH_COVERAGES as unknown as Doc[], ld: PH_LD_TABLES as Record<string, Doc>, rt: PH_RT_TABLES as Record<string, Doc>, rp: PH_RATING_PROGRAM as Doc & { refId: string }, forms: PH_FORMS as unknown as (Doc & { number: string })[], rules: PH_RULES as unknown as Doc[], formRules: PH_FORM_RULES as unknown as Doc[], dict: PH_DICTIONARY as unknown as (Doc & { name: string })[] },
  { pid: PA_PRODUCT.refId!, kws: ['personal', 'auto', 'automobile', 'pap', 'pp0001'], product: PA_PRODUCT as Doc, coverages: PA_COVERAGES as unknown as Doc[], ld: PA_LD_TABLES as Record<string, Doc>, rt: PA_RT_TABLES as Record<string, Doc>, rp: PA_RATING_PROGRAM as Doc & { refId: string }, forms: PA_FORMS as unknown as (Doc & { number: string })[], rules: PA_RULES as unknown as Doc[], formRules: PA_FORM_RULES as unknown as Doc[], dict: PA_DICTIONARY as unknown as (Doc & { name: string })[] },
  { pid: GL_PRODUCT.refId!, kws: ['general', 'liability', 'cgl', 'commercial', 'cg0001', 'occurrence'], product: GL_PRODUCT as Doc, coverages: GL_COVERAGES as unknown as Doc[], ld: GL_LD_TABLES as Record<string, Doc>, rt: GL_RT_TABLES as Record<string, Doc>, rp: GL_RATING_PROGRAM as Doc & { refId: string }, forms: GL_FORMS as unknown as (Doc & { number: string })[], rules: GL_RULES as unknown as Doc[], formRules: GL_FORM_RULES as unknown as Doc[], dict: GL_DICTIONARY as unknown as (Doc & { name: string })[] },
]

const seenDict = new Set<string>()
for (const b of bundles) {
  add(`products/${b.pid}`, 'product', b.product)
  addIdx({ type: 'product', refId: b.pid, title: b.product['name'], subtitle: `${(b.product['lob'] as Doc)?.['name']} · ${b.product['marketSegment']}`, path: `products/${b.pid}`, keywords: [...kw(b.product['name'] as string), ...b.kws, b.pid.toLowerCase()] })
  for (const cov of b.coverages) {
    const refId = cov['refId'] as string
    add(`products/${b.pid}/coverages/${refId.replace(/\./g, '-')}`, 'coverage', cov)
    addIdx({ type: 'coverage', refId, title: cov['name'], subtitle: refId, path: `products/${b.pid}/coverages/${refId.replace(/\./g, '-')}`, keywords: kw(cov['name'] as string) })
  }
  for (const [refId, tbl] of Object.entries(b.ld)) { add(`ldTables/${refId}`, 'ldTable', tbl); addIdx({ type: 'ldTable', refId, title: tbl['name'], subtitle: refId, path: `ldTables/${refId}`, keywords: [...kw(tbl['name'] as string), ...kw(refId)] }) }
  for (const [refId, tbl] of Object.entries(b.rt)) { add(`rtTables/${refId}`, 'rtTable', tbl); addIdx({ type: 'rtTable', refId, title: tbl['name'], subtitle: refId, path: `rtTables/${refId}`, keywords: [...kw(tbl['name'] as string), ...kw(refId)] }) }
  add(`products/${b.pid}/ratingPrograms/${b.rp.refId.replace(/\./g, '-')}`, 'ratingProgram', b.rp)
  for (const form of b.forms) {
    const key = form.number.replace(/\s+/g, '-')
    add(`forms/${key}`, 'form', form)
    addIdx({ type: 'form', refId: b.pid, title: form['name'], subtitle: `${form.number} · ${form['edition']}`, path: `forms/${key}`, keywords: [...kw(form['name'] as string), ...kw(form.number)] })
  }
  for (const rule of b.rules) add(`products/${b.pid}/rules/${(rule['refId'] as string).replace(/\./g, '-')}`, 'rule', rule)
  for (const fr of b.formRules) add(`products/${b.pid}/formRules/${(fr['refId'] as string).replace(/\./g, '-')}`, 'formRule', fr)
  for (const entry of b.dict) {
    const id = entry.name.toLowerCase().replace(/\s+/g, '-')
    if (seenDict.has(id)) continue
    seenDict.add(id)
    add(`dictionary/${id}`, 'dictionary', entry)
    const dref = entry['refId'] as string | undefined
    addIdx({ type: 'dictionary', refId: dref, title: entry.name, subtitle: dref ?? entry['type'], path: `dictionary/${id}`, keywords: [...kw(entry.name), ...(dref ? kw(dref) : []), ...((entry['tags'] as string[]) || []), ...(((entry['aliases'] as string[]) || []).flatMap(kw))] })
  }
}

// Default tasks (PH) + templates + sample feedback
const baseDate = new Date()
PH_DEFAULT_TASK_TEMPLATES.forEach((t, i) => {
  const due = new Date(baseDate); due.setDate(due.getDate() + t.daysOffset)
  add(`tasks/seed-task-${i}`, 'task', { title: t.title, column: t.column, productId: PH_PRODUCT.refId, checklist: [], order: i, dueAt: due.toISOString(), status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED', updatedBy: 'seed', rev: 1, createdAt: NOW, updatedAt: NOW })
  add(`taskTemplates/default-${i}`, 'taskTemplate', { title: t.title, column: t.column, daysOffset: t.daysOffset, slaLabel: t.slaLabel, ...(t.group ? { group: t.group } : {}), order: i, createdAt: NOW, updatedAt: NOW })
})
PH_SAMPLE_FEEDBACK.forEach((fb, i) => add(`feedback/seed-fb-${i}`, 'feedback', fb as Doc))

// Search index entries (Explorer / command palette read the `searchIndex` collection)
for (const e of idx) add(`searchIndex/${san(String(e['path'])).replace(/~/g, '_')}`, 'searchIndex', e)

// Grounding chunks (lexical corpus; dense vectors added later via reindex)
try {
  const chunks = dedupeChunks(bundles.flatMap((b) => buildBundleChunks({
    product: b.product as never, coverages: b.coverages as never, rules: b.rules as never,
    formRules: b.formRules as never, forms: b.forms as never, dictionary: b.dict as never,
    ratingProgram: b.rp as never, ldTables: b.ld as never, rtTables: b.rt as never,
  })))
  for (const c of chunks) add(`groundingChunks/${c.id.replace(/\//g, '_')}`, 'groundingChunk', { id: c.id, text: c.text, contentHash: c.contentHash, metadata: c.metadata, type: c.metadata.type, productId: c.metadata.productId, updatedAt: NOW })
  console.log(`  grounding chunks: ${chunks.length}`)
} catch (e) { console.warn('  grounding chunks skipped:', (e as Error).message) }

// ── write to Cosmos (upsert, concurrency-limited) ────────────────────────────
async function run() {
  console.log(`Migrating ${ops.length} documents into Cosmos (docs container, tenant='${tenantId}')…`)
  let done = 0
  const pool = 25
  for (let i = 0; i < ops.length; i += pool) {
    await Promise.all(ops.slice(i, i + pool).map((o) =>
      docs.items.upsert({ id: `ent:${san(o.path)}`, pk: pkFor(o.path), tenantId, kind: 'entity', path: o.path, coll: collOf(o.path), entityType: o.entityType, rev: 1, data: { ...o.data, rev: 1 }, updatedAt: NOW })
        .then(() => { done++ })))
  }
  const counts = ops.reduce<Record<string, number>>((m, o) => { m[o.entityType] = (m[o.entityType] || 0) + 1; return m }, {})
  console.log(`✅ Migrated ${done}/${ops.length} docs. By type:`, counts)
}
run().catch((e) => { console.error('migration failed:', e); process.exit(1) })
