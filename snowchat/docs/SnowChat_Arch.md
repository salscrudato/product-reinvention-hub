# SnowChat Architecture Overview

Purpose
-------
This document provides a detailed architecture overview of SnowChat — an enterprise agentic AI platform for incident management, knowledge retrieval, and intelligent automation targeted at insurance operations. It is written to help CTO-level stakeholders understand the system components, data flows, integrations, security model, scaling considerations, and how to present the architecture in a 2-page executive deck (convertible to SmartArt in Office 365).

Audience
--------
- CTO / Engineering leadership
- Architects evaluating integration and compliance
- Product and platform engineering teams

High-level Summary
------------------
SnowChat is an annotation-driven agentic AI platform combining: a Flask backend, a React frontend, LangGraph orchestration for multi-step workflows, FAISS vector search for retrieval-augmented generation (RAG), and connector tools for ServiceNow, Confluence (wiki), Splunk, and GitHub. The system supports annotation-triggered execution paths (e.g., `@wiki`, `@code`), a tool registry for safe tool execution, and SQL-like state persistence using TinyDB for prototyping.

ASCII Topology Diagram (Logical)
--------------------------------
This diagram is intentionally simple and converts well to SmartArt boxes/arrows.

                +----------------+            +----------------+
                |   Web Client   | <--------> |  Auth (Keycloak)|
                | (React SPA)    |            +----------------+
                +----------------+
                        |
                        | HTTPS / WebSocket
                        v
                +----------------+
                |  API Gateway   |  <-- load-balancer (optional)
                +----------------+
                        |
        +---------------+----------------+
        |                                |
        v                                v
 +---------------+                +---------------+
 | SnowChat API  |                |  LangGraph    |
 | (Flask + REST)|                |  Planner &    |
 |               |                |  Executor     |
 +---------------+                +---------------+
        |                                |
        |                                v
        |                        +---------------+
        |                        |  Tool Runner  |
        |                        | (registered)  |
        |                        +---------------+
        v                                |
 +---------------+              +--------+--------+   +--------------+
 | RAG Services  | <--- FAISS ---|  Confluence     |   |  GitHub Code |
 | (Embeddings)  |              |  / Wiki index   |   |  Index       |
 +---------------+              +-----------------+   +--------------+
        |
        v
 +---------------+
 | Vector DB     |
 | (FAISS index) |
 +---------------+

Key Components (detailed)
-------------------------
- Frontend (React):
  - Single Page Application, Material UI for prototyping.
  - Sends user queries and receives agent responses. Supports streaming results and feedback.

- Auth & Identity:
  - Keycloak (or equivalent) for SSO, token issuance, and RBAC.
  - Short-lived tokens for API calls, role-based access to tools.

- API Layer (Flask):
  - REST endpoints for chat sessions, orchestration requests, tool invocations.
  - Handles routing to planner (LangGraph) or direct tools based on annotations.

- LangGraph Orchestrator:
  - Generates multi-step plans for complex queries (e.g., check SNOW, run RAG, call code search).
  - Manages state, retries, and error handling across steps.

- Tool Registry & Runner:
  - Tools register via decorators into a `FUNCTION_REGISTRY`.
  - Tools are sandboxed: deterministic inputs/outputs, small timeouts, safe fallbacks.
  - Examples: `wiki_rag_tool`, `code_rag_tool`, `fetch_servicenow_incident_core`.

- RAG & Vector Search:
  - Embeddings produced via configured LLM provider.
  - FAISS index stores document chunks and code embeddings.
  - Retrieval node returns top-k chunks to LLM for synthesis.

- State & Persistence:
  - TinyDB used for lightweight prototyping (`state_db.json`, `chat_history` table).
  - Longer-term: replace with Postgres/Redis for concurrency and scale.

- Observability & Tracing:
  - Aggregated logs in `agentic_orchestrator_auto.log`.
  - LangSmith (optional) for distributed planning traces.

Data Flow (example: @wiki query)
--------------------------------
1. User types: "@wiki What is the claims bonding policy?"
2. Frontend sends request to API with annotation detected.
3. API forwards to LangGraph planner: generates plan [Search wiki -> Summarize -> Format].
4. Planner calls `wiki_rag_tool` with query; tool performs FAISS nearest-neighbor search.
5. Retrieval returns top-K docs; LLM synthesizes answer with citations.
6. Response streamed back to client; conversation saved to TinyDB.

Security & Privacy
------------------
- Least privilege for tool execution: tools accept limited scopes and sanitized inputs.
- Audit logging: every tool invocation and plan step is logged with user and request id.
- Secrets: stored in environment variables or vault (Azure Key Vault/HashiCorp Vault).
- PII handling: RAG context trimmed and redaction policies applied before log/storage.

Scaling Considerations
----------------------
- Stateless API nodes behind load balancer for concurrency.
- FAISS indices sharded per domain or tenant; hot indices pre-loaded in memory.
- Use Redis/RQ or Celery for background indexing, long-running RAG jobs.
- Replace TinyDB with Postgres (ACID) + Redis for cache/session management.

Deployment Topology (ASCII)
--------------------------
  On-Prem / Cloud Hybrid

  [ Users ]
     |
  [ LB / API GW ]
     |
  [ Flask API (stateless) ] x N
     |         |
     |         +--> [ LangGraph Worker Pool ]
     |                      |
     |                      +--> [Tool Runner / Sandbox]
     |
     +--> [ RAG Service ]
               |
               +--> [ FAISS (shards) ]
               +--> [Embedding Cache (local/redis)]

Extensibility Patterns
----------------------
- Tool-first architecture: add new integrations by implementing a tool and registering it.
- Prompt catalog: place templated prompts in `components/prompt_catalog.json` for standardized responses.
- Indexing pipeline: pluggable connectors for Confluence, GitHub, and ServiceNow.

Operational Playbook (high-level)
--------------------------------
1. Onboarding: Run `vectorize_confluence_wiki.py` to build initial FAISS index.
2. Monitoring: watch `agentic_orchestrator_auto.log` and LangGraph traces.
3. Incident: disable tool registry entries to sandbox the agent; replay logs for debugging.

2-Page Deck Layout (how to convert to SmartArt)
----------------------------------------------
Page 1 — Executive Summary + Logical Architecture
- Top: One-line value proposition and bullets (3–4 items).
- Middle: Large SmartArt block showing the Logical ASCII Topology above. Use a central box for "SnowChat API" and satellite boxes for LangGraph, RAG, Vector DB, and Integrations.
- Bottom: Key metrics & SLAs (Latency, Retrieval RTO, Security compliance).

Page 2 — Data Flow, Extensibility & Ops
- Top: Step-by-step data-flow for a sample use-case (e.g., @wiki). Use 5–6 sequential SmartArt shapes.
- Middle-left: Security & compliance callouts.
- Middle-right: Scaling & deployment bullets.
- Bottom: Roadmap bullets (multi-tenant, enterprise governance, improved observability).

Talking points (for CTO audience)
--------------------------------
- How agentic orchestration reduces mean-time-to-resolution for incidents.
- How RAG + embeddings improve accuracy for domain-specific wiki searches.
- How tool registration allows safe extensibility for core systems like ServiceNow.
- Migration path from prototype (TinyDB + FAISS) to enterprise (Postgres, Redis, multi-FAISS shards).

Appendix: Useful Code Locations
-------------------------------
- API entrypoint: `backend/app.py`
- Orchestrator: `backend/components/agentic_orchestrator_api.py`
- LangGraph flows: `backend/components/langgraph_flow.py`
- RAG tools: `backend/components/CustomWikiRAG.py`
- Tool registry: `backend/components/shared_registry.py` (or decorator in `snowaaonetool.py`)
- Indexing script: `backend/components/vectorize_confluence_wiki.py`

Contact
-------
For questions about the code or to request a walkthrough, contact the engineering team or open an issue in the project repository.

-- End of SnowChat Architecture Overview
