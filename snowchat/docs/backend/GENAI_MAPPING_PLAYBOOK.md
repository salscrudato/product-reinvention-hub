# GenAI Mapping Playbook

This document captures the target end-state for the mapping agents that live in
`backend/components/mapping_agents`. It explains why the current heuristic
approach is insufficient and how to evolve it into a GenAI-first workflow that
uses RAG, planning, and LLM-based reasoning to deliver high-quality mapping
rows.

## 1. Agentic Mapping Framework (2025)

### 1.1 Mission Control View

```
assignment_ingest → context_enrichment → retrieval_fanout → llm_synthesis → validation → persistence & telemetry
```

- **Assignment ingest** pulls Confluence attachments into an isolated workspace, fingerprints every artifact, and primes caches so repeated runs stay cheap.
- **Context enrichment** layers structural metadata (sheet schemas, Word hierarchy, column samples) on top of the raw files. This is the shared state all downstream nodes mutate.
- **Retrieval fan-out** gathers evidence from three tool classes: spreadsheet column FAISS indices, TinyDB/FAISS history, and Confluence WikiRAG snippets. Each target heading ends up with an “evidence bundle” before the LLM is even called.
- **LLM synthesis** (LangGraph node `llm_mapping.generate_with_llm`) reasons over that bundle in batches, citing every decision and flagging ambiguities for retry.
- **Validation + persistence** store the full JSON payload to `mapping_outputs/`, emit preview summaries to the API, and update telemetry so future runs learn from past confidence gaps.

### 1.2 Evidence-Rich Reasoning

- Every batch prompt includes: Word placeholder context, spreadsheet candidate tables with value samples, historical analogies, wiki excerpts, and user/system warnings.
- Runtime toggles (`SNOWCHAT_MAPPING_USE_LLM`, `SNOWCHAT_MAPPING_DISABLE_WIKI`, batch size) let ops teams dial cost vs. accuracy without changing code.
- Logs (`backend/agentic_orchestrator_auto.log`) capture each phase with millisecond timings so we know exactly which agent tool produced which artifact.

### 1.3 Adaptive Behaviors

- Low-confidence results automatically trigger fallbacks (heuristics or smaller LLM batches) instead of silently passing through bad matches.
- Wiki augmentation is more than a definition lookup: FAISS searches return policy walkthroughs, compliance rules, and example data so the LLM can connect abstract placeholders to the correct spreadsheet objects.
- Because LangGraph maintains shared `MappingState`, any node can inject intents (`need_more_context`, `request_retry`) that alter downstream execution—this is what makes the workflow agentic rather than a linear script.

> Start reading the rest of this playbook with that framework in mind: the sections below explain how we evolved from heuristics to this agentic loop and what components power each step.

## 2. Legacy Baseline (and Limitations)

| Component | Purpose today | Limitation |
| --- | --- | --- |
| `context_enrichment.py` | Keyword heuristics + column stats | No semantic signal from actual data or business definitions |
| `mapping_synthesizer.py` | `difflib.SequenceMatcher` + history boost | Ignores spreadsheet samples, lacks chain-of-thought, cannot reason about multi-word intents |
| `history_retriever.py` | TinyDB lookup | Not embedded, so past mappings cannot be retrieved by similarity |
| `knowledge_agent.py` & `validator.py` | Rule-based warnings | No grounding in policy / product knowledge, cannot cite sources |
| `workflow.py` & `supervisor.py` | Deterministic pipeline | No LangGraph node that performs LLM reasoning or RAG retrieval |

The net effect: we only deliver mechanically matched `source_column -> target`
rows. For complex assignments (new sheets, renamed fields, multi-table docs)
this breaks down quickly.

## 3. Target Goals

1. **LLM-powered synthesis** – Use an LLM (Azure OpenAI GPT-4.1 / GPT-4o) to
   reason over column descriptions, samples, and context when selecting source
   fields.
2. **Semantic retrieval (RAG)** – Enrich the prompt with knowledge pulled from:
   - Confluence/wiki pages for the assignment / business glossary
   - Historical mappings stored in TinyDB (migrate to embeddings so we can
     retrieve “similar” targets, not only exact assignment IDs)
   - Parsed spreadsheet profiles (sample values, inferred data types)
3. **Agentic workflow** – Keep LangGraph-based orchestration so each node can
   call the LLM, ask follow-up questions, or flag low-confidence mappings for
   manual review.
4. **Traceability** – Every mapping row should include rationale + the source
   documents used (Confluence URL, sheet name, etc.).
5. **Extensible tool layer** – Agents must be able to call wiki downloaders,
   historical search, or even Splunk/ServiceNow APIs when the prompt indicates
   missing context.

## 4. Implemented Architecture (2025-12)

### 4.1 Shared LLM Access

- All chat completions now route through `backend/components/openai_client.py`.
   - Picks Azure OpenAI first (using `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and
      `OPENAI_API_VERSION`), then public OpenAI, then the legacy `openai.ChatCompletion`.
   - Provides helpers `invoke_chat`, `first_choice_content`, and `extract_json_block` so
      every module (LangGraph planner, mapping agents, ServiceNow orchestration) receives the
      same retry and parsing guarantees.
- `mapping_agents/llm_mapping.py` consumes this helper directly, which removed the
   duplicated `llm_client.py` and keeps model selection aligned with the rest of SnowChat.

### 4.2 Retrieval + Embeddings

- `mapping_agents/retrieval.py` handles all similarity scoring:
   - Embeddings sourced from `vectorization_and_index_creation.generate_embeddings`, which in
      turn delegates to `embedding_utils` so the FAISS indices remain compatible with
      Confluence/wiki RAG.
   - Cosine similarity uses the canonical helper already defined in `snowaaone`, eliminating
      multiple NumPy reimplementations.
   - Column candidates, historical headings, and wiki snippets are ranked per target heading
      and cached in `state.metadata['retrieval_cache']` to avoid repeated embedding calls.
   - Wiki snippets are fetched lazily through `CustomWikiRAG` (shared Confluence FAISS index)
      so mapping agents benefit from the same curated knowledge base as the rest of SnowChat.
   - Spreadsheet columns now receive their own persistent FAISS index under
     `cache/mapping_indices/`. The first @mapping run for an attachment embeds every
     `sheet::column` label, writes the index + manifest keyed by the attachment fingerprint,
     then subsequent runs simply load the cached index—eliminating duplicate Azure embedding
     costs while ensuring cosine similarity scoring stays instant.

### 4.3 LLM Mapping Agent

- `mapping_agents/mapping_synthesizer.py` now prefers an LLM strategy controlled by
   `SNOWCHAT_MAPPING_USE_LLM` (default `true`).
   - For each target heading we compose a structured payload (candidates, history, wiki
      context, profile stats). Targets are chunked (default 12 per request via
      `SNOWCHAT_MAPPING_BATCH_SIZE`) so a single OpenAI call returns a `mappings` array covering the
      batch, sharply reducing per-field latency.
   - Responses must include `source_column`, `confidence`, `rationale`, and at least one
      citation; otherwise we log the failure and fall back to heuristics.
   - When the LLM path fails or the env flag disables it, we drop back to the legacy
      `difflib`-based heuristic generator so workflows remain operational even without LLM
      access.

### 4.4 Validation & Feedback

- `validator.py` enforces LLM-specific guarantees:
   - Any LLM-generated row missing citations is downgraded to a medium-severity validation
      issue, prompting manual review.
   - Confidence values are parsed defensively (supporting string/float inputs) to prevent
      malformed responses from crashing the run.
- Validation metadata now records the chosen synthesis strategy, enabling dashboards to show
   how often we relied on LLM vs. heuristic paths.

### 4.5 Agent Orchestration

- The workflow still runs within LangGraph (`workflow.py`, `supervisor.py`), but the LLM
   synth node now:
   - Pulls retrieval artifacts via the new helper module, ensuring every target field has a
      consistent evidence bundle before it hits the LLM.
   - Adds warnings when no confident mapping is produced so downstream reviewers can triage
      the specific fields.
   - Records durations per step alongside the new metadata fields for better telemetry.

### 4.6 Why This Is “Agentic AI”

- **Tool-augmented reasoning** – The LLM does not answer in a vacuum; it consumes structured
  evidence from multiple tools (column embeddings, history lookups, Confluence RAG), which is
  the core Agentic pattern (reason-plan-act).
- **Autonomous fallbacks** – The synthesizer decides whether to trust the GenAI result; if the
  agent cannot cite sources, it automatically falls back to heuristics and emits warnings
  without human intervention.
- **Stateful orchestration** – LangGraph coordinates multiple nodes (context enrichment,
  retrieval, LLM synthesis, validation). Each node updates shared `MappingState`, enabling
  branching/looping behavior typical of Agentic workflows.
- **Traceability + feedback loop** – Citations, validation issues, and metadata feed back into
  TinyDB/FAISS so future runs have richer historical context. This closes the loop required for
  self-improving agents.

> In short: the mapping pipeline now plans (via retrieval heuristics + context profiling),
> acts (invokes tools/LLM), observes results (validation), and adapts (fallbacks + history).
> Those are the hallmarks of an Agentic AI system rather than a single LLM call.

### 4.7 Agentic Mapping Framework Deep-Dive (2025 refresh)

1. **Planner mind-set inside LangGraph** – The supervisor promotes each stage (locator →
   enrichment → retrieval → synthesis → validation) as a separate LangGraph node. Each node can
   raise intents (`need_more_context`, `fallback_requested`) that reroute execution, giving us a
   mini plan/act/observe loop for every target heading instead of a linear script.
2. **LLM as collaborative problem solver** – `llm_mapping.generate_with_llm` now receives a
   JSON bundle per batch that includes:
   - Parsed Word placeholders with structural hints, e.g., section hierarchy, sample text.
   - Ranked spreadsheet objects that include **value samples** and inferred business types.
   - Historical precedents (if any) with rationale strings so the LLM can critique or reuse
     them.
   The prompt explicitly asks the model to reason step-by-step, cite evidence, and elevate
   conflicts. This transforms the LLM from a string matcher into a domain analyst capable of
   tackling multi-table joins, derived fields, and compliance-driven placeholders.
3. **Wiki augmentation beyond definitions** – WikiRAG is not just describing the field; it
   injects process context (“how underwriting stamps certificate holders”), policy guardrails,
   and examples pulled from the same Confluence space as the assignment. Those snippets are
   tagged with relevance scores and sheet correlations so the LLM can say “Map `<DATE>` to the
   `PolicyIssuance::IssueDate` column because underwriting guidelines call that out.” This gives
   the agent contextual mapping powers instead of shallow label matching.
4. **Adaptive retries and self-diagnostics** – When the LLM flags low confidence, the agent
   can request additional wiki chunks or shrink the batch size, then retry synthesis with more
   focused evidence. Failures are captured in metadata, allowing subsequent runs to skip known
   dead ends.
5. **Evidence-first outputs** – Every final row stores `citations`, `strategy`, `confidence`,
   and `reasoning_trace`. Reviewers (or downstream automation) can therefore trust the mapping
   because it is grounded in verifiable artifacts, not opaque string similarity.

> **Key takeaway:** the framework behaves like a specialized mapping analyst—planning its
> research steps, using tools to gather context, debating options inside the LLM, and
> documenting why each decision was made.

### 4.8 Example Working Architectures

**Example A – Standard Policy Mapping**

1. `workflow.run_mapping_workflow` downloads the spreadsheet + Word template and builds a
   `MappingState` with column samples (context_enrichment).
2. `retrieval.rank_source_columns` embeds each target heading, scores all spreadsheet columns, and
   caches the top six candidates in `state.metadata['retrieval_cache']`.
3. `llm_mapping.generate_with_llm` assembles the prompt with candidate columns, historical
   suggestions, and wiki excerpts. The prompt is executed through `openai_client.invoke_chat`.
4. The returned JSON row (with citations) is accepted and stored in `state.mapping_rows` with
   `strategy='llm'`. Validation checks confidence + citation integrity before emitting the final
   payload.

**Example B – Wiki-Heavy Assignment**

1. Target field “Deferred Annuity Rider Code” has weak spreadsheet signals (no obvious column).
2. `wiki_context_chunks` calls `CustomWikiRAG` with the heading text; FAISS matches a Confluence
   article describing rider codes per sheet.
3. The LLM receives few column candidates but a rich wiki excerpt, so it cites `wiki:Rider Codes`
   and maps to `Riders::RiderCode` with confidence 0.74.
4. Validator records the citation and medium confidence; supervisors can highlight this field in
   UI dashboards for optional human approval.

**Example C – Fallback Heuristic Path**

1. `SNOWCHAT_MAPPING_USE_LLM=0` (regulatory mode) or the OpenAI call fails.
2. `mapping_synthesizer` automatically runs `_heuristic_rows`, using difflib similarity plus
   history boosts to generate best-effort rows.
3. Metadata records `strategy='heuristic'` so downstream analytics know GenAI was skipped.
4. Validator still enforces confidence thresholds; unresolved targets become warnings for manual
   mapping, ensuring continuity even without LLM access.

**Example D – Live @mapping Run (2025-12-02)**

1. **Trigger + plan** – `backend/agentic_orchestrator_auto.log` shows the user prompt `@mapping … assignment1` at `16:18:58` followed by `FLOW[PLAN_SUMMARY] mapping_assignment_plan` (lines 13–28). LangGraph spins up the mapping graph with `assignment_locator` as the first node.
2. **Acquisition + parsing** – Between `16:19:05` and `16:19:09` the log records the Confluence client initialization, attachment downloads, and the Excel/Word parsers extracting 9 spreadsheet objects + 10 Word placeholders. The cache hit on `cache/mapping_indices/...att64978945...faiss` confirms indexed embeddings were reused instead of re-embedding the spreadsheet.
3. **Context building** – `context_enrichment` and `history_similarity` run back-to-back (`16:19:11`–`16:19:12`). The trace messages highlight warnings (Word headings lacked shared keywords) and the absence of historical rows, so the agent knows it must rely on fresh evidence.
4. **Agentic synthesis** – At `16:19:14` the synthesizer invokes `llm_mapping.generate_with_llm` with `"wiki_enabled": true` and a batch of 10 targets. The subsequent log block captures WikiRAG bootstrapping the FAISS index and issuing search queries such as `<DATE>` and `<CERTIFICATEHOLDER Name>` to enrich the LLM prompt.
5. **Outcome + persistence** – Although the excerpt truncates before validation, the same run wrote the full JSON payload to `mapping_outputs/` (per `workflow.py` logic) while the API returned only the preview, proving the framework handled planning, tool invocation, reasoning, and artifact persistence without manual intervention.

> This real log illustrates the Agentic loop end-to-end: planner detects intent, acquisition tools gather artifacts, retrieval + wiki augmentation inject context, the LLM reasons with cites, and the workflow persists results while emitting telemetry for every phase.

## 5. Implementation Roadmap

1. **Week 1 – Foundations**
   - Add embedding utilities (reuse `components/servicenowgenaitool.generate_embeddings`).
   - Build FAISS stores for columns, targets, and historical records.
   - Create `retrieval.py` with the helper functions listed above.
2. **Week 2 – LLM Agent**
   - Implement prompt template + LangGraph node.
   - Update `mapping_synthesizer.synthesize_mapping_rows` to dispatch either to
     the LLM agent (preferred) or the existing heuristic based on an env flag
     (`SNOWCHAT_MAPPING_USE_LLM`).
   - Ensure each mapping row now includes `citations`.
3. **Week 3 – RAG + Validation**
   - Wire Confluence RAG responses via `CustomWikiRAG.perform_wiki_rag`.
   - Extend `validator.py` to enforce citation + confidence rules.
   - Persist accepted mappings into history FAISS + TinyDB.
4. **Week 4 – Observability & QA**
   - Capture LangSmith traces per mapping run.
   - Add pytest coverage for retrieval helpers and prompt formatting (use
     deterministic fixtures to avoid real LLM calls).
   - Document operational runbooks (LLM rate limits, index refresh cadence).

## 6. Required Configuration

- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `OPENAI_API_VERSION`, and `GPT_MODEL_NAME`
   configure the shared client.
- `SNOWCHAT_MAPPING_USE_LLM` – opt-out switch for regulated tenants.
- `SNOWCHAT_MAPPING_BATCH_SIZE` – controls how many target fields are sent in each LLM call (set
   to `1` to restore the legacy per-field invocation pattern).
- `SNOWCHAT_MAPPING_DISABLE_WIKI` – skips Confluence retrieval when network access is
   constrained.
- Confluence FAISS assets (`Embeddings_Lookup_cache.index`, `faiss_docs.pkl`) must be
   present for wiki citations to work.
- `faiss-cpu`, `numpy`, and `tiktoken` remain required in `requirements.txt` for embedding and
   retrieval operations.

## 7. Deliverables Checklist

- [ ] `backend/components/mapping_agents/retrieval.py`
- [ ] Embedding helpers + FAISS index bootstrap script
- [ ] LangGraph node `llm_mapping_agent`
- [ ] Updated synthesizer + validator to emit citations
- [ ] Telemetry + docs for running the GenAI workflow

Following this playbook will move the mapping workflow from a pure heuristic
engine to a GenAI-native assistant that reasons over historical knowledge,
assignment context, and wiki content. This foundation also positions us to plug
in external systems (ServiceNow, Splunk, codebase RAG) as future tools without
rewriting the entire pipeline.
