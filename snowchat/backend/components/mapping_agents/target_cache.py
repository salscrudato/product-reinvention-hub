"""Persistent cache for Word target heading embeddings."""
from __future__ import annotations

import hashlib
import json
import logging
import os
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..embedding_utils import get_effective_embedding_model
from .embedding_controller import request_embeddings
from .parsers import WordField, WordSummary
from .state import MappingState

logger = logging.getLogger("agentic_orchestrator_auto.mapping.target_cache")


def _cache_root() -> Path:
    override = os.getenv("SNOWCHAT_MAPPING_TARGET_CACHE_DIR")
    if override:
        root = Path(override)
    else:
        root = Path(__file__).resolve().parents[2] / "cache" / "mapping_targets"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _compute_word_fingerprint(state: MappingState) -> Optional[str]:
    if state.word_fingerprint:
        return state.word_fingerprint
    path = state.word_path
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
        logger.warning("[mapping.target_cache] Failed to fingerprint Word template: %s", exc)
        return None
    digest = hasher.hexdigest()
    state.word_fingerprint = digest
    return digest


def _cache_path(state: MappingState, fingerprint: str) -> Path:
    assignment_bucket = state.assignment_page_id or "assignment"
    word_bucket = state.word_attachment_id or "word"
    folder = _cache_root() / assignment_bucket / word_bucket
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{fingerprint}.json"


def _load_manifest(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("[mapping.target_cache] Failed to load cache manifest %s: %s", path, exc)
        return None


def _save_manifest(path: Path, payload: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def build_target_descriptors(word_summary: WordSummary) -> List[Dict[str, Any]]:
    descriptors: List[Dict[str, Any]] = []
    if word_summary.fields:
        placeholder_pairs: List[Tuple[int, WordField, str]] = []
        for idx, field in enumerate(word_summary.fields):
            token = (field.placeholder or field.label or "").strip()
            if not token:
                continue
            placeholder_pairs.append((idx, field, token))
        if placeholder_pairs:
            totals = Counter(token for _, _, token in placeholder_pairs)
            seen = defaultdict(int)
            for idx, field, token in placeholder_pairs:
                seen[token] += 1
                occurrence = seen[token]
                repeat_total = totals[token]
                heading = token if repeat_total == 1 else f"{token}#{occurrence}"

                # Build a human-readable description that incorporates endnote text
                label = (field.label or token).strip()
                endnote_texts = [text for text in getattr(field, "endnote_texts", []) or [] if text]
                endnote_summary = " ".join(endnote_texts).strip()
                description = label
                if endnote_summary:
                    description = f"{label} - {endnote_summary}"

                # Enrich embedding text with endnote summary so embeddings carry disclosure meaning
                embedding_parts = [
                    f"{token}",
                    f"label: {field.label}",
                    f"location: {field.location}",
                    f"occurrence: {occurrence}/{repeat_total}",
                ]
                if endnote_summary:
                    embedding_parts.append(f"endnotes: {endnote_summary}")
                embedding_text = " | ".join(embedding_parts)

                descriptors.append(
                    {
                        "heading": heading,
                        "placeholder": token,
                        "label": field.label,
                        "classification": field.classification,
                        "location": field.location,
                        "order": idx,
                        "occurrence_index": occurrence,
                        "occurrence_total": repeat_total,
                        "group_key": token,
                        "embedding_text": embedding_text,
                        # Endnote-aware fields for downstream heuristic/LLM usage
                        "description": description,
                        "endnote_ids": list(getattr(field, "endnote_ids", []) or []),
                        "endnote_texts": endnote_texts,
                    }
                )
            unique_groups = len({entry["group_key"] for entry in descriptors})
            repeating_groups = len({entry["group_key"] for entry in descriptors if entry.get("occurrence_total", 1) > 1})
            logger.info(
                "[mapping.target_cache] placeholder_tokens_enumerated | total_fields=%s unique_tokens=%s repeating_tokens=%s",
                len(descriptors),
                unique_groups,
                repeating_groups,
            )
    else:
        for idx, heading in enumerate(word_summary.headings):
            trimmed = (heading or "").strip()
            if not trimmed:
                continue
            descriptors.append({"heading": trimmed, "order": idx, "embedding_text": trimmed})
    return descriptors


def ensure_target_embedding_cache(
    state: MappingState,
    word_summary: WordSummary,
    descriptors: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, List[float]]:
    descriptors = descriptors or build_target_descriptors(word_summary)
    descriptor_count = len(descriptors)
    descriptor_sample = [entry.get("heading") for entry in descriptors[:5]]
    logger.info(
        "[mapping.target_cache] descriptors_ready | assignment=%s headings=%s sample=%s",
        state.assignment_page_id,
        descriptor_count,
        descriptor_sample,
    )
    if not descriptors:
        return {}
    fingerprint = _compute_word_fingerprint(state)
    model = get_effective_embedding_model()
    manifest_path: Optional[Path] = None
    cache_vectors: Dict[str, List[float]] = {}
    if fingerprint:
        manifest_path = _cache_path(state, fingerprint)
        manifest = _load_manifest(manifest_path)
        if (
            manifest
            and manifest.get("fingerprint") == fingerprint
            and manifest.get("embedding_model") == model
        ):
            raw_entries = manifest.get("entries") or []
            restored = 0
            for entry in raw_entries:
                heading = entry.get("heading")
                vector = entry.get("embedding")
                if not heading or not isinstance(vector, list):
                    continue
                cache_vectors[heading] = [float(value) for value in vector]
                restored += 1
            if restored:
                logger.info(
                    "[mapping.target_cache] Target heading cache hit | assignment=%s entries=%s path=%s",
                    state.assignment_page_id,
                    restored,
                    manifest_path,
                )
    else:
        logger.debug("[mapping.target_cache] Word fingerprint unavailable; cache persistence disabled for run")
    embedding_text_map = {
        entry["heading"]: entry.get("embedding_text") or entry.get("placeholder") or entry["heading"]
        for entry in descriptors
        if entry.get("heading")
    }
    desired_headings = list(embedding_text_map.keys())
    missing = [heading for heading in desired_headings if heading not in cache_vectors]
    if missing:
        try:
            vectors = request_embeddings(
                [embedding_text_map[heading] for heading in missing],
                kind="target_heading",
                metadata={"assignment": state.assignment_page_id, "count": len(missing)},
            )
        except Exception:
            vectors = []
        if len(vectors) != len(missing):
            logger.warning(
                "[mapping.target_cache] Embedding call mismatch | requested=%s received=%s",
                len(missing),
                len(vectors),
            )
        for heading, vector in zip(missing, vectors):
            if not isinstance(vector, list):
                continue
            cache_vectors[heading] = [float(value) for value in vector]
    retrieval_cache = state.metadata.setdefault("retrieval_cache", {})
    retrieval_cache["target_heading_embeddings"] = cache_vectors
    retrieval_cache["target_heading_count"] = len(cache_vectors)
    if cache_vectors:
        first_vector = next(iter(cache_vectors.values()))
        retrieval_cache["target_embedding_dim"] = len(first_vector)
    logger.info(
        "[mapping.target_cache] metadata_populated | assignment=%s headings=%s sample=%s",
        state.assignment_page_id,
        len(cache_vectors),
        list(cache_vectors.keys())[:5],
    )
    if manifest_path and fingerprint:
        entries: List[Dict[str, Any]] = []
        for descriptor in descriptors:
            heading = descriptor["heading"]
            vector = cache_vectors.get(heading)
            if not vector:
                continue
            entry = dict(descriptor)
            entry["embedding"] = vector
            entries.append(entry)
        payload = {
            "fingerprint": fingerprint,
            "assignment_id": state.assignment_page_id,
            "word_attachment_id": state.word_attachment_id,
            "word_attachment_title": state.word_attachment_title,
            "embedding_model": model,
            "entry_count": len(entries),
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "entries": entries,
        }
        try:
            _save_manifest(manifest_path, payload)
            logger.info(
                "[mapping.target_cache] Target heading cache stored | assignment=%s entries=%s path=%s",
                state.assignment_page_id,
                len(entries),
                manifest_path,
            )
        except OSError as exc:
            logger.warning("[mapping.target_cache] Failed to persist heading cache %s: %s", manifest_path, exc)
    return cache_vectors


__all__ = ["ensure_target_embedding_cache", "build_target_descriptors"]
