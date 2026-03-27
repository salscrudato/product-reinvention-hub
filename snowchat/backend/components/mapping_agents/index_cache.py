"""Persistent FAISS column index cache for mapping spreadsheets."""
from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

try:  # pragma: no cover - faiss availability is environment-specific
    import faiss  # type: ignore
except Exception:  # pragma: no cover
    faiss = None  # type: ignore

from ..embedding_utils import get_effective_embedding_model
from .embedding_controller import request_embeddings
from .state import MappingState

logger = logging.getLogger("agentic_orchestrator_auto.mapping.index_cache")


@dataclass
class _IndexBundle:
    path: Path
    metadata: List[Dict[str, str]]
    manifest: Dict[str, object]


_FAISS_HANDLES: Dict[str, Any] = {}


def _index_root() -> Path:
    env_path = os.getenv("SNOWCHAT_MAPPING_INDEX_DIR")
    if env_path:
        root = Path(env_path)
    else:
        root = Path(__file__).resolve().parents[2] / "cache" / "mapping_indices"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _compute_fingerprint(state: MappingState) -> Optional[str]:
    if state.spreadsheet_fingerprint:
        return state.spreadsheet_fingerprint
    path = state.spreadsheet_path
    if not path or not Path(path).exists():
        return None
    hasher = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(chunk)
    except OSError as exc:
        logger.warning("[mapping.index_cache] Failed to fingerprint spreadsheet: %s", exc)
        return None
    digest = hasher.hexdigest()
    state.spreadsheet_fingerprint = digest
    return digest


def _column_labels(state: MappingState) -> List[Tuple[str, str, str]]:
    labels: List[Tuple[str, str, str]] = []
    for sheet, columns in (state.source_column_samples or {}).items():
        for column in columns:
            label = f"{sheet}::{column}".strip()
            labels.append((sheet, column, label))
    return labels


def _index_paths(state: MappingState, fingerprint: str) -> Tuple[Path, Path]:
    assignment_bucket = state.assignment_page_id or "assignment"
    att_bucket = state.spreadsheet_attachment_id or "spreadsheet"
    folder = _index_root() / assignment_bucket / att_bucket
    folder.mkdir(parents=True, exist_ok=True)
    index_path = folder / f"{fingerprint}.faiss"
    meta_path = folder / f"{fingerprint}.json"
    return index_path, meta_path


def _load_manifest(meta_path: Path) -> Optional[Dict[str, object]]:
    if not meta_path.exists():
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("[mapping.index_cache] Failed to load manifest %s: %s", meta_path, exc)
        return None


def _save_manifest(meta_path: Path, payload: Dict[str, object]) -> None:
    with open(meta_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def _write_index(index_path: Path, vectors: np.ndarray) -> None:
    if faiss is None:
        raise RuntimeError("faiss is not available in this environment")
    index = faiss.IndexFlatIP(vectors.shape[1])  # type: ignore[attr-defined]
    index.add(vectors)  # type: ignore[arg-type]
    faiss.write_index(index, str(index_path))


def _load_faiss(index_path: Path):  # -> faiss.Index
    if faiss is None:
        raise RuntimeError("faiss is not available in this environment")
    key = str(index_path)
    cached = _FAISS_HANDLES.get(key)
    if cached is not None:
        return cached
    index = faiss.read_index(str(index_path))  # type: ignore[attr-defined]
    _FAISS_HANDLES[key] = index
    return index


def ensure_column_index(state: MappingState) -> Optional[_IndexBundle]:
    """Ensure a FAISS index exists for the spreadsheet columns tied to ``state``."""
    if not state.source_column_samples:
        logger.debug("[mapping.index_cache] No column samples available; skipping cache init")
        return None
    fingerprint = _compute_fingerprint(state)
    if not fingerprint:
        logger.warning("[mapping.index_cache] Unable to compute fingerprint; skipping cache init")
        return None
    index_path, meta_path = _index_paths(state, fingerprint)
    model = get_effective_embedding_model()
    labels = _column_labels(state)
    column_count = len(labels)
    manifest = _load_manifest(meta_path)
    if (
        index_path.exists()
        and manifest
        and manifest.get("embedding_model") == model
        and manifest.get("fingerprint") == fingerprint
        and manifest.get("column_count") == column_count
    ):
        raw_columns = manifest.get("columns")
        if not isinstance(raw_columns, list):
            raw_columns = []
        metadata = [
            {
                "sheet": str(entry.get("sheet", "")),
                "column": str(entry.get("column", "")),
                "label": str(entry.get("label", "")),
            }
            for entry in raw_columns
            if isinstance(entry, dict)
        ]
        if metadata:
            logger.info(
                "[mapping.index_cache] Column index cache hit | attachment=%s rows=%s path=%s",
                state.spreadsheet_attachment_id,
                len(metadata),
                index_path,
            )
            return _hydrate_bundle(state, index_path, manifest, metadata)
    # Need to rebuild
    metadata = []
    texts: List[str] = []
    for sheet, column, label in labels:
        metadata.append({"sheet": sheet, "column": column, "label": label})
        texts.append(label or "")
    if not texts:
        return None
    vectors = request_embeddings(
        texts,
        kind="column_index",
        metadata={"attachment": state.spreadsheet_attachment_id, "count": len(texts)},
    )
    if not vectors:
        logger.warning("[mapping.index_cache] Embedding call returned no vectors; skipping cache build")
        return None
    array = np.array(vectors, dtype="float32")
    if array.ndim != 2:
        logger.warning("[mapping.index_cache] Unexpected embedding shape %s", array.shape)
        return None
    if faiss is None:
        logger.warning("[mapping.index_cache] faiss is unavailable; skipping cache build")
        return None
    faiss.normalize_L2(array)  # type: ignore[attr-defined]
    _write_index(index_path, array)
    manifest = {
        "fingerprint": fingerprint,
        "attachment_id": state.spreadsheet_attachment_id,
        "embedding_model": model,
        "dimension": int(array.shape[1]),
        "column_count": column_count,
        "columns": metadata,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
    _save_manifest(meta_path, manifest)
    logger.info(
        "[mapping.index_cache] Column index cache miss | building new FAISS store attachment=%s rows=%s path=%s",
        state.spreadsheet_attachment_id,
        column_count,
        index_path,
    )
    return _hydrate_bundle(state, index_path, manifest, metadata)


def _hydrate_bundle(
    state: MappingState,
    index_path: Path,
    manifest: Dict[str, object],
    metadata: List[Dict[str, str]],
) -> _IndexBundle:
    cache = state.metadata.setdefault("retrieval_cache", {})
    cache["column_index_path"] = str(index_path)
    cache["column_index_manifest"] = manifest
    cache["column_index"] = metadata
    return _IndexBundle(path=index_path, metadata=metadata, manifest=manifest)


def _bundle_from_state(state: MappingState) -> Optional[_IndexBundle]:
    cache = state.metadata.get("retrieval_cache") or {}
    path_value = cache.get("column_index_path")
    metadata = cache.get("column_index")
    manifest = cache.get("column_index_manifest")
    if not path_value or not metadata:
        return None
    return _IndexBundle(path=Path(path_value), metadata=list(metadata), manifest=manifest or {})


def get_column_index(state: MappingState) -> Optional[_IndexBundle]:
    bundle = _bundle_from_state(state)
    if bundle:
        return bundle
    return ensure_column_index(state)


def search_column_index(state: MappingState, target_vector: List[float], top_k: int = 6) -> Optional[List[Dict[str, object]]]:
    bundle = get_column_index(state)
    if not bundle:
        return None
    if not target_vector:
        return []
    try:
        index = _load_faiss(bundle.path)
    except RuntimeError as exc:
        logger.warning("[mapping.index_cache] Unable to load FAISS index %s: %s", bundle.path, exc)
        return None
    vector = np.array(target_vector, dtype="float32").reshape(1, -1)
    if faiss is None:
        return None
    faiss.normalize_L2(vector)  # type: ignore[attr-defined]
    limit = min(max(top_k, 1), len(bundle.metadata))
    scores, indices = index.search(vector, limit)  # type: ignore[attr-defined]
    results: List[Dict[str, object]] = []
    for score, idx in zip(scores[0], indices[0]):
        if idx < 0 or idx >= len(bundle.metadata):
            continue
        meta = bundle.metadata[idx]
        enriched = dict(meta)
        enriched["similarity"] = round(float(score), 3)
        results.append(enriched)
    return results


__all__ = ["ensure_column_index", "get_column_index", "search_column_index"]
