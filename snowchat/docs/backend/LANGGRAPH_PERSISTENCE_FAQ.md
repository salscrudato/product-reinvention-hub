# LangGraph SQLite Persistence - FAQ

**Date:** January 20, 2026

---

## ✅ Installation Complete

### What Was Installed?

```bash
# Package installed in devpilot conda environment
langgraph-checkpoint-sqlite==3.0.3
```

This provides:
- `SqliteSaver` - SQLite-based checkpoint persistence for LangGraph
- `aiosqlite` - Async SQLite support
- `sqlite-vec` - Vector similarity support in SQLite

---

## Installation Commands

### Method 1: Using Devpilot Environment Directly
```powershell
# Already done! ✅
C:\Users\s.kumar.mamidala\AppData\Local\anaconda3\envs\devpilot\python.exe -m pip install langgraph-checkpoint-sqlite
```

### Method 2: After Activating Conda Environment
```powershell
conda activate devpilot
pip install langgraph-checkpoint-sqlite
```

### Method 3: Install All Requirements
```powershell
conda activate devpilot
pip install -r requirements.txt
```

---

## Requirements.txt Updated

**Location:** `c:\dev\snowchat\requirements.txt`

**Added:**
```
langgraph-checkpoint-sqlite>=3.0.0
```

**Full dependency chain:**
```
langgraph>=0.5.2                      # Already installed
langgraph-checkpoint-sqlite>=3.0.0    # ✅ NEWLY ADDED
```

---

## SqliteSaver vs TinyDB - Key Differences

### Purpose

| Feature | SqliteSaver (LangGraph) | TinyDB |
|---------|-------------------------|---------|
| **Primary Use** | LangGraph workflow state checkpointing | General document storage |
| **Data Model** | Graph state snapshots | JSON documents |
| **Concurrency** | Thread-safe with SQLite | Single-threaded |
| **Persistence** | File-based SQLite | File-based JSON |
| **Query Support** | Thread/checkpoint based | Query API for documents |

### SqliteSaver (LangGraph Checkpoint)

**What it is:**
- Purpose-built for **LangGraph state persistence**
- Stores **workflow checkpoints** (snapshots of state at each node)
- Enables **pause/resume** for multi-turn conversations
- Built-in **time travel** (replay from any checkpoint)

**Use Case:**
```python
# Clarification workflow that MUST survive backend restarts
manager = StatefulClarificationManager(use_sqlite=True)

# Session 1: User asks question
result = manager.start_clarification_session(...)
session_id = result['session_id']
# State saved to: clarification_checkpoints.sqlite

# ⏰ BACKEND RESTARTS ⏰

# Session 2: User responds (state restored from SQLite!)
result = manager.submit_clarification_response(session_id, responses)
# ✅ Workflow continues exactly where it left off
```

**File Location:**
```
backend/clarification_checkpoints.sqlite
```

**Schema:**
- Thread-based (thread_id = session_id)
- Stores: state values, node history, timestamps
- Optimized for sequential workflow state

### TinyDB (Current Usage)

**What it is:**
- Lightweight **document database**
- Stores **application data** (chat history, user preferences)
- Simple JSON-based storage

**Use Case:**
```python
from tinydb import TinyDB, Query
db = TinyDB('state_db.json')

# Store chat history
chat_table = db.table('chat_history')
chat_table.insert({'username': 'user1', 'message': '...', 'timestamp': '...'})

# Store feedback
feedback_table = db.table('feedback')
feedback_table.insert({'function_sequence': [...], 'user': 'user1'})
```

**File Location:**
```
backend/state_db.json
```

**Schema:**
- Tables: `chat_history`, `feedback`, user preferences
- Document-based (arbitrary JSON)
- Optimized for querying and filtering

---

## Is SqliteSaver a Replacement for TinyDB?

**NO!** They serve **different purposes**:

### Use SqliteSaver For:
✅ LangGraph workflow state (clarification sessions)
✅ Multi-turn conversations that need pause/resume
✅ Workflows that must survive restarts
✅ When you need time travel/replay capability

### Use TinyDB For:
✅ Chat history storage
✅ User preferences
✅ Function sequence feedback
✅ Application metadata
✅ Simple document queries

---

## Comparison Table

| Feature | SqliteSaver | TinyDB |
|---------|-------------|--------|
| **Purpose** | Workflow checkpoints | Application data |
| **Integration** | LangGraph only | Any Python app |
| **File Format** | SQLite binary | JSON text |
| **Performance** | Fast (SQLite engine) | Fast (in-memory) |
| **Concurrency** | Thread-safe | Single-threaded |
| **Backup** | SQLite tools | Simple file copy |
| **Query** | Thread/checkpoint ID | Flexible queries |
| **Size** | Compact binary | Human-readable |
| **Use in SnowChat** | Clarification state | Chat history, feedback |

---

## When to Use Each

### Scenario 1: Multi-Turn Clarification (Use SqliteSaver)
```python
# User asks: "Update the incident"
# System: "Which incident? [INC0010001, INC0010002, INC0010003]"
# ⏰ User closes browser, backend restarts ⏰
# User returns 10 minutes later: "INC0010003"
# ✅ SqliteSaver restores state, conversation continues
```

### Scenario 2: Chat History (Use TinyDB)
```python
# Store all conversations for analytics
db = TinyDB('state_db.json')
chat_table = db.table('chat_history')
chat_table.insert({
    'username': 'user1',
    'question': 'Update the incident',
    'response': '...',
    'timestamp': '2026-01-20T11:23:45'
})

# Query: Get last 10 messages for user
User = Query()
history = chat_table.search(User.username == 'user1')[-10:]
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    SnowChat Backend                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  │
│  │   LangGraph Workflow    │  │   Application Logic     │  │
│  │   (Clarification)       │  │   (Chat, Tools)         │  │
│  └───────────┬─────────────┘  └───────────┬─────────────┘  │
│              │                            │                 │
│              │ checkpoint                  │ insert/query   │
│              ▼                            ▼                 │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  │
│  │    SqliteSaver          │  │       TinyDB            │  │
│  │                         │  │                         │  │
│  │ - Workflow state        │  │ - Chat history          │  │
│  │ - Session checkpoints   │  │ - User preferences      │  │
│  │ - Thread-based          │  │ - Feedback data         │  │
│  │                         │  │                         │  │
│  │ clarification_          │  │ state_db.json           │  │
│  │ checkpoints.sqlite      │  │                         │  │
│  └─────────────────────────┘  └─────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## File Locations

### SqliteSaver (NEW)
```
backend/clarification_checkpoints.sqlite
```
- **Stores:** LangGraph workflow state
- **Size:** Grows with active sessions
- **Cleanup:** Can delete old sessions periodically
- **Backup:** Standard SQLite backup tools

### TinyDB (EXISTING)
```
backend/state_db.json
```
- **Stores:** Chat history, feedback, preferences
- **Size:** Grows with usage
- **Cleanup:** Manual purge of old entries
- **Backup:** Simple file copy

---

## Can SqliteSaver Be Main Persistence?

**Technically YES, but NOT RECOMMENDED.**

### Why SqliteSaver Is Not Ideal for General Data:

1. **Optimized for Graph State:**
   - Thread-based access pattern
   - State snapshots, not flexible queries
   - No table/collection concept

2. **No Query API:**
   ```python
   # TinyDB: Easy queries
   User = Query()
   results = db.table('users').search(User.role == 'admin')
   
   # SqliteSaver: Only get by thread_id
   state = graph.get_state(config={"thread_id": session_id})
   # ❌ Cannot query across threads or filter by fields
   ```

3. **LangGraph Dependency:**
   - Requires LangGraph StateGraph
   - Not standalone like TinyDB
   - Tied to workflow schema

### When SqliteSaver COULD Replace TinyDB:

If you **exclusively** need:
- ✅ Thread/session-based storage
- ✅ Checkpoint/snapshot pattern
- ✅ LangGraph integration
- ❌ No complex queries
- ❌ No cross-session analytics

**Verdict:** Keep both! They complement each other.

---

## Migration Strategy (If You Want One Persistence Layer)

### Option 1: PostgreSQL (Enterprise)
Replace both with single PostgreSQL database:
```python
# For LangGraph
from langgraph.checkpoint.postgres import PostgresSaver
checkpointer = PostgresSaver.from_conn_string("postgresql://...")

# For application data
from sqlalchemy import create_engine, Table, MetaData
engine = create_engine("postgresql://...")
```

**Pros:**
- Single database
- ACID guarantees
- SQL queries across all data
- Production-ready

**Cons:**
- Requires Postgres setup
- More complex deployment

### Option 2: Redis (Distributed)
```python
# For LangGraph
from langgraph.checkpoint.redis import RedisSaver
checkpointer = RedisSaver.from_conn_string("redis://...")

# For application data
import redis
r = redis.Redis(host='localhost', port=6379)
```

**Pros:**
- Fast in-memory
- Distributed support
- Built-in expiration

**Cons:**
- No persistence (unless AOF/RDB)
- Requires Redis instance

### Option 3: Keep Both (RECOMMENDED)
```python
# For LangGraph workflows
clarification_manager = StatefulClarificationManager(use_sqlite=True)
# → clarification_checkpoints.sqlite

# For application data
db = TinyDB('state_db.json')
chat_table = db.table('chat_history')
```

**Pros:**
- ✅ Right tool for each job
- ✅ Simple deployment
- ✅ No migration needed
- ✅ File-based (easy backup)

**Cons:**
- Two persistence systems

---

## Recommendation

**Keep both SqliteSaver and TinyDB!**

| Use Case | Storage | Reason |
|----------|---------|--------|
| Clarification sessions | SqliteSaver | Workflow state, pause/resume |
| Chat history | TinyDB | Flexible queries, analytics |
| User preferences | TinyDB | Document-based storage |
| Feedback sequences | TinyDB | Query by user/function |

**Migration Path (If Needed Later):**
```
Phase 1: Current (SqliteSaver + TinyDB)
Phase 2: Add PostgreSQL (parallel write)
Phase 3: Deprecate TinyDB, keep SqliteSaver for LangGraph
Phase 4: Migrate to PostgresSaver for enterprise scale
```

---

## Summary

### What We Did:
✅ Installed `langgraph-checkpoint-sqlite>=3.0.0`
✅ Updated `requirements.txt`
✅ Verified import works in devpilot environment

### What It Does:
✅ Enables persistent LangGraph workflow state
✅ Survives backend restarts
✅ Supports pause/resume clarification sessions
✅ Thread-based checkpoint management

### What It Doesn't Do:
❌ Replace TinyDB for general data storage
❌ Provide flexible query API
❌ Work outside LangGraph workflows

### Recommendation:
**Use both!** SqliteSaver for LangGraph workflows, TinyDB for application data.

---

## Verification Commands

```powershell
# Activate devpilot environment
conda activate devpilot

# Verify SqliteSaver available
python -c "from langgraph.checkpoint.sqlite import SqliteSaver; print('✅ OK')"

# Test clarification manager
cd backend
python -c "from components.langgraph_clarification_engine import StatefulClarificationManager; mgr = StatefulClarificationManager(); print('✅ Manager created')"

# Check checkpoint file after first session
ls clarification_checkpoints.sqlite
```

---

## Next Steps

1. **Test the implementation:**
   ```bash
   cd backend
   python test_langgraph_clarification.py  # Create this test
   ```

2. **Integrate with orchestrator:**
   - Update `langgraph_flow.py` to use `StatefulClarificationManager`
   - Pass `session_id` in metadata

3. **Monitor checkpoint file:**
   ```bash
   # Check size
   ls -lh clarification_checkpoints.sqlite
   
   # Inspect with SQLite tools
   sqlite3 clarification_checkpoints.sqlite ".tables"
   ```

4. **Set up cleanup (optional):**
   ```python
   # Cron job to delete old sessions
   import os
   import time
   
   MAX_AGE_DAYS = 7
   db_path = "clarification_checkpoints.sqlite"
   
   if os.path.exists(db_path):
       age_days = (time.time() - os.path.getmtime(db_path)) / 86400
       if age_days > MAX_AGE_DAYS:
           os.remove(db_path)  # Or use SQLite DELETE
   ```

---

**Implementation Complete!** ✅

SqliteSaver is now available for LangGraph persistence, and the system maintains TinyDB for application data storage.
