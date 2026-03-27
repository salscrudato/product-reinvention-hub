"""Generate draft mapping rows that align source columns to target fields."""
from __future__ import annotations

import difflib
import logging
import os
from typing import Any, Dict, Iterable, List, Tuple

from .llm_mapping import generate_with_llm
from .logging_utils import log_method_end, log_method_progress, log_method_start
from .progress import step_tracker
from .state import MappingState

logger = logging.getLogger("agentic_orchestrator_auto.mapping.synthesizer")

USE_LLM = os.getenv("SNOWCHAT_MAPPING_USE_LLM", "1").lower() in {"1", "true", "yes", "on"}


def _iter_source_candidates(state: MappingState) -> List[Tuple[str, str]]:
    candidates: List[Tuple[str, str]] = []
    for sheet, columns in state.source_column_samples.items():
        for column in columns:
            candidates.append((sheet, column))
    for descriptor in state.excel_objects:
        if not isinstance(descriptor, dict):
            continue
        label = str(descriptor.get("name") or descriptor.get("path") or "").strip()
        if not label:
            continue
        sheet = str(descriptor.get("sheet") or "JSON")
        candidates.append((sheet, label))
    return candidates


def _history_boost(state: MappingState) -> Dict[str, float]:
    boost: Dict[str, float] = {}
    for record in state.history_suggestions:
        key = record.get("source_column")
        if not key:
            continue
        boost[key.lower()] = max(boost.get(key.lower(), 0.0), float(record.get("confidence", 0.0)))
    return boost


def _target_search_text(target: Dict[str, Any]) -> str:
    """Build a richer search string for a target, including endnote context.

    This prefers label/description/endnote text over the raw heading so that
    heuristic similarity can benefit from disclosure language.
    """
    label = str((target or {}).get("label") or "").strip()
    description = str((target or {}).get("description") or "").strip()
    endnotes_raw = (target or {}).get("endnote_texts") or []
    endnote_text = ""
    if isinstance(endnotes_raw, list):
        endnote_text = " ".join(str(value) for value in endnotes_raw if value).strip()
    elif endnotes_raw:
        endnote_text = str(endnotes_raw).strip()
    parts = [part for part in (label, description, endnote_text) if part]
    return " ".join(parts)


def _best_match(target: str, candidates: Iterable[Tuple[str, str]], boost: Dict[str, float]) -> Tuple[str, str, float, str]:
    """Find best matching candidate with improved semantic matching."""
    normalized_target = target.lower().replace(" ", "").replace("_", "").replace("-", "")
    # Extract base field name without occurrence markers like #1, #2
    target_base = normalized_target.split("#")[0].strip()
    
    best: Tuple[str, str] = ("", "")
    best_score = 0.0
    rationale = ""
    for sheet, column in candidates:
        normalized_column = column.lower().replace(" ", "").replace("_", "").replace("-", "")
        
        # Try multiple matching strategies
        scores = []
        
        # 1. Direct similarity
        scores.append(difflib.SequenceMatcher(None, target_base, normalized_column).ratio())
        
        # 2. Check if column contains target or vice versa
        if target_base in normalized_column or normalized_column in target_base:
            scores.append(0.85)
        
        # 3. Semantic equivalents - common field variations
        semantic_map = {
            "duedate": ["invoiceduedate", "paymentdue", "datedue"],
            "invoicedate": ["billdate", "statementdate", "invoicegendate"],
            "invoiceamount": ["amountdue", "billamount", "totaldue", "invoicetotal"],
            "totalamount": ["grandtotal", "totaldue", "sumamount"],
            "accountnumber": ["acctnum", "accountno", "customerid"],
            "recipientname": ["accountname", "customername", "billtoname"],
        }
        
        for key, aliases in semantic_map.items():
            if key in target_base and normalized_column in aliases:
                scores.append(0.9)
            elif key in normalized_column and target_base in aliases:
                scores.append(0.9)
        
        ratio = max(scores) if scores else 0.0
        ratio += boost.get(normalized_column, 0.0)
        
        if ratio > best_score:
            best = (sheet, column)
            best_score = ratio
            rationale = f"Matched via similarity score {ratio:.2f}"
    return best[0], best[1], min(best_score, 1.0), rationale


def _heuristic_rows(state: MappingState, confidence_threshold: float) -> List[Dict[str, Any]]:
    method = "mapping_synthesizer._heuristic_rows"
    log_method_start(
        logger,
        method,
        "Fallback heuristic matching of headings to columns",
        targets=len(state.target_fields),
        threshold=confidence_threshold,
    )
    with step_tracker(9, state, {"strategy": "heuristic", "targets": len(state.target_fields)}):
        candidates = _iter_source_candidates(state)
        if not candidates:
            logger.warning("[mapping.synthesizer] No spreadsheet columns available for synthesis.")
            state.metadata.setdefault("synthesis", {})
            state.metadata["synthesis"].update(
                {
                    "strategy": "heuristic",
                    "targets_considered": len(state.target_fields),
                    "rows_generated": 0,
                    "history_boosted": False,
                }
            )
            return []
        boost = _history_boost(state)
        rows: List[Dict[str, Any]] = []
        for target in state.target_fields:
            target_heading = (target or {}).get("heading", "").strip()
            search_text = _target_search_text(target)
            # Fallback to heading when no richer context is available
            query = search_text or target_heading
            if not query:
                continue
            sheet, column, score, rationale = _best_match(query, candidates, boost)
            source_label = f"{sheet}::{column}" if sheet else column
            if score < confidence_threshold:
                source_label = ""
                rationale = "No confident match identified"
                logger.info(
                    "[mapping.synthesizer] Target %s unresolved heuristically | score=%.2f",
                    target_heading or query,
                    score,
                )
            else:
                logger.info(
                    "[mapping.synthesizer] Target %s mapped heuristically | source=%s score=%.2f",
                    target_heading or query,
                    source_label,
                    score,
                )
            
            # Augment rationale with Word document location metadata
            location = target.get("location")
            classification = target.get("classification")
            if location:
                location_suffix = f" [Word location: {location}"
                if classification:
                    location_suffix += f", type: {classification}"
                location_suffix += "]"
                rationale = rationale + location_suffix
            
            rows.append(
                {
                    "target_field": target_heading,
                    "source_column": source_label,
                    "confidence": round(score, 3),
                    "rationale": rationale,
                    "strategy": "heuristic",
                }
            )
    state.metadata.setdefault("synthesis", {})
    state.metadata["synthesis"].update(
        {
            "targets_considered": len(state.target_fields),
            "rows_generated": len(rows),
            "history_boosted": bool(boost),
            "strategy": "heuristic",
        }
    )
    logger.info(
        "[mapping.synthesizer] Generated heuristic mapping rows | rows=%s history_boost=%s",
        len(rows),
        bool(boost),
    )
    log_method_end(
        logger,
        method,
        "Heuristic synthesis complete",
        rows=len(rows),
        history_boost=bool(boost),
    )
    return rows


def synthesize_mapping_rows(state: MappingState, confidence_threshold: float = 0.35) -> MappingState:
    """Populate ``state.mapping_rows`` using the configured strategy."""
    state.metadata.setdefault("synthesis", {})
    rows: List[Dict[str, Any]] = []
    method = "mapping_synthesizer.synthesize_mapping_rows"
    log_method_start(
        logger,
        method,
        "Decide between LLM and heuristic mapping strategies",
        use_llm=USE_LLM,
        targets=len(state.target_fields),
    )
    if USE_LLM:
        strategy_used = "llm"
        try:
            logger.info(
                "[mapping.synthesizer] Invoking generate_with_llm",
                extra={
                    "assignment": state.assignment_name,
                    "target_count": len(state.target_fields),
                    "source_column_sheets": len(state.source_column_samples),
                    "has_embeddings": bool(state.metadata.get("retrieval_cache")),
                },
            )
            rows = generate_with_llm(state)
            if not rows:
                state.warnings.append("LLM synthesis returned no confident mappings; fallback applied.")
                log_method_progress(logger, method, "LLM returned no rows; fallback pending")
        except Exception as exc:
            logger.error(
                "[mapping.synthesizer] LLM synthesis failed; using heuristic fallback.",
                extra={
                    "assignment": state.assignment_name,
                    "target_count": len(state.target_fields),
                    "source_column_sheets": len(state.source_column_samples),
                    "history_entries": len(state.history_suggestions),
                },
                exc_info=True,
            )
            state.warnings.append("LLM synthesis failed; using heuristic fallback.")
            log_method_progress(logger, method, "LLM raised exception; fallback pending", error=str(exc))
            rows = []
        if rows:
            state.metadata["synthesis"].update(
                {
                    "strategy": strategy_used,
                    "rows_generated": len(rows),
                    "targets_considered": len(state.target_fields),
                }
            )
            state.mapping_rows = rows
            log_method_end(logger, method, "LLM strategy applied", rows=len(rows))
            return state
    # Fallback heuristics
    rows = _heuristic_rows(state, confidence_threshold)
    state.mapping_rows = rows
    log_method_end(logger, method, "Heuristic strategy applied", rows=len(rows))
    return state


__all__ = ["synthesize_mapping_rows"]
