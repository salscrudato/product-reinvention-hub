import uuid
from datetime import datetime
from typing import Any, Dict, Optional

SCHEMA_VERSION = 1

BASE_FIELDS = {
    'schema_version': SCHEMA_VERSION,
}

def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec='milliseconds') + 'Z'

def new_event(event_type: str,
              correlation_id: Optional[str] = None,
              **data: Any) -> Dict[str, Any]:
    """Create a normalized event dict.

    Minimal required fields; callers can add arbitrary payload entries.
    """
    evt: Dict[str, Any] = {
        **BASE_FIELDS,
        'event_id': str(uuid.uuid4()),
        'ts': now_iso(),
        'event_type': event_type,
        'correlation_id': correlation_id,
    }
    # Shallow merge user data (do not overwrite mandatory fields accidentally)
    for k, v in data.items():
        if k not in evt or k in ('actor_id','tool_name','intent','plan_source','agent_role','latency_ms','success','persona','plan_size'):
            evt[k] = v
    return evt

__all__ = ['new_event', 'SCHEMA_VERSION']
