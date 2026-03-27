"""Trace export hook stub.

Future integration point for streaming traces to external systems (e.g., OpenTelemetry,
custom dashboards, message queues). Currently a no-op unless TRACE_EXPORT_ENABLED env var set.
"""
import os
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


def trace_export_enabled() -> bool:
    return os.getenv("TRACE_EXPORT_ENABLED", "false").lower() in ("1","true","yes","on")


def export_traces(traces: List[Dict[str, Any]]):
    if not trace_export_enabled():
        return False
    try:
        # For now just log a compact representation
        compact = [
            {k: t[k] for k in ("tool", "status", "duration_ms") if k in t}
            for t in traces
        ]
        logger.info(f"[TraceExport] Exporting traces: {compact}")
        return True
    except Exception as e:  # pragma: no cover
        logger.error(f"[TraceExport] Failed to export traces: {e}")
        return False
