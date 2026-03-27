# Entity Memory Framework - Integration Guide

## Overview
Configuration-driven entity context management that replaces `short_term_memory.py` with a generic, scalable pattern. Works for incidents, user stories, wiki pages, change records, and any future entity type with **zero code changes**.

## Architecture Pattern

### Before (Homegrown STM)
```python
# Hardcoded for incidents only
class ShortTermMemory:
    last_incident_list = []  # Only handles incidents
    
    def _extract_incidents_from_output(self, output):
        # Manual extraction logic
        if "sample" in output:
            return [inc["number"] for inc in output["sample"]]
    
    def detect_reference(self, question):
        # Hardcoded patterns
        if re.search(r"those incidents?", question):
            return {"detected": True}
```

**Problems:**
- ❌ Only works for incidents
- ❌ Adding user_stories requires code changes
- ❌ No state persistence between requests
- ❌ Manual metadata injection

### After (Entity Memory Framework)
```python
# Configuration-driven, works for ANY entity type
ENTITY_CONFIG = {
    "incidents": {
        "extractors": [lambda out: [...]],  # Reusable patterns
        "patterns": [r"\bthose\s+incidents?\b"],
        "fetch_tool": "fetch_servicenow_incident",
        "source_tools": ["fetch_backlog_overview", ...]
    },
    "user_stories": {...},  # Same pattern, different config
    "wiki_pages": {...},    # Just add config, zero code changes
}

framework = EntityMemoryFramework()
entities = framework.extract_entities_from_outputs(tool_outputs)  # Generic!
ref = framework.detect_entity_reference(question, entities)       # Generic!
```

**Benefits:**
- ✅ Works for unlimited entity types
- ✅ Add new types with 4-6 lines of config
- ✅ Integrates with LangGraph state
- ✅ Token-efficient caching (max 20 per type)

---

## Integration with LangGraph State

### Step 1: Update GraphState Schema

**File:** `backend/components/langgraph_flow.py`

```python
from typing import TypedDict, Dict, List, Any, Annotated
from langchain_core.messages import BaseMessage, add_messages

class GraphState(TypedDict, total=False):
    # Core state
    messages: Annotated[List[BaseMessage], add_messages]
    question: str
    plan: List[Dict[str, Any]]
    
    # ✅ ADD: Entity memory fields
    cached_entities: Dict[str, List[str]]        # {"incidents": ["INC001"], "user_stories": ["US-123"]}
    last_tool_outputs: Dict[str, Any]            # {"fetch_backlog": {...}}
    reference_context: Optional[Dict[str, Any]]  # Active reference info
    
    # Existing fields
    tool_outputs: Dict[str, Any]
    context: str
    done: bool
```

### Step 2: Add Entity Cache Node

```python
from components.entity_memory_framework import extract_entities, merge_entities

def cache_entities_node(state: GraphState) -> Dict[str, Any]:
    """
    Extract entities from tool outputs and update cache.
    Runs after tool execution.
    """
    tool_outputs = state.get("last_tool_outputs", {})
    existing_cache = state.get("cached_entities", {})
    
    # Generic extraction for ALL entity types
    new_entities = extract_entities(tool_outputs)
    
    if new_entities:
        # Merge with existing, maintaining limits
        updated_cache = merge_entities(existing_cache, new_entities, max_per_type=20)
        logger.info(f"[CacheNode] Updated entity cache: {updated_cache}")
        return {"cached_entities": updated_cache}
    
    return {}
```

### Step 3: Add Reference Detection Node

```python
from components.entity_memory_framework import detect_reference, build_fetch_plan

def detect_reference_node(state: GraphState) -> Dict[str, Any]:
    """
    Check if user question references cached entities.
    Runs BEFORE planning.
    """
    messages = state.get("messages", [])
    if not messages:
        return {"reference_context": None}
    
    question = messages[-1].content
    cached_entities = state.get("cached_entities", {})
    
    # Generic reference detection
    ref_info = detect_reference(question, cached_entities)
    
    if ref_info:
        logger.info(f"[RefDetect] Found reference: {ref_info['entity_type']} count={ref_info['count']}")
        
        # Build fetch plan (limit to 5 for performance)
        fetch_plan = build_fetch_plan(ref_info, limit=5)
        
        return {
            "reference_context": ref_info,
            "plan": fetch_plan,  # Override planner with direct fetch
            "skip_planner": True
        }
    
    return {"reference_context": None, "skip_planner": False}
```

### Step 4: Update Graph Flow

```python
from langgraph.graph import StateGraph

# Build graph
workflow = StateGraph(GraphState)

# Add nodes
workflow.add_node("detect_reference", detect_reference_node)  # NEW: Before planning
workflow.add_node("planner", planner_node)
workflow.add_node("executor", tool_executor_node)
workflow.add_node("cache_entities", cache_entities_node)      # NEW: After execution
workflow.add_node("done", done_node)

# Define edges
workflow.set_entry_point("detect_reference")

# Conditional: Skip planner if reference detected
def should_skip_planner(state):
    if state.get("skip_planner"):
        return "executor"  # Go straight to execution with pre-built plan
    return "planner"      # Normal flow

workflow.add_conditional_edges("detect_reference", should_skip_planner)
workflow.add_edge("planner", "executor")
workflow.add_edge("executor", "cache_entities")  # Cache after execution
workflow.add_edge("cache_entities", "done")

# ✅ ADD: Persistent memory (CRITICAL!)
from langgraph.checkpoint.memory import MemorySaver
memory = MemorySaver()
app = workflow.compile(checkpointer=memory)
```

---

## Integration with Orchestrator

### Step 5: Update Orchestrator Initialization

**File:** `backend/components/agentic_orchestrator_auto.py`

```python
from components.entity_memory_framework import ENABLED as ENTITY_MEMORY_ENABLED

# Enable/disable framework
USE_ENTITY_MEMORY = ENTITY_MEMORY_ENABLED and os.getenv("USE_ENTITY_MEMORY", "1") == "1"

if USE_ENTITY_MEMORY:
    logger.info("[Orchestrator] Using Entity Memory Framework")
else:
    logger.info("[Orchestrator] Using legacy short_term_memory")
```

### Step 6: Update Thread Management

```python
# CRITICAL: Add thread_id to maintain conversation context
def orchestrate_agentic_workflow(question: str, username: str, session_id: str, metadata: dict):
    # Build thread ID for state persistence
    thread_id = f"{username}_{session_id}"
    
    config = {
        "configurable": {
            "thread_id": thread_id  # LangGraph will persist state across requests
        }
    }
    
    # Initialize state with history
    initial_state = {
        "messages": [HumanMessage(content=question)],
        "question": question,
        "cached_entities": {},  # Will be populated from checkpointer if exists
        "last_tool_outputs": {},
    }
    
    # Run graph with persistence
    result = app.invoke(initial_state, config=config)
    
    return result
```

### Step 7: Replace STM Logic

**Find and replace in orchestrator:**

```python
# ❌ OLD: Homegrown STM
if STM_ENABLED:
    stm = get_short_term_memory()
    ref = stm.detect_reference(question)
    if ref and ref.get("has_cached_data"):
        stm.resolve_query(question, metadata)

# ✅ NEW: Entity Memory Framework
if USE_ENTITY_MEMORY:
    # Let LangGraph nodes handle reference detection
    # No manual metadata injection needed
    pass  # Graph handles everything via state
else:
    # Fallback to legacy STM
    if STM_ENABLED:
        stm = get_short_term_memory()
        # ... existing logic
```

---

## Frontend Integration

### Step 8: Add Session Management

**File:** `frontend/src/components/ChatInterface.tsx`

```typescript
const ChatInterface = () => {
  const [sessionId] = useState(() => uuidv4());  // Generate once per session
  
  const sendMessage = async (question: string) => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        question,
        username: currentUser.email,
        session_id: sessionId,  // ✅ Pass to backend
      })
    });
  };
};
```

---

## Adding New Entity Types

### Example: Adding "code_commits" Entity Type

**Just add configuration - zero code changes needed!**

```python
# In entity_memory_framework.py ENTITY_CONFIG:

"code_commits": {
    "extractors": [
        lambda output: [
            item.get("commit_id") or item.get("sha")
            for item in (output.get("commits") or [])
            if isinstance(item, dict)
        ],
    ],
    "patterns": [
        r"\bthose\s+commits?\b",
        r"\bthese\s+changes?\b",
        r"\bthe\s+PRs?\b",
    ],
    "fetch_tool": "fetch_commit_details",
    "id_param": "commit_id",
    "source_tools": ["fetch_related_commits", "github_search_commits"],
},
```

**That's it!** Framework automatically:
- Extracts commit IDs from tool outputs
- Detects "those commits" references
- Builds fetch plan with `fetch_commit_details(commit_id=...)`
- Caches up to 20 commits

---

## Testing Multi-Turn Conversations

### Test Scenario 1: Incidents
```
Q1: "What are the top incidents in backlog?"
→ Executes fetch_backlog_overview
→ Caches: {"incidents": ["INC001", "INC002", "INC003", ...]}

Q2: "List those incidents"  ← Reference detected!
→ Builds plan: [
    {function_name: "fetch_servicenow_incident", arguments: {incident_number: "INC001"}},
    {function_name: "fetch_servicenow_incident", arguments: {incident_number: "INC002"}},
    ...
  ]
→ Executes plan (5 max)
```

### Test Scenario 2: Entity Type Switching
```
Q1: "Show me top user stories"
→ Caches: {"user_stories": ["US-123", "US-456"]}

Q2: "What incidents are related?"
→ Caches: {"user_stories": [...], "incidents": ["INC001", "INC002"]}

Q3: "Show me those stories"  ← Resolves to user_stories, NOT incidents!
→ Builds plan for user_stories

Q4: "What about those incidents?"  ← Resolves to incidents
→ Builds plan for incidents
```

### Test Scenario 3: State Persistence
```
Session 1:
Q1: "List incidents"
Q2: "Show them" ← Works (same session)

[User closes browser, reopens 5 minutes later with SAME session_id]

Session 2:
Q3: "Give me details on those"  ← STILL WORKS!
→ LangGraph checkpointer restores cached_entities from thread_id
→ Reference resolves correctly
```

---

## Rollback Strategy

If issues arise, disable via environment variable:

```bash
# Disable entity memory framework
export ENABLE_ENTITY_MEMORY=0

# Orchestrator will fall back to legacy STM
```

Or in code:
```python
USE_ENTITY_MEMORY = False  # Force legacy behavior
```

---

## Performance Considerations

### Token Efficiency
- Each entity type capped at 20 items
- LangGraph checkpointer stores compressed state
- Older entities automatically pruned

### Memory Usage
- In-memory MemorySaver for development
- Production: Switch to SqliteSaver or PostgresSaver

```python
from langgraph.checkpoint.sqlite import SqliteSaver
memory = SqliteSaver.from_conn_string("checkpoints.db")
```

### Latency
- Reference detection: ~5ms (regex checks)
- Entity extraction: ~10ms (lambda functions)
- Plan building: ~2ms (list comprehension)

**Total overhead: ~17ms per request**

---

## Monitoring & Observability

### Logging
All operations logged to `agentic_orchestrator_auto.log`:

```
[EntityMemory] Framework initialized | entity_types=5
[EntityMemory] Extracted 13 incidents
[RefDetect] Found reference: incidents count=13
[CacheNode] Updated entity cache: {'incidents': ['INC001', 'INC002', ...]}
```

### Metrics to Track
- `entity_extraction_count` - Entities extracted per request
- `reference_detection_rate` - % of queries that reference cached entities
- `cache_hit_rate` - % of references successfully resolved
- `entity_types_active` - Which entity types are being used

### Debug Mode
```python
os.environ["SNOWCHAT_DIAG"] = "1"  # Enable detailed logging
```

---

## Migration Checklist

- [ ] Add `entity_memory_framework.py` to `backend/components/`
- [ ] Update `GraphState` schema with `cached_entities`, `last_tool_outputs`
- [ ] Add `cache_entities_node` and `detect_reference_node` to graph
- [ ] Add MemorySaver checkpointer to graph compilation
- [ ] Update orchestrator to pass `thread_id`
- [ ] Add `session_id` to frontend chat requests
- [ ] Test multi-turn scenarios (Q1→Q2→Q3)
- [ ] Test entity type switching (incidents→stories→incidents)
- [ ] Test state persistence (close browser, reopen)
- [ ] Update `short_term_memory.py` deprecation notice
- [ ] Document new entity types in ENTITY_CONFIG

---

## Success Criteria

✅ **Functionality:**
- Multi-turn conversations work without manual metadata injection
- References resolve correctly for ALL entity types
- State persists across browser reloads (same session)

✅ **Maintainability:**
- Adding new entity type = 4-6 lines of config
- No scattered code changes
- Framework code never touched

✅ **Performance:**
- <20ms overhead per request
- Token usage within limits (20 entities × 5 types = 100 max)

✅ **Observability:**
- All operations logged
- Metrics tracked
- Easy rollback via env var

