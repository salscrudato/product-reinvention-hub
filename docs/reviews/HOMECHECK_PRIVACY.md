# HomeCheck — Privacy Posture

**Companion to:** `server/lib/homecheck.js`, `app/src/routes/HomeCheck.tsx`
**Last updated:** 2026-07-11
**Audience:** engineering, legal, infosec, product

---

## 1. What HomeCheck is

HomeCheck is a consumer-facing home risk check surface accessible without authentication at `/home-check`. It accepts a property address and optionally property photos, then returns a risk report drawn entirely from free public government data sources. The digital-twin inventory uses AI vision to extract a list of home contents from uploaded photos.

HomeCheck is structurally isolated from the B2B portfolio: it has no access to the Cosmos data store, no JWT tenant scope, and no authentication requirement.

---

## 2. Data collected and how it is used

| Data | Why collected | Where processed | Retention |
|---|---|---|---|
| **Property address** | Geocode to lat/lon and census tract for risk API queries | Server-side only; never written to any database | Not retained after the API response is returned |
| **Photos (optional)** | AI vision inventory extraction | Server-side in-memory; transmitted over HTTPS to GPT-5.1 (Azure AI Foundry) | Photo bytes: discarded immediately after AI call. Item list: in-memory Map, 24-hour TTL. Never written to disk or database. |
| **Extracted item list** | Displayed to consumer; exportable as proof-of-condition HTML | Server-side in-memory session (24-hour TTL) | Deleted on explicit `DELETE /api/homecheck/v1/inventory/:sessionId` or automatic expiry (24 h). |
| **Client IP address** | Rate limiting (per-IP token bucket) | In-memory Map (server), not logged to any persistent store | Rate-bucket state lives in process memory; discarded on restart |

**Data NOT collected:** name, email, phone, payment details, insurance policy numbers, B2B tenant data, browser fingerprint, device identifiers.

---

## 3. Consent for photo processing

Before a consumer can upload photos, they must affirmatively check a consent box whose label reads:

> "I understand and consent to photo processing"

The consent UI block explains:
- Photos are sent to the server and processed by AI (GPT-5.1 via Azure AI Foundry)
- Photos are **not stored to any database** — only the extracted item list is retained
- Session data expires in 24 hours
- Consumers may delete their session at any time
- Photos are not shared with third parties or used for AI model training

**Enforcement:** The `/api/homecheck/v1/inventory` endpoint returns `HTTP 403` with `error: "consent_required"` if the request body does not include `consent: true`.

---

## 4. Retention policy

| Item | Retention | Delete path |
|---|---|---|
| Address (in-flight) | None — used for API queries, discarded | N/A |
| Photos (in-flight) | None — base64 string in request body, discarded after GPT-5.1 call | N/A |
| Item list (session) | 24 hours from upload | `DELETE /api/homecheck/v1/inventory/:sessionId` |
| Rate-limit buckets | Process memory only; reset on restart | N/A (no PII stored in bucket) |

The server never writes to Cosmos, Azure Blob, or any persistent store for the HomeCheck surface.

---

## 5. B2B portfolio isolation

`server/lib/homecheck.js` enforces structural isolation by:

1. **No Cosmos import** — The module contains a header comment making clear that importing `./cosmos`, `./data`, `./auth` (requireRole), or any B2B data module is a security defect.
2. **No JWT auth** — The `/api/homecheck/v1/*` routes use guest IP-based rate limiting, not `requireAuth`/`requireRole`. A guest consumer cannot craft a JWT that grants access to portfolio data.
3. **No Cosmos writes** — Audit events and mutations written by `server/lib/data.js` are absent from this module. Session data lives in a module-local `Map`.
4. **Static assertion at mount time** — The module exports only an Express router; it cannot be parameterized with a Cosmos handle after the fact.

**Hostile review question:** _Can any consumer input reach the B2B portfolio data?_ No. The isolation is structural: this module never imports the data layer, has no Cosmos handle, and the only shared module (`server/lib/auth.js`) is never imported here.

---

## 6. Rate limiting

| Bucket | Limit | Key | Mechanism |
|---|---|---|---|
| `risk` (address queries) | 10 / hour | Per source IP | Token bucket (in-memory) |
| `vision` (photo uploads) | 3 / hour | Per source IP | Token bucket (in-memory) |
| `report` (HTML download) | 20 / hour | Per source IP | Token bucket (in-memory) |

Exceeded requests return `HTTP 429` with a `Retry-After` header. The limits are configurable via env vars (`HC_RISK_RATE_CAP`, `HC_VISION_RATE_CAP`, `HC_REPORT_RATE_CAP` and corresponding `_RPS` vars). The Azure WAF / Front Door is the production-grade ceiling; these are the in-app guards.

The rate limiter key is the source IP from `X-Forwarded-For` (or `req.socket.remoteAddress` as fallback). It does not track user identity, as guests have none.

---

## 7. AI processing details

**Vision inventory** uses the Azure AI Foundry deployment `gpt-5.1` (OpenAI-compatible surface, `AZURE_FOUNDRY_ENDPOINT/openai/v1/chat/completions`). The prompt instructs the model to extract structured item data and return JSON. Photos are sent as `image_url` content blocks (base64 data URLs, never uploaded to a separate storage service). The model's response is parsed server-side; raw model output is not returned to the client.

**No Anthropic/Claude model is used for vision.** Claude is not used in the HomeCheck consumer surface at all — the B2B portfolio copilot (Opus 4.8) and claims copilot (Haiku 4.5) are only accessible behind authenticated tenant-scoped sessions.

**Grounding and citation:** Risk report facts are attributed to their source data in every response. The AI (GPT-5.1) is used for **structured extraction from photos only** — it does not generate or narrate risk text. All risk facts come from the public APIs (FEMA NRI, NFHL, USGS, NOAA, USDA) and are returned with citation strings.

---

## 8. First Street Foundation data

First Street Foundation's FloodFactor, FireFactor, and HeatFactor products are **licensed data** requiring a paid API agreement. They are **not wired** in this codebase. The `firstStreetSeam()` function in `server/lib/homecheck.js` returns a documented stub with `licensed: false, wired: false`.

The report UI surfaces a note to consumers explaining that this enriched property-level risk data exists but requires a license. The seam is documented in the server module header; wiring it requires:
1. Obtaining a license from First Street Foundation
2. Setting `FIRST_STREET_API_KEY` in App Service configuration
3. Replacing the stub with the live API call
4. Updating attribution per First Street's terms: `"First Street Foundation, [year]. First Street National Model. first.foundation"`

---

## 9. Accessibility

The HomeCheck route (`/home-check`) uses:
- Semantic HTML (`<nav>`, `<main>`, `<footer>`, `<form>`, `<label>`, `<ul>/<li>`)
- Explicit `aria-label` on all icon-only buttons
- `role="alert"` on error banners and active weather alert announcements
- `aria-expanded` on collapsible cards
- All color pairs validated to WCAG AA (≥4.5:1) using the platform token set

Axe checks are required on `/home-check` before shipping. Run `pnpm test:axe` (or your configured axe runner) against this route and verify zero violations.

---

## 10. PWA layer

The `/home-check` shell is added to the service worker's `APP_SHELL` array so the route is cached on install and available offline. Hazard JSON from `/api/homecheck/v1/risk` uses stale-while-revalidate caching (15-min TTL) so a previously fetched risk report is readable offline. The manifest provides installability; the `start_url` is `/` (the main app) — HomeCheck is a sub-route of the same installable app.

---

## 11. What changes need legal/compliance review

Before enabling HomeCheck in production:

1. **Update the app's privacy policy** to disclose photo processing via third-party AI (Azure AI Foundry/GPT-5.1) and the 24-hour session retention.
2. **GDPR/CCPA:** If the service is offered to EU or California residents, the consent disclosure must meet applicable notice and consent requirements. The current consent UI is a checkbox; a more detailed disclosure may be required.
3. **Children:** HomeCheck does not collect age information. If there is a risk of use by minors (COPPA), add an age gate or terms acknowledgement.
4. **First Street license terms:** Review the attribution and redistribution requirements before wiring the paid API.
5. **USDA/USFS attribution:** The USDA Forest Service WHP dataset requires attribution in distributed outputs. The downloadable HTML report includes this attribution; verify compliance with the specific license terms of the current WHP release.
