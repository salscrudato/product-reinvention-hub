"""PHASE3: Arg extractors registry.
Rollback Phase3: delete file & remove imports.
"""
import re
from typing import Optional

INC_RE = re.compile(r"\bINC0*\d+\b", re.IGNORECASE)
CHG_RE = re.compile(r"\bCHG0*\d+\b", re.IGNORECASE)
ASSIGN_GROUP_RE = re.compile(r"assignment group\s+([A-Za-z0-9_\- ]{2,40})", re.IGNORECASE)
CI_RE = re.compile(r"\bCI[: ]+([A-Za-z0-9_\-.]{2,60})", re.IGNORECASE)

def extract_incident_number(text: str) -> Optional[str]:
    m = INC_RE.search(text or "")
    return m.group(0).upper() if m else None

def extract_change_id(text: str) -> Optional[str]:
    m = CHG_RE.search(text or "")
    return m.group(0).upper() if m else None

def extract_assignment_group(text: str) -> Optional[str]:
    m = ASSIGN_GROUP_RE.search(text or "")
    return m.group(1).strip() if m else None

def extract_ci(text: str) -> Optional[str]:
    m = CI_RE.search(text or "")
    return m.group(1) if m else None

EXTRACTOR_REGISTRY = {
    'incident_number': extract_incident_number,
    'change_id': extract_change_id,
    'assignment_group': extract_assignment_group,
    'ci': extract_ci,
}

__all__ = ['EXTRACTOR_REGISTRY','extract_incident_number','extract_change_id','extract_assignment_group','extract_ci']
