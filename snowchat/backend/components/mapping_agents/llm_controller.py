"""Centralized controls for mapping LLM invocations."""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from ..openai_client import invoke_chat

logger = logging.getLogger("agentic_orchestrator_auto.mapping.llm_controller")

_DEFAULT_TIMEOUT = float(os.getenv("SNOWCHAT_MAPPING_LLM_TIMEOUT", "90"))
_MAX_RETRIES = int(os.getenv("SNOWCHAT_MAPPING_LLM_MAX_RETRIES", "2"))
_TRACE_PROMPTS = os.getenv("SNOWCHAT_MAPPING_TRACE_PROMPTS", "0").lower() in {"1", "true", "yes"}


def _maybe_trace_prompt(messages: List[Dict[str, str]]) -> None:
    if not _TRACE_PROMPTS:
        return
    try:
        preview = json.dumps(messages, ensure_ascii=False)[:2000]
        logger.debug("[mapping.llm_controller] prompt_preview=%s", preview)
    except Exception:  # pragma: no cover - best effort
        logger.debug("[mapping.llm_controller] prompt_preview unavailable")


def invoke_with_retry(
    messages: List[Dict[str, str]],
    *,
    temperature: float,
    max_tokens: int,
    metadata: Optional[Dict[str, Any]] = None,
    response_format: Optional[Dict[str, Any]] = None,
) -> Any:
    """Invoke chat completions with retries and detailed logging."""
    metadata = metadata or {}
    request_id = metadata.get("request_id") or str(uuid.uuid4())
    _maybe_trace_prompt(messages)
    attempt = 0
    while True:
        attempt += 1
        start = time.perf_counter()
        logger.info(
            "[mapping.llm_controller] request_start | request_id=%s attempt=%s meta=%s",
            request_id,
            attempt,
            json.dumps(metadata, default=str),
        )
        try:
            response = invoke_chat(
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=response_format,
            )
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.info(
                "[mapping.llm_controller] request_complete | request_id=%s duration_ms=%s", request_id, duration_ms
            )
            if duration_ms > _DEFAULT_TIMEOUT * 1000:
                logger.warning(
                    "[mapping.llm_controller] request_slow | request_id=%s duration_ms=%s threshold_ms=%s",
                    request_id,
                    duration_ms,
                    int(_DEFAULT_TIMEOUT * 1000),
                )
            return response
        except Exception as exc:  # pragma: no cover - network failures
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.warning(
                "[mapping.llm_controller] request_error | request_id=%s attempt=%s duration_ms=%s error=%s",
                request_id,
                attempt,
                duration_ms,
                exc,
                exc_info=True,
            )
            if attempt >= _MAX_RETRIES:
                raise
            backoff = min(5, attempt * 2)
            logger.info("[mapping.llm_controller] retry_scheduled | request_id=%s wait_s=%s", request_id, backoff)
            time.sleep(backoff)


__all__ = ["invoke_with_retry"]
