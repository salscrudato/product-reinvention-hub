"""State containers for the mapping workflow."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class MappingState:
    """Aggregated state shared across mapping agents."""

    assignment_name: str = ""
    assignment_page_id: Optional[str] = None
    assignment_page_url: Optional[str] = None
    local_dir: Optional[Path] = None
    spreadsheet_path: Optional[Path] = None
    word_path: Optional[Path] = None
    presentation_path: Optional[Path] = None
    mapping_output_path: Optional[Path] = None
    metadata_json_path: Optional[Path] = None
    spreadsheet_attachment_id: Optional[str] = None
    spreadsheet_attachment_title: Optional[str] = None
    word_attachment_id: Optional[str] = None
    word_attachment_title: Optional[str] = None
    spreadsheet_fingerprint: Optional[str] = None
    word_fingerprint: Optional[str] = None

    source_columns: List[Dict[str, Any]] = field(default_factory=list)
    source_column_samples: Dict[str, List[str]] = field(default_factory=dict)
    column_value_samples: Dict[str, Dict[str, List[str]]] = field(default_factory=dict)
    target_fields: List[Dict[str, Any]] = field(default_factory=list)
    excel_objects: List[Dict[str, Any]] = field(default_factory=list)
    wiki_notes: Dict[str, Any] = field(default_factory=dict)
    history_suggestions: List[Dict[str, Any]] = field(default_factory=list)
    mapping_rows: List[Dict[str, Any]] = field(default_factory=list)
    validation_issues: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    supplemental_insights: List[Dict[str, Any]] = field(default_factory=list)
    knowledge_conflicts: List[Dict[str, Any]] = field(default_factory=list)
    review_summary: Optional[str] = None
    errors: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    durations_ms: Dict[str, int] = field(default_factory=dict)

    def record_duration(self, step: str, elapsed_ms: int) -> None:
        self.durations_ms[step] = elapsed_ms
