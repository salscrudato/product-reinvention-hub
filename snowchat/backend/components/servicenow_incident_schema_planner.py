import logging
from typing import Dict, Any, List, Optional
from .servicenowgenaitool import fetch_incident_table_metadata_core, fetch_servicenow_incident_core

logger = logging.getLogger("servicenow_incident_schema_planner")

# Simple cache for table metadata to avoid repeated network calls.
_TABLE_METADATA_CACHE: Dict[str, Any] = {}

ASSIGNMENT_FIELD_KEYS = ["assigned_to", "u_assigned_to", "assignment_group"]

FIELD_SYNONYMS = {
    # Map natural language tokens to canonical incident fields
    "assigned to": "assigned_to",
    "assignee": "assigned_to",
    "owner": "assigned_to",
    "assignment group": "assignment_group",
    "group": "assignment_group",
    "priority": "priority",
    "urgency": "urgency",
    "impact": "impact",
    "short description": "short_description",
    "summary": "short_description",
    "workaround": "u_workaround",
    "category": "category",
    "state": "state",
    "status": "incident_state",
}

QUESTION_PATTERNS = [
    # Ordered heuristics; earliest match wins
    ("who is this incident assigned to", "assigned_to"),
    ("who is this assigned to", "assigned_to"),
    ("who is it assigned to", "assigned_to"),
    ("who owns this incident", "assigned_to"),
    ("who owns this ticket", "assigned_to"),
    ("who is the assignee", "assigned_to"),
    ("assignment group", "assignment_group"),
    ("what is the priority", "priority"),
    ("what is the impact", "impact"),
    ("what is the urgency", "urgency"),
    ("what is the category", "category"),
    ("what is the workaround", "u_workaround"),
    ("give me the summary", "short_description"),
]


def _load_metadata(force: bool = False) -> Dict[str, Any]:
    if not _TABLE_METADATA_CACHE or force:
        meta = fetch_incident_table_metadata_core()
        if isinstance(meta, dict) and meta.get("error"):
            logger.warning(f"[schema_planner] Failed to load metadata: {meta['error']}")
            return {}
        _TABLE_METADATA_CACHE.update(meta)
    return _TABLE_METADATA_CACHE


def detect_target_field(question: str) -> Optional[str]:
    q = (question or "").lower().strip()
    for patt, field in QUESTION_PATTERNS:
        if patt in q:
            return field
    # Fallback: look for any synonym token present in question.
    for token, field in FIELD_SYNONYMS.items():
        if token in q:
            return field
    return None


def build_function_sequence_for_field(question: str, known_incidents: List[str]) -> Optional[List[Dict[str, Any]]]:
    """Given a NL question and known incident context, return a minimal function sequence.
    Currently supports direct incident fetch with focused answer.
    """
    target_field = detect_target_field(question)
    if not target_field:
        return None
    if not known_incidents:
        return None
    incident_number = known_incidents[-1]
    # For now, always just fetch the incident; higher-level optimization (e.g. cached partial) could go here.
    return [{
        'function_name': 'fetch_servicenow_incident',
        'arguments': {'incident_number': incident_number, 'target_field': target_field}
    }]


def extract_field_answer(raw_incident: Dict[str, Any], target_field: str) -> Optional[Any]:
    if not isinstance(raw_incident, dict):
        return None
    # Some fields are nested dicts with 'value'; return sensible representation.
    val = raw_incident.get(target_field)
    if isinstance(val, dict) and 'value' in val:
        return val.get('value')
    return val


def summarize_answer(target_field: str, value: Any, incident_number: str) -> str:
    if value is None:
        return f"No value found for {target_field} on incident {incident_number}."
    label = target_field.replace('_', ' ').title()
    return f"{label} for incident {incident_number}: {value}"


def answer_field_question(question: str, known_incidents: List[str]) -> Optional[Dict[str, Any]]:
    seq = build_function_sequence_for_field(question, known_incidents)
    if not seq:
        return None
    incident_number = seq[0]['arguments']['incident_number']
    raw = fetch_servicenow_incident_core(incident_number)
    target_field = seq[0]['arguments'].get('target_field')
    value = extract_field_answer(raw if isinstance(raw, dict) else {}, target_field)
    summary = summarize_answer(target_field, value, incident_number)
    return {
        'plan': seq,
        'tool_outputs': {'fetch_servicenow_incident': raw},
        'field_answer': summary,
        'target_field': target_field,
        'incident_number': incident_number,
        'plan_source': 'schema_field_heuristic'
    }
