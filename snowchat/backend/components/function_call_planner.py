"""Planner helpers that rely on shared OpenAI client utilities."""

import json
from typing import Any, Dict, List, Tuple

from .openai_client import invoke_chat
from .plan_sanitizer import sanitize_plan
from .shared_registry import FUNCTION_REGISTRY
from .tool_schemas import describe_tools_for_prompt


def _build_function_def() -> Dict[str, Any]:
    """Construct the single function spec used for OpenAI function calling."""
    return {
        "name": "propose_function_sequence",
        "description": "Return an ordered function sequence for the user query.",
        "parameters": {
            "type": "object",
            "properties": {
                "function_sequence": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "function_name": {"type": "string"},
                            "arguments": {"type": "object"},
                        },
                        "required": ["function_name"],
                    },
                }
            },
            "required": ["function_sequence"],
        },
    }


def _extract_function_call(choice: Any) -> Any:
    message = getattr(choice, "message", None)
    if message is None and isinstance(choice, dict):
        message = choice.get("message")
    if message is None:
        # Some SDKs expose function_call directly on the choice
        if isinstance(choice, dict):
            return choice.get("function_call")
        return getattr(choice, "function_call", None)
    function_call = getattr(message, "function_call", None)
    if function_call is None and isinstance(message, dict):
        function_call = message.get("function_call")
    return function_call


def plan_with_function_call(messages: List[Dict[str, str]]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Use OpenAI function calling to propose a function sequence, then sanitize."""

    system_desc = (
        "You are a deterministic planner. Only return valid tool names.\n"
        "Available tools:\n" + describe_tools_for_prompt()
    )
    augmented_messages = [{"role": "system", "content": system_desc}] + messages
    fn_def = _build_function_def()
    response = invoke_chat(
        augmented_messages,
        functions=[fn_def],
        function_call={"name": "propose_function_sequence"},
        temperature=0.0,
        max_tokens=400,
    )
    choices = getattr(response, "choices", None)
    if choices is None and isinstance(response, dict):
        choices = response.get("choices")
    if not choices:
        raise RuntimeError("OpenAI planner returned no choices.")
    choice = choices[0]
    fc = _extract_function_call(choice)
    raw_plan: List[Dict[str, Any]] = []
    raw_payload: Dict[str, Any] = {}
    if fc:
        args_str = None
        if isinstance(fc, dict):
            args_str = fc.get("arguments")
        else:
            args_str = getattr(fc, "arguments", None)
        if args_str:
            try:
                raw_payload = json.loads(args_str)
                raw_plan = raw_payload.get("function_sequence") or []
            except Exception:
                raw_plan = []
    clean_plan, diagnostics = sanitize_plan(raw_plan, FUNCTION_REGISTRY)
    diagnostics["raw"] = raw_payload
    return clean_plan, diagnostics


def build_messages_from_question(question: str) -> List[Dict[str, str]]:
    return [{"role": "user", "content": question}]
