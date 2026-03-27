"""Shared OpenAI/Azure chat helpers for SnowChat services."""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

try:  # Prefer modern client classes when available
    from openai import AzureOpenAI, OpenAI  # type: ignore
except Exception:  # pragma: no cover
    AzureOpenAI = None  # type: ignore
    OpenAI = None  # type: ignore

import openai  # type: ignore  # Legacy fallback path

logger = logging.getLogger("agentic_orchestrator_auto.openai")

_DEFAULT_MODEL = (
    os.getenv("SNOWCHAT_MAPPING_MODEL")
    or os.getenv("GPT_MODEL_NAME")
    or os.getenv("OPENAI_MODEL")
    or "gpt-4o-mini"
)
_AZURE_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT") or ""
_AZURE_KEY = os.getenv("AZURE_OPENAI_API_KEY") or ""
_AZURE_VERSION = os.getenv("OPENAI_API_VERSION") or "2024-05-01-preview"
_PUBLIC_OPENAI_KEY = os.getenv("OPENAI_API_KEY") or ""
_LOG_FULL_LLM = os.getenv("SNOWCHAT_LOG_FULL_LLM", "0").lower() in {"1", "true", "yes"}

_JSON_SCHEMA_MIN_VERSION: Tuple[int, int, int] = (2024, 8, 1)


def _version_tuple(value: str) -> Optional[Tuple[int, int, int]]:
    parts = value.split("-")[:3]
    if len(parts) < 3:
        return None
    try:
        major, minor, patch = (int(part) for part in parts)
        return (major, minor, patch)
    except ValueError:
        return None

_parsed_azure_version = _version_tuple(_AZURE_VERSION)
_JSON_SCHEMA_ALLOWED = not _AZURE_ENDPOINT or (
    _parsed_azure_version is not None and _parsed_azure_version >= _JSON_SCHEMA_MIN_VERSION
)


def _build_kwargs(
    messages: List[Dict[str, str]],
    model: Optional[str],
    temperature: float,
    max_tokens: int,
    functions: Optional[List[Dict[str, Any]]],
    function_call: Optional[Dict[str, Any]],
    response_format: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": model or _DEFAULT_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if functions is not None:
        payload["functions"] = functions
    if function_call is not None:
        payload["function_call"] = function_call
    if response_format is not None:
        if _JSON_SCHEMA_ALLOWED:
            payload["response_format"] = response_format
        else:
            logger.debug(
                "[openai_client] response_format ignored due to Azure API version %s",
                _AZURE_VERSION,
            )
    return payload


def invoke_chat(
    messages: List[Dict[str, str]],
    *,
    model: Optional[str] = None,
    temperature: float = 0.0,
    max_tokens: int = 400,
    functions: Optional[List[Dict[str, Any]]] = None,
    function_call: Optional[Dict[str, Any]] = None,
    response_format: Optional[Dict[str, Any]] = None,
) -> Any:
    """Call Azure/OpenAI chat completions with automatic fallbacks."""
    message_summary = _summarize_messages(messages)
    logger.info(
        "[openai_client] dispatch | model=%s temperature=%.2f max_tokens=%s message_count=%s response_format=%s",
        model or _DEFAULT_MODEL,
        temperature,
        max_tokens,
        len(messages),
        bool(response_format),
    )
    if _LOG_FULL_LLM:
        logger.info("[openai_client] dispatch_messages=%s", message_summary)
    else:
        logger.debug("[openai_client] dispatch_messages=%s", message_summary)
    payload = _build_kwargs(
        messages,
        model,
        temperature,
        max_tokens,
        functions,
        function_call,
        response_format,
    )
    last_error: Optional[Exception] = None
    if AzureOpenAI and _AZURE_ENDPOINT and _AZURE_KEY:
        try:
            client = AzureOpenAI(
                azure_endpoint=_AZURE_ENDPOINT,
                api_key=_AZURE_KEY,
                api_version=_AZURE_VERSION or None,
            )
            response = client.chat.completions.create(**payload)
            _log_response_preview(response)
            return response
        except Exception as exc:  # pragma: no cover
            last_error = exc
            logger.warning("[openai_client] Azure chat invocation failed: %s", exc, exc_info=True)
    if OpenAI and _PUBLIC_OPENAI_KEY:
        try:
            client = OpenAI(api_key=_PUBLIC_OPENAI_KEY)
            response = client.chat.completions.create(**payload)
            _log_response_preview(response)
            return response
        except Exception as exc:  # pragma: no cover
            last_error = exc
            logger.warning("[openai_client] Public OpenAI chat invocation failed: %s", exc, exc_info=True)
    chat_cls = getattr(openai, "ChatCompletion", None)
    if chat_cls is not None:
        try:
            if _AZURE_ENDPOINT and _AZURE_KEY:
                openai.api_type = "azure"  # type: ignore[attr-defined]
                openai.api_base = _AZURE_ENDPOINT  # type: ignore[attr-defined]
                openai.api_key = _AZURE_KEY  # type: ignore[attr-defined]
                if _AZURE_VERSION:
                    openai.api_version = _AZURE_VERSION  # type: ignore[attr-defined]
            elif _PUBLIC_OPENAI_KEY:
                openai.api_key = _PUBLIC_OPENAI_KEY  # type: ignore[attr-defined]
            response = chat_cls.create(**payload)
            _log_response_preview(response)
            return response
        except Exception as exc:  # pragma: no cover
            last_error = exc
            logger.error("[openai_client] Legacy chat invocation failed: %s", exc, exc_info=True)
    message = "OpenAI chat invocation failed; ensure Azure/OpenAI credentials are configured"
    if last_error:
        message = f"{message}: {last_error}"
    raise RuntimeError(message)


def first_choice_content(response: Any) -> str:
    """Return the first choice message content from a chat response."""
    if response is None:
        return ""
    choices = getattr(response, "choices", None)
    if choices is None and isinstance(response, dict):
        choices = response.get("choices")
    if not choices:
        return ""
    choice = choices[0]
    message = getattr(choice, "message", None)
    if message is None and isinstance(choice, dict):
        message = choice.get("message") or choice.get("delta")
    if isinstance(message, dict):
        return (message.get("content") or "").strip()
    return (getattr(message, "content", "") or "").strip()


def _summarize_messages(messages: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    summary: List[Dict[str, Any]] = []
    for idx, message in enumerate(messages):
        content = str(message.get("content") or "")
        preview = content if len(content) <= 200 else f"{content[:200]}…"
        summary.append(
            {
                "index": idx,
                "role": message.get("role"),
                "chars": len(content),
                "preview": preview,
            }
        )
    return summary


def _log_response_preview(response: Any) -> None:
    try:
        preview = first_choice_content(response)
        preview_display = preview[:400] + ("…" if len(preview) > 400 else "")
        usage = getattr(response, "usage", None)
        logger.info(
            "[openai_client] response_received | chars=%s preview=%s usage=%s",
            len(preview or ""),
            preview_display,
            usage,
        )
        if _LOG_FULL_LLM:
            logger.info("[openai_client] response_full_body=\n%s", preview)
    except Exception:  # pragma: no cover - logging best-effort
        logger.debug("[openai_client] response preview logging skipped")


def _strip_code_fences(text: str) -> str:
    cleaned = text.strip()
    if not cleaned.startswith("```"):
        return cleaned
    lines = cleaned.splitlines()
    if lines:
        first = lines[0]
        if first.startswith("```"):
            lines = lines[1:]
    if lines:
        last = lines[-1]
        if last.strip().startswith("```"):
            lines = lines[:-1]
    return "\n".join(lines).strip()


def _insert_missing_commas(cleaned: str) -> str:
    pattern = re.compile(r"}(\s*)(?=\{)")
    return pattern.sub(r"}\1,", cleaned)


def _remove_trailing_commas(cleaned: str) -> str:
    pattern = re.compile(r",(\s*[}\]])")
    return pattern.sub(r"\1", cleaned)


def _repair_json(cleaned: str) -> Optional[str]:
    repaired = cleaned
    fixes: List[str] = []
    updated = _insert_missing_commas(repaired)
    if updated != repaired:
        fixes.append("missing_commas")
        repaired = updated
    updated = _remove_trailing_commas(repaired)
    if updated != repaired:
        fixes.append("trailing_commas")
        repaired = updated
    if not fixes or repaired == cleaned:
        return None
    logger.info("[openai_client] json_repair_applied | fixes=%s", ",".join(fixes))
    return repaired


def extract_json_block(text: str) -> Dict[str, Any]:
    """Best-effort JSON parser that trims markdown fences before loading."""
    import json

    if not text:
        return {}
    cleaned = _strip_code_fences(text)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end >= 0 and end > start:
        cleaned = cleaned[start : end + 1]
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.warning(
            "[openai_client] Failed to parse JSON block | error=%s line=%s col=%s snippet=%s",
            exc.msg,
            exc.lineno,
            exc.colno,
            cleaned[:400],
        )
        repaired = _repair_json(cleaned)
        if repaired:
            try:
                return json.loads(repaired)
            except json.JSONDecodeError as repair_exc:
                logger.warning(
                    "[openai_client] Repaired JSON still invalid | error=%s line=%s col=%s",
                    repair_exc.msg,
                    repair_exc.lineno,
                    repair_exc.colno,
                )
    salvaged = _salvage_partial_mappings(cleaned)
    if salvaged is not None:
        return salvaged
    try:
        decoder = json.JSONDecoder()
        parsed, _ = decoder.raw_decode(cleaned)
        logger.info("[openai_client] raw_decode salvage succeeded after initial failure")
        return parsed if isinstance(parsed, dict) else {}
    except Exception as inner_exc:
        logger.error(
            "[openai_client] raw_decode salvage failed | error=%s snippet=%s",
            inner_exc,
            cleaned[:400],
        )
        return {}


def _salvage_partial_mappings(cleaned: str) -> Optional[Dict[str, Any]]:
    import json

    bracket_index = cleaned.find("[")
    if bracket_index == -1:
        return None
    decoder = json.JSONDecoder()
    idx = bracket_index + 1
    objects: List[Dict[str, Any]] = []
    while idx < len(cleaned):
        while idx < len(cleaned) and cleaned[idx] in {" ", "\n", "\r", "\t", ","}:
            idx += 1
        if idx >= len(cleaned) or cleaned[idx] != "{":
            break
        try:
            obj, length = decoder.raw_decode(cleaned[idx:])
        except json.JSONDecodeError:
            break
        if isinstance(obj, dict):
            objects.append(obj)
        idx += length
    if objects:
        logger.info(
            "[openai_client] salvaged_partial_mappings | count=%s",
            len(objects),
        )
        return {"mappings": objects}
    return None


__all__ = ["invoke_chat", "first_choice_content", "extract_json_block"]
