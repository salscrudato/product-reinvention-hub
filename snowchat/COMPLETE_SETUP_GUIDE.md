# SnowChat - Complete Setup & Operations Guide

**Enterprise Agentic AI Platform for Incident Management & Knowledge Retrieval**

**Version:** 1.0  
**Last Updated:** March 27, 2026  
**Document Status:** Official Team Reference

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Initial Setup](#initial-setup)
4. [Configuration](#configuration)
5. [Running the Application](#running-the-application)
6. [Verification & Testing](#verification--testing)
7. [Daily Development](#daily-development)
8. [Architecture Reference](#architecture-reference)
9. [Troubleshooting](#troubleshooting)
10. [Command Reference](#command-reference)
11. [Support & Resources](#support--resources)

---

## Overview

**SnowChat** is an enterprise-grade agentic AI platform that combines:
- 🤖 **LLM-Powered Chat** - Azure OpenAI (GPT-4) with intelligent orchestration
- 🔍 **RAG (Retrieval-Augmented Generation)** - Confluence/Wiki knowledge search via FAISS vector embeddings
- 🎯 **ServiceNow Integration** - Incident management, assignment prediction, similarity search
- 📊 **Code Search** - GitHub repository indexing and semantic code search
- 🌊 **Agentic Orchestration** - LangGraph-based multi-step planning and execution
- 📝 **Annotation-Driven Workflows** - Special `@wiki`, `@code`, `@checkpref` commands

**Tech Stack:**
- Backend: Python 3.8+, Flask, LangChain 0.3.26+, LangGraph 0.5.2+, FAISS
- Frontend: React 19.0.0, Material-UI 7.0.2, Socket.IO 4.8.1
- Database: TinyDB (JSON file-based)
- Optional: Apache Kafka 2.0.2+, Keycloak 26.2.0

---

## Prerequisites

### Required Software

#### 1. Python 3.8 or Higher
```powershell
# Check version
python --version

# Should output: Python 3.8.x or higher
```

**Installation:**
- Download: https://www.python.org/downloads/
- **CRITICAL:** During installation, check ✅ "Add Python to PATH"
- Recommended: Python 3.10 or 3.11 for best compatibility

#### 2. Node.js 16.x or Higher
```powershell
# Check versions
node --version   # Should be v16.x or higher
npm --version    # Should be 8.x or higher
```

**Installation:**
- Download: https://nodejs.org/ (LTS version recommended)
- Installer automatically adds Node and npm to PATH

#### 3. Git
```powershell
# Check version
git --version
```

**Installation:**
- Download: https://git-scm.com/downloads/
- Accept default settings during installation

### Optional Components

#### 4. Apache Kafka (Optional - for event streaming)
- **When needed:** Multi-service architectures, production deployments
- **Not needed:** Local development (uses file-based `event_spool.jsonl` fallback)
- **Setup:** Extract to `C:\dev\kafka` or set `KAFKA_HOME` environment variable
- **Version:** kafka-python 2.0.2+ client compatibility

#### 5. Keycloak (Optional - for authentication)
- **When needed:** Authentication/authorization testing
- **Not needed:** Development (auth can be disabled)
- **Setup:** Set `KEYCLOAK_HOME` environment variable
- **Version:** 26.2.0 (keycloak-js client)

#### 6. Docker Desktop (Optional - alternative Kafka deployment)
- **When needed:** If using Docker-based Kafka instead of native
- Download: https://www.docker.com/products/docker-desktop/
- Only needed if `kafka/docker-compose.yml` exists in project

---

## Initial Setup

### Step 1: Clone the Repository

```powershell
# Create development directory
cd C:\dev

# Clone repository
git clone <your-repository-url> snowchat

# Navigate to project
cd snowchat

# Verify structure
dir
```

**Expected directories:**
```
backend/         # Python Flask backend
frontend/        # React frontend
scripts/         # Utility scripts
requirements.txt # Python dependencies
start-all.ps1    # Unified startup script
```

### Step 2: Obtain Credentials

Contact your team lead to obtain:

#### Required Credentials:
1. **Azure OpenAI**
   - API Endpoint URL
   - API Key
   - GPT-4 Deployment Name
   - Text Embedding Deployment Name

2. **ServiceNow**
   - Instance URL (e.g., `https://dev12345.service-now.com`)
   - Service Account Username
   - Service Account Password (or API token)

#### Optional Credentials:
3. **GitHub** (for code search features)
   - Repository URL
   - Personal Access Token (with `repo` scope)

4. **Keycloak** (for authentication)
   - Realm name
   - Client ID
   - Server URL

### Step 3: Install Python Dependencies

```powershell
# Install dependencies globally (simple but not isolated)
pip install -r requirements.txt

# OR install in virtual environment (RECOMMENDED)
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

**Key Dependencies Installed:**
- `flask` - Web framework
- `langchain>=0.3.26` - LLM orchestration framework
- `langgraph>=0.5.2` - Graph-based workflow engine
- `faiss-cpu` - Vector similarity search
- `openai` - Azure OpenAI API client
- `tinydb` - JSON database
- `kafka-python>=2.0.2` - Kafka client (optional)
- `pytest` - Testing framework
- `crewai>=0.64.0` - Agent framework

**Installation time:** Approximately 3-5 minutes

### Step 4: Install Frontend Dependencies

```powershell
# Navigate to frontend directory
cd frontend

# Install Node packages
npm install

# Return to project root
cd ..
```

**Key Dependencies Installed:**
- `react@19.0.0` - UI framework
- `@mui/material@7.0.2` - Material-UI components
- `axios@1.8.4` - HTTP client
- `socket.io-client@4.8.1` - Real-time communication
- `keycloak-js@26.2.0` - Authentication client

**Installation time:** Approximately 5-10 minutes

---

## Configuration

### Environment Variables Setup

Create a `.env` file in the **root** `snowchat/` directory (NOT in backend/):

```bash
# ============================================================
# AZURE OPENAI CONFIGURATION (REQUIRED)
# ============================================================
# Your Azure OpenAI endpoint URL
AZURE_OPENAI_ENDPOINT=https://your-instance.openai.azure.com/

# Your Azure OpenAI API key
AZURE_OPENAI_API_KEY=sk-your-api-key-here

# API version to use
OPENAI_API_VERSION=2023-05-15

# Your GPT-4 deployment name (NOT the model name - use your Azure deployment)
GPT_MODEL_NAME=gpt-4-deployment-name

# Your embedding model deployment name
EMBEDDING_MODEL_NAME=text-embedding-ada-002-deployment

# ============================================================
# SERVICENOW CONFIGURATION (REQUIRED for incident features)
# ============================================================
# ServiceNow instance URL
SERVICENOW_INSTANCE=https://dev12345.service-now.com

# ServiceNow username
SERVICENOW_USERNAME=service.account

# ServiceNow password
SERVICENOW_PASSWORD=your-password-here

# Alternative: Use token instead of username/password
# SERVICENOW_TOKEN=your-token-here

# ============================================================
# GITHUB INTEGRATION (OPTIONAL - for code search)
# ============================================================
# GitHub repository (org/repo format)
GITHUB_REPO=your-org/your-repo

# GitHub personal access token (needs 'repo' scope)
GITHUB_TOKEN=ghp_your_token_here

# ============================================================
# KEYCLOAK AUTHENTICATION (OPTIONAL)
# ============================================================
# Keycloak server URL
KEYCLOAK_URL=http://localhost:8080

# Keycloak realm name
KEYCLOAK_REALM=snowchat

# Keycloak client ID
KEYCLOAK_CLIENT_ID=snowchat-client

# ============================================================
# CORS CONFIGURATION (REQUIRED)
# ============================================================
# Allowed origins for CORS (comma-separated, no spaces)
SNOWCHAT_CORS_ORIGINS=http://localhost:3000,http://localhost:5001

# ============================================================
# KAFKA CONFIGURATION (OPTIONAL)
# ============================================================
# Kafka broker port (default: 9092)
# KAFKA_PORT=9092

# Kafka topic for raw events
# KAFKA_RAW_TOPIC=crew-raw-events

# Path to Kafka installation (auto-detected if in C:\dev\kafka)
# KAFKA_HOME=C:\dev\kafka

# ============================================================
# APPLICATION SETTINGS (OPTIONAL)
# ============================================================
# Backend Flask port (default: 5001)
# FLASK_PORT=5001

# Enable diagnostic/verbose logging
# SNOWCHAT_DIAG=1

# Agentic planner mode: function_call, disabled, or auto
# PLANNER_MODE=function_call

# Enable recipe fallback
# RECIPE_FALLBACK_ENABLED=true

# Strict recipe mode
# RECIPE_STRICT=false

# Verbose agentic orchestration logging
# AGENTIC_VERBOSE=true

# ============================================================
# PATHS (OPTIONAL - auto-detected)
# ============================================================
# FAISS index path
# FAISS_INDEX_PATH=Embeddings_Lookup_cache.index

# FAISS documents pickle path
# FAISS_DOCS_PATH=faiss_docs.pkl

# Embedding cache path
# EMBEDDING_CACHE_PATH=embedding_cache.json

# ============================================================
# OPTIONAL INTEGRATIONS
# ============================================================
# Splunk configuration (if using Splunk integration)
# SPLUNK_HOST=splunk.example.com
# SPLUNK_PORT=8089
# SPLUNK_USERNAME=admin
# SPLUNK_PASSWORD=changeme

# Confluence/Wiki (if syncing)
# CONFLUENCE_URL=https://wiki.example.com
# CONFLUENCE_USERNAME=username
# CONFLUENCE_API_TOKEN=token

# PostgreSQL (for SharePoint RAG caching - optional)
# POSTGRES_HOST=localhost
# POSTGRES_PORT=5432
# POSTGRES_DB=snowchat
# POSTGRES_USER=postgres
# POSTGRES_PASSWORD=password
```

### Configuration Verification Checklist

Before proceeding, verify:

- [ ] `.env` file exists in `C:\dev\snowchat\.env` (root directory)
- [ ] `AZURE_OPENAI_ENDPOINT` has your actual endpoint URL
- [ ] `AZURE_OPENAI_API_KEY` has your actual API key
- [ ] `GPT_MODEL_NAME` is your **deployment name** (not "gpt-4")
- [ ] `EMBEDDING_MODEL_NAME` is your **deployment name** (not "text-embedding-ada-002")
- [ ] `SERVICENOW_INSTANCE` has your instance URL
- [ ] `SERVICENOW_USERNAME` and `SERVICENOW_PASSWORD` are correct
- [ ] `SNOWCHAT_CORS_ORIGINS` includes `http://localhost:3000`
- [ ] No placeholder text remains (no `your-instance`, `your-key`, etc.)

---

## Running the Application

### Recommended: Unified Startup Script

The `start-all.ps1` PowerShell script automatically starts all components:

#### Quick Start (Development Mode)
```powershell
# Start frontend + backend, skip Kafka and Keycloak
.\start-all.ps1 -Quick -NoKeycloak -Backend
```

**What this does:**
- ✅ Starts React dev server on port 3000
- ✅ Auto-starts Flask backend on port 5001
- ⏭️ Skips Kafka (uses `event_spool.jsonl` file instead)
- ⏭️ Skips Keycloak (auth disabled)

#### All Options Reference

```powershell
# Full stack (Kafka + Keycloak + Frontend + Backend)
.\start-all.ps1 -Backend

# Development mode (no Kafka, no Keycloak)
.\start-all.ps1 -Quick -NoKeycloak -Backend

# With debug logging
.\start-all.ps1 -Debug -Log -Quick -NoKeycloak -Backend

# Backend only (no frontend)
.\start-all.ps1 -Backend -NoFrontend -NoKafka -NoKeycloak

# Frontend only (manual backend start)
.\start-all.ps1 -NoKafka -NoKeycloak

# Skip Kafka only (run Keycloak)
.\start-all.ps1 -NoKafka -Backend

# Enable logging to snowchat_backend.log
.\start-all.ps1 -Log -Quick -NoKeycloak -Backend
```

#### Script Output

After execution, you'll see a summary:
```
================= SUMMARY =================
Kafka........: false (port=9092)
Keycloak.....: 0
Frontend.....: 1
Backend Auto.: 1
Raw Topic....: crew-raw-events
Version......: ps1-1
===========================================
```

**Status Codes:**
- `1` or `true` = Started successfully
- `0` or `false` = Skipped or not started

### Alternative: Manual Component Startup

If you prefer individual control:

#### Start Backend (Manual)
```powershell
# Terminal 1 - Backend
cd backend
python app.py

# With debug mode
python app.py --debug-listen

# Or if using virtual environment
.\.venv\Scripts\activate
python app.py
```

**Expected Output:**
```
* Serving Flask app 'app'
* Debug mode: off
WARNING: This is a development server. Do not use it in production.
* Running on http://127.0.0.1:5001
```

#### Start Frontend (Manual)
```powershell
# Terminal 2 - Frontend
cd frontend
npm start
```

**Expected Output:**
```
Compiled successfully!

You can now view genlookupnpx in the browser.

  Local:            http://localhost:3000
  On Your Network:  http://192.168.x.x:3000
```

#### Start Kafka (Manual - Optional)
```powershell
# Terminal 3 - Kafka (if needed)
.\kafka-start.bat

# Or if using Docker
cd kafka
docker compose up -d
```

#### Start Keycloak (Manual - Optional)
```powershell
# Terminal 4 - Keycloak (if needed)
.\keycloak-start.bat

# Or if KEYCLOAK_HOME is set
cd %KEYCLOAK_HOME%\bin
kc.bat start-dev
```

---

## Verification & Testing

### Step 1: Check Services Are Running

```powershell
# Check if ports are listening
netstat -ano | findstr :3000  # Frontend
netstat -ano | findstr :5001  # Backend
netstat -ano | findstr :9092  # Kafka (if running)
netstat -ano | findstr :8080  # Keycloak (if running)
```

### Step 2: Access the Application

Open your browser and navigate to:

**Frontend UI:** http://localhost:3000

You should see the SnowChat interface load.

**Backend API:** http://localhost:5001

You should see a response (may be JSON or simple text).

### Step 3: Test Basic Functionality

#### Test 1: Simple Chat Query
1. In the UI at http://localhost:3000
2. Type in the chat box: `Hello`
3. Press Enter
4. **Expected:** AI response appears within 2-5 seconds

#### Test 2: Wiki RAG Search
1. Type: `@wiki how to reset a password`
2. Press Enter
3. **Expected:** Response with Confluence/Wiki sources cited

#### Test 3: Backend Logs
```powershell
# View real-time logs
Get-Content .\snowchat_backend.log -Wait -Tail 50

# Or for orchestrator logs
Get-Content .\agentic_orchestrator_auto.log -Wait -Tail 50
```

**Expected:** Log entries showing requests, responses, and tool execution

#### Test 4: Browser Console Check
1. Press F12 in browser
2. Go to Console tab
3. **Expected:** No red errors (warnings in yellow are OK)

### Step 4: Verify Database Created

```powershell
# Check if TinyDB database was created
Test-Path .\state_db.json

# Should return: True
```

### Step 5: Test Annotation Commands

Try these annotation-based workflows:

```
@wiki search term           # Confluence knowledge search
@code authentication        # Code repository search
@checkpref                  # Use stored user preferences
show me incident INC0012345 # ServiceNow incident lookup
```

---

## Daily Development

### Starting Your Day

```powershell
# Navigate to project
cd C:\dev\snowchat

# Activate virtual environment (if using)
.\.venv\Scripts\activate

# Start everything
.\start-all.ps1 -Quick -NoKeycloak -Backend

# Wait 30 seconds for startup
# Open browser to http://localhost:3000
```

### Common Development Tasks

#### View Logs in Real-Time
```powershell
# Main application log
Get-Content .\snowchat_backend.log -Wait -Tail 50

# Orchestration log
Get-Content .\agentic_orchestrator_auto.log -Wait -Tail 50

# Both logs simultaneously (two terminals)
# Terminal 1:
Get-Content .\snowchat_backend.log -Wait -Tail 30

# Terminal 2:
Get-Content .\agentic_orchestrator_auto.log -Wait -Tail 30
```

#### Restart Components

```powershell
# Restart backend only
# 1. Press Ctrl+C in backend terminal
# 2. Restart:
cd backend
python app.py

# Restart frontend only
# 1. Press Ctrl+C in frontend terminal
# 2. Restart:
cd frontend
npm start

# Full restart
# 1. Close all terminal windows
# 2. Re-run:
.\start-all.ps1 -Quick -NoKeycloak -Backend
```

#### Clear Database/Cache

```powershell
# Reset chat history and user preferences
Remove-Item state_db.json

# Clear embedding cache (will regenerate on next use)
Remove-Item embedding_cache.json

# Clear conversation context
Remove-Item conversation_memory.json

# Clear event spool (if using file-based Kafka fallback)
Remove-Item event_spool.jsonl
```

#### Rebuild FAISS Indices

```powershell
# Rebuild wiki/Confluence index
cd backend
python components/vectorize_confluence_wiki.py

# Rebuild code index (if code search enabled)
# (Check backend/components/code_indexer/ for indexing scripts)
```

#### Run Tests

```powershell
# Run all backend tests
cd backend
pytest

# Run with verbose output
pytest -v

# Run with coverage report
pytest --cov=components --cov-report=html

# Run specific test file
pytest tests/test_orchestrator.py

# Run specific test
pytest tests/test_orchestrator.py::test_planner
```

#### Check Python Environment

```powershell
# List installed packages
pip list

# Check specific package version
pip show langchain

# Verify dependencies
pip check

# Update a specific package
pip install --upgrade langchain
```

#### Check Node Environment

```powershell
# List installed packages
cd frontend
npm list --depth=0

# Update packages
npm update

# Audit for vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix
```

### Hot Reload Behavior

- **Frontend (React):** ✅ Supports hot reload
  - Save a file in `frontend/src/` → Browser updates automatically
  
- **Backend (Flask):** ⚠️ Requires manual restart
  - Save a file in `backend/` → Must restart `python app.py`
  - Alternative: Use Flask debug mode (not recommended for production)

---

## Architecture Reference

### Project Structure

```
snowchat/
├── .env                              # Environment variables (CREATE THIS)
├── .venv/                            # Python virtual environment (optional)
├── requirements.txt                  # Python dependencies
├── start-all.ps1                     # Unified startup script
├── state_db.json                     # TinyDB database (auto-created)
├── embedding_cache.json              # OpenAI embedding cache
├── Embeddings_Lookup_cache.index    # FAISS wiki index
├── faiss_docs.pkl                    # FAISS document metadata
├── code_embeddings.index             # FAISS code index
├── snowchat_backend.log              # Main application log
├── agentic_orchestrator_auto.log     # Orchestration log
├── event_spool.jsonl                 # Kafka fallback event log
│
├── backend/
│   ├── app.py                        # Main Flask application
│   ├── components/
│   │   ├── agentic_orchestrator_api.py    # Main API endpoints
│   │   ├── langgraph_flow.py              # LangGraph workflow engine
│   │   ├── generic_tool_orchestrator.py   # Tool orchestration
│   │   ├── CustomWikiRAG.py               # Wiki RAG implementation
│   │   ├── servicenowgenaitool.py         # ServiceNow integration
│   │   ├── snowaaonetool.py               # Tool registration
│   │   ├── developer_incident_tools.py    # Developer-specific tools
│   │   ├── prompt_catalog.py              # Configurable prompts
│   │   ├── plan_recipes.py                # Deterministic workflows
│   │   ├── persona_registry.py            # User personas
│   │   └── code_indexer/                  # Code search modules
│   └── tests/                             # Backend tests
│
├── frontend/
│   ├── package.json                  # Node dependencies
│   ├── public/                       # Static assets
│   ├── src/
│   │   ├── App.js                    # Main React component
│   │   ├── components/               # UI components
│   │   └── services/                 # API services
│   └── node_modules/                 # Node packages (auto-created)
│
├── scripts/                          # Utility scripts
├── kafka/                            # Kafka config (optional)
├── keycloak/                         # Keycloak config (optional)
└── docs/                             # Additional documentation
```

### Key Components

#### Backend Architecture

**Main Application:**
- `backend/app.py` - Flask app initialization, blueprint registration, CORS setup

**API Endpoints:**
- `agentic_orchestrator_api.py` - Chat, orchestration, health checks
- `generic_tool_orchestrator.py` - Tool execution, feedback
- `code_indexer/` - Code search APIs

**Orchestration:**
- `langgraph_flow.py` - Multi-step workflow graphs
- `plan_recipes.py` - Predefined workflow recipes
- `persona_registry.py` - User persona definitions

**Tools & Integrations:**
- `servicenowgenaitool.py` - ServiceNow REST API calls
- `CustomWikiRAG.py` - Confluence search with FAISS
- `developer_incident_tools.py` - Advanced analysis tools
- `snowaaonetool.py` - Tool registry and decorators

**Data & Storage:**
- TinyDB (`state_db.json`) - Chat history, feedback, preferences
- FAISS indices - Vector embeddings for RAG
- JSON files - Caching and spooling

#### Frontend Architecture

**Framework:** React 19.0.0 with Material-UI 7.0.2

**Key Files:**
- `src/App.js` - Main application component
- `src/components/` - Reusable UI components
- `src/services/` - API client services

**Communication:**
- REST API calls to backend via Axios
- Socket.IO for real-time updates (if enabled)

### Data Flow

```
User Input (Frontend)
    ↓
HTTP/REST Request to Backend API
    ↓
Agentic Orchestrator (langgraph_flow.py)
    ↓
Intent Classification & Annotation Detection
    ↓
    ├─→ @wiki → CustomWikiRAG → FAISS Search → LLM Synthesis
    ├─→ @code → Code Indexer → FAISS Search → Results
    ├─→ ServiceNow → servicenowgenaitool → REST API Call
    └─→ Generic Tools → Tool Registry → Execution
    ↓
Response Formatting
    ↓
JSON Response to Frontend
    ↓
UI Update (React)
```

### Technology Stack Details

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Backend Framework** | Flask | Latest | Web server & API |
| **LLM Orchestration** | LangChain | ≥0.3.26 | Agent framework |
| **Workflow Engine** | LangGraph | ≥0.5.2 | Graph-based planning |
| **Vector Search** | FAISS | CPU version | Similarity search |
| **LLM Provider** | Azure OpenAI | API 2023-05-15 | GPT-4 inference |
| **Database** | TinyDB | Latest | JSON document store |
| **Frontend Framework** | React | 19.0.0 | UI library |
| **UI Components** | Material-UI | 7.0.2 | Component library |
| **HTTP Client** | Axios | 1.8.4 | API calls |
| **Real-time** | Socket.IO | 4.8.1 | Websockets |
| **Auth (Optional)** | Keycloak | 26.2.0 | SSO/OAuth |
| **Events (Optional)** | Kafka | 2.0.2+ | Event streaming |
| **Testing** | Pytest | Latest | Backend tests |
| **Testing** | Jest | Via react-scripts | Frontend tests |

### Port Mapping

| Service | Port | Protocol | Required | Configurable |
|---------|------|----------|----------|--------------|
| Frontend Dev Server | 3000 | HTTP | Yes | package.json |
| Backend Flask API | 5001 | HTTP | Yes | FLASK_PORT env |
| Keycloak | 8080 | HTTP | Optional | Keycloak config |
| Kafka Broker | 9092 | TCP | Optional | KAFKA_PORT env |
| Zookeeper | 2181 | TCP | Optional | Kafka config |
| Kafka UI (if used) | 8000 | HTTP | Optional | Docker compose |

---

## Troubleshooting

### Common Issues & Solutions

#### 1. Backend Won't Start

**Error:** `ModuleNotFoundError: No module named 'flask'`

**Cause:** Python dependencies not installed

**Solution:**
```powershell
pip install -r requirements.txt

# Or if using virtual environment:
.\.venv\Scripts\activate
pip install -r requirements.txt
```

---

**Error:** `python: command not found` or `'python' is not recognized`

**Cause:** Python not in PATH

**Solution:**
1. Reinstall Python with "Add to PATH" checked
2. Or manually add Python to PATH:
   ```powershell
   $env:Path += ";C:\Users\<YourUser>\AppData\Local\Programs\Python\Python311"
   ```

---

#### 2. Frontend Won't Start

**Error:** `Cannot find module 'react'` or `Module not found: Can't resolve`

**Cause:** Node dependencies not installed

**Solution:**
```powershell
cd frontend
Remove-Item node_modules -Recurse -Force  # Clean install
Remove-Item package-lock.json
npm install
```

---

**Error:** `npm: command not found`

**Cause:** Node.js not installed or not in PATH

**Solution:**
1. Download and install Node.js from https://nodejs.org/
2. Restart PowerShell terminal
3. Verify: `node --version` and `npm --version`

---

#### 3. Port Already in Use

**Error:** `Address already in use: 5001` or `Port 3000 is already in use`

**Cause:** Another process is using the port

**Solution:**
```powershell
# Find process using port 5001
netstat -ano | findstr :5001

# Output shows:
#   TCP    0.0.0.0:5001    0.0.0.0:0    LISTENING    12345
#                                                     ^^^^^ PID

# Kill the process (replace 12345 with actual PID)
taskkill /PID 12345 /F

# For port 3000:
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Alternative:** Change the port in configuration:
```bash
# For backend, add to .env:
FLASK_PORT=5002

# For frontend, create frontend/.env:
PORT=3001
```

---

#### 4. CORS Errors in Browser

**Error:** `Access to fetch at 'http://localhost:5001' blocked by CORS policy`

**Cause:** Backend CORS not allowing frontend origin

**Solution:**
1. Verify `.env` has:
   ```bash
   SNOWCHAT_CORS_ORIGINS=http://localhost:3000,http://localhost:5001
   ```
2. Restart backend:
   ```powershell
   cd backend
   python app.py
   ```
3. Clear browser cache (Ctrl+Shift+Delete)

---

#### 5. Azure OpenAI 404 Errors

**Error:** `404 Resource Not Found` when calling Azure OpenAI

**Cause:** Incorrect deployment name or endpoint

**Solution:**
1. Go to Azure Portal → Your OpenAI resource
2. Navigate to "Model deployments"
3. Copy the **deployment name** (NOT model name)
4. Update `.env`:
   ```bash
   # Use deployment name, not "gpt-4"
   GPT_MODEL_NAME=my-gpt4-deployment
   
   # Use deployment name, not "text-embedding-ada-002"
   EMBEDDING_MODEL_NAME=my-embedding-deployment
   ```
5. Verify endpoint URL format:
   ```bash
   # Correct:
   AZURE_OPENAI_ENDPOINT=https://myresource.openai.azure.com/
   
   # Wrong (no /openai/):
   AZURE_OPENAI_ENDPOINT=https://myresource.openai.azure.com/openai/
   ```

---

#### 6. ServiceNow Connection Errors

**Error:** `401 Unauthorized` or `Connection refused` to ServiceNow

**Cause:** Incorrect credentials or instance URL

**Solution:**
1. Verify instance URL format in `.env`:
   ```bash
   # Correct:
   SERVICENOW_INSTANCE=https://dev12345.service-now.com
   
   # Wrong (no trailing slash):
   SERVICENOW_INSTANCE=https://dev12345.service-now.com/
   ```
2. Test credentials manually:
   ```powershell
   curl -u "username:password" https://dev12345.service-now.com/api/now/table/incident?sysparm_limit=1
   ```
3. Check if account has API access permissions

---

#### 7. FAISS Index/Docs Mismatch

**Error:** Wiki RAG returns no results or generic responses

**Symptom:** Logs show "index_doc_mismatch=true" or different index/docs sizes

**Cause:** FAISS index and document pickle out of sync

**Solution:**
```powershell
# Rebuild the wiki index
cd backend
python components/vectorize_confluence_wiki.py

# Verify the rebuild
# Should show matching numbers for:
# - Total chunks: N
# - FAISS index size: N
```

**Verify fix:**
```powershell
# Check log output for:
# "Total chunks: 82"
# "FAISS index size: 82"
# Numbers should match
```

---

#### 8. Kafka Connection Failed / Won't Start

**Error:** `kafka.errors.NoBrokersAvailable` or Kafka startup fails

**Cause:** Kafka not needed or misconfigured

**Solution:** Use Quick mode (no Kafka):
```powershell
# Skip Kafka entirely - uses file-based fallback
.\start-all.ps1 -Quick -NoKeycloak -Backend
```

Events will be logged to `event_spool.jsonl` instead.

**If you need Kafka:**
1. Verify `KAFKA_HOME` environment variable
2. Check `kafka-start.bat` script
3. Ensure Zookeeper starts before Kafka broker
4. Check port 9092 is not in use

---

#### 9. Logs Not Appearing

**Error:** No log files created or empty logs

**Cause:** Logging not initialized or file permissions

**Solution:**
```powershell
# Check current directory (logs are written here)
Get-Location

# Should be: C:\dev\snowchat

# Verify files exist
Test-Path snowchat_backend.log
Test-Path agentic_orchestrator_auto.log

# If missing, check file permissions
icacls snowchat_backend.log

# Force logging with -Log flag
.\start-all.ps1 -Log -Quick -NoKeycloak -Backend
```

---

#### 10. Environment Variables Not Loaded

**Error:** `KeyError: 'AZURE_OPENAI_ENDPOINT'` or similar

**Cause:** `.env` file not found or not loaded

**Solution:**
```powershell
# Verify .env exists in root directory
Test-Path .\.env

# Should return: True

# Check .env location
Get-ChildItem -Filter .env

# Should show file in current directory (snowchat/)

# Verify file is named EXACTLY ".env" (not ".env.txt")
# Windows may hide extensions - check in File Explorer with extensions visible

# Test loading in Python:
python -c "from dotenv import load_dotenv; load_dotenv(); import os; print(os.getenv('AZURE_OPENAI_ENDPOINT'))"

# Should print your endpoint URL
```

---

#### 11. Virtual Environment Issues

**Error:** `pip` installing to wrong location or global Python

**Cause:** Virtual environment not activated

**Solution:**
```powershell
# Create virtual environment (if not exists)
python -m venv .venv

# Activate (PowerShell)
.\.venv\Scripts\activate

# Activate (Command Prompt)
.venv\Scripts\activate.bat

# Verify activation - prompt should show (.venv)
# Install dependencies
pip install -r requirements.txt

# Deactivate when done
deactivate
```

---

#### 12. React Build Errors

**Error:** `Failed to compile` or `Module build failed`

**Cause:** Incompatible Node version or corrupted modules

**Solution:**
```powershell
# Check Node version (should be 16+)
node --version

# Clean install
cd frontend
Remove-Item node_modules -Recurse -Force
Remove-Item package-lock.json
npm cache clean --force
npm install

# If still failing, update npm
npm install -g npm@latest

# Try with legacy peer deps
npm install --legacy-peer-deps
```

---

### Diagnostic Commands

```powershell
# System information
systeminfo | findstr /B /C:"OS Name" /C:"OS Version"

# Python environment
python --version
pip --version
pip list | findstr langchain
pip list | findstr flask

# Node environment
node --version
npm --version
npm list --depth=0 2>$null | findstr react

# Network ports
netstat -ano | findstr :3000
netstat -ano | findstr :5001
netstat -ano | findstr :9092

# Environment variables
Get-ChildItem Env: | Where-Object { $_.Name -like "*AZURE*" -or $_.Name -like "*SNOW*" }

# File structure
tree /F /A | head -50

# Disk space
Get-PSDrive C

# Process list
Get-Process python, node | Format-Table Id, Name, CPU, WorkingSet

# Check if services are responding
curl http://localhost:3000
curl http://localhost:5001

# Test Azure OpenAI connection
python -c "import openai; print('OpenAI package OK')"

# Test ServiceNow connection (with credentials from .env)
# Replace with your actual credentials
curl -u "username:password" https://yourinstance.service-now.com/api/now/table/incident?sysparm_limit=1
```

---

### Getting Debug Information

When asking for help, provide:

```powershell
# 1. Version information
python --version > debug-info.txt
node --version >> debug-info.txt
pip list >> debug-info.txt

# 2. Last 50 lines of logs
Get-Content .\snowchat_backend.log -Tail 50 >> debug-info.txt
Get-Content .\agentic_orchestrator_auto.log -Tail 50 >> debug-info.txt

# 3. Environment check
Get-ChildItem Env: | Where-Object { $_.Name -like "*AZURE*" -or $_.Name -like "*SNOW*" } >> debug-info.txt

# 4. Port status
netstat -ano | findstr ":3000 :5001" >> debug-info.txt

# 5. Process status
Get-Process python, node 2>$null >> debug-info.txt

# 6. Browser console errors (screenshot or copy/paste)
# Press F12 → Console tab → Right-click → Save As...
```

---

## Command Reference

### Quick Commands

```powershell
# Daily startup
.\start-all.ps1 -Quick -NoKeycloak -Backend

# View logs
Get-Content .\snowchat_backend.log -Wait -Tail 50

# Restart backend
cd backend; python app.py

# Restart frontend
cd frontend; npm start

# Run tests
cd backend; pytest

# Rebuild wiki index
cd backend; python components/vectorize_confluence_wiki.py

# Clear database
Remove-Item state_db.json

# Check ports
netstat -ano | findstr ":3000 :5001"

# Kill process on port
taskkill /PID <PID> /F
```

### PowerShell Aliases (Optional)

Add to your PowerShell profile for shortcuts:

```powershell
# Edit profile
notepad $PROFILE

# Add these aliases:
function snow-start { Set-Location C:\dev\snowchat; .\start-all.ps1 -Quick -NoKeycloak -Backend }
function snow-logs { Get-Content C:\dev\snowchat\snowchat_backend.log -Wait -Tail 50 }
function snow-test { Set-Location C:\dev\snowchat\backend; pytest }
function snow-clean { Remove-Item C:\dev\snowchat\state_db.json -ErrorAction SilentlyContinue }

# Save and reload
. $PROFILE

# Now use:
snow-start
snow-logs
snow-test
snow-clean
```

---

## Support & Resources

### Documentation

- **This Guide:** `COMPLETE_SETUP_GUIDE.md` - Complete setup instructions
- **Project README:** `README.md` - Full project overview (604 lines)
- **Architecture:** `.github/copilot-instructions.md` - Development guidelines
- **Annotations:** `annotation_commands.json` - Available workflow commands
- **API Reference:** Backend code comments and docstrings

### Log Files

- `snowchat_backend.log` - Main application log (all backend activity)
- `agentic_orchestrator_auto.log` - Orchestration and planning log
- `frontend-install.log` - Frontend npm installation log (if generated)
- `event_spool.jsonl` - Event log (when Kafka not running)

### Configuration Files

- `.env` - Environment variables (YOU CREATE THIS)
- `requirements.txt` - Python dependencies
- `frontend/package.json` - Node dependencies
- `annotation_commands.json` - Workflow annotations
- `backend/components/prompt_catalog.json` - Configurable prompts

### Useful URLs

| Resource | URL |
|----------|-----|
| Frontend UI | http://localhost:3000 |
| Backend API | http://localhost:5001 |
| Keycloak Admin | http://localhost:8080/admin |
| Python Docs | https://docs.python.org/3/ |
| Flask Docs | https://flask.palletsprojects.com/ |
| React Docs | https://react.dev/ |
| LangChain Docs | https://python.langchain.com/ |
| LangGraph Docs | https://langchain-ai.github.io/langgraph/ |
| Material-UI Docs | https://mui.com/ |
| Azure OpenAI | https://portal.azure.com/ |

### Team Contacts

**Fill in your team information:**

- **Team Lead:** ____________________
- **Slack/Teams Channel:** ____________________
- **Email:** ____________________
- **Office Hours:** ____________________
- **On-Call/Emergency:** ____________________

### External Support

- **Azure OpenAI Issues:** Azure support portal
- **ServiceNow Issues:** ServiceNow admin team
- **GitHub/Code Issues:** Repository issues tab
- **Keycloak Issues:** Keycloak documentation

---

## Appendices

### Appendix A: Complete Dependency List

#### Python Dependencies (Backend)
```
flask                           # Web framework
flask-cors                      # CORS handling
tinydb                          # JSON database
openai                          # OpenAI/Azure API client
langchain>=0.3.26              # LLM orchestration
langchain-openai>=0.1.0        # OpenAI integration
langchain-community>=0.0.20    # Community tools
faiss-cpu                       # Vector search
numpy                           # Numerical operations
python-dotenv                   # Environment variable loading
requests                        # HTTP client
langgraph>=0.5.2               # Workflow graphs
langgraph-checkpoint-sqlite>=3.0.0  # State persistence
debugpy                         # Debugging
python-docx                     # Word document parsing
pandas                          # Data manipulation
openpyxl                        # Excel parsing
python-pptx                     # PowerPoint parsing
scikit-learn                    # ML utilities
langsmith                       # LangChain tracing
prance[osv]>=23.6.21.0         # OpenAPI validation
openapi-spec-validator>=0.7.1  # API spec validation
PyYAML>=6.0.1                  # YAML parsing
jq>=1.6.0                      # JSON processing
sqlalchemy>=2.0.0              # Database ORM
pytest                          # Testing framework
crewai>=0.64.0                 # Agent framework
PyJWT[crypto]>=2.9.0           # JWT handling
pydantic>=2.7.0                # Data validation
kafka-python>=2.0.2            # Kafka client
elasticsearch>=9.0.0,<10.0.0   # Elasticsearch client
psycopg2-binary>=2.9.9         # PostgreSQL driver
pgvector>=0.2.4                # Vector DB extension
PyPDF2>=3.0.0                  # PDF parsing
```

#### Node Dependencies (Frontend)
```json
{
  "@emotion/react": "^11.14.0",
  "@emotion/styled": "^11.14.0",
  "@mui/icons-material": "^7.0.2",
  "@mui/material": "^7.0.2",
  "@mui/x-date-pickers": "^7.28.3",
  "@testing-library/dom": "^10.4.0",
  "@testing-library/jest-dom": "^6.6.3",
  "@testing-library/react": "^16.2.0",
  "@testing-library/user-event": "^13.5.0",
  "axios": "^1.8.4",
  "body-parser": "^1.20.3",
  "concurrently": "^9.1.2",
  "cors": "^2.8.5",
  "dayjs": "^1.11.13",
  "express": "^4.21.2",
  "keycloak-js": "^26.2.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "react-scripts": "5.0.1",
  "socket.io": "^4.8.1",
  "socket.io-client": "^4.8.1",
  "web-vitals": "^2.1.4"
}
```

### Appendix B: Environment Variable Reference

See [Configuration](#configuration) section for complete `.env` template.

### Appendix C: Startup Script Options

#### start-all.ps1 Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-Debug` | Switch | false | Enable verbose diagnostic output |
| `-Backend` | Switch | false | Auto-start backend Flask server |
| `-NoKafka` | Switch | false | Skip Kafka (use file spooling) |
| `-Quick` | Switch | false | Alias for `-NoKafka` |
| `-Log` | Switch | false | Write combined log to `snowchat_backend.log` |
| `-NoFrontend` | Switch | false | Skip React dev server |
| `-NoKeycloak` | Switch | false | Skip Keycloak authentication server |

#### Examples

```powershell
# Full stack
.\start-all.ps1 -Backend

# Development (most common)
.\start-all.ps1 -Quick -NoKeycloak -Backend

# Debug mode with logging
.\start-all.ps1 -Debug -Log -Quick -NoKeycloak -Backend

# Backend only
.\start-all.ps1 -Backend -NoFrontend -NoKafka -NoKeycloak

# Frontend only (start backend manually)
.\start-all.ps1 -NoKafka -NoKeycloak
```

### Appendix D: File Paths Reference

All paths relative to project root (`C:\dev\snowchat\`):

| File/Directory | Purpose | Created By |
|----------------|---------|------------|
| `.env` | Environment variables | **YOU (manual)** |
| `.venv/` | Python virtual environment | `python -m venv` |
| `state_db.json` | TinyDB database | Backend (auto) |
| `embedding_cache.json` | OpenAI API cache | Backend (auto) |
| `Embeddings_Lookup_cache.index` | FAISS wiki index | Vectorization script |
| `faiss_docs.pkl` | FAISS doc metadata | Vectorization script |
| `code_embeddings.index` | Code search index | Code indexer |
| `snowchat_backend.log` | Main app log | Backend (auto) |
| `agentic_orchestrator_auto.log` | Orchestration log | Backend (auto) |
| `event_spool.jsonl` | Event spool | Backend (Kafka fallback) |
| `conversation_memory.json` | Context memory | Backend (auto) |
| `backend/` | Python backend code | Git |
| `frontend/` | React frontend code | Git |
| `frontend/node_modules/` | Node packages | npm install |
| `requirements.txt` | Python deps | Git |
| `start-all.ps1` | Startup script | Git |

---

## Quick Reference Card

**Print this page for your desk:**

```
╔════════════════════════════════════════════════════════════════╗
║                   SNOWCHAT QUICK REFERENCE                     ║
╠════════════════════════════════════════════════════════════════╣
║ START                                                          ║
║   .\start-all.ps1 -Quick -NoKeycloak -Backend                 ║
║                                                                ║
║ URLS                                                           ║
║   Frontend: http://localhost:3000                             ║
║   Backend:  http://localhost:5001                             ║
║                                                                ║
║ LOGS                                                           ║
║   Get-Content .\snowchat_backend.log -Wait -Tail 50           ║
║   Get-Content .\agentic_orchestrator_auto.log -Wait -Tail 50  ║
║                                                                ║
║ RESTART                                                        ║
║   Backend:  cd backend; python app.py                         ║
║   Frontend: cd frontend; npm start                            ║
║                                                                ║
║ TESTS                                                          ║
║   cd backend; pytest                                           ║
║                                                                ║
║ CLEAN                                                          ║
║   Remove-Item state_db.json                                    ║
║                                                                ║
║ ANNOTATIONS                                                    ║
║   @wiki <query>     - Confluence search                       ║
║   @code <query>     - Code search                             ║
║   @checkpref        - Use preferences                         ║
║   INC#####          - ServiceNow incident                     ║
║                                                                ║
║ PORTS                                                          ║
║   3000 - Frontend   5001 - Backend                            ║
║   8080 - Keycloak   9092 - Kafka                              ║
║                                                                ║
║ FILES                                                          ║
║   .env - Configure this first!                                ║
║   state_db.json - Database                                     ║
║   *_backend.log - Logs                                         ║
╚════════════════════════════════════════════════════════════════╝
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-27 | Initial comprehensive guide created |

---

## Feedback & Improvements

Found an issue with this guide? Have suggestions?

1. Create an issue in the repository
2. Tag with `documentation`
3. Describe the problem or suggestion
4. Submit PR with corrections

---

**End of Complete Setup Guide**

*This guide consolidates all setup information for the SnowChat project. Keep it updated as the project evolves.*

---

**Happy SnowChatting! 🚀**
