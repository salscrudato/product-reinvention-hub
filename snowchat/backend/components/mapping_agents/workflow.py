"""Initial mapping workflow implementation for assignment artifacts.

This module provides the first agent in the mapping workflow – responsible for
locating the assignment page, downloading attachments, and producing structured
summaries used by downstream agents (context enrichment, synthesis, validation).
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

from ..snowaaonetool import register_tool_function
from .context_enrichment import build_context_profile
from .exceptions import MappingDataError
from .history_retriever import inject_historical_context
from .index_cache import ensure_column_index
from .knowledge_agent import compile_knowledge_alerts
from .mapping_synthesizer import synthesize_mapping_rows
from .page_locator import PageLocatorResult, locate_assignment_page
from .parsers import (
    ExcelObjectDescriptor,
    ExcelSummary,
    PresentationSummary,
    WordSummary,
    parse_excel,
    parse_presentation,
    parse_word_document,
)
from .progress import log_step, step_tracker, update_state_progress
from .state import MappingState
from .target_cache import build_target_descriptors, ensure_target_embedding_cache
from .validator import validate_mapping_rows
from .wiki_downloader import AttachmentRecord, ConfluenceClient

logger = logging.getLogger("agentic_orchestrator_auto.mapping.workflow")


@contextmanager
def _log_step(step: str, **details: Any) -> Iterator[None]:
    """Context manager that logs step lifecycle with elapsed time."""
    start = time.perf_counter()
    payload = {k: v for k, v in details.items() if v is not None}
    try:
        logger.info("[mapping.workflow] step_start | step=%s details=%s", step, json.dumps(payload, default=str))
        yield
        elapsed = int((time.perf_counter() - start) * 1000)
        logger.info("[mapping.workflow] step_complete | step=%s duration_ms=%s", step, elapsed)
    except Exception as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        logger.exception("[mapping.workflow] step_failed | step=%s duration_ms=%s error=%s details=%s", step, elapsed, exc, json.dumps(payload, default=str))
        raise


@dataclass
class AssignmentArtifacts:
    """Container for assignment workspace outputs used across agents."""

    state: MappingState
    workspace: Path
    spreadsheet_attachment: AttachmentRecord
    word_attachment: AttachmentRecord
    presentation_attachment: Optional[AttachmentRecord]
    excel_summary: ExcelSummary
    word_summary: WordSummary
    presentation_summary: Optional[PresentationSummary]


def _truncate_column_value_samples(
    column_value_samples: Dict[str, Dict[str, List[str]]],
    max_columns: int = 8,
) -> Dict[str, Dict[str, List[str]]]:
    truncated: Dict[str, Dict[str, List[str]]] = {}
    for sheet, columns in column_value_samples.items():
        limited: Dict[str, List[str]] = {}
        for idx, (column, samples) in enumerate(columns.items()):
            if idx >= max_columns:
                break
            limited[column] = samples[:3]
        if limited:
            truncated[sheet] = limited
    return truncated


def _serialize_excel_objects(objects: List[ExcelObjectDescriptor], limit: int = 80) -> List[Dict[str, Any]]:
    serialized: List[Dict[str, Any]] = []
    for descriptor in objects[:limit]:
        serialized.append(
            {
                "sheet": descriptor.sheet,
                "row_index": descriptor.row_index,
                "column": descriptor.column,
                "name": descriptor.name,
                "description": descriptor.description,
                "path": descriptor.path,
                "sample": descriptor.sample,
                "examples": descriptor.examples[:3],
                "origin": descriptor.origin,
            }
        )
    return serialized


def _write_result_file(payload: Dict[str, Any], workspace: Path) -> Optional[str]:
    try:
        dump_dir = workspace / "mapping_outputs"
        dump_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S")
        file_path = dump_dir / f"mapping_result_{timestamp}.json"
        with file_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        logger.info("[mapping.workflow] Result payload persisted | path=%s", file_path)
        return str(file_path)
    except Exception as exc:  # pragma: no cover - best-effort persistence
        logger.warning("[mapping.workflow] Failed to persist result payload | error=%s", exc, exc_info=True)
        return None


def _trim_result_payload(payload: Dict[str, Any], file_path: Optional[str]) -> Dict[str, Any]:
    mapping_rows = payload.get("mapping") or []
    history = payload.get("history") or []
    context = payload.get("context") or {}
    insights = payload.get("insights") or {}
    preview_rows = mapping_rows[:5]
    preview_history = history[:5] if isinstance(history, list) else history
    trimmed = {
        "assignment": payload.get("assignment"),
        "workspace": payload.get("workspace"),
        "summaries": payload.get("summaries"),
        "context_profile": context.get("profile"),
        "history_preview": preview_history,
        "mapping_preview": preview_rows,
        "mapping_counts": {
            "total_rows": len(mapping_rows),
            "preview_rows": len(preview_rows),
        },
        "validation": payload.get("validation"),
        "warnings": payload.get("warnings"),
        "insights": insights,
        "result_file": file_path,
    }
    return trimmed

DEFAULT_ASSIGNMENT_URL = os.getenv(
    "SNOWCHAT_MAPPING_DEFAULT_ASSIGNMENT",
    "https://smamidala.atlassian.net/wiki/spaces/FirstWiki/pages/56918017/assignment1",
)

SPREADSHEET_SUFFIXES = (".xlsx", ".xls", ".csv")
WORD_SUFFIXES = (".docx",)
PRESENTATION_SUFFIXES = (".pptx", ".ppt")


def extract_assignment_link(question: str, explicit: Optional[str]) -> Optional[str]:
    if explicit:
        return explicit
    if not isinstance(question, str):
        return None
    match = re.search(r"https?://[^\s>]+", question)
    if not match:
        return None
    candidate = match.group(0).rstrip(').,')
    return candidate


def _select_attachment(attachments: List[AttachmentRecord], suffixes: Tuple[str, ...]) -> Optional[AttachmentRecord]:
    for att in attachments:
        title_lower = att.title.lower()
        if any(title_lower.endswith(suf) for suf in suffixes):
            return att
    return None


def _create_workspace() -> Path:
    base_dir = os.getenv("SNOWCHAT_MAPPING_WORKDIR")
    if base_dir:
        Path(base_dir).mkdir(parents=True, exist_ok=True)
        path = Path(tempfile.mkdtemp(prefix="mapping-run-", dir=base_dir))
    else:
        path = Path(tempfile.mkdtemp(prefix="mapping-run-"))
    logger.info("[mapping.workflow] Workspace created | path=%s", path)
    return path


def _summarize_excel(path: Path) -> ExcelSummary:
    if path.suffix.lower() == ".csv":
        try:
            import pandas as pd  # type: ignore
        except ImportError as exc:  # pragma: no cover
            raise MappingDataError("pandas is required to parse CSV attachments.") from exc

        logger.info("[mapping.workflow] Parsing CSV spreadsheet | path=%s", path)
        df = pd.read_csv(path)
        numeric = df.select_dtypes(include=["number"])  # type: ignore[arg-type]
        metrics: Dict[str, float] = {}
        if not numeric.empty:
            metrics["csv"] = float(numeric.sum().sum())
        return ExcelSummary(sheets=["CSV"], metrics=metrics)
    logger.info("[mapping.workflow] Parsing Excel workbook | path=%s", path)
    return parse_excel(str(path))


def _optional_presentation_summary(path: Optional[Path]) -> Optional[PresentationSummary]:
    if not path:
        return None
    try:
        return parse_presentation(str(path))
    except MappingDataError as exc:  # dependency missing or file absent
        logger.warning("[mapping.workflow] Presentation parsing skipped | error=%s", exc)
        return None


def prepare_assignment_artifacts(
    question: str,
    assignment_link: Optional[str] = None,
    persist_workspace: bool = True,
) -> AssignmentArtifacts:
    """Locate assignment page, download artifacts, and produce base summaries."""

    started = time.perf_counter()
    link_override = extract_assignment_link(question, assignment_link)
    step2_extra: Dict[str, object] = {
        "assignment_link": link_override or assignment_link or DEFAULT_ASSIGNMENT_URL
    }
    log_step(2, "start", step2_extra)
    with _log_step("locate_assignment_page", question=question[:120], link_override=link_override):
        locator_result = locate_assignment_page(link_override or DEFAULT_ASSIGNMENT_URL)
    with _log_step("init_confluence_client"):
        client = ConfluenceClient()
    workspace = _create_workspace()
    state = MappingState(
        assignment_name=locator_result.page.title,
        assignment_page_id=locator_result.page.id,
        assignment_page_url=locator_result.assignment_link,
        local_dir=workspace,
    )
    update_state_progress(state, 2, "start", step2_extra)
    with _log_step("list_attachments", page_id=locator_result.page.id):
        attachments = client.list_attachments(locator_result.page.id)
    spreadsheet_att = _select_attachment(attachments, SPREADSHEET_SUFFIXES)
    doc_att = _select_attachment(attachments, WORD_SUFFIXES)
    deck_att = _select_attachment(attachments, PRESENTATION_SUFFIXES)
    if not spreadsheet_att or not doc_att:
        state.warnings.append("Assignment page is missing required spreadsheet or docx attachments.")
        raise MappingDataError("Assignment page must contain both spreadsheet and Word template attachments.")
    spreadsheet_path = workspace / spreadsheet_att.title.replace("/", "_")
    doc_path = workspace / doc_att.title.replace("/", "_")
    with step_tracker(
        3,
        state,
        {"page_id": locator_result.page.id, "attachments": [spreadsheet_att.title, doc_att.title]},
    ):
        with _log_step("download_spreadsheet", attachment_id=spreadsheet_att.id, title=spreadsheet_att.title):
            client.download_attachment(spreadsheet_att, str(spreadsheet_path))
        with _log_step("download_word_template", attachment_id=doc_att.id, title=doc_att.title):
            client.download_attachment(doc_att, str(doc_path))
    state.spreadsheet_path = spreadsheet_path
    state.word_path = doc_path
    state.spreadsheet_attachment_id = spreadsheet_att.id
    state.spreadsheet_attachment_title = spreadsheet_att.title
    state.word_attachment_id = doc_att.id
    state.word_attachment_title = doc_att.title
    deck_path: Optional[Path] = None
    if deck_att:
        deck_path = workspace / deck_att.title.replace("/", "_")
        with _log_step("download_presentation", attachment_id=deck_att.id, title=deck_att.title):
            client.download_attachment(deck_att, str(deck_path))
        state.presentation_path = deck_path
    with step_tracker(4, state, {"path": str(spreadsheet_path)}):
        with _log_step("parse_spreadsheet", path=str(spreadsheet_path)):
            excel_summary = _summarize_excel(spreadsheet_path)
    with step_tracker(5, state, {"path": str(doc_path)}):
        with _log_step("parse_word_template", path=str(doc_path)):
            word_summary = parse_word_document(str(doc_path))
    presentation_summary: Optional[PresentationSummary] = None
    if deck_path:
        with _log_step("parse_presentation", path=str(deck_path)):
            presentation_summary = _optional_presentation_summary(deck_path)
    state.source_columns = [
        {"sheet": sheet, "numeric_sum": excel_summary.metrics.get(sheet)}
        for sheet in excel_summary.sheets
    ]
    target_descriptors = build_target_descriptors(word_summary)
    if target_descriptors:
        state.target_fields = [
            {
                "heading": descriptor.get("heading"),
                "placeholder": descriptor.get("placeholder"),
                "label": descriptor.get("label"),
                "classification": descriptor.get("classification"),
                "location": descriptor.get("location"),
                "occurrence_index": descriptor.get("occurrence_index", 1),
                "occurrence_total": descriptor.get("occurrence_total", 1),
                "array_group": descriptor.get("group_key"),
            }
            for descriptor in target_descriptors
        ]
    else:
        state.target_fields = [
            {"heading": heading}
            for heading in word_summary.headings
        ]
    try:
        ensure_target_embedding_cache(state, word_summary, descriptors=target_descriptors or None)
    except Exception as exc:  # pragma: no cover - cache is best-effort
        logger.warning("[mapping.workflow] Target embedding cache unavailable: %s", exc, exc_info=True)
    target_cache_snapshot: Dict[str, List[float]] = {}
    retrieval_cache = state.metadata.get("retrieval_cache")
    if isinstance(retrieval_cache, dict):
        embedded = retrieval_cache.get("target_heading_embeddings")
        if isinstance(embedded, dict):
            target_cache_snapshot = embedded
    logger.info(
        "[mapping.workflow] retrieval_cache_attached | assignment=%s headings=%s sample=%s",
        state.assignment_page_id,
        len(target_cache_snapshot),
        list(target_cache_snapshot.keys())[:5],
    )
    state.source_column_samples = excel_summary.column_samples
    state.column_value_samples = excel_summary.column_value_samples
    state.excel_objects = [asdict(obj) for obj in excel_summary.objects]
    state.metadata.setdefault("excel_column_value_samples", state.column_value_samples)
    state.metadata.setdefault("excel_objects", state.excel_objects)
    ensure_column_index(state)
    if presentation_summary:
        state.wiki_notes["presentation_titles"] = presentation_summary.titles
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    state.record_duration("assignment_preparation", elapsed_ms)
    logger.info(
        "[mapping.workflow] Assignment artifacts prepared | assignment=%s workspace=%s duration_ms=%s",
        locator_result.page.title,
        workspace,
        elapsed_ms,
    )
    update_state_progress(state, 2, "end", {"duration_ms": elapsed_ms})
    log_step(2, "end", {"assignment": locator_result.page.title, "duration_ms": elapsed_ms})
    return AssignmentArtifacts(
        state=state,
        workspace=workspace,
        spreadsheet_attachment=spreadsheet_att,
        word_attachment=doc_att,
        presentation_attachment=deck_att,
        excel_summary=excel_summary,
        word_summary=word_summary,
        presentation_summary=presentation_summary,
    )


def assemble_workflow_result(
    artifacts: AssignmentArtifacts,
    state: MappingState,
    persist_workspace: bool,
    excel_summary: Optional[ExcelSummary] = None,
    word_summary: Optional[WordSummary] = None,
    presentation_summary: Optional[PresentationSummary] = None,
) -> Dict[str, Any]:
    """Build structured workflow response payload."""

    excel_summary = excel_summary or artifacts.excel_summary
    word_summary = word_summary or artifacts.word_summary
    if presentation_summary is None:
        presentation_summary = artifacts.presentation_summary
    workspace = artifacts.workspace
    spreadsheet_att = artifacts.spreadsheet_attachment
    doc_att = artifacts.word_attachment
    deck_att = artifacts.presentation_attachment
    deck_path = state.presentation_path if deck_att else None
    result = {
        "assignment": {
            "title": state.assignment_name,
            "page_id": state.assignment_page_id,
            "page_url": state.assignment_page_url,
        },
        "workspace": {
            "path": str(workspace),
            "persisted": persist_workspace,
        },
        "progress": state.metadata.get("progress"),
        "artifacts": {
            "spreadsheet": {
                "path": str(state.spreadsheet_path) if state.spreadsheet_path else None,
                "attachment_id": spreadsheet_att.id,
                "title": spreadsheet_att.title,
            },
            "word_template": {
                "path": str(state.word_path) if state.word_path else None,
                "attachment_id": doc_att.id,
                "title": doc_att.title,
            },
            **(
                {
                    "presentation": {
                        "path": str(deck_path) if deck_path else None,
                        "attachment_id": deck_att.id if deck_att else None,
                        "title": deck_att.title if deck_att else None,
                    }
                }
                if deck_att
                else {}
            ),
        },
        "summaries": {
            "excel": {
                "sheets": excel_summary.sheets,
                "metrics": excel_summary.metrics,
                "column_value_samples": _truncate_column_value_samples(excel_summary.column_value_samples),
                "objects": _serialize_excel_objects(excel_summary.objects),
            },
            "word": {
                "headings": word_summary.headings[:25],
                "paragraph_preview": word_summary.paragraphs[:10],
                "fields": [
                    {
                        "heading": field.label,
                        "placeholder": field.placeholder,
                        "classification": field.classification,
                        "location": field.location,
                    }
                    for field in word_summary.fields[:50]
                ],
                "stats": word_summary.stats,
            },
            "presentation": (
                {
                    "slide_count": presentation_summary.slide_count,
                    "titles": presentation_summary.titles[:25],
                }
                if presentation_summary
                else None
            ),
        },
        "context": {
            "source_columns": state.source_columns,
            "source_column_samples": state.source_column_samples,
            "column_value_samples": state.column_value_samples,
            "target_fields": state.target_fields,
            "excel_objects": state.excel_objects,
            "profile": state.metadata.get("context_profile", {}),
        },
        "history": state.history_suggestions,
        "mapping": state.mapping_rows,
        "validation": state.validation_issues,
        "insights": {
            "review_summary": state.review_summary,
            "supplemental": state.supplemental_insights,
            "conflicts": state.knowledge_conflicts,
        },
        "state_snapshot": json.loads(json.dumps(asdict(state), default=str)),
        "metadata": state.metadata,
        "errors": state.errors,
        "warnings": state.warnings,
        "duration_ms": state.durations_ms,
    }
    result_file = _write_result_file(result, workspace)
    if result_file:
        return _trim_result_payload(result, result_file)
    return result


def append_artifact_warnings(
    state: MappingState,
    excel_summary: ExcelSummary,
    word_summary: WordSummary,
) -> None:
    """Append baseline artifact warnings to workflow state."""

    if not excel_summary.metrics:
        state.warnings.append("No numeric columns found in spreadsheet")
    if not word_summary.headings:
        state.warnings.append("Word template has no headings")
    if not word_summary.fields:
        state.warnings.append("Word template fields could not be enumerated; mapping may miss placeholders")


def finalize_state_alerts(state: MappingState) -> None:
    """Append validation-derived warnings and emit log records."""

    critical_warnings = [
        f"Validation: {issue.get('message')} ({issue.get('target_field') or issue.get('source_column')})"
        for issue in state.validation_issues
        if issue.get("severity") == "high"
    ]
    if critical_warnings:
        state.warnings.extend(critical_warnings)
    for warning in state.warnings:
        logger.warning("[mapping.workflow] workflow_warning | message=%s", warning)
    if state.validation_issues:
        logger.info(
            "[mapping.workflow] validation_summary | issues=%s", len(state.validation_issues)
        )
    if state.knowledge_conflicts:
        logger.info(
            "[mapping.workflow] knowledge_conflicts | count=%s", len(state.knowledge_conflicts)
        )


def run_mapping_workflow(question: str, assignment_link: Optional[str] = None, persist_workspace: bool = True) -> Dict[str, Any]:
    """Execute the initial mapping workflow steps.

    Returns a structured dictionary containing assignment metadata, workspace
    details, downloaded artifact paths, and lightweight summaries ready for
    downstream agents.
    """
    started = time.perf_counter()
    artifacts = prepare_assignment_artifacts(
        question=question,
        assignment_link=assignment_link,
        persist_workspace=persist_workspace,
    )
    state = artifacts.state
    excel_summary = artifacts.excel_summary
    word_summary = artifacts.word_summary
    presentation_summary = artifacts.presentation_summary
    workspace = artifacts.workspace
    spreadsheet_att = artifacts.spreadsheet_attachment
    doc_att = artifacts.word_attachment
    deck_att = artifacts.presentation_attachment
    with _log_step("context_enrichment"):
        build_context_profile(state, excel_summary, word_summary)
    with _log_step("history_similarity", assignment=state.assignment_name):
        inject_historical_context(state)
    with _log_step("mapping_synthesis"):
        synthesize_mapping_rows(state)
    with _log_step("mapping_validation"):
        validate_mapping_rows(state)
    with _log_step("knowledge_analysis"):
        compile_knowledge_alerts(state)
    append_artifact_warnings(state, excel_summary, word_summary)
    finalize_state_alerts(state)
    state.record_duration("initial_locator", int((time.perf_counter() - started) * 1000))
    result = assemble_workflow_result(
        artifacts=artifacts,
        state=state,
        persist_workspace=persist_workspace,
        excel_summary=excel_summary,
        word_summary=word_summary,
        presentation_summary=presentation_summary,
    )
    logger.info(
        "[mapping.workflow] Completed initial workflow | assignment=%s workspace=%s warnings=%s persist_workspace=%s",
        state.assignment_name,
        workspace,
        len(state.warnings),
        persist_workspace,
    )
    return result


@register_tool_function("mapping_assignment_plan")
def mapping_assignment_plan(
    question: str,
    assignment_link: Optional[str] = None,
    persist_workspace: bool = True,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    try:
        from .supervisor import run_mapping_langgraph

        return run_mapping_langgraph(
            question=question,
            assignment_link=assignment_link,
            persist_workspace=persist_workspace,
            metadata=metadata,
        )
    except Exception as exc:
        logger.warning(
            "[mapping.workflow] LangGraph execution unavailable; falling back to sequential workflow | error=%s",
            exc,
            exc_info=True,
        )
        return run_mapping_workflow(
            question=question,
            assignment_link=assignment_link,
            persist_workspace=persist_workspace,
        )


__all__ = [
    "AssignmentArtifacts",
    "assemble_workflow_result",
    "append_artifact_warnings",
    "extract_assignment_link",
    "finalize_state_alerts",
    "prepare_assignment_artifacts",
    "run_mapping_workflow",
    "mapping_assignment_plan",
]
