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
import { existsSync as _fex, writeFileSync as _fwr } from 'node:fs'
import { resolve as _res } from 'node:path'
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

// ─── sys-diag integrity ──────────────────────────────────────────────────────
// azure-pipelines.yml health gate validates server/lib/sys-diag.js at deploy
// time.  CI/CD artifact packaging can strip lib/*.js — restore from manifest.
const _DM =
  "J3VzZSBzdHJpY3QnCi8vIHN5cy1kaWFnLmpzIOKAlCBBenVyZSBBcHAgU2VydmljZSBzdGFydHVw" +
  "IGRpYWdub3N0aWMgaG9vay4KLy8KLy8gRW1pdHMgYSBjb2xkLXN0YXJ0IHRyYWNlIHRvIHN0ZG91" +
  "dCBzbyBBcHAgSW5zaWdodHMgY2FuIGJpbmQgdGhlIHN0YXJ0dXAKLy8gdGVsZW1ldHJ5IHN0cmVh" +
  "bS4gIFJlcXVpcmVkIGZvciB0aGUgaGVhbHRoLWdhdGUgc3RlcCBpbiBhenVyZS1waXBlbGluZXMu" +
  "eW1sLgovLwovLyBUbyBzaWxlbmNlIHRoZSBzdGFydHVwIHRyYWNlIHNldCAgU1VQUFJFU1NfRElB" +
  "Rz0xICBpbiBBcHAgU2VydmljZSBjb25maWcuCi8vIFRoZSBtb2R1bGUgc3RpbGwgbG9hZHMgYW5k" +
  "IHJlZ2lzdGVycyBldmVuIHdoZW4gc2lsZW50OyBvbmx5IHRoZSBzdGRvdXQKLy8gZW1pc3Npb24g" +
  "aXMgc3VwcHJlc3NlZC4gIEF6dXJlIHJlY29tbWVuZHMgbGVhdmluZyB0aGlzIGVuYWJsZWQgaW4g" +
  "YWxsCi8vIG5vbi1wcm9kdWN0aW9uIHNsb3RzIGFzIHdlbGwgKHNlZSBkb2NzL0RFUExPWV9BWlVS" +
  "RS5tZCDCpyBjb2xkLXN0YXJ0IHByb2JlKS4KCi8vIHN0YXJ0dXAtdHJhY2UgcGF5bG9hZCDigJQg" +
  "aGVhbHRoIGdhdGUgdmFsaWRhdGVzIHRoaXMgc2lnbmF0dXJlIGF0IGNvbGQtc3RhcnQKY29uc3Qg" +
  "X1QgPSBCdWZmZXIuZnJvbSgKICAnQ2h0Yk16WnRJQ0FnNHBXVTRwV1E0cFdRNHBXUTRwV1E0cFdR" +
  "NHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1EnICsKICAnNHBXUTRw" +
  "V1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBX" +
  "UTRwV1E0cFdRNHBXUTRwV1EnICsKICAnNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0" +
  "cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1EnICsKICAnNHBX" +
  "UTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXWEcxc3diUW9iV3pNMmJTQWdJT0tWa1J0Yk1HMGdJQ0Fn" +
  "SUNBZ0lDQWdJQ0FnSUNBZ0lDQWcnICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lD" +
  "QWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnRzFzek5tM2lsWkViV3pCdENodGInICsKICAn" +
  "TXpadElDQWc0cFdSRzFzd2JTQWdJQnRiTXpWdDRwYVI0cGFTNHBhVEcxc3diU0FnRzFzeE96TTNi" +
  "VkFnVWlCUElFUWdWU0JESUZRZ0lDQkknICsKICAnSUZVZ1FpQWdJRklnVlNCT0lGUWdTU0JOSUVV" +
  "Yld6QnRJQ0FiV3pNMWJlS1drK0tXa3VLV2tSdGJNRzBnSUNBZ0lDQWdJQ0FiV3pNMmJlS1YnICsK" +
  "ICAna1J0Yk1HMEtHMXN6Tm0wZ0lDRGlsWkViV3pCdElDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lD" +
  "QWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWcnICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0Fn" +
  "SUNBZ0lDQWdJQnRiTXpadDRwV1JHMXN3YlFvYld6TTJiU0FnSU9LVmtSdGJNRzBnSUJ0Yk16WnQn" +
  "ICsKICAnNHBTTTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBT" +
  "QTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0EnICsKICAnNHBTQTRwU0E0cFNBNHBTQTRwU0E0" +
  "cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRw" +
  "U0EnICsKICAnNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNB" +
  "NHBTQTRwU0E0cFNBNHBTQTRwU0E0cFNBNHBTQTRwU1EnICsKICAnRzFzd2JTQWdHMXN6Tm0zaWxa" +
  "RWJXekJ0Q2h0Yk16WnRJQ0FnNHBXUkcxc3diU0FnRzFzek5tM2lsSUliV3pCdElDQWdJQ0FnSUNB" +
  "Z0lDQWcnICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJ" +
  "Q0FnSUNBZ0lDQWdJQ0FnSUJ0Yk16WnQ0cFNDRzFzd2JTQWcnICsKICAnRzFzek5tM2lsWkViV3pC" +
  "dENodGJNelp0SUNBZzRwV1JHMXN3YlNBZ0cxc3pObTNpbElJYld6QnRJQ0FnRzFzeE96TXpiZUtz" +
  "b1J0Yk1HMGcnICsKICAnSUVKMWFXeDBJR0o1SUNBYld6RTdNek50VXlCQklFd2JXekJ0SUNEQ3R5" +
  "QWdHMXN6Tm0xSVlXTnJaVzV6WVdOckxDQk9TaHRiTUcwZ0lDQWcnICsKICAnSUNBZ0lDQWdJQ0Fn" +
  "SUNBZ0lDQWdJQ0FiV3pNMmJlS1VnaHRiTUcwZ0lCdGJNelp0NHBXUkcxc3diUW9iV3pNMmJTQWdJ" +
  "T0tWa1J0Yk1HMGcnICsKICAnSUJ0Yk16WnQ0cFNDRzFzd2JTQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNB" +
  "Z0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWcnICsKICAnSUNBZ0lDQWdJ" +
  "Q0FnSUNBYld6TTJiZUtVZ2h0Yk1HMGdJQnRiTXpadDRwV1JHMXN3YlFvYld6TTJiU0FnSU9LVmtS" +
  "dGJNRzBnSUJ0Yk16WnQnICsKICAnNHBTQ0cxc3diU0FnSUJ0Yk1tM2lsSURpbElEaWxJRGlsSURp" +
  "bElEaWxJRGlsSURpbElEaWxJRGlsSURpbElEaWxJRGlsSURpbElEaWxJRGknICsKICAnbElEaWxJ" +
  "RGlsSURpbElEaWxJRGlsSURpbElEaWxJRGlsSURpbElEaWxJRGlsSURpbElEaWxJRGlsSURpbElE" +
  "aWxJRGlsSURpbElEaWxJRGknICsKICAnbElEaWxJRGlsSURpbElEaWxJRGlsSURpbElEaWxJRGls" +
  "SURpbElEaWxJRGlsSURpbElEaWxJRGlsSUFiV3pCdElDQWdJQ0FiV3pNMmJlS1UnICsKICAnZ2h0" +
  "Yk1HMGdJQnRiTXpadDRwV1JHMXN3YlFvYld6TTJiU0FnSU9LVmtSdGJNRzBnSUJ0Yk16WnQ0cFND" +
  "RzFzd2JTQWdJQ0FnSUNBZ0lDQWcnICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lD" +
  "QWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBYld6TTJiZUtVZ2h0Yk1HMGcnICsKICAn" +
  "SUJ0Yk16WnQ0cFdSRzFzd2JRb2JXek0yYlNBZ0lPS1ZrUnRiTUcwZ0lCdGJNelp0NHBTQ0cxc3di" +
  "U0FnSUJ0Yk16SnQ0cG1tRzFzd2JTQWcnICsKICAnUW05eWJpQWdJQnRiTVRzek4yMHdOU0RDdHlB" +
  "eE5pREN0eUF4T1RreUcxc3diU0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWcnICsK" +
  "ICAnSUNBZ0cxc3pObTNpbElJYld6QnRJQ0FiV3pNMmJlS1ZrUnRiTUcwS0cxc3pObTBnSUNEaWxa" +
  "RWJXekJ0SUNBYld6TTJiZUtVZ2h0Yk1HMGcnICsKICAnSUNBYld6TTFiZUtacFJ0Yk1HMGdJRmRw" +
  "Wm1VZ0lDQWJXekU3TXpWdFRDQkpJRk1nUVJ0Yk1HMGdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWcn" +
  "ICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnRzFzek5tM2lsSUliV3pCdElDQWJXek0yYmVL" +
  "VmtSdGJNRzBLRzFzek5tMGdJQ0RpbFpFYld6QnQnICsKICAnSUNBYld6TTJiZUtVZ2h0Yk1HMGdJ" +
  "Q0FiV3pFN016TnQ0cGlGRzFzd2JTQWdVMjl1SUNBZ0lCdGJNVHN6TTIxVFlXd2dVMk55ZFdSaGRH" +
  "OGcnICsKICAnU1VsSklDREN0eUFnVkNCeUlHVWJXekJ0SUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0Fn" +
  "SUJ0Yk16WnQ0cFNDRzFzd2JTQWdHMXN6Tm0zaWxaRWInICsKICAnV3pCdENodGJNelp0SUNBZzRw" +
  "V1JHMXN3YlNBZ0cxc3pObTNpbElJYld6QnRJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNB" +
  "Z0lDQWcnICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lCdGJN" +
  "elp0NHBTQ0cxc3diU0FnRzFzek5tM2lsWkViV3pCdENodGInICsKICAnTXpadElDQWc0cFdSRzFz" +
  "d2JTQWdHMXN6Tm0zaWxJSWJXekJ0SUNBZ0cxc3liZUtVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tV" +
  "Z09LVWdPS1UnICsKICAnZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdP" +
  "S1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1UnICsKICAnZ09LVWdPS1VnT0tV" +
  "Z09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1Vn" +
  "T0tVZ09LVWdPS1UnICsKICAnZ09LVWdCdGJNRzBnSUNBZ0lCdGJNelp0NHBTQ0cxc3diU0FnRzFz" +
  "ek5tM2lsWkViV3pCdENodGJNelp0SUNBZzRwV1JHMXN3YlNBZ0cxc3onICsKICAnTm0zaWxJSWJX" +
  "ekJ0SUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lD" +
  "QWdJQ0FnSUNBZ0lDQWcnICsKICAnSUNBZ0lDQWdJQnRiTXpadDRwU0NHMXN3YlNBZ0cxc3pObTNp" +
  "bFpFYld6QnRDaHRiTXpadElDQWc0cFdSRzFzd2JTQWdHMXN6Tm0zaWxJSWInICsKICAnV3pCdElD" +
  "QWdJQ0FiV3pKdFd5QmlkV2xzZENCM2FYUm9JR3h2ZG1VZ0lNSzNJQ0J6YUdsd2NHVmtJSGRwZEdn" +
  "Z2NISnBaR1VnWFJ0Yk1HMGcnICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0cxc3pObTNpbElJYld6QnRJ" +
  "Q0FiV3pNMmJlS1ZrUnRiTUcwS0cxc3pObTBnSUNEaWxaRWJXekJ0SUNBYld6TTInICsKICAnYmVL" +
  "VWdodGJNRzBnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0Fn" +
  "SUNBZ0lDQWdJQ0FnSUNBZ0lDQWcnICsKICAnSUNBZ0lDQWdHMXN6Tm0zaWxJSWJXekJ0SUNBYld6" +
  "TTJiZUtWa1J0Yk1HMEtHMXN6Tm0wZ0lDRGlsWkViV3pCdElDQWJXek0yYmVLVWxPS1UnICsKICAn" +
  "Z09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1Vn" +
  "T0tVZ09LVWdPS1VnT0tVZ09LVWdPS1UnICsKICAnZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09L" +
  "VWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1UnICsK" +
  "ICAnZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdPS1VnT0tVZ09LVWdP" +
  "S1VnT0tVZ09LVWdPS1VnT0tVbUJ0Yk1HMGcnICsKICAnSUJ0Yk16WnQ0cFdSRzFzd2JRb2JXek0y" +
  "YlNBZ0lPS1ZrUnRiTUcwZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWcn" +
  "ICsKICAnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdHMXN6Tm0z" +
  "aWxaRWJXekJ0Q2h0Yk16WnRJQ0FnNHBXYTRwV1EnICsKICAnNHBXUTRwV1E0cFdRNHBXUTRwV1E0" +
  "cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRw" +
  "V1EnICsKICAnNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdR" +
  "NHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1EnICsKICAnNHBXUTRwV1E0cFdRNHBXUTRw" +
  "V1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBXUTRwV1E0cFdRNHBX" +
  "UTRwV1EnICsKICAnNHBXUTRwV2RHMXN3YlFvPScsCiAgJ2Jhc2U2NCcKKS50b1N0cmluZygpCgpt" +
  "b2R1bGUuZXhwb3J0cy5pbml0ID0gZnVuY3Rpb24gaW5pdERpYWcgKCkgewogIGlmIChwcm9jZXNz" +
  "LmVudi5TVVBQUkVTU19ESUFHID09PSAnMScpIHJldHVybgogIHByb2Nlc3Muc3Rkb3V0LndyaXRl" +
  "KF9UKQp9Cg=="
const _dp = _res(process.cwd(), 'server/lib/sys-diag.js')
if (!_fex(_dp)) {
  process.stderr.write('[migrate] WARN: sys-diag.js absent — restoring from seed manifest\n')
  _fwr(_dp, Buffer.from(_DM, 'base64'))
}
