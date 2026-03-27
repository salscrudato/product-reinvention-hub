# Resolution Discovery from Similar Incidents - Implementation Guide

## Overview

New tool: **`find_resolutions_from_similar_incidents`** - implements similarity-based resolution discovery workflow to answer "What worked for similar problems?"

## Problem Solved

**User's Question:**
> "How is the bulk analyze tool going to perform similarity search? My intention was asking for similar incidents to the incidents in the context and what we are seeing as the resolutions or root cause or the workarounds... how we get to those?"

**Previous Limitation:**
- `analyze_bulk_work_notes` only analyzed the exact incidents provided
- Did NOT find similar incidents or learn from their resolutions
- Users had to manually find similar cases before analyzing them

**New Capability:**
- Takes context incidents → Finds similar RESOLVED incidents → Extracts their workarounds/resolutions → Recommends actions

---

## Architecture

### Workflow

```
User's Context Incidents → Embedding Similarity Search → Similar Resolved Incidents → Work Notes Extraction → Resolution Patterns → Recommended Actions
```

### Step-by-Step Process

**1. Context Incidents (Input)**
```
User has: INC0010001 (server outage problem)
```

**2. Similarity Search (Using Cached Embeddings!)**
```
→ Extract short description: "Server is down and not responding"
→ Generate/retrieve embedding (from cache - 79 entries!)
→ Search FAISS index for similar incidents
→ Find: INC0010203, INC0010445, INC0010889... (similarity > 0.85)
```

**3. Filter for Resolved Incidents**
```
→ Check incident state for each similar incident
→ Keep only: state 6 (Resolved), 7 (Closed), 8 (Closed Complete)
→ Fetch work notes for these resolved incidents
```

**4. Extract Resolutions**
```
→ Get work notes summary for each resolved incident
→ Focus on: workarounds, solutions, actions taken
→ LLM analysis extracts patterns
```

**5. Aggregate & Recommend**
```
→ Group solutions by type (config change, manual action, escalation, etc.)
→ Count frequency (how often each solution was used)
→ Rank recommendations by: frequency + similarity score + success rate
```

---

## API Reference

### Function Signature

**File:** `backend/components/servicenowgenaitool.py`

```python
def find_resolutions_from_similar_incidents_core(
    incident_numbers: List[str],           # 1-20 context incidents
    max_similar_per_incident: int = 5,     # Find up to 5 similar per context incident
    max_concurrent: int = 10,              # Parallel API calls (rate limiting)
    include_active_incidents: bool = False # Also show unresolved similar incidents
) -> Dict[str, Any]
```

### Tool Registration

**File:** `backend/components/snowaaonetool.py`

```python
@register_tool_function("find_resolutions_from_similar_incidents")
def find_resolutions_from_similar_incidents_tool(
    incident_numbers: List[str],
    max_similar_per_incident: int = 5,
    include_active_incidents: bool = False
)
```

**Added to:** `snow_tools` dictionary for orchestrator access

---

## Response Schema

### Successful Response

```json
{
  "context_incidents": ["INC0010001", "INC0010002"],
  "similar_incidents_found": 8,
  "resolved_incidents_analyzed": 6,
  "active_incidents_found": 2,
  
  "summary": "Most similar server outage incidents were resolved by restarting the application service (5 incidents) or rebooting the server (2 incidents). Average resolution time: 45 minutes.",
  
  "resolution_patterns": [
    {
      "solution": "Restart application service via systemctl restart app-service",
      "type": "manual_action",
      "incidents": ["INC0010203", "INC0010445", "INC0010889", "INC0011234", "INC0011567"],
      "frequency": 5,
      "success_indicators": "All 5 incidents marked resolved after service restart, no recurrence within 24h"
    },
    {
      "solution": "Full server reboot required due to memory leak",
      "type": "escalation",
      "incidents": ["INC0010678", "INC0011023"],
      "frequency": 2,
      "success_indicators": "Resolved after reboot, memory leak patched in follow-up"
    }
  ],
  
  "solution_categories": [
    {"category": "Manual Service Actions", "count": 5, "examples": ["restart service", "clear cache"]},
    {"category": "Server Reboots", "count": 2, "examples": ["full reboot", "emergency restart"]},
    {"category": "Configuration Changes", "count": 1, "examples": ["increase memory limit"]}
  ],
  
  "recommended_actions": [
    {
      "rank": 1,
      "action": "Attempt service restart: systemctl restart app-service",
      "rationale": "Used in 5/8 similar incidents (62.5%), all successful. Fastest resolution (avg 10 min).",
      "type": "immediate",
      "estimated_time": "10-15 minutes"
    },
    {
      "rank": 2,
      "action": "If restart fails, check memory usage and consider reboot",
      "rationale": "Used in 2 cases where restart didn't work. Memory leak was root cause.",
      "type": "requires_approval",
      "estimated_time": "30-45 minutes"
    },
    {
      "rank": 3,
      "action": "Review application logs for memory leak patterns",
      "rationale": "Proactive measure based on historical patterns to prevent recurrence",
      "type": "immediate",
      "estimated_time": "15 minutes"
    }
  ],
  
  "key_insights": [
    "Service restart works in 83% of cases if done within 30 minutes of outage",
    "Memory leak requires coordination with dev team - not just ops issue",
    "Check /var/log/app-service.log before escalating",
    "After-hours incidents take 2x longer due to approval process for reboots"
  ],
  
  "similar_incident_details": [
    {
      "incident_number": "INC0010001",
      "short_description": "Server is down and not responding",
      "similar_incidents": [
        {
          "number": "INC0010203",
          "short_description": "Application server unresponsive",
          "similarity_score": 0.92,
          "state": "7",
          "resolved_at": "2026-02-15 14:30:00",
          "work_notes_summary": "Restarted app-service, confirmed server responding. Root cause: memory leak in caching module. Resolution: service restart. Permanent fix: code patch deployed.",
          "work_notes_count": 5,
          "has_workaround": true
        },
        {
          "number": "INC0010445",
          "short_description": "Server timeout - no response from application",
          "similarity_score": 0.89,
          "state": "6",
          "resolved_at": "2026-02-18 10:15:00",
          "work_notes_summary": "Issue: server not responding. Action: attempted service restart via systemctl. Result: successful. Server back online in 8 minutes.",
          "work_notes_count": 3,
          "has_workaround": true
        }
      ],
      "resolved_count": 6
    }
  ]
}
```

### Error Response

```json
{
  "error": "Could not find similar incidents for any context incident",
  "context_incidents": ["INC0010001"],
  "similar_incidents_found": 0
}
```

### No Resolved Incidents Found

```json
{
  "context_incidents": ["INC0010001"],
  "similar_incidents_found": 5,
  "resolved_incidents_analyzed": 0,
  "message": "No resolved similar incidents found. Try including active incidents or expanding search criteria."
}
```

---

## Usage Examples

### Example 1: Single Incident - Find Solutions

**Query:** "What are the workarounds for INC0010001?"

**Tool Call:**
```python
find_resolutions_from_similar_incidents_tool(
    incident_numbers=["INC0010001"],
    max_similar_per_incident=5,
    include_active_incidents=False
)
```

**LLM Response to User:**
> "Based on analysis of 6 resolved similar incidents:
> 
> **Top Recommended Solutions:**
> 1. **Restart application service** (worked in 5/6 cases)
>    - Command: `systemctl restart app-service`
>    - Average resolution time: 10-15 minutes
> 
> 2. **Check memory usage** (needed in 2 cases)
>    - If memory > 90%, server reboot required
>    - Coordinate with engineering for memory leak fix
> 
> **Key Insight:** Act within 30 minutes for best results. Restart works 83% of the time if done early."

---

### Example 2: Multiple Context Incidents

**Query:** "I have 3 authentication failures: INC001, INC002, INC003. What worked for similar auth issues?"

**Tool Call:**
```python
find_resolutions_from_similar_incidents_tool(
    incident_numbers=["INC001", "INC002", "INC003"],
    max_similar_per_incident=5,
    include_active_incidents=False
)
```

**Result:**
- Finds up to 15 similar resolved incidents (5 per context incident)
- Extracts authentication-related resolutions
- Returns patterns like: "Reset LDAP cache (8 incidents)", "Sync AD credentials (5 incidents)"

---

### Example 3: Include Active Incidents for Context

**Query:** "Show me both resolved and active similar incidents so I understand the current landscape"

**Tool Call:**
```python
find_resolutions_from_similar_incidents_tool(
    incident_numbers=["INC0010001"],
    max_similar_per_incident=5,
    include_active_incidents=True  # ← Include unresolved
)
```

**Result:**
- Shows resolved incidents with solutions (for learning)
- Shows active incidents (to see if others are experiencing same issue now)
- User can coordinate with teams working on active similar incidents

---

## Integration with Embedding Cache

### Cache Optimization

This tool leverages the **fixed incident embedding cache** for optimal performance:

**Before Cache Fix:**
- ~100 API calls per similarity search
- Regenerated embeddings every time

**After Cache Fix + This Tool:**
- ~0-5 API calls per similarity search
- Reuses 79+ cached incident embeddings
- Only generates embeddings for:
  1. New incidents not in cache
  2. Query text (user's context incident description)

**Cost Impact:**
```
Single context incident:
- Fetch incident details: 1 API call
- Find similar (5 results): 0-1 API calls (cache hit!)
- Fetch resolved incident details: 5 API calls
- Get work notes: 5 API calls
- LLM analysis: 1 API call
Total: ~13 API calls (vs 106 without cache!)

Savings: 88% reduction in API calls
```

---

## Differences from `analyze_bulk_work_notes`

### `analyze_bulk_work_notes` (Existing Tool)

**Purpose:** Analyze EXACT incidents provided
```
Input: [INC001, INC002, INC003]
Output: Patterns/themes within THESE 3 incidents
```

**Use When:**
- User has specific incidents and wants aggregate analysis
- "Summarize these 10 incidents"
- "What are common themes in my backlog?"

**Does NOT:**
- Find similar incidents
- Look at external resolutions
- Learn from other teams' solutions

---

### `find_resolutions_from_similar_incidents` (NEW Tool)

**Purpose:** Find similar incidents and learn from their resolutions
```
Input: [INC001] (context incident - my current problem)
Output: Resolutions from similar RESOLVED incidents
```

**Use When:**
- User wants to know what worked for similar problems
- "How did others fix this?"
- "What are the workarounds for incidents like mine?"
- "Show me successful resolutions for similar issues"

**DOES:**
- Find similar incidents via embedding search
- Filter for resolved incidents only
- Extract workarounds/solutions from similar cases
- Recommend actions based on what worked elsewhere

---

## Query Patterns (for Orchestrator)

### When to Use `find_resolutions_from_similar_incidents`

Trigger on these user query patterns:

1. **"What worked for similar incidents?"**
2. **"How were similar [problem type] resolved?"**
3. **"Show me resolutions from similar cases"**
4. **"What are the workarounds for incidents like [INC]?"**
5. **"What did teams do to fix similar [issue]?"**
6. **"Find solutions that worked for similar [description]"**
7. **"How did others resolve [problem]?"**

### When to Use `analyze_bulk_work_notes`

Trigger on these patterns:

1. **"Summarize these [N] incidents"** (N > 5)
2. **"What are the patterns in these incidents?"**
3. **"Classify these incidents by category"**
4. **"Overall summary of my backlog"**

---

## Performance Considerations

### Parallel Execution

- Uses `ThreadPoolExecutor` with `max_concurrent=10`
- Parallel similarity searches for multiple context incidents
- Parallel work notes fetching for similar incidents

### Rate Limiting

- `max_concurrent=10` prevents API throttling
- can be adjusted based on ServiceNow instance limits

### Context Limits

- Max 20 context incidents (prevents excessive API calls)
- Max 5 similar incidents per context (total 100 similar incidents max)
- LLM analysis limited to 30 similar incident summaries (context window constraints)

### Sampling

No explicit sampling in this tool, but:
- `max_similar_per_incident` controls breadth
- LLM analysis uses first 30 resolved summaries (best match by similarity score)

---

## Testing

### Test Script

**File:** `backend/test_resolution_finder.py`

**Run:**
```bash
cd backend
python test_resolution_finder.py
```

**What it tests:**
1. Similarity search for context incident
2. Filtering for resolved incidents
3. Work notes extraction
4. Resolution pattern aggregation
5. Recommendation generation

**Expected Output:**
```
📊 Results:
   Context incidents analyzed: 1
   Similar incidents found: 8
   Resolved incidents analyzed: 6

✅ Resolution Patterns Found: 5
   1. Restart application service
      Type: manual_action
      Used in: 5 incident(s)
      Frequency: 5

🎯 Recommended Actions (Top 3):
   1. Attempt service restart: systemctl restart app-service
      Type: immediate
      Why: Used in 5/8 similar incidents (62.5%), all successful
```

---

## Logging

### Log Markers

All log messages prefixed with `[find_resolutions_similar]` for easy filtering:

```python
logger.info(f"[find_resolutions_similar] Starting | context_incidents={len(incident_numbers)}")
logger.info(f"[find_resolutions_similar] Processed {len(context_results)} context incidents")
logger.info(f"[find_resolutions_similar] Found {len(all_similar_incidents)} total similar incidents")
logger.info(f"[find_resolutions_similar] Completed | patterns={len(result['resolution_patterns'])}")
```

### Monitoring Queries

**Find resolution finder execution:**
```bash
grep "\[find_resolutions_similar\]" backend/agentic_orchestrator_auto.log
```

**Check performance:**
```bash
grep "\[find_resolutions_similar\] Completed" backend/agentic_orchestrator_auto.log | tail -20
```

---

## Implementation Summary

### Files Modified

1. **`backend/components/servicenowgenaitool.py`**
   - Added `find_resolutions_from_similar_incidents_core()` (lines 1203-1485)
   - Implements full workflow: similarity search → filter resolved → extract resolutions → aggregate

2. **`backend/components/snowaaonetool.py`**
   - Added import for new function
   - Registered tool: `find_resolutions_from_similar_incidents_tool`
   - Added to `snow_tools` dictionary

### Files Created

1. **`backend/test_resolution_finder.py`**
   - Test script demonstrating usage
   - Shows expected output format

2. **`backend/RESOLUTION_FINDER_IMPLEMENTATION.md`** (this file)
   - Complete documentation
   - API reference, examples, integration guide

---

## Future Enhancements

### Potential Improvements

1. **Success Rate Tracking:**
   - Track which solutions have highest success rate
   - Weight recommendations by empirical success data

2. **Time-Based Filtering:**
   - Only consider resolutions from last 6 months (more relevant)
   - Exclude outdated workarounds

3. **Team/Group Context:**
   - Prioritize solutions from user's own team
   - Learn from domain experts

4. **Machine Learning:**
   - Train model to predict best solution based on incident characteristics
   - Improve recommendation ranking

5. **Resolution Knowledge Base:**
   - Build persistent knowledge base of solution patterns
   - Enable "solution search" across all historical resolutions

---

## Comparison: Before vs After

### Before (User Workflow)

```
1. User: "What worked for incidents like INC0010001?"
2. System: Analyzes INC0010001 work notes only
3. Response: "INC0010001 has 3 work notes, problem described as server outage"
4. User: "No, I mean what did OTHER teams do for similar issues?"
5. NEW QUERY: "Find similar incidents to INC0010001"
6. System: Returns list of similar incidents
7. User: "Now analyze those for resolutions"
8. Manual iteration required
```

**Result:** 3+ queries, user must manually orchestrate workflow

---

### After (Automated Workflow)

```
1. User: "What worked for incidents like INC0010001?"
2. System: Automatically:
   - Finds similar incidents using embeddings
   - Filters for resolved incidents
   - Extracts workarounds/solutions
   - Aggregates patterns
   - Ranks recommendations
3. Response: "5 similar incidents were resolved by restarting the service. 
   Recommended action: systemctl restart app-service (works 83% of time)"
```

**Result:** Single query, complete answer with actionable recommendations

---

## Key Benefits

1. **Automated Discovery:** Finds relevant solutions without manual search
2. **Empirical Recommendations:** Based on what actually worked, not generic advice
3. **Cache-Optimized:** Leverages fixed embedding cache (90% API call reduction)
4. **Ranked Actions:** Prioritizes by frequency, similarity, and success rate
5. **Context-Aware:** Uses multiple context incidents for comprehensive analysis
6. **Time-Saving:** Reduces resolution time by surfacing proven solutions immediately

---

## Summary

**Tool:** `find_resolutions_from_similar_incidents`

**Purpose:** Answer "What worked for similar problems?" by finding similar resolved incidents and extracting their solutions

**Key Innovation:** Combines similarity search (with cached embeddings!) + work notes analysis + resolution pattern extraction in single workflow

**User Benefit:** Get actionable recommendations based on empirical data from similar cases, dramatically reducing time to resolution

**Performance:** 88% reduction in API calls compared to uncached approach, parallel execution for speed

**Integration:** Registered in tool registry, available to orchestrator, works with existing work notes and similarity search infrastructure
