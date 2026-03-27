import json
from pathlib import Path
from typing import Any, Dict, List

LIBRARY_PATH = Path(__file__).parent.parent / "prompts" / "library.json"


class PromptSpecError(Exception):
    pass


def load_library(path: Path = LIBRARY_PATH) -> Dict[str, Any]:
    if not path.exists():
        raise PromptSpecError(f"Prompt library not found at {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise PromptSpecError(f"Invalid JSON in prompt library: {e}") from e
    if "prompts" not in data or not isinstance(data["prompts"], list):
        raise PromptSpecError("Prompt library must contain a 'prompts' list")
    for entry in data["prompts"]:
        _validate_prompt_entry(entry)
    return data


def _validate_prompt_entry(entry: Dict[str, Any]) -> None:
    required = ["id", "description", "input", "expect"]
    for key in required:
        if key not in entry:
            raise PromptSpecError(f"Prompt entry missing required field: {key}")
    if not isinstance(entry["input"], dict) or "message" not in entry["input"]:
        raise PromptSpecError("Prompt entry 'input' must have a 'message'")
    expect = entry["expect"]
    if not isinstance(expect, dict):
        raise PromptSpecError("'expect' must be a dict")
    # Optional expectation keys with simple type checks
    if "must_include_tools_any" in expect and not isinstance(expect["must_include_tools_any"], list):
        raise PromptSpecError("'must_include_tools_any' must be a list when provided")
    if "plan_contains" in expect and not isinstance(expect["plan_contains"], list):
        raise PromptSpecError("'plan_contains' must be a list when provided")
    if "max_latency_ms" in expect and not isinstance(expect["max_latency_ms"], int):
        raise PromptSpecError("'max_latency_ms' must be int when provided")


def list_prompts() -> List[Dict[str, Any]]:
    return load_library()["prompts"]


def get_prompt(prompt_id: str) -> Dict[str, Any]:
    for p in list_prompts():
        if p["id"] == prompt_id:
            return p
    raise PromptSpecError(f"Prompt id not found: {prompt_id}")
