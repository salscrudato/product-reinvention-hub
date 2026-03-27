from __future__ import annotations

import shutil
import tempfile
from dataclasses import asdict
import os
import hashlib
from pathlib import Path
from typing import Any, Dict, List, Optional
import logging
import uuid

from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

from .mapping_agents.context_enrichment import (
    build_excel_context_snapshot,
    build_word_context_snapshot,
)
from .mapping_agents.exceptions import MappingDataError
from .mapping_agents.parsers import (
    ExcelSummary,
    WordSummary,
    SwaggerSummary,
    parse_excel,
    parse_swagger,
    parse_word_document,
    summarize_excel_analysis,
    summarize_word_analysis,
)
from .mapping_agents.retrieval import build_excel_vector_context
from .mapping_agents.state import MappingState
from .mapping_agents.target_cache import build_target_descriptors, ensure_target_embedding_cache
from .mapping_agents.validator import validate_mapping_rows
from .mapping_agents.mapping_synthesizer import synthesize_mapping_rows
from .mapping_agents.swagger_relevance import SwaggerRelevanceEngine
from .mapping_agents.hybrid_engine import HybridMappingEngine
from .mapping_agents.progressive_mapper import ProgressiveMappingOrchestrator
from .embedding_utils import generate_embeddings

logger = logging.getLogger("agentic_orchestrator_auto.mapping.api")

mapping_bp = Blueprint("mapping_api", __name__, url_prefix="/mapping")


def _file_digest(path: Path) -> Optional[str]:
    if not path.exists():
        return None
    hasher = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                if not chunk:
                    break
                hasher.update(chunk)
    except OSError:
        return None
    return hasher.hexdigest()


def _workbook_identifier(path: Path) -> str:
    digest = _file_digest(path)
    return f"{path.name}:{digest or 'unknown'}"


def _document_identifier(path: Path) -> str:
    digest = _file_digest(path)
    return f"{path.name}:{digest or 'unknown'}"


def _estimate_excel_cost(summary: "ExcelSummary", include_vectors: bool) -> Dict[str, Any]:
    total_columns = sum(len(columns) for columns in summary.column_samples.values())
    payload: Dict[str, Any] = {
        "mode": "embeddings" if include_vectors else "summary",
        "total_columns": total_columns,
    }
    if include_vectors:
        payload["approx_embedding_batches"] = max(1, total_columns // 25)
    return payload


def _estimate_word_cost(summary: "WordSummary", include_vectors: bool) -> Dict[str, Any]:
    placeholder_count = len(summary.fields or [])
    unique_placeholders = len({field.placeholder for field in summary.fields if getattr(field, "placeholder", None)})
    payload: Dict[str, Any] = {
        "mode": "embeddings" if include_vectors else "summary",
        "placeholder_count": placeholder_count,
        "unique_placeholders": unique_placeholders,
    }
    if include_vectors and placeholder_count:
        payload["approx_embedding_batches"] = max(1, placeholder_count // 25 or 1)
    return payload


def _excel_error_payload(
    message: str,
    *,
    workbook_id: Optional[str],
    filename: Optional[str],
    detail: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "status": "error",
        "message": message,
    }
    if workbook_id:
        payload["workbook_id"] = workbook_id
    if filename:
        payload["filename"] = filename
    if detail:
        payload["detail"] = detail
    return payload


def _word_error_payload(
    message: str,
    *,
    document_id: Optional[str],
    filename: Optional[str],
    detail: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "status": "error",
        "message": message,
    }
    if document_id:
        payload["document_id"] = document_id
    if filename:
        payload["filename"] = filename
    if detail:
        payload["detail"] = detail
    return payload


def _format_word_business_view(summary: "WordSummary", analysis: Dict[str, Any]) -> Dict[str, Any]:
    """Format Word parsing results for business users - focus on document structure, not AI internals."""
    # Extract dynamic fields (placeholders that need to be filled)
    dynamic_fields = []
    static_content_sections = []
    repeating_structures = []
    
    if hasattr(summary, "fields") and summary.fields:
        # Group by classification
        for field in summary.fields:
            field_info = {
                "label": field.label,
                "placeholder": field.placeholder,
                "location": field.location,
                "type": field.classification,
            }
            
            # Add endnote context if available
            if field.endnote_texts:
                field_info["instructions"] = field.endnote_texts[0] if len(field.endnote_texts) == 1 else "; ".join(field.endnote_texts)
            
            # Classify as dynamic or static
            if field.placeholder and "{{" in field.placeholder:
                dynamic_fields.append(field_info)
            elif field.classification == "section_heading":
                static_content_sections.append({
                    "heading": field.label,
                    "location": field.location,
                })
    
    # Identify repeating structures (tables, repeated sections)
    if hasattr(summary, "stats") and summary.stats:
        table_count = summary.stats.get("table_count", 0)
        if table_count > 0:
            repeating_structures.append({
                "type": "tables",
                "count": table_count,
                "description": f"{table_count} table(s) detected in document"
            })
    
    return {
        "document_structure": {
            "total_sections": len(static_content_sections),
            "total_dynamic_fields": len(dynamic_fields),
            "total_repeating_structures": len(repeating_structures),
        },
        "dynamic_fields": dynamic_fields,
        "static_sections": static_content_sections[:10],  # Limit to first 10 for readability
        "repeating_structures": repeating_structures,
        "document_stats": {
            "total_paragraphs": len(summary.paragraphs) if hasattr(summary, "paragraphs") else 0,
            "total_headings": len(summary.headings) if hasattr(summary, "headings") else 0,
            **{k: v for k, v in (summary.stats if hasattr(summary, "stats") else {}).items() if k not in ["embeddings", "vectors", "dimensions"]}
        },
    }


def _format_excel_business_view(summary: "ExcelSummary", analysis: Dict[str, Any]) -> Dict[str, Any]:
    """Format Excel parsing results for business users - focus on data structure, not AI internals."""
    # Extract sheet and column information
    sheets_info = []
    for sheet in summary.sheets:
        columns = summary.column_samples.get(sheet, [])
        sample_data = summary.column_value_samples.get(sheet, {})
        
        # Get sample values for first few columns
        column_details = []
        for col in columns[:10]:  # Limit to first 10 columns per sheet
            col_info = {
                "column_name": col,
                "sample_values": sample_data.get(col, [])[:3],  # First 3 sample values
            }
            column_details.append(col_info)
        
        sheets_info.append({
            "sheet_name": sheet,
            "total_columns": len(columns),
            "columns": column_details,
        })
    
    # Identify structured data objects (JSON-like structures in Excel)
    data_objects = []
    if hasattr(summary, "objects") and summary.objects:
        for obj in summary.objects[:20]:  # Limit to first 20 objects
            obj_dict = obj if isinstance(obj, dict) else asdict(obj)
            data_objects.append({
                "label": obj_dict.get("label"),
                "sheet": obj_dict.get("sheet"),
                "type": obj_dict.get("kind", "column"),
                "sample": obj_dict.get("sample", "")[:100] if obj_dict.get("sample") else None,
            })
    
    return {
        "spreadsheet_structure": {
            "total_sheets": len(summary.sheets),
            "total_columns": sum(len(summary.column_samples.get(sheet, [])) for sheet in summary.sheets),
            "total_data_objects": len(summary.objects) if hasattr(summary, "objects") else 0,
        },
        "sheets": sheets_info,
        "data_objects": data_objects[:10],  # First 10 for readability
        "spreadsheet_metrics": {k: v for k, v in summary.metrics.items() if k not in ["embeddings", "vectors", "dimensions"]},
    }


def _embedding_credentials_available() -> bool:
    azure_ready = bool(os.getenv("AZURE_OPENAI_ENDPOINT") and os.getenv("AZURE_OPENAI_API_KEY"))
    public_ready = bool(os.getenv("OPENAI_API_KEY"))
    return azure_ready or public_ready


def _save_upload(file_key: str) -> tuple[Path, Path]:
    uploaded = request.files.get(file_key)
    if uploaded is None or uploaded.filename is None:
        raise ValueError("file_required")
    workspace = Path(tempfile.mkdtemp(prefix="mapping-upload-"))
    filename = secure_filename(uploaded.filename) or "mapping-upload"
    target_path = workspace / filename
    uploaded.save(target_path)
    return target_path, workspace


def _get_bool_param(name: str) -> bool:
    raw = request.args.get(name)
    if raw is None:
        raw = request.form.get(name)
    if raw is None:
        raw = request.headers.get(f"X-{name}")
    if raw is None:
        return False
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _normalize_column_samples(payload: Any) -> Dict[str, List[str]]:
    if not isinstance(payload, dict):
        return {}
    normalized: Dict[str, List[str]] = {}
    for sheet, columns in payload.items():
        if isinstance(columns, list):
            normalized[str(sheet)] = [str(column) for column in columns if column is not None]
    return normalized


def _normalize_column_value_samples(payload: Any) -> Dict[str, Dict[str, List[str]]]:
    if not isinstance(payload, dict):
        return {}
    normalized: Dict[str, Dict[str, List[str]]] = {}
    for sheet, columns in payload.items():
        if not isinstance(columns, dict):
            continue
        sheet_map: Dict[str, List[str]] = {}
        for column, values in columns.items():
            if isinstance(values, list):
                sheet_map[str(column)] = [str(value) for value in values if value is not None]
        if sheet_map:
            normalized[str(sheet)] = sheet_map
    return normalized


def _normalize_excel_objects(payload: Any) -> List[Dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for entry in payload:
        if isinstance(entry, dict):
            normalized.append(dict(entry))
    return normalized


def _seed_target_embeddings_from_client(state: MappingState, target_embeddings: Any) -> None:
    if not isinstance(target_embeddings, dict):
        return
    cache = state.metadata.setdefault("retrieval_cache", {})
    existing = cache.get("target_heading_embeddings") or {}
    expected_dim = int(cache.get("target_embedding_dim")) if cache.get("target_embedding_dim") else None
    accepted: Dict[str, List[float]] = {}
    min_dim = int(os.getenv("SNOWCHAT_MAPPING_MIN_TARGET_EMBED_DIM", "128"))
    skipped: List[str] = []
    for heading, vector in target_embeddings.items():
        if not isinstance(vector, list):
            continue
        try:
            casted = [float(value) for value in vector]
        except (TypeError, ValueError):
            skipped.append(str(heading))
            continue
        vector_dim = len(casted)
        if vector_dim < min_dim:
            skipped.append(str(heading))
            continue
        if expected_dim is not None and vector_dim != expected_dim:
            skipped.append(str(heading))
            continue
        accepted[str(heading)] = casted
        expected_dim = expected_dim or vector_dim
    if skipped:
        logger.warning(
            "[mapping.api] Ignored client-provided target embeddings due to dimension mismatch",
            extra={"headings": skipped[:5], "skipped": len(skipped)},
        )
    if accepted:
        merged = dict(existing)
        merged.update(accepted)
        cache["target_heading_embeddings"] = merged
        cache["target_embedding_dim"] = expected_dim


def _apply_user_context(state: MappingState, payload: Dict[str, Any]) -> None:
    state.metadata.setdefault("context_profile", {})
    context_profile = payload.get("contextProfile")
    if isinstance(context_profile, dict):
        state.metadata["context_profile"].update(context_profile)
    mapping_context = payload.get("mappingContext")
    if isinstance(mapping_context, dict):
        user_context = state.metadata["context_profile"].setdefault("user_context", {})
        if isinstance(user_context, dict):
            user_context.update(mapping_context)
    extra_notes = payload.get("notes") or payload.get("instructions")
    if extra_notes:
        state.metadata.setdefault("manual_notes", extra_notes)
    wiki_overrides = payload.get("wikiChunks")
    if isinstance(wiki_overrides, dict):
        state.metadata["preloaded_wiki_chunks"] = {str(key): value for key, value in wiki_overrides.items() if isinstance(value, list)}


def _build_state_from_payload(payload: Dict[str, Any]) -> MappingState:
    targets = payload.get("targets")
    if not isinstance(targets, list) or not targets:
        raise ValueError("targets_required")
    source_columns = _normalize_column_samples(payload.get("sourceColumns") or payload.get("columnSamples"))
    if not source_columns:
        raise ValueError("source_columns_required")
    column_value_samples = _normalize_column_value_samples(payload.get("columnValueSamples"))
    excel_objects = _normalize_excel_objects(payload.get("excelObjects"))
    state = MappingState(
        assignment_name=str(payload.get("assignmentName", "manual-synthesis")),
        assignment_page_id=str(payload.get("assignmentId", "manual")),
    )
    state.target_fields = [dict(entry) for entry in targets if isinstance(entry, dict)]
    if not state.target_fields:
        raise ValueError("targets_required")
    state.source_column_samples = source_columns
    state.column_value_samples = column_value_samples
    state.excel_objects = excel_objects
    history = payload.get("history") or payload.get("historySuggestions")
    if isinstance(history, list):
        state.history_suggestions = [dict(entry) for entry in history if isinstance(entry, dict)]
    _apply_user_context(state, payload)
    _seed_target_embeddings_from_client(state, payload.get("targetEmbeddings"))
    return state


@mapping_bp.route("/parse/word", methods=["POST"])
def parse_word_template():
    include_vectors = _get_bool_param("includeVectors")
    workspace: Optional[Path] = None
    path: Optional[Path] = None
    document_id: Optional[str] = None
    filename: Optional[str] = None
    try:
        path, workspace = _save_upload("file")
        filename = path.name
        document_id = _document_identifier(path)
    except ValueError:
        return jsonify(_word_error_payload("file_required", document_id=None, filename=None)), 400
    warnings: List[str] = []
    try:
        summary = parse_word_document(str(path))
        # Log all dynamic fields (placeholders) extracted from the Word template
        if hasattr(summary, "fields"):
            dynamic_fields = [f.placeholder for f in summary.fields if getattr(f, "placeholder", None)]
            logger.info("[mapping.api] Dynamic fields extracted from Word template | count=%s | placeholders=%s", len(dynamic_fields), dynamic_fields)
        analysis = summarize_word_analysis(summary)
        targets = build_target_descriptors(summary)
        context, context_warnings = build_word_context_snapshot(summary, analysis)
        warnings.extend(context_warnings or [])
        analysis_mode = "ai-embeddings" if include_vectors else "heuristic"
        cost_estimate = _estimate_word_cost(summary, analysis_mode == "ai-embeddings")
        
        # Create business-focused view for domain experts
        business_view = _format_word_business_view(summary, analysis)
        
        payload = {
            "status": "ok",
            "document_id": document_id,
            "filename": filename,
            "analysis_mode": analysis_mode,
            "business_view": business_view,
            "summary": asdict(summary),  # Full summary for reference
            "targets": targets,
            "context": context,
            "warnings": warnings,
            "analysis": analysis,
            "cost_estimate": cost_estimate,
        }
        if include_vectors:
            if _embedding_credentials_available():
                state = MappingState(
                    assignment_name="upload",
                    assignment_page_id="upload",
                    local_dir=workspace,
                    word_path=path,
                    word_attachment_id=path.name,
                    word_attachment_title=path.name,
                )
                state.target_fields = targets
                ensure_target_embedding_cache(state, summary, descriptors=targets)
                retrieval_cache = state.metadata.get("retrieval_cache", {})
                embeddings = retrieval_cache.get("target_heading_embeddings", {})
                sample_items = list(embeddings.items())[:5]
                vector_dim = len(sample_items[0][1]) if sample_items else 0
                # Simplified vector context - just counts, no verbose arrays for domain experts
                payload["ai_enrichment"] = {
                    "enabled": True,
                    "fields_analyzed": len(embeddings),
                    "vector_dimension": vector_dim,
                    "status": "AI semantic matching enabled",
                }
                logger.info(
                    "[mapping.api] Word vector enrichment complete | document_id=%s embeddings=%s",
                    document_id,
                    len(embeddings),
                )
            else:
                warnings.append(
                    "Embedding credentials are not configured. Set AZURE_OPENAI_ENDPOINT/AZURE_OPENAI_API_KEY or OPENAI_API_KEY to enable vector enrichment."
                )
                analysis_mode = "heuristic"
                payload["analysis_mode"] = analysis_mode
                payload["cost_estimate"] = _estimate_word_cost(summary, False)
                logger.warning(
                    "[mapping.api] Word vector enrichment skipped due to missing embedding credentials | document_id=%s",
                    document_id,
                )
        return jsonify(payload), 200
    except MappingDataError as exc:
        logger.warning("[mapping.api] Word parse failed: %s", exc)
        return (
            jsonify(
                _word_error_payload(
                    "parse_failed",
                    document_id=document_id,
                    filename=filename,
                    detail=str(exc),
                )
            ),
            400,
        )
    except Exception as exc:  # noqa: BLE001 - capture stack for diagnostics
        error_id = f"word-{uuid.uuid4().hex[:8]}"
        logger.exception(
            "[mapping.api] Word parse error | document_id=%s error_id=%s",
            document_id,
            error_id,
        )
        payload = _word_error_payload(
            "internal_error",
            document_id=document_id,
            filename=filename,
            detail=str(exc),
        )
        payload["error_id"] = error_id
        return jsonify(payload), 500
    finally:
        if workspace is not None:
            shutil.rmtree(workspace, ignore_errors=True)


@mapping_bp.route("/parse/word/preview", methods=["POST"])
def parse_word_preview():
    """
    Parse Word template and return detected fields WITHOUT generating embeddings.
    Allows user to review and enrich context before finalizing.
    """
    workspace: Optional[Path] = None
    path: Optional[Path] = None
    document_id: Optional[str] = None
    filename: Optional[str] = None
    
    try:
        path, workspace = _save_upload("file")
        filename = path.name
        document_id = _document_identifier(path)
    except ValueError:
        return jsonify({"status": "error", "error": "file_required"}), 400
    
    try:
        summary = parse_word_document(str(path))
        
        # Extract field previews with quality assessment
        field_previews = []
        for field in summary.fields:
            # Calculate context quality
            quality = _calculate_field_context_quality(field)
            
            # Infer data type from label text
            data_type = _infer_field_data_type(field)
            
            field_previews.append({
                "placeholder": field.placeholder,
                "label": field.label,
                "location": field.location,
                "classification": field.classification,
                "has_endnotes": bool(field.endnote_texts),
                "endnote_preview": field.endnote_texts[0][:200] if field.endnote_texts else None,
                
                # Context quality
                "context_quality": quality,
                "needs_enrichment": quality == "poor",
                
                # Auto-suggestions
                "suggested_data_type": data_type,
                
                # User-editable (initially empty)
                "user_description": "",
                "data_type": data_type,
                "semantic_tags": [],
            })
        
        # Calculate overall quality score
        quality_counts = {"excellent": 0, "good": 0, "fair": 0, "poor": 0}
        for f in field_previews:
            quality_counts[f["context_quality"]] += 1
        
        total = len(field_previews)
        quality_score = 0.0
        if total > 0:
            quality_score = (
                quality_counts["excellent"] * 1.0 +
                quality_counts["good"] * 0.7 +
                quality_counts["fair"] * 0.4 +
                quality_counts["poor"] * 0.0
            ) / total
        
        # Generate recommendations
        recommendations = []
        if quality_counts["poor"] > 0:
            recommendations.append(f"{quality_counts['poor']} fields have minimal context. Adding descriptions will significantly improve matching accuracy.")
        if quality_counts["fair"] > 3:
            recommendations.append(f"{quality_counts['fair']} fields have basic context. Consider adding business purpose descriptions.")
        if quality_score >= 0.8:
            recommendations.append("Document has excellent formatting! You can skip enrichment if desired.")
        
        logger.info(
            "[mapping.api] Word preview generated | document_id=%s fields=%s quality_score=%.2f poor=%s",
            document_id,
            len(field_previews),
            quality_score,
            quality_counts["poor"],
        )
        
        return jsonify({
            "status": "ok",
            "document_id": document_id,
            "filename": filename,
            "fields": field_previews,
            "quality_score": quality_score,
            "quality_breakdown": quality_counts,
            "recommendations": recommendations,
            "summary": asdict(summary),
        }), 200
        
    except Exception as exc:
        logger.error("[mapping.api] Word preview error", exc_info=True)
        return jsonify({
            "status": "error",
            "error": "preview_failed",
            "detail": str(exc)
        }), 500
    finally:
        if workspace is not None:
            shutil.rmtree(workspace, ignore_errors=True)


@mapping_bp.route("/parse/word/finalize", methods=["POST"])
def parse_word_finalize():
    """
    Generate embeddings with user-enriched context.
    Accepts enriched field data from user review step.
    """
    include_vectors = _get_bool_param("includeVectors")
    workspace: Optional[Path] = None
    path: Optional[Path] = None
    document_id: Optional[str] = None
    filename: Optional[str] = None
    warnings: List[str] = []
    
    try:
        path, workspace = _save_upload("file")
        filename = path.name
        document_id = _document_identifier(path)
    except ValueError:
        return jsonify({"status": "error", "error": "file_required"}), 400
    
    try:
        # Get enriched fields from request
        enriched_fields = request.json.get("enrichedFields", []) if request.is_json else []
        enrichment_map = {e["placeholder"]: e for e in enriched_fields}
        
        # Parse document
        summary = parse_word_document(str(path))
        
        # Apply user enrichments to fields
        enrichment_count = 0
        for field in summary.fields:
            enrichment = enrichment_map.get(field.placeholder, {})
            
            # Append user description to endnote texts
            user_desc = enrichment.get("user_description", "").strip()
            if user_desc:
                field.endnote_texts.append(user_desc)
                enrichment_count += 1
            
            # Store metadata for downstream use
            if not hasattr(field, 'user_metadata'):
                field.user_metadata = {}
            field.user_metadata.update({
                "data_type": enrichment.get("data_type"),
                "semantic_tags": enrichment.get("semantic_tags", []),
            })
        
        logger.info(
            "[mapping.api] Applied user enrichments | document_id=%s enriched=%s/%s",
            document_id,
            enrichment_count,
            len(summary.fields),
        )
        
        # Build target descriptors with enriched context
        analysis = summarize_word_analysis(summary)
        targets = build_target_descriptors(summary)
        context, context_warnings = build_word_context_snapshot(summary, analysis)
        warnings.extend(context_warnings or [])
        
        analysis_mode = "ai-embeddings" if include_vectors else "heuristic"
        cost_estimate = _estimate_word_cost(summary, analysis_mode == "ai-embeddings")
        
        business_view = _format_word_business_view(summary, analysis)
        
        payload = {
            "status": "ok",
            "document_id": document_id,
            "filename": filename,
            "analysis_mode": analysis_mode,
            "enrichment_applied": enrichment_count,
            "business_view": business_view,
            "summary": asdict(summary),
            "targets": targets,
            "context": context,
            "warnings": warnings,
            "analysis": analysis,
            "cost_estimate": cost_estimate,
        }
        
        # Generate embeddings if requested
        if include_vectors:
            if _embedding_credentials_available():
                state = MappingState(
                    assignment_name="upload",
                    assignment_page_id="upload",
                    local_dir=workspace,
                    word_path=path,
                    word_attachment_id=path.name,
                    word_attachment_title=path.name,
                )
                state.target_fields = targets
                ensure_target_embedding_cache(state, summary, descriptors=targets)
                retrieval_cache = state.metadata.get("retrieval_cache", {})
                embeddings = retrieval_cache.get("target_heading_embeddings", {})
                
                payload["ai_enrichment"] = {
                    "enabled": True,
                    "fields_analyzed": len(embeddings),
                    "status": "AI semantic matching enabled with user enrichments",
                }
                logger.info(
                    "[mapping.api] Word finalize complete | document_id=%s embeddings=%s enriched=%s",
                    document_id,
                    len(embeddings),
                    enrichment_count,
                )
            else:
                warnings.append("Embedding credentials not configured.")
                payload["analysis_mode"] = "heuristic"
                payload["cost_estimate"] = _estimate_word_cost(summary, False)
        
        return jsonify(payload), 200
        
    except Exception as exc:
        logger.error("[mapping.api] Word finalize error", exc_info=True)
        return jsonify({
            "status": "error",
            "error": "finalize_failed",
            "detail": str(exc)
        }), 500
    finally:
        if workspace is not None:
            shutil.rmtree(workspace, ignore_errors=True)


def _calculate_field_context_quality(field) -> str:
    """Assess field context richness"""
    score = 0
    
    # Label is just placeholder (bad)
    label_stripped = field.label.strip("<>[] ").lower()
    placeholder_stripped = field.placeholder.strip("<>[] ").lower()
    if label_stripped == placeholder_stripped:
        score = 0
    # Label has substantial surrounding text (good)
    elif len(field.label) > 30:
        score += 3
    elif len(field.label) > 10:
        score += 1
    
    # Has endnotes (excellent)
    if field.endnote_texts:
        score += 4
    
    # In structured location (good)
    if "table" in field.location:
        score += 1
    
    if score >= 6:
        return "excellent"
    elif score >= 3:
        return "good"
    elif score >= 1:
        return "fair"
    else:
        return "poor"


def _infer_field_data_type(field) -> str:
    """Auto-suggest data type from label text"""
    label_lower = field.label.lower()
    placeholder_lower = field.placeholder.lower()
    combined = f"{label_lower} {placeholder_lower}"
    
    # Check common patterns
    if any(word in combined for word in ["date", "dob", "birth", "effective", "expiration", "expire"]):
        return "date"
    if any(word in combined for word in ["amount", "premium", "price", "cost", "$", "payment", "fee"]):
        return "currency"
    if any(word in combined for word in ["number", " id", "code", "policy", "ssn", "identifier", "account"]):
        return "identifier"
    if any(word in combined for word in ["address", "street", "city", "zip", "state"]):
        return "address"
    if any(word in combined for word in ["phone", "telephone", "mobile", "cell"]):
        return "phone"
    if any(word in combined for word in ["email", "e-mail", "mail"]):
        return "email"
    if any(word in combined for word in ["yes/no", "true/false", "checkbox", "checked"]):
        return "boolean"
    if any(word in combined for word in ["name", "first name", "last name", "full name"]):
        return "text"
    
    return "text"


@mapping_bp.route("/parse/excel", methods=["POST"])
def parse_excel_sheet():
    include_vectors = _get_bool_param("includeVectors")
    workspace: Optional[Path] = None
    path: Optional[Path] = None
    workbook_id: Optional[str] = None
    filename: Optional[str] = None
    try:
        path, workspace = _save_upload("file")
        filename = path.name
    except ValueError:
        return jsonify(_excel_error_payload("file_required", workbook_id=None, filename=None)), 200
    try:
        workbook_id = _workbook_identifier(path)
        summary = parse_excel(str(path))
        context, warnings = build_excel_context_snapshot(summary)
        analysis = summarize_excel_analysis(summary)
        
        # Create business-focused view for domain experts
        business_view = _format_excel_business_view(summary, analysis)
        
        payload: Dict[str, Any] = {
            "status": "ok",
            "workbook_id": workbook_id,
            "filename": filename,
            "analysis_mode": "ai-embeddings" if include_vectors else "heuristic",
            "business_view": business_view,
            "summary": asdict(summary),  # Full summary for synthesis - includes column_samples, column_value_samples, objects
            "context": context,
            "warnings": warnings,
            "analysis": analysis,
            "cost_estimate": _estimate_excel_cost(summary, include_vectors),
        }
        if include_vectors:
            state = MappingState(
                assignment_name="upload",
                assignment_page_id="upload",
                local_dir=workspace,
                spreadsheet_path=path,
                spreadsheet_attachment_id=path.name,
                spreadsheet_attachment_title=path.name,
            )
            state.source_column_samples = summary.column_samples
            state.column_value_samples = summary.column_value_samples
            state.excel_objects = [asdict(obj) if not isinstance(obj, dict) else obj for obj in summary.objects]
            vector_ctx = build_excel_vector_context(state)
            
            # Simplify vector context for domain experts - just counts and status
            total_embeddings = vector_ctx.get("source_column_embedding_count", 0)
            total_objects = vector_ctx.get("object_embedding_count", 0)
            payload["ai_enrichment"] = {
                "enabled": True,
                "columns_analyzed": total_embeddings,
                "objects_analyzed": total_objects,
                "status": "AI semantic matching enabled",
            }
        return jsonify(payload), 200
    except MappingDataError as exc:
        logger.warning("[mapping.api] Excel parse failed: %s", exc)
        return (
            jsonify(
                _excel_error_payload(
                    "parse_failed",
                    workbook_id=workbook_id,
                    filename=filename,
                    detail=str(exc),
                )
            ),
            200,
        )
    except Exception as exc:
        logger.error("[mapping.api] Excel parse error", exc_info=True)
        return (
            jsonify(
                _excel_error_payload(
                    "internal_error",
                    workbook_id=workbook_id,
                    filename=filename,
                    detail=str(exc),
                )
            ),
            200,
        )
    finally:
        if workspace is not None:
            shutil.rmtree(workspace, ignore_errors=True)


@mapping_bp.route("/synthesize", methods=["POST"])
def synthesize_from_context():
    payload = request.get_json(silent=True) or {}
    if not payload:
        return jsonify({"error": "invalid_payload", "detail": "JSON body required"}), 400
    try:
        state = _build_state_from_payload(payload)
    except ValueError as exc:
        return jsonify({"error": "invalid_payload", "detail": str(exc)}), 400
    try:
        options = payload.get("options") or {}
        confidence_raw = options.get("confidenceThreshold")
        try:
            confidence_threshold = float(confidence_raw) if confidence_raw is not None else 0.35
        except (TypeError, ValueError):
            confidence_threshold = 0.35
        synthesize_mapping_rows(state, confidence_threshold=confidence_threshold)
        validate_mapping_rows(state)
        response = {
            "mappings": state.mapping_rows,
            "strategy": state.metadata.get("synthesis", {}).get("strategy"),
            "synthesis": state.metadata.get("synthesis"),
            "warnings": state.warnings,
            "validation": state.validation_issues,
            "context_profile": state.metadata.get("context_profile"),
            "notes": state.metadata.get("manual_notes"),
        }
        if state.errors:
            response["errors"] = state.errors
        return jsonify(response)
    except Exception as exc:
        return jsonify({"error": "synthesis_failed", "detail": str(exc)}), 500


# =============================================================================
# SWAGGER/OPENAPI ENDPOINTS (Cost-Optimized Mapping)
# =============================================================================

def _build_objects_array_from_swagger(swagger_summary):
    """Convert SwaggerSummary to objects array for frontend Swagger detection.
    
    Creates objects with /paths/ patterns that frontend expects for:
    - Swagger structure detection
    - Field-level RAG targeting
    - LLM mapping context
    
    Args:
        swagger_summary: SwaggerSummary from parse_swagger()
        
    Returns:
        List of object dictionaries with path, name, dataType, description
    """
    objects = []
    
    for op in swagger_summary.operations:
        # Input attributes (request body/parameters)
        for attr in op.input_attributes:
            objects.append({
                "path": f"/paths{op.endpoint}/{op.method.lower()}/requestBody/{attr.path or attr.name}",
                "name": attr.name or attr.column,
                "column": attr.column,
                "dataType": attr.metadata.get('type', 'string') if attr.metadata else 'string',
                "description": attr.description or "",
                "isRequired": attr.metadata.get('required', False) if attr.metadata else False,
                "isArray": attr.metadata.get('is_array', False) if attr.metadata else False,
                "sample": attr.sample or "",
                "operationId": op.operation_id,
                "method": op.method,
                "endpoint": op.endpoint,
                "source": "requestBody"
            })
        
        # Output attributes (response schemas)
        for attr in op.output_attributes:
            # Determine status code from path if available
            status_code = "200"
            if attr.path and "/responses/" in attr.path:
                import re
                match = re.search(r'/responses/(\d+)/', attr.path)
                if match:
                    status_code = match.group(1)
            
            objects.append({
                "path": f"/paths{op.endpoint}/{op.method.lower()}/responses/{status_code}/{attr.path or attr.name}",
                "name": attr.name or attr.column,
                "column": attr.column,
                "dataType": attr.metadata.get('type', 'string') if attr.metadata else 'string',
                "description": attr.description or "",
                "isRequired": attr.metadata.get('required', False) if attr.metadata else False,
                "isArray": attr.metadata.get('is_array', False) if attr.metadata else False,
                "sample": attr.sample or "",
                "operationId": op.operation_id,
                "method": op.method,
                "endpoint": op.endpoint,
                "source": "response",
                "statusCode": status_code
            })
    
    logger.info("[mapping.api] Built objects array | total_objects=%d", len(objects))
    return objects


@mapping_bp.route("/parse/swagger", methods=["POST"])
def parse_swagger_spec():
    """Parse Swagger/OpenAPI specification file.
    
    Query params:
        includeVectors (bool): Whether to generate embeddings for operations
    
    Returns:
        JSON with API summary, operations list, and context
    """
    include_vectors = request.args.get("includeVectors", "false").lower() == "true"
    
    if "file" not in request.files:
        return jsonify({"status": "error", "message": "No file uploaded"}), 400
    
    file = request.files["file"]
    if not file.filename:
        return jsonify({"status": "error", "message": "Empty filename"}), 400
    
    # Validate file extension
    allowed_extensions = {'.json', '.yaml', '.yml'}
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_extensions:
        return jsonify({
            "status": "error",
            "message": f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        }), 400
    
    # Save to temporary location
    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = Path(tmpdir) / secure_filename(file.filename)
        file.save(str(file_path))
        
        try:
            logger.info("[mapping.api] Starting Swagger parse | file=%s size=%d bytes", 
                       file.filename, file_path.stat().st_size)
            
            # Parse Swagger with prance
            swagger_summary = parse_swagger(str(file_path))
            
            logger.info("[mapping.api] Swagger parse complete | operations=%d total_attrs=%d",
                       swagger_summary.total_operations,
                       swagger_summary.metrics.get('total_input_attributes', 0) + 
                       swagger_summary.metrics.get('total_output_attributes', 0))
            
            # Transform to Excel-like structure for frontend compatibility
            # Each operation becomes a "sheet" with its attributes as "columns"
            sheet_summary = []
            all_columns = []
            
            for op in swagger_summary.operations:
                # Create sheet entry for this operation
                op_columns = []
                
                # Add input attributes
                for attr in op.input_attributes:
                    col_name = f"{op.operation_id}::input.{attr.name}" if attr.name else f"{op.operation_id}::input.{attr.column}"
                    op_columns.append(col_name)
                    all_columns.append({
                        "name": col_name,
                        "description": attr.description or "",
                        "path": attr.path or "",
                        "sample": attr.sample or "",
                        "source": "input"
                    })
                
                # Add output attributes
                for attr in op.output_attributes:
                    col_name = f"{op.operation_id}::output.{attr.name}" if attr.name else f"{op.operation_id}::output.{attr.column}"
                    op_columns.append(col_name)
                    all_columns.append({
                        "name": col_name,
                        "description": attr.description or "",
                        "path": attr.path or "",
                        "sample": attr.sample or "",
                        "source": "output"
                    })
                
                # Detect date/amount columns based on naming patterns
                date_cols = [col for col in op_columns if any(kw in col.lower() for kw in ['date', 'time', 'timestamp', 'created', 'updated'])]
                amount_cols = [col for col in op_columns if any(kw in col.lower() for kw in ['amount', 'premium', 'price', 'cost', 'sum', 'total', 'value'])]
                
                sheet_summary.append({
                    "sheetName": op.operation_id,
                    "identifier_candidates": op_columns[:10],  # First 10 as samples
                    "date_columns": date_cols,
                    "amount_columns": amount_cols
                })
            
            logger.info("[mapping.api] Built sheet structure | sheets=%d total_columns=%d",
                       len(sheet_summary), len(all_columns))
            
            # Build objects array for frontend Swagger detection and field-level context
            objects_array = _build_objects_array_from_swagger(swagger_summary)
            
            # Build response matching Excel parse format + objects array for detection
            response = {
                "status": "success",
                "summary": {
                    "fileName": file.filename,
                    "sheetsAnalyzed": len(swagger_summary.operations),
                    "api_title": swagger_summary.api_title,
                    "api_version": swagger_summary.api_version,
                    "objects": objects_array  # Added for frontend Swagger detection
                },
                "context": {
                    "sheet_summary": sheet_summary,
                    "total_source_columns": len(all_columns),
                    "excel_objects": {
                        "count": len(swagger_summary.operations),
                        "keyword_frequency": {}  # Could add keyword extraction here
                    }
                },
                "warnings": [],
                "swagger_metadata": {
                    "api_title": swagger_summary.api_title,
                    "api_version": swagger_summary.api_version,
                    "api_description": swagger_summary.api_description,
                    "total_operations": swagger_summary.total_operations
                }
            }
            
            logger.info("[mapping.api] Response prepared | status=success sheets=%d columns=%d",
                       len(sheet_summary), len(all_columns))
            
            # Optionally generate embeddings for operations
            if include_vectors:
                logger.info(
                    "[mapping.api] Swagger embeddings requested | operations=%s",
                    len(swagger_summary.operations)
                )
            
            return jsonify(response)
            
        except MappingDataError as exc:
            logger.error("[mapping.api] Swagger parsing failed | error=%s", exc)
            return jsonify({"status": "error", "message": str(exc)}), 400
        except Exception as exc:
            logger.exception("[mapping.api] Unexpected error parsing Swagger")
            return jsonify({"status": "error", "message": f"Unexpected error: {exc}"}), 500


@mapping_bp.route("/rank-apis", methods=["POST"])
def rank_apis_by_relevance():
    """Rank Swagger APIs by relevance to Word template.
    
    Request body:
        {
            "swagger_summary": {...},  // Full swagger summary from parse endpoint
            "word_summary": {...},      // Full word summary from parse endpoint
            "top_k": 15,                // Max APIs to return
            "confidence_threshold": 0.3 // Min relevance score
        }
    
    Returns:
        JSON with ranked APIs and filtering statistics
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"status": "error", "message": "No JSON data provided"}), 400
        
        # Extract parameters
        swagger_data = data.get('swagger_summary')
        word_data = data.get('word_summary')
        top_k = data.get('top_k', 15)
        confidence_threshold = data.get('confidence_threshold', 0.3)
        
        if not swagger_data or not word_data:
            return jsonify({
                "status": "error",
                "message": "Both swagger_summary and word_summary required"
            }), 400
        
        # Reconstruct summaries (in production, would retrieve from cache/session)
        # For now, assume summaries are passed as dicts
        from .mapping_agents.parsers import SwaggerSummary, SwaggerOperationDescriptor, WordSummary, WordField
        
        # Build SwaggerSummary from dict
        operations = []
        for op_data in swagger_data.get('operations', []):
            operations.append(SwaggerOperationDescriptor(
                api_name=swagger_data['api_title'],
                endpoint=op_data['endpoint'],
                method=op_data['method'],
                operation_id=op_data['operation_id'],
                summary=op_data.get('summary'),
                description=op_data.get('description'),
                input_attributes=[],  # Simplified for ranking
                output_attributes=[],
                tags=op_data.get('tags', [])
            ))
        
        swagger_summary = SwaggerSummary(
            api_title=swagger_data['api_title'],
            api_version=swagger_data['api_version'],
            api_description=swagger_data.get('api_description'),
            operations=operations,
            total_endpoints=swagger_data['total_endpoints'],
            total_operations=swagger_data['total_operations']
        )
        
        # Build WordSummary from dict
        fields = []
        for field_data in word_data.get('fields', []):
            fields.append(WordField(
                label=field_data.get('label', ''),
                placeholder=field_data.get('placeholder', ''),
                classification=field_data.get('classification', ''),
                location=field_data.get('location', '')
            ))
        
        word_summary = WordSummary(
            headings=word_data.get('headings', []),
            paragraphs=word_data.get('paragraphs', []),
            fields=fields
        )
        
        # Rank APIs
        engine = SwaggerRelevanceEngine(
            swagger_summary,
            word_summary,
            embedding_generator=generate_embeddings
        )
        
        ranked_apis = engine.rank_apis_by_relevance(top_k, confidence_threshold)
        
        # Format response
        response = {
            "status": "success",
            "ranked_apis": [
                {
                    "operation_id": api['operation'].operation_id,
                    "endpoint": api['operation'].endpoint,
                    "method": api['operation'].method,
                    "summary": api['operation'].summary,
                    "relevance_score": api['relevance_score'],
                    "best_match_field": api['best_match_field'],
                    "potential_mappings": api['potential_mappings']
                }
                for api in ranked_apis
            ],
            "total_apis": len(swagger_summary.operations),
            "filtered_count": len(ranked_apis),
            "threshold_used": confidence_threshold,
            "top_score": ranked_apis[0]['relevance_score'] if ranked_apis else 0.0
        }
        
        return jsonify(response)
        
    except Exception as exc:
        logger.exception("[mapping.api] API ranking failed")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/map-progressive", methods=["POST"])
def map_progressive_batch():
    """Progressive mapping: map next batch of APIs.
    
    Request body:
        {
            "session_id": "unique-session-id",
            "ranked_apis": [...],  // From rank-apis endpoint
            "batch_size": 3
        }
    
    Returns:
        JSON with batch mappings, progress, and next APIs preview
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"status": "error", "message": "No JSON data provided"}), 400
        
        session_id = data.get('session_id')
        ranked_apis = data.get('ranked_apis', [])
        batch_size = data.get('batch_size', 3)
        
        if not session_id:
            return jsonify({"status": "error", "message": "session_id required"}), 400
        
        # Create minimal state (in production, load from session/cache)
        state = MappingState()
        
        # Create orchestrator
        orchestrator = ProgressiveMappingOrchestrator(session_id, state)
        
        # Define mapping function (uses hybrid engine)
        def map_operation(operation, unmapped_targets, history):
            # Extract candidates from operation
            candidates = []
            for attr in operation.input_attributes + operation.output_attributes:
                candidates.append({
                    'name': attr.name,
                    'path': attr.path or attr.name,
                    'description': attr.description or ''
                })
            
            # Use hybrid engine
            hybrid = HybridMappingEngine(confidence_threshold=0.7)
            mappings = hybrid.map_targets_hybrid(
                unmapped_targets,
                candidates,
                embedding_generator=generate_embeddings,
                llm_synthesizer=None  # Could add LLM synthesis here
            )
            
            return mappings
        
        # Map next batch
        result = orchestrator.map_next_batch(
            ranked_apis,
            map_operation,
            batch_size
        )
        
        return jsonify(result)
        
    except Exception as exc:
        logger.exception("[mapping.api] Progressive mapping failed")
        return jsonify({"status": "error", "message": str(exc)}), 500


# ===== Knowledge Base Endpoints =====

from .mapping_knowledge_base import get_knowledge_base
from .mapping_vectorizer import get_vectorizer


@mapping_bp.route("/knowledge-base/products", methods=["GET"])
def get_kb_products():
    """Retrieve all products from knowledge base."""
    try:
        kb = get_knowledge_base()
        product_type = request.args.get("type")
        vectorized_only = request.args.get("vectorized", "false").lower() == "true"
        
        products = kb.get_all_products(
            product_type=product_type,
            vectorized_only=vectorized_only,
        )
        
        return jsonify({"status": "success", "products": products})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to get products")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/products", methods=["POST"])
def create_kb_product():
    """Create new product in knowledge base with Swagger file."""
    try:
        # Get form data
        product_name = request.form.get("productName")
        product_type = request.form.get("productType")
        version = request.form.get("version", "")
        description = request.form.get("description", "")
        
        if not product_name or not product_type:
            return jsonify({
                "status": "error",
                "message": "productName and productType are required"
            }), 400
        
        # Get uploaded Swagger file
        if "swaggerFile" not in request.files:
            return jsonify({"status": "error", "message": "swaggerFile is required"}), 400
        
        swagger_file = request.files["swaggerFile"]
        if not swagger_file.filename:
            return jsonify({"status": "error", "message": "No file selected"}), 400
        
        # Save Swagger file temporarily
        temp_dir = tempfile.mkdtemp(prefix="kb_product_")
        swagger_path = Path(temp_dir) / secure_filename(swagger_file.filename)
        swagger_file.save(swagger_path)
        
        try:
            # Parse Swagger to get field count
            swagger_summary = parse_swagger(str(swagger_path))
            total_fields = sum(
                len(getattr(op, 'request_attributes', [])) + len(getattr(op, 'response_attributes', []))
                for op in swagger_summary.operations
            )
            
            # Create product in KB
            kb = get_knowledge_base()
            product = kb.create_product(
                product_name=product_name,
                product_type=product_type,
                swagger_file=swagger_file.filename,
                metadata={
                    "version": version,
                    "description": description,
                    "author": request.form.get("author", ""),
                },
            )
            
            # Update with total fields
            kb.update_product(product["id"], {"totalFields": total_fields})
            
            # Auto-create mappings from Swagger operations
            for operation in swagger_summary.operations:
                request_attrs = getattr(operation, 'request_attributes', [])
                for attr in request_attrs:
                    # Create placeholder from attribute name
                    placeholder = f"[{attr.name.upper().replace('.', '_')}]"
                    op_path = getattr(operation, 'path', '')
                    kb.create_mapping(
                        product_id=product["id"],
                        word_placeholder=placeholder,
                        json_path=attr.path or attr.name,
                        swagger_operation=operation.operation_id or f"{operation.method}_{op_path}",
                        data_type=attr.type or "string",
                        sample_value=str(attr.sample) if attr.sample else None,
                        notes=attr.description or "",
                    )
            
            product = kb.get_product(product["id"])
            
            logger.info(
                "[mapping.api] Created KB product | id=%s | name=%s | fields=%d",
                product["id"],
                product_name,
                total_fields,
            )
            
            return jsonify({"status": "success", "product": product})
            
        finally:
            # Cleanup temp directory
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    except Exception as exc:
        logger.exception("[mapping.api] Failed to create product")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/products/<product_id>", methods=["GET"])
def get_kb_product(product_id: str):
    """Retrieve specific product."""
    try:
        kb = get_knowledge_base()
        product = kb.get_product(product_id)
        
        if not product:
            return jsonify({"status": "error", "message": "Product not found"}), 404
        
        return jsonify({"status": "success", "product": product})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to get product")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/products/<product_id>", methods=["DELETE"])
def delete_kb_product(product_id: str):
    """Delete a product and all its mappings."""
    try:
        kb = get_knowledge_base()
        success = kb.delete_product(product_id)
        
        if not success:
            return jsonify({"status": "error", "message": "Product not found"}), 404
        
        return jsonify({"status": "success", "message": "Product deleted"})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to delete product")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/products/<product_id>/mappings", methods=["GET"])
def get_product_mappings(product_id: str):
    """Retrieve all mappings for a product."""
    try:
        kb = get_knowledge_base()
        mappings = kb.get_product_mappings(product_id)
        
        return jsonify({"status": "success", "mappings": mappings})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to get mappings")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/mappings", methods=["POST"])
def create_kb_mapping():
    """Create new field mapping."""
    try:
        data = request.get_json()
        
        required = ["productId", "wordPlaceholder", "jsonPath", "swaggerOperation"]
        if not all(field in data for field in required):
            return jsonify({
                "status": "error",
                "message": f"Missing required fields: {required}"
            }), 400
        
        kb = get_knowledge_base()
        mapping = kb.create_mapping(
            product_id=data["productId"],
            word_placeholder=data["wordPlaceholder"],
            json_path=data["jsonPath"],
            swagger_operation=data["swaggerOperation"],
            data_type=data.get("dataType", "string"),
            sample_value=data.get("sampleValue"),
            notes=data.get("notes"),
        )
        
        return jsonify({"status": "success", "mapping": mapping})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to create mapping")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/mappings/<mapping_id>", methods=["PUT"])
def update_kb_mapping(mapping_id: str):
    """Update existing field mapping."""
    try:
        data = request.get_json()
        
        kb = get_knowledge_base()
        
        # Remove fields that shouldn't be updated
        updates = {k: v for k, v in data.items() if k not in ["id", "productId", "createdAt"]}
        
        success = kb.update_mapping(mapping_id, updates)
        
        if not success:
            return jsonify({"status": "error", "message": "Mapping not found"}), 404
        
        mapping = kb.get_mapping(mapping_id)
        return jsonify({"status": "success", "mapping": mapping})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to update mapping")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/mappings/<mapping_id>", methods=["DELETE"])
def delete_kb_mapping(mapping_id: str):
    """Delete a field mapping."""
    try:
        kb = get_knowledge_base()
        success = kb.delete_mapping(mapping_id)
        
        if not success:
            return jsonify({"status": "error", "message": "Mapping not found"}), 404
        
        return jsonify({"status": "success", "message": "Mapping deleted"})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to delete mapping")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/mappings/search", methods=["GET"])
def search_kb_mappings():
    """Search for similar mappings across all products."""
    try:
        placeholder = request.args.get("placeholder")
        if not placeholder:
            return jsonify({"status": "error", "message": "placeholder parameter required"}), 400
        
        product_type = request.args.get("productType")
        limit = int(request.args.get("limit", 10))
        
        kb = get_knowledge_base()
        mappings = kb.search_mappings_by_placeholder(
            placeholder=placeholder,
            product_type=product_type,
            limit=limit,
        )
        
        return jsonify({"status": "success", "mappings": mappings})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to search mappings")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/products/<product_id>/vectorize", methods=["POST"])
def vectorize_kb_product(product_id: str):
    """Vectorize all mappings for a product."""
    try:
        vectorizer = get_vectorizer()
        result = vectorizer.vectorize_product(product_id)
        
        return jsonify({"status": "success", **result})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to vectorize product")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/vectorization/status", methods=["GET"])
def get_vectorization_status():
    """Get vectorization status and statistics."""
    try:
        vectorizer = get_vectorizer()
        status = vectorizer.get_status()
        
        # Add last indexed timestamp (mock for now)
        kb = get_knowledge_base()
        products = kb.get_all_products(vectorized_only=True)
        if products:
            # Get most recent updatedAt from vectorized products
            last_indexed = max(p.get("updatedAt", "") for p in products)
            status["lastIndexed"] = last_indexed
        else:
            status["lastIndexed"] = ""
        
        return jsonify(status)
    except Exception as exc:
        logger.exception("[mapping.api] Failed to get vectorization status")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/suggestions", methods=["POST"])
def get_mapping_suggestions():
    """Get AI-powered mapping suggestions for placeholders."""
    try:
        data = request.get_json()
        
        placeholders = data.get("placeholders", [])
        if not placeholders:
            return jsonify({"status": "error", "message": "placeholders array required"}), 400
        
        product_type = data.get("productType")
        confidence_threshold = float(data.get("confidenceThreshold", 0.7))
        
        vectorizer = get_vectorizer()
        suggestions = vectorizer.suggest_mappings_for_placeholders(
            placeholders=placeholders,
            product_type=product_type,
            confidence_threshold=confidence_threshold,
        )
        
        return jsonify({"status": "success", "suggestions": suggestions})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to get suggestions")
        return jsonify({"status": "error", "message": str(exc)}), 500


@mapping_bp.route("/knowledge-base/vectorization/rebuild", methods=["POST"])
def rebuild_vectorization_index():
    """Rebuild the entire FAISS index."""
    try:
        vectorizer = get_vectorizer()
        result = vectorizer.rebuild_index()
        
        return jsonify({"status": "success", **result})
    except Exception as exc:
        logger.exception("[mapping.api] Failed to rebuild index")
        return jsonify({"status": "error", "message": str(exc)}), 500

