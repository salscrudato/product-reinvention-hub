# EXECUTION-B — Lane B: Filing generation with independent verifier

Prompt F2 Lane-B. Objective: five-step filing flow (SCOPE → RESOLVE → BUILD → VERIFY → FREEZE),
gated at the front (filing:generate, VIEWER server-blocked), frozen at the back (create-only,
hash-covered), with an independent MID_REASONER model verifier blocking fabrication before freeze.

## Orientation findings (reconciled with live code before designing)

- `server/lib/filing.js` **already implements the five-step flow** (built in the audit-integrity
  workstream, live-verified at `c132146`): capability gate, as-of version-history resolution,
  deterministic package + SHA-256 content/package hashes, write-once blob (`ifNoneMatch:'*'`),
  independent verifier with forced `extraction_verdict` tool call, create-only transactional
  freeze batch (filing + hash-chained audit + chainHead).
- Gaps vs this prompt:
  1. Verifier ran on **GROUNDED_CITED** (opus). Prompt requires the **MID_REASONER** role
     (claude-sonnet-5). The sonnet Foundry deployment may be unprovisioned on dev
     (import-brain caches its 404s), so the verifier needs a documented escalation:
     MID_REASONER first, climb the fleet ladder only on a missing deployment.
  2. No live tamper proof: need a probe that feeds the verifier a fabricated/altered field
     and can NEVER freeze, so the rejection path is provable end-to-end on dev.
  3. Immutability proof: mutate envelope ids (`ent:`/`ver:`/`idx:`/`chn:`) can never collide
     with `filing:*` ids, but `/api/db/mutate` with a `filings/...` path could still write
     entity docs into the reserved `${tenant}|filings` partition and upsert a colliding
     `chn:filings~<id>` chainHead. Adding an explicit reserved-base rejection (403).

## Work log

| When (ET) | What | Cost |
|---|---|---|
| start | Orientation: filing.js/fleet.js/data.js/auth.js/authz.js reconciled; row claimed | — |

## Self-review ledger

(to be completed at the end: field provenance, create-only proof, verifier rejection transcript)
