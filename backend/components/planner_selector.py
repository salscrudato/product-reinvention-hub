import os
from typing import List, Dict, Any, Tuple, Optional

from .plan_sanitizer import sanitize_plan
from .shared_registry import FUNCTION_REGISTRY
from .crewai_adapter import build_crewai_plan


def plan_with_langgraph(question: str, prompt: str, metadata: dict, username=None, retrieval_subset_tools: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    from .langgraph_flow import process_question_with_prompt_and_metadata
    result = process_question_with_prompt_and_metadata(question, prompt, metadata, username=username, agentic_mode=True, retrieval_subset_tools=retrieval_subset_tools)
    # result may be dict with function_sequence or list already
    if isinstance(result, dict):
        seq = result.get('function_sequence') or result.get('plan') or []
    elif isinstance(result, list):
        seq = result
    else:
        seq = getattr(result, 'function_sequence', []) or []
    return seq


def plan_with_function_call(question: str) -> Tuple[List[Dict[str, Any]], dict]:
    from .function_call_planner import plan_with_function_call as _fc, build_messages_from_question
    return _fc(build_messages_from_question(question))


def select_and_plan(question: str, prompt: str, metadata: dict, username=None, mode: Optional[str] = None, retrieval_subset_tools: Optional[List[str]] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any], str]:
    mode = (mode or os.getenv('PLANNER_MODE', 'langgraph') or 'langgraph').lower()
    if mode == 'function_call':
        clean_plan, diagnostics = plan_with_function_call(question)
        return clean_plan, diagnostics, mode
    if mode == 'crewai':
        raw_plan, diagnostics, _ = build_crewai_plan(question, prompt, metadata, username=username)
        clean_plan, sani_diag = sanitize_plan(raw_plan, FUNCTION_REGISTRY)
        # merge diagnostics
        diagnostics.update(sani_diag)
        return clean_plan, diagnostics, mode
    # default path - pass retrieval tools to langgraph planner
    raw_plan = plan_with_langgraph(question, prompt, metadata, username=username, retrieval_subset_tools=retrieval_subset_tools)
    clean_plan, diagnostics = sanitize_plan(raw_plan, FUNCTION_REGISTRY)
    return clean_plan, diagnostics, mode
