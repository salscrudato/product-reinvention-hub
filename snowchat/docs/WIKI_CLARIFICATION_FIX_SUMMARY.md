# Wiki Clarification State Persistence Fix

**Date:** January 20, 2026  
**Issue:** Wiki RAG clarification responses lost original question context  
**Status:** ✅ FIXED

## Problem Description

When users asked wiki questions with `@wiki` annotation that triggered the clarification engine, the system would ask for clarification (e.g., "What aspect? Requirements, Troubleshooting, etc."). However, when the user responded with their choice, the **original question context was completely lost**.

### Example of the Bug

**User Query:** "What are the coverage limits related rules for NJ insurance on @wiki?"

**System Response:** Clarification needed - select category:
1. Configuration & Setup
2. Troubleshooting
3. Requirements & Specifications ← User selects this
4. ...

**User Response:** "It is Requirements and Specifications related information"

**Backend Action (WRONG):** Executed `wiki_rag_tool(question="Requirements and Specifications related information")`
- ❌ Lost "coverage limits related rules for NJ insurance"
- ❌ Searched for generic phrase with no context
- ❌ Returned: "I do not have that information"

**Expected Action:** Execute `wiki_rag_tool(question="What are the coverage limits related rules for NJ insurance? [Focus: Requirements and Specifications]")`

## Root Cause

### Backend Architecture (Correct)

The backend `wiki_clarification_engine.py` has a complete workflow:

1. **Clarification Request:** System generates `wiki_clarification_state_id` (e.g., `"wiki_clarify_20260120_202458_990561"`)
2. **State Storage:** Stores original question + analysis in `WikiClarificationEngine.state_storage`
3. **Clarification Response Handler:** `process_clarification_response(state_id, user_response)` method:
   - Retrieves original question from state
   - Combines: `{original_question} [Focus: {keywords}] [User clarification: {user_response}]`
   - Returns refined query with full context preserved

The backend code at [langgraph_flow.py:323-343](c:\dev\snowchat\backend\components\langgraph_flow.py#L323-L343) checks for the state ID:

```python
wiki_state_id = metadata.get('wiki_clarification_state_id')

if wiki_state_id:
    # User is responding to clarification - process and execute refined Wiki RAG
    engine = get_wiki_clarification_engine()
    refined = engine.process_clarification_response(wiki_state_id, question)
    
    # Execute wiki_rag_tool with refined query preserving original context
    command.function_sequence = [{
        "function_name": "wiki_rag_tool",
        "arguments": {
            "question": refined['refined_question'],  # ← Original + clarification combined!
            "correlation_context": refined['correlation_context'],
            "search_keywords": refined['search_keywords']
        }
    }]
```

### Frontend Bug (Fixed)

The frontend components (`DevCopilot.jsx` and `SnowChat.jsx`) were:

1. ✅ Receiving `wiki_clarification_state_id` in response metadata
2. ❌ **NOT storing it in React state**
3. ❌ **NOT including it in the next request metadata**

**Log Evidence:**

```json
// Response at 20:24:58 - Backend sends state ID
{
  "metadata": {
    "awaiting_wiki_clarification": true,
    "wiki_clarification_state_id": "wiki_clarify_20260120_202458_990561"
  }
}

// Next request at 20:25:20 - Frontend doesn't send it back
{
  "metadata": {
    "persona": "product_owner"  // ← Missing wiki_clarification_state_id!
  }
}
```

Result: Backend thinks it's a new query, not a clarification response, so it never calls `process_clarification_response()`.

## Solution Implemented

### Changes to DevCopilot.jsx

**File:** `c:\dev\snowchat\frontend\src\DevCopilot.jsx`

1. **Added state variable** to track active clarification:
```javascript
const [activeWikiClarificationStateId, setActiveWikiClarificationStateId] = useState(null);
```

2. **Modified request builder** to include state ID in metadata:
```javascript
// Build metadata with wiki clarification state if active
const requestMetadata = { persona };
if (activeWikiClarificationStateId) {
  requestMetadata.wiki_clarification_state_id = activeWikiClarificationStateId;
  console.log('[DevCopilot] Including wiki_clarification_state_id in request:', activeWikiClarificationStateId);
}

response = await axios.post('http://localhost:5000/agentic_orchestrate_auto', {
  messages: [...],
  metadata: requestMetadata,  // ← Now includes state ID
  ...
});
```

3. **Added response handler** to extract and store state ID:
```javascript
// Extract wiki clarification state ID from response metadata
if (response.data.metadata && response.data.metadata.awaiting_wiki_clarification) {
  const stateId = response.data.metadata.wiki_clarification_state_id;
  setActiveWikiClarificationStateId(stateId);
  console.log('[DevCopilot] Wiki clarification active, state_id:', stateId);
} else {
  // Clear state ID after clarification is resolved
  if (activeWikiClarificationStateId) {
    console.log('[DevCopilot] Wiki clarification resolved, clearing state_id');
    setActiveWikiClarificationStateId(null);
  }
}
```

### Changes to SnowChat.jsx

**File:** `c:\dev\snowchat\frontend\src\SnowChat.jsx`

Applied identical fixes:
- Added `activeWikiClarificationStateId` state variable
- Included state ID in request metadata
- Extracted and stored state ID from response

## Testing Instructions

### Test Case 1: Wiki Clarification Flow

1. **Start backend and frontend:**
   ```powershell
   cd c:\dev\snowchat
   .\start-all.ps1 -Quick -NoKeycloak
   ```

2. **Ask ambiguous wiki question:**
   ```
   User: "What are the coverage limits related rules for NJ insurance on @wiki?"
   ```

3. **Expected: System asks for clarification:**
   ```
   System: "I can search the Wiki for documentation related to INC0010001, INC0010004.
   
   What aspect would you like me to focus on?
   1. Configuration & Setup Procedures
   2. Troubleshooting & Error Resolution
   3. Architecture & Design Documentation
   4. Requirements & Specifications  ← 
   5. Best Practices & Guidelines
   6. Other (please specify)
   ```

4. **Respond with category:**
   ```
   User: "Requirements and Specifications" or "4"
   ```

5. **Verify in browser console:**
   ```
   [DevCopilot] Including wiki_clarification_state_id in request: wiki_clarify_YYYYMMDD_HHMMSS_NNNNNN
   ```

6. **Verify in backend log:**
   ```
   [WIKI_FLOW] Processing clarification response | state_id=wiki_clarify_YYYYMMDD_HHMMSS_NNNNNN
   [WIKI_FLOW] Executing refined Wiki RAG | keywords=[...]
   [WikiRAG] perform_wiki_rag invoked | question_preview='What are the coverage limits related rules for NJ insurance? [Focus: requirements]...'
   ```

7. **Expected: Wiki RAG executes with combined context**
   - ✅ Searches for "coverage limits related rules for NJ insurance" + "Requirements and Specifications"
   - ✅ Returns relevant results (or "No information found" if wiki doesn't have it)
   - ❌ Does NOT return "Requirements and Specifications related information" alone

### Test Case 2: Non-Clarification Wiki Query

1. **Ask specific wiki question:**
   ```
   User: "Show me the troubleshooting guide for APS vendor assignment errors on @wiki"
   ```

2. **Expected: Direct execution (no clarification needed)**
   - clarity_score >= 0.5
   - Executes `wiki_rag_tool` immediately
   - No state ID created or stored

3. **Verify console shows NO state ID:**
   ```
   [DevCopilot] Sending request to /agentic_orchestrate_auto
   // metadata should only have { persona: "..." }
   ```

### Test Case 3: State Cleanup

1. Complete a clarification flow (Test Case 1)
2. **Ask unrelated question:**
   ```
   User: "What is the status of incident INC0010001?"
   ```
3. **Verify state ID is cleared:**
   ```
   [DevCopilot] Wiki clarification resolved, clearing state_id
   ```
4. **Verify next request has NO state ID in metadata**

## Verification Checklist

- [x] Frontend stores `wiki_clarification_state_id` in React state
- [x] Frontend includes state ID in request metadata when active
- [x] Frontend extracts state ID from backend response
- [x] Frontend clears state ID after clarification completes
- [x] Backend receives state ID and calls `process_clarification_response()`
- [x] Backend combines original question with clarification
- [x] Wiki RAG searches with full context preserved
- [x] Console logging for debugging state transitions
- [x] Applied to both DevCopilot.jsx and SnowChat.jsx components

## Impact

**Before Fix:**
- Wiki clarification responses lost all original context
- Users received "I do not have that information" for valid queries
- Clarification flow was effectively broken/useless

**After Fix:**
- Wiki clarification responses preserve original question
- System searches with combined context: original query + user's clarification choice
- Clarification flow works as designed per backend architecture

## Related Files

- **Backend (No changes needed - already correct):**
  - `backend/components/wiki_clarification_engine.py` - State management and response processing
  - `backend/components/langgraph_flow.py` - Annotation routing and clarification detection
  - `backend/components/CustomWikiRAG.py` - FAISS-based wiki search

- **Frontend (Fixed):**
  - `frontend/src/DevCopilot.jsx` - Main chat interface (Product Owner/Developer personas)
  - `frontend/src/SnowChat.jsx` - Legacy chat widget

- **Documentation:**
  - `WIKI_CLARIFICATION_FIX_SUMMARY.md` - This file

## Design Notes

The backend's clarification architecture is **stateful by design**:
- State is stored in-memory in `WikiClarificationEngine.state_storage`
- State ID is a timestamp-based unique identifier
- State is automatically cleaned up after processing via `del self.state_storage[state_id]`

For production systems with multiple backend instances:
- Consider moving state to Redis or shared cache
- Add expiration/TTL for abandoned clarification sessions
- Implement state persistence across backend restarts

Current implementation is sufficient for single-instance dev/test environments.
