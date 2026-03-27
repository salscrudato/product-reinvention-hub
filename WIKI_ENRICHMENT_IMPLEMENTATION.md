# Wiki Knowledge Enrichment Implementation Summary
## Option B: Smart Preprocessor

**Date:** March 9, 2026  
**Feature:** Wiki serves as knowledge enrichment layer for ServiceNow/JIRA queries  
**Status:** ✅ Implemented, Ready for Testing

---

## Problem Statement

### Original Issue (From Logs: 2026-03-09 22:34:47)

**User Query:**
```
"Can you review @wiki MIB Requirement generation rules and find out 
if any incident related to MIB Requirement and what was the root cause?"
```

**What User Expected:**
1. Search wiki for MIB Requirement rules
2. Extract key concepts (beneficiary conflicts, NIGO status, APS requirements)
3. Query ServiceNow incidents for MIB-related issues
4. Cross-reference: "INC0010002 matches wiki Rule 1 (beneficiary missing)"

**What Actually Happened:**
1. ❌ System detected `@wiki` annotation
2. ❌ **Bypassed planner entirely** (hard-coded wiki-only path)
3. ❌ Only executed `wiki_rag_tool`
4. ❌ Returned wiki documentation text (not ServiceNow incidents)
5. ❌ User got: "Rule 2: MIB Conflict Resolution..." (just wiki content)

### Root Cause

**File:** `agentic_orchestrator_auto.py` line 1040  
**Code:**
```python
if metadata.get("annotation") in ("@wiki", ...):
    logger.info(f"[_build_or_fetch_recipe_plan] Skipping recipe due to annotation: @wiki")
    return self.plan_tools(question, prompt, metadata, username), False
    # ❌ Bypassed planner - only wiki_rag_tool executed
```

---

## Solution: Smart Preprocessor (Option B)

### Architecture

```
User: "@wiki MIB rules and find related incidents"
  │
  ├─ Step 1: Detect multi-tool pattern ("and find incident")
  │          ✓ Pattern detected
  │
  ├─ Step 2: Execute wiki_rag_tool FIRST
  │          Wiki Result: "MIB errors occur when beneficiary missing, 
  │                        NIGO status triggered, APS required..."
  │
  ├─ Step 3: Extract keywords using LLM
  │          Keywords: [beneficiary, NIGO status, APS, MIB codes]
  │          ⚠️ FALLBACK: If LLM extraction fails, still continue
  │
  ├─ Step 4: Enhance question (if keywords extracted)
  │          Enhanced: "@wiki MIB rules and find incidents 
  │                    [Wiki knowledge keywords: beneficiary, NIGO status, APS]"
  │          OR (fallback): Use original question but still enable multi-tool
  │
  ├─ Step 5: Set metadata flags
  │          metadata['wiki_enrichment_applied'] = True  ✅ Always set if wiki succeeded
  │          metadata['wiki_knowledge_keywords'] = [...] (if keywords extracted)
  │          metadata['wiki_result_preview'] = "..." (first 500 chars)
  │          metadata['wiki_enrichment_mode'] = 'fallback' (if keyword extraction failed)
  │
  ├─ Step 6: Planner sees enhanced question (NOT bypassed)
  │          Generates: [wiki_rag_tool, run_incident_query]
  │          ✓ Bypassed ONLY if enrichment flag NOT set
  │
  ├─ Step 7: run_incident_query uses keywords or full wiki context
  │          Query: "short_descriptionLIKEMIB^short_descriptionLIKEbeneficiary^..."
  │
  └─ Step 8: Final synthesis
             "Found 3 incidents related to MIB requirements:
              - INC0010002 (beneficiary missing) matches wiki Rule 1
              - INC0010058 (NIGO status) matches wiki Rule 2..."
```

### Resilience Features

**Fallback Mode (NEW - 2026-03-09 23:15):**
- If LLM keyword extraction fails, enrichment STILL APPLIED
- Rationale: We have wiki knowledge + detected multi-tool intent
- Planner can use full wiki content from `metadata['wiki_result_preview']`
- Prevents silent failure back to wiki-only behavior
- Logs: `WIKI_ENRICH_FALLBACK` marker in logs

---

## Implementation Details

### 1. Import Added (Line ~197)

```python
try:  # Wiki knowledge enrichment preprocessor (Option B implementation)
    from .CustomWikiRAG import perform_wiki_rag
    WIKI_RAG_AVAILABLE = True
except Exception:
    perform_wiki_rag = lambda *a, **k: {"summary": {"answer": "", "correlation_applied": False}}
    WIKI_RAG_AVAILABLE = False
```

### 2. New Methods Created

#### `_extract_keywords_from_wiki_output(wiki_result)` (Line ~887)
- Extracts 5-8 key search terms from wiki content
- Uses LLM to identify: technical terms, error codes, requirements, processes
- Filters invalid terms (too short < 3 chars, too long > 50 chars)
- Returns list of keywords for query enhancement

**Example:**
```python
wiki_result = {"summary": {"answer": "MIB errors when beneficiary missing..."}}
keywords = self._extract_keywords_from_wiki_output(wiki_result)
# Returns: ["beneficiary information", "NIGO status", "MIB codes", "APS requirement"]
```

#### `_preprocess_wiki_enrichment(question, metadata)` (Line ~923)
- Detects multi-tool patterns in @wiki queries
- Patterns detected:
  - `"find incident"`, `"related incident"`, `"any incident"`
  - `"find jira"`, `"check jira"`, `"review jira"`
  - `"and find"`, `"and check"`, `"and review"`, `"and analyze"`
  - `"then find"`, `"then check"`
  - `"what was the root cause"`, `"root cause"`

- Executes wiki RAG first if multi-tool pattern found
- Extracts wiki topic from question: `"@wiki MIB rules and find incidents"` → `"MIB rules"`
- Calls `perform_wiki_rag(topic)`
- Extracts keywords
- Enhances question: `original + " [Wiki knowledge keywords: ...]"`
- Sets metadata flags

**Example:**
```python
question = "@wiki MIB rules and find incidents"
enhanced_q, wiki_result = self._preprocess_wiki_enrichment(question, metadata)
# enhanced_q: "@wiki MIB rules and find incidents [Wiki knowledge keywords: beneficiary, NIGO]"
# metadata['wiki_enrichment_applied'] = True
```

### 3. Recipe Bypass Modified (Line ~1040)

**Before:**
```python
if metadata.get("annotation") in ("@wiki", ...):
    # Always bypass - wiki-only
    return self.plan_tools(question, prompt, metadata, username), False
```

**After:**
```python
annotation = metadata.get("annotation")
if annotation in ("@wiki", "@code", "@mapping", "@checkpref"):
    # Check if wiki enrichment was applied
    if annotation == "@wiki" and metadata.get("wiki_enrichment_applied"):
        # Enrichment applied - let planner handle multi-tool orchestration
        logger.info("[_build_or_fetch_recipe_plan] Wiki enrichment applied - proceeding to planner")
        # Continue to recipe/planner
    else:
        # No enrichment - still bypass for wiki-only queries
        logger.info(f"[_build_or_fetch_recipe_plan] Skipping recipe due to annotation: {annotation}")
        return self.plan_tools(question, prompt, metadata, username), False
```

### 4. Integrated into solve() Pipeline (Line ~2305)

```python
# After similarity shortcut checks, before planning
if metadata.get("annotation") == "@wiki":
    enhanced_question, wiki_preprocessed_result = self._preprocess_wiki_enrichment(question or "", metadata)
    if enhanced_question != question:
        question = enhanced_question
        self._log_flow('WIKI_ENRICH_APPLIED', 'Question enhanced with wiki knowledge',
                      original_len=len(original_question or ""),
                      enhanced_len=len(question or ""))
```

---

## Logging & Diagnostics

### New Log Markers

**FLOW[WIKI_ENRICH_START]** - Multi-tool pattern detected, preprocessing begins
```
2026-03-09 HH:MM:SS INFO: FLOW[WIKI_ENRICH_START] Multi-tool query detected - executing wiki first for knowledge enrichment | {"question": "@wiki MIB rules and find..."}
```

**FLOW[WIKI_ENRICH_QUERY]** - Executing wiki RAG with extracted topic
```
FLOW[WIKI_ENRICH_QUERY] Executing wiki RAG for topic: MIB Requirement generation rules
```

**FLOW[WIKI_ENRICH_COMPLETE]** - Keywords extracted and injected
```
FLOW[WIKI_ENRICH_COMPLETE] Wiki knowledge extracted and injected into query | {"keywords_count": 5, "keywords": ["beneficiary", "NIGO", "MIB codes", "APS", "Medical underwriting"]}
```

**FLOW[WIKI_ENRICH_APPLIED]** - Question enhancement applied
```
FLOW[WIKI_ENRICH_APPLIED] Question enhanced with wiki knowledge | {"original_len": 82, "enhanced_len": 165}
```

**FLOW[WIKI_ENRICH_NO_KEYWORDS]** - Extraction failed (no keywords found)
```
FLOW[WIKI_ENRICH_NO_KEYWORDS] No keywords extracted from wiki - using original question
```

**FLOW[WIKI_ENRICH_ERROR]** - Exception occurred during preprocessing
```
FLOW[WIKI_ENRICH_ERROR] Wiki enrichment failed: Exception message
```

---

## Testing

### Automated Tests (pytest)

**File:** `backend/tests/test_wiki_enrichment.py`  
**Test Count:** 15 test cases

**Run tests:**
```bash
cd C:\dev\snowchat\backend
pytest tests/test_wiki_enrichment.py -v
```

**Test coverage:**
- ✓ Multi-tool pattern detection (4 tests)
- ✓ Keyword extraction and filtering (3 tests)
- ✓ Question enhancement (2 tests)
- ✓ Exception handling (1 test)
- ✓ Integration with planner (3 tests)
- ✓ Real user query scenarios (2 tests)

### Manual Test Script

**File:** `backend/test_wiki_enrichment_manual.py`

**Run manual tests:**
```bash
cd C:\dev\snowchat\backend
python test_wiki_enrichment_manual.py
```

**Demonstrates:**
1. Pattern detection logic
2. Keyword extraction flow
3. Question enhancement
4. Metadata flags
5. Real user query analysis
6. Bypass logic changes

---

## Test Queries

### ✅ Queries That Will Be Enriched

1. **ServiceNow Incident Search**
   ```
   "@wiki MIB Requirement generation rules and find out if any incident related to MIB Requirement"
   ```
   - Pattern: `"and find"` + `"any incident"`
   - Action: Extract wiki knowledge → enhance incident query

2. **JIRA User Story Analysis**
   ```
   "Review @wiki session management best practices and check JIRA story IN-4"
   ```
   - Pattern: `"and check"` + `"jira"`
   - Action: Extract wiki standards → compare with JIRA story

3. **Root Cause Investigation**
   ```
   "@wiki deployment process and find incidents with root cause analysis"
   ```
   - Pattern: `"and find incident"` + `"root cause"`
   - Action: Extract process knowledge → find related incidents

### ❌ Queries That Will NOT Be Enriched (Normal Wiki-Only Path)

1. **Pure Wiki Query**
   ```
   "What are the @wiki MIB Requirement rules?"
   ```
   - No multi-tool pattern detected
   - Handled by normal wiki-only path

2. **Wiki Documentation Request**
   ```
   "@wiki Show me the deployment checklist"
   ```
   - No multi-tool indicators
   - Direct wiki search only

---

## Restart & Validation

### 1. Restart Backend

**PowerShell:**
```powershell
# Stop current backend (Ctrl+C in Python Debug Console)

# Start backend
cd C:\dev\snowchat\backend
python app.py
```

### 2. Test with Frontend

**Query to test:**
```
Can you review @wiki MIB Requirement generation rules and find out if any incident related to MIB Requirement and what was the root cause?
```

### 3. Check Logs

**File:** `backend/agentic_orchestrator_auto.log`

**Look for:**
```
FLOW[WIKI_ENRICH_START] Multi-tool query detected
FLOW[WIKI_ENRICH_QUERY] Executing wiki RAG for topic: MIB Requirement generation rules
FLOW[WIKI_ENRICH_COMPLETE] Wiki knowledge extracted | keywords_count=5
FLOW[WIKI_ENRICH_APPLIED] Question enhanced
FLOW[PLAN] Planner completed | plan_steps=2 (should be 2: wiki + incident query)
```

### 4. Verify Results

**Expected response format:**
```
Based on wiki documentation, MIB Requirement errors occur when:
- Primary beneficiary information is missing (Rule 1)
- MIB codes conflict with application disclosure (Rule 2)

Found 3 related ServiceNow incidents:

1. INC0010002 - "PAS - Primary Beneficiary Information Missing NIGO"
   → Matches wiki Rule 1 (beneficiary validation)
   Root Cause: Missing beneficiary details in Term Life application

2. INC0010058 - "PAS - Policy in NIGO with no clear reason"
   → Matches wiki Rule 2 (MIB conflict)
   Root Cause: [work notes analysis]

3. INC0010007 - "PAS - Unable to update Banking Information NIGO"
   → Related to Rule 3 (state requirements)
   Root Cause: [work notes analysis]
```

---

## Success Metrics

### ✅ Implementation Complete
- [x] Import CustomWikiRAG
- [x] Create `_extract_keywords_from_wiki_output()`
- [x] Create `_preprocess_wiki_enrichment()`
- [x] Modify recipe bypass logic
- [x] Integrate into solve() pipeline
- [x] Add comprehensive logging
- [x] Create 15 automated tests
- [x] Create manual test script

### 🎯 Validation Criteria
- [ ] Backend restarts without errors
- [ ] Manual test script runs successfully
- [ ] pytest suite passes (15/15 tests)
- [ ] Real user query from logs now works
- [ ] Logs show enrichment markers
- [ ] Final answer includes wiki context + incident correlation

---

## Rollback Plan (If Needed)

If issues occur, revert these changes:

1. **Remove import** (line ~197):
   ```python
   # DELETE THIS BLOCK
   try:
       from .CustomWikiRAG import perform_wiki_rag
       WIKI_RAG_AVAILABLE = True
   except:
       perform_wiki_rag = lambda *a, **k: {...}
       WIKI_RAG_AVAILABLE = False
   ```

2. **Remove methods** (lines ~887-1020):
   ```python
   # DELETE _extract_keywords_from_wiki_output()
   # DELETE _preprocess_wiki_enrichment()
   ```

3. **Revert bypass logic** (line ~1040):
   ```python
   # REVERT TO ORIGINAL
   if metadata.get("annotation") in ("@wiki", ...):
       logger.info(f"Skipping recipe due to annotation: {metadata.get('annotation')}")
       return self.plan_tools(question, prompt, metadata, username), False
   ```

4. **Remove solve() integration** (line ~2305):
   ```python
   # DELETE THIS BLOCK
   if metadata.get("annotation") == "@wiki":
       enhanced_question, wiki_preprocessed_result = ...
   ```

---

## Future Enhancements (Out of Scope)

### Option C: Full Orchestration (Future)
- Recipe system with output chaining
- Variable substitution: `{"sysparm_query": "{$keywords}"}`
- Conditional branching based on tool outputs
- Intermediate processing tools as first-class citizens

### Other Patterns
- `@code` + incident search (code embeddings enhance queries)
- `@mapping` + data validation (mapping rules validate incident data)
- Multi-source enrichment (wiki + code + confluence)

---

## Questions & Support

**Implemented by:** GitHub Copilot (Claude Sonnet 4.5)  
**Date:** March 9, 2026  
**Files Modified:**
- `backend/components/agentic_orchestrator_auto.py` (4 changes)

**Files Created:**
- `backend/tests/test_wiki_enrichment.py` (15 tests)
- `backend/test_wiki_enrichment_manual.py` (manual test suite)
- `WIKI_ENRICHMENT_IMPLEMENTATION.md` (this document)

---

**Ready for testing! 🚀**
