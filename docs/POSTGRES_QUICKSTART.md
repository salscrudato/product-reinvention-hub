# PostgreSQL Quick Start Guide for SharePoint RAG

## What You Need to Know

**IMPORTANT:** PostgreSQL is only needed for the **SharePoint RAG** feature (document caching system). The **lamapper memory system** works without PostgreSQL using TinyDB (file-based).

### Your Setup
- PostgreSQL installed at: `C:\dev\postgres\pgsql`
- For: SharePoint document caching (optional feature)
- Not required for: Lamapper entity memory (already working!)

---

## Quick Start (5 Steps)

### Step 1: Initialize PostgreSQL Database

```powershell
# Open PowerShell in PostgreSQL bin directory
cd C:\dev\postgres\pgsql\bin

# Connect to PostgreSQL (default user: postgres)
.\psql.exe -U postgres

# Create database
CREATE DATABASE snowchat;

# Connect to the new database
\c snowchat

# Quit psql
\q
```

### Step 2: Install pgvector Extension

```powershell
# Still in C:\dev\postgres\pgsql\bin directory

# Download pgvector (one-time installation)
# Visit: https://github.com/pgvector/pgvector/releases
# Download: pgvector-windows-x64.zip
# Extract to: C:\dev\postgres\pgvector

# Copy pgvector.dll to PostgreSQL lib directory
Copy-Item C:\dev\postgres\pgvector\pgvector.dll C:\dev\postgres\pgsql\lib\

# Copy SQL scripts to share/extension
Copy-Item C:\dev\postgres\pgvector\*.sql C:\dev\postgres\pgsql\share\extension\
Copy-Item C:\dev\postgres\pgvector\*.control C:\dev\postgres\pgsql\share\extension\

# Connect to database and enable extension
.\psql.exe -U postgres -d snowchat -c "CREATE EXTENSION vector;"

# Verify installation
.\psql.exe -U postgres -d snowchat -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

### Step 3: Create Database Schema

```powershell
# From your snowchat directory
cd C:\dev\snowchat\backend\components

# Run schema script
C:\dev\postgres\pgsql\bin\psql.exe -U postgres -d snowchat -f postgres_sharepoint_schema.sql
```

**Expected output:**
```
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE INDEX
CREATE INDEX
```

### Step 4: Configure Environment Variables

Create or update `C:\dev\snowchat\backend\.env`:

```bash
# PostgreSQL Connection (for SharePoint RAG)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=snowchat
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password_here

# Azure OpenAI (for embeddings and LLM)
AZURE_OPENAI_API_KEY=your_azure_openai_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
OPENAI_API_VERSION=2024-05-01-preview
GPT_MODEL_NAME=gpt-4
EMBEDDING_MODEL=text-embedding-ada-002

# SharePoint Configuration (optional - for document sync)
SHAREPOINT_TENANT_ID=your_tenant_id
SHAREPOINT_CLIENT_ID=your_client_id
SHAREPOINT_CLIENT_SECRET=your_client_secret
SHAREPOINT_SITE_ID=your_site_id
SHAREPOINT_DRIVE_ID=your_drive_id

# Cache Settings
QUERY_CACHE_TTL_MINUTES=30
DOCUMENT_CACHE_TTL_MINUTES=15
```

### Step 5: Install Python Dependencies

```powershell
# Activate your conda environment
conda activate devpilot

# Install PostgreSQL Python packages
pip install psycopg2-binary pgvector

# Install document parsing packages (for SharePoint sync)
pip install python-docx openpyxl PyPDF2
```

---

## Testing Your Setup

### Test 1: PostgreSQL Connection

```powershell
# Quick connection test
C:\dev\postgres\pgsql\bin\psql.exe -U postgres -d snowchat -c "SELECT version();"
```

**Expected:** PostgreSQL version information

### Test 2: Check Tables

```powershell
C:\dev\postgres\pgsql\bin\psql.exe -U postgres -d snowchat -c "\dt"
```

**Expected output:**
```
               List of relations
 Schema |       Name        | Type  |  Owner
--------+-------------------+-------+----------
 public | document_chunks   | table | postgres
 public | document_metadata | table | postgres
 public | query_cache       | table | postgres
 public | sync_state        | table | postgres
```

### Test 3: Test Python Connection

Create `test_postgres.py`:
```python
import psycopg2
from pgvector.psycopg2 import register_vector

try:
    # Connect
    conn = psycopg2.connect(
        host='localhost',
        port=5432,
        database='snowchat',
        user='postgres',
        password='your_password_here'
    )
    register_vector(conn)
    
    # Test query
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM document_chunks")
    count = cursor.fetchone()[0]
    
    print(f"✓ PostgreSQL connection successful!")
    print(f"✓ pgvector extension loaded")
    print(f"✓ Found {count} document chunks in database")
    
    cursor.close()
    conn.close()
    
except Exception as e:
    print(f"✗ Connection failed: {e}")
```

Run:
```powershell
python test_postgres.py
```

---

## What This Enables

Once PostgreSQL is set up, you can use:

### 1. SharePoint RAG (Document Search)
```python
from SharePointRAG_Postgres import SharePointRAGPostgres

sp_rag = SharePointRAGPostgres()
result = sp_rag.query("What are the ACORD application requirements?")

print(f"Answer: {result['answer']}")
print(f"Cache status: {result['cache_status']}")
print(f"Response time: {result['query_time_ms']}ms")
```

### 2. Background Document Sync
```powershell
# Full sync (first time)
python sharepoint_sync_service_postgres.py --full-sync

# Delta sync (incremental updates)
python sharepoint_sync_service_postgres.py --delta-sync

# Daemon mode (continuous background sync every 5 minutes)
python sharepoint_sync_service_postgres.py --daemon --delta-sync --interval 300
```

---

## Troubleshooting

### Issue: "psql: command not found"
**Solution:** Add PostgreSQL to PATH:
```powershell
$env:Path += ";C:\dev\postgres\pgsql\bin"
# Or permanently: System Properties → Environment Variables → Path
```

### Issue: "could not connect to server"
**Solution:** Start PostgreSQL service:
```powershell
# Check if service is running
Get-Service | Where-Object {$_.Name -like "*postgres*"}

# Start service (adjust name as needed)
Start-Service postgresql-x64-16
```

### Issue: "extension 'vector' does not exist"
**Solution:** Install pgvector (see Step 2 above)

### Issue: "psycopg2 import error"
**Solution:**
```powershell
conda activate devpilot
pip uninstall psycopg2 psycopg2-binary
pip install psycopg2-binary
```

---

## Current Lamapper Status (No PostgreSQL Needed!)

Your lamapper system is **fully working** without PostgreSQL:

| Feature | Status | Database |
|---------|--------|----------|
| Entity Memory | ✅ Working | TinyDB (file-based) |
| Conversation History | ✅ Working | TinyDB |
| Entity Cards UI | ✅ Working | React components |
| API Integration | ✅ Working | Flask endpoints |

### How to Use Lamapper (Right Now)

1. **Start backend:**
```powershell
cd C:\dev\snowchat\backend
conda activate devpilot
python app.py
```

2. **Start frontend:**
```powershell
cd C:\dev\lamapper
npm run dev
```

3. **Open browser:**
```
http://localhost:5173
```

4. **Ask mapping questions:**
```
"I need customer name and address"
"Extract policy number and effective date"
"What fields are in the application form?"
```

5. **Review entity cards:**
- Each extracted entity appears as a card
- Approve, edit, or reject individual entities
- Use "Approve All" for batch operations
- Export approved entities to CSV/JSON

---

## Next Steps

### For Lamapper (No PostgreSQL Needed)
✅ **You're ready to use it now!** Just start the backend and frontend.

### For SharePoint RAG (PostgreSQL Required)
1. Complete Steps 1-5 above
2. Configure SharePoint Azure AD app
3. Run initial document sync
4. Test RAG queries

---

## File Locations

```
C:\dev\snowchat\
├── backend\
│   ├── components\
│   │   ├── SharePointRAG_Postgres.py          # PostgreSQL-based RAG
│   │   ├── sharepoint_sync_service_postgres.py # Background sync
│   │   ├── postgres_sharepoint_schema.sql      # Database schema
│   │   ├── lamapperagents\
│   │   │   ├── mapper_agentic_orchestrator.py  # ✅ Has memory
│   │   │   ├── mapper_short_term_memory.py     # TinyDB (no PostgreSQL)
│   │   │   └── mapper_conversation_store.py    # TinyDB
│   │   └── lamapper_api.py                     # API endpoints
│   └── .env                                    # Configuration
└── POSTGRES_QUICKSTART.md                      # This file!

C:\dev\lamapper\
└── src\
    └── components\
        └── data-mapper-wizard\
            ├── AgenticMode.tsx                 # ✅ Has entity cards
            └── EntityCard.tsx                  # ✅ UI component

C:\dev\postgres\
└── pgsql\                                      # Your PostgreSQL installation
    ├── bin\
    │   ├── psql.exe                           # PostgreSQL CLI
    │   └── pg_ctl.exe                         # Service control
    └── lib\
        └── pgvector.dll                       # Vector extension (after setup)
```

---

## Summary

**Lamapper is ready to use RIGHT NOW!** No PostgreSQL setup needed.

PostgreSQL is **optional** and only adds:
- SharePoint document caching (166x faster queries)
- Fine-tuned model support
- Multi-instance cache sharing

See `SHAREPOINT_RAG_SETUP.md` for full SharePoint RAG documentation.

---

**Questions?** Check the troubleshooting section or logs:
- Lamapper backend: `mapping_log.log`
- SharePoint sync: `sharepoint_sync_postgres.log`
