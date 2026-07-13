# Handoff — finish & verify the import + data-integrity fixes

You are a principal engineer taking over an in-flight fix campaign on **Product Reinvention Hub**
(pnpm monorepo: `app/` React+Vite · `shared/` types/rating/import · `server/` Azure App Service
Express+Cosmos+Foundry · `functions/` reference-only). Read root `CLAUDE.md` +
`app/CLAUDE.md` + `shared/CLAUDE.md` before touching anything. Live dev = same-origin `/api/*` on
**https://app-prodhub-dev.azurewebsites.net** (tenant `testco`). Bootstrap auth: `admin`/`admin`.
Live dev creds are in the gitignored `tmp_keys.md` at repo root.

Your mandate: **confirm every fix below is working live, close the last verification gaps, and
iterate until the import pipeline is provably correct.** Deploy after every fix. Do not regress the
gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (canaries $1,528 / $1,002 / $2,635
are deploy blockers).

## How this backend deploys (important)
- Push to `main` **does not auto-deploy reliably** — trigger manually. `az` is not on PATH; call the
  full path: `"/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin/az.cmd"`.
- Trigger: `az.cmd pipelines run --id 810 --branch main` → returns a run id (e.g. 2409).
- Poll: `az.cmd pipelines runs show --id <ID> --query "{status:status,result:result}" -o json`.
- After `result=succeeded`, wait ~25s then `curl -s <BASE>/api/health` → `{"status":"ok"}`.
- Build takes ~2-3 min. The Vite SPA + server are built and deployed together.

## What was already fixed & deployed (verify each is live)

All commits are on `main`. Deploys: **2402** (coverage persist), **2406** (merge + crashes),
**2409** (rules + forms cap, live), **2412** (server-side forms filter — IN FLIGHT when this handoff
was last updated; confirm it reached `succeeded` and is live).

1. **Coverage import regression (deploy 2402) — VERIFIED live (112/112).** Two bugs:
   - Client `app/src/lib/import/importProduct.ts`: batched `mutateBatch` put a child coverage in the
     same batch as its parent; the server validates `parentId` via `readEntity` before committing the
     batch, so the child failed `invalid_parent` and the whole 50-item slice threw → ~no coverages
     landed. Fix = **wave batching**: flush before adding a coverage whose `parentId` is already
     pending in the current batch (correct for any nesting depth).
   - Server `server/lib/data.js` envelope: coverage docId is the dot→dash form of the refId
     (`CORE.COV.001` → `CORE-COV-001`) but `parentId` stays dotted; the parent check built the path
     from the dotted `parentId` and never matched. Fix = resolve parent trying **both** verbatim and
     dot→dash forms.

2. **`op:'update'` was a REPLACE, not a merge (deploy 2406) — CRITICAL data-integrity fix.**
   `server/lib/data.js` envelope wrote `data` verbatim with no merge. The state-footprint editor
   (`app/src/routes/product/ProductStates.tsx`) sends only `{ states, allStates }`, so editing a
   product's footprint **wiped name/lob/lifecycle/everything** and corrupted the doc (and wrote a
   version diff showing every field "changed to undefined"). Fix = shallow-merge incoming fields onto
   existing domain data for `op:'update'`; merged doc feeds entity + version diff + search index +
   grounding chunk. `create`/`delete` unchanged; imports (all `create`) unaffected.
   - Consequence: `PH.PROD.001` and `PA.PROD.001` were stripped in `testco`; **already restored** via
     a merge update (names/lob/lifecycle back, `states` preserved).

3. **Client crashes (deploy 2406).** `app/src/routes/News.tsx` crashed on `product.lob.name` when
   `lob` was a string/missing → added defensive `lobInfo()`. `app/src/components/product/
   PromoteDraftDialog.tsx` crashed on `product.name.trim()` when name missing → fallback to refId/id.
   Also `server/lib/ai/unified-import.js` filing path now writes `lob` as `{ refId, name }` (was the
   bare string `'PH'`).

4. **AI endpoints (deploy 2402) — VERIFIED live.** `shapeFeedback` (was 501), `refreshNews`
   (was 501; now 8192 tokens + retry-on-empty, returns 10-11/10-11 consistently), `proposeMapping`
   (was 401), `chat` (emits `chatCard` json event with citations), `analyzeClaim` (coverages/
   exclusions now `{name, refId, formNumber, definition}` — Document Citations boxes populate).

5. **Rules + forms cap (deploy 2409 — LIVE).**
   - `shared/src/insurance/isoImport.ts` `parseRules`: CORE's "Core Rules Specifications" declares a
     RULE ID column but leaves it blank on every row, so all 233 rows were dropped (`if (!id)
     continue`) → **0 rules**. Fix = synthesize `frameworkId.RULE.NNN` for rows that carry rule
     content when RULE ID is blank. **Parse + persist now yields 234 rules** (verified live, below).
   - `server/lib/data.js` `MAX_LIST` 1000 → **6000**: first band-aid for the forms cap (see #6 for
     the real fix).

6. **Forms library scaling — server-side filter (deploy 2412 — CONFIRM LIVE).** The forms library is
   a shared top-level collection; the app subscribed to ALL of it and filtered by `productRefIds`
   client-side. `testco` accumulated **>6000 forms** because the user ran CORE import ~5 times (each
   draft adds ~1359 forms — see "known testco state" below), so a product's forms fell outside the
   list window and vanished from the UI. Fix = `adapter.subscribe` now takes an optional `Query`
   (backward compatible; reads via `list(path, query)`, caches per path+query) and
   `ProductContext` subscribes to forms filtered SERVER-SIDE by
   `productRefIds array-contains pid`. Each product loads only its own forms regardless of total
   collection size. Verified live: array-contains returns 1062 / 1359 for two distinct CORE drafts.

### Full-scale e2e result (deploy 2409, live) — PASSED
`scripts/verify-core-e2e.mts` against `testco`: parsed 112 coverages / 1359 forms / 234 rules;
`writes=1706 failed=0`; **readback coverages 112/112 (93 sub, 0 orphan), rules 234/234**;
`PASS: true`. The script's `readback forms: 0/1359` line is a LIST-WINDOW artifact (testco had
>6000 forms at the time, so the unfiltered list didn't include the run's rows) — NOT a persistence
failure; forms writes returned 0 failed and were independently confirmed. After the #6 fix the
verifier should filter forms by productRefIds; update it if you want a clean forms readback.

### Known testco state (clutter, user's call)
`testco` has ~5 duplicate CORE draft products (`draft-core-prd-001-*`, from repeated import
attempts) plus a GL draft, each carrying its full forms set. With the #6 fix each displays its own
forms correctly, so this no longer breaks anything — but the user may want to delete the extra
drafts (draft deletion cascades to forms via `app/src/lib/product/deleteDraft.ts`). The user's
current "Core" product is `draft-core-prd-001-mrjkxuim-2jg1` (1062 forms, **0 rules** — imported
before the rules fix; re-import to get 234). `PH.PROD.001` / `PA.PROD.001` seeds were restored.

## Verification tools already built (use them)

- `pnpm import:live` (`scripts/import-live.mts`) — parses all samples with the real
  `mapIsoWorkbook`, asserts product + coverages + **zero orphan sub-coverages** locally, and does a
  no-crash server pass. Env: `BASE_URL`, `IMPORT_USER=admin`, `IMPORT_PASS=admin`,
  `IMPORT_TENANT=testco`, `IMPORT_TEARDOWN=true`. NOTE: the XLSX server "structural" pass is an
  optional adaptive-AI step and is slow (CORE brain ~300s) — it's informational, not a pass gate.
- `pnpm import:loop` (`scripts/import-loop.mts`) — runs `pnpm test:unit` + canary detection +
  `import:live`, writes a **computed** exit to `docs/audit/import_ledger.json`.
- `scripts/verify-core-e2e.mts` — THE definitive proof. Parses the real CORE workbook and replicates
  the client wave-batch persist against live `testco`, then reads back coverages + rules + forms and
  tears everything down. Run: `BASE_URL=https://app-prodhub-dev.azurewebsites.net IMPORT_TENANT=testco
  pnpm exec tsx scripts/verify-core-e2e.mts`. It is uncommitted with an enhanced readback+teardown —
  review the diff. Last full run (pre-rules-fix) = 112/112 coverages, 1472 writes, 0 failures.
- `.mts` (not `.ts`) matters: tsx treats `.mts` as ESM (these scripts use top-level await); root
  `package.json` had `@pf/shared` + `exceljs` added so they resolve under ESM.

## Remaining work — do these in order

1. **Confirm deploy 2412 is live** (`az.cmd pipelines runs show --id 2412`; then `curl <BASE>/api/health`).
   If it failed, re-trigger (id 810) and diagnose. (2402/2406/2409 already verified live.)
2. **Browser verification (the last gap — cannot be done via curl):** open the app on `testco` and
   confirm, with no ErrorBoundary:
   - **Products** page renders (all products have valid `lob`).
   - **News** page renders (was the reported crash; PH/PA restored + defensive `lobInfo`).
   - A product's **Forms** tab shows its full count after 2412 (e.g. the user's Core =
     `draft-core-prd-001-mrjkxuim-2jg1` should show 1062 forms, not 1000).
   - **Data-integrity regression test:** open a product → States tab → change the footprint → Save →
     reload. The product's name/lob/coverages MUST survive (this is the merge-on-update fix; before
     it, this exact action wiped the doc). Also confirm the **History/audit** tab shows the footprint
     change as a clean diff (only `states`/`allStates` changed, not "everything → undefined").
3. **Tell the user about their existing "Core" product:** `draft-core-prd-001-mrjkxuim-2jg1` has
   **0 rules** (imported before the rules fix). To get the 234 rules they must **re-import CORE**, or
   you can backfill: parse CORE locally (`mapIsoWorkbook`) and POST the 234 rule entities to
   `products/<pid>/rules/<docId>` via `/api/db/mutateBatch` (rules have no parentId → free-batch is
   safe). They also have ~5 duplicate CORE drafts they may want to delete (cascades via
   `deleteDraft.ts`).
4. **Run the gate** and `pnpm import:loop`; ensure `docs/audit/import_ledger.json` shows
   `pass: true`. `import:loop` runs `import:live` (XLSX server "structural" pass is slow/non-fatal;
   CORE brain ~300s). If the ledger trips on the slow brain, make the XLSX server pass non-blocking.
5. **Optional:** update `scripts/verify-core-e2e.mts`'s forms readback to filter by `productRefIds`
   (array-contains) so it reports a real forms count instead of the list-window `0/1359` artifact.
   `scripts/verify-core-e2e.mts` and the handoff are committed; run artifacts are gitignored. Do NOT
   commit `tmp_keys.md`.

## Watch-outs / invariants
- Never commit secrets; `tmp_keys.md` is gitignored — read creds there, don't echo them into commits.
- Design tokens only (no hard-coded hex in browser code). Model IDs: `claude-opus-4-8`
  (GROUNDED_CITED), `claude-haiku-4-5` (BULK_VERIFY); never `claude-fable-5`.
- All app reads/writes go through `adapter` (`app/src/lib/backend/`); all writes are `mutate`/
  `mutateBatch` (atomic envelope). AI is server-side only and must stay grounded + cited.
- Commit format: `type(REQ-X): summary` / `type(RISK-00X): summary`, one id per commit, no
  em/en-dashes or emoji in code/comments/docs. End commit messages with the Co-Authored-By line.
- The merge-on-update change is load-bearing and untested by any unit test — if you touch
  `server/lib/data.js` envelope, manually re-verify a partial update (send `{states}` only) does NOT
  wipe other fields, using `/api/db/get`.

## Quick live smoke (copy-paste starting point)
```sh
BASE=https://app-prodhub-dev.azurewebsites.net
TOKEN=$(curl -s -X POST "$BASE/api/auth/bootstrap" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin","tenant":"testco"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token))")
# products lob health (News crash guard): every product must have lob as an object
curl -s -X POST "$BASE/api/db/list" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"path":"products","query":{"limit":1000}}'
# AI endpoints
curl -s -o /dev/null -w "shapeFeedback %{http_code}\n" -X POST "$BASE/api/ai/shapeFeedback" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"rawTitle":"t","rawDetail":"d"}'
curl -s -X POST "$BASE/api/ai/refreshNews" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```
