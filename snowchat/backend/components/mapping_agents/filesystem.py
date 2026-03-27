"""Utility helpers for temporary workspace management."""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
from contextlib import contextmanager
from typing import Iterator

logger = logging.getLogger("agentic_orchestrator_auto.mapping.fs")


@contextmanager
def temporary_workspace(prefix: str = "mapping-agent-") -> Iterator[str]:
    """Yield a temporary directory that is cleaned up afterwards."""
    temp_dir = tempfile.mkdtemp(prefix=prefix)
    logger.info("[mapping.fs] Created temporary workspace | path=%s", temp_dir)
    try:
        yield temp_dir
    finally:
        try:
            shutil.rmtree(temp_dir)
            logger.info("[mapping.fs] Removed temporary workspace | path=%s", temp_dir)
        except FileNotFoundError:
            logger.warning("[mapping.fs] Temporary workspace already removed | path=%s", temp_dir)


def ensure_directory(path: str) -> None:
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)
        logger.info("[mapping.fs] Created directory | path=%s", path)


__all__ = ["temporary_workspace", "ensure_directory"]
