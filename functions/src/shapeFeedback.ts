// shapeFeedback.ts — turn one piece of raw user feedback into a structured user story.
// Mirrors extract.ts's forced-tool discipline: a SINGLE tool the model MUST call
// (tool_choice forced), so the output is always structured — never free prose. The model
// is claude-sonnet-5 (vision-capable) so it can read the annotated screenshot when one is
// supplied.
//
// Grounding contract (the house "grounded + never invent" rule, applied to feedback):
//   • refId — the tool has NO refId field, so the model cannot fabricate one. We ECHO the
//     caller's on-screen refId/form number verbatim into the output (or omit it). Invention
//     is structurally impossible, exactly as in extract.ts.
//   • likelyFiles (ISSUE only) — grounded against a real allowlist of source files for the
//     affected surface. Any path the model returns that isn't a known file is a guess and is
//     dropped server-side; if nothing grounds, the list comes back empty. No guessed paths.
//   • groundingNote — where the model would need a citation it doesn't have, it says so in
//     plain words rather than inventing a coverage/form/rule/limit/factor.
//
// It performs NO writes. It returns only the shaped story plus an optional nearMatch
// (a read-only near-duplicate signal). Any signed-in user — including VIEWER, who may submit
// and vote on feedback — may call it. All persistence happens later, client-side, via mutate().
// AWS-SWAP: onCall → Lambda URL; auth + secret handling live in runtime.ts.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, ANTHROPIC_API_KEY } from './runtime'
import { rankDocuments, type RankDoc, type Feedback } from '@pf/shared'

if (!getApps().length) initializeApp()

// ─── Wire contract ──────────────────────────────────────────────────────────────

interface ShapeFeedbackInput {
  rawTitle:       string
  rawDetail?:     string
  routeLabel?:    string   // human label of the surface, e.g. "Coverages"
  route?:         string   // pathname, e.g. "/app/products/abc/coverages"
  entityPath?:    string
  refId?:         string   // exact on-screen refId or form number — echoed, NEVER invented
  screenshotUrl?: string
}

type ShapedType = 'IDEA' | 'ISSUE' | 'PRAISE'

interface ShapedStory {
  title:              string          // canonical, ≤ 80 chars
  type:               ShapedType      // auto-detected
  summary:            string          // one line
  affectedSurface:    string          // human label
  acceptanceCriteria: string[]        // 2..4 testable bullets
  impact:             1 | 2 | 3
  effort:             1 | 2 | 3
  refId?:             string          // echoed caller refId/form (never model-generated)
  reproSteps?:        string[]        // ISSUE only, 2..5 bullets
  likelyFiles?:       string[]        // ISSUE only, ⊆ the surface allowlist, may be []
  groundingNote?:     string          // plain-words honesty when a claim can't be cited
}

interface ShapeFeedbackOutput {
  story:      ShapedStory
  nearMatch?: { id: string; title: string; score: number }
}

// Tiny shared coercions — trim a maybe-string, and clean a maybe-array of strings.
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

// ─── likelyFiles grounding — the real source files per surface ───────────────────
// This is the ONLY set of paths the model may cite for an ISSUE's likelyFiles: anything
// it returns outside this set is treated as a guess and dropped. Every path here is a real
// file (verified against app/src/App.tsx routes + the FeedbackProvider route labels). Most
// specific first — product-tab segments before the workspace root before the products list.
const SURFACE_FILES: Array<[RegExp, string[]]> = [
  [/coverages/,         ['app/src/routes/product/ProductCoverages.tsx']],
  [/forms/,             ['app/src/routes/product/ProductForms.tsx']],
  [/pricing/,           ['app/src/routes/product/ProductPricing.tsx']],
  [/states/,            ['app/src/routes/product/ProductStates.tsx', 'app/src/components/product/StateTileMap.tsx']],
  [/rules/,             ['app/src/routes/product/ProductRules.tsx']],
  [/overview/,          ['app/src/routes/product/ProductOverview.tsx']],
  [/tasks|task board/,  ['app/src/routes/Tasks.tsx']],
  [/feedback/,          ['app/src/routes/Feedback.tsx', 'app/src/components/feedback/FeedbackProvider.tsx']],
  [/claims/,            ['app/src/routes/Claims.tsx']],
  [/dictionary/,        ['app/src/routes/Dictionary.tsx']],
  [/news/,              ['app/src/routes/News.tsx']],
  [/explorer|search/,   ['app/src/routes/Explorer.tsx']],
  [/builder/,           ['app/src/routes/Builder.tsx']],
  [/admin|settings/,    ['app/src/routes/Admin.tsx']],
  [/product workspace/, ['app/src/routes/product/ProductWorkspace.tsx']],
  [/products/,          ['app/src/routes/Products.tsx']],
  [/home/,              ['app/src/routes/Home.tsx']],
]

/** Real source files for the surface the feedback was left on, or [] when unknown. */
function candidateFiles(route?: string, routeLabel?: string): string[] {
  const hay = `${route ?? ''} ${routeLabel ?? ''}`.toLowerCase()
  for (const [re, files] of SURFACE_FILES) if (re.test(hay)) return files
  return []
}

// ─── Forced tool — the single structured output. No refId field by design (see header). ─
const SHAPE_TOOL: Anthropic.Tool = {
  name: 'shape_feedback',
  description:
    'Return ONE structured user story for the supplied raw feedback. Call this exactly once. ' +
    'Ground every specific product claim in what the user said and, when attached, the ' +
    'screenshot — never fabricate a coverage, form number, rule, limit, factor or refId.',
  input_schema: {
    type: 'object',
    properties: {
      title:   { type: 'string', description: 'Canonical, action-oriented title. MUST be 80 characters or fewer.' },
      type:    { type: 'string', enum: ['IDEA', 'ISSUE', 'PRAISE'], description: 'ISSUE = something is broken/wrong; IDEA = a request, improvement or new capability; PRAISE = positive feedback.' },
      summary: { type: 'string', description: 'One-line plain-English summary of the story.' },
      affectedSurface: { type: 'string', description: 'Human label for the surface this concerns, e.g. "Coverages tab" or "Pricing". Prefer the route label provided.' },
      acceptanceCriteria: {
        type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' },
        description: '2 to 4 short, testable bullets describing what "done" looks like.',
      },
      impact: { type: 'integer', enum: [1, 2, 3], description: 'User value / severity: 1 low, 2 medium, 3 high.' },
      effort: { type: 'integer', enum: [1, 2, 3], description: 'Estimated build size: 1 small, 2 medium, 3 large.' },
      reproSteps: {
        type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' },
        description: 'ISSUE only: 2 to 5 steps to reproduce, most important first. Omit entirely for IDEA/PRAISE.',
      },
      likelyFiles: {
        type: 'array', items: { type: 'string' },
        description: 'ISSUE only: repo-relative source paths, chosen ONLY from the candidate file list given in the user message. If none of the candidates fit, return an empty array. NEVER guess a path that is not in that list.',
      },
      groundingNote: {
        type: 'string',
        description: 'If any claim would need a citation you do not have (a specific coverage, form, rule, limit, factor or refId), say so here in plain words instead of inventing one. Otherwise omit.',
      },
    },
    required: ['title', 'type', 'summary', 'affectedSurface', 'acceptanceCriteria', 'impact', 'effort'],
  },
}

const SHAPE_SYSTEM =
  'You are a product-operations analyst for an AI-native P&C insurance product platform. You ' +
  'turn one raw piece of user feedback into a single structured user story by calling the ' +
  'shape_feedback tool exactly once.\n' +
  '- Detect the type: ISSUE (something is broken or wrong), IDEA (a request, improvement or new ' +
  'capability) or PRAISE (positive feedback).\n' +
  '- Ground everything in what the user actually said and, when attached, the annotated ' +
  'screenshot. NEVER invent product facts — do not fabricate a coverage, form number, rule, ' +
  'limit, factor or refId. If a claim would need a citation you do not have, say so plainly in ' +
  'groundingNote rather than making one up.\n' +
  '- The title must be canonical and 80 characters or fewer. acceptanceCriteria must be 2 to 4 ' +
  'short, testable bullets. impact and effort are 1 (low/small) to 3 (high/large).\n' +
  '- For an ISSUE, also provide reproSteps (2 to 5) and likelyFiles. Choose likelyFiles ONLY ' +
  'from the candidate source files listed in the user message; if none fit, return an empty ' +
  'array — never guess a path. For IDEA and PRAISE, omit reproSteps and likelyFiles.'

// ─── Screenshot — fetched server-side so shaping degrades gracefully if it's unreachable ─
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024   // 5 MB — a comfortable ceiling for an annotated PNG

/** Download the screenshot and return a base64 image block, or null on any failure (we then
 *  shape text-only). Fetching it ourselves — rather than handing Anthropic the URL — keeps a
 *  local/emulator URL or a transient blip from failing the whole request. */
async function fetchScreenshot(url: string): Promise<Anthropic.ImageBlockParam | null> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const buf  = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null
    const media = (SUPPORTED_IMAGE_TYPES.has(type) ? type : 'image/png') as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
    return { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } }
  } catch (e) {
    console.warn('[shapeFeedback] screenshot fetch failed; shaping text-only:', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ─── Sanitizer — enforce the output contract server-side (the forced tool guarantees a call,
//     not perfect fields). Also the ONE place that echoes the caller refId and grounds files. ─
function sanitizeStory(raw: Record<string, unknown>, input: ShapeFeedbackInput, candidates: string[]): ShapedStory {
  // Map any number onto the 1|2|3 scale: ≤1 → 1, ≥3 → 3, everything else (incl. NaN) → 2.
  const scale = (v: unknown): 1 | 2 | 3 => { const n = Math.round(Number(v)); return n <= 1 ? 1 : n >= 3 ? 3 : 2 }

  const t = str(raw.type).toUpperCase()
  const type: ShapedType = t === 'ISSUE' || t === 'PRAISE' ? t : 'IDEA'

  let title = str(raw.title) || str(input.rawTitle) || 'Untitled feedback'
  if (title.length > 80) title = `${title.slice(0, 79).trimEnd()}…`

  const surface = str(raw.affectedSurface) || str(input.routeLabel) || str(input.route) || 'the app'

  const story: ShapedStory = {
    title,
    type,
    summary: str(raw.summary) || title,
    affectedSurface: surface,
    acceptanceCriteria: arr(raw.acceptanceCriteria).slice(0, 4),
    impact: scale(raw.impact),
    effort: scale(raw.effort),
  }

  // refId: echo the caller's on-screen value verbatim — never the model's (the tool has none).
  const refId = str(input.refId)
  if (refId) story.refId = refId

  const note = str(raw.groundingNote)
  if (note) story.groundingNote = note

  if (type === 'ISSUE') {
    story.reproSteps = arr(raw.reproSteps).slice(0, 5)
    // Ground likelyFiles against the real allowlist: keep only known paths (order-preserved,
    // de-duplicated). Anything else is a guess. Ungroundable ⇒ [].
    const allow = new Set(candidates)
    story.likelyFiles = [...new Set(arr(raw.likelyFiles))].filter(f => allow.has(f))
  }
  return story
}

/** One forced-tool round-trip on the reasoning model (vision-capable). No sampling params —
 *  Sonnet 5 rejects them; grounding comes from the system prompt + the screenshot. */
async function shapeStory(
  client: Anthropic, imageBlock: Anthropic.ImageBlockParam | null,
  input: ShapeFeedbackInput, candidates: string[],
): Promise<ShapedStory> {
  const surface = str(input.routeLabel) || str(input.route) || 'the app'
  const lines = [
    `Raw title: ${input.rawTitle.trim()}`,
    input.rawDetail?.trim() ? `Raw detail: ${input.rawDetail.trim()}` : 'Raw detail: (none provided)',
    `Surface: ${surface}${input.route ? ` (route ${input.route})` : ''}`,
    input.entityPath?.trim() ? `Entity in context: ${input.entityPath.trim()}` : '',
    input.refId?.trim() ? `On-screen refId / form number: ${input.refId.trim()}` : '',
    input.screenshotUrl
      ? (imageBlock ? 'An annotated screenshot is attached — read it.' : 'A screenshot was provided but could not be loaded; shape from the text alone.')
      : '',
    candidates.length
      ? `Candidate source files for this surface (for an ISSUE, choose likelyFiles ONLY from these; return an empty list if none fit):\n${candidates.map(f => `- ${f}`).join('\n')}`
      : 'No candidate source files are known for this surface; return an empty likelyFiles.',
    '',
    'Shape this into one structured story, then call shape_feedback exactly once.',
  ].filter(Boolean)

  const content: Anthropic.ContentBlockParam[] = []
  if (imageBlock) content.push(imageBlock)
  content.push({ type: 'text', text: lines.join('\n') })

  const msg = await client.messages.create({
    model:       MODEL,   // claude-sonnet-5 — vision-capable; adaptive thinking, no sampling params
    max_tokens:  1500,
    system:      SHAPE_SYSTEM,
    tools:       [SHAPE_TOOL],
    tool_choice: { type: 'tool', name: SHAPE_TOOL.name },
    messages:    [{ role: 'user', content }],
  }, { timeout: 60_000 })

  const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  return sanitizeStory((tu?.input as Record<string, unknown> | undefined) ?? {}, input, candidates)
}

// ─── Dedup signal — a read-only near-duplicate pass over existing feedback ───────────────
// Reuses the shared lexical ranker (shared/src/search/rank.ts) over the feedback collection —
// no AI call, deterministic, and cheap. (The searchIndex collection holds product entities,
// not feedback, so near-DUPLICATE feedback lives in `feedback` itself.) Reads only; never writes.
const NEAR_MATCH_THRESHOLD  = 0.5   // cosine ≥ this ⇒ a strong near-duplicate worth surfacing
const NEAR_MATCH_SCAN_LIMIT = 200   // bound the read; the board is small

async function findNearMatch(rawTitle: string, rawDetail?: string): Promise<ShapeFeedbackOutput['nearMatch']> {
  try {
    const snap = await getFirestore().collection('feedback').limit(NEAR_MATCH_SCAN_LIMIT).get()
    if (snap.empty) return undefined
    const docs: RankDoc[] = snap.docs.map(d => {
      const data = d.data() as Partial<Feedback>
      return { id: d.id, text: `${data.title ?? ''} ${data.detail ?? ''}`.trim() }
    })
    const [top] = rankDocuments(`${rawTitle} ${rawDetail ?? ''}`.trim(), docs, 1)
    if (!top || top.score < NEAR_MATCH_THRESHOLD) return undefined
    const title = (snap.docs.find(d => d.id === top.id)?.data() as Partial<Feedback> | undefined)?.title
    return { id: top.id, title: typeof title === 'string' && title ? title : '(untitled)', score: Math.round(top.score * 1000) / 1000 }
  } catch (e) {
    // Best-effort only — never fail shaping because the dedup read/rank hiccuped.
    console.warn('[shapeFeedback] near-match scan skipped:', e)
    return undefined
  }
}

// ─── The callable ────────────────────────────────────────────────────────────────
export const shapeFeedback = onCall<ShapeFeedbackInput>(
  { secrets: [ANTHROPIC_API_KEY], maxInstances: 5, timeoutSeconds: 90, memory: '512MiB' },
  async (req): Promise<ShapeFeedbackOutput> => {
    // Any signed-in user may shape feedback — VIEWER included (VIEWER may submit + vote on
    // feedback per the role matrix). No role gate; this reads only. Authenticate via the shared
    // verifier over the callable's raw request (Bearer ID token), same path every endpoint uses.
    try {
      await authenticate(req.rawRequest)
    } catch (e) {
      throw new HttpsError('unauthenticated', e instanceof AuthError ? e.message : 'Sign in to shape feedback.')
    }

    const raw = req.data ?? ({} as ShapeFeedbackInput)
    const rawTitle = raw.rawTitle?.trim()
    if (!rawTitle) throw new HttpsError('invalid-argument', 'rawTitle is required.')

    // Bound every field so a huge paste can't blow the prompt or cost.
    const input: ShapeFeedbackInput = {
      rawTitle:      rawTitle.slice(0, 300),
      rawDetail:     raw.rawDetail?.slice(0, 4000),
      routeLabel:    raw.routeLabel?.slice(0, 120),
      route:         raw.route?.slice(0, 300),
      entityPath:    raw.entityPath?.slice(0, 300),
      refId:         raw.refId?.slice(0, 60),
      screenshotUrl: raw.screenshotUrl,
    }
    const candidates = candidateFiles(input.route, input.routeLabel)

    // Shape (fetch screenshot → forced-tool call) and the read-only dedup scan run concurrently.
    // NOTHING is written here — not even telemetry: all persistence is later, client-side, via mutate().
    try {
      const client = anthropic()
      const shaping = (async () => {
        const imageBlock = input.screenshotUrl ? await fetchScreenshot(input.screenshotUrl) : null
        return shapeStory(client, imageBlock, input, candidates)
      })()
      const [nearMatch, story] = await Promise.all([
        findNearMatch(rawTitle, input.rawDetail),
        shaping,
      ])
      return { story, ...(nearMatch ? { nearMatch } : {}) }
    } catch (err) {
      console.error('[shapeFeedback] internal error:', err)
      throw err instanceof HttpsError ? err : new HttpsError('internal', 'Could not shape this feedback. Please try again.')
    }
  },
)
