# Enhanced Wiki RAG with Interactive Clarification

## Overview

The Wiki RAG system has been enhanced with an interactive clarification workflow that intelligently refines search queries before executing documentation retrieval. Instead of immediately performing RAG on potentially ambiguous requests, the system now:

1. **Analyzes request specificity** using context awareness
2. **Asks clarifying questions** when needed to refine search scope
3. **Processes user clarification** to build targeted queries
4. **Correlates wiki findings** back to the original question and conversation context

## Architecture

### Components

#### 1. Wiki Clarification Engine (`wiki_clarification_engine.py`)
- **Clarity Analysis**: Scores question specificity (0.0-1.0) based on:
  - Topic detection (configuration, troubleshooting, procedures, etc.)
  - Domain keywords (APS, DHD, MRIO, ServiceNow terms)
  - Question structure (how-to, step-by-step, specific error codes)
  - Context correlation (references to incidents, prior conversation)
  
- **Clarification Generation**: Creates context-aware questions with:
  - Suggested options based on conversation context
  - Keyword suggestions extracted from recent messages
  - Incident-specific focus areas
  
- **State Tracking**: Maintains clarification sessions with unique state IDs
- **Response Processing**: Combines original question + clarification into refined query

#### 2. Enhanced Wiki RAG (`CustomWikiRAG.py`)
- **New Parameters**:
  - `correlation_context`: Context from clarification workflow
  - `search_keywords`: Specific keywords to emphasize
  
- **Correlation Logic**: Uses LLM to synthesize wiki findings with:
  - Original question context
  - Clarification details
  - Conversation entities (incidents, topics)
  - Emphasized search keywords

#### 3. Orchestrator Integration (`langgraph_flow.py`)
- **Workflow States**:
  - **Direct Execution**: High clarity score (≥0.5) → immediate Wiki RAG
  - **Clarification Request**: Low clarity score (<0.5) → ask user
  - **Clarification Processing**: User responds → refined Wiki RAG
  
- **Metadata Handling**:
  - `awaiting_wiki_clarification`: Boolean flag
  - `wiki_clarification_state_id`: Session tracking
  - `context_messages`: Conversation history for analysis

## Workflow Examples

### Example 1: Ambiguous Request → Clarification → Targeted Search

**User**: `@wiki Can you check the wiki?`

**Analysis**:
- Clarity score: 0.1 (very generic)
- No topics detected
- No specific keywords
- Result: **Needs clarification**

**System Response**:
```
I can search the Wiki for relevant documentation.

What aspect would you like me to focus on?

1. Configuration & Setup Procedures
2. Troubleshooting & Error Resolution
3. Architecture & Design Documentation
4. Requirements & Specifications
5. Best Practices & Guidelines
6. Other (please specify)

Please respond with:
- A number from the options above, or
- Your own specific search terms/keywords, or
- Additional context about what you're looking for

[Session ID: wiki_clarify_20260120_143052_123456]
```

**User**: `2` (selects Troubleshooting)

**Refined Query**: 
```
Original: "@wiki Can you check the wiki?"
Clarification: "2" → Troubleshooting & Error Resolution
Refined: "@wiki Can you check the wiki? [Focus: troubleshooting] [User clarification: 2]"
```

**Result**: Targeted wiki search for troubleshooting documentation with correlation back to original request.

---

### Example 2: Context-Aware Clarification

**Previous Context**:
- User asked about INC0010003
- Work notes mentioned "APS requirement" and "DHD order"
- Discussion of "MRIO manual update"

**User**: `@wiki Do you see any data related to this on the Wiki?`

**Analysis**:
- Clarity score: 0.4 (moderate - has context but vague focus)
- Context entities: `incidents=[INC0010003]`, `mentioned_terms=['aps', 'dhd', 'mrio']`
- Result: **Needs clarification**

**System Response**:
```
I can search the Wiki for documentation related to INC0010003.

I detected you're interested in requirements documentation.

Should I focus on specific terms like: aps, dhd, mrio? Or would you like me to search more broadly?

1. Yes, focus on aps, dhd, mrio
2. Search more broadly
3. Use different terms (please specify)

Please respond with:
- A number from the options above, or
- Your own specific search terms/keywords, or
- Additional context about what you're looking for

[Session ID: wiki_clarify_20260120_143152_234567]
```

**User**: `1` (focus on APS, DHD, MRIO)

**Refined Query**:
```
Refined question: "@wiki Do you see any data related to this on the Wiki? [Focus: aps, dhd, mrio] [User clarification: 1]"
Search keywords: ['aps', 'dhd', 'mrio']
Correlation context:
  Original question: Do you see any data related to this on the Wiki?
  User clarification: 1
  Context entities: {incidents: [INC0010003], mentioned_terms: ['aps', 'dhd', 'mrio']}
  Search focus: ['aps', 'dhd', 'mrio']
```

**Correlation**: LLM synthesizes wiki findings specifically addressing:
- INC0010003 context
- APS requirement documentation
- DHD order procedures
- MRIO manual update workflow
- Connection to original question about incident data

---

### Example 3: Sufficiently Specific → Direct Execution

**User**: `@wiki How do I configure APS settings for production deployment?`

**Analysis**:
- Clarity score: 0.8 (highly specific)
- Topics: `['configuration', 'procedures']`
- Keywords: `['aps']`
- Specific indicators: "how do I configure", specific term "production deployment"
- Result: **No clarification needed**

**Action**: Direct Wiki RAG execution with original query

**Result**: Immediate search for APS configuration documentation

---

## Clarity Scoring Algorithm

### Score Components (Max 1.0)

1. **Topic Detection** (0.3 points)
   - Match against predefined topics: configuration, troubleshooting, procedures, definitions, architecture, requirements, best_practices, api_reference
   - First topic match awards 0.3

2. **Domain Keywords** (0.2 points max)
   - ServiceNow-specific terms: APS, DHD, MRIO, assignment_group, work_notes, priority, SLA, CMDB
   - 0.05 points per keyword (capped at 0.2)

3. **Question Specificity** (0.3 points max)
   - Specific indicators:
     - Process questions: "how to", "step by step", "procedure for", "guide for"
     - Action verbs: "configure", "setup", "install", "enable", "disable"
     - Specific references: "INC\d+", "incident \w+", "ticket \w+"
     - Error specificity: "error code", "error message", "exception"
     - Version specificity: "version \d+", "release \d+"
   - 0.1 points per indicator (capped at 0.3)

4. **Context Correlation** (0.2 points)
   - Has incident references in conversation history
   - Has related topics discussed previously
   - Awards 0.2 if context entities present

### Decision Threshold

- **< 0.5**: Needs clarification (ambiguous or generic)
- **≥ 0.5**: Sufficiently specific (direct execution)

### Clarity Reasons

Examples:
- `"Clarification needed: very generic request, no clear topic identified (score=0.10)"`
- `"Clarification needed: lacks specific focus area, no domain-specific context (score=0.35)"`
- `"Sufficiently specific: topics: configuration, keywords: aps, dhd (score=0.70)"`
- `"Sufficiently specific: topics: troubleshooting, incident context: INC0010003 (score=0.80)"`

---

## State Tracking

### Clarification Session State

```python
{
    "original_question": "Do you see any data related to this on the Wiki?",
    "analysis": {
        "needs_clarification": true,
        "clarity_score": 0.4,
        "detected_topics": ["requirements"],
        "detected_keywords": ["aps", "dhd", "mrio"],
        "context_entities": {
            "incidents": ["INC0010003"],
            "topics": ["work_notes", "requirements"],
            "mentioned_terms": ["aps", "dhd", "mrio"]
        },
        "reason": "Clarification needed: lacks specific focus area (score=0.40)"
    },
    "timestamp": "2026-01-20T14:31:52.123456",
    "options": [
        {"id": "specific_terms", "label": "Yes, focus on aps, dhd, mrio"},
        {"id": "broader_search", "label": "Search more broadly"},
        {"id": "custom_terms", "label": "Use different terms (please specify)"}
    ]
}
```

### Metadata Flow

#### Initial Wiki Request
```json
{
    "annotation": "@wiki",
    "username": "johndoe",
    "context_messages": [/* conversation history */]
}
```

#### Clarification Response (Frontend → Backend)
```json
{
    "question": "1",  // User's clarification response
    "metadata": {
        "annotation": "@wiki",
        "wiki_clarification_state_id": "wiki_clarify_20260120_143152_234567",
        "username": "johndoe"
    }
}
```

#### Refined Execution
```json
{
    "function_name": "wiki_rag_tool",
    "arguments": {
        "question": "Original question [Focus: keywords] [User clarification: response]",
        "correlation_context": "Original question: ...\nUser clarification: ...\nContext entities: ...",
        "search_keywords": ["aps", "dhd", "mrio"]
    }
}
```

---

## Tool Definitions

### `wiki_rag_tool` (Enhanced)

**Function**: Retrieve wiki knowledge with optional clarification context

**Arguments**:
- `question` (str, required): Full user question (may include clarification)
- `correlation_context` (str, optional): Context from clarification workflow
- `search_keywords` (list, optional): Specific keywords to emphasize

**Returns**:
```json
{
    "summary": {
        "answer": "Synthesized wiki response...",
        "correlation_applied": true
    }
}
```

### `wiki_clarification_request` (New)

**Function**: Present clarification questions to user

**Arguments**:
- `clarification_text` (str): Main clarification question
- `options` (list): Suggested options for user selection
- `followup_prompt` (str): Instructions on how to respond
- `state_id` (str): Session identifier

**Returns**:
```json
{
    "summary": "Formatted clarification text with options...",
    "clarification_state_id": "wiki_clarify_...",
    "awaiting_clarification": true
}
```

---

## Configuration

### Environment Variables

No new environment variables required. Uses existing:
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `OPENAI_API_VERSION`
- `GPT_MODEL_NAME`
- Confluence credentials (existing)

### Topic Customization

Edit `WIKI_TOPICS` in `wiki_clarification_engine.py`:

```python
WIKI_TOPICS = {
    "your_custom_topic": ["keyword1", "keyword2", "pattern"],
    # ... existing topics
}
```

### Keyword Expansion

Add ServiceNow or domain-specific keywords to `SERVICENOW_KEYWORDS`:

```python
SERVICENOW_KEYWORDS = {
    "new_acronym": "Full Term Name",
    # ... existing keywords
}
```

---

## Logging

All clarification workflow events logged to `agentic_orchestrator_auto.log`:

### Key Log Patterns

**Clarity Analysis**:
```
[WIKI_CLARIFY] Analyzing request clarity | question='Can you check the wiki?'
[WIKI_CLARIFY] Analysis complete | needs_clarification=True clarity_score=0.10 topics=[] keywords=[]
```

**Clarification Generation**:
```
[WIKI_CLARIFY] Generating clarification questions | question='Can you check the wiki?'
[WIKI_CLARIFY] Generated 6 clarification options | state_id=wiki_clarify_20260120_143052_123456
```

**Response Processing**:
```
[WIKI_CLARIFY] Processing clarification response | state_id=wiki_clarify_... response='1'
[WIKI_CLARIFY] User selected option 1: Troubleshooting & Error Resolution
[WIKI_CLARIFY] Refined query prepared | keywords=['troubleshooting'] filters={'topic': 'troubleshooting'}
```

**Wiki RAG Execution**:
```
[WikiRAG] perform_wiki_rag invoked | question_preview='...' | has_correlation=True has_keywords=True
[WikiRAG] Applying correlation context to answer
[WikiRAG] Correlation applied successfully | answer_length=1024
```

---

## Testing

### Manual Testing Steps

1. **Test Generic Request**:
   ```
   User: "@wiki search wiki"
   Expected: Clarification with 6 topic options
   ```

2. **Test Context-Aware Clarification**:
   ```
   Setup: Discuss INC0010003 with APS/DHD mentions
   User: "@wiki what about this on wiki?"
   Expected: Clarification focusing on APS, DHD keywords
   ```

3. **Test Direct Execution**:
   ```
   User: "@wiki How to configure ServiceNow assignment groups for production?"
   Expected: Direct Wiki RAG (no clarification)
   ```

4. **Test Clarification Flow**:
   ```
   User: "@wiki check wiki"
   System: [Clarification with options 1-6]
   User: "2"
   Expected: Refined Wiki RAG for troubleshooting docs
   ```

### Automated Test Cases

```python
def test_clarity_analysis_generic():
    engine = WikiClarificationEngine()
    result = engine.analyze_wiki_request_clarity("check wiki", [])
    assert result['needs_clarification'] == True
    assert result['clarity_score'] < 0.3

def test_clarity_analysis_specific():
    engine = WikiClarificationEngine()
    result = engine.analyze_wiki_request_clarity(
        "How to configure APS for production?", 
        []
    )
    assert result['needs_clarification'] == False
    assert result['clarity_score'] >= 0.5
    assert 'configuration' in result['detected_topics']
    assert 'aps' in result['detected_keywords']

def test_context_extraction():
    engine = WikiClarificationEngine()
    messages = [
        {"content": "What about INC0010003?"},
        {"content": "The work notes mention APS and DHD requirements."}
    ]
    result = engine.analyze_wiki_request_clarity("check wiki", messages)
    assert 'INC0010003' in result['context_entities']['incidents']
    assert 'aps' in result['context_entities']['mentioned_terms']
```

---

## Migration Notes

### Breaking Changes
None. Existing `@wiki` queries work unchanged. Enhancement is backwards-compatible:
- High clarity questions execute directly (no behavior change)
- Low clarity questions now trigger clarification (new feature)

### Frontend Considerations

Frontends should handle the new clarification response:

1. **Detect Clarification Request**:
   ```javascript
   if (response.awaiting_clarification && response.clarification_state_id) {
       // Display clarification UI
       showClarificationOptions(response.summary);
       // Store state_id for next request
       sessionStorage.setItem('wiki_state_id', response.clarification_state_id);
   }
   ```

2. **Send Clarification Response**:
   ```javascript
   const nextRequest = {
       question: userResponse,  // "1" or "troubleshooting" or custom text
       metadata: {
           annotation: "@wiki",
           wiki_clarification_state_id: sessionStorage.getItem('wiki_state_id'),
           username: currentUser
       }
   };
   ```

3. **Clear State After Execution**:
   ```javascript
   if (!response.awaiting_clarification) {
       sessionStorage.removeItem('wiki_state_id');
   }
   ```

---

## Future Enhancements

### Planned Features

1. **Multi-Level Clarification**: Allow follow-up questions if first clarification insufficient
2. **Clarification History**: Track which clarifications lead to best results
3. **Auto-Learning**: Adjust clarity thresholds based on user feedback
4. **Keyword Suggestions from Wiki Index**: Extract actual terms from FAISS index for suggestions
5. **Hybrid Search**: Combine keyword + semantic search with clarification-refined queries
6. **Clarification Templates**: Persona-specific clarification styles (PO vs Dev vs Agent)
7. **Persistent State**: Move from in-memory to TinyDB for session persistence across restarts

### Known Limitations

1. **State Storage**: Currently in-memory - session lost on backend restart
2. **No Feedback Loop**: System doesn't learn from clarification effectiveness yet
3. **Single Clarification**: Only one clarification round (no multi-turn refinement)
4. **No Cancellation**: User can't cancel clarification and go back to direct search

---

## Troubleshooting

### Issue: Clarification Always Triggered

**Symptom**: Even specific questions get clarification requests

**Diagnosis**:
```python
# Check clarity score calculation
from backend.components.wiki_clarification_engine import get_wiki_clarification_engine
engine = get_wiki_clarification_engine()
result = engine.analyze_wiki_request_clarity("your question", [])
print(result)  # Check clarity_score and reason
```

**Solution**: Adjust threshold or add topic/keyword patterns in `WIKI_TOPICS`/`SERVICENOW_KEYWORDS`

---

### Issue: Clarification Never Triggered

**Symptom**: All requests execute directly, no clarifications

**Diagnosis**: Check `should_clarify_wiki_request()` is called in orchestrator

**Solution**: Verify `langgraph_flow.py` has enhanced `@wiki` block (lines 313-376)

---

### Issue: State Not Found

**Symptom**: Error "Unknown state_id: wiki_clarify_..."

**Cause**: Backend restarted between clarification and response

**Solution**: Implement TinyDB persistence (future enhancement) or inform user to restart query

---

## Summary

The enhanced Wiki RAG system transforms static documentation retrieval into an interactive, context-aware conversation. By analyzing request clarity and asking targeted clarification questions, the system delivers more relevant documentation while reducing irrelevant search results.

**Key Benefits**:
- ✅ Higher quality wiki search results through clarification
- ✅ Context-aware suggestions based on conversation history
- ✅ Correlation of wiki findings back to original question
- ✅ Backwards compatible with existing `@wiki` usage
- ✅ Configurable topics and keywords for domain customization
- ✅ Full audit trail in logs for monitoring effectiveness

**Typical User Experience**:
- Generic request → Clarification with smart options → Refined search → Correlated answer
- Specific request → Direct execution → Fast response
