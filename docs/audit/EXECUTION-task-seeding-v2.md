# EXECUTION — Task Seeding v2 (reviewable · editable · product-linked)

Status: **built + gate-green for this slice · committed locally · UNPUSHED, awaiting human review.**
Scope: the launch-plan seeding flow only (Tasks board). No server files touched. No deploy.

The old "seed from process" modal was a single **phase-checkbox** step that blind-seeded 65 tasks
and, on re-seed, **deleted every seeded task and recreated them** (losing completions/edits).
It is replaced by a three-beat concierge flow — **Review → Adjust → Seed** — that shows the PM
every task before it lands, schedules forward-only, edits in place, and re-seeds **idempotently**.

---

## What shipped

| Area | File | Change |
|---|---|---|
| Planner (pure) | `shared/src/gtm/plan.ts` (new) | `planLaunch()` — forward-only scheduler + `seedRefIdFor()` stable identity + per-task overrides |
| Planner tests | `shared/src/gtm/plan.test.ts` (new) | forward-only floor, too-tight resolution, overrides, seedRefId uniqueness/stability (16 tests) |
| Scheduler | `shared/src/gtm/schedule.ts` | `+ toISODate()` (additive export). Existing `scheduleFromDeadline` **untouched** — its tests stay green |
| Types | `shared/src/types.ts` | `Task.seedRefId?` + `Task.seedBatchId?` (additive, optional) |
| Barrel | `shared/src/index.ts` | `export * from './gtm/plan'` |
| Payloads | `app/src/components/tasks/gtm/gtm.ts` | replaced `buildSeedPayloads`/`taskDataFromScheduled` with `buildSeedPlanPayloads`/`taskDataFromPlanned` (create-only, deterministic ids, lineage) |
| Review model | `app/src/components/tasks/gtm/seedReview.ts` (new) | present-set / selection / create-set — pure, testable |
| Review model tests | `app/src/components/tasks/gtm/seedReview.test.ts` (new) | deselection math + idempotency + payload lineage (11 tests) |
| Surface | `app/src/components/tasks/gtm/SeedReviewSheet.tsx` (new) | the Review→Adjust→Seed sheet |
| Surface tests | `SeedReviewSheet.test.tsx` + `SeedReviewSheet.axe.test.tsx` (new) | walk-the-flow (2) + axe over fresh/re-seed/too-tight (3) |
| Board | `app/src/routes/Tasks.tsx` | swap dialog → sheet; `?seedBatch=` filter + banner; one-time arrival flag; post-seed toast |
| Card | `app/src/components/tasks/gtm/TaskCard.tsx` | `arriving?` prop → `.task-arrive` |
| Motion | `app/src/index.css` | `@keyframes task-arrive` (.7s accent-ring pulse) + reduced-motion neutraliser |
| Removed | `app/src/components/tasks/gtm/SeedProcessDialog.tsx` | replaced by the sheet |

---

## 1) Scheduling rules, as implemented

The planner (`planLaunch`) is pure and deterministic — `today` is injected, all math is UTC ISO,
zero `Date.now` inside. It honours the business/calendar toggle for **both** spans and the floor.

- **Forward-only floor.** `earliestStart = next working day after today` (`addBusinessDays(today,1)`
  → Monday from a Fri/Sat/Sun today in business mode; tomorrow in calendar mode). No task ever
  starts before it.
- **Back-schedule to land on the deadline.** Pre-launch tasks (`phaseOrder ≤ 4`) chain adjacently
  so the **last** one's due date lands on the landing date; each task consumes `max(effectiveSla,1)`
  working days (zero-SLA milestones still take one slot).
- **The pivot is `landingDate = max(deadline, earliestLaunch)`.** `earliestLaunch = earliestStart +
  spanDays`. Back-scheduling from `landingDate` **guarantees** the first start ≥ `earliestStart`
  (round-trip identity), so nothing is ever scheduled into the past — the old scheduler's failure mode.
- **Deadline-too-tight = a calm resolution, never a silent truncation.** When `deadline <
  earliestLaunch`, `fits=false` and a `deadline-too-tight` warning carries `{neededDays, earliestLaunch}`.
  The plan still lands (on `earliestLaunch`), the footer shows *"needs N days; earliest launch is X"*,
  and offers two one-tap fixes: **Move deadline to X** (persisted on seed) or **deselect phases**.
  Seeding is **blocked** until it fits — no past-dated or past-deadline tasks are ever written.
- **Governance trails after launch.** `phaseOrder 5` forward-schedules from the landing date; `ongoing`
  tasks pin to launch with a null due date.
- **Editing = the two levers that fully determine a chained back-schedule.** The PM edits (a) the
  **deadline** (date input + ±1-working-day nudges; "Move to earliest") and (b) each task's **owner**
  and **duration (days)**. Duration is the honest per-task date lever: changing it reflows the chain
  forward-only and the live date range updates. Both are preserved onto the seeded task
  (`slaDays = effectiveSla`, `ownerRole = owner`). *(See hostile question #1 for the deliberate
  choice against absolute per-task date pins.)*

## 2) Idempotency proof

- **Stable identity.** `seedRefIdFor(t) = pm-<FNV32(L1 || L2 || L3 || L4)>` — reuses the repo's
  dependency-free `contentHash`. The 65 fixture rows have **zero duplicate L1–L4 paths** (verified;
  asserted by a test: `new Set(template.map(seedRefIdFor)).size === 65`). Unlike `globalOrder`, it is
  invariant under fixture regeneration.
- **Additive re-seed.** `computeReviewPlan` computes `present = presentSeedRefIds(priorSeeded)` (from
  the stored `seedRefId`, or recomputed from a legacy task's lineage) and `toCreate = plan.tasks.filter(t
  => !present.has(t.seedRefId))`. Re-seed **only creates what is missing** — existing seeded tasks
  (with any completions/edits) are never deleted or overwritten.
- **Deterministic doc ids.** Each create writes `tasks/gtm-<projectId>-<seedRefId>`, so the same row can
  never land twice even if the client filter were bypassed (`buildSeedPlanPayloads` idempotency test:
  same rows → same paths, independent of batch id).
- **Convergence.** Re-seeding an unchanged board proposes **0** tasks (`newCount === 0`, CTA disabled
  with *"Everything is already on the board"*) — tested.

## 3) Every mutate write in this feature

All writes go through the atomic, audited `adapter.db.mutateBatch()` envelope. There is exactly **one**
write site: `SeedReviewSheet.confirm()` → `buildSeedPlanPayloads()`, producing:

1. **(optional) `op:'update' projects/<id>`** — only when the PM moved the deadline in the review;
   `data:{targetLaunchDate}`, `expectedRev: project.rev` (optimistic lock → conflict toast on 409).
2. **`op:'create' tasks/gtm-<projectId>-<seedRefId>`** — one per not-yet-present selected task. Each
   `data` carries `projectId`, `productId`, `seedRefId`, `seedBatchId`, `origin:'seeded'`, full L2/L3/L4
   lineage, `phaseOrder`, effective `slaDays`, `ownerRole`, work/value/disposition, `startDate`, `dueAt`,
   `order`, and the empty completion fields. Verified by test: **every** create carries
   projectId + productId + a `pm-XXXXXXXX` seedRefId + seedBatchId.

No deletes. No bare writes. VIEWER is gated client-side (`canEdit`) and server-side (`product:write`).

## 4) Three hostile questions — where would a PM still be confused?

1. **"I dragged a task's due date, why did only its *length* change?"** We expose **duration** + the
   **deadline** as the editable levers, not an absolute per-task date pin. In a back-scheduled chain a
   task's due date is fixed by everything downstream of it, so an arbitrary date pin is ill-posed and can
   silently fight the forward-only + land-on-deadline invariants. Duration + deadline together fully and
   unambiguously determine every task's dates, and both persist. A literal drag-on-a-timeline handle was
   scoped out for the same reason; the ± nudge + date input cover "nudge the deadline."
2. **"I edited an owner/duration on a task that's already on the board — nothing happened."** Correct, and
   possibly surprising: re-seed is **additive only** (idempotent by design), so already-present rows are
   shown read-only ("On board") and edits there are ignored. Editing an existing task still happens on the
   board's task drawer, not here. If PMs expect the review sheet to also *update* existing tasks, that's a
   future "merge" mode — deliberately not built (it would need a per-field overwrite policy).
3. **"On mobile I can't see the owner or duration."** The row's inline owner/duration editors are
   `hidden sm:` (desktop-first); the phone view keeps title + select + the **date range** (the PM's real
   "when does it land" question) but not the editors. A PM reviewing on a phone can cut scope and seed but
   must switch to a wider screen to fine-tune owners/durations. Acceptable for a review surface; worth a
   follow-up if mobile editing is a real need.

---

## Gate (local, no deploy)

`typecheck ✓ · lint ✓ (0 findings in touched files) · build ✓ · bundle 144.1/175 gz, Tasks chunk 19.2 ✓`
Tests: **1064 pass** incl. all three rating canaries ($1,528 / $1,002 / $2,635) and the 33 new tests
(planner 16, review model 11, walk-the-flow 2, axe 3, + scheduler 17 no-regression).

**Two pre-existing failures remain, NOT from this work:** `no-bare-writes.test.ts` flags
`server/lib/platform-config.js` (unlisted) and `server/lib/admin.js` (8→13 writes) — both committed by
the **F5 platform/ops lane** (`f5e64a2`, `dd836c2`), unmodified vs HEAD, and red at HEAD before this
branch. This feature touches **zero** server files; the invariant scans only `server/lib/*.js`. Left for
that lane to reconcile (allowlist update or route through `mutateInternal`) — not a drive-by from here.

## Deliberate scope decisions / deviations

- Kept `scheduleFromDeadline` (and its 17 tests) intact; added a **new** `planLaunch` rather than mutate
  the shared scheduler — the old function's compression test asserts past-dated starts, which forward-only
  contradicts. No regression risk.
- "Shown immediately after product draft" is honoured via the existing `onProjectCreated → open seed`
  path (a Project *is* the product-launch draft, with the deadline the scheduler needs). Did **not** reach
  into `Builder.tsx`/product-create modals — that opens a separate product-vs-project task-population
  question and would be a drive-by.
- Re-seed is **additive** (was destructive clear-and-recreate). This is the intended v2 behaviour and the
  reason completions now survive a re-seed.
