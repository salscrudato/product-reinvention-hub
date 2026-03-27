from typing import List, Dict, Any, Tuple, Optional
from .shared_registry import FUNCTION_REGISTRY
from .tool_schemas import get_tool_json_schema_map


def _normalize_key(key: str) -> str:
    return key.lower().strip().replace('-', '_')


def sanitize_plan(plan: Optional[List[Any]], registry: Optional[Dict[str, Any]] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Sanitize an LLM-produced plan.

    Args:
        plan: list of steps: {function_name|tool, arguments|args}
        registry: mapping tool_name -> callable (defaults to FUNCTION_REGISTRY)

    Returns:
        (clean_plan, diagnostics)
        diagnostics example:
        {
          'dropped': [ {'step': original_step, 'reason': 'unknown_tool'} ],
          'modified': [ {'original': step_before, 'updated': step_after, 'changes': {...}} ]
        }
    """
    registry = registry or FUNCTION_REGISTRY
    schema_map = get_tool_json_schema_map()
    clean: List[Dict[str, Any]] = []
    diagnostics = {"dropped": [], "modified": []}

    for raw in plan or []:
        original = raw
        # Allow raw steps that are strings (just tool names)
        if isinstance(raw, str):
            raw = {"function_name": raw, "arguments": {}}
        if not isinstance(raw, dict):  # skip unrecognized shapes
            diagnostics['dropped'].append({"step": original, "reason": "invalid_step_type"})
            continue
        fn_name = raw.get('function_name') or raw.get('tool')
        if not fn_name:
            diagnostics['dropped'].append({"step": original, "reason": "missing_function_name"})
            continue
        if fn_name not in registry:
            diagnostics['dropped'].append({"step": original, "reason": "unknown_tool"})
            continue
        args = raw.get('arguments') or raw.get('args') or {}
        if not isinstance(args, dict):  # make args a dict if malformed
            args = {"_input": args}
        updated = {"function_name": fn_name, "arguments": {}}
        changes = {}
        # Normalize keys case-insensitively; accept only those present in schema if schema known
        schema = schema_map.get(fn_name, {})
        allowed = set(schema.get('properties', {}).keys()) if schema else None
        for k, v in args.items():
            nk = _normalize_key(k)
            # best-effort match to allowed if present
            target_key = None
            if allowed:
                for cand in allowed:
                    if nk == _normalize_key(cand):
                        target_key = cand
                        break
                if not target_key:
                    # unrecognized argument, drop it
                    changes[k] = {"action": "dropped_arg"}
                    continue
            else:
                target_key = k
            if target_key != k:
                changes[k] = {"action": "renamed", "to": target_key}
            updated['arguments'][target_key] = v
        if changes:
            diagnostics['modified'].append({"original": original, "updated": updated, "changes": changes})
        clean.append(updated)
    return clean, diagnostics
