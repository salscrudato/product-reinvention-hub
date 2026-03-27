"""Shared logging helpers for mapping agents."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict

_logger = logging.getLogger("agentic_orchestrator_auto.mapping.trace")


def _format(details: Dict[str, Any]) -> str:
    if not details:
        return "{}"
    try:
        return json.dumps(details, default=str, ensure_ascii=False)
    except Exception:
        return str(details)


def log_method_start(logger: logging.Logger | None, method: str, expectation: str, **details: Any) -> None:
    target_logger = logger or _logger
    target_logger.info(
        "[mapping.trace] START %s | expect=%s | details=%s",
        method,
        expectation,
        _format(details),
    )


def log_method_progress(logger: logging.Logger | None, method: str, message: str, **details: Any) -> None:
    target_logger = logger or _logger
    target_logger.info(
        "[mapping.trace] PROGRESS %s | %s | details=%s",
        method,
        message,
        _format(details),
    )


def log_method_end(logger: logging.Logger | None, method: str, outcome: str, **details: Any) -> None:
    target_logger = logger or _logger
    target_logger.info(
        "[mapping.trace] END %s | outcome=%s | details=%s",
        method,
        outcome,
        _format(details),
    )


__all__ = ["log_method_start", "log_method_progress", "log_method_end"]
