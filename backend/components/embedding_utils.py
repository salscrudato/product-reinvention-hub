"""Unified embedding utility to ensure CustomWikiRAG uses the exact same logic
as the vectorization script (generate_embeddings) for consistency.

Key points:
 1. Prefer manifest embedding_model if available (guarantees index-model match).
 2. Attempt new OpenAI client first (with Azure base_url if endpoint provided).
 3. Fallback to legacy openai.embeddings.create if new client not available or fails.
 4. Provide clear 404 guidance (Azure deployment vs base model family mismatch).
 5. Never log API keys.

NOTE: This mirrors the logic found in vectorize_confluence_wiki.py with minimal adaptation.
"""
from __future__ import annotations
import os
import json
import logging
from typing import List
from dotenv import load_dotenv

load_dotenv()

# Route embed logs through orchestrator logger so diagnostics land in shared log.
_base_agentic_logger = logging.getLogger("agentic_orchestrator_auto")
if not any(isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", "").endswith("agentic_orchestrator_auto.log") for h in _base_agentic_logger.handlers):
    try:
        _auto_handler = logging.FileHandler('agentic_orchestrator_auto.log', mode='a', encoding='utf-8')
        _auto_handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
        _auto_handler.setLevel(logging.DEBUG)
        _base_agentic_logger.addHandler(_auto_handler)
    except Exception:
        pass
if _base_agentic_logger.level > logging.INFO:
    _base_agentic_logger.setLevel(logging.INFO)
logger = _base_agentic_logger.getChild("embedding_utils")
logger.setLevel(logging.INFO)
logger.propagate = True

try:  # modern client import path
    from openai import OpenAI, AzureOpenAI  # type: ignore
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore
    AzureOpenAI = None  # type: ignore
import openai  # type: ignore

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
OPENAI_API_VERSION = os.getenv("OPENAI_API_VERSION")  # legacy default for chat
AZURE_OPENAI_EMBEDDING_API_VERSION = os.getenv("AZURE_OPENAI_EMBEDDING_API_VERSION") or OPENAI_API_VERSION
MANIFEST_PATH = os.getenv("FAISS_MANIFEST_PATH", os.path.join(os.path.dirname(os.getenv("FAISS_INDEX_PATH") or os.getcwd()), "faiss_index_manifest.json"))

def _load_manifest_model() -> str | None:
    try:
        if MANIFEST_PATH and os.path.exists(MANIFEST_PATH):
            with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("embedding_model")
    except Exception:
        return None
    return None

def get_effective_embedding_model() -> str:
    man_model = _load_manifest_model()
    env_model = os.getenv("EMBEDDING_MODEL_NAME")
    model = man_model or env_model
    if not model:
        model = "text-embedding-3-small"
    return model

def generate_embeddings(texts: List[str]) -> List[List[float]]:
    model = get_effective_embedding_model()
    attempted = []
    embeddings = None
    client = None
    client_mode = None
    public_key = os.getenv("OPENAI_API_KEY")
    if AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY and AzureOpenAI:
        try:
            client = AzureOpenAI(azure_endpoint=AZURE_OPENAI_ENDPOINT, api_key=AZURE_OPENAI_API_KEY, api_version=AZURE_OPENAI_EMBEDDING_API_VERSION or None)  # type: ignore
            client_mode = "azure"
            logger.debug("[EmbeddingUtils] Using AzureOpenAI client | model=%s version=%s", model, AZURE_OPENAI_EMBEDDING_API_VERSION or "default")
        except Exception as e:  # pragma: no cover
            logger.warning("[EmbeddingUtils] AzureOpenAI client init failed: %s", e, exc_info=True)
            client = None
    if client is None and OpenAI and public_key:
        try:
            client = OpenAI(api_key=public_key)  # type: ignore
            client_mode = "openai"
            logger.debug("[EmbeddingUtils] Using public OpenAI client | model=%s", model)
        except Exception as e:  # pragma: no cover
            logger.warning("[EmbeddingUtils] Public OpenAI client init failed: %s", e, exc_info=True)
            client = None
    # Try primary client
    if client:
        try:
            attempted.append(client_mode or "client_primary")
            resp = client.embeddings.create(model=model, input=texts)  # type: ignore
            embeddings = [d.embedding for d in resp.data]
        except Exception as e:
            # Detect Azure 404 and provide guidance but continue fallback
            msg = str(e)
            if "404" in msg and "Resource not found" in msg:
                logger.warning(
                    "[EmbeddingUtils] Azure 404 embedding failure | model=%s message=%s | hint=set EMBEDDING_MODEL_NAME to the deployment name",
                    model,
                    msg,
                )
            else:
                logger.warning("[EmbeddingUtils] Primary client embedding call failed: %s", e, exc_info=True)
    # Legacy fallback
    if embeddings is None:
        try:
            attempted.append("legacy_global")
            if AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY:
                # Configure legacy globals specifically for embeddings path
                openai.api_type = "azure"  # type: ignore[attr-defined]
                openai.api_base = AZURE_OPENAI_ENDPOINT  # type: ignore[attr-defined]
                openai.api_key = AZURE_OPENAI_API_KEY  # type: ignore[attr-defined]
                if AZURE_OPENAI_EMBEDDING_API_VERSION:
                    openai.api_version = AZURE_OPENAI_EMBEDDING_API_VERSION  # type: ignore[attr-defined]
            resp = openai.embeddings.create(model=model, input=texts)  # type: ignore[attr-defined]
            embeddings = [item.embedding for item in resp.data]
        except Exception as e:
            logger.warning("[EmbeddingUtils] Legacy embedding call failed: %s", e, exc_info=True)
    if embeddings is None:
        logger.error("[EmbeddingUtils] Embedding generation failed | model=%s attempts=%s", model, attempted)
        raise RuntimeError(f"Failed to generate embeddings for model '{model}'. Attempts: {attempted}. If using Azure, ensure EMBEDDING_MODEL_NAME matches the deployment name.")
    dims = {len(e) for e in embeddings}
    if len(dims) != 1:
        raise ValueError(f"Inconsistent embedding dimensions produced: {dims}")
    return embeddings

def generate_embedding(text: str) -> List[float]:
    """Single-text convenience wrapper."""
    return generate_embeddings([text])[0]
