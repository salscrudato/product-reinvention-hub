# Knowledge Tree Builder - Work Notes Analysis Guide

## Overview

The **Knowledge Tree Builder** is an advanced incident analysis tool that **extracts real information from work notes** to build a hierarchical knowledge base for L2 support teams. Unlike simple categorization, it uses **iterative clustering** to progressively build patterns.

## How It Works

### 1. Iterative Processing
```
For each incident:
  ├─ Extract from work notes: root cause, resolution, workaround
  ├─ Find similar incidents using FAISS vector search
  ├─ Assign to existing category OR create new one
  ├─ Cluster root causes within categories
  └─ Collect workaround variants per root cause pattern
```

### 2. Hierarchical Structure
```
Knowledge Tree
└─ Category (e.g., "Policy Management")
    └─ Root Cause Pattern (e.g., "Database timeout during peak hours")
        ├─ Resolution #1: "Optimize index on policy_transactions table"
        ├─ Resolution #2: "Increase connection pool size"
        ├─ Workaround #1: "Process during off-peak hours"
        └─ Incidents: [INC9000123, INC9000456, ...]
```

### 3. Work Notes Extraction

The LLM **reads actual work notes** and extracts:
- **ROOT_CAUSE**: What caused the issue (quoted from notes)
- **RESOLUTION**: How it was fixed (step-by-step if available)
- **WORKAROUND**: Temporary fixes mentioned
- **CATEGORY**: Business area (Policy, Claims, Billing, etc.)
- **PATTERN**: Brief pattern description

**Example from Real Work Notes:**
```
Work Notes:
"Customer unable to access policy documents. 
Root cause: Document service timeout due to large PDF size (45MB).
Workaround: Compressed PDF to 8MB and re-uploaded.
Resolution: Added file size limit validation (15MB) to prevent future issues."

Extracted:
ROOT_CAUSE: Document service timeout due to large PDF size (45MB)
RESOLUTION: Added file size limit validation (15MB max) to prevent future issues
WORKAROUND: Compressed PDF and re-uploaded
CATEGORY: documents
PATTERN: PDF document size causing service timeouts
```

## Usage

### Run via VS Code (Recommended)
1. Press **F5**
2. Select **"Knowledge Tree Builder - Hierarchical Clustering from Work Notes"**
3. Watch progress in terminal

### Run via Command Line
```powershell
cd backend
python batch_incident_knowledge_tree.py --cost-limit 25
```

### With Environment Flag (Vectored Only)
```powershell
$env:VECTORED_INCIDENTS_ANALYSIS_ONLY="1"
python batch_incident_knowledge_tree.py --cost-limit 25
```

## Output Files

All outputs saved to: `docs/incident_knowledge_tree/`

### 1. `KNOWLEDGE_TREE_{timestamp}.json`
Complete hierarchical JSON structure:
```json
{
  "categories": {
    "policy_management": {
      "total_incidents": 87,
      "category_name": "Policy Management",
      "root_cause_patterns": {
        "Database timeout during peak hours": {
          "incident_count": 23,
          "root_cause_full": "...",
          "resolutions": ["Optimize index...", "Increase pool..."],
          "workarounds": ["Process off-peak...", "Use cached data..."],
          "incidents": [...]
        }
      }
    }
  }
}
```

### 2. `L2_KNOWLEDGE_BASE_{timestamp}.md`
**Actionable guide for L2 support teams** with:
- Quick reference by category
- Root causes sorted by frequency
- Workarounds for immediate fixes
- Resolutions for permanent fixes
- Example incident numbers

**Sample Output:**
```markdown
## Policy Management (87 incidents)

### Database timeout during peak hours (23 occurrences)

**Root Cause:**  
Query timeout on policy_transactions table during business hours peak load

**Workarounds:**
- Process requests during off-peak hours (before 7am or after 6pm)
- Use cached data from last sync (max 1 hour stale)

**Resolutions:**
- Optimize index on policy_transactions(customer_id, effective_date)
- Increase database connection pool from 10 to 25 connections
- Implement query result caching with 5-minute TTL

**Example Incidents:**  
- INC9000123: "Customer policies loading slowly"
- INC9000456: "Unable to retrieve policy documents"
- INC9000789: "Timeout error when searching policies"
```

## Cost & Performance

### Estimated Costs (GPT-3.5-Turbo)
- **555 vectored incidents**: ~$0.25 - $0.40
- **900 incidents**: ~$0.35 - $0.55
- Each incident: 1 LLM API call for extraction

### Processing Time
- **555 incidents**: ~8-12 minutes
- **900 incidents**: ~15-20 minutes
- With FAISS similarity: minimal overhead

## Feature Flags

### `VECTORED_INCIDENTS_ANALYSIS_ONLY=1`
**Effect:** Only analyze incidents that have been indexed (have embeddings)
**Benefit:** ~40% cost reduction (555 vs 900 incidents)
**Use when:** You want cost-optimized analysis of indexed incidents

**Set via:**
```powershell
# PowerShell
$env:VECTORED_INCIDENTS_ANALYSIS_ONLY="1"

# bash/zsh
export VECTORED_INCIDENTS_ANALYSIS_ONLY="1"

# .env file
VECTORED_INCIDENTS_ANALYSIS_ONLY=1
```

## Algorithm Details

### Clustering Logic
1. **Category Assignment**
   - LLM extracts category from work notes
   - Standardized: policy_management, claims, billing, underwriting, documents, system, other

2. **Root Cause Matching** (within category)
   - Compare extracted root cause against existing patterns
   - Use text similarity (SequenceMatcher)
   - Threshold: 70% similarity to merge
   - Otherwise: Create new root cause pattern

3. **Workaround Collection**
   - Extract workarounds from work notes
   - Deduplicate within root cause pattern
   - Keep all variants for L2 flexibility

4. **Resolution Tracking**
   - Extract step-by-step resolutions
   - Deduplicate within root cause pattern
   - Build resolution playbook per pattern

### FAISS Similarity
- Finds similar incidents among already-processed
- Threshold: 70% similarity
- Used for: Validating category assignment, identifying outliers
- **Not used for**: Overriding LLM category decisions (LLM is authoritative)

## Comparison to Other Modes

| Feature | Knowledge Tree | Comprehensive | Similarity |
|---------|---------------|---------------|------------|
| **Hierarchical clustering** | ✅ Yes | ❌ No | ❌ No |
| **Work notes extraction** | ✅ Yes | ⚠️ Partial | ❌ No |
| **Root cause grouping** | ✅ Yes | ❌ No | ❌ No |
| **Workaround collection** | ✅ Yes | ❌ No | ❌ No |
| **L2 actionable output** | ✅ Yes | ⚠️ Partial | ❌ No |
| **Cost per 555 incidents** | ~$0.30 | ~$0.21 | ~$0.00 |
| **Processing time** | ~10 min | ~7 min | ~30 sec |

**Use Knowledge Tree when:** You need L2 support automation with actionable workarounds
**Use Comprehensive when:** You need deep individual incident analysis
**Use Similarity when:** You need quick vector-based grouping

## Example Workflow

### 1. Index Incidents (One-Time)
```powershell
# Run indexer first to create FAISS index
python batch_incident_indexer.py
```

### 2. Build Knowledge Tree
```powershell
# Analyze vectored incidents with cost limit
$env:VECTORED_INCIDENTS_ANALYSIS_ONLY="1"
python batch_incident_knowledge_tree.py --cost-limit 25
```

### 3. Review Outputs
```powershell
# Check JSON tree structure
cat docs/incident_knowledge_tree/KNOWLEDGE_TREE_*.json | jq '.categories'

# Read L2 guide
code docs/incident_knowledge_tree/L2_KNOWLEDGE_BASE_*.md
```

### 4. Share with L2 Team
- Share `L2_KNOWLEDGE_BASE_*.md` with support teams
- Integrate JSON tree into ticketing system
- Build automated workaround suggestions

## Troubleshooting

### "No work notes" Warnings
**Cause:** Many incidents lack detailed work notes  
**Impact:** Skipped from analysis (no useful data to extract)  
**Solution:** Normal - only incidents with documentation are processed

### "Extraction failed" Errors
**Cause:** LLM API timeout or invalid response  
**Impact:** Single incident skipped, rest continue  
**Solution:** Check Azure OpenAI endpoint health

### Cost Limit Reached
**Cause:** More incidents than budget allows  
**Impact:** Processing stops mid-run  
**Solution:** Increase `--cost-limit` or enable `VECTORED_INCIDENTS_ANALYSIS_ONLY=1`

### Empty Categories
**Cause:** Work notes lack structured information  
**Impact:** Generic "other" category used  
**Solution:** Review incident documentation quality

## Future Enhancements

- [ ] Multi-language support for work notes
- [ ] Auto-suggest workarounds for new incidents
- [ ] Integration with ServiceNow knowledge base
- [ ] Trend analysis: emerging patterns over time
- [ ] Cost tracking per category
- [ ] Export to Confluence/SharePoint

## Related Scripts

- **batch_incident_indexer.py**: Creates FAISS index (run first)
- **batch_incident_analyzer.py**: Comprehensive LLM analysis (legacy)
- **diagnose_faiss_and_db.py**: Verify index health

---

**Questions?** Check logs at: `docs/incident_knowledge_tree/knowledge_tree_builder.log`
