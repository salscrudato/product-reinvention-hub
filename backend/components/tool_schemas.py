import inspect
from typing import Any, Dict, List, Optional, get_origin, get_args

try:
    from pydantic import BaseModel  # noqa: F401
    PYDANTIC_AVAILABLE = True
except Exception:  # pragma: no cover
    PYDANTIC_AVAILABLE = False

from .shared_registry import FUNCTION_REGISTRY


PRIMITIVE_TYPE_MAP = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
}


def _annotation_to_json_type(annotation: Any) -> Dict[str, Any]:
    """Best-effort conversion of a Python type annotation to a JSON Schema fragment."""
    if annotation is inspect._empty:
        return {"type": "string"}
    if annotation in PRIMITIVE_TYPE_MAP:
        return {"type": PRIMITIVE_TYPE_MAP[annotation]}
    origin = get_origin(annotation)
    if origin in (list, List):  # lists
        args = get_args(annotation)
        item_schema = _annotation_to_json_type(args[0]) if args else {"type": "string"}
        return {"type": "array", "items": item_schema}
    if origin in (dict, Dict):
        return {"type": "object"}
    # Fallback
    return {"type": "string"}


def _build_function_schema(fn) -> Dict[str, Any]:
    """Build JSON schema for a function's arguments.
    
    Priority:
    1. Use Pydantic args_schema if available (from LangChain Tool objects)
    2. Fall back to introspecting function signature
    """
    # Check if this is a LangChain Tool object with args_schema
    if hasattr(fn, 'args_schema') and fn.args_schema and PYDANTIC_AVAILABLE:
        try:
            from pydantic import BaseModel
            if isinstance(fn.args_schema, type) and issubclass(fn.args_schema, BaseModel):
                # Convert Pydantic model to JSON schema
                pydantic_schema = fn.args_schema.model_json_schema()
                return {
                    "type": "object",
                    "properties": pydantic_schema.get("properties", {}),
                    "required": pydantic_schema.get("required", [])
                }
        except Exception:
            pass  # Fall back to signature inspection
    
    # Fall back to introspecting function signature
    sig = inspect.signature(fn)
    properties = {}
    required = []
    for name, param in sig.parameters.items():
        if param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
            continue
        properties[name] = _annotation_to_json_type(param.annotation)
        if param.default is inspect._empty:
            required.append(name)
    schema: Dict[str, Any] = {
        "type": "object",
        "properties": properties,
    }
    if required:
        schema["required"] = required
    return schema


def get_tool_specs(tool_names: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Return a list of tool specification dicts.

    Each spec: { name, schema (JSON schema), doc }
    Optionally filter by tool_names.
    """
    specs: List[Dict[str, Any]] = []
    names = tool_names or list(FUNCTION_REGISTRY.keys())
    for n in names:
        fn = FUNCTION_REGISTRY.get(n)
        if not callable(fn):
            continue
        doc = (fn.__doc__ or '').strip()
        schema = _build_function_schema(fn)
        specs.append({
            "name": n,
            "schema": schema,
            "doc": doc,
        })
    # deterministic ordering
    specs.sort(key=lambda d: d["name"])  # type: ignore
    return specs


def get_tool_json_schema_map(tool_names: Optional[List[str]] = None) -> Dict[str, Dict[str, Any]]:
    """Convenience: map of tool_name -> JSON schema (arguments schema only)."""
    return {spec["name"]: spec["schema"] for spec in get_tool_specs(tool_names)}


def describe_tools_for_prompt() -> str:
    """Return a human-readable description block for inclusion in planner prompts."""
    lines = []
    for spec in get_tool_specs():
        schema_props = ", ".join(spec["schema"].get("properties", {}).keys())
        lines.append(f"- {spec['name']}({schema_props}) :: {spec['doc'][:120] if spec['doc'] else 'No description.'}")
    return "\n".join(lines)
