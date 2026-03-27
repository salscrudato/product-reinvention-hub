"""Derive contextual signals from mapping assignment artifacts."""
from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from .logging_utils import log_method_end, log_method_progress, log_method_start
from .parsers import ExcelSummary, WordSummary, summarize_word_analysis
from .progress import step_tracker
from .state import MappingState

logger = logging.getLogger("agentic_orchestrator_auto.mapping.context")

_IDENTIFIER_HINTS: Tuple[str, ...] = ("id", "number", "code", "key", "reference", "guid")
_DATE_HINTS: Tuple[str, ...] = ("date", "time", "day", "month", "year")
_AMOUNT_HINTS: Tuple[str, ...] = ("amount", "value", "balance", "total", "sum", "premium")


def _match_keywords(value: str, keywords: Tuple[str, ...]) -> bool:
    lowered = value.lower()
    return any(keyword in lowered for keyword in keywords)


def _collect_column_stats(columns: Dict[str, List[str]]) -> Dict[str, Dict[str, List[str]]]:
    stats: Dict[str, Dict[str, List[str]]] = {}
    for sheet, names in columns.items():
        stats[sheet] = {
            "identifier_candidates": [name for name in names if _match_keywords(name, _IDENTIFIER_HINTS)],
            "date_columns": [name for name in names if _match_keywords(name, _DATE_HINTS)],
            "amount_columns": [name for name in names if _match_keywords(name, _AMOUNT_HINTS)],
        }
    return stats


def _summarize_headings(headings: List[str]) -> Dict[str, int]:
    tokens: List[str] = []
    for heading in headings:
        tokens.extend(re.findall(r"[A-Za-z]+", heading.lower()))
    counts = Counter(tokens)
    most_common = {token: count for token, count in counts.most_common(15) if count > 1}
    return most_common


def _summarize_object_descriptions(objects: List[Any]) -> Dict[str, int]:
    tokens: List[str] = []
    for descriptor in objects:
        name = str(descriptor.name).lower() if getattr(descriptor, "name", None) else ""
        description = str(descriptor.description).lower() if getattr(descriptor, "description", None) else ""
        path = str(descriptor.path).lower() if getattr(descriptor, "path", None) else ""
        text = " ".join(filter(None, [name, description, path]))
        if text:
            tokens.extend(re.findall(r"[A-Za-z]+", text))
    counts = Counter(tokens)
    return {token: count for token, count in counts.most_common(15) if count > 1}


def build_excel_context_snapshot(excel_summary: ExcelSummary) -> Tuple[Dict[str, Any], List[str]]:
    stats = _collect_column_stats(excel_summary.column_samples)
    object_keywords = _summarize_object_descriptions(excel_summary.objects)
    total_source_columns = sum(len(names) for names in excel_summary.column_samples.values())
    context = {
        "sheet_summary": stats,
        "total_source_columns": total_source_columns,
        "excel_objects": {
            "count": len(excel_summary.objects),
            "keyword_frequency": object_keywords,
        },
    }
    warnings: List[str] = []
    if not excel_summary.objects:
        warnings.append("Spreadsheet JSON descriptors missing; unable to leverage field descriptions for mapping.")
    elif not object_keywords:
        warnings.append("JSON descriptors present but share no repeated keywords; semantic ranking may be limited.")
    if total_source_columns == 0:
        warnings.append("Spreadsheet has no visible columns; please verify the attachment.")
    return context, warnings


def build_word_context_snapshot(word_summary: WordSummary, analysis: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], List[str]]:
    heading_keywords = _summarize_headings(word_summary.headings)
    analysis = analysis or summarize_word_analysis(word_summary)
    totals = analysis.get("totals", {})
    superscripts = analysis.get("superscripts", {})
    endnotes = analysis.get("endnotes", {})
    classification = analysis.get("classificationBreakdown", {})
    repeat_distribution = analysis.get("repeatDistribution", [])
    insights = analysis.get("insights", [])
    dynamic_fields = word_summary.stats.get("dynamic_fields", 0)
    paragraph_fields = totals.get("non_table_fields", 0)
    table_fields = totals.get("table_fields", 0)
    unique_placeholders = totals.get("unique_placeholders", 0)
    endnote_usage_map: Dict[str, int] = {}
    for field in word_summary.fields or []:
        for note_id in getattr(field, "endnote_ids", []) or []:
            endnote_usage_map[note_id] = endnote_usage_map.get(note_id, 0) + 1
    cards = [
        {"label": "Dynamic Placeholders", "value": dynamic_fields},
        {"label": "Unique Placeholders", "value": unique_placeholders},
        {"label": "Paragraph Fields", "value": paragraph_fields},
        {"label": "Table Fields", "value": table_fields},
        {"label": "Disclosures Linked", "value": endnotes.get("total", 0)},
        {"label": "Superscript Blocks", "value": superscripts.get("total", 0)},
    ]
    overview = {
        "cards": cards,
        "totals": totals,
        "classificationBreakdown": classification,
        "repeatDistribution": repeat_distribution[:10],
        "insights": insights,
        "superscripts": superscripts,
        "endnotes": {
            **endnotes,
            "details": (endnotes.get("details", []) or [])[:50],
            "usage": endnote_usage_map,
        },
    }
    context = {
        "heading_keyword_frequency": heading_keywords,
        "total_target_fields": len(word_summary.fields) or len(word_summary.headings),
        "word_template": {
            "dynamic_fields": dynamic_fields,
            "static_sections": word_summary.stats.get("static_sections", []),
            "overview": overview,
        },
    }
    warnings: List[str] = []
    if not heading_keywords:
        warnings.append("Word template headings do not share common keywords; downstream matching may be harder.")
    if not word_summary.fields:
        warnings.append("Word template did not expose dynamic placeholders; verify template formatting.")
    return context, warnings


def build_context_profile(state: MappingState, excel_summary: ExcelSummary, word_summary: WordSummary) -> MappingState:
    """Populate contextual metadata used by downstream mapping agents."""
    method = "context_enrichment.build_context_profile"
    log_method_start(
        logger,
        method,
        "Summarize spreadsheet + template context for downstream agents",
        sheet_count=len(excel_summary.sheets),
        heading_count=len(word_summary.headings),
    )
    with step_tracker(6, state, {"sheets": len(excel_summary.sheets), "headings": len(word_summary.headings)}):
        state.source_column_samples = excel_summary.column_samples
        excel_context, excel_warnings = build_excel_context_snapshot(excel_summary)
        word_context, word_warnings = build_word_context_snapshot(word_summary)
        state.metadata.setdefault("context_profile", {})
        state.metadata["context_profile"].update(excel_context)
        state.metadata["context_profile"].update(word_context)
    for warning in (*word_warnings, *excel_warnings):
        state.warnings.append(warning)
        log_method_progress(logger, method, "Added warning", warning=warning)
    log_method_end(
        logger,
        method,
        "Context profile complete",
        total_source_columns=state.metadata["context_profile"].get("total_source_columns"),
        total_target_fields=state.metadata["context_profile"].get("total_target_fields"),
    )
    return state


__all__ = [
    "build_context_profile",
    "build_excel_context_snapshot",
    "build_word_context_snapshot",
]
