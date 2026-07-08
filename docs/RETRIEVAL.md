# Grounded Retrieval — embeddings + vector search behind a provider seam

The AI surfaces are grounded by a **retrieval layer**: instead of dumping whole collections
into the model, the grounding tools embed the query, fetch the top‑k most relevant *chunks*
of the corpus, rerank them, and return only those — with the `refId` / form number metadata
the answer must cite. This is the input‑token win over the old full‑collection scans
(OBSERVATIONS B10) and makes chat/claims grounding **server‑verifiable** via the Citations API.

## Layers

| Layer | Where | Platform |
|---|---|---|
| Chunking + lexical ranking + int8/cosine math | `shared/src/retrieval/` | **pure TS** (no platform imports) |
| Ports (Embeddings / Reranker / VectorStore / Provider) | `functions/src/retrieval/types.ts` | server |
| Voyage client (embeddings + rerank) | `functions/src/retrieval/voyage.ts` | server (reads `VOYAGE_API_KEY`) |
| Firestore vector store (KNN `findNearest` + lexical fallback) | `functions/src/retrieval/firestoreStore.ts` | server |
| Composition + `retrieve()` | `functions/src/retrieval/index.ts` | server |
| Incremental indexer + `reindexGrounding` (ADMIN) | `functions/src/retrieval/indexer.ts` | server |
| Citations API bridge | `functions/src/retrieval/citations.ts` | server |
| Alternative provider (Bedrock + OpenSearch) | `functions/src/retrieval/placeholder.ts` | server (un‑implemented) |

**Guardrail:** the vector store + embeddings client are a **backend** concern. Nothing under
`functions/src/retrieval` is importable from `app/`; `VOYAGE_API_KEY` is a server secret only
(never `VITE_*`, never the browser, never logged); `shared/` stays platform‑free.

## Provider seam (mirrors the app's Firebase→AWS adapter seam)

`getProvider(voyageKey)` returns a `RetrievalProvider`:

- **Voyage** (a key is configured) — dense embeddings (`voyage-3.5-lite`, 1024‑dim) + reranker
  (`rerank-2.5-lite`) over the Firestore KNN index. `voyage-context-3` is the contextualized
  upgrade (see comments in `voyage.ts`).
- **Lexical** (no key) — the dependency‑free TF‑IDF ranker over stored chunk text. Zero
  external calls; the offline default. Same `RetrievalHit[]` shape, so the tools don't change.

Swapping stores/providers = flip `store` in `index.ts` and `getProvider` to the mappings in
`placeholder.ts` — exactly like flipping `adapter` in `app/src/lib/backend/index.ts`.

## Building the index

- **Seed** writes `groundingChunks` (text + metadata, *no vectors* offline) so lexical
  retrieval works out of the box.
- **`reindexGrounding`** (ADMIN callable, `VOYAGE_API_KEY` bound) rebuilds **incrementally**:
  only chunks whose `contentHash` changed are re‑embedded + upserted; departed chunks are
  pruned. Run it after seeding once a Voyage key is configured to add dense vectors.

## Tools

`search_entities` → top‑k retrieval (was: whole `searchIndex`). `get_forms(search)` and
`get_dictionary(name)` → retrieval for discovery, with exact lookups (`formNumber`, `refId`)
as direct reads. `get_coverage` / `run_rating` / `get_ld_table` stay direct exact lookups.
Dictionary **"used in"** stays exhaustive (a data‑truth guarantee) — the *lookup* moved to
retrieval, not the back‑reference list.

## Retrieval quality is gated

`pnpm eval` includes a **retrieval‑quality** section: for a set of natural‑language queries it
asserts the expected `refId` / form number is in the top‑k (offline lexical over the real
chunk corpus). A regression that stops an answer from finding its source fails the eval.
