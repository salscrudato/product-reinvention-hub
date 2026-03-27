# Mapping Agents Plan

## Overview
- **Goal:** provide an agentic workflow that maps product data from Excel/CSV intake files onto structured fields specified by companion Word templates for group insurance and benefits products.
- **Scope:** developer-facing plan/recipe/intent triggered via `@mapping` annotation or explicit natural-language intent. Workflow retrieves assignment artifacts from Confluence wiki folders/pages (one folder per assignment), downloads assets into a temp workspace, and does not require Microsoft Office installed locally.
- **Primary Outputs:** generated CSV file (`mapping_output.csv`) capturing source column ↔ target field mappings, with contextual notes sourced from wiki RAG and prior completed mappings. Optionally provide sidecar JSON summary.

## Assumptions & Constraints
- Assignment source of truth lives in Confluence (or compatible wiki) under a parent page with one child page per assignment. Each page/folder contains exactly one intake spreadsheet (`.xlsx`/`.csv`) and one target Word template (`.docx`) as attachments.
- Pilot dataset: [`https://smamidala.atlassian.net/wiki/spaces/FirstWiki/pages/56918017/assignment1`](https://smamidala.atlassian.net/wiki/spaces/FirstWiki/pages/56918017/assignment1) contains the first exercise artifacts (spreadsheet + Word template) and serves as baseline for development/test cases.
- Agents download required attachments via wiki REST API using service credentials; no dependency on locally installed Microsoft Word/Excel.
- Runtime environment has access to Python libraries capable of handling Office formats (`python-docx`, `openpyxl`, `pandas`), but not the desktop applications themselves.
- Wiki context resides in existing Confluence space already indexed into the FAISS-based `CustomWikiRAG`.
- Historical mappings stored as CSV outputs published back to the wiki (agents keep read-only cache of prior runs) with consistent naming convention (e.g., `mapping_output_<assignment>.csv`).
- Developers can provide additional instructions in natural language; plan should surface clarifying questions when files are missing/ambiguous.

## Dependency Checklist
- Python packages: `pandas`, `openpyxl`, `python-docx`, `numpy`, `faiss-cpu`, `langchain`, `langgraph`, `tinydb`, `requests`.
- Optional but recommended: `pyxlsb` (legacy Excel), `xlrd` (older XLS), `python-dateutil` (date parsing), `tzlocal` (timestamp metadata), `tenacity` (retry helper for wiki lookups).
- Ensure root `requirements.txt` lists `pandas` and `openpyxl`; backend virtual environment must be rebuilt (`pip install -r requirements.txt`) prior to running the mapping plan.
- Wiki access: confirm `CONFLUENCE_BASE_URL`, `CONFLUENCE_API_TOKEN`, and `CONFLUENCE_USERNAME` (or service account) available in environment/secrets for attachment retrieval.
- `.env` in the repo already includes the Confluence service account entries; load them via `python-dotenv` during app startup so agents can authenticate.
- Verify local environment has Microsoft Visual C++ build tools if `faiss-cpu` installation fails (document in onboarding guide).

## Intent / Plan / Recipe Design
- **Annotation:** add `@mapping` to `annotation_commands.json` with description "Map input Excel columns to Word form fields".
- **Intent classifier:** extend intent detection rules in `agentic_orchestrator_api.py` (or equivalent) to trigger when `@mapping` present or messages match regex like `(map|align).*(excel|csv).*(word|docx)`.
- **Plan blueprint (LangGraph plan node):**
 1. **Assignment Locator Agent**
    - Query wiki API for assignments the developer references (labels, page titles, or explicit `@mapping assignment:<name>` hints). Default fallback is the `assignment1` page in `FirstWiki` when no override is supplied.
    - Enumerate attachments on the target page; validate presence of one spreadsheet + one docx.
    - If the assignment page contains child pages (e.g., sub-folders per business line), iterate through children until the expected attachment pair is found.
    - Download attachments into a temporary working directory (e.g., `./tmp/mapping/<assignment>/<timestamp>/`).
    - Load spreadsheet headers/data preview (`pandas.read_excel/read_csv`).
    - Parse Word template using `python-docx` (tables + key paragraphs). Extract field names, placeholder tags, and contextual text around them.
    - Persist structured representations and local paths to shared state (`source_columns`, `target_fields`, `local_assignment_dir`).
 2. **Context Enrichment Agent**
    - For each target field, query `CustomWikiRAG` with cues (field label + business line) to retrieve definitions/policies.
    - Optionally ask developers for clarifications if wiki returns low-confidence results.
 3. **Historical Similarity Agent**
    - Query wiki for prior mapping CSV attachments tagged with the assignment's product line; download lightweight versions into cache.
    - Compute embeddings via shared `generate_embeddings` to find closest prior mappings per target field and surface suggested source columns.
 4. **Mapping Synthesizer Agent**
    - Combine spreadsheet metadata, wiki context, and historical suggestions to propose mapping rows. Include confidence, rationale snippets, and references to wiki/historical sources.
    - Write results to CSV file inside working directory (`mapping_output.csv`) plus optional JSON summary for logs/upload.
 5. **Validation Agent**
    - Re-open the generated CSV and cross-check every mapped field against the parsed Word targets (missing, duplicated, or unmapped entries).
    - Run structural checks (file present, expected headers, required metadata rows) and basic data hygiene rules (blank source columns, conflicting transformations).
    - Persist validation findings (`validation_issues`, `warnings`) into shared state for downstream messaging and gating.
 6. **"Great Job" Knowledge Agent**
    - Perform a broader wiki search (e.g., Confluence CQL queries scoped to `FirstWiki`) for knowledge-base pages tagged with mapping guidance, product-specific rules, or historical retrospectives.
    - Extract key insights and compliance notes, attach page URLs, and compare recommendations against the synthesized mapping to highlight potential conflicts or missing fields.
    - Persist supplemental insights (`supplemental_insights`, `knowledge_conflicts`) in shared state for the review step.
 7. **Developer Review Step**
    - Present summary (top conflicts, missing fields, duplicates) alongside supplemental insights unearthed by the "Great Job" agent. Offer follow-up actions (regenerate, adjust heuristics, ask wiki follow-up).
    - Provide download link/path for `mapping_output.csv` and instructions for uploading back to wiki when satisfied.

- **Recipe definition:** encode orchestrator instructions for chaining these agents, including error handling (missing files, unsupported formats). Provide knobs: `--assignment-page`, `--include-historical`, `--skip-wiki` for quicker iterations.

## Agent Responsibilities
| Agent | Key Actions | Inputs | Outputs |
| --- | --- | --- | --- |
| Assignment Locator | Discover wiki page, download Excel/Word attachments; parse schemas | assignment hint, wiki credentials | structured source columns, target fields, local temp dir, warnings |
| Context Enrichment | Query `@wiki` RAG for business meaning and definitions | target_fields, product metadata | contextual notes per field |
| Historical Similarity | Retrieve prior mapping CSVs from wiki, suggest matches | target_fields, wiki historical cache | suggested source columns, similarity scores |
| Mapping Synthesizer | Merge evidence, build final mapping CSV | columns, wiki notes, history suggestions | `mapping_output.csv`, run metadata |
| Validation Agent | Cross-check CSV vs Word targets; enforce schema rules | mapping CSV path, target_fields | validation_issues, warnings |
| "Great Job" Knowledge Agent | Mine broader wiki guidance; flag conflicts | assignment metadata, wiki credentials | supplemental_insights, knowledge_conflicts |
| Review Agent | Summarize results, highlight gaps; block completion if blockers remain | mapping CSV path, validation_issues, supplemental_insights | chat response, action prompts |

## Data Flow & Storage
1. Locator agent queries wiki, downloads Excel/CSV to temp dir via `requests` → column metadata saved in state (no DB writes).
2. Word parser uses `python-docx` on downloaded template to capture field labels (headings, table cells, form tags) → stored in state.
3. Historical agent queries wiki for prior mapping CSV attachments (by label or naming convention), downloads read-only copies, and loads them for similarity suggestions.
4. Synthesizer writes new CSV (e.g., columns: `target_field`, `source_column`, `transformation_notes`, `wiki_context`, `historical_reference`, `confidence`). Schema can evolve; initial version should mirror provided sample once shared.
5. Validation agent re-opens CSV ensuring structural + semantic checks pass before surfacing results to the user.
6. "Great Job" agent performs broader wiki knowledge mining, annotating supplemental insights and conflicts.
7. Optional JSON summary may be stored in TinyDB for quick lookup, but MVP keeps output files only until developer uploads to wiki.

## Integration Points
- **Wiki RAG:** reuse `perform_wiki_rag` with prompts like `"Explain <field> within group insurance."` Ensure `AZURE_OPENAI_EMBEDDING_API_VERSION` set so embeddings succeed.
- **Annotation config:** update `annotation_commands.json` and orchestrator dispatch logic to recognize `@mapping`.
- **LangGraph:** add new nodes/edges in `langgraph_flow.py` (or retrieval variant) implementing the above agents. Shared state should include keys: `assignment_page_id`, `local_assignment_dir`, `source_columns`, `target_fields`, `wiki_notes`, `history_suggestions`, `mapping_output_path`, `validation_issues`, `supplemental_insights`, `knowledge_conflicts`.
- **Wiki Attachment API:** create helper in `mapping_agents/wiki_downloader.py` to authenticate, list attachments per page, and stream downloads with retries.
- **Knowledge Mining:** build `mapping_agents/wiki_knowledge_agent.py` leveraging Confluence CQL to search the wider space (`FirstWiki`) for pages tagged with `kb_mapping_guidelines`, `kb_product_specific`, etc., returning structured supplemental insights.

## Development Tasks
1. **Scaffolding**
   - Create `backend/components/mapping_agents/` package with modules for wiki locator, attachment downloader, parser, history matcher, synthesizer, knowledge miner.
   - Add utilities for Excel/Word handling (`pandas`, `python-docx`, `openpyxl`). Update root `requirements.txt` and regenerate the virtual environment so all developers share the same baseline.
2. **Intent Wiring**
   - Add `@mapping` annotation and update plan/intent selection in orchestrator.
   - Extend plan graph to include new agents under `mapping_plan` recipe.
3. **Wiki & File Processing**
   - Implement wiki page discovery respecting user input and safe guards (label filters, explicit page IDs).
   - Stream attachments to temp directory with checksum validation; ensure temp files cleaned up post-run (unless developer requests preservation).
   - Build Word parser with support for tables, heading detection, and placeholder tokens (e.g., `<FieldName>`).
   - Provide default fallback handling for `assignment1` and iterate through child pages when attachments are nested below the primary page.
4. **Contextual Agents**
   - Integrate wiki RAG calls; structure results (summary, source titles).
   - Implement historical similarity using embeddings (reuse `embedding_utils`). Cache results for performance.
   - Build "Great Job" knowledge miner to scan broader wiki spaces for guidance, supplementing the mapping with compliance or best-practice notes.
5. **Output Generation & Validation**
   - Define CSV output writer (`DataFrame.to_csv`) aligning with sample schema once provided; include UTF-8 BOM if downstream tools require.
   - Implement validation agent entry point that reruns Word-target comparisons, checks output schema, and persists `validation_issues`.
   - Generate metadata JSON (timestamp, files used, wiki hits, historical references, supplemental insights) alongside CSV for easy upload to wiki.
6. **Conversation UX**
   - Update chat formatter to present mapping summary (top matches, unresolved fields) and link to local output path.
   - Surface supplemental insights/conflicts provided by the "Great Job" agent with direct wiki links for follow-up.
   - Provide step-by-step instructions for uploading CSV back to wiki (page link, attachment name) once developer approves.
   - Gate final success message on validation results; highlight blockers or request developer confirmation if warnings remain.
7. **Logging & Exception Handling**
   - Add shared logging helpers inside the mapping package that call `logging.getLogger("agentic_orchestrator_auto")` to maintain unified log streams.
   - Emit structured `logger.info` events at stage start/finish and `logger.warning` for recoverable issues; include keys like `assignment_path`, `agent`, `step`, and `correlation_id`.
   - Wrap risky operations (filesystem, parsing, FAISS lookups, Excel writes) in `try/except`; raise purpose-built exceptions (`MappingDataError`, `MappingValidationError`) with developer-facing tips.
   - Use `logger.exception` inside exception handlers to capture stack traces while returning sanitized summaries to the orchestrator.

## Logging & Error Handling Guidelines
- Always propagate the `correlation_id` provided by the orchestrator when emitting logs so diagnostics can be stitched across services.
- Log stage transitions with `logger.info` and include elapsed milliseconds for performance baselines; use `logger.debug` sparingly for high-volume events.
- Validation and review agents must fail-fast on blockers by raising `MappingValidationError`; supervisor catches and marks plan status `needs_followup` while echoing remediation steps.
- When wiki or historical lookups fail, log at WARN with retry context, continue with degraded output, and append a warning entry to `validation_issues`.
- Persist detailed traces to `logs/agentic_orchestrator_auto.log` while surfacing concise summaries to developers; ensure PII is redacted before logging.
- Maintain an error code catalog (`MAP-LOC-001`, `MAP-VAL-002`, etc.) to support support-team triage and link to runbook entries.
- "Great Job" agent should record knowledge-base page IDs it inspects, note whether conflicts were detected, and use distinct error codes (e.g., `MAP-KB-001`) when guidance cannot be retrieved.

## Testing Strategy
- **Unit Tests**
   - Mock wiki attachment responses and Excel/Word payloads using sanitized samples stored under `tests/data/mapping/`.
   - Verify locator agent handles missing attachments, multiple spreadsheets, CSV vs XLSX.
   - Test Word parser on tables, bullet lists, and repeated field labels.
   - Ensure historical similarity gracefully handles empty history or embedding failures.
   - Stub wiki search endpoints to validate "Great Job" agent surfaces supplemental insights and handles no-result scenarios without raising.
- **Integration Tests**
   - End-to-end run using wiki emulator; assert output CSV matches expected schema, validation agent flags intentional issues, and includes mappings for each target field.
   - Simulate wiki failures (e.g., 404 attachments, throttling) to confirm agent retries and surfaces warnings.
   - Inject malformed workbook scenarios (missing sheet, duplicate targets) to ensure validation agent blocks completion with actionable errors.
   - Confirm `@mapping` annotation routes to new plan without affecting other personas.
   - Validate "Great Job" agent retrieves tagged knowledge-base pages and correctly identifies conflicts vs. confirmations.
   - Capture logging output and assert required fields (`correlation_id`, `agent`, `step`, `status`) are present for successful and failure paths.
- **Manual QA**
   - Developer runs plan against live wiki assignment; inspect generated CSV, metadata JSON, log output, "Great Job" supplemental insights, and chat summary.
   - Validate concurrency by running mapping plan while existing wiki RAG queries execute (ensuring logging compatibility).

## Open Questions / Next Steps
- Need finalized output schema example from business team to lock column headers.
- Confirm whether historical mappings include transformation formulas (e.g., concatenations) requiring extra metadata columns.
- Decide on retention policy: should results be versioned or overwritten per run?
- Determine caching strategy for downloaded attachments (temp dir vs persistent cache) and cleanup policy.
- Decide escalation path when validation blockers persist—e.g., require developer override flag vs. holding the plan in `needs_followup` state.
- Define log retention/rotation approach for `agentic_orchestrator_auto.log` and whether to mirror high-severity events to centralized observability tooling.
- Confirm dependency list remains in sync with `requirements.txt`; add automated check (pre-commit or CI) to flag missing packages before deployment.
- Standardize wiki labels/taxonomy (e.g., `kb_mapping_guidelines`, `kb_product_specific`) so the "Great Job" agent consistently finds relevant knowledge-base pages.

Once sample files are available, update this document with the specific schema and any domain-specific heuristics derived from real data.

## Detailed Technical Change Plan

### High-Level Objectives
- Introduce the mapping workflow while preserving all existing personas and flows.
- Continue leveraging LangGraph for dynamic plans, but delegate graph construction/execution to a dedicated supervisor module for maintainability.

### Planned File & Module Changes
- **`annotation_commands.json`**: add `@mapping` entry with description/example.
- **`backend/components/agentic_orchestrator_auto.py`**: detect `@mapping` (or mapping intent) and hand off to supervisor; ensure correlation IDs propagate to wiki download helpers.
- **`backend/components/supervisor_agentic_orchestrator.py`** *(new)*:
   - Encapsulate LangGraph recipe selection and execution for complex plans (starting with mapping).
   - Reuse existing utilities from `agentic_orchestrator_auto` (state setup, logging, error handling).
   - Expose `run_plan(command: Command) -> PlanResult` so existing HTTP handlers stay unchanged.
- **`backend/components/mapping_agents/`** *(new package)*:
   - Modules: `wiki_locator.py`, `attachment_downloader.py`, `excel_parser.py`, `word_parser.py`, `historical_similarity.py`, `mapping_synthesizer.py`, `validation.py`, `wiki_knowledge_agent.py`, `review.py`.
   - Shared helper for temp workspace management (`tempfile.mkdtemp`, cleanup utilities) and structured logging.
- **`backend/components/mapping_agents/wiki_downloader.py`** *(new)*: thin client around Confluence REST API for listing pages, attachments, and streaming downloads with retry/backoff.
- **`backend/components/mapping_agents/wiki_knowledge_agent.py`** *(new)*: encapsulates "Great Job" logic—performs CQL searches, extracts highlights, detects conflicts, and returns structured supplemental insights.
- **`backend/components/langgraph_flow.py` / retrieval variant**:
   - Register mapping agent nodes or provide builder functions consumed by the supervisor.
   - Ensure legacy plans remain untouched; guard new logic behind explicit recipe IDs.
- **Intent detection (e.g., `agentic_orchestrator_api.py`)**: add heuristics for mapping questions in addition to `@mapping`.
- **Configuration**: document required env vars (`CONFLUENCE_*`) and update deployment manifests/KeyVault entries accordingly.
- **Tests**: create `tests/mapping/` for unit/integration coverage; extend regression suite for legacy intents.

### Supervisor Delegation Strategy
1. **Detection**: `agentic_orchestrator_auto` inspects incoming command; if mapping intent, invoke supervisor (`run_mapping_plan`).
2. **Graph Assembly**: supervisor builds LangGraph dynamically, wiring mapping agents plus shared orchestrator nodes (logging, persistence, error guardrails).
3. **Execution**: supervisor executes graph and returns structured result (`mapping_output.csv` path, supplemental insights, summary). `agentic_orchestrator_auto` formats response exactly as today.
4. **Extensibility**: future recipes can register with supervisor without inflating `agentic_orchestrator_auto`.

### Safeguards & Compatibility
- Keep logging under the `agentic_orchestrator_auto` hierarchy for unified diagnostics.
- Feature-flag mapping plan (e.g., `ENABLE_MAPPING_PLAN`) for safe rollout.
- Avoid TinyDB schema changes unless namespaced (e.g., `mapping_history`).
- Run regression tests for existing personas to confirm zero behavioral drift.
- Cache downloaded attachments cautiously; respect corporate data retention policies and purge temp directories on success/failure.

### Additional Testing
- Supervisor smoke tests confirming non-mapping intents bypass new path.
- Integration test for `@mapping` end-to-end (mock wiki/historical data, CSV output).
- Manual QA checklist for developers: select assignment page, run mapping plan, verify output CSV/JSON, "Great Job" supplemental insights, and log entries, upload results to wiki.
