# NEWS_TENANT_SPEC — tenant-carrier profile driving the news scout (P1 → P2)

**Status:** SPEC_READY (P1, 2026-07-15).

## 1. The profile entity

One per tenant, standard entity write path (adapter.db.mutate → envelope, audited):

```jsonc
// path: tenantProfile/main   coll: 'tenantProfile'
{
  "carrierName": "Accenture Test Mutual",     // display + search anchor; REQUIRED
  "aliases": ["ATM Insurance"],               // optional search variants
  "lobs": ["PH", "PA", "GL"],                 // LOB registry keys
  "market": "personal|commercial|both",
  "states": ["OH", "NJ"],                     // optional footprint
  "watchTopics": ["telematics", "wildfire"],  // optional operator-curated
  "competitors": ["…"]                        // optional
}
```

Editable in Tenant Admin (existing per-tenant config surface). No profile doc → fallback
(§3). VIEWER read-only as everywhere.

## 2. Personalization contract (scout query)

The nightly scout already composes `${scope}\n\n${instruction}`
(`server/lib/ai/refresh-news.js:307`) where `scope` today is derived from the tenant's
products (`refresh-news.js:228-231`). Change: `buildScope(tid)` becomes profile-first —

1. Profile exists → scope = carrierName + aliases + LOB names (registry captions) + market +
   states + watchTopics + product names (existing query as enrichment, capped).
2. The per-user `newsPrefs/<uid>` instruction (`refresh-news.js:289-291`) keeps its current
   precedence — it appends to, never replaces, the tenant scope.
3. Guardrail unchanged: items must come from real `web_search` results; the honest
   `web_search_unavailable` failure path (`refresh-news.js:310-314`) is untouched.
4. Matching: `matchToProductIds` (exported at `refresh-news.js:359`) additionally tags items
   matching `carrierName`/`aliases` with `matchedCarrier: true` — the brief and News page may
   badge these "about you".

## 3. Fallback (the contract when the profile is absent/thin)

Absent profile → today's behavior byte-for-byte (portfolio-derived scope). Thin profile
(carrierName only) → carrierName + portfolio scope. A profile never *narrows* below the
portfolio scope — it only adds signal; a wrong carrierName can bias but not silence the feed.

## 4. Tests P2 owes

buildScope: profile-first composition; absent-profile fallback byte-parity with current
scope; newsPrefs append precedence. matchToProductIds: carrier tagging. Admin surface: EDITOR
can save profile, VIEWER cannot (server-enforced, existing role guard).
