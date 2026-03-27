"""Validation utilities for synthesized mapping rows."""
from __future__ import annotations

import logging
from collections import Counter
from typing import Any, Dict, List

from .logging_utils import log_method_end, log_method_progress, log_method_start
from .progress import step_tracker
from .state import MappingState

logger = logging.getLogger("agentic_orchestrator_auto.mapping.validator")


def validate_mapping_rows(state: MappingState, min_confidence: float = 0.45) -> MappingState:
    """Inspect synthesized rows and record validation issues."""
    method = "validator.validate_mapping_rows"
    log_method_start(
        logger,
        method,
        "Ensure mapping rows meet quality thresholds",
        rows=len(state.mapping_rows),
        min_confidence=min_confidence,
    )
    with step_tracker(10, state, {"rows": len(state.mapping_rows)}):
        issues: List[Dict[str, Any]] = []
        seen_sources: Counter[str] = Counter()
        llm_mode = (state.metadata.get("synthesis") or {}).get("strategy") == "llm"
        for row in state.mapping_rows:
            source = str(row.get("source_column") or "").strip()
            try:
                confidence = float(row.get("confidence", 0.0))
            except (TypeError, ValueError):
                confidence = 0.0
            target = row.get("target_field")
            if not source:
                issues.append(
                    {
                        "severity": "high",
                        "target_field": target,
                        "message": "No source column selected",
                    }
                )
                continue
            if confidence < min_confidence:
                issues.append(
                    {
                        "severity": "medium",
                        "target_field": target,
                        "message": f"Low confidence match ({confidence:.2f})",
                    }
                )
            if llm_mode and not row.get("citations"):
                issues.append(
                    {
                        "severity": "medium",
                        "target_field": target,
                        "message": "LLM-proposed mapping missing citations",
                    }
                )
                log_method_progress(logger, method, "Missing citation", target=target)
            seen_sources[source] += 1
        for source, count in seen_sources.items():
            if count > 1:
                issues.append(
                    {
                        "severity": "medium",
                        "source_column": source,
                        "message": "Source column reused multiple times",
                    }
                )
        if not state.mapping_rows:
            issues.append(
                {
                    "severity": "high",
                    "message": "No mapping rows were generated.",
                }
            )
            log_method_progress(logger, method, "No mapping rows present")
    state.validation_issues = issues
    state.metadata.setdefault("validation", {})
    state.metadata["validation"].update(
        {
            "issues_found": len(issues),
            "min_confidence": min_confidence,
        }
    )
    logger.info(
        "[mapping.validator] Completed validation | issues=%s",
        len(issues),
    )
    log_method_end(
        logger,
        method,
        "Validation complete",
        issues=len(issues),
        min_confidence=min_confidence,
    )
    return state


__all__ = ["validate_mapping_rows"]
