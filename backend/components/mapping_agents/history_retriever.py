"""Retrieve historical mapping signals from TinyDB storage."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List

try:  # pragma: no cover - dependency validated at runtime
    from tinydb import Query, TinyDB  # type: ignore[import]
except ImportError:  # pragma: no cover - safety net when TinyDB missing
    Query = None  # type: ignore[assignment]
    TinyDB = None  # type: ignore[assignment]

from .logging_utils import log_method_end, log_method_progress, log_method_start
from .progress import step_tracker
from .state import MappingState

logger = logging.getLogger("agentic_orchestrator_auto.mapping.history")


def _db_path() -> Path:
    return Path(__file__).resolve().parents[2] / "state_db.json"


def _normalize_assignment_id(state: MappingState) -> str:
    return state.assignment_page_id or state.assignment_page_url or state.assignment_name


def inject_historical_context(state: MappingState, limit: int = 5) -> MappingState:
    """Augment state with prior mapping decisions stored in TinyDB."""
    method = "history_retriever.inject_historical_context"
    log_method_start(
        logger,
        method,
        "Load prior mapping rows from TinyDB for reuse",
        limit=limit,
        assignment=state.assignment_name,
    )
    with step_tracker(7, state, {"limit": limit}):
        db_file = _db_path()
        if TinyDB is None or Query is None:
            logger.warning("[mapping.history] TinyDB dependency missing; history lookup skipped.")
            state.warnings.append("Historical mapping lookup skipped; TinyDB dependency missing.")
            log_method_end(logger, method, "Skipped (TinyDB missing)")
            return state
        if not db_file.exists():
            logger.info("[mapping.history] No state_db.json present; history lookup skipped.")
            log_method_end(logger, method, "Skipped (state_db missing)")
            return state
        assignment_key = _normalize_assignment_id(state)
        try:
            db = TinyDB(str(db_file))
        except Exception as exc:  # pragma: no cover
            logger.warning("[mapping.history] Unable to open TinyDB | error=%s", exc)
            state.warnings.append("Unable to open mapping history database.")
            log_method_end(logger, method, "Failed opening TinyDB", error=str(exc))
            return state
        try:
            table = db.table("mapping_history")
            if table is None:  # pragma: no cover - mypy guard
                log_method_end(logger, method, "TinyDB table missing")
                return state
            query = Query()
            raw_rows = table.search(query.assignment_id == assignment_key)
            rows: List[Dict[str, Any]] = [dict(row) for row in raw_rows]
            if not rows:
                fallback_rows = table.search(query.assignment_name == state.assignment_name)
                rows = [dict(row) for row in fallback_rows]
            if not rows:
                logger.info("[mapping.history] No historical records found | assignment_id=%s", assignment_key)
                log_method_end(logger, method, "No history", assignment_id=assignment_key)
                return state
            rows.sort(key=lambda item: item.get("updated_at", 0), reverse=True)
            suggestions: List[Dict[str, Any]] = []
            for row in rows[:limit]:
                suggestions.append(
                    {
                        "assignment": row.get("assignment_name"),
                        "source_column": row.get("source_column"),
                        "target_field": row.get("target_field"),
                        "confidence": float(row.get("confidence", 0.0)),
                        "notes": row.get("notes"),
                        "updated_at": row.get("updated_at"),
                    }
                )
            state.history_suggestions = suggestions
            state.metadata.setdefault("history", {})
            state.metadata["history"].update(
                {
                    "records_considered": len(rows),
                    "assignment_key": assignment_key,
                }
            )
            logger.info(
                "[mapping.history] Retrieved history suggestions | count=%s assignment_id=%s",
                len(suggestions),
                assignment_key,
            )
            log_method_end(
                logger,
                method,
                "Loaded history",
                suggestions=len(suggestions),
                assignment_id=assignment_key,
            )
            return state
        finally:
            db.close()


__all__ = ["inject_historical_context"]
