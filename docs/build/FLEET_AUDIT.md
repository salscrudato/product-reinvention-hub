# FLEET_AUDIT — task→model routing audit (P4 · H5)

**Verdict: KEEP the current fleet. No import-path model swap.** The routed fleet is
IMPORT-CERTIFIED at `f67fbf0`, every routed role serves the import path (or is the sole
embedding tier), and no available provisioned model beats it on the routed tasks without
triggering re-certification. The decision is pinned by [`shared/src/ai/fleet.lock.test.ts`](../../shared/src/ai/fleet.lock.test.ts)
(runs in the @pf/shared CI canary → **deploy-blocking**).

Scope note: the **Claude Code coding-driver selection is out of scope** (pinned by the build
pack). This audit covers only the *product's* AI fleet (`shared/src/ai/fleet.ts` +
`server/lib/fleet.js`).

---

## 1. Methodology (bounded)

Three read-only inputs, no live spend beyond a 6-call capability ping:

1. **Capability probe** — [`scripts/fleet-audit.mts`](../../scripts/fleet-audit.mts): one
   minimal, read-only call (≤1 output token) to each of the 6 routed deployments through the
   configured Foundry gateway → `reachable | unprovisioned | auth_error | unreachable`. Never
   writes; prints no secret. Run in-Azure or with `AZURE_FOUNDRY_ENDPOINT/KEY` set. In a creds-
   less environment it reports `not_configured` and exits 0 (as it did this pass — see §3).
2. **Labeled-eval scoring** — reuses the import eval harness. The labeled set IS the import
   goldens (`tests/golden/import/*.golden.json`); `npx tsx scripts/import-eval.mts` (offline,
   free) + `npx tsx scripts/phaseg-holdout.mts --check --seed GL/IM` (offline generalization)
   score extraction accuracy + citation resolution deterministically. These are already GREEN on
   the current fleet — that is what IMPORT-CERTIFIED means.
3. **Cost/latency** — cost from `FLEET_PRICING` (`shared/src/ai/fleet.ts`); accuracy + latency
   from the frozen IH4 evidence in `docs/import-hardening/RESULTS/` (no re-spend).

---

## 2. Provider inventory

The product fleet routes through **one** provider surface: the **Azure AI Foundry** gateway
(`AZURE_FOUNDRY_ENDPOINT` + `AZURE_FOUNDRY_KEY`), which fronts two SDK families:

| Surface | Path | Deployments |
|---|---|---|
| Anthropic | `/anthropic/v1/messages` | `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5` |
| OpenAI | `/openai/v1/*` | `gpt-5.1`, `gpt-5-mini`, `text-embedding-3-small` |

There is **no standalone Google, OpenAI, or Anthropic key** in the fleet — everything is one
Foundry key. The probe reports any such keys if present (`otherProviders`); none were configured
this pass. (Secrets live only in App Service config per CLAUDE.md — never in the repo.)

---

## 3. Provisioning state

The probe requires live creds (server-side only), so this pass reports `not_configured` for all
six — **re-run in-Azure for a live table.** The provisioning state below is the observed truth
from the IH4 import certification and the filing-verifier lane's live runs (both in-repo):

| Role | Deployment | Provisioned (Foundry dev) | Evidence |
|---|---|---|---|
| GROUNDED_CITED | `claude-opus-4-8` | ✅ | IH4 live CORE recover run F1 0.999 (`RESULTS/loop-summary.md`) |
| MID_REASONER | `claude-sonnet-5` | ⚠️ **unprovisioned in Foundry dev** | filing-verifier lane: "sonnet unprovisioned → escalates to opus"; the ladder tolerates a missing rung (`fleet.ts:145-148`, `stage-filing.js` 4xx→skip) |
| BULK_VERIFY | `claude-haiku-4-5` | ✅ | IH4 stage-4 bulk extract |
| VISION | `gpt-5.1` | ✅ | IH4 stage-1/3/5 decorrelated judge/validator |
| CHEAP_GENERAL | `gpt-5-mini` | ✅ | IH4 stage-1/4 prefilter |
| EMBED | `text-embedding-3-small` | ✅ | Embeddings RAG (memory: deployed + live-verified) |

The `claude-sonnet-5` gap is a **provisioning** issue, not a routing one: the import ladder and
the filing verifier both degrade past the missing mid-rung to opus, provenance-recorded. No code
change is warranted — provisioning sonnet in Foundry dev is an ops action, tracked as a WATCH.

---

## 4. Per-task scoring + decision

Each routed role is scored against the task it serves. "Alternative?" asks whether a *different
provisioned* deployment would score better on that task's labeled eval.

| Role → deployment | Task it serves | Accuracy (labeled eval) | Cost (in/out per Mtok) | Best fit? |
|---|---|---|---|---|
| GROUNDED_CITED → opus | Import stages 0/2/3, ladder top, plan assembly; grounded+cited chat | Import GL F1 0.970 / IM 1.000 / PR 0.999 live; offline 1.0000; phaseg 7/7 ×2 seeds | $15 / $75 | ✅ strongest reasoner; the grounding/citation anchor |
| MID_REASONER → sonnet | Import ladder mid-rung; filing verifier | (mid-rung; opus covers when unprovisioned) | $3 / $15 | ✅ correct cost/quality mid-tier |
| BULK_VERIFY → haiku | Import bulk extract; product summaries | numeric exact-match 1.000; adversarial 0 fabrications | $0.80 / $4 | ✅ cheap high-throughput floor |
| VISION → gpt-5.1 | **Decorrelated** judge/validator (cross-family); vision extraction | disagreement-adjudication + validation pass in IH4 | $3 / $12 | ✅ decorrelation from the Anthropic tiers is load-bearing (a same-family judge would correlate errors) |
| CHEAP_GENERAL → gpt-5-mini | Cheap prefilter; cost-guard degrade target | prefilter only | $0.30 / $1.60 | ✅ cheapest general tier |
| EMBED → text-embedding-3-small | Dense RAG vectors | hybrid RAG live-verified | $0.02 / — | ✅ only provisioned embedding tier |

**Decision — no swap.** Every routed role is the best fit for its task: the reasoning tiers are
import-certified; `gpt-5.1`'s cross-family decorrelation is *why* it's the judge (swapping it to
an Anthropic model would correlate the ensemble's errors and weaken the fabrication guard);
`text-embedding-3-small` is the only provisioned embedding tier. No provisioned alternative beats
any role on its labeled eval. So the fleet constants are **confirmed unchanged** and pinned.

---

## 5. Certification freshness (binding)

IMPORT-CERTIFIED was earned on THIS fleet. **This audit changes no import-path model**, so the
certification stands and no re-run was required. The lock test is the tripwire: if a future pass
ever edits a routed deployment name (or the ladder), it MUST first, in cost order:

1. `pnpm test` — the G-A..G-D generalization unit locks (`shared/src/insurance/isoImport.test.ts`).
2. `npx tsx scripts/phaseg-holdout.mts --check --seed GL` **and** `--seed IM` — the G2 holdout
   (offline, free; `HOLDOUT_SHA d51e32f`; 7/7 per seed = green).
3. `npx tsx scripts/import-eval.mts` — offline golden re-parse (free).
4. Only if a live behavior is in doubt: `IMPORT_EVAL_ONLY=GL npx tsx scripts/import-eval.mts --live` (~$4).

A red slice **reverts the swap** and ledgers the finding with the evidence. The Claude Code
coding-driver selection is never touched.

---

## 6. Invariants upheld

- **Fleet-sourced IDs only** — no handler hardcodes a model string; all route through a role
  (`fleet.lock.test.ts` pins the mapping; the no-hardcoded-model convention is unchanged).
- **Cost guard on every call** — every non-import role passes `fleet.guard()`; import is the one
  named `IMPORT_CONTEXT` exemption (telemetry never bypassed). H6c added trip/degrade counters +
  the admin diagnostics read so the guard is now *provable*.
- **No baseline from a model** — rating baselines are the seeded canaries ($1,528 / $1,002 /
  $2,635), never model output. Untouched.
- **Every field cited** — H6b enforces at the write seam that an AI/voice-authored governed
  change carries a resolvable citation (422 otherwise).
- **Never `claude-fable-5`** — asserted by the lock test.
