"""LLM-driven mapping synthesis that stays scoped inside mapping_agents."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from ..openai_client import extract_json_block, first_choice_content
from .llm_controller import invoke_with_retry
from .progress import log_step, step_tracker, update_state_progress
from .logging_utils import log_method_end, log_method_progress, log_method_start
from .retrieval import history_matches, rank_source_columns, summarize_context_profile, wiki_context_chunks
from .state import MappingState

logger = logging.getLogger("agentic_orchestrator_auto.mapping.llm_synthesizer")

SYSTEM_PROMPT = (
    "You are SnowChat's mapping architect connecting Word document form fields to Excel/API source data. "
    "Use semantic understanding: 'Policy Holder' matches 'Insured Name', 'Effective Date' matches 'Coverage Start', 'Due Date' matches 'dueDate', 'Amount Due' matches 'invoiceAmount'. "
    "Leverage Word document context: field location (paragraph/table/section heading), classification (required/optional/conditional), "
    "placeholder text, and surrounding instructions all reveal the field's business purpose. "
    "For JSON object candidates, match on description/json_path semantics, not just surface labels. "
    "CRITICAL: When placeholders repeat (e.g., '<INVOICE DATE>#1', '<INVOICE DATE>#2', '<INVOICE DATE>#3'), these represent array/table rows. "
    "Each occurrence needs its own mapping - if the source is an array like 'invoiceDetails', map each placeholder occurrence to the same array field. "
    "For amount fields, match to numeric candidates like 'invoiceAmount', 'totalAmount', 'amountDue'. "
    "For date fields, match to date candidates like 'dueDate', 'invoiceDate', 'transactionDate'. "
    "When uncertain, explain the semantic gap using document context (e.g., 'Target is a date field in Benefits section but candidates are all text identifiers from Applicant Info'). "
    "Always ground rationale in evidence: cite sample values, historical patterns, wiki guidance, or document structure. "
    "You must cite either historical mappings or wiki snippets inside the citations array."
)

_RESPONSE_SCHEMA = {
    "source_column": "<sheet>::<column> notation from the candidate list. Empty string if unknown.",
    "confidence": "0-1 float for how certain you are.",
    "rationale": "Short explanation referencing business meaning.",
    "citations": "List of short references (e.g. history:<id> or wiki:<title>).",
}

_BATCH_RESPONSE_SCHEMA = {
    "mappings": [
        {
            "target_field": "Name of the target heading (must match input).",
            **_RESPONSE_SCHEMA,
        }
    ]
}

_BATCH_SIZE = max(1, int(os.getenv("SNOWCHAT_MAPPING_BATCH_SIZE", "6")))
_MAX_TOKENS = max(200, int(os.getenv("SNOWCHAT_MAPPING_MAX_TOKENS", "900")))

STRICT_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "snowchat_mapping_batch",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "mappings": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "target_field": {"type": "string"},
                            "source_column": {"type": "string"},
                            "confidence": {"type": "number"},
                            "rationale": {"type": "string"},
                            "citations": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                        },
                        "required": ["target_field", "source_column", "confidence", "rationale", "citations"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["mappings"],
            "additionalProperties": False,
        },
    },
}


def _build_messages(batch: List[Dict[str, Any]], context_profile: Dict[str, Any]) -> List[Dict[str, str]]:
    guidance_lines = [
        "Follow these rules:",
        "1. Only choose source_column values that exactly match the provided candidate label strings.",
        "2. Use semantic reasoning: if a target field represents 'policyholder name' and a candidate contains 'insured' or 'applicant', explain the conceptual match.",
        "3. CRITICAL semantic matches: '<DUE DATE>' maps to 'dueDate', '<AMOUNT DUE>' maps to 'invoiceAmount', '<TOTAL DUE>' maps to 'totalAmount'.",
        "4. For repeated placeholders (e.g., '<INVOICE DATE>#1', '#2', '#3'), map EACH to the same source field - they represent array elements or table rows.",
        "5. If target_context includes 'location', 'classification', or 'instructions', incorporate this into your rationale to show document context.",
        "6. For 'kind=json_object' candidates, prioritize description/json_path semantic alignment over exact label matching.",
        "7. Use 'samples' arrays to validate data type compatibility (e.g., dates, addresses, identifiers).",
        "8. When no confident match exists, explain WHY based on semantic gaps (e.g., 'Target seeks policy number but candidates contain demographic fields').",
        "9. Always cite evidence: reference history patterns, wiki guidance, or candidate samples in your rationale.",
        "10. Return JSON with a top-level 'mappings' array preserving input order.",
    ]
    user_content = {
        "instructions": "\n".join(guidance_lines),
        "context_profile": context_profile,
        "targets": batch,
        "response_schema": _BATCH_RESPONSE_SCHEMA,
    }
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json_dumps(user_content)},
    ]


def json_dumps(payload: Dict[str, Any]) -> str:
    import json

    return json.dumps(payload, ensure_ascii=False, indent=2)


def _post_process(raw: Dict[str, Any], target_field: str, target_context: Dict[str, Any] = None) -> Dict[str, Any]:
    source = str(raw.get("source_column") or "").strip()
    confidence_value = raw.get("confidence")
    confidence: float
    if isinstance(confidence_value, (int, float)):
        confidence = float(confidence_value)
    elif isinstance(confidence_value, str) and confidence_value.strip():
        try:
            confidence = float(confidence_value)
        except ValueError:
            confidence = 0.0
    else:
        confidence = 0.0
    citations = raw.get("citations") or []
    if not isinstance(citations, list):
        citations = [str(citations)]
    rationale = str(raw.get("rationale") or "LLM mapping output").strip()
    
    # Augment rationale with Word document location metadata
    if target_context:
        location = target_context.get("location")
        classification = target_context.get("classification")
        if location:
            location_suffix = f" [Word location: {location}"
            if classification:
                location_suffix += f", type: {classification}"
            location_suffix += "]"
            rationale = rationale + location_suffix
    
    return {
        "target_field": target_field,
        "source_column": source,
        "confidence": confidence,
        "rationale": rationale,
        "citations": [str(entry) for entry in citations if entry],
        "strategy": "llm",
    }


def _chunk(entries: List[Dict[str, Any]], size: int) -> List[List[Dict[str, Any]]]:
    if size <= 1:
        return [[entry] for entry in entries]
    chunks: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    for entry in entries:
        current.append(entry)
        if len(current) >= size:
            chunks.append(current)
            current = []
    if current:
        chunks.append(current)
    logger.info(
        "[mapping.llm] Chunked targets | total_entries=%s batch_size=%s batches=%s",
        len(entries),
        size,
        len(chunks),
    )
    return chunks


def _lookup_column_samples(
    column_value_samples: Dict[str, Dict[str, List[str]]],
    sheet: Optional[str],
    column: Optional[str],
) -> List[str]:
    if not sheet or not column:
        return []
    sheet_samples = column_value_samples.get(sheet)
    if not sheet_samples:
        return []
    for key, values in sheet_samples.items():
        if key.lower() == column.lower():
            return values[:1]
    return []


def _augment_candidates(candidates: List[Dict[str, Any]], state: MappingState) -> List[Dict[str, Any]]:
    column_value_samples = state.column_value_samples or state.metadata.get("excel_column_value_samples") or {}
    slimmed: List[Dict[str, Any]] = []
    for candidate in candidates:
        base = {
            "label": candidate.get("label"),
            "sheet": candidate.get("sheet"),
            "column": candidate.get("column"),
            "similarity": candidate.get("similarity"),
            "kind": candidate.get("kind"),
        }
        if candidate.get("kind") == "column":
            samples = _lookup_column_samples(column_value_samples, candidate.get("sheet"), candidate.get("column"))
            if samples:
                base["samples"] = samples
        else:
            description = candidate.get("description")
            if description:
                base["description"] = str(description)[:160]
            json_path = candidate.get("json_path")
            if json_path:
                base["json_path"] = json_path
            samples = candidate.get("samples")
            if isinstance(samples, list) and samples:
                base["samples"] = samples[:1]
        slimmed.append(base)
    return slimmed


def _invoke_batch(batch: List[Dict[str, Any]], context_profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    target_names = [entry["target_field"] for entry in batch]
    context_summary = [
        {
            "target": entry["target_field"],
            "candidates": len(entry.get("candidates", [])),
            "history": len(entry.get("history", [])),
            "wiki": len(entry.get("wiki", [])),
        }
        for entry in batch
    ]
    logger.info("[mapping.llm] batch_context | targets=%s summary=%s", target_names, context_summary)
    messages = _build_messages(batch, context_profile)
    logger.info(
        "[mapping.llm] Invoking batch | targets=%s candidates=%s wiki_hits=%s",
        target_names,
        sum(len(entry.get("candidates", [])) for entry in batch),
        sum(len(entry.get("wiki", [])) for entry in batch),
    )
    response = invoke_with_retry(
        messages,
        temperature=0.1,
        max_tokens=_MAX_TOKENS,
        metadata={
            "targets": target_names,
            "batch_size": len(batch),
        },
        response_format=STRICT_RESPONSE_FORMAT,
    )
    response_text = first_choice_content(response)
    logger.info(
        "[mapping.llm] batch_response_raw | targets=%s raw_chars=%s preview=%s",
        target_names,
        len(response_text or ""),
        (response_text or "")[:400],
    )
    data = extract_json_block(response_text)
    mappings = data.get("mappings") if isinstance(data, dict) else None
    rows: List[Dict[str, Any]] = []
    lookup: Dict[str, Any] = {}
    if isinstance(mappings, list):
        for item in mappings:
            target_name = str(item.get("target_field") or "").strip()
            if target_name:
                lookup[target_name] = item
    for idx, entry in enumerate(batch):
        target_field = entry["target_field"]
        raw = lookup.get(target_field)
        if raw is None and isinstance(mappings, list) and idx < len(mappings):
            raw = mappings[idx]
        if not raw:
            logger.info("[mapping.llm] Target %s missing from response batch", target_field)
            continue
        target_context = entry.get("target_context") or {}
        row = _post_process(raw, target_field, target_context)
        # Accept mapping if source_column exists; citations only required if wiki/history available
        has_evidence = entry.get("wiki") or entry.get("history")
        if row["source_column"] and (row["citations"] or not has_evidence):
            rows.append(row)
            logger.info(
                "[mapping.llm] Target %s mapped | source=%s confidence=%.2f citations=%s",
                target_field,
                row["source_column"],
                row["confidence"],
                len(row.get("citations", [])),
            )
        else:
            logger.info(
                "[mapping.llm] Target %s unresolved (source=%s, citations=%s, has_evidence=%s)",
                target_field,
                row.get("source_column"),
                row.get("citations"),
                has_evidence,
            )
    if not rows:
        logger.warning("[mapping.llm] batch_completed_no_rows | targets=%s", target_names)
    return rows


def generate_with_llm(state: MappingState) -> List[Dict[str, Any]]:
    """Return mapping rows using the GenAI flow."""
    method = "llm_mapping.generate_with_llm"
    context_profile = summarize_context_profile(state)
    wiki_enabled = os.getenv("SNOWCHAT_MAPPING_DISABLE_WIKI", "0").lower() not in {"1", "true", "yes"}
    preloaded_wiki = state.metadata.get("preloaded_wiki_chunks")
    if not isinstance(preloaded_wiki, dict):
        preloaded_wiki = {}
    entries: List[Dict[str, Any]] = []
    total_candidates = 0
    log_method_start(
        logger,
        method,
        "Batch targets and invoke LLM for candidate mappings",
        target_count=len(state.target_fields),
        wiki_enabled=wiki_enabled,
        batch_size=_BATCH_SIZE,
    )
    with step_tracker(8, state, {"targets": len(state.target_fields), "wiki_enabled": wiki_enabled}):
        for target in state.target_fields:
            target_heading = (target or {}).get("heading", "").strip()
            if not target_heading:
                continue
            description = target.get("description") if isinstance(target, dict) else None
            candidates = rank_source_columns(state, target_heading)
            if not candidates:
                logger.info("[mapping.llm] No candidates for %s; skipping", target_heading)
                continue
            candidates = _augment_candidates(candidates, state)
            total_candidates += len(candidates)
            history = history_matches(state, target_heading)
            wiki_override = preloaded_wiki.get(target_heading)
            if isinstance(wiki_override, list):
                wiki = wiki_override
            else:
                wiki = wiki_context_chunks(target_heading) if wiki_enabled else []
            if wiki:
                log_step(8, "wiki_hits", {"target": target_heading, "hits": len(wiki)})
            target_context = {
                "placeholder": target.get("placeholder"),
                "classification": target.get("classification"),
                "location": target.get("location"),
            }
            supplemental_context = target.get("context") or target.get("user_context")
            if isinstance(supplemental_context, dict):
                target_context["user_context"] = supplemental_context
            for key in (
                "destination",
                "destination_system",
                "source_system",
                "value_guidance",
                "handling_instructions",
                "conditions",
                "examples",
                "notes",
                "instructions",
            ):
                value = target.get(key)
                if value:
                    target_context[key] = value
            logger.info(
                "[mapping.llm] target_prepared | target=%s candidates=%s history=%s wiki=%s sample_candidates=%s",
                target_heading,
                len(candidates),
                len(history),
                len(wiki),
                [entry.get("label") or entry.get("json_path") for entry in candidates[:3]],
            )
            entries.append(
                {
                    "target_field": target_heading,
                    "description": description,
                    "target_context": target_context,
                    "candidates": candidates,
                    "history": history,
                    "wiki": wiki,
                }
            )
    if not entries:
        warning = "No eligible targets found for LLM synthesis"
        logger.warning("[mapping.llm] %s", warning)
        log_method_end(logger, method, warning)
        return []
    logger.info(
        "[mapping.llm] entries_compiled | total_targets=%s entries=%s total_candidates=%s context_keys=%s",
        len(state.target_fields),
        len(entries),
        total_candidates,
        list(context_profile.keys())[:5],
    )
    batches = _chunk(entries, _BATCH_SIZE)
    update_state_progress(state, 8, "end", {"entries": len(entries)})
    results: List[Dict[str, Any]] = []
    with step_tracker(9, state, {"strategy": "llm", "batches": len(batches)}):
        for batch_index, batch in enumerate(batches, start=1):
            log_step(9, "batch_start", {"batch_index": batch_index, "size": len(batch)})
            try:
                batch_rows = _invoke_batch(batch, context_profile)
                results.extend(batch_rows)
            except Exception as exc:
                logger.warning("[mapping.llm] Batch LLM mapping failed: %s", exc, exc_info=True)
                log_method_progress(logger, method, "Batch failed", error=str(exc))
                log_step(9, "batch_error", {"batch_index": batch_index, "error": str(exc)})
            else:
                log_step(9, "batch_end", {"batch_index": batch_index, "rows": len(batch_rows)})
                if not batch_rows:
                    logger.warning(
                        "[mapping.llm] batch_returned_no_rows | batch_index=%s targets=%s",
                        batch_index,
                        [entry["target_field"] for entry in batch],
                    )
    log_method_end(
        logger,
        method,
        "LLM synthesis complete",
        mapped=len(results),
        requested=len(entries),
    )
    if not results:
        logger.warning(
            "[mapping.llm] llm_returned_no_mappings | entries=%s target_count=%s",
            len(entries),
            len(state.target_fields),
        )
    return results


__all__ = ["generate_with_llm"]
