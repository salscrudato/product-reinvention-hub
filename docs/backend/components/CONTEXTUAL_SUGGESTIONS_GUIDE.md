# Contextual Question Suggestions - Implementation Guide

## Overview
The contextual question suggester enhances user experience by providing intelligent follow-up questions based on the last 3 questions asked and their answers. This creates a more conversational and exploratory experience, helping users discover relevant information without needing to know exact queries.

## Architecture

### Core Component
**File:** `contextual_question_suggester.py`

```python
class ContextualQuestionSuggester:
    - Tracks per-user conversation history (last 3 Q&A pairs)
    - Extracts entities from questions and answers
    - Generates contextual suggestions using LLM or templates
    - Integrates with entity memory framework
```

### Integration Points
**File:** `agentic_orchestrator_api.py`

1. **Main Orchestrate Endpoint** (`/agentic_orchestrate`)
   - After generating `final_answer`
   - Before returning response
   - Adds suggestions to result dict

2. **Auto Orchestrate Endpoint** (`/agentic_orchestrate_auto`)
   - After synthesizing answer
   - Handles multiple answer formats
   - Adds suggestions to result dict

3. **Dedicated Suggestions Endpoint** (`/suggestions`)
   - GET endpoint for retrieving suggestions
   - Parameters: `username`, `limit`, `use_llm`
   - Returns latest suggestions for user

## Features

### 1. Per-User History Tracking
```python
user_histories: Dict[str, deque]  # username -> deque of Q&A pairs
```

- Each user gets their own history queue
- FIFO with maxlen=3 (last 3 questions)
- No cross-contamination between users
- Automatically manages memory (oldest dropped)

### 2. Entity Extraction
Extracts from both questions and answers:
- **Incidents:** INC0123456, INC123456
- **Dates:** 2024-01-15, 01/15/2024, last week, yesterday
- **Priorities:** P1, P2, P3, Priority 1, critical, high, medium, low
- **Components:** ServiceNow modules, application components

### 3. Dual-Mode Generation

#### LLM Mode (Default)
```python
use_llm=True  # Uses GPT-4 for intelligent suggestions
```

**Advantages:**
- Natural, conversational questions
- Contextually aware
- Understands nuance and relationships
- Generates diverse suggestions

**Prompt Structure:**
```python
f"""You are an expert at suggesting helpful follow-up questions.

Based on this conversation history:
Q1: {question1}
A1: {answer1}

Q2: {question2}
A2: {answer2}

Q3: {question3}
A3: {answer3}

Suggest {limit} specific, actionable follow-up questions that would help the user explore this topic further.
"""
```

#### Template Mode (Fallback)
```python
use_llm=False  # Uses pattern-based templates
```

**Advantages:**
- Faster (no API calls)
- Works offline
- Predictable
- Lower cost

**Template Categories:**
1. **Intent-based:** Different for backlog_grooming vs incident_detail
2. **Entity-based:** Has incidents → "Analyze those incidents for patterns"
3. **Component-based:** Mentions "database" → "Show me all incidents in database"
4. **Default:** Generic exploration questions

### 4. Entity Memory Integration
Leverages entity memory framework for reference-aware suggestions:

```python
# After backlog query returns incidents
Suggested: "List those incidents"
# Uses entity memory to resolve "those incidents"

# After incident detail query
Suggested: "What caused that incident?"
# Uses entity memory to resolve "that incident"
```

## API Usage

### Response Format
Both `/agentic_orchestrate` and `/agentic_orchestrate_auto` now return:

```json
{
  "final_answer": "...",
  "tool_outputs": {...},
  "function_sequence": [...],
  "suggested_questions": [
    "What caused those incidents?",
    "Show me the timeline for those incidents",
    "List those incidents grouped by priority",
    "Who should these incidents be assigned to?",
    "What's the root cause pattern?"
  ],
  ...
}
```

### Dedicated Endpoint
```bash
GET /api/suggestions?username=user@email.com&limit=5&use_llm=true
```

**Response:**
```json
{
  "username": "user@email.com",
  "suggestions": [
    "What caused those incidents?",
    "Show me the timeline for those incidents",
    ...
  ],
  "count": 5
}
```

**Parameters:**
- `username` (required): User identifier
- `limit` (optional, default=5): Number of suggestions
- `use_llm` (optional, default=true): Use LLM or templates

## Example Conversation Flow

### Scenario: Incident Backlog Investigation

**Q1:** "What are the top incidents in the backlog?"

**Response:**
```json
{
  "final_answer": "Found 13 high-priority incidents in backlog...",
  "suggested_questions": [
    "List those incidents",
    "Show me the critical priority ones",
    "What's the oldest incident?",
    "Group them by component",
    "Who owns these incidents?"
  ]
}
```

**Q2:** "List those incidents"
_(Entity memory resolves "those incidents" to the 13 from Q1)_

**Response:**
```json
{
  "final_answer": "INC0123456: Database connection timeout\nINC0123457: API rate limit...",
  "suggested_questions": [
    "Analyze those incidents for patterns",
    "What's the root cause?",
    "Show me similar incidents",
    "What component is most affected?",
    "Get the timeline for these"
  ]
}
```

**Q3:** "What's the root cause?"

**Response:**
```json
{
  "final_answer": "Root cause analysis shows database connection pool exhaustion...",
  "suggested_questions": [
    "How can we prevent this?",
    "Show me the database configuration",
    "What's the fix timeline?",
    "Are there related change records?",
    "Who should implement the fix?"
  ]
}
```

## Configuration

### Environment Variables
```bash
# Enable/disable suggestions (default: enabled)
ENABLE_CONTEXTUAL_SUGGESTIONS=1

# Use LLM or templates (default: LLM)
USE_LLM_SUGGESTIONS=1

# Number of suggestions per response (default: 5)
MAX_SUGGESTIONS=5

# Conversation history size (default: 3)
SUGGESTION_HISTORY_SIZE=3
```

### Code Configuration
```python
# In contextual_question_suggester.py
suggester = ContextualQuestionSuggester(
    max_history=3,  # Track last N questions
)

# In API calls
suggestions = suggester.get_contextual_suggestions(
    username=username,
    limit=5,  # Number of suggestions
    use_llm=True  # LLM vs templates
)
```

## Integration Workflow

### 1. After Each Question Answered
```python
# In agentic_orchestrator_api.py
suggester = get_contextual_suggester()

# Add to history
suggester.add_to_history(
    username=username,
    question=question,
    answer=final_answer,
    intent=metadata.get('intent'),
    tool_outputs=tool_outputs
)

# Generate suggestions
suggestions = suggester.get_contextual_suggestions(
    username=username,
    limit=5,
    use_llm=True
)

# Add to response
result["suggested_questions"] = suggestions
```

### 2. Frontend Display
```javascript
// In ChatInterface.tsx or equivalent
const SuggestedQuestions = ({ suggestions, onSelect }) => {
  return (
    <div className="suggested-questions">
      <h4>You might also want to ask:</h4>
      {suggestions.map((question, idx) => (
        <button 
          key={idx}
          onClick={() => onSelect(question)}
          className="suggestion-chip"
        >
          {question}
        </button>
      ))}
    </div>
  );
};

// After receiving response
const { suggested_questions } = response.data;
setSuggestions(suggested_questions);
```

### 3. User Interaction
```javascript
const handleSuggestionClick = (question) => {
  // Populate input field
  setInputValue(question);
  
  // Or submit immediately
  handleSubmitQuestion(question);
};
```

## Testing

### Unit Tests
```python
# In test_contextual_suggester.py
def test_add_to_history():
    """Test history tracking with FIFO behavior"""
    suggester = ContextualQuestionSuggester(max_history=3)
    
    # Add 4 questions (4th should drop 1st)
    for i in range(4):
        suggester.add_to_history(
            username='test@user.com',
            question=f'Q{i+1}',
            answer=f'A{i+1}',
            intent='backlog_grooming',
            tool_outputs={}
        )
    
    history = suggester.user_histories['test@user.com']
    assert len(history) == 3
    assert history[0]['question'] == 'Q2'  # Q1 dropped

def test_llm_suggestions():
    """Test LLM-based suggestion generation"""
    suggester = ContextualQuestionSuggester()
    
    # Add history
    suggester.add_to_history(
        username='test@user.com',
        question='What are top incidents?',
        answer='Found 13 incidents...',
        intent='backlog_grooming',
        tool_outputs={'fetch_backlog_overview': {'incidents': [...]}}
    )
    
    # Get suggestions
    suggestions = suggester.get_contextual_suggestions(
        username='test@user.com',
        limit=5,
        use_llm=True
    )
    
    assert len(suggestions) == 5
    assert any('incident' in s.lower() for s in suggestions)

def test_template_suggestions():
    """Test template-based fallback"""
    suggester = ContextualQuestionSuggester()
    
    suggester.add_to_history(
        username='test@user.com',
        question='Show me INC0123456',
        answer='Incident details...',
        intent='incident_detail',
        tool_outputs={}
    )
    
    suggestions = suggester.get_contextual_suggestions(
        username='test@user.com',
        limit=5,
        use_llm=False  # Template mode
    )
    
    assert len(suggestions) > 0
    assert any('root cause' in s.lower() for s in suggestions)
```

### Integration Tests
```python
def test_api_returns_suggestions():
    """Test that API includes suggestions in response"""
    response = requests.post(
        'http://localhost:5001/api/agentic_orchestrate_auto',
        json={
            'question': 'What are top incidents?',
            'username': 'test@user.com'
        }
    )
    
    data = response.json()
    assert 'suggested_questions' in data
    assert len(data['suggested_questions']) == 5

def test_suggestions_endpoint():
    """Test dedicated suggestions endpoint"""
    response = requests.get(
        'http://localhost:5001/api/suggestions',
        params={
            'username': 'test@user.com',
            'limit': 5,
            'use_llm': 'true'
        }
    )
    
    data = response.json()
    assert 'suggestions' in data
    assert data['username'] == 'test@user.com'
    assert data['count'] == len(data['suggestions'])
```

## Performance Considerations

### LLM Latency
- GPT-4 call typically adds 200-500ms
- Parallel with other processing where possible
- Cache suggestions if query patterns repeat

### Memory Usage
- Per-user history limited to last 3 Q&A pairs
- Automatic cleanup via deque
- Minimal memory footprint

### Cost Optimization
- Template mode for cost-sensitive deployments
- Cache suggestions for common patterns
- Use shorter prompts (current ~300 tokens)

## Monitoring

### Metrics to Track
```python
# Log in API
logger.info(f"[API] Generated {len(suggestions)} contextual suggestions for {username}")
logger.info(f"[API] Suggestion generation took {duration_ms}ms")

# Track in metrics system
emit_event('suggestion_generated', {
    'username': username,
    'count': len(suggestions),
    'mode': 'llm' if use_llm else 'template',
    'duration_ms': duration_ms
})
```

### Health Checks
- Suggestion endpoint response time
- LLM availability (fallback to templates)
- User engagement (click-through rate)
- Suggestion quality (user feedback)

## Troubleshooting

### No Suggestions Returned
**Cause:** No conversation history for user
**Solution:** Suggestions start appearing after first question answered

### Generic Suggestions Only
**Cause:** LLM mode disabled or failed
**Solution:** Check OpenAI API key, enable `use_llm=True`

### Suggestions Not Contextual
**Cause:** History not persisted across sessions
**Solution:** Ensure username consistent, check TinyDB if persistence added

### High Latency
**Cause:** LLM call blocking
**Solution:** Switch to template mode or cache suggestions

## Future Enhancements

### Phase 1 (Current)
✅ Per-user history tracking
✅ LLM-based generation
✅ Template fallback
✅ Entity extraction
✅ API integration

### Phase 2 (Planned)
- Persistent history (TinyDB/database)
- User feedback loop (thumbs up/down)
- A/B testing (LLM vs templates)
- Suggestion caching

### Phase 3 (Future)
- Multi-turn entity tracking
- Cross-user pattern learning
- Personalized suggestions
- Suggestion ranking/scoring

## API Reference

### get_contextual_suggester()
```python
def get_contextual_suggester() -> ContextualQuestionSuggester:
    """Global singleton accessor for suggester instance"""
```

### add_to_history()
```python
def add_to_history(
    username: str,
    question: str,
    answer: str,
    intent: Optional[str],
    tool_outputs: Dict
) -> None:
    """
    Add Q&A pair to user's history (FIFO, max 3)
    
    Args:
        username: User identifier
        question: User's question
        answer: AI's answer
        intent: Classified intent (e.g., 'backlog_grooming')
        tool_outputs: Tool execution results
    """
```

### get_contextual_suggestions()
```python
def get_contextual_suggestions(
    username: str,
    limit: int = 5,
    use_llm: bool = True
) -> List[str]:
    """
    Generate contextual follow-up questions
    
    Args:
        username: User identifier
        limit: Number of suggestions to return
        use_llm: True for GPT-4, False for templates
    
    Returns:
        List of suggested questions
    """
```

## Best Practices

1. **Always track history:** Call `add_to_history()` after every answer
2. **Include in response:** Add suggestions to result dict before jsonify
3. **Handle errors gracefully:** Return empty list if generation fails
4. **Log for monitoring:** Track generation time and success rate
5. **Use LLM by default:** Better quality, fallback to templates if needed
6. **Keep prompts concise:** Minimize token usage
7. **Validate inputs:** Check username exists, question non-empty
8. **Test both modes:** Ensure LLM and template modes work

## Summary

The contextual question suggester transforms SnowChat from a query-response tool into an exploratory conversation partner. By tracking conversation history and generating intelligent follow-ups, users can:

- Discover related information without knowing exact queries
- Explore topics more deeply through guided questions
- Leverage entity memory for natural references ("those incidents")
- Experience a more conversational, helpful AI assistant

Integration is seamless - suggestions automatically appear after each response, and users can click to explore further. The dual-mode design ensures reliability (template fallback) while providing intelligent suggestions when possible (LLM mode).
