# Prompt 03 — AI / LLM Pipeline Review

> Paste everything below into the external AI. Attach `00-CONTEXT-DOSSIER.md` and the AI-pipeline SVG
> diagram. Give the reviewer access to the `server/lib/` AI modules (grounding/RAG, citation
> verification, import brain, fleet routing, cost guard) and `shared/src/ai/`.

---

## Role & goal

You are an applied-AI / LLM-systems engineer reviewing the AI layer of an insurance product-management
SaaS ("Product Reinvention Hub"). All model calls are **server-side** through **Azure Foundry** (Claude
+ OpenAI); the browser never calls a model. Two flagship AI features: (1) a **grounded RAG copilot** that
answers questions about a tenant's insurance products and must **cite source documents**, and (2) an
**import brain** that turns carrier rate-filing PDFs/workbooks into governed product data. Your job is to
critique correctness, factuality, cost, and latency, and to find gaps in the eval story.

## What to focus on

### A. RAG grounding & citation fidelity
1. **Retrieval design.** Always-included **PORTFOLIO baseline** context + **DETAIL top-18** chunks,
   **hybrid** retrieval (dense int8-quantized vectors + lexical) blended with **`HYBRID_ALPHA = 0.72`**.
   Assess: is 0.72 defensible or should it be tuned/learned? Does int8 quantization cost meaningful
   recall? Is top-18 + baseline right, or over/under-retrieving (context dilution, lost-in-the-middle)?
   Chunking strategy, dedup across the seed vs runtime write schemes, and reranking.
2. **Citation verification.** The pipeline extracts `[refId]` markers from the model's answer, verifies
   each against the actually-retrieved context, and marks unverified claims with a notice. Interrogate
   whether this **truly prevents fabrication**: can the model cite a real refId next to an unsupported
   claim (valid citation, wrong content)? Is there entailment/faithfulness checking or only
   presence-of-refId? What happens to sentences with **no** citation — are they allowed through? Propose
   a stronger faithfulness check (NLI/self-check/claim-level attribution) and where it plugs in.

### B. Import brain (6-stage pipeline)
3. Review the stages — **classify → header-detect → map → extract → adversarial-validate → reconcile** —
   for failure modes, error propagation, and recoverability. Where does a bad early stage silently
   corrupt later ones?
4. **Decorrelated validator.** The adversarial-validate stage uses a *different* model family (OpenAI
   `gpt-5.1`) to check the Anthropic extraction. Assess whether this decorrelation actually catches
   correlated errors, how disagreements are reconciled, and whether the reconcile step can be gamed by
   both models sharing a blind spot (e.g. an ambiguous table header).
5. **Escalation ladder + cost.** Bulk work runs on **haiku**, escalates **haiku → sonnet → opus** on
   difficulty/low-confidence, and the whole import path runs under **`IMPORT_CONTEXT` (no cost cap,
   never model-degraded)** while every other role stays under the cost guard. Evaluate the escalation
   triggers (are they measuring the right signal?), the risk of runaway spend in the no-cap path, and
   whether telemetry (`fleet.record`, per-run spend) gives enough visibility to catch a bad run early.

### C. Model selection & routing
6. Roles map to deployments in a fleet router: `claude-opus-4-8` (reasoning / grounded-cited),
   `claude-sonnet-5` (import escalation / mid-reasoner), `claude-haiku-4-5` (bulk verify),
   `text-embedding-3-small` (embeddings), `gpt-5.1` (decorrelated validator). Critique the mapping:
   is opus warranted for the copilot, is haiku strong enough for bulk extraction, are there roles that
   should move up/down a tier for accuracy-per-dollar? (Do **not** propose `claude-fable-5` — it is
   banned in this codebase.)

### D. Prompt-injection sandboxing
7. Ingested documents are untrusted. Assess how document text is delimited from system/developer
   instructions across the copilot and every import stage, and whether an injected instruction could flip
   the citation verifier, force escalation, or leak cross-context data. Recommend concrete sandboxing
   (structured delimiters, spotlighting, instruction/data separation, output constraints).

### E. Evaluation harness gaps
8. Beyond the rating canaries (deterministic, not AI), what AI-specific evals exist and what's missing?
   Recommend a harness: grounding faithfulness set, citation-precision/recall, import field-level
   accuracy vs golden workbooks (`validateAgainstExpected`), regression gates on prompt/model changes,
   red-team injection suite, and cost/latency budgets per role.

## Constraints you must respect

- **All AI stays server-side**; the browser never calls a model.
- Answers must remain **grounded + cited**; free invention is a bug, not a style choice.
- The **import path keeps its no-cap `IMPORT_CONTEXT`** exemption (accuracy over cost there) — but
  telemetry is never bypassed. Improvements must keep spend observable.
- Keep the **model IDs** listed above; never `claude-fable-5`.
- Rating **canaries** are deterministic engine tests, not AI — don't propose replacing them with an LLM.

## Output format

1. **Executive summary** — the single biggest factuality risk and the single biggest cost/latency lever.
2. **Findings**, grouped A–E, each as:
   - **Observation** (with file/function or pipeline stage),
   - **Why it matters** (accuracy / cost / latency / safety),
   - **Recommendation** (concrete: params, prompt structure, added check, model change),
   - **Expected effect** and **effort** (S/M/L).
3. **Recommended eval harness** — a concrete checklist of eval sets and CI gates to add, with what each
   protects against.
4. **Quick wins** — a short list of changes that are cheap and high-value.

Where a claim needs a file you can't see, name the file.
