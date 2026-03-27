"""Draft LCEL-style runnable pipeline.

If langchain.runnables is available, exposes a composed pipeline that:
1. Takes an input dict {question, prompt, metadata, username}
2. Plans via select_and_plan
3. Executes steps sequentially using FUNCTION_REGISTRY
4. Returns {plan, tool_outputs, traces}

Fallback: if LCEL not available, provides a simple run() function performing same logic.
"""
from typing import Dict, Any, Optional, List, Tuple
import time
import os
import logging
from .planner_selector import select_and_plan
from .shared_registry import FUNCTION_REGISTRY

logger = logging.getLogger(__name__)

try:  # optional import
    from langchain_core.runnables import RunnableLambda, RunnablePassthrough, RunnableMap
    LCEL_AVAILABLE = True
except Exception:  # pragma: no cover
    LCEL_AVAILABLE = False


def _execute_plan(plan: List[Dict[str, Any]], registry: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    outputs: Dict[str, Any] = {}
    traces: List[Dict[str, Any]] = []
    for step in plan:
        raw_fn_name = step.get('function_name') or step.get('tool')
        if not isinstance(raw_fn_name, str) or not raw_fn_name:
            trace = {"tool": raw_fn_name, "arguments": step.get('arguments') or {}, "start_time": time.time(), "status": "error", "error": "invalid_function_name"}
            trace["end_time"] = time.time()
            trace["duration_ms"] = round((trace["end_time"] - trace["start_time"]) * 1000, 2)
            traces.append(trace)
            continue
        fn_name: str = raw_fn_name
        args = step.get('arguments') or step.get('args') or {}
        fn = registry.get(fn_name)
        trace = {"tool": fn_name, "arguments": args, "start_time": time.time()}
        if not fn:
            trace["status"] = "error"
            trace["error"] = "not_found"
            trace["end_time"] = time.time()
            trace["duration_ms"] = round((trace["end_time"] - trace["start_time"]) * 1000, 2)
            traces.append(trace)
            continue
        try:
            if isinstance(args, dict):
                result = fn(**args)
            else:
                result = fn(args)
            trace["status"] = "ok"
            trace["end_time"] = time.time()
            trace["duration_ms"] = round((trace["end_time"] - trace["start_time"]) * 1000, 2)
            outputs[fn_name] = result
        except Exception as e:  # pragma: no cover (network errors)
            trace["status"] = "error"
            trace["error"] = str(e)
            trace["end_time"] = time.time()
            trace["duration_ms"] = round((trace["end_time"] - trace["start_time"]) * 1000, 2)
        traces.append(trace)
    return outputs, traces


def run_pipeline(question: str, prompt: str = "", metadata: Optional[Dict[str, Any]] = None, username: Optional[str] = None) -> Dict[str, Any]:
    metadata = metadata or {}
    plan, diagnostics, mode = select_and_plan(question, prompt, metadata, username=username)  # type: ignore[arg-type]
    outputs, traces = _execute_plan(plan, FUNCTION_REGISTRY)
    return {
        "planner_mode": mode,
        "plan": plan,
        "diagnostics": diagnostics,
        "tool_outputs": outputs,
        "traces": traces
    }

# Optional LCEL composition (draft)
if LCEL_AVAILABLE:  # pragma: no cover (depends on optional pkg)
    def _planner_stage(inputs: Dict[str, Any]):
        q = inputs.get('question', '')
        p = inputs.get('prompt', '')
        m = inputs.get('metadata') or {}
        u = inputs.get('username')
        plan, diagnostics, mode = select_and_plan(q, p, m, username=u)
        return {**inputs, "plan": plan, "diagnostics": diagnostics, "planner_mode": mode}

    def _executor_stage(inputs: Dict[str, Any]):
        plan = inputs.get('plan') or []
        outputs, traces = _execute_plan(plan, FUNCTION_REGISTRY)
        return {**inputs, "tool_outputs": outputs, "traces": traces}

    LCEL_PIPELINE = (
        RunnablePassthrough()
        | RunnableLambda(_planner_stage)
        | RunnableLambda(_executor_stage)
    )
else:
    LCEL_PIPELINE = None
