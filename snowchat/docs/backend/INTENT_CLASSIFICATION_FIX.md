# Intent Classification Fix: Single Incident Context vs. Multi-Incident Search

## Problem Statement

User reported: "why did 'Can you provide the detailed root cause analysis for the incident related to the MIB requirement?' question trigger similar incidents? It is supposed to be rooted in the specific incident right?"

### Root Cause

The query was incorrectly classified as `similar_incidents` instead of `resolution_progress` due to two bugs in intent classification logic:

1. **Context Boost Override:** Entity tracking logic was executing BEFORE pattern matching, causing any query with "related to" + entity reference to shortcut to `similar_incidents` regardless of explicit intent keywords like "root cause"

2. **Pattern Order Bug:** The generic `incidents? (?:related to|about|...)` pattern was positioned BEFORE the specific `root cause|workaround|resolution` patterns, causing it to match first even when explicit investigation intents were present

## Conceptual Difference

### Single Incident Context (Should Use resolution_progress + work notes)
- **"THE incident"** (singular, definite article)
- **Focus:** Investigation, root cause, resolution steps for ONE specific incident
- **User Intent:** "Tell me about THIS particular incident's analysis"
- **Required Tools:** `summarize_work_notes`, `fetch_incident_details`
- **Example:** "What is the root cause of THE incident related to MIB?"

### Multi-Incident Search (Should Use similar_incidents)
- **"incidents"** (plural)
- **Focus:** Discovery, pattern identification across MULTIPLE incidents
- **User Intent:** "Find ALL incidents matching these criteria"
- **Required Tools:** `get_similar_incidents`, vector search, clustering
- **Example:** "Show me incidents related to MIB requirement issues"

## Technical Solution

### Fix 1: Explicit Intent Priority Check

Added explicit keyword detection BEFORE context boost logic:

**File:** `components/intent_classifier.py`  
**Lines:** 91-104

```python
# EXPLICIT INTENT KEYWORDS - Check these FIRST before context boost
explicit_intent_keywords = [
    'root cause', 'rca', 'what caused', 'why did', 'why is',  # Root cause
    'workaround', 'temporary fix', 'work around', 'bypass',   # Workarounds
    'resolution steps', 'how to resolve', 'how is being resolved',  # Resolution
    'who should', 'which team', 'suggest assignment', 'recommend assignment',  # Assignment
    'assign to', 'reassign',  # Direct assignment
]

has_explicit_intent = any(keyword in lt for keyword in explicit_intent_keywords)

# Context boost only applies if NO explicit intent keywords
if not has_explicit_intent and metadata and 'entities' in metadata:
    # ... context boost logic
```

**Impact:** Prevents entity tracking from overriding explicit user intent.

### Fix 2: Pattern Reordering

Moved resolution/investigation patterns BEFORE generic "incidents related to" pattern:

**Before (WRONG ORDER):**
```python
(r"incidents? (?:related to|about|...)", 'similar_incidents'),  # Line 38 - TOO EARLY
(r"root cause|rca|...", 'resolution_progress'),  # Line 45 - TOO LATE
```

**After (CORRECT ORDER):**
```python
(r"root cause|rca|...", 'resolution_progress'),  # Line 38 - FIRST
(r"workaround|temporary fix|...", 'resolution_progress'),  # Line 40
(r"how (?:to|is|are) (?:this|the) (?:incident|issue).*?resolv", 'resolution_progress'),  # Line 42
(r"incidents? (?:related to|about|...)", 'similar_incidents'),  # Line 47 - AFTER specific patterns
```

**Impact:** Ensures specific investigation intents match before generic search patterns.

### Fix 3: Flexible Resolution Pattern

Updated resolution pattern to allow text between "incident" and "being resolved":

**Before:**
```python
(r"how (?:to|is|are) (?:this|the) (?:incident|issue) (?:being )?resolv", 'resolution_progress')
#                                                      ^ Requires immediate adjacency
```

**After:**
```python
(r"how (?:to|is|are) (?:this|the) (?:incident|issue).*?(?:being )?resolv", 'resolution_progress')
#                                                       ^^^^ Allows intervening text
```

**Impact:** Matches queries like "How is THE incident related to MIB being resolved?" where descriptor text appears between "incident" and "being resolved".

## Test Results

```bash
python test_explicit_intent_priority.py
```

### All Tests Passing ✅

**Single Incident Context (Resolution Progress):**
- ✅ "Can you provide the detailed root cause analysis for THE incident related to the MIB requirement?"
- ✅ "What is the root cause of THE incident related to MIB?"
- ✅ "What workaround exists for THE issue related to MIB requirement?"
- ✅ "How is THE incident related to MIB being resolved?"

**Multi-Incident Search (Similar Incidents):**
- ✅ "Show me incidents related to MIB requirement"
- ✅ "Find incidents concerning MIB issues"
- ✅ "Get incidents about MIB requirement problems"

**Context Boost Still Works:**
- ✅ Context boost applies when NO explicit intent keywords present
- ✅ Pattern matching works without metadata

**Assignment Intent:**
- ✅ "Who should be assigned to THE incident related to MIB requirement?" → `assignment_prediction`

## Query Classification Decision Tree

```
┌─ Query received
│
├─ Has explicit intent keywords? (root cause, workaround, assignment, etc.)
│  └─ YES → Match specific pattern, SKIP context boost
│           ├─ "root cause" → resolution_progress (fetch work notes)
│           ├─ "workaround" → resolution_progress (fetch work notes)
│           ├─ "who should" → assignment_prediction
│           └─ "how is...resolved" → resolution_progress
│  
└─ NO explicit intent → Check patterns in order
   ├─ 1. Root cause patterns (root cause|rca|what caused)
   ├─ 2. Workaround patterns (workaround|temporary fix)
   ├─ 3. Resolution patterns (how is...resolved|steps taken)
   ├─ 4. Assignment patterns (who should|which team)
   ├─ 5. Similar incidents patterns (incidents related to)
   └─ 6. Context boost (if entities + "related"/"about")
```

## Impact on Query Execution

### Before Fix

```json
{
  "question": "Can you provide the detailed root cause analysis for THE incident related to the MIB requirement?",
  "intent": "similar_incidents",  // ❌ WRONG
  "plan": [
    {"tool": "get_similar_incidents", "args": {"incident_number": "INC0010014"}},
    {"tool": "fetch_kb_articles"}
  ]
}
```

**Result:** Returns similar incidents, does NOT fetch work notes, misses root cause documentation.

### After Fix

```json
{
  "question": "Can you provide the detailed root cause analysis for THE incident related to the MIB requirement?",
  "intent": "resolution_progress",  // ✅ CORRECT
  "plan": [
    {"tool": "fetch_incident_details", "args": {"incident_number": "INC0010014"}},
    {"tool": "summarize_work_notes", "args": {"incident_number": "INC0010014"}},
    {"tool": "fetch_kb_articles"}
  ]
}
```

**Result:** Fetches incident details + work notes, provides root cause analysis from documented investigation.

## Recipe System Impact

### resolution_progress Recipe

**Triggered by:** root cause, workaround, resolution steps queries  
**Tools Included:**
- `fetch_incident_details` - Get incident metadata
- `summarize_work_notes` - Extract investigation notes, root cause, workarounds
- `fetch_kb_articles` - Find related documentation

**Use Case:** Single incident investigation, root cause analysis, resolution tracking

### similar_incidents Recipe

**Triggered by:** "incidents related to", "find similar", "show incidents about"  
**Tools Included:**
- `get_similar_incidents` - Vector similarity search
- `fetch_kb_articles` - Pattern documentation

**Use Case:** Multi-incident discovery, pattern analysis, clustering

## Regression Prevention

### Pattern Order Requirements

When adding new intent patterns, follow this priority order:

1. **HIGHEST PRIORITY:** Explicit action intents (assignment, create, update, close)
2. **HIGH PRIORITY:** Investigation intents (root cause, workaround, resolution progress)
3. **MEDIUM PRIORITY:** Search intents (similar incidents, date filters, status queries)
4. **LOW PRIORITY:** Generic intents (incident triage, knowledge lookup)

### Context Boost Guidelines

**Always check for explicit intent keywords BEFORE applying context boost:**

```python
# ✅ CORRECT
if not has_explicit_intent and metadata:
    # Apply context boost only when safe

# ❌ WRONG
if metadata:
    # Always apply context boost (overrides explicit intents!)
```

### Pattern Testing Checklist

When adding/modifying intent patterns:

- [ ] Test with singular "THE incident" phrasing
- [ ] Test with plural "incidents" phrasing
- [ ] Test with entity references in context
- [ ] Test with "related to" / "about" / "concerning" wording
- [ ] Verify pattern position relative to other patterns
- [ ] Check for greedy matching that might consume other patterns

## Related Files

### Modified
- `backend/components/intent_classifier.py` (Lines 38-48, 91-104)

### New Test Files
- `backend/test_explicit_intent_priority.py` (Comprehensive test suite)

### Documentation
- `backend/INTENT_CLASSIFICATION_FIX.md` (This file)

## Next Steps

1. **Backend Restart Required** - Changes are code-only, no config/data updates
   ```bash
   cd C:\dev\snowchat
   python backend/app.py
   ```

2. **Validation Queries:**
   - "What is the root cause of INC0010014?" → Should fetch work notes ✅
   - "Show me incidents related to MIB requirement" → Should search similar incidents ✅
   - "How is INC0010014 being resolved?" → Should fetch work notes ✅

3. **Monitor Logs:**
   ```bash
   grep "IntentClassifier" backend/agentic_orchestrator_auto.log | tail -20
   ```
   - Should see "Explicit intent keyword detected - skipping context boost" for root cause queries
   - Should see "Matched pattern '...' -> intent 'resolution_progress'" for investigation queries

## Summary

**Problem:** Root cause queries for single incidents were incorrectly triggering multi-incident similarity search instead of work notes investigation.

**Root Cause:** 
1. Entity tracking context boost executed before pattern matching
2. Generic "incidents related to" pattern positioned before specific investigation patterns

**Solution:** 
1. Added explicit intent keyword check to block context boost when investigation intent is clear
2. Reordered patterns to prioritize investigation intents over generic search intents
3. Made resolution pattern flexible to handle descriptive text between "incident" and "resolved"

**Validation:** All 13 test cases passing, covering single/multi incident contexts, explicit intents, and context boost scenarios.

**Impact:** Single incident investigation queries now correctly fetch work notes and root cause documentation instead of performing similarity searches.
