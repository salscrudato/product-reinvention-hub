"""Shared logging/throttling wrapper for embedding generation."""
from __future__ import annotations

import hashlib
import itertools
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

from ..vectorization_and_index_creation import generate_embeddings

logger = logging.getLogger("agentic_orchestrator_auto.mapping.embedding")

_TRACE = os.getenv("SNOWCHAT_MAPPING_EMBED_TRACE", "0").lower() in {"1", "true", "yes"}
_REQUEST_COUNTER = itertools.count(1)
_SLOW_REQUEST_THRESHOLD_MS = int(os.getenv("SNOWCHAT_MAPPING_EMBED_WARN_MS", "10000"))


def request_embeddings(texts: List[str], *, kind: str, metadata: Optional[Dict[str, Any]] = None) -> List[List[float]]:
    if not texts:
        return []
    payload = {
        "kind": kind,
        "count": len(texts),
    }
    if metadata:
        payload.update(metadata)
    request_id = next(_REQUEST_COUNTER)
    payload["request_id"] = request_id
    start = time.perf_counter()
    logger.info("[mapping.embedding] request_start | %s", json.dumps(payload, default=str))
    if _TRACE:
        sample = texts[0][:200]
        digest = hashlib.sha256(sample.encode("utf-8")).hexdigest()[:8]
        logger.debug("[mapping.embedding] sample_text | id=%s hash=%s preview=%s", request_id, digest, sample)
    try:
        vectors = generate_embeddings(texts)
        duration_ms = int((time.perf_counter() - start) * 1000)
        logger.info(
            "[mapping.embedding] request_complete | id=%s kind=%s count=%s duration_ms=%s",
            request_id,
            kind,
            len(texts),
            duration_ms,
        )
        if duration_ms >= _SLOW_REQUEST_THRESHOLD_MS:
            logger.warning(
                "[mapping.embedding] request_slow | id=%s kind=%s duration_ms=%s count=%s",
                request_id,
                kind,
                duration_ms,
                len(texts),
            )
        return vectors
    except Exception as exc:
        duration_ms = int((time.perf_counter() - start) * 1000)
        logger.warning(
            "[mapping.embedding] request_error | id=%s kind=%s duration_ms=%s error=%s",
            request_id,
            kind,
            duration_ms,
            exc,
            exc_info=True,
        )
        raise


__all__ = ["request_embeddings"]
