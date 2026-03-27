# SnowChat - Team Setup Guide

**Last Updated:** March 27, 2026

## Overview
SnowChat is an enterprise-grade agentic AI platform for incident management, knowledge retrieval, and intelligent automation. This guide will help you set up and run the application on your local Windows development machine.

---

## Prerequisites

### Required Software
1. **Python 3.8+**
   - Download: https://www.python.org/downloads/
   - During installation, check "Add Python to PATH"
   - Verify: `python --version`

2. **Node.js 16+ and npm**
   - Download: https://nodejs.org/ (LTS version recommended)
   - Verify: `node --version` and `npm --version`

3. **Git** (for cloning the repository)
   - Download: https://git-scm.com/downloads

### Optional Components
4. **Apache Kafka** (optional - for event streaming)
   - Can run without Kafka (uses file-based spooling as fallback)
   - If needed, extract to `C:\dev\kafka` or set `KAFKA_HOME` environment variable

5. **Keycloak** (optional - for authentication)
   - Can be skipped for development
   - If needed, set `KEYCLOAK_HOME` environment variable

6. **Docker Desktop** (alternative for Kafka)
   - Download: https://www.docker.com/products/docker-desktop/
   - Only needed if using Docker-based Kafka instead of native

---

## Project Structure
```
snowchat/
├── backend/              # Python/Flask backend
│   ├── app.py           # Main Flask application
│   ├── components/      # Agentic orchestration, tools, RAG
│   └── requirements.txt # Python dependencies
├── frontend/            # React frontend
│   ├── src/            # React components
│   └── package.json    # Node dependencies
├── start-all.ps1       # PowerShell startup script (RECOMMENDED)
├── start-all.bat       # Batch startup script
├── requirements.txt    # Backend Python dependencies
└── state_db.json       # TinyDB database (auto-created)
```

---

## Initial Setup

### 1. Clone the Repository
```powershell
cd C:\dev
git clone <your-repo-url> snowchat
cd snowchat
```

### 2. Configure Environment Variables

Create a `.env` file in the root `snowchat/` directory with the following required variables:

```bash
# ========== Azure OpenAI Configuration ==========
AZURE_OPENAI_ENDPOINT=https://your-instance.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key-here
OPENAI_API_VERSION=
GPT_MODEL_NAME=gpt-4
EMBEDDING_MODEL_NAME=text-embedding-ada-002

# ========== ServiceNow Configuration ==========
SERVICENOW_INSTANCE=https://your-instance.service-now.com
SERVICENOW_USERNAME=your-username
SERVICENOW_PASSWORD=your-password
# OR use token:
# SERVICENOW_TOKEN=your-token

# ========== GitHub Integration (Optional) ==========
GITHUB_REPO=your-org/your-repo
GITHUB_TOKEN=ghp_your_token_here

# ========== Keycloak Auth (Optional) ==========
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=snowchat
KEYCLOAK_CLIENT_ID=snowchat-client

# ========== CORS Configuration ==========
SNOWCHAT_CORS_ORIGINS=http://localhost:3000,http://localhost:5001

# ========== Optional Settings ==========
# Enable diagnostic logging
# SNOWCHAT_DIAG=1

# Planner mode: function_call, disabled, or auto
# PLANNER_MODE=function_call

# Kafka topic (if using Kafka)
# KAFKA_RAW_TOPIC=crew-raw-events

# Backend port (default: 5001)
# FLASK_PORT=5001
```

**Important Notes:**
- Replace `your-instance`, `your-api-key-here`, etc. with your actual credentials
- You can get Azure OpenAI credentials from your Azure portal
- ServiceNow credentials should be from a service account with appropriate permissions
- GitHub token needs `repo` scope for code indexing features

### 3. Install Backend Dependencies
```powershell
# Option A: Using virtual environment (RECOMMENDED)
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r ..\requirements.txt

# Option B: Global installation (not recommended)
pip install -r requirements.txt
```

### 4. Install Frontend Dependencies
```powershell
cd frontend
npm install
```

---

## Running the Application

### Quick Start (Recommended)
Use the automated startup script that handles all components:

```powershell
# Run all components (Kafka + Keycloak + Backend + Frontend)
.\start-all.ps1

# Run without Kafka (uses file-based event spooling)
.\start-all.ps1 -Quick

# Run without Kafka and Keycloak
.\start-all.ps1 -Quick -NoKeycloak

# Auto-start backend + skip Kafka
.\start-all.ps1 -Backend -NoKafka

# Run with debug logging
.\start-all.ps1 -Debug -Log

# Skip frontend (backend only)
.\start-all.ps1 -Backend -NoFrontend -NoKafka -NoKeycloak
```

**What the script does:**
1. ✅ Checks for Python and Node.js
2. ✅ Optionally starts Kafka (native or Docker)
3. ✅ Optionally starts Keycloak
4. ✅ Starts React dev server (port 3000)
5. ✅ Optionally auto-starts Flask backend (port 5001)
6. ✅ Shows summary of what was started

### Manual Start (Alternative)

If you prefer to start components individually:

#### Start Backend
```powershell
# In terminal 1
cd backend
python app.py
```
Backend will be available at: http://localhost:5001

#### Start Frontend
```powershell
# In terminal 2
cd frontend
npm start
```
Frontend will be available at: http://localhost:3000

#### Start Kafka (Optional)
```powershell
# In terminal 3
.\kafka-start.bat
```

#### Start Keycloak (Optional)
```powershell
# In terminal 4
.\keycloak-start.bat
```

---

## Accessing the Application

Once started, you can access:

- **Frontend UI:** http://localhost:3000
- **Backend API:** http://localhost:5001
- **API Health Check:** http://localhost:5001/health (if endpoint exists)
- **Keycloak Admin:** http://localhost:8080/admin (if running)

---

## Key Features & Capabilities

### Annotation-Based Workflows
SnowChat uses special annotations to trigger specific workflows:

- `@wiki` - Triggers Confluence/Wiki RAG search
- `@code` - Triggers code search using FAISS embeddings
- `@checkpref` - Uses stored user preferences for function sequences

Example query:
```
@wiki How do I reset a user password?
```

### Available Tools
- **ServiceNow Integration:** Incident lookup, assignment group prediction, similar incident search
- **Wiki RAG:** Confluence knowledge base search with semantic similarity
- **Code Search:** GitHub code indexing and semantic code search
- **Splunk Integration:** Log query and analysis
- **LangGraph Orchestration:** Multi-step agentic planning and execution

---

## Troubleshooting

### Common Issues

#### 1. Backend won't start
**Error:** `ModuleNotFoundError: No module named 'flask'`
**Solution:** 
```powershell
pip install -r requirements.txt
```

#### 2. Frontend won't start
**Error:** `Cannot find module 'react'`
**Solution:**
```powershell
cd frontend
npm install
```

#### 3. Port already in use
**Error:** `Address already in use: 5001` or `3000`
**Solution:** 
- Kill the process using that port
- Or change the port in `.env` (backend) or `package.json` (frontend)

```powershell
# Find process on port 5001
netstat -ano | findstr :5001

# Kill process (replace PID with actual process ID)
taskkill /PID <PID> /F
```

#### 4. CORS errors in browser
**Error:** `Access to fetch blocked by CORS policy`
**Solution:** Make sure `SNOWCHAT_CORS_ORIGINS` in `.env` includes `http://localhost:3000`

#### 5. Azure OpenAI 404 errors
**Error:** `404 Not Found` when calling Azure OpenAI
**Solution:** 
- Verify `AZURE_OPENAI_ENDPOINT` is correct
- Verify `GPT_MODEL_NAME` matches your Azure deployment name (not the model name)
- Check `OPENAI_API_VERSION` is supported by your deployment

#### 6. FAISS Index/Docs Mismatch
**Error:** RAG queries return no results or generic responses
**Solution:** Rebuild the FAISS index:
```powershell
cd backend
python components/vectorize_confluence_wiki.py
```

#### 7. Kafka connection failed
**Issue:** Kafka not starting or connection refused
**Solution:** Run in Quick mode (no Kafka):
```powershell
.\start-all.ps1 -Quick
```
The system will automatically fall back to file-based event spooling in `event_spool.jsonl`

---

## Development Tips

### Logging
All backend activity is logged to:
- `snowchat_backend.log` - Main application log
- `agentic_orchestrator_auto.log` - Orchestration and planning log

View logs in real-time:
```powershell
Get-Content .\snowchat_backend.log -Wait -Tail 50
```

### Database
The application uses TinyDB (JSON file database):
- `state_db.json` - Stores chat history, feedback, user preferences

To reset the database, simply delete the file:
```powershell
Remove-Item state_db.json
```

### Environment Debug Mode
Enable verbose diagnostic output:
```powershell
$env:SNOWCHAT_DIAG = "1"
python backend/app.py
```

### Hot Reload
- **Frontend:** React dev server supports hot reload automatically
- **Backend:** Restart required for code changes (Flask auto-reload may work in debug mode)

---

## Testing

### Backend Tests
```powershell
cd backend
pytest -q
```

### Run with Coverage
```powershell
pytest --cov=components --cov-report=html
```

---

## Architecture Notes

### Tech Stack
- **Backend:** Python 3.8+, Flask, LangChain, LangGraph, FAISS
- **Frontend:** React 19, Material UI, Socket.IO
- **Database:** TinyDB (file-based JSON)
- **Vector Store:** FAISS
- **LLM:** Azure OpenAI (GPT-4)
- **Auth:** Keycloak (optional)
- **Events:** Kafka (optional, falls back to file spooling)

### Key Directories
- `backend/components/` - All orchestration logic, tools, and integrations
- `backend/components/agentic_orchestrator_api.py` - Main API endpoints
- `backend/components/langgraph_flow.py` - LangGraph workflow engine
- `frontend/src/` - React components and UI

### Data Flow
```
User Query → Frontend (React) → Backend API → Agentic Orchestrator (LangGraph) 
→ Intent Classification → Tool Selection → Execution → Response Formatting → Frontend
```

---

## Ports Reference

| Service    | Default Port | Configurable Via       |
|------------|-------------|------------------------|
| Backend    | 5001        | Flask default          |
| Frontend   | 3000        | React default          |
| Keycloak   | 8080        | Keycloak config        |
| Kafka      | 9092        | `KAFKA_PORT` env var   |
| Zookeeper  | 2181        | Kafka config           |

---

## Quick Command Reference

```powershell
# Full stack startup (everything)
.\start-all.ps1

# Development mode (no Kafka/Keycloak)
.\start-all.ps1 -Quick -NoKeycloak

# Backend only (for API development)
.\start-all.ps1 -Backend -NoFrontend -NoKafka -NoKeycloak

# Frontend only (for UI development)
cd frontend
npm start

# View backend logs
Get-Content .\snowchat_backend.log -Wait -Tail 50

# Run tests
cd backend
pytest -q

# Rebuild FAISS index
cd backend
python components/vectorize_confluence_wiki.py

# Check Python environment
python --version
pip list

# Check Node environment
node --version
npm --version
```

---

## Getting Help

### Documentation Files
- `README.md` - Full project documentation (604 lines)
- `AGENTIC_AI_PROJECT_INTENTION.md` - Project vision
- `.github/copilot-instructions.md` - Development guidelines
- `annotation_commands.json` - Available annotation commands

### Logs to Check
1. `snowchat_backend.log` - All backend operations
2. `agentic_orchestrator_auto.log` - Orchestration flows
3. `frontend-install.log` - Frontend dependency installation
4. Browser Console - Frontend errors and React warnings

### Common Commands for Diagnosis
```powershell
# Check if backend is running
curl http://localhost:5001/

# Check if frontend is running
curl http://localhost:3000/

# List all Python packages
pip list

# List all npm packages
npm list --depth=0

# Check environment variables
Get-ChildItem Env: | Where-Object { $_.Name -like "*SNOW*" -or $_.Name -like "*AZURE*" }
```

---

## Next Steps

After successful setup:

1. **Verify Environment Variables** - Ensure all required credentials are set
2. **Test Basic Functionality** - Try a simple chat query
3. **Test Annotations** - Try `@wiki test query` to verify RAG
4. **Review Logs** - Check log files for any warnings or errors
5. **Explore Features** - Reference the main README.md for full feature list
6. **Set Up Code Indexing** - If using code search, index your GitHub repositories

---

## Support & Contact

For issues or questions:
- Check logs: `snowchat_backend.log` and `agentic_orchestrator_auto.log`
- Review this guide's Troubleshooting section
- Consult the main `README.md` for detailed feature documentation
- Contact the development team

---

**Happy SnowChatting! 🚀**
