import sys
import os
import json
import pickle
import hashlib
from datetime import datetime
from dotenv import load_dotenv
import openai  # type: ignore
import faiss
import numpy as np
import requests
from typing import List, Dict, Any
import logging
"""Document and splitter import modernization

Preference:
1. langchain_core.documents.Document (1.x canonical)
2. langchain.schema.Document (intermediate layout)
3. Fallback stub (keeps script runnable for isolated embedding flow)
"""
try:
    from langchain_core.documents import Document  # type: ignore
except Exception:  # pragma: no cover
    try:
        from langchain.schema import Document  # type: ignore
    except Exception:
        class Document:  # type: ignore
            def __init__(self, page_content: str, metadata: dict | None = None):
                self.page_content = page_content
                self.metadata = metadata or {}
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
"""Text splitter import modernization

Preference:
1. langchain_text_splitters.RecursiveCharacterTextSplitter (1.x externalized)
2. langchain.text_splitter.RecursiveCharacterTextSplitter (legacy)
3. None sentinel if unavailable (script will exit early if splitter missing)
"""
try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter  # type: ignore
except Exception:  # pragma: no cover
    try:
        from langchain.text_splitter import RecursiveCharacterTextSplitter  # type: ignore
    except Exception:
        RecursiveCharacterTextSplitter = None  # type: ignore

# Load .env and set up OpenAI/Azure OpenAI
load_dotenv()
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT") or ""
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY") or ""
OPENAI_API_VERSION = os.getenv("OPENAI_API_VERSION") or ""
EMBEDDING_API_VERSION = os.getenv("AZURE_OPENAI_EMBEDDING_API_VERSION") or OPENAI_API_VERSION
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME") or "text-embedding-3-small"

# Newer openai SDK uses OpenAI() client pattern; fall back to legacy global if needed.
try:
    from openai import OpenAI, AzureOpenAI  # type: ignore
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore
    AzureOpenAI = None  # type: ignore

# Configure logger to mirror orchestrator logging path so batch runs emit diagnostics to shared log.
_base_logger = logging.getLogger("agentic_orchestrator_auto")
if not any(isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", "").endswith("agentic_orchestrator_auto.log") for h in _base_logger.handlers):
    try:
        _handler = logging.FileHandler('agentic_orchestrator_auto.log', mode='a', encoding='utf-8')
        _handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
        _handler.setLevel(logging.DEBUG)
        _base_logger.addHandler(_handler)
    except Exception:
        pass
if _base_logger.level > logging.INFO:
    _base_logger.setLevel(logging.INFO)
logger = _base_logger.getChild("vectorize_wiki")
logger.setLevel(logging.INFO)
logger.propagate = True

_oai_client = None
_client_mode = None
public_key = os.getenv("OPENAI_API_KEY")
if AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY and AzureOpenAI:
    try:
        _oai_client = AzureOpenAI(azure_endpoint=AZURE_OPENAI_ENDPOINT, api_key=AZURE_OPENAI_API_KEY, api_version=EMBEDDING_API_VERSION or None)  # type: ignore
        _client_mode = "azure"
        logger.info("[Vectorizer] Using AzureOpenAI client | model=%s version=%s", EMBEDDING_MODEL_NAME, EMBEDDING_API_VERSION or "default")
    except Exception as e:
        logger.warning("[Vectorizer] AzureOpenAI client init failed: %s", e, exc_info=True)
        _oai_client = None
if _oai_client is None and OpenAI and public_key:
    try:
        _oai_client = OpenAI(api_key=public_key)  # type: ignore
        _client_mode = "openai"
        logger.info("[Vectorizer] Using public OpenAI client | model=%s", EMBEDDING_MODEL_NAME)
    except Exception as e:
        logger.warning("[Vectorizer] Public OpenAI client init failed: %s", e, exc_info=True)
        _oai_client = None
FAISS_INDEX_PATH = os.getenv("FAISS_INDEX_PATH") or os.getenv("EMBEDDINGS_INDEX_PATH") or "Embeddings_Lookup_cache.index"
FAISS_INDEX_PATH = os.path.abspath(FAISS_INDEX_PATH)
MANIFEST_PATH = os.getenv("FAISS_MANIFEST_PATH", os.path.join(os.path.dirname(FAISS_INDEX_PATH), "faiss_index_manifest.json"))
EMBEDDING_CACHE_PATH = os.getenv(
    "EMBEDDING_CACHE_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "embedding_cache.json"),
)
EMBEDDING_CACHE_PATH = os.path.abspath(EMBEDDING_CACHE_PATH)

def _strip_html(raw: str) -> str:
    if not raw:
        return ""
    import re
    cleaned = re.sub(r"<script[\s\S]*?</script>", " ", raw, flags=re.IGNORECASE)
    cleaned = re.sub(r"<style[\s\S]*?</style>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = cleaned.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned

def generate_embeddings(texts: List[str]):
    """Generate embeddings using shared embedding_utils when possible for consistency.

    Falls back to direct client/legacy paths. Provides Azure 404 guidance.
    """
    if not texts:
        return []
    # Prefer shared utility
    try:
        # Attempt package-style import when script run via module (python -m backend.components.vectorize_confluence_wiki).
        from embedding_utils import generate_embeddings as _shared_generate  # type: ignore
    except Exception:
        try:
            from .embedding_utils import generate_embeddings as _shared_generate  # type: ignore
        except Exception:
            try:
                import importlib.util
                utils_path = os.path.join(os.path.dirname(__file__), "embedding_utils.py")
                spec = importlib.util.spec_from_file_location("embedding_utils_direct", utils_path)
                if spec and spec.loader:
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)  # type: ignore[attr-defined]
                    _shared_generate = module.generate_embeddings  # type: ignore
                else:
                    _shared_generate = None  # type: ignore
            except Exception as e:
                print(f"[WARN] Shared embedding_utils unavailable or failed ({e}); using local path.")
                _shared_generate = None  # type: ignore
    if _shared_generate:
        embs = _shared_generate(texts)
        return embs
    model = EMBEDDING_MODEL_NAME or "text-embedding-3-small"
    attempted_modes: List[str] = []
    embs: List[List[float]] | None = None
    if _oai_client:
        try:
            attempted_modes.append(_client_mode or "client_primary")
            resp = _oai_client.embeddings.create(model=model, input=texts)  # type: ignore
            embs = [d.embedding for d in resp.data]
        except Exception as e:
            msg = str(e)
            if "404" in msg and "Resource not found" in msg:
                print(f"[WARN] Azure 404 embedding failure for deployment '{model}'. Ensure EMBEDDING_MODEL_NAME matches Azure deployment name.")
                logger.warning("[Vectorizer] Azure 404 embedding failure | model=%s message=%s", model, msg)
            else:
                print(f"[WARN] Primary client embedding call failed: {e}")
                logger.warning("[Vectorizer] Primary client embedding call failed: %s", e, exc_info=True)
    if embs is None:
        try:
            attempted_modes.append("legacy_global")
            if AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY:
                openai.api_type = "azure"  # type: ignore[attr-defined]
                openai.api_base = AZURE_OPENAI_ENDPOINT  # type: ignore[attr-defined]
                openai.api_key = AZURE_OPENAI_API_KEY  # type: ignore[attr-defined]
                if EMBEDDING_API_VERSION:
                    openai.api_version = EMBEDDING_API_VERSION  # type: ignore[attr-defined]
            resp = openai.embeddings.create(model=model, input=texts)  # type: ignore[attr-defined]
            embs = [item.embedding for item in resp.data]
        except Exception as e:
            print(f"[WARN] Legacy embedding call failed: {e}")
            logger.warning("[Vectorizer] Legacy embedding call failed: %s", e, exc_info=True)
    if embs is None:
        raise RuntimeError(f"Failed to generate embeddings for model '{model}'. Attempts: {attempted_modes}. If using Azure, ensure EMBEDDING_MODEL_NAME matches deployment name.")
    dims = {len(e) for e in embs}
    if len(dims) != 1:
        raise ValueError(f"Inconsistent embedding dimensions produced: {dims}")
    return embs


def _hash_text_block(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _ensure_cache_struct(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict) and "vectors" in raw:
        meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
        vectors = raw.get("vectors") if isinstance(raw.get("vectors"), dict) else {}
        return {"meta": meta, "vectors": vectors}
    if isinstance(raw, dict):
        return {"meta": {}, "vectors": raw}
    return {"meta": {}, "vectors": {}}


def _load_embedding_cache(path: str) -> Dict[str, Any]:
    if not path or not os.path.exists(path):
        return {"meta": {}, "vectors": {}}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        cache = _ensure_cache_struct(data)
        return cache
    except Exception as exc:
        print(f"[WARN] Failed to load embedding cache ({exc}); proceeding without cache.")
        return {"meta": {}, "vectors": {}}


def _save_embedding_cache(path: str, cache: Dict[str, Any]) -> None:
    if not path:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cache.setdefault("meta", {})
    cache["meta"].update({
        "model": EMBEDDING_MODEL_NAME,
        "updated_at": datetime.utcnow().isoformat().replace("+00:00", "Z"),
    })
    try:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(cache, handle)
    except Exception as exc:
        print(f"[WARN] Failed to persist embedding cache ({exc}).")

def fetch_all_confluence_pages() -> List[Document]:
    CONFLUENCE_API_URL = os.getenv("CONFLUENCE_BASE_URL")
    CONFLUENCE_API_TOKEN = os.getenv("CONFLUENCE_API_TOKEN")
    CONFLUENCE_USER_EMAIL = os.getenv("CONFLUENCE_EMAIL")
    CONFLUENCE_SPACE_KEY = os.getenv("CONFLUENCE_SPACE_KEY")
    CONFLUENCE_PAGE_ID = os.getenv("CONFLUENCE_PAGE_ID")
    if not (CONFLUENCE_API_URL and CONFLUENCE_API_TOKEN and CONFLUENCE_USER_EMAIL):
        print("Missing Confluence API configuration.")
        return []
    headers = {
        "Authorization": "Basic " + __import__('base64').b64encode(f"{CONFLUENCE_USER_EMAIL}:{CONFLUENCE_API_TOKEN}".encode()).decode(),
        "Content-Type": "application/json"
    }
    cql_parts = []
    if CONFLUENCE_SPACE_KEY:
        cql_parts.append(f'space="{CONFLUENCE_SPACE_KEY}"')
    if CONFLUENCE_PAGE_ID:
        cql_parts.append(f'(id={CONFLUENCE_PAGE_ID} OR ancestor={CONFLUENCE_PAGE_ID})')
    cql_parts.append('type="page"')
    cql = " AND ".join(cql_parts)
    params = {
        "cql": cql,
        "expand": "body.storage,title",
        "limit": 100
    }
    url = f"{CONFLUENCE_API_URL}/content/search"
    all_docs = []
    start = 0
    while True:
        params["start"] = start
        try:
            resp = requests.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])
            for result in results:
                title = result.get("title", "")
                page_id = result.get("id", "")
                body_html = result.get("body", {}).get("storage", {}).get("value", "")
                cleaned = _strip_html(body_html)
                if cleaned:
                    view_url = None
                    base_ui = os.getenv("CONFLUENCE_UI_BASE")
                    if base_ui and page_id:
                        view_url = f"{base_ui}/pages/{page_id}"
                    metadata: Dict[str, str] = {"title": title}
                    if page_id:
                        metadata["page_id"] = page_id
                    if view_url:
                        metadata["url"] = view_url
                    all_docs.append(Document(page_content=cleaned, metadata=metadata))
            if len(results) < params["limit"]:
                break
            start += params["limit"]
        except Exception as e:
            print(f"Confluence API error: {e}")
            break
    return all_docs

def _write_manifest(num_chunks: int, dim: int):
    # Use timezone-aware UTC now to avoid deprecation warning
    from datetime import datetime as _dt, timezone as _tz
    manifest = {
        "embedding_model": EMBEDDING_MODEL_NAME,
        "dimension": dim,
        "chunk_size": 1000,
        "chunk_overlap": 200,
        "created_at": _dt.now(_tz.utc).isoformat().replace('+00:00', 'Z'),
        "faiss_index_path": FAISS_INDEX_PATH,
        "docs_path": os.getenv("FAISS_DOCS_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "faiss_docs.pkl")),
        "num_chunks": num_chunks
    }
    try:
        with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        print(f"[INFO] Wrote manifest to {MANIFEST_PATH}")
    except Exception as e:
        print(f"[WARN] Failed to write manifest: {e}")

if __name__ == "__main__":
    print("Fetching all Confluence pages...")
    docs = fetch_all_confluence_pages()
    if not docs:
        print("No docs found. Check your .env and Confluence config.")
        exit(1)

    print(f"Fetched {len(docs)} pages. Splitting and embedding...")
    if RecursiveCharacterTextSplitter is None:
        print("RecursiveCharacterTextSplitter unavailable; install langchain-text-splitters or langchain <1.x.")
        exit(1)
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    # Adapt documents to langchain_core.documents.Document if available to satisfy type expectations
    try:
        from langchain_core.documents import Document as CoreDoc  # type: ignore
        adapted = []
        for d in docs:
            if isinstance(d, CoreDoc):
                adapted.append(d)
            else:
                adapted.append(CoreDoc(page_content=getattr(d, 'page_content', str(d)), metadata=getattr(d, 'metadata', {})))
        texts = text_splitter.split_documents(adapted)  # type: ignore[arg-type]
    except Exception:
        # Fallback: proceed with original list (may raise but keeps backwards compatibility)
        texts = text_splitter.split_documents(docs)  # type: ignore[arg-type]
    print(f"Total chunks: {len(texts)}")
    # Debug: print chunk metadata
    for i, doc in enumerate(texts[:5]):
        print(f"[DEBUG] Chunk {i}: {doc.metadata if hasattr(doc, 'metadata') else ''}")
    print(f"[DEBUG] Saving {len(texts)} chunks to faiss_docs.pkl")

    # Save split documents for use in RAG
    faiss_docs_path = os.getenv("FAISS_DOCS_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "faiss_docs.pkl"))
    faiss_docs_path = os.path.abspath(faiss_docs_path)
    with open(faiss_docs_path, "wb") as f:
        pickle.dump(texts, f)
    print(f"Saved split documents to {faiss_docs_path}")

    print("Embedding and saving to FAISS index (cosine similarity)...")
    contents = [doc.page_content for doc in texts]
    cache_payload = _load_embedding_cache(EMBEDDING_CACHE_PATH)
    cache_vectors: Dict[str, List[float]] = cache_payload.setdefault("vectors", {})  # type: ignore[assignment]
    ordered_hashes: List[str] = []
    embeddings: List[Any] = [None] * len(contents)
    pending_texts: List[str] = []
    pending_indexes: List[int] = []
    cache_hits = 0
    for idx, text in enumerate(contents):
        digest = _hash_text_block(text)
        ordered_hashes.append(digest)
        cached_vector = cache_vectors.get(digest)
        if cached_vector is not None:
            embeddings[idx] = cached_vector
            cache_hits += 1
        else:
            pending_texts.append(text)
            pending_indexes.append(idx)
    if pending_texts:
        print(
            f"[INFO] Embedding {len(pending_texts)} new chunks (cache hits {cache_hits} / {len(contents)})."
        )
        try:
            new_vectors = generate_embeddings(pending_texts)
        except Exception as e:
            print(f"[ERROR] Embedding generation failed: {e}")
            print("[HINT] For Azure: set EMBEDDING_MODEL_NAME to your embedding deployment name. For public OpenAI: ensure API key is set. Aborting.")
            exit(1)
        for offset, vector in enumerate(new_vectors):
            target_index = pending_indexes[offset]
            embeddings[target_index] = vector
            cache_vectors[ordered_hashes[target_index]] = vector
        _save_embedding_cache(EMBEDDING_CACHE_PATH, cache_payload)
    else:
        print("[INFO] All chunk embeddings served from cache.")
    if any(vector is None for vector in embeddings):
        raise RuntimeError("Embedding cache returned empty slots; aborting.")
    emb_array = np.array(embeddings)
    print(f"[DEBUG] Embeddings shape: {emb_array.shape}")
    if emb_array.size == 0:
        print("[ERROR] No embeddings generated; aborting index build.")
        exit(1)
    vectors_np = emb_array.astype(np.float32)
    # Normalize vectors for cosine similarity
    vectors_np = vectors_np / np.linalg.norm(vectors_np, axis=1, keepdims=True)
    print(f"[DEBUG] Vectors shape after normalization: {vectors_np.shape}")
    index = faiss.IndexFlatIP(vectors_np.shape[1])
    # FAISS IndexFlatIP expects contiguous float32 matrix; vectors_np already normalized.
    # Add normalized embeddings to the FAISS index; IndexFlatIP expects (n, d) float32 matrix
    index.add(vectors_np)  # type: ignore[arg-type]
    print(f"[DEBUG] FAISS index size: {index.ntotal}")
    faiss.write_index(index, FAISS_INDEX_PATH)
    print(f"[INFO] Saved FAISS index to {FAISS_INDEX_PATH}")
    _write_manifest(num_chunks=len(texts), dim=vectors_np.shape[1])
