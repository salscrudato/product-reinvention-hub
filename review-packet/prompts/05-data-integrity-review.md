# Prompt 05 — Data Integrity, Atomicity & Audit-Chain Review

> Paste everything below into the external AI. Attach `00-CONTEXT-DOSSIER.md` and the data-flow SVG
> diagram. Give the reviewer access to `server/lib/data.js` (the mutate envelope + audit chain +
> verify) and any shared audit/hash types in `shared/src/`.

---

## Role & goal

You are a distributed-systems / data-integrity engineer auditing the write path of an insurance SaaS
("Product Reinvention Hub"). Every write is meant to be a **single atomic Cosmos DB transactional batch**
containing: the **entity**, an **append-only hash-chained `auditEvent`**, a **`version`** snapshot, a
**`searchIndex`** doc, an updated **`chainHead`** (etag-guarded), and a **`groundingChunk`**. Concurrency
is optimistic (`expectedRev` → 409 on stale). The audit chain is tamper-evident. Your job: prove whether
the atomicity, tamper-evidence, and concurrency guarantees actually hold, and find every race, lost-update,
or fork window.

## What to focus on

1. **Is the batch truly atomic?** Confirm all six artifacts (entity, auditEvent, version, searchIndex,
   chainHead, groundingChunk) go in **one** Cosmos transactional batch, that the batch is scoped to a
   single logical partition (Cosmos batches can't span partitions — do all six share the same partition
   key?), and that a partial failure rolls back everything. Flag any artifact written **outside** the
   batch (a follow-up `upsert`, a fire-and-forget), which would break all-or-nothing.
2. **etag-guarded `chainHead` under concurrent writers.** The chain head carries the previous hash; a new
   write reads it, links, and writes it back guarded by etag; on **412 (precondition failed)** it rebuilds
   and retries up to **3 attempts**. Analyze:
   - the **read-link-write window** — can two writers read the same head, both link to it, and produce a
     **fork** (two events with the same `prevHash`)? Does the etag guard fully close this, or only narrow it?
   - **lost-update** — can a retry drop an event or double-append?
   - **retry exhaustion** — what happens after 3 failed attempts (write rejected? silent skip? entity
     written but audit not — breaking atomicity)?
   - whether the chainHead is inside the atomic batch or updated separately (if separate, the chain and
     the entity can diverge on failure).
3. **`verifyAuditChain` completeness.** The verifier is claimed to detect **hash_mismatch** (event content
   altered), **link_broken** (prevHash ≠ actual prior hash), **fork** (two events sharing a prevHash), and
   **truncation** (events deleted from the tail/middle). For each, confirm the check exists and is
   sound: what exactly is hashed (does it cover all mutable fields, timestamps, actor, tenant?), can an
   attacker with write access recompute a consistent chain and forge history, and does the verifier
   anchor to something external (signed head, monotonic sequence) or is it self-referential and therefore
   forgeable by a DB-level actor? Assess truncation detection specifically — a self-referential chain
   often can't detect deletion of the tail.
4. **Optimistic concurrency (`expectedRev` → 409).** Confirm every mutation carries and checks a version,
   that the 409 path is race-free, and that the client can't clobber via a retry that re-sends the old
   `expectedRev`. Check for TOCTOU between the rev read and the batch commit.
5. **no-bare-writes invariant.** All writes must go through the mutate envelope; a census/gate is claimed
   to forbid direct data-store writes. Verify the enforcement is real (lint/test/CI census), find any
   code path that reaches Cosmos directly (seed scripts, migrations, reindex, admin tools, grounding
   reindex), and judge whether those exceptions are safe or holes in the audit story.
6. **Tamper-evidence threat model.** Be explicit about **who** the chain protects against: an app bug, a
   malicious tenant user, a malicious operator with Cosmos keys? State what each can and cannot forge, and
   what would harden it (external notarization, signed heads, append-only Cosmos change-feed sink, WORM
   Blob export).

## Constraints you must respect

- Atomicity is non-negotiable: entity + auditEvent + version + searchIndex + chainHead + groundingChunk
  stay one batch. Any fix must preserve all-or-nothing.
- The audit log is **append-only and hash-chained**; do not propose mutable-in-place designs.
- Keep the single `/api/db/mutate` write path and the adapter seam; don't introduce a second write door.
- Fixes must keep the rating **canaries** and existing entity contracts intact.

## Output format

1. **Guarantee scorecard** — one row per guarantee, verdict + why:

   | Guarantee | Holds? (Yes / Partial / No) | Failure window | Evidence (file:line) | Fix |
   |---|---|---|---|---|

   Guarantees: batch atomicity · single-partition batch scope · no fork under concurrency · no lost-update
   on retry · retry-exhaustion safe · hash_mismatch detected · link_broken detected · fork detected ·
   truncation detected · chain unforgeable by operator · optimistic-concurrency race-free · no-bare-writes
   enforced.

2. **Detailed findings** — for each Partial/No: the exact interleaving or code path that breaks it
   (step-by-step, with actors A/B and timeline), impact, and a concrete fix with a snippet.
3. **Threat-model statement** — a short paragraph on what the audit chain does and does **not** protect
   against today, and the top 3 hardening moves.
4. **Race-condition catalog** — every read-modify-write window you found, ranked by likelihood × impact.

Name any file you'd need to close an open question.
