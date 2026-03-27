# Full Incident Embedded Similarity Analysis

## Overview

The `FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS` feature flag enables **multi-field embeddings** for richer similarity analysis. Instead of only using `short_description`, it combines multiple incident fields to capture more context.

## How It Works

### Standard Mode (Default)
```
Embedding: short_description only
Example: "Login timeout in PAS system"
```

### Full Mode (Flag Enabled)
```
Embedding: short_description + work_notes (up to 2000 chars)
Example: "Login timeout in PAS system

Work notes: Identified root cause as expired SSL certificate. 
Renewed certificate and restarted web server. Issue resolved."
```

## Benefits

✅ **Better Similarity Matching**
- Captures resolution patterns in work_notes
- Identifies similar root causes, not just similar symptoms
- Finds incidents resolved using same workarounds

✅ **Improved Categorization**
- More context for business categorization
- Better pattern detection across incident clusters

✅ **Smarter Recommendations**
- Workaround suggestions based on actual resolutions
- Root cause correlation across similar incidents

## Usage

### Enable the Feature

**PowerShell:**
```powershell
$env:FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS = "1"
```

**Bash:**
```bash
export FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS=1
```

**Python (in code):**
```python
import os
os.environ["FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS"] = "1"
```

### Run Indexer (Required First)

```bash
python batch_incident_indexer.py --mode full
```

**Output:**
```
🔧 FEATURE FLAGS:
   FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS: ENABLED ✓
   → Embeddings will include: short_description + work_notes (up to 2000 chars)

[PHASE 3/4] Processing incidents and generating embeddings...
   ████████████████████████████████████████ 100.0% | 900/900
   ✅ Processed: 900 incidents
   📊 Cache hits: 150 | Cache misses: 750
```

### Run Analyzer

```bash
python batch_incident_analyzer.py --mode similarity --threshold 0.75
```

**Output:**
```
🔧 FEATURE FLAGS:
   FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS: ENABLED ✓
   → Similarity search uses: short_description + work_notes (up to 2000 chars)
   → Cache keys use 'FULL:' prefix

📊 PATTERN STATISTICS:
   Incidents analyzed:        900
   Patterns found:            487
   Incidents with similars:   487 (54.1%)
```

## Cache Key Format

The feature uses **prefixed cache keys** to distinguish between modes:

**Standard mode:**
```
Cache key: "Login timeout in PAS system"
```

**Full mode:**
```
Cache key: "FULL:Login timeout in PAS system"
```

This allows both modes to coexist in the same cache file.

## Performance Considerations

### Token Usage
- **Standard:** ~10-50 tokens per incident
- **Full mode:** ~50-600 tokens per incident (depends on work_notes length)

**Work notes are truncated to 2000 characters** to stay within token limits.

### Embedding Cost
Assuming 900 incidents with average 300 tokens each in full mode:
- Tokens: 900 × 300 = 270,000 tokens
- Cost (text-embedding-ada-002): ~$0.03
- Time: ~2-3 minutes

### Cache Efficiency
Once embeddings are cached, similarity search is **instant** (FAISS vector search).

## Migration Guide

### Switching from Standard to Full Mode

1. **Enable flag:**
   ```bash
   export FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS=1
   ```

2. **Rebuild index:**
   ```bash
   python batch_incident_indexer.py --mode full
   ```
   
3. **Run analysis:**
   ```bash
   python batch_incident_analyzer.py --mode similarity
   ```

### Switching Back to Standard Mode

Simply unset the flag (existing cache remains intact):
```bash
unset FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS
# or
export FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS=0
```

No rebuild needed - standard cache keys are still available.

## Example Comparison

### Scenario: Two incidents with similar symptoms but different root causes

**Incident A:**
```
Short Description: "PAS login timeout"
Work Notes: "Root cause: Database connection pool exhausted. 
            Increased pool size from 50 to 100."
```

**Incident B:**
```
Short Description: "PAS login timeout"  
Work Notes: "Root cause: Expired SSL certificate on load balancer.
            Renewed certificate."
```

**Standard mode:** High similarity (0.95) - same short description
**Full mode:** Lower similarity (0.65) - different root causes captured

**Result:** Full mode correctly identifies these as **different issues** requiring different solutions.

## Files Modified

1. `batch_incident_indexer.py`
   - Added `FULL_INCIDENT_EMBEDDED_SIMILARITY` flag check
   - Modified embedding generation to include work_notes
   - Added cache key prefixing

2. `batch_incident_analyzer.py`
   - Added `FULL_INCIDENT_EMBEDDED_SIMILARITY` flag check
   - Modified similarity search to use appropriate cache keys
   - Added on-the-fly embedding generation for missing entries

## Troubleshooting

### "No embedding found" warnings
**Cause:** Cache was built in standard mode, but analyzer is in full mode (or vice versa)

**Solution:** Rebuild index in the desired mode:
```bash
export FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS=1
python batch_incident_indexer.py --mode full
```

### Lower similarity scores than expected
**Cause:** More detailed embeddings capture nuanced differences

**Solution:** Adjust threshold in analyzer:
```bash
python batch_incident_analyzer.py --mode similarity --threshold 0.65
```

### High embedding costs
**Cause:** Full mode uses more tokens

**Solutions:**
- Use incremental mode (only new/changed incidents)
- Cache is persistent - embeddings only generated once
- Consider filtering incidents by date range

## Advanced Configuration

### Custom Work Notes Length

Modify in both files:
```python
# Change from 2000 to desired length
work_notes_truncated = work_notes[:1000] if work_notes else ""
```

### Include Additional Fields

Extend the embedding text:
```python
description = incident.get("description", "") or ""
embedding_text = f"{short_desc}\n\n{work_notes_truncated}\n\n{description[:500]}"
```

## Recommendations

**Use Full Mode When:**
- ✅ Analyzing root cause patterns
- ✅ Finding workaround opportunities
- ✅ Incidents have detailed work notes
- ✅ Need to distinguish similar symptoms with different resolutions

**Use Standard Mode When:**
- ✅ Quick categorization only
- ✅ Work notes are sparse or missing
- ✅ Minimizing embedding costs
- ✅ Fast initial triage/classification

---

## 🛡️ Cost Protection (NEW - March 19, 2026)

The batch analyzer includes **automatic cost limit enforcement** to prevent expensive runs.

### Features
- ✅ **Default limit:** $50.00 per analysis run  
- ✅ **Pre-run estimation** - Calculates expected cost before starting  
- ✅ **Real-time tracking** - Shows cost during analysis progress  
- ✅ **Automatic stopping** - Halts if limit is reached  
- ✅ **Partial results** - Saves data even if stopped early  
- ✅ **User confirmation** - Prompts if estimate exceeds limit  

### Usage

```powershell
# Set custom limit
python batch_incident_analyzer.py --mode comprehensive --cost-limit 100

# Lower limit for testing
python batch_incident_analyzer.py --mode comprehensive --cost-limit 5

# Combined with filtering for precise control
python batch_incident_analyzer.py --mode comprehensive --filter-prefix INC9 --cost-limit 10
```

### Cost-Aware Modes

| Mode | LLM Calls | Typical Cost | Cost Limit Applied? |
|------|-----------|--------------|---------------------|
| Similarity | 0 | $0.00 | ❌ No (always safe) |
| Unified | 1 | $0.01 | ❌ No (always safe) |
| Executive | 1 | $0.01 | ❌ No (always safe) |
| Comprehensive | 100-10,000+ | $1-+ | ✅ Yes (enforced) |

### Example Output

```
💰 COST ESTIMATION:
   Estimated incidents: 2,500
   Estimated input tokens: 750,000
   Estimated output tokens: 1,250,000
   Estimated cost: .25
   Cost limit: .00
   ✅ Within budget (.25 < .00)

Progress: 100.0% | 2500/2500 | Cost: .18

✅ AI Analysis Complete!
   💰 Total LLM Cost: .1842
   ✅ Under budget by .82
```

**Recommendation:** Use --filter-prefix to reduce incident count before running expensive comprehensive analysis.
