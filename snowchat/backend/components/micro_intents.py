"""micro_intents

Lightweight, regex-based classifier for narrow field queries to reduce plan/tool usage.
Returns a dict with:
  micro_intent: str | None
  fields: list[str] (incident fields requested)
  include_logs: bool
  include_traces: bool
  confidence: float (0-1)

Environment flag ENABLE_MICRO_INTENTS controls activation.
"""
from __future__ import annotations
import re
from typing import Dict, Any, List, Optional

MICRO_INTENT_PATTERNS = [
    (r"\b(who .*assigned|assignee|who owns)\b", "incident_assignee_lookup", ["assigned_to", "assignment_group"], 0.85),
    (r"\b(priority|prio)\b", "incident_priority_lookup", ["priority"], 0.75),
    (r"\b(state|status)\b", "incident_state_lookup", ["state"], 0.75),
    (r"\b(when (was )?(it|this|incident) opened|opened at|created)\b", "incident_opened_lookup", ["opened_at"], 0.8),
    (r"\b(work ?notes|summary of notes)\b", "incident_work_notes_lookup", ["work_notes"], 0.8),
    (r"\b(transitions|moved from|state changes|group changes)\b", "incident_transitions_lookup", ["state", "assignment_group"], 0.8),
    (r"\b(workaround|temporary fix|fix applied)\b", "incident_workaround_lookup", ["workaround"], 0.85),
    (r"\b(datadog|logs|error log|application log)\b", "incident_logs_lookup", [], 0.8),
    (r"\b(trace|distributed trace|apm)\b", "incident_traces_lookup", [], 0.8),
]

INC_REGEX = re.compile(r"\bINC0*\d+\b", re.IGNORECASE)

def classify_micro_intent(question: str, known_incidents: Optional[List[str]] = None) -> Dict[str, Any]:
    q = question or ""
    q_lower = q.lower()
    best: Dict[str, Any] = {"micro_intent": None, "fields": [], "include_logs": False, "include_traces": False, "confidence": 0.0}
    for pattern, intent, fields, base_conf in MICRO_INTENT_PATTERNS:
        if re.search(pattern, q_lower):
            conf = base_conf
            # Boost if explicit incident number present
            if INC_REGEX.search(q_lower):
                conf += 0.1
            # Boost if exactly one known incident in context
            if known_incidents and len(known_incidents) == 1:
                conf += 0.05
            # Cap at 0.99
            conf = min(conf, 0.99)
            logs = intent in ("incident_logs_lookup",)
            traces = intent in ("incident_traces_lookup",)
            candidate = {
                "micro_intent": intent,
                "fields": fields,
                "include_logs": logs,
                "include_traces": traces,
                "confidence": conf,
            }
            # Prefer higher confidence or first detection when tie
            if candidate["confidence"] > best["confidence"]:
                best = candidate
    return best

__all__ = ["classify_micro_intent"]
