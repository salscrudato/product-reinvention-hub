"""LangGraph supervisory workflow for mapping agents."""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, List, Optional, TypedDict

try:  # pragma: no cover - import validated at runtime
    from langgraph.graph import StateGraph  # type: ignore
    LANGGRAPH_IMPORT_ERROR: Optional[Exception] = None
except Exception as exc:  # pragma: no cover
    StateGraph = None  # type: ignore[assignment]
    LANGGRAPH_IMPORT_ERROR = exc

try:  # pragma: no cover
    from langchain_community.tools import Tool  # type: ignore
    TOOL_IMPORT_ERROR: Optional[Exception] = None
except Exception as primary_exc:  # pragma: no cover
    try:
        from langchain.tools import Tool  # type: ignore
        TOOL_IMPORT_ERROR = None
    except Exception as fallback_exc:  # pragma: no cover
        Tool = None  # type: ignore[assignment]
        TOOL_IMPORT_ERROR = fallback_exc

from .context_enrichment import build_context_profile
from .exceptions import MappingError
from .history_retriever import inject_historical_context
from .knowledge_agent import compile_knowledge_alerts
from .mapping_synthesizer import synthesize_mapping_rows
from .parsers import ExcelSummary, PresentationSummary, WordSummary
from .progress import log_step, step_tracker
from .state import MappingState
from .validator import validate_mapping_rows
from .workflow import (
    AssignmentArtifacts,
    append_artifact_warnings,
    assemble_workflow_result,
    finalize_state_alerts,
    prepare_assignment_artifacts,
)

logger = logging.getLogger("agentic_orchestrator_auto.mapping.supervisor")
_STEP_WARN_MS = int(os.getenv("SNOWCHAT_MAPPING_STEP_WARN_MS", "45000"))


class MappingGraphState(TypedDict, total=False):
    question: str
    assignment_link: Optional[str]
    persist_workspace: bool
    metadata: Dict[str, Any]
    step_trace: List[Dict[str, Any]]
    artifacts: AssignmentArtifacts
    mapping_state: MappingState
    excel_summary: ExcelSummary
    word_summary: WordSummary
    presentation_summary: Optional[PresentationSummary]
    warnings: List[str]
    errors: List[str]
    result: Dict[str, Any]
    done: bool


def _ensure_stategraph_available() -> None:
    if StateGraph is None or LANGGRAPH_IMPORT_ERROR is not None:
        raise MappingError(
            f"LangGraph is unavailable: {LANGGRAPH_IMPORT_ERROR}"
        )


def _record_step_event(state: MappingGraphState, step: str, phase: str, duration_ms: Optional[int] = None) -> None:
    mapping_state = state.get("mapping_state")
    timestamp = datetime.utcnow().isoformat() + "Z"
    event: Dict[str, Any] = {"step": step, "phase": phase, "timestamp": timestamp}
    if duration_ms is not None:
        event["duration_ms"] = duration_ms
    trace = state.setdefault("step_trace", [])
    trace.append(event)
    if hasattr(mapping_state, "metadata"):
        metadata = getattr(mapping_state, "metadata", {})
        step_trace = metadata.setdefault("step_trace", [])
        step_trace.append(dict(event))


def _start_step_watchdog(step: str, payload: Dict[str, Any]) -> Optional[threading.Timer]:
    if _STEP_WARN_MS <= 0:
        return None
    def _warn() -> None:
        logger.warning(
            "[mapping.supervisor] step_watchdog | step=%s elapsed_ms>=%s extra=%s",
            step,
            _STEP_WARN_MS,
            {k: v for k, v in payload.items() if isinstance(v, (str, int, float))},
        )
    timer = threading.Timer(_STEP_WARN_MS / 1000.0, _warn)
    timer.daemon = True
    timer.start()
    return timer


def _invoke_tool(tool_obj: Any, payload: Dict[str, Any], step: str, state: MappingGraphState) -> Dict[str, Any]:
    start = time.perf_counter()
    corr = state.get("metadata", {}).get("correlation_id")
    extra = {"correlation_id": corr, **{k: v for k, v in payload.items() if isinstance(v, (str, int, float))}}
    step_id_lookup = {
        "assignment_locator": 2,
        "context_enrichment": 6,
        "history_similarity": 7,
        "mapping_synthesis": 9,
        "mapping_validation": 10,
        "review": 10,
    }
    step_id = step_id_lookup.get(step)
    if step_id:
        log_step(step_id, "start", {"step_name": step, **extra})
    _record_step_event(state, step, "start")
    logger.info(
        "[mapping.supervisor] step_start | step=%s extra=%s",
        step,
        extra,
    )
    logger.debug(
        "[mapping.supervisor] step_invoke_enter | step=%s tool=%s",
        step,
        getattr(tool_obj, "name", type(tool_obj).__name__),
    )
    watchdog = _start_step_watchdog(step, extra)
    try:
        if tool_obj is None:
            raise MappingError(f"Tool for step '{step}' is not available (import error: {TOOL_IMPORT_ERROR})")
        func = getattr(tool_obj, "func", None)
        if callable(func):
            result = func(payload)
        else:
            # Fallback: allow plain callables
            result = tool_obj(payload)  # type: ignore[operator]
        if not isinstance(result, dict):
            result = {"output": result}
        duration_ms = int((time.perf_counter() - start) * 1000)
        if watchdog:
            watchdog.cancel()
        logger.info(
            "[mapping.supervisor] step_complete | step=%s duration_ms=%s",
            step,
            duration_ms,
        )
        if step_id:
            log_step(step_id, "end", {"step_name": step, "duration_ms": duration_ms})
        _record_step_event(state, step, "end", duration_ms)
        logger.debug("[mapping.supervisor] step_log_transition | step=%s status=end", step)
        logger.info(
            "[mapping.supervisor] step_result | step=%s keys=%s warnings=%s errors=%s",
            step,
            list(result.keys())[:5],
            len(state.get("warnings", [])),
            len(state.get("errors", [])),
        )
        logger.debug("[mapping.supervisor] step_invoke_exit | step=%s", step)
        return result or {}
    except Exception as exc:
        duration_ms = int((time.perf_counter() - start) * 1000)
        if watchdog:
            watchdog.cancel()
        logger.exception(
            "[mapping.supervisor] step_failed | step=%s duration_ms=%s error=%s",
            step,
            duration_ms,
            exc,
        )
        if step_id:
            log_step(step_id, "error", {"step_name": step, "duration_ms": duration_ms, "error": str(exc)})
        _record_step_event(state, step, "error", duration_ms)
        state.setdefault("errors", []).append(f"{step}: {exc}")
        raise


def _assignment_tool_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
    artifacts = prepare_assignment_artifacts(
        question=payload.get("question", ""),
        assignment_link=payload.get("assignment_link"),
        persist_workspace=payload.get("persist_workspace", True),
    )
    return {
        "artifacts": artifacts,
        "mapping_state": artifacts.state,
        "excel_summary": artifacts.excel_summary,
        "word_summary": artifacts.word_summary,
        "presentation_summary": artifacts.presentation_summary,
    }


def _context_tool_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
    state: MappingState = payload["mapping_state"]
    build_context_profile(state, payload["excel_summary"], payload["word_summary"])
    return {"mapping_state": state}


def _history_tool_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
    state: MappingState = payload["mapping_state"]
    inject_historical_context(state)
    return {"mapping_state": state}


def _synthesis_tool_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
    state: MappingState = payload["mapping_state"]
    synthesize_mapping_rows(state)
    return {"mapping_state": state}


def _validation_tool_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
    state: MappingState = payload["mapping_state"]
    validate_mapping_rows(state)
    return {"mapping_state": state}


def _knowledge_tool_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
    state: MappingState = payload["mapping_state"]
    compile_knowledge_alerts(state)
    return {"mapping_state": state}


def _review_tool_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
    artifacts: AssignmentArtifacts = payload["artifacts"]
    state: MappingState = payload["mapping_state"]
    with step_tracker(10, state, {"phase": "review"}):
        result = assemble_workflow_result(
            artifacts=artifacts,
            state=state,
            persist_workspace=payload.get("persist_workspace", True),
            excel_summary=payload.get("excel_summary"),
            word_summary=payload.get("word_summary"),
            presentation_summary=payload.get("presentation_summary"),
        )
    return {"result": result}


def _make_tool(name: str, description: str, func: Any) -> Any:
    if Tool is None:
        logger.warning("[mapping.supervisor] LangChain Tool unavailable (%s); using raw callable for %s", TOOL_IMPORT_ERROR, name)
        return func
    return Tool(name=name, description=description, func=func)  # type: ignore[arg-type]


ASSIGNMENT_TOOL = _make_tool(
    "mapping_assignment_locator",
    "Locate assignment page, download artifacts, and parse initial summaries.",
    _assignment_tool_runner,
)
CONTEXT_TOOL = _make_tool(
    "mapping_context_enrichment",
    "Generate contextual profile from spreadsheet and Word artifacts.",
    _context_tool_runner,
)
HISTORY_TOOL = _make_tool(
    "mapping_history_similarity",
    "Augment mapping state with historical TinyDB mappings.",
    _history_tool_runner,
)
SYNTHESIS_TOOL = _make_tool(
    "mapping_synthesizer",
    "Produce candidate mapping rows based on heuristics and history.",
    _synthesis_tool_runner,
)
VALIDATION_TOOL = _make_tool(
    "mapping_validator",
    "Validate synthesized mapping rows for completeness and conflicts.",
    _validation_tool_runner,
)
KNOWLEDGE_TOOL = _make_tool(
    "mapping_knowledge_agent",
    "Derive supplemental insights and potential conflicts.",
    _knowledge_tool_runner,
)
REVIEW_TOOL = _make_tool(
    "mapping_review",
    "Compile final mapping response payload for the user.",
    _review_tool_runner,
)


def _assignment_node(state: MappingGraphState) -> MappingGraphState:
    payload = {
        "question": state.get("question", ""),
        "assignment_link": state.get("assignment_link"),
        "persist_workspace": state.get("persist_workspace", True),
    }
    result = _invoke_tool(ASSIGNMENT_TOOL, payload, "assignment_locator", state)
    artifacts = result.get("artifacts")
    mapping_state = result.get("mapping_state")
    if not isinstance(artifacts, AssignmentArtifacts) or not isinstance(mapping_state, MappingState):
        raise MappingError("Assignment locator tool returned invalid data.")
    state["artifacts"] = artifacts
    state["mapping_state"] = mapping_state
    excel_summary = result.get("excel_summary", artifacts.excel_summary)
    word_summary = result.get("word_summary", artifacts.word_summary)
    presentation_summary = result.get("presentation_summary", artifacts.presentation_summary)
    if not isinstance(excel_summary, ExcelSummary) or not isinstance(word_summary, WordSummary):
        raise MappingError("Assignment summaries missing or malformed.")
    state["excel_summary"] = excel_summary
    state["word_summary"] = word_summary
    state["presentation_summary"] = presentation_summary if isinstance(presentation_summary, PresentationSummary) or presentation_summary is None else None
    state["warnings"] = list(mapping_state.warnings)
    return state


def _context_node(state: MappingGraphState) -> MappingGraphState:
    mapping_state = state.get("mapping_state")
    excel_summary = state.get("excel_summary")
    word_summary = state.get("word_summary")
    if not isinstance(mapping_state, MappingState) or not isinstance(excel_summary, ExcelSummary) or not isinstance(word_summary, WordSummary):
        raise MappingError("Context node prerequisites are not satisfied.")
    payload = {
        "mapping_state": mapping_state,
        "excel_summary": excel_summary,
        "word_summary": word_summary,
    }
    result = _invoke_tool(CONTEXT_TOOL, payload, "context_enrichment", state)
    new_state = result.get("mapping_state")
    if isinstance(new_state, MappingState):
        state["mapping_state"] = new_state
        mapping_state = new_state
    state["warnings"] = list(mapping_state.warnings)
    return state


def _history_node(state: MappingGraphState) -> MappingGraphState:
    mapping_state = state.get("mapping_state")
    if not isinstance(mapping_state, MappingState):
        raise MappingError("History node missing mapping state.")
    payload = {"mapping_state": mapping_state}
    result = _invoke_tool(HISTORY_TOOL, payload, "history_similarity", state)
    new_state = result.get("mapping_state")
    if isinstance(new_state, MappingState):
        state["mapping_state"] = new_state
        mapping_state = new_state
    state["warnings"] = list(mapping_state.warnings)
    return state


def _synthesis_node(state: MappingGraphState) -> MappingGraphState:
    mapping_state = state.get("mapping_state")
    if not isinstance(mapping_state, MappingState):
        raise MappingError("Synthesis node missing mapping state.")
    payload = {"mapping_state": mapping_state}
    result = _invoke_tool(SYNTHESIS_TOOL, payload, "mapping_synthesis", state)
    new_state = result.get("mapping_state")
    if isinstance(new_state, MappingState):
        state["mapping_state"] = new_state
        mapping_state = new_state
    state["warnings"] = list(mapping_state.warnings)
    return state


def _validation_node(state: MappingGraphState) -> MappingGraphState:
    mapping_state = state.get("mapping_state")
    if not isinstance(mapping_state, MappingState):
        raise MappingError("Validation node missing mapping state.")
    payload = {"mapping_state": mapping_state}
    result = _invoke_tool(VALIDATION_TOOL, payload, "mapping_validation", state)
    new_state = result.get("mapping_state")
    if isinstance(new_state, MappingState):
        state["mapping_state"] = new_state
        mapping_state = new_state
    state["warnings"] = list(mapping_state.warnings)
    return state


def _knowledge_node(state: MappingGraphState) -> MappingGraphState:
    mapping_state = state.get("mapping_state")
    if not isinstance(mapping_state, MappingState):
        raise MappingError("Knowledge node missing mapping state.")
    payload = {"mapping_state": mapping_state}
    result = _invoke_tool(KNOWLEDGE_TOOL, payload, "knowledge_analysis", state)
    new_state = result.get("mapping_state")
    if isinstance(new_state, MappingState):
        state["mapping_state"] = new_state
        mapping_state = new_state
    state["warnings"] = list(mapping_state.warnings)
    return state


def _review_node(state: MappingGraphState) -> MappingGraphState:
    artifacts = state.get("artifacts")
    mapping_state = state.get("mapping_state")
    if not isinstance(artifacts, AssignmentArtifacts) or not isinstance(mapping_state, MappingState):
        raise MappingError("Review node prerequisites missing.")
    excel_summary = state.get("excel_summary")
    word_summary = state.get("word_summary")
    if not isinstance(excel_summary, ExcelSummary) or not isinstance(word_summary, WordSummary):
        raise MappingError("Review node missing summary objects.")
    append_artifact_warnings(mapping_state, excel_summary, word_summary)
    finalize_state_alerts(mapping_state)
    payload = {
        "artifacts": artifacts,
        "mapping_state": mapping_state,
        "persist_workspace": state.get("persist_workspace", True),
        "excel_summary": excel_summary,
        "word_summary": word_summary,
        "presentation_summary": state.get("presentation_summary"),
    }
    result = _invoke_tool(REVIEW_TOOL, payload, "review", state)
    result_payload = result.get("result")
    if not isinstance(result_payload, dict):
        raise MappingError("Review tool returned invalid result payload.")
    state["result"] = result_payload
    state["warnings"] = list(mapping_state.warnings)
    state.setdefault("errors", [])
    state["done"] = True  # type: ignore[index]
    return state


@lru_cache(maxsize=1)
def _compiled_mapping_graph() -> Any:
    _ensure_stategraph_available()
    graph = StateGraph(MappingGraphState)  # type: ignore[call-arg]
    graph.add_node("assignment_locator", _assignment_node)
    graph.add_node("context_enrichment", _context_node)
    graph.add_node("history_similarity", _history_node)
    graph.add_node("mapping_synthesis", _synthesis_node)
    graph.add_node("mapping_validation", _validation_node)
    graph.add_node("knowledge_analysis", _knowledge_node)
    graph.add_node("review", _review_node)
    graph.set_entry_point("assignment_locator")
    graph.add_edge("assignment_locator", "context_enrichment")
    graph.add_edge("context_enrichment", "history_similarity")
    graph.add_edge("history_similarity", "mapping_synthesis")
    graph.add_edge("mapping_synthesis", "mapping_validation")
    graph.add_edge("mapping_validation", "knowledge_analysis")
    graph.add_edge("knowledge_analysis", "review")
    compiled = graph.compile()
    logger.info("[mapping.supervisor] LangGraph compiled | nodes=7")
    return compiled


def run_mapping_langgraph(
    question: str,
    assignment_link: Optional[str] = None,
    persist_workspace: bool = True,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Execute mapping workflow via LangGraph supervisor."""

    app = _compiled_mapping_graph()
    logger.info(
        "[mapping.supervisor] workflow_start | assignment=%s persist=%s",
        assignment_link,
        persist_workspace,
    )
    initial_state: MappingGraphState = {
        "question": question,
        "assignment_link": assignment_link,
        "persist_workspace": persist_workspace,
        "metadata": metadata or {},
        "warnings": [],
        "errors": [],
    }
    start = time.perf_counter()
    final_state: MappingGraphState = {}
    try:
        final_state = app.invoke(initial_state)
    finally:
        duration_ms = int((time.perf_counter() - start) * 1000)
        warning_count = len(final_state.get("warnings", [])) if final_state else len(initial_state.get("warnings", []))
        error_count = len(final_state.get("errors", [])) if final_state else len(initial_state.get("errors", []))
        logger.info(
            "[mapping.supervisor] workflow_end | assignment=%s duration_ms=%s warnings=%s errors=%s",
            assignment_link,
            duration_ms,
            warning_count,
            error_count,
        )
    result = final_state.get("result", {})
    if not result:
        raise MappingError("Mapping supervisor completed without result payload.")
    return result


__all__ = ["run_mapping_langgraph"]
