// interpretSearch — the LLM fallback for the global command bar's natural-language
// queries. Server-side per the binding invariants (the browser never calls Anthropic),
// on claude-sonnet-5 (the reasoning model; no sampling params — Sonnet 5 rejects them).
//
// It returns a filter SPEC as JSON only (no prose, no fences) matching the client's
// filter-spec schema. It reads nothing and writes nothing — it maps a phrase onto the
// controlled vocabularies below. The browser re-validates every value against the real
// schemas and discards unknowns, then applies the result as visible, editable chips, so a
// hallucinated value can never silently hide entities. Any signed-in user may call it
// (read-only), including VIEWER.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { ANTHROPIC_API_KEY, anthropic, MODEL, CACHE_1H } from './runtime'

interface InterpretInput { query: string }

// The controlled vocabularies, mirrored server-side. The client re-validates against the
// live schemas, so this is the model's guide, not the source of truth.
const SYSTEM = `You translate a product manager's natural-language query about insurance product configuration into a filter spec. You choose exactly ONE entity type to filter, and return JSON only.

Entity types and their allowed facets (use the exact values shown):

rule:
  hierarchies.category.parents: ["PRODUCT","RATING","FORMS"]
  hierarchies.category.children: ["Product Eligibility","Product Availability","Packaging / Line of Business","Bundling","Base Coverage (Default)","Mandatory Inclusion/Exclusion of Coverage","Optional Coverage Eligibility","Limit Ranges and Defaults","Deductible Ranges and Defaults","Minimum / Additional / Return Premium","Forms Attachment Conditions"]
  enums.status: ["Active","Inactive","Future"]
  enums.review: ["Not started","In progress","Business review","Approved","Rejected"]
  enums.state: two-letter US codes, e.g. "CA","TX"

coverage:
  enums.requirement: ["Included","Optional"]
  enums.status, enums.review, enums.state: same as above
  text: free text to match a coverage name

form:
  enums.category: ["Base coverage","Declarations","Endorsement","Exclusion","Amendatory","Policy notice"]
  enums.requirement: ["Mandatory","Optional"]
  enums.status, enums.review, enums.state: same as above
  text: free text to match a form number or name

Output JSON shape (omit empty keys):
{"entityType":"rule|coverage|form","enums":{"status":["Active"]},"hierarchies":{"category":{"parents":["PRODUCT"],"children":["Optional Coverage Eligibility"]}},"text":"...","explanation":"one short sentence, no jargon"}

Rules:
- Output JSON only. No prose, no markdown fences.
- Use only the exact facet values listed. If a concept has no matching facet, put it in "text".
- Pick the single most relevant entity type.
- "explanation" restates the filter in plain words. No em-dashes. No emoji.`

/** Strip markdown fences and isolate the first JSON object, then parse. Returns null on
 *  any failure so the caller degrades gracefully. */
function parseSpec(raw: string): Record<string, unknown> | null {
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    const parsed: unknown = JSON.parse(s.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const interpretSearch = onCall<InterpretInput>(
  { secrets: [ANTHROPIC_API_KEY], maxInstances: 5 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in to use AI interpretation.')
    const query = req.data?.query?.trim()
    if (!query) throw new HttpsError('invalid-argument', 'query is required.')
    if (query.length > 500) throw new HttpsError('invalid-argument', 'query is too long.')

    const msg = await anthropic().messages.create({
      model: MODEL,               // claude-sonnet-5 — no sampling params (rejected by the model)
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM, cache_control: CACHE_1H }],
      messages: [{ role: 'user', content: query }],
    }, { timeout: 30_000 })

    const text = msg.content.find((b) => b.type === 'text')?.text ?? ''
    const spec = parseSpec(text)
    if (!spec) throw new HttpsError('internal', 'Could not interpret the query.')
    return spec
  },
)
