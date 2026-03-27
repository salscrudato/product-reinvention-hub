# Git Commit Guidelines - SnowChat

## ✅ Safe to Commit

### Source Code
- `backend/**/*.py` - All Python source files
- `frontend/src/**` - All React source files
- `frontend/public/**` - Static assets
- `scripts/**/*.py` - Utility scripts
- `kafka_scripts/**` - Kafka utilities

### Configuration Files
- `requirements.txt` - Python dependencies
- `frontend/package.json` - Node dependencies
- `annotation_commands.json` - Workflow configs
- `faiss_index_manifest.json` - Index config
- `pyrightconfig.json` - Python type checker config
- `.env.example` - Environment template (NO SECRETS!)
- `.gitignore` - Git ignore rules
- `*.profile.json` - DevPilot profiles

### Documentation
- `README.md`
- `COMPLETE_SETUP_GUIDE.md`
- `AZURE_DEVOPS_MIGRATION_GUIDE.md`
- `TEAM_SETUP_GUIDE.md`
- `QUICK_START.md`
- All other `.md` files
- `docs/**` - Documentation folder

### Scripts & Automation
- `*.ps1` - PowerShell scripts
- `*.bat` - Batch scripts
- `start-all.ps1`, `migrate-to-azure-devops.ps1`, etc.

### Project Structure
- `.github/**` - GitHub Actions/templates
- `.vscode/**` (except settings.json with personal config)
- `config/**` - Configuration templates
- `kafka/**` (if config only)
- `keycloak/**` (if config only)

---

## ❌ NEVER Commit

### Secrets & Credentials
- ❌ `.env` - Contains API keys and passwords!
- ❌ Any file with actual API keys, tokens, passwords
- ❌ ServiceNow credentials
- ❌ Azure OpenAI keys
- ❌ GitHub tokens

### Runtime Data & Databases
- ❌ `state_db.json` (4.2 MB) - TinyDB database
- ❌ `conversation_memory.json` - Runtime state
- ❌ `event_spool.jsonl` - Event logs
- ❌ Any `.db`, `.sqlite` files

### Logs
- ❌ `*.log` - All log files
- ❌ `snowchat_backend.log`
- ❌ `agentic_orchestrator_auto.log`
- ❌ `agentic_orchestrator.log`
- ❌ `provisioning.log`

### Generated/Cached Files
- ❌ `embedding_cache.json` (1 MB)
- ❌ `code_embeddings.json` (3.9 MB)
- ❌ `*.index` - FAISS indices
- ❌ `*.pkl` - Pickle files (FAISS docs)
- ❌ `Embeddings_Lookup_cache.index`
- ❌ `code_embeddings.index`
- ❌ `faiss_docs.pkl`

### Dependencies (installed by package managers)
- ❌ `node_modules/` - Installed by npm
- ❌ `__pycache__/` - Python cache
- ❌ `.pytest_cache/` - Pytest cache
- ❌ `build/`, `dist/` - Build outputs
- ❌ `.venv/`, `venv/` - Virtual environments

### IDE & OS Files
- ❌ `.vscode/settings.json` (personal settings)
- ❌ `.DS_Store` (macOS)
- ❌ `Thumbs.db` (Windows)
- ❌ `*.swp`, `*~` (editor temp files)

---

## 📋 Pre-Commit Checklist

Before committing, verify:

```powershell
# 1. Check what's staged
git status

# 2. Look for these RED FLAGS:
#    - .env (STOP! Never commit!)
#    - *.log files
#    - state_db.json
#    - *_cache.json
#    - *.index files
#    - node_modules/

# 3. If you see any red flags:
git reset                    # Unstage everything
# Update .gitignore, then:
git add .
git status                   # Verify again
```

---

## 🔍 Quick Verification Commands

```powershell
# See what Git will track (without committing)
git add -n .

# Check if .env exists (should NOT be committed)
git ls-files | Select-String "\.env$"
# ^ Should return NOTHING

# Check for log files (should NOT be committed)
git ls-files | Select-String "\.log$"
# ^ Should return NOTHING

# Check for large files
git ls-files | ForEach-Object { 
    if (Test-Path $_) {
        $size = (Get-Item $_).Length / 1MB
        if ($size -gt 1) { "$_ : $([math]::Round($size, 2)) MB" }
    }
}
# ^ Should return NOTHING or only essential large files

# View what's currently ignored
git status --ignored
```

---

## 🎯 Recommended First Commit

```powershell
# After verifying everything looks good:

git add .
git commit -m "Initial commit - SnowChat Enterprise AI Platform

Includes:
- Backend Python/Flask application with agentic orchestration
- Frontend React application with Material-UI
- LangGraph workflow engine and RAG integration
- ServiceNow, Confluence, and GitHub integrations
- Comprehensive setup and migration documentation
- Deployment scripts and automation tools
- Configuration templates and examples

Excludes:
- Runtime databases and logs
- Generated embeddings and indices
- Secrets and credentials
- Node/Python dependencies (installed via package managers)"
```

---

## 🆘 If You Accidentally Committed Secrets

**CRITICAL: If you committed .env or secrets:**

```powershell
# If you haven't pushed yet:
git reset --soft HEAD~1    # Undo commit, keep changes
rm .env                     # Remove .env from staging
git add .                   # Re-add files
git commit -m "Your message"

# If you already pushed:
# 1. IMMEDIATELY rotate all secrets (change passwords, regenerate keys)
# 2. Contact your security team
# 3. Use git-filter-branch or BFG Repo-Cleaner to remove from history
# 4. Force push (if allowed)
```

---

## 📊 File Size Guidelines

- **< 100 KB:** Totally fine to commit
- **100 KB - 1 MB:** OK if it's source code or essential config
- **1 MB - 10 MB:** Consider if it's necessary, use Git LFS if needed
- **> 10 MB:** Should NOT be committed (use Git LFS or external storage)

Current large files in your repo:
- `state_db.json` - 4.2 MB ❌ (database)
- `code_embeddings.json` - 3.9 MB ❌ (generated)
- `embedding_cache.json` - 1 MB ❌ (cache)

All are correctly excluded by `.gitignore` ✅

---

## ✅ Your .gitignore is Already Configured

The `.gitignore` I created covers all these cases. You're safe to run:

```powershell
git add .
git status
# Review the list
git commit -m "Initial commit - SnowChat Enterprise AI Platform"
```

---

**Remember: When in doubt, DON'T commit it!**

Files can always be added later, but removing secrets from Git history is painful.
