"""card_builder

Constructs an incident context card from a canonical ServiceNow incident record and optional telemetry.
This avoids repeated LLM summarization for micro-intent queries.
"""
from __future__ import annotations
from typing import Dict, Any, List
import time, hashlib

def _hash_list(items: List[Any]) -> str:
    h = hashlib.sha1()
    for it in items:
        h.update(str(it).encode('utf-8'))
    return h.hexdigest()[:12]

def build_incident_context_card(incident: Dict[str, Any], include_logs: bool = False, include_traces: bool = False, logs: Dict[str,Any] | None = None, traces: Dict[str,Any] | None = None) -> Dict[str, Any]:
    if not isinstance(incident, dict):
        return {"error": "invalid incident record"}
    number = incident.get('number') or incident.get('incident_number')
    card = {
        "incident_number": number,
        "short_description": incident.get('short_description'),
        "priority": incident.get('priority'),
        "state": incident.get('state'),
        "assignment_group": incident.get('assignment_group'),
        "assigned_to": incident.get('assigned_to') or incident.get('u_assigned_to'),
        "opened_at": incident.get('opened_at'),
        "workaround": incident.get('workaround'),
        "generated_at": time.time(),
    }
    # Simple synthetic work_notes summary placeholder
    notes = incident.get('work_notes') or []
    if isinstance(notes, list) and notes:
        card['work_notes_summary'] = ' | '.join(str(n)[:60] for n in notes[:5])
    elif isinstance(notes, str):
        card['work_notes_summary'] = notes[:200]
    # Placeholder transitions derivation
    transitions = []
    if incident.get('state_history') and isinstance(incident['state_history'], list):
        transitions = incident['state_history'][-5:]
    card['recent_transitions'] = transitions
    if include_logs and logs:
        summary = logs.get('summary', {})
        card['datadog_logs_preview'] = summary.get('top_messages') or summary.get('top_errors') or []
    if include_traces and traces:
        t_summary = traces.get('summary', {})
        spans = t_summary.get('top_spans') or []
        card['datadog_trace_hotspots'] = spans[:5]
    # Hashes for extension identification
    card['fingerprints'] = {
        'base': _hash_list(list(card.items())),
        'logs': _hash_list(card.get('datadog_logs_preview', [])) if include_logs else None,
        'traces': _hash_list(card.get('datadog_trace_hotspots', [])) if include_traces else None,
    }
    return card

__all__ = ['build_incident_context_card']
