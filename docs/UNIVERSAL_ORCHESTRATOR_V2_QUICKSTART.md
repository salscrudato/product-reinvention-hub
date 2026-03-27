# Universal Orchestrator V2 - Quick Start Guide

## Overview

The **Universal Orchestrator V2** is a domain-agnostic orchestration framework where domain expertise lives in **YAML configuration files** instead of Python code.

**Key Benefits:**
- ✅ Add new domains (Insurance, HR, Procurement) without code changes
- ✅ Multi-stage workflows with specialized prompts per stage
- ✅ Virtual File System (VFS) prevents context window overflow
- ✅ Hot-reload configs (no restart needed)
- ✅ Backward compatible (falls back to V1 if disabled)

## Setup

### 1. Enable Feature Flag

```bash
# In .env or environment variable
ENABLE_UNIVERSAL_ORCHESTRATOR=1

# Optional: Enable VFS
ENABLE_VFS=1  # (default: 1)

# Optional: Config reload interval
CONFIG_RELOAD_INTERVAL=30  # seconds (default: 30)
```

### 2. Restart Backend

```bash
cd backend
python app.py --port 5001
```

### 3. Verify Logs

```bash
tail -f agentic_orchestrator_auto.log | grep "FLOW\[UNIVERSAL"

# Should see:
# FLOW[UNIVERSAL_INIT] Universal orchestrator initialized
# FLOW[CONFIG_LOAD] Loading config | {"path": "incident_investigation.yaml"}
```

## Usage

### API Endpoint

**New V2 Endpoint:** `POST /agentic_orchestrate_v2`

**Request Format (Same as V1):**

```json
{
  "messages": [
    {"role": "user", "content": "Investigate INC0012345 and recommend solution"}
  ],
  "prompt": "You are DevCopilot, an intelligent assistant.",
  "metadata": {},
  "username": "john.doe"
}
```

**Response Format (Enhanced):**

```json
{
  "plan": [],
  "outputs": {...},
  "errors": [],
  "traces": [...],
  "answer": "## Incident Investigation Summary\n\n**Root Cause:** ...",
  "metadata": {
    "orchestrator_version": "v2_universal",
    "domain": "servicenow_incidents",
    "stages_executed": ["investigation", "resolution"],
    "vfs_stats": {
      "total_files": 5,
      "total_mb": 12.3,
      "usage_percent": 24.6
    }
  },
  "stage_results": {
    "investigation": {
      "answer": "Root cause identified...",
      "tool_outputs": {...},
      "traces": [...]
    },
    "resolution": {
      "answer": "Recommended solution...",
      "tool_outputs": {...},
      "traces": [...]
    }
  },
  "vfs_stats": {...}
}
```

### Frontend Integration

**Update Your Frontend:**

```javascript
// Change endpoint from /agentic_orchestrate_auto to /agentic_orchestrate_v2
const response = await fetch('http://localhost:5001/agentic_orchestrate_v2', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    messages: messages,
    prompt: systemPrompt,
    metadata: {},
    username: username
  })
});

const result = await response.json();

// Access V2-specific fields:
console.log(`Domain: ${result.metadata.domain}`);
console.log(`Stages: ${result.metadata.stages_executed.join(' → ')}`);
console.log(`VFS Usage: ${result.metadata.vfs_stats.usage_percent}%`);

// Answer remains in same location:
const answer = result.answer;
```

### Fallback Behavior

**Automatic Fallback to V1:**
- Feature flag disabled (`ENABLE_UNIVERSAL_ORCHESTRATOR=0`)
- Import errors (missing dependencies)
- No matching config found
- Unexpected errors during orchestration

```bash
# Log message:
[API_V2][cid=abc123] Universal orchestrator disabled - falling back to v1
[API_V2][cid=abc123] No matching config found, falling back to v1
```

## Example Queries

### ServiceNow Incident Investigation

**Query:**
```
Investigate incident INC0012345 and recommend resolution
```

**What Happens:**
1. V2 detects `INC0012345` via entity pattern
2. Loads `incident_investigation.yaml` config
3. Executes **Stage 1 (Investigation)**:
   - Fetches incident details
   - Queries Splunk logs
   - Finds similar incidents
   - Stores findings in VFS: `/investigation/INC0012345/analysis.md`
4. Executes **Stage 2 (Resolution)**:
   - Reads investigation results from VFS
   - Searches knowledge base
   - Generates solution steps
   - Stores plan in VFS: `/resolution/INC0012345/plan.md`
5. Synthesizes final answer combining both stages

**Answer:**
```markdown
# Incident Investigation and Resolution Summary

## Investigation Findings

**Root Cause Analysis:**
Database connection timeout in auth service...

**Supporting Evidence:**
Splunk logs show 347 timeout errors between 14:22-14:35...

## Recommended Resolution

**Primary Solution:**
1. Increase connection pool size from 50 to 100
2. Add connection timeout monitoring
3. Deploy during next maintenance window

**Rollback Plan:**
Revert connection pool configuration via ConfigMap...
```

## Testing V2

### Test 1: Enable V2, submit query

```bash
# Enable
export ENABLE_UNIVERSAL_ORCHESTRATOR=1

# Submit query via curl
curl -X POST http://localhost:5001/agentic_orchestrate_v2 \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Investigate INC0012345"}],
    "prompt": "You are DevCopilot.",
    "metadata": {},
    "username": "test.user"
  }'

# Check response metadata
# Should see: "orchestrator_version": "v2_universal"
```

### Test 2: Verify VFS Usage

```bash
# Check logs for VFS writes
tail -f agentic_orchestrator_auto.log | grep VFS_WRITE

# Example output:
# FLOW[VFS_WRITE] File written | {"path": "/investigation/INC001/logs.json", "size_bytes": 45231}
```

### Test 3: Verify Fallback

```bash
# Disable V2
export ENABLE_UNIVERSAL_ORCHESTRATOR=0

# Submit same query
curl -X POST http://localhost:5001/agentic_orchestrate_v2 ...

# Check logs
tail -f agentic_orchestrator_auto.log | grep falling

# Should see:
# [API_V2] Universal orchestrator disabled - falling back to v1
```

### Test 4: Hot-Reload

```bash
# Edit config
vim backend/components/orchestration_configs/incident_investigation.yaml

# Change max_iterations in investigation stage
# From: max_iterations: 15
# To: max_iterations: 20

# Wait 30 seconds

# Submit query - should use new config
# Check logs:
tail -f agentic_orchestrator_auto.log | grep CONFIG_RELOAD
# FLOW[CONFIG_RELOAD] Configs reloaded | {"count": 1, "domains": ["servicenow_incidents"]}
```

## Monitoring

### Key Metrics to Track

```python
# In logs (grep with these patterns):
FLOW[UNIVERSAL_START]      # Orchestration started
FLOW[UNIVERSAL_CONFIG]     # Config selected
FLOW[UNIVERSAL_STAGE_START] # Stage execution
FLOW[VFS_WRITE]            # VFS file written
FLOW[VFS_STATS]            # VFS statistics
FLOW[UNIVERSAL_COMPLETE]   # Orchestration finished

# Example monitoring query:
tail -f agentic_orchestrator_auto.log | grep "FLOW\[UNIVERSAL" | jq -r '.correlation_id, .domain, .stages_executed'
```

### Dashboard Metrics

Collect these for observability:
- **Requests/min** to `/agentic_orchestrate_v2`
- **Average stages per request** (from `metadata.stages_executed`)
- **VFS usage %** (from `vfs_stats.usage_percent`)
- **Fallback rate** (v2 → v1 fallbacks)
- **Config match rate** (queries matched vs. not matched)
- **Average duration per stage** (from `traces`)

## Troubleshooting

### Issue: "Universal orchestrator disabled"

**Cause:** Feature flag not set  
**Fix:**
```bash
export ENABLE_UNIVERSAL_ORCHESTRATOR=1
# Restart backend
```

### Issue: "No matching config found"

**Cause:** Query doesn't match any config's activation criteria  
**Fix:**
```yaml
# Lower matching threshold OR add keywords
activation:
  keywords: ["your", "keyword", "here"]
```

### Issue: VFS errors

**Cause:** VFS size limit exceeded  
**Fix:**
```bash
# Increase VFS size
export VFS_MAX_SIZE_MB=100  # default: 50

# Or increase per-file limit
export VFS_MAX_FILE_SIZE_MB=20  # default: 10
```

### Issue: Stage timeouts

**Cause:** max_iterations too low  
**Fix:**
```yaml
# In config YAML
stages:
  - name: "investigation"
    max_iterations: 20  # increase from 15
```

## Rollback to V1

If issues arise, instantly rollback:

```bash
# Disable V2
export ENABLE_UNIVERSAL_ORCHESTRATOR=0

# Restart backend (or wait for next deployment)
# All traffic auto-routes to V1
```

**OR** Point frontend back to original endpoint:

```javascript
// Change from:
fetch('http://localhost:5001/agentic_orchestrate_v2', ...)

// To:
fetch('http://localhost:5001/agentic_orchestrate_auto', ...)
```

## Next Steps

1. **Add More Configs:**
   - JIRA story analysis
   - Insurance claim processing
   - HR onboarding workflows

2. **Enhance Existing Configs:**
   - Add more stages
   - Refine prompts based on results
   - Adjust iteration budgets

3. **Monitor Performance:**
   - Compare V1 vs V2 quality (A/B test)
   - Track VFS usage patterns
   - Identify slow stages

4. **Frontend Updates:**
   - Display stage-by-stage progress
   - Show VFS statistics
   - Render multi-stage results

## Support

- **Logs:** `agentic_orchestrator_auto.log`
- **Configs:** `backend/components/orchestration_configs/`
- **Code:** `backend/components/universal_orchestrator.py`
- **Examples:** See `README.md` in orchestration_configs/
