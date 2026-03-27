"""PHASE3: Prompt usage & fallback events (ring buffer).
Rollback Phase3: delete file & remove related imports and endpoints.
"""
import time, logging, json
from typing import List, Dict, Any

_MAX_EVENTS = 300
_events: List[Dict[str, Any]] = []

def record_event(event_type: str, **kwargs) -> None:
    _events.append({'ts': time.time(), 'type': event_type, **kwargs})
    logging.getLogger("agentic_orchestrator_auto").info("FLOW[PROMPT_EVENT] %s | %s", event_type, json.dumps(kwargs, default=str))
    if len(_events) > _MAX_EVENTS:
        del _events[0: len(_events)-_MAX_EVENTS]

def get_events(kind: str | None = None, limit: int = 50) -> List[Dict[str, Any]]:
    filtered = [e for e in _events if (kind is None or e.get('type') == kind)]
    return list(reversed(filtered[-limit:]))

__all__ = ['record_event','get_events']
