import os
import logging
from typing import List, Dict, Any, Optional, MutableMapping
from .shared_registry import FUNCTION_REGISTRY

logger = logging.getLogger(__name__)

class AgentExecutorWrapper:
    """Minimal wrapper to execute a sanitized plan via registered tools.

    Enabled only if the environment variable AGENT_EXECUTOR_ENABLED is one of:
    '1','true','yes','on'. Intended for parity comparison with the
    existing custom orchestrator path. No planning occurs here; caller must
    supply an already-sanitized plan (list of {function_name, arguments}).

    Notes:
        - Type safety: we accept an optional registry to avoid pyright complaining
          about a default bare ``Dict`` parameter with ``None`` default.
        - Each step is expected to be a mapping containing either ``function_name``
          or ``tool`` plus optional ``arguments``/``args`` which if a dict will
          be splatted as kwargs; otherwise passed positionally.
    """
    def __init__(self, registry: Optional[MutableMapping[str, Any]] = None):
        # Fallback to shared registry if none supplied
        self.registry: MutableMapping[str, Any] = registry or FUNCTION_REGISTRY

    @staticmethod
    def is_enabled() -> bool:
        return os.getenv("AGENT_EXECUTOR_ENABLED", "false").lower() in ("1","true","yes","on")

    def run(self, plan: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        """Execute a pre-sanitized plan.

        Args:
            plan: List of step dicts. Each step should have either
                  ``function_name`` or ``tool`` and optionally ``arguments``/``args``.
        Returns:
            A list of execution result dicts with keys: tool, result|error.
        """
        executions: List[Dict[str, Any]] = []
        for step in plan or []:
            # Extract tool name with defensive type checking
            raw_name: Any = step.get('function_name') or step.get('tool')
            if not isinstance(raw_name, str) or not raw_name:
                executions.append({"tool": raw_name, "error": "invalid_function_name"})
                continue
            fn_name = raw_name
            args = step.get('arguments') or step.get('args') or {}
            # Registry lookup (fn_name guaranteed str here)
            fn = self.registry.get(fn_name)  # type: ignore[index]
            if not fn:
                executions.append({"tool": fn_name, "error": "not_found"})
                continue
            try:
                if isinstance(args, dict):
                    result = fn(**args)  # type: ignore[misc]
                else:
                    result = fn(args)  # type: ignore[misc]
                executions.append({"tool": fn_name, "result": result})
            except Exception as e:  # pragma: no cover - protective catch
                executions.append({"tool": fn_name, "error": str(e)})
        return executions
