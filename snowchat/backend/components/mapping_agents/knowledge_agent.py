"""Derive supplemental insights and knowledge conflicts for mapping output."""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from .logging_utils import log_method_end, log_method_progress, log_method_start
from .state import MappingState

logger = logging.getLogger("agentic_orchestrator_auto.mapping.knowledge")


def _possible_conflict(target: str, source: str) -> bool:
    target_lower = target.lower()
    source_lower = source.lower()
    if "name" in target_lower and "name" not in source_lower:
        return True
    if "date" in target_lower and "date" not in source_lower:
        return True
    if "amount" in target_lower and not any(token in source_lower for token in ("amount", "value", "total", "balance")):
        return True
    return False


def compile_knowledge_alerts(state: MappingState) -> MappingState:
    """Populate knowledge conflicts and supplemental insights."""
    method = "knowledge_agent.compile_knowledge_alerts"
    log_method_start(
        logger,
        method,
        "Score mappings for potential conflicts and supplemental insights",
        rows=len(state.mapping_rows),
    )
    conflicts: List[Dict[str, Any]] = []
    insights: List[Dict[str, Any]] = []
    for row in state.mapping_rows:
        target = str(row.get("target_field") or "")
        source = str(row.get("source_column") or "")
        confidence = float(row.get("confidence", 0.0))
        if not source:
            continue
        if _possible_conflict(target, source):
            conflicts.append(
                {
                    "target_field": target,
                    "source_column": source,
                    "confidence": confidence,
                    "message": "Target naming pattern differs from selected source column.",
                }
            )
            log_method_progress(logger, method, "Conflict detected", target=target, source=source)
        elif confidence >= 0.65:
            insights.append(
                {
                    "target_field": target,
                    "source_column": source,
                    "highlight": "High confidence alignment based on column similarity",
                }
            )
    if state.wiki_notes.get("presentation_titles"):
        insights.append(
            {
                "source": "presentation",
                "titles": state.wiki_notes.get("presentation_titles")[:5],
                "message": "Slide titles referenced for additional business context.",
            }
        )
    if state.history_suggestions:
        insights.append(
            {
                "source": "history",
                "count": len(state.history_suggestions),
                "message": "Historical mapping records were considered during synthesis.",
            }
        )
    state.knowledge_conflicts = conflicts
    state.supplemental_insights = insights
    if state.mapping_rows:
        high_conf = sum(1 for row in state.mapping_rows if float(row.get("confidence", 0.0)) >= 0.65)
        state.review_summary = (
            f"Generated {len(state.mapping_rows)} candidate mappings with {high_conf} high-confidence alignments."
        )
    else:
        state.review_summary = "No mapping rows were generated."
    state.metadata.setdefault("knowledge", {})
    state.metadata["knowledge"].update(
        {
            "conflict_count": len(conflicts),
            "insight_count": len(insights),
        }
    )
    logger.info(
        "[mapping.knowledge] Knowledge analysis complete | conflicts=%s insights=%s",
        len(conflicts),
        len(insights),
    )
    log_method_end(
        logger,
        method,
        "Knowledge analysis complete",
        conflicts=len(conflicts),
        insights=len(insights),
    )
    return state


__all__ = ["compile_knowledge_alerts"]
