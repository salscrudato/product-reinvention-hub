# ServiceNow Tool Integration Guide
**How New Agents Are Discovered & Orchestrated**

## The Integration Flow

Your question is **critical** - I need to show you the complete integration path from tool implementation to agentic execution. Here's the actual architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Tool Discovery & Execution Flow                  │
└─────────────────────────────────────────────────────────────────────┘

1. IMPLEMENTATION (servicenowgenaitool.py)
   ├── Implement core function: get_incident_work_notes_core()
   └── Add Flask route: @blueprint.route('/get_incident_work_notes')

2. REGISTRATION (snowaaonetool.py)
   ├── Import: from .servicenowgenaitool import get_incident_work_notes_core
   ├── Decorate: @register_tool_function("get_incident_work_notes")
   └── Creates entry: FUNCTION_REGISTRY["get_incident_work_notes"] = func

3. DISCOVERY (shared_registry.py)
   ├── FUNCTION_REGISTRY = {} ← Central registry loaded at runtime
   ├── Auto-registration via inspect.getmembers() for module functions
   └── Decorator pattern: @register_tool_function adds to registry

4. PLANNING (agentic_orchestrator_auto.py → planner_selector.py)
   ├── Planner imports: from .shared_registry import FUNCTION_REGISTRY
   ├── Tool discovery: available_tools = list(FUNCTION_REGISTRY.keys())
   ├── Tool metadata sent to LLM: {"name": "get_incident_work_notes", "description": ...}
   └── LLM generates plan: [{"function_name": "get_incident_work_notes", "arguments": {...}}]

5. EXECUTION (agentic_orchestrator_auto.py._execute_step())
   ├── Step lookup: func = FUNCTION_REGISTRY.get("get_incident_work_notes")
   ├── Invocation: result = func(**arguments)
   ├── Storage: self.tool_outputs["get_incident_work_notes"] = result
   └── Trace logging: execution time, status, output preview

6. LANGGRAPH ORCHESTRATION (langgraph_flow.py - if ENABLE_LANGGRAPH=1)
   ├── Imports: from .shared_registry import FUNCTION_REGISTRY
   ├── Node execution: func_entry = FUNCTION_REGISTRY[function_name]
   └── State management: Updates Command.results[function_name]
```

---

## Critical Code Locations

### Location 1: agentic_orchestrator_auto.py (Line 747-763)
**Where FUNCTION_REGISTRY is loaded for planning:**

```python
# Line 747-763 (agentic_orchestrator_auto.py)
try:
    from .shared_registry import FUNCTION_REGISTRY  # type: ignore
except Exception:  # pragma: no cover
    FUNCTION_REGISTRY = {}  # type: ignore

# Validate retrieval_subset_tools against registry
valid_retrieval_tools: List[str] = []
for fn in retrieval_subset_tools:
    if fn not in FUNCTION_REGISTRY:
        logger.warning(f"FLOW[PLAN] Retrieval tool '{fn}' not found in FUNCTION_REGISTRY, skipping.")
        missing_tools.append(fn)
    else:
        valid_retrieval_tools.append(fn)
```

**What this means:** The orchestrator imports FUNCTION_REGISTRY and validates tool names against it before planning.

### Location 2: agentic_orchestrator_auto.py (Line 999-1002)
**Where tools are invoked during execution:**

```python
# Line 999-1002 (agentic_orchestrator_auto.py)
try:
    from .shared_registry import FUNCTION_REGISTRY  # type: ignore
except Exception:
    FUNCTION_REGISTRY = {}  # type: ignore
registry_entry = FUNCTION_REGISTRY.get(fname)
```

**What this means:** During execution, each step looks up the function in FUNCTION_REGISTRY by name and invokes it.

### Location 3: langgraph_flow.py (Line 20)
**Where LangGraph imports the registry:**

```python
# Line 20 (langgraph_flow.py)
from .shared_registry import FUNCTION_REGISTRY  # Import FUNCTION_REGISTRY from shared_registry
```

**What this means:** The LangGraph execution engine also uses FUNCTION_REGISTRY for tool discovery.

### Location 4: langgraph_flow.py (Line 574)
**Where LangGraph executes tools:**

```python
# Line 574 (langgraph_flow.py)
func_entry = FUNCTION_REGISTRY[function_name]
```

**What this means:** When a LangGraph node executes, it looks up tools in FUNCTION_REGISTRY.

### Location 5: snowaaonetool.py (Line 40-47)
**The decorator that registers tools:**

```python
# Line 40-47 (snowaaonetool.py)
def register_tool_function(name):
    """
    Decorator to register a function in the shared FUNCTION_REGISTRY.
    """
    def decorator(func):
        FUNCTION_REGISTRY[name] = func
        return func
    return decorator
```

**What this means:** Any function decorated with `@register_tool_function("name")` is automatically added to FUNCTION_REGISTRY.

---

## The Complete Registration Pattern

### Step 1: Implement Core Function (servicenowgenaitool.py)

```python
# backend/components/servicenowgenaitool.py

def get_incident_work_notes_core(incident_number: str, include_empty: bool = False) -> Dict[str, Any]:
    """
    Extract work_notes field from a ServiceNow incident.
    
    Args:
        incident_number: Incident number (e.g., INC0010013)
        include_empty: Return {"work_notes": "No work notes"} vs error if empty
    
    Returns:
        Dict with incident_number, work_notes, work_notes_count, last_updated
    """
    incident = fetch_servicenow_incident_core(incident_number)
    if not incident or "error" in incident:
        return {"error": "Incident not found"}
    
    work_notes = incident.get("work_notes", "")
    work_notes_list = incident.get("work_notes_list", "")
    
    if not work_notes and not work_notes_list:
        if include_empty:
            return {
                "incident_number": incident_number,
                "work_notes": "No work notes recorded",
                "work_notes_count": 0
            }
        return {"error": "No work notes found"}
    
    return {
        "incident_number": incident_number,
        "work_notes": work_notes or work_notes_list,
        "work_notes_count": len([x for x in (work_notes or work_notes_list).split('\n') if x.strip()]),
        "last_updated": incident.get("sys_updated_on")
    }


# Add Flask route for direct API access (optional but recommended)
@blueprint.route('/get_incident_work_notes', methods=['GET'])
def get_incident_work_notes():
    incident_number = request.args.get('incident_number')
    include_empty = request.args.get('include_empty', 'false').lower() == 'true'
    return jsonify(get_incident_work_notes_core(incident_number, include_empty))
```

### Step 2: Register with Decorator (snowaaonetool.py)

```python
# backend/components/snowaaonetool.py

# Import the core function
from .servicenowgenaitool import get_incident_work_notes_core

# Import the registry and decorator
from .shared_registry import FUNCTION_REGISTRY

def register_tool_function(name):
    """Decorator to register a function in the shared FUNCTION_REGISTRY."""
    def decorator(func):
        FUNCTION_REGISTRY[name] = func
        return func
    return decorator


# Register the tool with decorator
@register_tool_function("get_incident_work_notes")
def get_incident_work_notes_wrapper(incident_number: str, include_empty: bool = False):
    """
    Agent-facing wrapper for work notes extraction.
    
    This function is registered in FUNCTION_REGISTRY and is discoverable by:
    - agentic_orchestrator_auto.py (for planning & execution)
    - langgraph_flow.py (for graph-based execution)
    - planner_selector.py (for tool metadata generation)
    
    The planner will see this as an available tool with description:
    "Extract work_notes field from a ServiceNow incident. Returns formatted 
    work notes or indicates if none exist."
    """
    return get_incident_work_notes_core(incident_number, include_empty)


# IMPORTANT: Add docstring with tool description for planner
get_incident_work_notes_wrapper.__doc__ = """
Extract work_notes field from a ServiceNow incident.

Args:
    incident_number (str): ServiceNow incident number (e.g., INC0010013)
    include_empty (bool): Return "No work notes" message if field is empty (default: False)

Returns:
    dict: {
        "incident_number": str,
        "work_notes": str,
        "work_notes_count": int,
        "last_updated": str (optional)
    }

Use this tool when:
- User asks to "show work notes"
- User wants to "summarize work notes" (call this first to get content)
- User needs incident activity history
"""
```

### Step 3: Verify Registration (Python Console)

```python
# In Python console or test script:
from backend.components.shared_registry import FUNCTION_REGISTRY

# Check if tool is registered
print("get_incident_work_notes" in FUNCTION_REGISTRY)  # Should print: True

# List all registered tools
print(list(FUNCTION_REGISTRY.keys()))
# Output: ['find_incidents_by_short_description', 'wiki_rag_tool', 
#          'get_incident_work_notes', ...]

# Get tool metadata
tool_func = FUNCTION_REGISTRY['get_incident_work_notes']
print(tool_func.__doc__)  # Shows docstring for planner
```

---

## How the Planner Discovers Tools

### Planner Integration (planner_selector.py or unified_planner.py)

The planner needs to know **what tools exist** and **how to use them**. Here's how it discovers your new tools:

```python
# backend/components/planner_selector.py (or unified_planner.py)

from .shared_registry import FUNCTION_REGISTRY
import json

def generate_tool_descriptions() -> str:
    """
    Generate a JSON list of available tools with descriptions for the LLM planner.
    
    The LLM receives this in the system prompt to know what tools it can call.
    """
    tool_list = []
    
    for tool_name, tool_func in FUNCTION_REGISTRY.items():
        # Extract docstring for description
        description = (tool_func.__doc__ or "No description available").strip()
        
        # Extract function signature for argument hints
        import inspect
        sig = inspect.signature(tool_func)
        params = {}
        for param_name, param in sig.parameters.items():
            param_type = param.annotation if param.annotation != inspect.Parameter.empty else "any"
            param_default = param.default if param.default != inspect.Parameter.empty else None
            params[param_name] = {
                "type": str(param_type),
                "required": param.default == inspect.Parameter.empty,
                "default": param_default
            }
        
        tool_list.append({
            "name": tool_name,
            "description": description,
            "parameters": params
        })
    
    return json.dumps(tool_list, indent=2)


def select_and_plan(question: str, prompt: str, metadata: Dict[str, Any], username: Optional[str] = None):
    """
    Generate an execution plan using the LLM with knowledge of all available tools.
    
    This function is called by agentic_orchestrator_auto.py during planning phase.
    """
    # Get tool descriptions
    available_tools_json = generate_tool_descriptions()
    
    # Build system prompt with tool catalog
    system_prompt = f"""You are a ServiceNow incident management AI assistant.

Available Tools:
{available_tools_json}

User Question: {question}

Generate a step-by-step plan using ONLY the tools listed above.
Return a JSON array of steps in this format:
[
  {{
    "function_name": "tool_name",
    "arguments": {{"arg1": "value1", "arg2": "value2"}},
    "rationale": "Why this step is needed"
  }}
]
"""
    
    # Call LLM to generate plan
    response = openai.chat.completions.create(
        model=GPT_MODEL_NAME,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question}
        ],
        temperature=0.0
    )
    
    plan_json = response.choices[0].message.content
    plan = json.loads(plan_json)
    
    return plan, {}, "llm_planner"
```

**Key Insight:** The planner calls `generate_tool_descriptions()` which iterates `FUNCTION_REGISTRY.items()` and extracts:
1. **Tool name** (the key in FUNCTION_REGISTRY)
2. **Tool description** (from the function's `__doc__` string)
3. **Parameter schema** (from function signature via `inspect.signature()`)

This metadata is sent to the LLM, which generates a plan using only those tools.

---

## How LangGraph Executes Tools

### LangGraph Workflow (langgraph_flow.py)

When `ENABLE_LANGGRAPH=1`, the system uses LangGraph for execution:

```python
# backend/components/langgraph_flow.py

from .shared_registry import FUNCTION_REGISTRY

def execute_function_node(state: Command) -> Command:
    """
    LangGraph node that executes a single function from the plan.
    
    Called by: StateGraph workflow when transitioning through plan steps
    """
    if not state.function_sequence:
        return state  # No more steps
    
    # Pop next step from plan
    step = state.function_sequence.pop(0)
    function_name = step.get("function_name") or step.get("tool")
    arguments = step.get("arguments") or step.get("args", {})
    
    logger.info(f"[LangGraph] Executing step: {function_name} with args: {arguments}")
    
    # Look up function in registry
    if function_name not in FUNCTION_REGISTRY:
        error_msg = f"Tool '{function_name}' not found in FUNCTION_REGISTRY"
        logger.error(f"[LangGraph] {error_msg}")
        state.errors.append(error_msg)
        return state
    
    # Get function from registry
    func_entry = FUNCTION_REGISTRY[function_name]
    
    # Execute function
    try:
        result = func_entry(**arguments)
        state.update_result(function_name, result)
        logger.info(f"[LangGraph] Step {function_name} completed successfully")
    except Exception as e:
        error_msg = f"Execution failed for {function_name}: {e}"
        logger.error(f"[LangGraph] {error_msg}")
        state.errors.append(error_msg)
    
    return state


# LangGraph workflow definition
def build_workflow():
    """
    Build the StateGraph for agentic execution.
    
    The graph has nodes for:
    - planner: Generates initial plan
    - executor: Executes each step (calls execute_function_node)
    - done: Final answer synthesis
    """
    workflow = StateGraph(Command)
    
    workflow.add_node("planner", planner_node)
    workflow.add_node("executor", execute_function_node)
    workflow.add_node("done", done_node)
    
    workflow.add_edge("planner", "executor")
    workflow.add_conditional_edges(
        "executor",
        lambda state: "executor" if state.function_sequence else "done"
    )
    workflow.add_edge("done", END)
    
    return workflow.compile()
```

**Key Insight:** LangGraph uses the **same FUNCTION_REGISTRY** as the sequential orchestrator, ensuring consistent tool discovery regardless of execution mode.

---

## Ensuring Your Tools Are Available

### Checklist for New Tool Integration

✅ **Step 1: Import Cascade**
Ensure your module is imported so registration happens at startup:

```python
# backend/components/agentic_orchestrator_auto.py (Line 85)
from . import mapping_agents  # noqa: F401 ensure mapping tools register on import

# ADD YOUR MODULE HERE if it has @register_tool_function decorators:
from . import snowaaonetool  # Imports trigger decorator execution
from . import DataDogTools  # Example: DataDog tools auto-register on import
```

✅ **Step 2: Verify Registration at Runtime**
Add logging to confirm registration:

```python
# backend/components/snowaaonetool.py

def register_tool_function(name):
    """Decorator to register a function in the shared FUNCTION_REGISTRY."""
    def decorator(func):
        FUNCTION_REGISTRY[name] = func
        logger.info(f"[REGISTRY] Registered tool: {name}")  # ADD THIS
        return func
    return decorator
```

✅ **Step 3: Test Registration Endpoint**
Create a debug endpoint to inspect FUNCTION_REGISTRY:

```python
# backend/components/servicenowgenaitool.py

@blueprint.route('/debug/list_tools', methods=['GET'])
def debug_list_tools():
    """Debug endpoint to list all registered tools."""
    from .shared_registry import FUNCTION_REGISTRY
    
    tools = []
    for name, func in FUNCTION_REGISTRY.items():
        tools.append({
            "name": name,
            "description": (func.__doc__ or "").strip()[:200],
            "module": func.__module__,
            "callable": callable(func)
        })
    
    return jsonify({
        "total_tools": len(tools),
        "tools": sorted(tools, key=lambda x: x["name"])
    })
```

**Test it:**
```bash
curl http://localhost:5000/servicenowgenaitool/debug/list_tools | jq '.tools[] | .name'
```

✅ **Step 4: Verify Planner Sees Tools**
Add logging in planner to confirm tool discovery:

```python
# backend/components/planner_selector.py (or wherever planning happens)

def select_and_plan(question, prompt, metadata, username=None):
    from .shared_registry import FUNCTION_REGISTRY
    
    available_tools = list(FUNCTION_REGISTRY.keys())
    logger.info(f"[PLANNER] Available tools for planning: {available_tools}")
    
    # ... rest of planning logic
```

✅ **Step 5: Monitor Execution Logs**
Watch for tool invocation in logs:

```bash
# Watch orchestrator logs for your new tool
tail -f backend/agentic_orchestrator_auto.log | grep "get_incident_work_notes"

# Expected output:
# 2026-01-19 14:45:23 INFO FLOW[EXEC_STEP_START] Step 2: get_incident_work_notes (incident_number=INC0010013)
# 2026-01-19 14:45:24 INFO FLOW[EXEC_STEP_END] Step 2 completed (1.2s)
```

---

## Common Integration Pitfalls

### ❌ Pitfall 1: Tool Not Imported
**Problem:** Decorated function never imported, so decorator never executes.

```python
# DON'T DO THIS:
# If you define a tool in new_tools.py but never import new_tools.py,
# the @register_tool_function decorator never runs!

# FIX: Add import to agentic_orchestrator_auto.py or app.py
from . import new_tools  # Triggers registration
```

### ❌ Pitfall 2: Circular Import
**Problem:** Importing FUNCTION_REGISTRY causes circular dependency.

```python
# DON'T DO THIS:
# shared_registry.py imports snowaaonetool.py
# snowaaonetool.py imports shared_registry.py
# Result: ImportError or empty FUNCTION_REGISTRY

# FIX: Use late binding (import inside function):
def my_tool():
    from .shared_registry import FUNCTION_REGISTRY  # Import at call time
    other_tool = FUNCTION_REGISTRY['other_tool']
```

### ❌ Pitfall 3: Docstring Missing
**Problem:** Planner has no description for your tool, generates poor plans.

```python
# DON'T DO THIS:
@register_tool_function("my_tool")
def my_tool(arg1, arg2):
    return do_something(arg1, arg2)

# FIX: Add detailed docstring:
@register_tool_function("my_tool")
def my_tool(arg1, arg2):
    """
    Short one-line description.
    
    Args:
        arg1: What this argument does
        arg2: What this argument does
    
    Returns:
        Description of return value
    
    Use when: Situations where this tool is appropriate
    """
    return do_something(arg1, arg2)
```

### ❌ Pitfall 4: Inconsistent Naming
**Problem:** Planner uses one name, registry has another.

```python
# DON'T DO THIS:
@register_tool_function("getWorkNotes")  # camelCase
def get_work_notes_core():  # snake_case function name
    pass

# FIX: Use consistent snake_case:
@register_tool_function("get_work_notes")  # snake_case everywhere
def get_work_notes_core():
    pass
```

---

## Validation Script

Create this script to verify tool registration:

```python
# backend/scripts/verify_tool_registration.py

import sys
sys.path.insert(0, '../')

from components.shared_registry import FUNCTION_REGISTRY
from components import snowaaonetool  # Trigger registration
from components import servicenowgenaitool  # Trigger registration
from components import DataDogTools  # Trigger registration

def verify_tools():
    """Verify all expected tools are registered."""
    
    expected_tools = [
        "find_incidents_by_short_description",
        "wiki_rag_tool",
        "get_incident_work_notes",  # NEW TOOL
        "summarize_incident_work_notes",  # NEW TOOL
        "get_incidents_created_today",  # NEW TOOL
        "query_incidents_by_date",  # NEW TOOL
    ]
    
    print(f"Total registered tools: {len(FUNCTION_REGISTRY)}")
    print(f"\nAll registered tools:")
    for name in sorted(FUNCTION_REGISTRY.keys()):
        print(f"  ✓ {name}")
    
    print(f"\nVerifying expected tools:")
    missing = []
    for tool in expected_tools:
        if tool in FUNCTION_REGISTRY:
            print(f"  ✓ {tool}")
        else:
            print(f"  ✗ {tool} MISSING")
            missing.append(tool)
    
    if missing:
        print(f"\n❌ {len(missing)} tools not registered!")
        return False
    else:
        print(f"\n✅ All expected tools registered successfully!")
        return True

if __name__ == "__main__":
    success = verify_tools()
    sys.exit(0 if success else 1)
```

**Run it:**
```bash
cd backend
python scripts/verify_tool_registration.py
```

---

## Summary: The Registration Contract

### For the Tool to Be Available to Agentic Orchestration:

1. **Implementation:** Function exists in servicenowgenaitool.py
2. **Registration:** Function wrapped and decorated with `@register_tool_function("name")` in snowaaonetool.py
3. **Import:** Module containing decorator is imported (snowaaonetool imported by agentic_orchestrator_auto)
4. **Discovery:** FUNCTION_REGISTRY accessed by planner and executor
5. **Documentation:** Docstring provides metadata for LLM planner
6. **Validation:** Tool name in FUNCTION_REGISTRY matches name in plan steps

### The Flow Guarantees:

✅ **Planning Phase:** Planner queries `FUNCTION_REGISTRY.keys()` → sees your tool  
✅ **LLM Receives:** Tool name + description + parameter schema → generates valid plan  
✅ **Execution Phase:** `FUNCTION_REGISTRY.get("your_tool")` → returns callable  
✅ **Invocation:** `func(**arguments)` → executes your implementation  
✅ **Results:** Output stored in `tool_outputs["your_tool"]` → available to subsequent steps  
✅ **LangGraph Mode:** Same FUNCTION_REGISTRY used → consistent behavior

---

## Next Steps

Now that you understand the integration path, I'll implement the first 6 priority tools following this pattern. Each tool will:

1. ✅ Be implemented in servicenowgenaitool.py
2. ✅ Be registered via decorator in snowaaonetool.py
3. ✅ Have complete docstring for planner discovery
4. ✅ Be validated with verification script
5. ✅ Be tested with your exact failed queries

Ready to proceed with implementation?
