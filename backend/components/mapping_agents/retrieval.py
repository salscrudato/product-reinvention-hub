"""Retrieval helpers for GenAI-driven mapping inside the mapping_agents package."""
from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..embedding_utils import get_effective_embedding_model
from ..snowaaone import cosine_similarity
from .embedding_controller import request_embeddings
from .index_cache import search_column_index
from .state import MappingState

try:
    from ..CustomWikiRAG import CustomWikiRAG  # Local import to avoid heavy cost globally
except Exception:  # pragma: no cover
    CustomWikiRAG = None  # type: ignore

logger = logging.getLogger("agentic_orchestrator_auto.mapping.retrieval")
DEFAULT_TOP_K = max(1, int(os.getenv("SNOWCHAT_MAPPING_TOP_K", "3")))


_GLOBAL_EMBED_CACHE: Dict[str, List[float]] = {}


def _state_text_embedding_cache(state: MappingState) -> Dict[str, List[float]]:
    cache = state.metadata.setdefault("retrieval_cache", {})
    text_cache = cache.setdefault("text_embeddings", {})
    return text_cache  # type: ignore[return-value]


def _embed_texts(
    state: MappingState,
    texts: List[str],
    *,
    kind: str = "retrieval_heading",
    metadata: Optional[Dict[str, Any]] = None,
) -> List[List[float]]:
    cleaned_inputs = [(text or "").strip() for text in texts]
    text_cache = _state_text_embedding_cache(state)
    results: List[Optional[List[float]]] = []
    pending: List[str] = []
    seen_pending: set[str] = set()
    for cleaned in cleaned_inputs:
        if not cleaned:
            results.append([])
            continue
        cached = text_cache.get(cleaned) or _GLOBAL_EMBED_CACHE.get(cleaned)
        if cached:
            results.append(cached)
            continue
        results.append(None)
        if cleaned not in seen_pending:
            pending.append(cleaned)
            seen_pending.add(cleaned)
    if pending:
        payload = dict(metadata or {})
        payload.setdefault("batch", len(pending))
        payload.setdefault("mode", "bulk")
        try:
            vectors = request_embeddings(pending, kind=kind, metadata=payload)
        except Exception:
            vectors = []
        for text, vector in zip(pending, vectors or []):
            if isinstance(vector, list) and vector:
                normalized = [float(value) for value in vector]
                text_cache[text] = normalized
                _GLOBAL_EMBED_CACHE[text] = normalized
        for idx, cleaned in enumerate(cleaned_inputs):
            if results[idx] is None:
                results[idx] = text_cache.get(cleaned) or _GLOBAL_EMBED_CACHE.get(cleaned, [])
    final: List[List[float]] = []
    for vector in results:
        if not vector:
            final.append([])
        else:
            final.append([float(value) for value in vector])
    return final


def _embed(state: MappingState, text: str) -> List[float]:
    vectors = _embed_texts(state, [text])
    return vectors[0] if vectors else []


def _heading_embedding_cache(state: MappingState) -> Dict[str, List[float]]:
    metadata = getattr(state, "metadata", {})
    if "retrieval_cache" not in metadata:
        logger.info("[mapping.retrieval] init_retrieval_cache | reason=missing_metadata")
    cache = metadata.setdefault("retrieval_cache", {})
    vectors = cache.get("target_heading_embeddings")
    if isinstance(vectors, dict):
        logger.info(
            "[mapping.retrieval] heading_cache_loaded | entries=%s sample_keys=%s",
            len(vectors),
            list(vectors.keys())[:3],
        )
        return vectors
    cache["target_heading_embeddings"] = {}
    logger.info("[mapping.retrieval] heading_cache_created")
    return cache["target_heading_embeddings"]


def _target_vector(state: MappingState, target_heading: str) -> List[float]:
    heading = (target_heading or "").strip()
    if not heading:
        logger.warning("[mapping.retrieval] empty_heading | source=target_vector")
        return []
    cache = _heading_embedding_cache(state)
    cache_size = len(cache)
    logger.info(
        "[mapping.retrieval] target_vector_request | heading=%s cache_entries=%s", heading, cache_size
    )
    vector = cache.get(heading)
    if isinstance(vector, list) and vector:
        logger.info(
            "[mapping.retrieval] cache_hit | heading=%s dims=%s cache_entries=%s",
            heading,
            len(vector),
            cache_size,
        )
        return vector
    if not cache:
        logger.info("[mapping.retrieval] target_cache_empty | heading=%s", heading)
    else:
        logger.info(
            "[mapping.retrieval] cache_miss | heading=%s available=%s",
            heading,
            len(cache),
        )
    logger.info(
        "[mapping.retrieval] embedding_request | heading=%s reason=%s",
        heading,
        "cache_miss" if cache else "cache_empty",
    )
    vector = _embed(state, heading)
    if vector:
        cache[heading] = vector
        logger.info(
            "[mapping.retrieval] cached_fallback | heading=%s dims=%s cache_entries=%s",
            heading,
            len(vector),
            len(cache),
        )
    else:
        logger.warning("[mapping.retrieval] embedding_failed | heading=%s", heading)
    return vector


def _excel_objects(state: MappingState) -> List[Dict[str, Any]]:
    if state.excel_objects:
        return state.excel_objects
    objects = state.metadata.get("excel_objects")
    if isinstance(objects, list):
        state.excel_objects = objects
        return objects
    return []


def _build_column_index(state: MappingState) -> List[Dict[str, Any]]:
    cache = state.metadata.setdefault("retrieval_cache", {})
    if cache.get("column_index"):
        return cache["column_index"]
    entries: List[Tuple[str, str, str]] = []
    for sheet_name, columns in state.source_column_samples.items():
        for column in columns:
            label = f"{sheet_name}::{column}"
            entries.append((sheet_name, column, label))
    if not entries:
        cache["column_index"] = []
        return []
    vectors = _embed_texts(state, [label for _, _, label in entries])
    index: List[Dict[str, Any]] = []
    for (sheet_name, column, label), vector in zip(entries, vectors):
        index.append(
            {
                "sheet": sheet_name,
                "column": column,
                "label": label,
                "vector": vector,
                "kind": "column",
            }
        )
    cache["column_index"] = index
    return index


def _object_cache_root() -> Path:
    override = os.getenv("SNOWCHAT_MAPPING_OBJECT_CACHE_DIR")
    if override:
        root = Path(override)
    else:
        root = Path(__file__).resolve().parents[2] / "cache" / "mapping_objects"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _spreadsheet_fingerprint(state: MappingState) -> Optional[str]:
    if state.spreadsheet_fingerprint:
        return state.spreadsheet_fingerprint
    path = state.spreadsheet_path
    if not path:
        return None
    file_path = Path(path)
    if not file_path.exists():
        return None
    hasher = hashlib.sha256()
    try:
        with open(file_path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                if not chunk:
                    break
                hasher.update(chunk)
    except OSError as exc:
        logger.warning("[mapping.retrieval] Spreadsheet fingerprint failed: %s", exc)
        return None
    digest = hasher.hexdigest()
    state.spreadsheet_fingerprint = digest
    return digest


def _object_cache_path(state: MappingState, fingerprint: str) -> Path:
    assignment = state.assignment_page_id or "assignment"
    spreadsheet = state.spreadsheet_attachment_id or "spreadsheet"
    folder = _object_cache_root() / assignment / spreadsheet
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{fingerprint}.json"


def _load_object_manifest(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("[mapping.retrieval] Failed to load object cache %s: %s", path, exc)
        return None


def _save_object_manifest(path: Path, payload: Dict[str, Any]) -> None:
    try:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
    except OSError as exc:
        logger.warning("[mapping.retrieval] Failed to persist object cache %s: %s", path, exc)


def _build_object_index(state: MappingState) -> List[Dict[str, Any]]:
    cache = state.metadata.setdefault("retrieval_cache", {})
    if cache.get("object_index"):
        return cache["object_index"]
    descriptors = _excel_objects(state)
    fingerprint = _spreadsheet_fingerprint(state)
    model = get_effective_embedding_model()
    manifest_path: Optional[Path] = None
    if fingerprint:
        manifest_path = _object_cache_path(state, fingerprint)
        manifest = _load_object_manifest(manifest_path)
        if (
            manifest
            and manifest.get("fingerprint") == fingerprint
            and manifest.get("embedding_model") == model
        ):
            entries = manifest.get("entries")
            if isinstance(entries, list):
                cache["object_index"] = entries
                logger.info(
                    "[mapping.retrieval] object_index_cache_hit | entries=%s path=%s",
                    len(entries),
                    manifest_path,
                )
                return entries
    payloads: List[Tuple[Dict[str, Any], str]] = []
    for descriptor in descriptors:
        if not isinstance(descriptor, dict):
            continue
        text_parts: List[str] = []
        for field in ("name", "description", "path"):
            value = descriptor.get(field)
            if value:
                text_parts.append(str(value))
        sample = descriptor.get("sample")
        if sample:
            text_parts.append(str(sample))
        examples = descriptor.get("examples")
        if isinstance(examples, list):
            for entry in examples[:3]:
                text_parts.append(str(entry))
        descriptor_text = " ".join(part for part in text_parts if part)
        if not descriptor_text:
            continue
        payloads.append((descriptor, descriptor_text))
    if not payloads:
        cache["object_index"] = []
        return []
    vectors = _embed_texts(
        state,
        [text for _, text in payloads],
        metadata={"mode": "object_index", "count": len(payloads)},
    )
    index: List[Dict[str, Any]] = []
    for (descriptor, _), vector in zip(payloads, vectors):
        entry = {
            "sheet": descriptor.get("sheet") or "JSON",
            "label": descriptor.get("path") or descriptor.get("name") or "json_object",
            "json_path": descriptor.get("path"),
            "description": descriptor.get("description"),
            "samples": descriptor.get("examples") or ([str(descriptor.get("sample"))] if descriptor.get("sample") else []),
            "vector": vector,
            "raw": descriptor,
            "kind": "json_object",
        }
        index.append(entry)
    cache["object_index"] = index
    if manifest_path and fingerprint:
        payload = {
            "fingerprint": fingerprint,
            "embedding_model": model,
            "entry_count": len(index),
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "entries": index,
        }
        _save_object_manifest(manifest_path, payload)
        logger.info(
            "[mapping.retrieval] object_index_cache_store | entries=%s path=%s",
            len(index),
            manifest_path,
        )
    return index


def _rank_object_descriptors(
    state: MappingState,
    target_heading: str,
    target_vector: List[float],
    top_k: int,
) -> List[Dict[str, Any]]:
    index = _build_object_index(state)
    if not index:
        return []
    vector = target_vector or _embed(state, target_heading)
    if not vector:
        return []
    scored: List[Tuple[float, Dict[str, Any]]] = []
    for candidate in index:
        score = cosine_similarity(vector, candidate.get("vector", []))
        entry = {
            "label": candidate.get("label"),
            "sheet": candidate.get("sheet"),
            "column": candidate.get("json_path") or candidate.get("label"),
            "similarity": round(score, 3),
            "kind": "json_object",
            "description": candidate.get("description"),
            "json_path": candidate.get("json_path"),
            "samples": candidate.get("samples")[:1] if isinstance(candidate.get("samples"), list) else [],
        }
        scored.append((score, entry))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [entry for _, entry in scored[:top_k]]


def rank_source_columns(state: MappingState, target_heading: str, top_k: Optional[int] = None) -> List[Dict[str, Any]]:
    """Return top matching columns for a target heading using embedding similarity."""
    effective_top_k = max(1, top_k if top_k else DEFAULT_TOP_K)
    target_vector = _target_vector(state, target_heading)
    cached = search_column_index(state, target_vector, effective_top_k)
    if cached is not None:
        normalized: List[Dict[str, Any]] = []
        for entry in cached:
            similarity_value = entry.get("similarity", 0.0)
            if isinstance(similarity_value, (int, float)):
                similarity = float(similarity_value)
            elif isinstance(similarity_value, str):
                try:
                    similarity = float(similarity_value)
                except ValueError:
                    similarity = 0.0
            else:
                similarity = 0.0
            normalized.append(
                {
                    "label": entry.get("label"),
                    "sheet": entry.get("sheet"),
                    "column": entry.get("column"),
                    "similarity": round(similarity, 3),
                    "kind": "column",
                }
            )
        object_matches = _rank_object_descriptors(state, target_heading, target_vector, effective_top_k)
        combined = (normalized + object_matches)
        combined.sort(key=lambda item: item.get("similarity", 0.0), reverse=True)
        return combined[:effective_top_k]
    index = _build_column_index(state)
    scored: List[Tuple[float, Dict[str, Any]]] = []
    for candidate in index:
        score = cosine_similarity(target_vector, candidate.get("vector", []))
        scored.append((score, candidate))
    scored.sort(key=lambda item: item[0], reverse=True)
    result: List[Dict[str, Any]] = []
    for score, candidate in scored[:effective_top_k]:
        entry = {
            "label": candidate["label"],
            "sheet": candidate["sheet"],
            "column": candidate["column"],
            "similarity": round(score, 3),
            "kind": "column",
        }
        result.append(entry)
    object_matches = _rank_object_descriptors(state, target_heading, target_vector, effective_top_k)
    combined = (result + object_matches)
    combined.sort(key=lambda item: item.get("similarity", 0.0), reverse=True)
    return combined[:effective_top_k]


def build_excel_vector_context(state: MappingState, sample_limit: int = 5) -> Dict[str, Any]:
    """Return lightweight metadata about spreadsheet embedding indexes."""

    column_index = _build_column_index(state)
    object_index = _build_object_index(state)

    def _sample(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        preview: List[Dict[str, Any]] = []
        limit = max(1, sample_limit)
        for entry in entries[:limit]:
            vector = entry.get("vector") if isinstance(entry.get("vector"), list) else []
            preview.append(
                {
                    "label": entry.get("label"),
                    "sheet": entry.get("sheet"),
                    "column": entry.get("column"),
                    "kind": entry.get("kind"),
                    "json_path": entry.get("json_path"),
                    "description": entry.get("description"),
                    "samples": entry.get("samples"),
                    "vector_preview": vector[: min(32, len(vector))] if vector else [],
                    "vector_dim": len(vector) if vector else 0,
                }
            )
        return preview

    return {
        "column_index_count": len(column_index),
        "object_index_count": len(object_index),
        "column_index_sample": _sample(column_index),
        "object_index_sample": _sample(object_index),
    }


def history_matches(state: MappingState, target_heading: str, top_k: int = 4) -> List[Dict[str, Any]]:
    """Score historical suggestions using embeddings for target headings."""
    suggestions = state.history_suggestions or []
    if not suggestions:
        return []
    target_vector = _target_vector(state, target_heading)
    scored: List[Tuple[float, Dict[str, Any]]] = []
    for suggestion in suggestions:
        suggestion_heading = suggestion.get("target_field") or ""
        vector = _embed(state, str(suggestion_heading))
        score = cosine_similarity(target_vector, vector)
        enriched = dict(suggestion)
        enriched["similarity"] = round(score, 3)
        scored.append((score, enriched))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in scored[:top_k]]


_WIKI_CLIENT = None


def wiki_context_chunks(query: str, top_k: int = 3) -> List[Dict[str, Any]]:
    global _WIKI_CLIENT
    if not query:
        return []
    if _WIKI_CLIENT is None and CustomWikiRAG:
        try:
            _WIKI_CLIENT = CustomWikiRAG()
        except Exception as exc:  # pragma: no cover
            logger.warning("[mapping.retrieval] Unable to init CustomWikiRAG: %s", exc)
            _WIKI_CLIENT = False  # type: ignore
    if not _WIKI_CLIENT:
        return []
    try:
        results = _WIKI_CLIENT.search(query, k=top_k)
    except Exception as exc:  # pragma: no cover
        logger.warning("[mapping.retrieval] Wiki search failed: %s", exc)
        return []
    contexts: List[Dict[str, Any]] = []
    for hit in results:
        idx = None
        score = None
        if isinstance(hit, tuple) and len(hit) >= 2:
            idx, score = hit[0], hit[1]
        elif isinstance(hit, dict):
            idx = hit.get("index")
            score = hit.get("score")
        if idx is None:
            continue
        try:
            doc = _WIKI_CLIENT.faiss_docs[idx]
            contexts.append(
                {
                    "title": doc.metadata.get("title", "wiki-snippet"),
                    "excerpt": (doc.page_content or "")[:600],
                    "score": round(float(score or 0.0), 3),
                }
            )
        except Exception:  # pragma: no cover
            continue
    return contexts


def summarize_context_profile(state: MappingState) -> Dict[str, Any]:
    profile = state.metadata.get("context_profile") or {}
    return profile


__all__ = [
    "rank_source_columns",
    "build_excel_vector_context",
    "history_matches",
    "wiki_context_chunks",
    "summarize_context_profile",
]
