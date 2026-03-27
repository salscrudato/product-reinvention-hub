"""Shared progress registry and logging helpers for mapping workflows."""
from __future__ import annotations

import json
import logging
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Dict, Iterator, Optional

from .state import MappingState

logger = logging.getLogger("agentic_orchestrator_auto.mapping.progress")


@dataclass(frozen=True)
class StepInfo:
    """Metadata about a high-level mapping step."""

    id: int
    label: str
    module: str


_STEP_SEQUENCE = [
    StepInfo(1, "Plan recipe", "agentic_orchestrator_auto.plan_recipes"),
    StepInfo(2, "Assignment locator", "mapping.workflow.locate_assignment_page"),
    StepInfo(3, "Download attachments", "mapping.workflow.download_attachments"),
    StepInfo(4, "Parse spreadsheet", "mapping.workflow.parse_spreadsheet"),
    StepInfo(5, "Parse Word template", "mapping.workflow.parse_word_template"),
    StepInfo(6, "Context enrichment", "mapping.context.build_context_profile"),
    StepInfo(7, "History retrieval", "mapping.history.inject_historical_context"),
    StepInfo(8, "Retrieval & wiki prep", "mapping.retrieval"),
    StepInfo(9, "LLM synthesis", "mapping.llm_mapping.generate_with_llm"),
    StepInfo(10, "Validation & persistence", "mapping.validator / workflow.review"),
]

_STEP_LOOKUP: Dict[int, StepInfo] = {info.id: info for info in _STEP_SEQUENCE}
_TOTAL_STEPS = len(_STEP_SEQUENCE)


def get_step(step_id: int) -> StepInfo:
    return _STEP_LOOKUP.get(step_id) or StepInfo(step_id, f"Step {step_id}", "unknown")


def log_step(step_id: int, phase: str, extra: Optional[Dict[str, object]] = None) -> None:
    step = get_step(step_id)
    payload = {
        "step": step.id,
        "total": _TOTAL_STEPS,
        "label": step.label,
        "module": step.module,
        "phase": phase,
    }
    if extra:
        payload.update(extra)
    logger.info("[mapping.progress] %s", json.dumps(payload, default=str))


def update_state_progress(state: Optional[MappingState], step_id: int, phase: str, extra: Optional[Dict[str, object]] = None) -> None:
    if state is None:
        return
    step = get_step(step_id)
    state.metadata.setdefault("progress", {})
    state.metadata["progress"].update(
        {
            "current": step.id,
            "total": _TOTAL_STEPS,
            "label": step.label,
            "module": step.module,
            "phase": phase,
            "extra": extra or {},
        }
    )


@contextmanager
def step_tracker(step_id: int, state: Optional[MappingState] = None, extra: Optional[Dict[str, object]] = None) -> Iterator[None]:
    start = time.perf_counter()
    log_step(step_id, "start", extra)
    update_state_progress(state, step_id, "start", extra)
    try:
        yield
    finally:
        duration_ms = int((time.perf_counter() - start) * 1000)
        end_extra = dict(extra or {})
        end_extra["duration_ms"] = duration_ms
        log_step(step_id, "end", end_extra)
        update_state_progress(state, step_id, "end", end_extra)


__all__ = [
    "StepInfo",
    "log_step",
    "step_tracker",
    "update_state_progress",
    "get_step",
]
