import os
from typing import List, Dict, Any, Tuple, TYPE_CHECKING

# Optional dependency handling: during type checking we attempt import for hints;
# at runtime absence is tolerated and lightweight stubs are provided to silence linters.
if TYPE_CHECKING:  # pragma: no cover
    try:
        from crewai import Agent, Task, Crew  # type: ignore
    except Exception:  # type: ignore
        class Agent:  # type: ignore
            ...
        class Task:  # type: ignore
            ...
        class Crew:  # type: ignore
            ...
else:  # runtime path
    try:  # pragma: no cover - best effort import
        from crewai import Agent, Task, Crew  # type: ignore
    except Exception:  # If crewai not installed, define minimal stubs
        class Agent:  # type: ignore
            pass
        class Task:  # type: ignore
            pass
        class Crew:  # type: ignore
            pass

from .shared_registry import FUNCTION_REGISTRY
from .persona_registry import PERSONA_DEFS

"""CrewAI Adapter
Provides a lightweight abstraction to build a Crew plan that mirrors our existing
function_call and langgraph planners. Instead of executing the crew (which would
invoke LLMs), we translate prompt + question into a deterministic sequence of tool
calls using keyword heuristics so that tests remain stable.

Runtime selection via PLANNER_MODE=crewai will invoke build_crewai_plan which returns
(plan, diagnostics, 'crewai').
"""

# Simple keyword to tool mapping heuristics (extend as needed)
KEYWORD_TOOL_RULES = [
    (['@wiki', 'runbook', 'policy', 'checklist', 'documentation', 'doc '], 'wiki_rag_tool'),
    (['@code', 'code ', 'logic', 'implementation', 'retry', 'feature flag'], 'code_annotation_tool'),
    (['workaround', 'temporary fix'], 'find_incidents_by_short_description'),
    (['similar incidents', 'duplicate', 'similar to'], 'get_similar_incidents'),
    (['assignment group', 'who owns', 'who should own'], 'fetch_servicenow_incident'),
    (['INC0'], 'fetch_servicenow_incident'),
]


def infer_tools(question: str) -> List[str]:
    ql = question.lower()
    tools: List[str] = []
    # If an explicit incident number exists, bias to fetch before other heuristics
    import re
    if re.search(r"inc0*\d+", ql):
        tools.append('fetch_servicenow_incident')
    for keywords, tool in KEYWORD_TOOL_RULES:
        if any(k in ql for k in keywords):
            if tool not in tools:
                tools.append(tool)
    if not tools:
        tools.append('find_incidents_by_short_description')
    return tools


def build_crewai_plan(question: str, prompt: str, metadata: Dict[str, Any], username=None) -> Tuple[List[Dict[str, Any]], Dict[str, Any], str]:
    persona_key = (metadata or {}).get('persona') if metadata else None
    persona_tools = set()
    if persona_key and persona_key in PERSONA_DEFS:
        persona_tools = set(PERSONA_DEFS[persona_key].get('tools', []))
    selected = infer_tools(question)
    if persona_tools:
        # keep order while filtering
        selected = [t for t in selected if t in persona_tools]
        if not selected:
            # Fallback: choose first two persona tools deterministically
            selected = list(persona_tools)[:2]
    plan: List[Dict[str, Any]] = []
    diagnostics = {"selected_tools": selected, "heuristic": True, "persona": persona_key}
    for tool_name in selected:
        if tool_name not in FUNCTION_REGISTRY:
            diagnostics.setdefault('unknown_tools', []).append(tool_name)
            continue
        args: Dict[str, Any] = {}
        if tool_name in ('fetch_servicenow_incident', 'fetch_servicenow_incident_core'):
            import re
            m = re.search(r'(INC0*\d+)', question, flags=re.IGNORECASE)
            if m:
                args['incident_number'] = m.group(1).upper()
            else:
                args['incident_number'] = 'INC0000001'
        elif tool_name == 'find_incidents_by_short_description':
            # crude extraction ensuring non-empty
            snippet = question.strip() or 'generic issue'
            args['short_description'] = snippet[:120]
        elif tool_name == 'get_similar_incidents':
            import re
            m = re.search(r'(INC0*\d+)', question, flags=re.IGNORECASE)
            if m:
                args['incident_number'] = m.group(1).upper()
            else:
                args['short_description'] = question[:100]
        elif tool_name == 'wiki_rag_tool':
            args['question'] = question
        elif tool_name == 'code_annotation_tool':
            args['question'] = question
        plan.append({"function_name": tool_name, "arguments": args})
    return plan, diagnostics, 'crewai'

__all__ = ['build_crewai_plan']
