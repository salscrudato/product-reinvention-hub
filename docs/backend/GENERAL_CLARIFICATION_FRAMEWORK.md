# General Clarification Framework - Architecture & Integration Guide

## Date: January 20, 2026

## Problem Statement

**Original**: Wiki RAG had domain-specific clarification (wiki-only)

**Need**: Universal clarification framework that works for ANY situation where DevCopilot needs more context before generating an execution plan

**Use Cases**:
- Missing required parameters (incident number, repository name, time range)
- Ambiguous entity references ("this incident", "that user", "the deployment")
- Multiple execution paths (analysis type, query approach, rollback strategy)
- Critical actions requiring confirmation (production deployment, user deletion)
- Low planner confidence (<60%) indicating need for more context

---

## Architecture Comparison

### Wiki-Specific Clarification (Existing)
```
wiki_clarification_engine.py
├── Analyzes WIKI REQUESTS ONLY
├── Scores question specificity (topics, keywords)
├── Asks about search focus (configuration, troubleshooting, etc.)
└── Correlates wiki findings back to question

USE CASE: "@wiki search the wiki" → "What topic?"
```

### General Clarification Framework (New)
```
general_clarification_engine.py
├── Analyzes ANY PLAN before execution
├── Detects missing params, ambiguities, conflicts
├── Uses intent-specific templates for questions
└── Enriches request with gathered information

USE CASES:
- "Update the incident" → "Which incident?"
- "Deploy to production" → "⚠️ Confirm production deployment?"
- "Analyze the code" → "What type of analysis?"
- "Query the data" → "What time range?"
```

---

## Core Components

### 1. Plan Feasibility Analyzer

**Function**: `analyze_plan_feasibility()`

**Checks**:
- ✅ **Missing Required Parameters**: Intent needs incident_number but none provided
- ✅ **Ambiguous Entity References**: "this", "that", "the incident" without context
- ✅ **Multiple Execution Paths**: Query could go to ServiceNow OR Confluence
- ✅ **Insufficient Context**: Planner confidence < 60%
- ✅ **Conflicting Inputs**: User says "production" but extracted "development"
- ✅ **Critical Actions**: Deployment, deletion, production changes need confirmation

**Returns**:
```python
{
    "needs_clarification": True,
    "triggers": ["missing_required_parameter", "need_user_confirmation"],
    "missing_params": ["incident_number"],
    "ambiguous_entities": [],
    "suggested_clarifications": ["missing_incident_number", "confirmation"],
    "reason": "Clarification needed: missing parameters: incident_number",
    "confidence": 0.45
}
```

---

### 2. Intent-Specific Templates

**Structure**: `CLARIFICATION_TEMPLATES` dictionary

**Supported Intents**:
- `incident_management`: Incident numbers, fields, update confirmations
- `code_analysis`: Repository, analysis scope, security/performance/quality
- `data_query`: Time range, data source selection
- `deployment`: Environment confirmation, rollback strategy
- `user_management`: User disambiguation

**Template Example**:
```python
"incident_management": {
    "missing_incident_number": {
        "trigger": ClarificationTrigger.MISSING_REQUIRED_PARAM,
        "type": ClarificationType.PARAMETER_VALUE,
        "question": "Which incident would you like to {action}?",
        "hints": [
            "Provide the incident number (e.g., INC0010003)",
            "Or describe the incident briefly",
            "Recent incidents: {recent_incidents}"
        ],
        "required_for": ["fetch_incident", "update_incident", "incident_analysis"]
    }
}
```

---

### 3. Dynamic Question Generator

**Function**: `generate_clarification_request()`

**Capabilities**:
- Builds questions from templates
- Populates dynamic data (recent incidents, available repos)
- Sets priority levels (critical, high, normal)
- Supports multiple question types:
  - **Parameter Value**: "What incident number?"
  - **Entity Selection**: "Which user? (John Smith, Jane Smith, J. Smithson)"
  - **Execution Path**: "What type of analysis?"
  - **Confirmation**: "Deploy to production? Yes/No"
  - **Context Enrichment**: "Any additional details?"

**Output**:
```python
{
    "clarification_text": "I need some additional information to proceed:\n\n",
    "questions": [
        {
            "id": "param_incident_number",
            "type": "parameter_value",
            "question": "Which incident would you like to update?",
            "hint": "Provide the incident number (e.g., INC0010003)",
            "required": True
        }
    ],
    "state_id": "clarify_incident_management_20260120_112345_123456",
    "priority": "normal",
    "intent": "incident_management"
}
```

---

### 4. Multi-Turn State Manager

**Storage**: In-memory dictionary (upgradeable to TinyDB)

**State Structure**:
```python
{
    "clarify_incident_management_20260120_112345_123456": {
        "original_question": "Update the incident",
        "intent": "incident_management",
        "analysis": {/* feasibility analysis */},
        "questions": [/* clarification questions */],
        "timestamp": "2026-01-20T11:23:45.123456",
        "context_messages": [/* last 5 messages */]
    }
}
```

**Lifecycle**:
1. State created when clarification generated
2. State stored with unique ID
3. State retrieved when user responds
4. State deleted after processing

---

### 5. Response Processor

**Function**: `process_clarification_responses()`

**Handles**:
- Multiple question responses in single payload
- Required vs optional question validation
- Confirmation cancellations (user says "No")
- Entity extraction from responses
- Metadata enrichment for planner

**Input**:
```python
{
    "state_id": "clarify_...",
    "responses": {
        "param_incident_number": "INC0010003",
        "confirmation_update": "yes"
    }
}
```

**Output**:
```python
{
    "enriched_question": "Update the incident [Clarified: incident_number=INC0010003; Confirmed: True]",
    "enriched_entities": {
        "incident_number": "INC0010003"
    },
    "enriched_metadata": {
        "user_confirmed": True
    },
    "ready_to_plan": True,
    "original_question": "Update the incident",
    "intent": "incident_management"
}
```

---

## Integration with Planner

### When to Check for Clarification

**Location**: `langgraph_flow.py` in `determine_function_sequence()`

**Decision Points**:

```python
# BEFORE generating plan
if should_request_clarification(question, intent, entities, tools, context, confidence):
    clarification = generate_clarification(...)
    return clarification_response  # Don't execute yet

# AFTER user responds to clarification
if metadata.get('clarification_state_id'):
    enriched = process_clarification_responses(state_id, responses)
    # Now generate plan with enriched_question + enriched_entities
    return execute_plan(enriched)
```

### Planner Integration Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Request                                             │
│    "Update the incident with priority 1"                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Intent Classification + Entity Extraction                │
│    Intent: incident_management                              │
│    Entities: {priority: 1}  ← MISSING: incident_number     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Plan Feasibility Analysis                                │
│    analyze_plan_feasibility()                               │
│    Result: needs_clarification=True                         │
│    Reason: missing_required_parameter (incident_number)     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Generate Clarification                                   │
│    "Which incident would you like to update?"               │
│    Hints: "Provide incident number (e.g., INC0010003)"     │
│    State ID: clarify_incident_management_...                │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Return Clarification to User (NO EXECUTION)              │
│    Tool: general_clarification_request                      │
│    Metadata: awaiting_clarification=True                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. User Responds                                            │
│    Response: "INC0010003"                                   │
│    Metadata: clarification_state_id=clarify_...             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Process Clarification Response                           │
│    Enriched question: "Update the incident                  │
│                        [Clarified: incident_number=...]"    │
│    Enriched entities: {priority: 1, incident_number: ...}   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Generate Plan with Complete Context                      │
│    Planner has all required information                     │
│    Confidence: 0.95                                         │
│    Plan: [update_incident(INC0010003, priority=1)]          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. Execute Plan                                             │
│    Result: Incident INC0010003 priority updated to P1       │
└─────────────────────────────────────────────────────────────┘
```

---

## Usage Examples

### Example 1: Missing Parameter

```python
# User: "Show me the work notes"
# Analysis: Missing incident_number

analysis = engine.analyze_plan_feasibility(
    question="Show me the work notes",
    detected_intent="incident_management",
    extracted_entities={},  # No entities extracted
    available_tools=["fetch_incident", "get_incident_work_notes"],
    context_messages=[],
    planner_confidence=0.3
)

# Result:
{
    "needs_clarification": True,
    "triggers": ["missing_required_parameter"],
    "missing_params": ["incident_number"],
    "suggested_clarifications": ["missing_incident_number"]
}

# Clarification:
{
    "clarification_text": "I need some additional information to proceed:\n\n",
    "questions": [
        {
            "id": "param_incident_number",
            "question": "Which incident's work notes would you like to see?",
            "hint": "Provide the incident number (e.g., INC0010003)",
            "required": True
        }
    ]
}

# User responds: "INC0010003"

# Enriched:
{
    "enriched_question": "Show me the work notes [Clarified: incident_number=INC0010003]",
    "enriched_entities": {"incident_number": "INC0010003"},
    "ready_to_plan": True
}
```

---

### Example 2: Critical Action Confirmation

```python
# User: "Deploy to production"
# Analysis: Critical action needs confirmation

analysis = engine.analyze_plan_feasibility(
    question="Deploy to production",
    detected_intent="deployment",
    extracted_entities={"environment": "production"},
    available_tools=["deploy_service", "rollback_service"],
    context_messages=[],
    planner_confidence=0.9
)

# Result:
{
    "needs_clarification": True,
    "triggers": ["need_user_confirmation"],
    "suggested_clarifications": ["confirmation"]
}

# Clarification (CRITICAL priority):
{
    "clarification_text": "⚠️ **Critical Decision Required**\n\n",
    "questions": [
        {
            "id": "confirmation_deploy",
            "question": "⚠️ You're deploying to **production**. This is irreversible. Confirm?",
            "type": "confirmation",
            "options": ["Yes, deploy", "No, cancel", "Show deployment plan first"],
            "required": True
        }
    ],
    "priority": "critical"
}

# User responds: "No, cancel"

# Enriched:
{
    "enriched_question": "Deploy to production [Clarified: Confirmed: False]",
    "enriched_metadata": {"user_confirmed": False},
    "ready_to_plan": False,  # CANCELLED
    "cancelled": True,
    "reason": "User cancelled operation"
}
```

---

### Example 3: Multiple Execution Paths

```python
# User: "Analyze the code"
# Analysis: Multiple analysis types available

analysis = engine.analyze_plan_feasibility(
    question="Analyze the code",
    detected_intent="code_analysis",
    extracted_entities={"repository": "snowchat"},
    available_tools=["security_scan", "performance_analysis", "code_quality"],
    context_messages=[],
    planner_confidence=0.5
)

# Result:
{
    "needs_clarification": True,
    "triggers": ["multiple_execution_paths"],
    "suggested_clarifications": ["execution_path"]
}

# Clarification:
{
    "questions": [
        {
            "id": "path_analysis_type",
            "question": "What type of code analysis?",
            "type": "execution_path",
            "options": [
                {"id": "security", "label": "Security vulnerabilities"},
                {"id": "performance", "label": "Performance issues"},
                {"id": "code_quality", "label": "Code quality metrics"},
                {"id": "comprehensive", "label": "Comprehensive analysis"}
            ]
        }
    ]
}

# User responds: "security"

# Enriched:
{
    "enriched_question": "Analyze the code [Clarified: Approach: security]",
    "enriched_metadata": {"execution_path": "security"},
    "ready_to_plan": True
}
```

---

## Adding New Intent Templates

### Step 1: Define Template

Edit `CLARIFICATION_TEMPLATES` in `general_clarification_engine.py`:

```python
"your_new_intent": {
    "missing_your_param": {
        "trigger": ClarificationTrigger.MISSING_REQUIRED_PARAM,
        "type": ClarificationType.PARAMETER_VALUE,
        "question": "What value for {param_name}?",
        "hints": ["Hint 1", "Hint 2"],
        "required_for": ["tool1", "tool2"]
    },
    "your_confirmation": {
        "trigger": ClarificationTrigger.NEED_CONFIRMATION,
        "type": ClarificationType.CONFIRMATION,
        "question": "Confirm {action}?",
        "options": ["Yes", "No"],
        "critical": True
    }
}
```

### Step 2: Update Required Params

Add to `_get_required_params_for_intent()`:

```python
intent_requirements = {
    "your_new_intent": ["required_param1", "required_param2"],
    # ... existing intents
}
```

### Step 3: Test

```python
engine = GeneralClarificationEngine()
analysis = engine.analyze_plan_feasibility(
    question="Your test question",
    detected_intent="your_new_intent",
    extracted_entities={},
    available_tools=["tool1", "tool2"],
    context_messages=[],
    planner_confidence=0.8
)

assert analysis['needs_clarification'] == True
assert 'required_param1' in analysis['missing_params']
```

---

## Orchestrator Integration Code

### In `langgraph_flow.py`

```python
from .general_clarification_engine import (
    should_request_clarification,
    generate_clarification,
    get_general_clarification_engine
)

def determine_function_sequence(command: Command, annotation: str, metadata: dict):
    question = command.question
    
    # Check if this is a clarification response
    clarification_state_id = metadata.get('clarification_state_id')
    
    if clarification_state_id:
        # Process clarification response
        engine = get_general_clarification_engine()
        responses = metadata.get('clarification_responses', {})
        
        enriched = engine.process_clarification_responses(
            clarification_state_id,
            responses
        )
        
        if not enriched['ready_to_plan']:
            if enriched.get('cancelled'):
                return {"error": enriched['reason'], "cancelled": True}
            else:
                return {"error": enriched.get('error', 'Incomplete clarification')}
        
        # Update command with enriched data
        command.question = enriched['enriched_question']
        command.metadata.update(enriched['enriched_metadata'])
        # Continue to planning with enriched context...
    
    # BEFORE planning, check if clarification needed
    context_messages = metadata.get('context_messages', [])
    detected_intent = classify_intent(question)  # Your intent classifier
    extracted_entities = extract_entities(question)  # Your entity extractor
    available_tools = get_tools_for_intent(detected_intent)
    
    # Analyze plan feasibility
    if should_request_clarification(
        question,
        detected_intent,
        extracted_entities,
        available_tools,
        context_messages,
        planner_confidence=0.8  # From your planner
    ):
        clarification = generate_clarification(
            question,
            detected_intent,
            extracted_entities,
            available_tools,
            context_messages
        )
        
        # Return clarification request (don't execute)
        command.function_sequence = [{
            "function_name": "general_clarification_request",
            "arguments": clarification
        }]
        command.metadata['awaiting_clarification'] = True
        command.metadata['clarification_state_id'] = clarification['state_id']
        return command
    
    # Otherwise proceed with normal planning
    # ... existing planning logic ...
```

### New Tool Registration

In `snowaaonetool.py`:

```python
@register_tool_function("general_clarification_request")
def general_clarification_request(
    clarification_text: str,
    questions: List[Dict],
    state_id: str,
    priority: str,
    intent: str
):
    """Present general clarification questions to user."""
    logger.info(
        f"[GeneralClarify] Presenting clarification | intent={intent} "
        f"priority={priority} questions={len(questions)}"
    )
    
    # Format questions for display
    formatted_text = clarification_text
    
    for i, q in enumerate(questions, 1):
        formatted_text += f"\n**{i}. {q['question']}**\n"
        
        if q.get('options'):
            for j, opt in enumerate(q['options'], 1):
                label = opt['label'] if isinstance(opt, dict) else opt
                formatted_text += f"   {j}. {label}\n"
        
        if q.get('hint'):
            formatted_text += f"   *{q['hint']}*\n"
    
    formatted_text += f"\n*[Session ID: {state_id}]*"
    
    return {
        "summary": formatted_text,
        "clarification_state_id": state_id,
        "awaiting_clarification": True,
        "priority": priority,
        "intent": intent,
        "questions": questions
    }
```

---

## Key Differences: Wiki vs General

| Aspect | Wiki Clarification | General Clarification |
|--------|-------------------|----------------------|
| **Scope** | Wiki searches only | Any intent/tool |
| **Trigger** | Low clarity score (<0.5) | Missing params, ambiguities, critical actions |
| **Questions** | Topic selection, keyword focus | Parameter values, confirmations, path selection |
| **Templates** | Fixed (6 topic options) | Intent-specific, extensible |
| **Integration** | `@wiki` annotation only | Before ANY plan generation |
| **State** | Wiki-specific state | Intent + question tracking |
| **Correlation** | Wiki findings → question | Enriched entities → planner |

---

## Future Enhancements

### Phase 2
1. **TinyDB Persistence**: Survive backend restarts
2. **Multi-Turn Clarification**: Ask follow-up questions if needed
3. **Dynamic Option Generation**: Populate options from live data (recent incidents, available repos)
4. **Confidence-Based Triggers**: Auto-adjust thresholds based on planner feedback
5. **Clarification History**: Learn which questions lead to successful plans

### Phase 3
1. **Natural Language Responses**: Accept freeform answers, not just option numbers
2. **Contextual Pre-filling**: Suggest values from conversation history
3. **Persona-Aware Clarifications**: Different question styles for PO/Dev/Agent
4. **Batch Clarifications**: Group multiple related questions
5. **Analytics Dashboard**: Track clarification effectiveness metrics

---

## Testing Strategy

### Unit Tests
```python
def test_missing_parameter_detection():
    engine = GeneralClarificationEngine()
    analysis = engine.analyze_plan_feasibility(
        question="Update the incident",
        detected_intent="incident_management",
        extracted_entities={},  # No incident_number
        available_tools=["update_incident"],
        context_messages=[],
        planner_confidence=1.0
    )
    assert analysis['needs_clarification'] == True
    assert 'incident_number' in analysis['missing_params']

def test_critical_action_confirmation():
    engine = GeneralClarificationEngine()
    analysis = engine.analyze_plan_feasibility(
        question="Deploy to production",
        detected_intent="deployment",
        extracted_entities={"environment": "production"},
        available_tools=["deploy"],
        context_messages=[],
        planner_confidence=1.0
    )
    assert analysis['needs_clarification'] == True
    assert ClarificationTrigger.NEED_CONFIRMATION.value in analysis['triggers']
```

### Integration Tests
```python
def test_end_to_end_clarification():
    engine = GeneralClarificationEngine()
    
    # 1. Analyze
    analysis = engine.analyze_plan_feasibility(...)
    assert analysis['needs_clarification'] == True
    
    # 2. Generate clarification
    clarification = engine.generate_clarification_request(...)
    state_id = clarification['state_id']
    
    # 3. Simulate user response
    responses = {"param_incident_number": "INC0010003"}
    enriched = engine.process_clarification_responses(state_id, responses)
    
    # 4. Verify enrichment
    assert enriched['ready_to_plan'] == True
    assert enriched['enriched_entities']['incident_number'] == "INC0010003"
```

---

## Summary

The **General Clarification Framework** transforms DevCopilot from a "best-effort planner" into an **intelligent assistant that knows when to ask for help**.

**Key Innovation**: Universal applicability - works for ANY intent, not just wiki searches.

**Benefits**:
- ✅ Prevents failed plans due to missing information
- ✅ Reduces user frustration from ambiguous responses
- ✅ Catches critical actions before irreversible execution
- ✅ Improves planner confidence through context enrichment
- ✅ Extensible via intent-specific templates

**Implementation Complete**: Framework ready for integration into planner workflow.
