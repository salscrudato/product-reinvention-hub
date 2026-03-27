# Wiki RAG Enhancement - Implementation Summary

## Date: January 20, 2026

## Overview

Successfully enhanced the Wiki RAG system with an interactive clarification workflow that analyzes request specificity, asks contextual questions when needed, and correlates wiki findings back to the original question.

## Files Created

### 1. `components/wiki_clarification_engine.py` (540 lines)
**Purpose**: Core clarification engine with intelligent analysis and question generation

**Key Components**:
- `WikiClarificationEngine` class - Main orchestrator
- `analyze_wiki_request_clarity()` - Scores request specificity (0.0-1.0)
- `generate_clarification_questions()` - Creates context-aware options
- `process_clarification_response()` - Combines original + clarification
- `_extract_context_entities()` - Extracts incidents, topics, keywords from conversation
- Convenience functions for orchestrator integration

**Clarity Scoring Algorithm**:
- Topic detection (0.3 points): configuration, troubleshooting, procedures, etc.
- Domain keywords (0.2 points): APS, DHD, MRIO, ServiceNow terms
- Question specificity (0.3 points): "how to", action verbs, specific references
- Context correlation (0.2 points): incident references, prior conversation topics
- **Threshold**: < 0.5 = needs clarification; ≥ 0.5 = direct execution

**State Tracking**:
- In-memory session storage (unique state IDs)
- Tracks original question, analysis, options, timestamp
- Cleanup after response processing

### 2. `WIKI_CLARIFICATION_ENHANCEMENT.md` (600+ lines)
**Purpose**: Comprehensive documentation and usage guide

**Sections**:
- Architecture overview with component diagrams
- Workflow examples (3 detailed scenarios)
- Clarity scoring algorithm details
- State tracking and metadata flow
- Tool definitions and API reference
- Configuration and customization guide
- Logging patterns and troubleshooting
- Testing strategies and migration notes
- Future enhancements roadmap

### 3. `test_wiki_clarification.py` (250 lines)
**Purpose**: Automated test suite for validation

**Test Cases**:
1. Generic request analysis (clarity score < 0.3)
2. Specific request analysis (clarity score ≥ 0.5)
3. Context entity extraction (incidents, keywords)
4. Clarification question generation (6 options)
5. Clarification response processing (refined query)
6. Convenience functions for orchestrator

**Test Results**: All 6 tests passing ✓

## Files Modified

### 1. `components/CustomWikiRAG.py`
**Changes**:
- Enhanced `perform_wiki_rag()` function signature:
  - Added `correlation_context` parameter (optional)
  - Added `search_keywords` parameter (optional)
- Implemented correlation logic:
  - Uses LLM to synthesize wiki findings with clarification context
  - Addresses original question + conversation entities
  - Emphasizes search keywords in answer
  - Returns `correlation_applied` flag in response

**Impact**: Backwards compatible - existing calls work unchanged

### 2. `components/langgraph_flow.py`
**Changes**:
- Enhanced `@wiki` annotation handling (lines 313-376):
  - Imports clarification engine functions
  - Checks for `wiki_clarification_state_id` in metadata
  - If state ID present: processes clarification response → refined Wiki RAG
  - If no state ID: analyzes clarity → clarification request or direct execution
  - Marks metadata with `awaiting_wiki_clarification` flag
  - Stores state ID in metadata for next request

**Flow**:
1. User asks wiki question
2. System checks clarity
3a. High clarity (≥0.5): Direct Wiki RAG execution
3b. Low clarity (<0.5): Generate clarification request
4. User responds to clarification
5. System processes response → refined Wiki RAG with correlation

### 3. `components/snowaaonetool.py`
**Changes**:
- Updated `wiki_rag_tool()` function:
  - Added `correlation_context` parameter
  - Added `search_keywords` parameter
  - Enhanced logging with parameter presence indicators
  - Passes parameters to `perform_wiki_rag()`

- Added new `wiki_clarification_request()` function:
  - Presents clarification questions to user
  - Formats options for display
  - Returns structured response with state ID
  - Marks response as `awaiting_clarification`

**Tool Registration**: Both tools registered in `FUNCTION_REGISTRY`

## Workflow Examples

### Example 1: Generic Request
```
User: "@wiki search the wiki"

Analysis:
- Clarity score: 0.0 (very generic)
- No topics, no keywords, no context
- Decision: NEEDS CLARIFICATION

System Response:
"I can search the Wiki for relevant documentation.

What aspect would you like me to focus on?

1. Configuration & Setup Procedures
2. Troubleshooting & Error Resolution
3. Architecture & Design Documentation
4. Requirements & Specifications
5. Best Practices & Guidelines
6. Other (please specify)

Please respond with a number, your own search terms, or additional context.
[Session ID: wiki_clarify_20260120_110602_684976]"

User: "2"

Refined Query:
"@wiki search the wiki [Focus: Troubleshooting & Error Resolution] [User clarification: 2]"

Result: Targeted wiki search for troubleshooting documentation
```

### Example 2: Context-Aware Request
```
Previous Context:
- Discussed INC0010003
- Mentioned APS, DHD, MRIO terms

User: "@wiki what about this on the wiki?"

Analysis:
- Clarity score: 0.4 (moderate - has context but vague)
- Context entities: incidents=[INC0010003], terms=['aps','dhd','mrio']
- Decision: NEEDS CLARIFICATION

System Response:
"I can search the Wiki for documentation related to INC0010003.

Should I focus on specific terms like: aps, dhd, mrio? Or would you like me to search more broadly?

1. Yes, focus on aps, dhd, mrio
2. Search more broadly
3. Use different terms (please specify)"

User: "1"

Refined Query:
"@wiki what about this on the wiki? [Focus: aps, dhd, mrio] [User clarification: 1]"
Keywords: ['aps', 'dhd', 'mrio']
Correlation: Original question + INC0010003 context + keyword emphasis

Result: Wiki search for APS/DHD/MRIO documentation with answer correlated to incident
```

### Example 3: Specific Request (No Clarification)
```
User: "@wiki How to configure APS with step-by-step procedure for production?"

Analysis:
- Clarity score: 0.65 (highly specific)
- Topics: configuration, procedures
- Keywords: aps
- Specific indicators: "how to", "step-by-step", "configure"
- Decision: SUFFICIENTLY SPECIFIC

Result: Direct Wiki RAG execution (no clarification needed)
```

## Integration Points

### Backend API (`agentic_orchestrator_api.py`)
**Metadata Flow**:
- Frontend sends: `metadata.wiki_clarification_state_id` when responding to clarification
- Backend checks: State ID presence indicates clarification response
- Orchestrator: Routes to clarification processing or direct execution

**No API changes required** - uses existing metadata mechanism

### Frontend Considerations
Frontend should handle:
1. Detect `awaiting_clarification` flag in response
2. Display clarification options to user
3. Store `clarification_state_id` in session
4. Send user response with state ID in metadata

Example frontend logic:
```javascript
if (response.awaiting_clarification) {
    showClarificationUI(response.summary);
    sessionStorage.setItem('wiki_state_id', response.clarification_state_id);
} else {
    displayAnswer(response);
    sessionStorage.removeItem('wiki_state_id');
}

// When user responds
const nextRequest = {
    question: userResponse,
    metadata: {
        annotation: "@wiki",
        wiki_clarification_state_id: sessionStorage.getItem('wiki_state_id'),
        username: currentUser
    }
};
```

## Configuration

### Topic Customization
Edit `WIKI_TOPICS` dictionary in `wiki_clarification_engine.py`:
```python
WIKI_TOPICS = {
    "your_topic": ["keyword1", "keyword2", "pattern"],
    # Add new topics as needed
}
```

### Keyword Expansion
Add domain terms to `SERVICENOW_KEYWORDS`:
```python
SERVICENOW_KEYWORDS = {
    "new_acronym": "Full Term Name",
    # Expands detection and suggestions
}
```

### Threshold Adjustment
Modify clarity threshold (currently 0.5) in `analyze_wiki_request_clarity()`:
```python
needs_clarification = clarity_score < 0.5  # Adjust this value
```

## Logging & Monitoring

All events logged to `agentic_orchestrator_auto.log`:

**Key Patterns**:
- `[WIKI_CLARIFY] Analyzing request clarity` - Clarity analysis start
- `[WIKI_CLARIFY] Analysis complete | needs_clarification=True` - Decision made
- `[WIKI_CLARIFY] Generated 6 clarification options` - Questions created
- `[WIKI_CLARIFY] User selected option 1: Troubleshooting` - Response processed
- `[WikiRAG] perform_wiki_rag | has_correlation=True` - Correlated execution
- `[WikiRAG] Correlation applied successfully` - Answer synthesis complete

## Testing Results

**Test Suite**: `test_wiki_clarification.py`
- ✓ Test 1: Generic request analysis (score < 0.3)
- ✓ Test 2: Specific request analysis (score ≥ 0.5)
- ✓ Test 3: Context entity extraction (incidents, terms)
- ✓ Test 4: Clarification question generation (6 options)
- ✓ Test 5: Clarification response processing (refined query)
- ✓ Test 6: Convenience functions (should_clarify, generate_clarification)

**Result**: 6/6 tests passing (100%)

Run tests: `python backend/test_wiki_clarification.py`

## Performance Considerations

### State Storage
- **Current**: In-memory dictionary (session lost on restart)
- **Production**: Consider TinyDB persistence for session recovery
- **Cleanup**: State deleted after response processing

### Token Optimization
- Clarification reduces irrelevant wiki searches
- Correlation adds one LLM call but improves answer quality
- Overall: Better quality answers, fewer wasted tokens on irrelevant searches

### Caching
- No caching needed for clarification (fast operations)
- Wiki RAG uses existing FAISS cache
- Correlation synthesis cached by LLM provider

## Known Limitations

1. **Single Clarification Round**: System only asks once; no multi-turn refinement
2. **In-Memory State**: Lost on backend restart; sessions not persistent
3. **No Learning**: Doesn't adjust thresholds based on user feedback yet
4. **No Cancellation**: User can't cancel clarification and force direct search
5. **Fixed Threshold**: 0.5 threshold may need tuning per domain

## Future Enhancements

### Phase 2 (Planned)
1. **Multi-Level Clarification**: Allow follow-up questions if first insufficient
2. **TinyDB Persistence**: Store clarification sessions for recovery
3. **Feedback Loop**: Track which clarifications lead to best results
4. **Auto-Tuning**: Adjust clarity thresholds based on user acceptance
5. **Keyword Extraction**: Pull actual terms from FAISS index for suggestions

### Phase 3 (Advanced)
1. **Hybrid Search**: Combine keyword + semantic search with clarification
2. **Persona-Specific**: Different clarification styles for PO/Dev/Agent
3. **Template Library**: Pre-built clarification patterns per topic
4. **Analytics Dashboard**: Track clarification effectiveness metrics
5. **Voice/Chat Integration**: Natural language clarification responses

## Migration & Rollout

### Backwards Compatibility
✅ **100% backwards compatible**:
- Existing `@wiki` queries work unchanged
- High clarity questions execute directly (no UX change)
- Only low clarity questions trigger new clarification flow

### Rollout Strategy
1. **Week 1**: Deploy to dev environment, monitor logs
2. **Week 2**: A/B test with 10% of users
3. **Week 3**: Increase to 50% if metrics positive
4. **Week 4**: Full rollout if satisfaction improved

### Success Metrics
- Clarification acceptance rate (target: >70%)
- Wiki RAG relevance score (target: +20% improvement)
- User satisfaction (target: 4.5/5 stars)
- Time to answer (acceptable: +15 seconds for clarification)

## Documentation Links

- **Full Guide**: `backend/WIKI_CLARIFICATION_ENHANCEMENT.md`
- **Test Suite**: `backend/test_wiki_clarification.py`
- **Original Wiki RAG**: `backend/components/CustomWikiRAG.py`
- **Orchestrator Integration**: `backend/components/langgraph_flow.py`

## Summary

The enhanced Wiki RAG system transforms static documentation retrieval into an interactive, context-aware conversation. By analyzing request clarity and asking targeted clarification questions, the system:

✅ **Delivers more relevant documentation** through refined search queries
✅ **Reduces wasted searches** by focusing on user's actual need
✅ **Correlates findings** back to original question and conversation context
✅ **Maintains backwards compatibility** with existing wiki queries
✅ **Provides clear audit trail** through comprehensive logging

**Key Innovation**: Intelligent clarification engine that knows when to ask vs. when to execute directly, balancing thoroughness with user experience.

---

**Implementation Complete**: Ready for testing and deployment.
