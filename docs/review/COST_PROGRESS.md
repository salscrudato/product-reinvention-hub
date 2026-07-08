# AI Cost Progress

> **Append-only through the cost-optimization phase.** Each entry records what changed, the
> projected/measured cost delta vs [COST_BASELINE.md](COST_BASELINE.md), and the guardrail
> checks that held. Newest entry last.
>
> **Methodology note (read first).** This environment has **no live Anthropic key** (offline
> emulator/gate only), so per-call cache-hit ratio and escalation rate cannot be *measured*
> here — exactly as COST_BASELINE.md's token counts were per-call estimates, not live
> counters. The numbers below are therefore **structural projections** derived from the
> prompt structure + the pricing table, clearly labelled as such. The live counters that will
> replace them are now **recorded per call** (`tier`, `escalated`, cache read/write tokens)
> and surfaced in the **Admin › AI Cost** tab, so 7 days of production data will populate the
> real ratios without further code.

---

## 2026-07-08 — Caching + call-gating + cheap-first cascade

### Gate + regression (measured, this run)

| Check | Result |
|---|---|
| `pnpm typecheck` (all workspaces) | ✅ green |
| `pnpm lint` (all workspaces) | ✅ green (only pre-existing `isoImport.test.ts` warnings) |
| `pnpm test:unit` (169 shared/app + 25 functions) | ✅ **194 passed** |
| **Canary — Personal Home** | ✅ **$1,528** exact |
| **Canary — Personal Auto** | ✅ **$1,002** exact |
| `pnpm build` (app) | ✅ green |
| `pnpm eval` | ✅ **4/4 cases + 3/3 grounding guards** (grounding/citation pass rate **unchanged**) |

Grounding held: the eval validation layer (citation guards, sanitizers, shape checks) is
untouched, so the 4/4 + 3/3 result is identical to the P2 baseline. Seed inventory at run
time: 108 known refIds · 24 known form numbers.

---

### Part A — Prompt caching (explicit 1h TTL) + call-gating

**Every AI endpoint now marks its stable prefix with a single 1-hour cache breakpoint**
(`runtime.CACHE_1H`). Caching is a prefix match (order tools → system → messages): the
breakpoint sits on the last stable block and the volatile per-request suffix stays after it.
1h TTL is GA (verified at docs.claude.com — no beta header) and keeps the prefix warm across
the minutes-long gaps a 5m TTL drops (a workspace session, the nightly news run, a multi-turn
claims/extraction request).

| Endpoint | Cached prefix | Effective now? |
|---|---|---|
| `chat` / `draftRule` / `scaffoldProduct` (Sonnet) | `SYSTEM_PROMPT` + feature system + `TOOLS` (~1.5K tok) | **Yes** — > Sonnet's 1024-tok floor; reads at 0.1× on turns 2+ and repeat requests |
| `analyzeClaim` (Sonnet) | claims system + `TOOLS` + **the uploaded document** | **Yes** — biggest win: the policy doc is read once and reused across turns at 0.1× |
| `extractCoverages` (Sonnet/Haiku) | `SYSTEM` + 4 forced tools + **the base form** | **Yes** — doc read once per model across the 4 sections |
| `summarizeProduct` (Haiku) | analyst instruction + `product_summary` tool | **Latent** — below Haiku's 4096-tok floor today; activates free if the prefix grows |
| `describeForm` (Haiku) | analyst instruction | **Latent** (< 4096) |
| `refreshNews` / `nightlyNews` (Haiku) | scout instruction + `web_search` tool def | **Latent** (< 4096); reused across `pause_turn` turns once past the floor |

> Honest note: the four Haiku endpoints carry the breakpoint per the phase spec, but Haiku's
> **4096-token** minimum cacheable prefix means their small prefixes are a correctness-neutral
> **no-op today** (Anthropic silently skips caching below the floor — no error) that becomes
> effective the moment the prefix crosses 4096 tokens. The Sonnet-tier caches (1024 floor) are
> effective now.

**Pricing correction.** Every breakpoint we write is 1h, and a 1-hour cache write bills at
**2× input** (vs 1.25× for 5m). `telemetry.ts` now prices `cacheWrite` at 2× (Sonnet $6.00,
Haiku $1.60 /MTok) so `estimatedUsd` is exact. Writes are a small slice of steady-state cost —
a stable prefix is read far more than written — so blended cost still falls.

**A4 — two billed triggers removed (no cost without intent):**
- **Overview auto-summary.** `ProductSummaryDashboard` no longer auto-runs `summarizeProduct`
  on mount (it fired once per product per session). It now hydrates a summary generated
  earlier this session from `sessionStorage` and otherwise shows an explicit **Generate AI
  summary** affordance. On a large portfolio this removes N auto-billed Haiku calls per
  session; the polished dashboard + session cache are preserved.
- **Home starter pills.** Pills now **prime the composer** (`setInput`) instead of firing a
  full chat turn on click; the user reviews and sends. Prompts were refreshed to the reseeded
  portfolio (Personal Home HO-3 · Personal Auto) so a primed ask lands on citable data.

---

### Part B — Cheap-first cascade (haiku-first, escalate only on a failed check)

Applied to the **classification / extraction-first-pass** call sites the fast model handles
well, reusing the **existing verifiers** as the escalation check. Sonnet is reserved for
**final reasoning + user-facing grounded answers**; the already-Haiku endpoints are unchanged.

| Feature | Policy | Escalation CHECK (reused verifier) | Rationale |
|---|---|---|---|
| `identifyBaseForm` | **haiku → sonnet** | Neither a printed form number nor a recognised line (HO/GL) came back | Header classification; metadata for a library card the author reviews — no quality-floor risk |
| `extractCoverages` | **haiku → sonnet, per section** | Sanitizer dropped **all** proposed items (fabrication), or coverages/forms section is empty (under-read) | Extraction first-pass; the **dominant cost driver**; human-curated proposals with confidence + citations |
| `chat` | **sonnet only** | — | User-facing grounded prose, streamed — post-stream escalation would re-stream/duplicate visible text (UX-unsafe). Quality floor. |
| `analyzeClaim` | **sonnet only** | `determinationIsCited` (server-rejects uncited verdicts) | Item 5: the determination stays Sonnet-grade + server-rejected if uncited. Unchanged. |
| `draftRule` / `scaffoldProduct` | **sonnet only** | `verifyDraft` / `verifyScaffold` (drop ungrounded refs) | "Final reasoning"; streamed emit — mid-stream escalation would show two cards. Grounding still enforced by the verifier on Sonnet. |
| `summarizeProduct` / `describeForm` / `refreshNews` / `nightlyNews` | **haiku only** | (already cheap) | Already the fast model — nothing to downgrade |

**Escalation is per-call and only on a failed check** — extraction escalates *only the failing
section*, so a well-formed form pays Sonnet for nothing. The two hard guarantees are untouched:
`analyzeClaim` stays Sonnet-grade and server-rejects an uncited verdict; no streamed user-facing
grounded answer is silently Haiku-only.

---

### Projected per-feature delta vs COST_BASELINE.md (structural — live counters pending)

| Feature | Baseline (Sonnet, no cache) | Mechanism | Projected direction |
|---|---|---|---|
| `extractCoverages` | ~$0.031/call | Haiku-first sections (input 3.75× cheaper, output 3.75× cheaper) + doc cache; Sonnet only on a failed section | **↓ ~50–70%** on well-formed forms; ↑ only for the rare all-fabricated/under-read section that escalates |
| `identifyBaseForm` | ~$0.001/call | Haiku-first; Sonnet only when the header can't be read | **↓ ~60–70%** in the common HO/GL case |
| `chat` | ~$0.018 first turn | 1h cache of ~1.5K-tok tools+system prefix → 0.1× on turns 2+/repeat requests | **↓** per subsequent turn (prefix slice ~90% cheaper), now surviving 5–60 min session gaps |
| `analyzeClaim` | ~$0.021/call | 1h cache of the uploaded document across turns | **↓** materially on multi-turn conversations (doc no longer re-billed per turn) |
| `draftRule` / `scaffoldProduct` | ~$0.014 / ~$0.020 | 1h cache of tools+system across the tool loop | **↓** on the cached prefix slice |
| Haiku endpoints | ~$0.001–0.017 | breakpoint latent < 4096 tok | **flat** today; ↓ once prefix grows |

**Blended cost drops** (extraction — the largest line — moves to a 3.75×-cheaper model on the
common path, and the two heaviest Sonnet contexts (chat prefix, claims document) now read from
cache), **with grounding held** (eval 4/4 + guards 3/3, validation layer untouched).

---

### Observability (Part B6) — now in Admin › AI Cost

- **`tier` (`cheap`/`strong`) + `escalated`** recorded on every usage record (`recordCascade`
  writes an accurate per-model split; non-cascade sites default correctly).
- **Cache-hit ratio** tile (already present) + a **Cheap-first cascade** panel: cheap vs strong
  calls, escalations, strong-spend share, and the **escalation rate**.
- **Per-feature escalation** column ("Escal.") pinpoints a drifting verifier.
- **Configurable alarm** (localStorage): an escalation-rate threshold (default 50%) and a spend
  cap ($/window, 0 = off) raise a banner when breached — the known failure mode (a drifting
  verifier escalating everything) drives the escalation rate toward 100% and trips the alarm.

### Hostile self-review

- **Volatile value inside a cached prefix?** No — every breakpoint is on the last *stable*
  block; per-request context (focus product, metadata JSON, form fields, instruction, the
  document body) all sit *after* the breakpoint.
- **Gating regressed UX?** No — the Overview still shows an instantly-hydrated session summary
  and a clean Generate CTA; Home pills still one-tap-prime the composer.
- **A user-facing grounded answer silently Haiku-only?** No — `chat`, `analyzeClaim`,
  `draftRule`, `scaffoldProduct` stay Sonnet; only human-reviewed extraction/identification
  classify on Haiku first.
- **Escalation rate can climb to ~100% unnoticed?** No — it is recorded per feature, surfaced,
  and alarmed.
- **Any grounding case regressed?** No — eval 4/4 + guards 3/3; both canaries exact.
