// health.ts — lightweight authed callable to verify the Functions pipeline + secret wiring.
// Any authenticated caller (any role) may invoke it. It makes NO model call and NEVER echoes a
// secret value — it returns only booleans about secret PRESENCE, so it is safe to expose.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { ANTHROPIC_API_KEY, VOYAGE_API_KEY, voyageKey } from './runtime'

export const hello = onCall(
  // Bind the secrets so `.value()` resolves at runtime. Binding does not expose them to callers.
  { maxInstances: 10, secrets: [ANTHROPIC_API_KEY, VOYAGE_API_KEY] },
  (request) => {
    // Require a verified caller. onCall returns HTTP 200 on a normal return; an unauthenticated
    // caller gets a `unauthenticated` error instead (never a 200).
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to call hello.')

    // ANTHROPIC key must be present + non-empty for the AI pipeline to work. `.value()` throws if
    // the secret isn't bound; treat any throw/empty as "not configured". The value is never read
    // into the response — only the boolean.
    let ok = false
    try { const k = ANTHROPIC_API_KEY.value(); ok = !!(k && k.trim()) } catch { ok = false }

    return {
      ok,                       // ANTHROPIC_API_KEY present + non-empty (retrieval-independent)
      voyage: !!voyageKey(),    // optional Voyage retrieval key present (falls back to lexical if not)
      message: 'Product Reinvention Hub Functions are alive.',
      uid: request.auth.uid,
      at: new Date().toISOString(),
    }
  },
)
