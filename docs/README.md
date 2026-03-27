# SnowChat Documentation Archive

**Date Consolidated:** March 4, 2026  
**Purpose:** Historical documentation consolidated for review and archival

---

## Important Notice

⚠️ **This folder contains historical documentation for review purposes.**

**For current, authoritative information, consult:**
📄 **[AI_COPILOT_MASTER_REFERENCE.md](../../AI_COPILOT_MASTER_REFERENCE.md)** (at workspace root)

That document is the SINGLE SOURCE OF TRUTH and is actively maintained.

---

## What's In This Folder

### Root Documentation (42 files)
All .md files that were previously scattered in the `c:\dev\snowchat\` root directory, including:

- **Architecture & Design:**
  - `AGENTIC_AI_PROJECT_INTENTION.md` - Project vision
  - `SnowChat_Arch.md` - Architecture overview
  - `BACKEND_CAPABILITIES_ANALYSIS.md` - Backend features

- **Implementation Summaries:**
  - `LATENCY_FIX_20260303.md` - Performance optimization (March 2026)
  - `PRE_PLANNING_ANALYSIS_IMPLEMENTATION.md` - Pre-planning system
  - `CHAT_HISTORY_IMPLEMENTATION_SUMMARY.md` - Chat history features
  - `ENTITY_MEMORY_IMPLEMENTATION_SUMMARY.md` - Entity tracking
  - Many more...

- **Integration Guides:**
  - `SERVICENOW_TOOL_INTEGRATION_GUIDE.md` - ServiceNow integration
  - `SHAREPOINT_RAG_INTEGRATION_GUIDE.md` - SharePoint RAG
  - `LAMAPPER_INTEGRATION_CHECKLIST.md` - LAMapper integration

- **Feature Documentation:**
  - `QUESTION_SUGGESTION_SYSTEM.md` - Contextual suggestions
  - `HEALTH_CHECK_SYSTEM.md` - Health monitoring
  - `SHORT_TERM_MEMORY_IMPLEMENTATION.md` - Memory system
  - Many more...

### Backend Documentation (`backend/` subfolder)
Backend-specific documentation that was previously in `c:\dev\snowchat\backend\`, including:

- Component-specific docs (in `backend/components/`)
- Domain-specific docs (in `backend/domain/`)
- Test documentation
- Mapping agents documentation

### Frontend Documentation
- `frontend_README.md` - React frontend documentation

---

## Why Were These Files Moved?

**Problem:** Too many scattered .md files (95+) made it hard to:
1. Find relevant information quickly
2. Know which docs were current vs historical
3. Maintain consistency across documentation

**Solution:** 
1. **Consolidate** all historical docs in one place (`docs/` folder)
2. **Centralize** current information in master reference document
3. **Review** docs folder periodically to archive or delete outdated content

---

## Maintenance Guidelines

### ✅ DO:
- Reference these docs when investigating historical context
- Consult these docs to understand past implementation decisions
- Extract relevant information to update the master reference

### ❌ DON'T:
- Create new .md files for every feature or fix
- Update these historical docs (update master reference instead)
- Treat these docs as current/authoritative

### 🔄 UPDATE WORKFLOW:
When making significant changes to the system:
1. Document in the master reference (not new .md file)
2. Add entry to version history in master reference
3. Update relevant sections with current state

---

## Review Schedule

**Recommended:** Quarterly review of this folder to:
- Archive truly historical content (move to `docs/archive/`)
- Integrate still-relevant content into master reference
- Delete obsolete or duplicate documentation

**Next Review:** June 2026

---

## Quick Links

- 📄 [Master Reference](../../AI_COPILOT_MASTER_REFERENCE.md) - Current documentation (SINGLE SOURCE OF TRUTH)
- 📂 [Backend Docs](./backend/) - Backend component documentation
- 📁 [Root Docs](./) - All root-level historical docs

---

**Last Updated:** March 4, 2026  
**Maintainer:** s.kumar.mamidala
