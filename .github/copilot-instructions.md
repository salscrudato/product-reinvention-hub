# SnowChat - Enterprise Agentic AI Platform

## Project Overview
An enterprise-grade agentic AI platform for incident management, knowledge retrieval, and intelligent automation. Combines LLMs, RAG (Retrieval-Augmented Generation), and annotation-driven orchestration with integrations to ServiceNow, Confluence, Splunk, and GitHub.

**Stack:** Python/Flask backend, React frontend, LangGraph orchestration, FAISS vector search, Keycloak auth

## Architecture & Key Concepts

### Agentic Orchestration Pattern
SnowChat uses **annotation-driven workflow orchestration** where user queries with special annotations (`@wiki`, `@code`, `@checkpref`) trigger specific execution paths:

```python
# Annotation commands defined in annotation_commands.json
@wiki    # Triggers CustomWikiRAG for Confluence search
@code    # Triggers code RAG using FAISS embeddings
@checkpref # Uses stored user preferences for function sequences
```

**Flow:**
1. User query → `agentic_orchestrator_api.py` → Intent classification
2. Annotation detection → Route to specialized tool (wiki/code/ServiceNow)
3. LangGraph planner generates multi-step plan → Execute tools → Format response

### Component Structure
```
backend/
├── app.py                           # Main Flask app, blueprint registration
├── components/
│   ├── agentic_orchestrator_api.py  # API endpoints for chat/orchestration
│   ├── generic_tool_orchestrator.py # Legacy orchestrator + feedback endpoints
│   ├── langgraph_flow.py            # LangGraph workflow engine
│   ├── snowaaonetool.py             # Tool registration decorators
│   ├── CustomWikiRAG.py             # Confluence RAG implementation
│   ├── code_indexer/                # GitHub code indexing
│   └── prompt_catalog.py            # Configurable prompt system
frontend/
├── (React app with Material UI)
```

### Tool Registration System
Tools are registered using decorators and stored in `shared_registry.py`:

```python
from .shared_registry import FUNCTION_REGISTRY

@register_tool_function("wiki_rag_tool")
def wiki_rag_tool(question: str):
    result = perform_wiki_rag(question)
    return {"summary": result}
```

**Key tool modules:**
- `snowaaonetool.py` - ServiceNow incident tools, wiki RAG, context QA
- `servicenowgenaitool.py` - Core ServiceNow API integrations, embeddings
- `developer_incident_tools.py` - Developer-specific workflows

## Data Persistence

### TinyDB Usage (`state_db.json`)
- **Chat History:** Table `chat_history` stores all user/AI conversations
- **Feedback:** Function sequence preferences for `@checkpref` annotation
- **User Context:** Stores user preferences and session data

**Access Pattern:**
```python
from tinydb import TinyDB, Query
db = TinyDB('state_db.json')
chat_table = db.table('chat_history')
User = Query()
history = chat_table.search(User.username == username)
```

### FAISS Vector Indices
- **Wiki embeddings:** `Embeddings_Lookup_cache.index` (Confluence docs)
- **Code embeddings:** `code_embeddings.index` (GitHub repos)
- **Cache:** `embedding_cache.json` for OpenAI API cost reduction

## Development Workflows

### Running Locally (PowerShell)
```powershell
# Full stack startup
.\start-all.ps1              # Kafka + Keycloak + Backend + Frontend

# Quick start (no Kafka/Keycloak)
.\start-all.ps1 -Quick -NoKeycloak

# Backend only
cd backend
python app.py

# Frontend only
cd frontend
npm start
```

**Ports:**
- Backend: 5001 (Flask)
- Frontend: 3000 (React)
- Keycloak: 8080
- Kafka: 9092

### Environment Variables
```bash
AZURE_OPENAI_ENDPOINT      # Azure OpenAI endpoint
AZURE_OPENAI_API_KEY       # API key
OPENAI_API_VERSION         # API version (e.g., "2023-05-15")
GPT_MODEL_NAME             # Model deployment name
SNOWCHAT_CORS_ORIGINS      # Comma-separated allowed origins
KAFKA_HOME                 # Path to Kafka installation
KEYCLOAK_HOME              # Path to Keycloak
```

### Testing & Debugging
```powershell
# Python tests
cd backend
pytest

# Diagnose FAISS indices
python scripts/diagnose_faiss_and_db.py

# Check Kafka environment
python diagnose_kafka_env.py

# Enable diagnostic logging
$env:SNOWCHAT_DIAG = "1"
```

## Key Integration Points

### ServiceNow API
**Core module:** `components/servicenowgenaitool.py`

Functions:
- `fetch_servicenow_incident_core(incident_number)` - Get incident details
- `predict_assignment_group_core(description)` - ML-based group prediction
- `get_similar_incidents_simple(description)` - Similarity search via FAISS
- `splunk_query(query)` - Execute Splunk searches

**Authentication:** Uses `SNOW_INSTANCE`, `SNOW_USER`, `SNOW_PASSWORD` env vars

### Confluence/Wiki RAG
**Core module:** `components/CustomWikiRAG.py`

```python
def perform_wiki_rag(question: str):
    # 1. Generate embeddings for question
    # 2. FAISS similarity search in Embeddings_Lookup_cache.index
    # 3. Retrieve top-k relevant chunks
    # 4. LLM synthesis with context
    return {"answer": response, "sources": [...]}
```

**Index creation:**
```bash
cd backend
python components/vectorize_confluence_wiki.py
```

### Prompt Catalog System (Phase 3/4)
JSON-driven configurable prompts with parameter injection:

**File:** `components/prompt_catalog.json`
```json
{
  "prompts": [
    {
      "id": "incident_analysis",
      "persona": "ServiceNow Agent",
      "template": "Analyze incident {incident_number}: {description}",
      "enabled": true
    }
  ]
}
```

**Endpoints:**
- `POST /prompts/upsert` - Add/update prompts
- `GET /prompts/validate` - Check prompt integrity
- `POST /prompts/{id}/toggle` - Enable/disable prompts

## LangGraph Workflow Engine

**File:** `components/langgraph_flow.py`

LangGraph manages multi-step agentic workflows:

```python
def process_question_with_prompt_and_metadata(question, metadata):
    # 1. Planner node - generates step-by-step plan
    # 2. Tool executor nodes - calls registered tools
    # 3. Done node - formats final response
    # State flows through graph with backtracking on errors
```

**State Schema:**
- `plan` - List of steps to execute
- `context` - Accumulated results
- `history` - Tool call history
- `metadata` - User context, annotations

## Logging & Observability

### Unified Logging
All components funnel to `agentic_orchestrator_auto.log`:

```python
logger = logging.getLogger("agentic_orchestrator_auto")
logger.info(f"[FLOW] Step executed: {step_name}")
```

**Log levels:**
- INFO: Normal flow, API calls, tool executions
- WARN: Retries, fallbacks, missing data
- ERROR: Exceptions, failed integrations

### LangSmith Integration
```python
from langsmith import trace

@trace
def my_agentic_function(inputs):
    # Automatically traced in LangSmith dashboard
```

## Common Patterns

### Adding New Tools
1. **Define function** in `components/` module
2. **Register with decorator:**
   ```python
   @register_tool_function("my_new_tool")
   def my_tool(args):
       return result
   ```
3. **Create Tool instance:**
   ```python
   from langchain_community.tools import Tool
   my_tool_def = Tool(
       name="my_new_tool",
       func=lambda args: my_tool(args),
       description="What this tool does"
   )
   ```
4. **Add to tool list** in orchestrator imports

### Handling User Queries
1. **Parse annotations** - Check for `@wiki`, `@code`, `@checkpref`
2. **Route appropriately** - Send to specific RAG or tool
3. **Generate embeddings** - Use `generate_embeddings()` from servicenowgenaitool
4. **Execute plan** - LangGraph or direct tool call
5. **Format response** - Use `answer_formatter.py` for consistent structure

## Dependencies & Versions

**Critical packages:**
- `langchain>=0.3.26` - Core orchestration (NOTE: avoid deprecated `initialize_agent`)
- `langgraph>=0.5.2` - Workflow graphs
- `faiss-cpu` - Vector search
- `openai` - Azure OpenAI API
- `flask` + `flask-cors` - Backend server
- `tinydb` - Local database
- `kafka-python>=2.0.2` - Event streaming (optional)
- `crewai>=0.64.0` - Alternative agentic framework

**Import fallbacks:** Code uses try/except chains for LangChain imports due to package restructuring across versions:
```python
try:
    from langchain_community.tools import Tool
except:
    from langchain.tools import Tool
```

## Common Pitfalls

1. **LangChain version conflicts** - Use fallback import patterns for Tool/Memory classes
2. **FAISS index missing** - Run vectorization scripts before RAG queries
3. **TinyDB concurrency** - TinyDB is single-threaded; avoid parallel writes
4. **OpenAI rate limits** - Use `embedding_cache.json` to cache embeddings
5. **Kafka optional** - System falls back to `event_spool.jsonl` when Kafka unavailable
6. **CORS configuration** - Update `SNOWCHAT_CORS_ORIGINS` for frontend ports
7. **Keycloak username vs email** - Tolerant matching in chat_history queries handles both

## Documentation Files
- `README.md` - Full project overview (604 lines)
- `AGENTIC_AI_PROJECT_INTENTION.md` - Project vision
- `annotation_commands.json` - Annotation definitions
- Component-specific READMEs in subdirectories
