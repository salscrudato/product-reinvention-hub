import os
import logging
import sys
from pydantic import BaseModel
from dotenv import load_dotenv
"""Modernized Document import with layered fallbacks.

Preferred order (newest first):
1. langchain_core.documents.Document
2. langchain_community.document_loaders.base.Document (older split path; optional)
3. langchain.schema.Document (legacy pre-1.x)
4. Stub class fallback (minimal shape with page_content, metadata)
"""
try:  # LangChain 1.x core
    from langchain_core.documents import Document  # type: ignore
except Exception:  # pragma: no cover
    try:
        # Some split packages expose document definitions differently
        from langchain_community.document_loaders.base import Document  # type: ignore
    except Exception:
        try:
            from langchain.schema import Document  # type: ignore
        except Exception:
            class Document:  # type: ignore
                def __init__(self, page_content: str, metadata: dict | None = None):
                    self.page_content = page_content
                    self.metadata = metadata or {}
import faiss
import numpy as np
import json
import requests
from typing import Optional, Any, List, Dict
from datetime import datetime

try:  # OpenAI compatibility (support both legacy and 1.x client style)
    import openai  # type: ignore
    _HAS_OPENAI = True
except Exception:  # pragma: no cover
    openai = None  # type: ignore
    _HAS_OPENAI = False

# Route all WikiRAG logs through the agentic orchestrator logger hierarchy so they land in agentic_orchestrator_auto.log
_base_agentic_logger = logging.getLogger("agentic_orchestrator_auto")
if not any(isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", "").endswith("agentic_orchestrator_auto.log") for h in _base_agentic_logger.handlers):
    try:
        _auto_handler = logging.FileHandler('agentic_orchestrator_auto.log', mode='a', encoding='utf-8')
        _auto_handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
        _auto_handler.setLevel(logging.DEBUG)
        _base_agentic_logger.addHandler(_auto_handler)
    except Exception:
        # Fall back silently; base logger may already be configured elsewhere.
        pass
if _base_agentic_logger.level > logging.INFO:
    _base_agentic_logger.setLevel(logging.INFO)
logger = _base_agentic_logger.getChild("wiki")
logger.setLevel(logging.INFO)
logger.propagate = True


class WikiRAGResponse(BaseModel):
    answer: str


load_dotenv()
AZURE_API_KEY = (os.getenv("AZURE_OPENAI_API_KEY") or "").strip()
AZURE_ENDPOINT = (os.getenv("AZURE_OPENAI_ENDPOINT") or "").strip()
OPENAI_API_VERSION = (os.getenv("OPENAI_API_VERSION") or "").strip()
PUBLIC_OPENAI_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()

def _mask_key(key: str) -> str:
    """Deprecated: masking helper retained for potential future internal use, but we no longer log key fragments."""
    return "<redacted>"

# Configure legacy global settings ONLY if we will use legacy path (absence of 1.x client class or Azure class)
if _HAS_OPENAI:
    try:
        # Decide mode: prefer Azure if endpoint+key provided; else public OpenAI if public key provided.
        if AZURE_API_KEY and AZURE_ENDPOINT:
            # Legacy azure globals (used when client class AzureOpenAI not accessible)
            openai.api_type = "azure"  # type: ignore[attr-defined]
            openai.api_base = AZURE_ENDPOINT  # type: ignore[attr-defined]
            if OPENAI_API_VERSION:
                openai.api_version = OPENAI_API_VERSION  # type: ignore[attr-defined]
            openai.api_key = AZURE_API_KEY  # type: ignore[attr-defined]
            logger.info(f"[WikiRAG] Configured legacy Azure OpenAI globals (version={OPENAI_API_VERSION or 'n/a'})")
        elif PUBLIC_OPENAI_KEY:
            openai.api_key = PUBLIC_OPENAI_KEY  # type: ignore[attr-defined]
            logger.info("[WikiRAG] Configured legacy public OpenAI globals")
        else:
            logger.warning("[WikiRAG] No OpenAI / Azure API key detected for legacy configuration.")
    except Exception:  # pragma: no cover
        pass

def _get_openai_client():
    """Return a correctly configured client instance for Azure or public OpenAI.

    Priority:
      1. Azure (if AZURE_OPENAI_API_KEY & AZURE_OPENAI_ENDPOINT set)
         - Try AzureOpenAI class (>=1.x). Pass base_url, api_key, api_version.
      2. Public OpenAI (if OPENAI_API_KEY set) using OpenAI class.
      3. None (fallback to legacy global API usage by returning None).
    """
    if not _HAS_OPENAI:
        return None
    azure_key = AZURE_API_KEY
    azure_endpoint = AZURE_ENDPOINT
    api_version = OPENAI_API_VERSION
    public_key = PUBLIC_OPENAI_KEY

    AzureClient = getattr(openai, "AzureOpenAI", None)
    PublicClient = getattr(openai, "OpenAI", None)
    # Azure first
    if azure_key and azure_endpoint and AzureClient:
        try:
            # Azure OpenAI uses azure_endpoint parameter, not base_url
            # Endpoint should be like: https://your-resource.openai.azure.com/
            client = AzureClient(
                api_key=azure_key,
                azure_endpoint=azure_endpoint,
                api_version=api_version or "2024-05-01-preview"
            )
            logger.info(f"[WikiRAG] Using AzureOpenAI client (version={api_version or 'default'})")
            return client
        except Exception as e:  # pragma: no cover
            logger.warning(f"[WikiRAG] Failed to init AzureOpenAI client: {e}; will try public client if available.", exc_info=True)
    # Public OpenAI next
    if public_key and PublicClient:
        try:
            client = PublicClient(api_key=public_key)
            logger.info("[WikiRAG] Using public OpenAI client")
            return client
        except Exception as e:  # pragma: no cover
            logger.warning(f"[WikiRAG] Failed to init public OpenAI client: {e}; falling back to legacy globals.", exc_info=True)
    return None

OPENAI_API_KEY = AZURE_API_KEY or PUBLIC_OPENAI_KEY
WIKI_URL = os.getenv("CONFLUENCE_BASE_URL")  # The wiki link to use for RAG
FAISS_INDEX_PATH = os.getenv("FAISS_INDEX_PATH", "Embeddings_Lookup_cache.index")
CONFLUENCE_API_URL = os.getenv("CONFLUENCE_BASE_URL")
CONFLUENCE_API_TOKEN = os.getenv("CONFLUENCE_API_TOKEN")
CONFLUENCE_USER_EMAIL = os.getenv("CONFLUENCE_EMAIL")
CONFLUENCE_SPACE_KEY = os.getenv("CONFLUENCE_SPACE_KEY")
CONFLUENCE_PAGE_ID = os.getenv("CONFLUENCE_PAGE_ID")

class CustomWikiRAG:
    def __init__(self, wiki_url: Optional[str] = None, openai_api_key: Optional[str] = None, faiss_index_path: Optional[str] = None):
        # Use FAISS_INDEX_PATH from .env for index loading, matching vectorize_confluence_wiki.py
        # Prefer unified FAISS_INDEX_PATH; fallback to legacy EMBEDDINGS_INDEX_PATH for backward compatibility
        raw_index_path = os.getenv("FAISS_INDEX_PATH") or os.getenv("EMBEDDINGS_INDEX_PATH") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "Embeddings_Lookup_cache.index")
        # Normalize common path typos (.ix vs .index, missing dev in C:\dsnowchat)
        self.index_path = os.path.abspath(raw_index_path)
        logger.info(f"[WikiRAG] init start | index_path={self.index_path} embedding_model={os.getenv('EMBEDDING_MODEL_NAME') or 'default'}")
        if not os.path.exists(self.index_path):
            # Handle accidental .ix extension (seen in logs) by trying .index sibling
            if self.index_path.endswith('.ix'):
                alt = self.index_path[:-3] + 'index'
                if os.path.exists(alt):
                    logger.info(f"[WikiRAG] Index path '{self.index_path}' missing; using sibling '{alt}'")
                    self.index_path = alt
            # Handle missing 'e' in 'dev' (C:\dsnowchat) by attempting replacement
            if '\\dsnowchat\\' in self.index_path:
                alt = self.index_path.replace('\\dsnowchat\\', '\\dev\\snowchat\\')
                if os.path.exists(alt):
                    logger.info(f"[WikiRAG] Index path corrected from dsnowchat to dev\\snowchat: {alt}")
                    self.index_path = alt
        logger.info(f"[WikiRAG] Attempting to load FAISS index from: {self.index_path}")
        self.embedding_model = os.getenv("EMBEDDING_MODEL_NAME")
        if not self.embedding_model:
            # Default: choose a modern public OpenAI embedding model; override via EMBEDDING_MODEL_NAME for Azure deployment name
            self.embedding_model = "text-embedding-3-large"
        # If Azure configured, we expect EMBEDDING_MODEL_NAME to be the Azure deployment name.
        if AZURE_API_KEY and AZURE_ENDPOINT and not os.getenv("EMBEDDING_MODEL_NAME"):
            logger.warning("[WikiRAG] Azure endpoint detected but EMBEDDING_MODEL_NAME not set; using public model name which may fail. Set EMBEDDING_MODEL_NAME to your Azure embedding deployment name.")
        if os.path.exists(self.index_path):
            self.index = faiss.read_index(self.index_path)
            logger.info(f"[WikiRAG] Loaded FAISS index from {self.index_path}")
        else:
            self.index = None
            logger.warning(f"[WikiRAG] FAISS index not found at {self.index_path}")
        # Load split documents for mapping FAISS indices to Document objects
        import pickle
        self.faiss_docs = []
        faiss_docs_path = os.getenv("FAISS_DOCS_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "faiss_docs.pkl"))
        faiss_docs_path = os.path.abspath(faiss_docs_path)
        logger.info(f"[WikiRAG] Attempting to load faiss_docs from: {faiss_docs_path}")
        try:
            with open(faiss_docs_path, "rb") as f:
                self.faiss_docs = pickle.load(f)
            logger.info(f"Loaded faiss_docs.pkl with {len(self.faiss_docs)} documents from {faiss_docs_path}.")
        except Exception as e:
            logger.warning(f"Could not load faiss_docs.pkl from {faiss_docs_path}: {e}", exc_info=True)
        # Load manifest for compatibility checks
        self.manifest_path = os.getenv("FAISS_MANIFEST_PATH", os.path.join(os.path.dirname(self.index_path), "faiss_index_manifest.json"))
        # Attempt alternate manifest locations if primary not found
        manifest_alternates = []
        if not os.path.exists(self.manifest_path):
            # Root-level manifest (workspace root)
            workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
            manifest_alternates.append(os.path.join(workspace_root, 'faiss_index_manifest.json'))
            # Backend directory (already default) but if path typo dsnowchat fix attempt
            if '\\dsnowchat\\' in self.manifest_path:
                manifest_alternates.append(self.manifest_path.replace('\\dsnowchat\\', '\\dev\\snowchat\\'))
        self.manifest: Dict[str, Any] = {}
        try:
            if os.path.exists(self.manifest_path):
                with open(self.manifest_path, "r", encoding="utf-8") as mf:
                    self.manifest = json.load(mf)
                logger.info(f"[WikiRAG] Loaded manifest {self.manifest_path}")
            else:
                # Try alternates
                loaded = False
                for alt in manifest_alternates:
                    if os.path.exists(alt):
                        try:
                            with open(alt, 'r', encoding='utf-8') as mf:
                                self.manifest = json.load(mf)
                            self.manifest_path = alt
                            loaded = True
                            logger.info(f"[WikiRAG] Loaded manifest from alternate location {alt}")
                            break
                        except Exception:
                            continue
                if not loaded:
                    logger.warning(f"[WikiRAG] Manifest not found at {self.manifest_path}; index compatibility cannot be fully validated.")
        except Exception as e:
            logger.warning(f"[WikiRAG] Failed to load manifest: {e}", exc_info=True)
        # Perform model/dimension compatibility check
        self.index_compatible = True
        if self.index is not None and self.manifest:
            idx_dim = getattr(self.index, 'd', None)
            man_dim = self.manifest.get('dimension')
            man_model = self.manifest.get('embedding_model')
            if man_model and man_model != self.embedding_model:
                logger.warning(f"[WikiRAG] Manifest model {man_model} != configured model {self.embedding_model}; recommend rebuild.")
            if idx_dim is not None and man_dim and idx_dim != man_dim:
                logger.warning(f"[WikiRAG] Index dim {idx_dim} != manifest dim {man_dim}; manifest may be stale.")
            if idx_dim is not None and man_dim and abs(idx_dim - man_dim) / max(idx_dim, man_dim) > 0.05:
                self.index_compatible = False
                logger.error(f"[WikiRAG] Significant dimension mismatch (index={idx_dim}, manifest={man_dim}); disabling FAISS search until rebuild.")
        elif self.index is not None and not self.manifest:
            logger.warning("[WikiRAG] Proceeding without manifest; assuming index compatibility.")
        # Track potential mismatch between index size and docs length (will try auto-reload on first run)
        self.index_doc_mismatch = False
        try:
            if self.index is not None and len(self.faiss_docs) > 0 and getattr(self.index, 'ntotal', None) is not None:
                if self.index.ntotal != len(self.faiss_docs):
                    self.index_doc_mismatch = True
                    logger.warning(f"[WikiRAG] Initial index/doc length mismatch detected (index.ntotal={self.index.ntotal} docs_len={len(self.faiss_docs)}). Will attempt reload on first query.")
                    # Attempt: if manifest points to a different index path, try loading it to resolve mismatch immediately
                    man_index_path = self.manifest.get('faiss_index_path') if isinstance(self.manifest, dict) else None
                    if man_index_path:
                        man_index_abs = os.path.abspath(man_index_path)
                        if man_index_abs != self.index_path and os.path.exists(man_index_abs):
                            try:
                                alt_index = faiss.read_index(man_index_abs)
                                if alt_index.ntotal == len(self.faiss_docs):
                                    self.index = alt_index
                                    self.index_path = man_index_abs
                                    self.index_doc_mismatch = False
                                    logger.info(f"[WikiRAG] Mismatch resolved by switching to manifest index at {man_index_abs}")
                                else:
                                    logger.info(f"[WikiRAG] Manifest index ntotal={alt_index.ntotal} still != docs_len={len(self.faiss_docs)}; keeping original index")
                            except Exception as ie:
                                logger.warning(f"[WikiRAG] Failed manifest index load attempt: {ie}", exc_info=True)
        except Exception:
            pass
        logger.info(
            "[WikiRAG] init complete | index_loaded=%s docs_len=%d manifest=%s mismatch_flag=%s",
            bool(self.index),
            len(self.faiss_docs),
            bool(self.manifest),
            self.index_doc_mismatch,
        )

    def embed(self, text: str) -> np.ndarray:
        """Generate a single embedding using the shared embedding_utils logic (exact match to vectorizer).

        Returns normalized vector (resize if index dim mismatch). Zero vector on failure.
        """
        if not _HAS_OPENAI:
            logger.warning("[WikiRAG] OpenAI lib missing; zero embedding returned.")
            return np.zeros((self.index.d if getattr(self, 'index', None) else 1536,), dtype=np.float32)
        try:
            from .embedding_utils import generate_embedding, get_effective_embedding_model  # type: ignore
        except Exception as e:  # pragma: no cover
            logger.warning(f"[WikiRAG] embedding_utils import failed: {e}; returning zero vector.", exc_info=True)
            return np.zeros((self.index.d if getattr(self, 'index', None) else 1536,), dtype=np.float32)
        try:
            vec = generate_embedding(text)
        except Exception as e:
            logger.warning(f"[WikiRAG] generate_embedding failed: {e}", exc_info=True)
            return np.zeros((self.index.d if getattr(self, 'index', None) else 1536,), dtype=np.float32)
        arr = np.array(vec, dtype=np.float32)
        index_dim = None
        if hasattr(self, 'index') and self.index is not None:
            try:
                index_dim = self.index.d
            except Exception:
                index_dim = None
        if index_dim is not None and index_dim != arr.shape[0]:
            logger.warning(f"[WikiRAG] Embedding dim {arr.shape[0]} != index dim {index_dim}; resizing for search.")
            if index_dim < arr.shape[0]:
                arr = arr[:index_dim]
            else:
                arr = np.pad(arr, (0, index_dim - arr.shape[0]), mode='constant')
        norm = np.linalg.norm(arr)
        if norm > 0:
            arr = arr / norm
        try:
            eff_model = get_effective_embedding_model()
        except Exception:
            eff_model = self.embedding_model
        logger.info(f"[WikiRAG] embed success | dim={arr.shape[0]} norm_post={np.linalg.norm(arr):.4f} model={eff_model}")
        return arr

    def search(self, query: str, k: int = 3):
        if not self.index:
            logger.warning("[WikiRAG] search aborted: FAISS index not loaded.")
            return []
        if not self.index_compatible:
            logger.warning("[WikiRAG] search skipped: index marked incompatible; rebuild required.")
            return []
        # Normalize query embedding for cosine similarity
        emb = self.embed(query)
        query_vec = emb.reshape(1, -1)
        logger.info(f"[WikiRAG] search start | q='{query[:80]}' emb_dim={emb.shape[0]} nonzero={bool(np.any(emb))} k={k}")
        # If zero vector (embedding failure), bail early
        if not np.any(query_vec):
            logger.warning("[WikiRAG] search aborted: zero embedding")
            return []
        D, I = self.index.search(query_vec, k)
        logger.info(f"[WikiRAG] search results | indices={I[0].tolist()} distances={[float(d) for d in D[0]]}")
        # Return the indices and distances (user can map indices to docs as needed)
        return [(int(idx), float(dist)) for idx, dist in zip(I[0], D[0]) if idx != -1]

    def load_confluence_docs(self, query):
        """
        Fetch relevant Confluence pages using the Confluence API and API token.
        Returns a list of LangChain Document objects.
        """
        if not (CONFLUENCE_API_URL and CONFLUENCE_API_TOKEN and CONFLUENCE_USER_EMAIL):
            logger.warning("Missing Confluence API configuration.")
            return []
        headers = {
            "Authorization": f"Basic {self._get_confluence_basic_token()}",
            "Content-Type": "application/json"
        }
        # Build CQL query based on config
        cql_parts = []
        space_key = os.getenv("CONFLUENCE_SPACE_KEY")
        page_id = os.getenv("CONFLUENCE_PAGE_ID")
        if space_key:
            cql_parts.append(f'space="{space_key}"')
        if page_id:
            cql_parts.append(f'(id={page_id} OR ancestor={page_id})')
        # Only add text~"{query}" if query is not None and not empty/whitespace
        if query is not None and str(query).strip():
            cql_parts.append(f'text~"{query}"')
        cql = " AND ".join(cql_parts)
        logger.info("CQL: %s", cql)  # Debug: print the CQL being used
        params = {
            "cql": cql,
            "expand": "body.storage,title"
        }
        url = f"{CONFLUENCE_API_URL}/content/search"
        try:
            resp = requests.get(url, headers=headers, params=params)
            logger.info("Request URL: %s", resp.url)
            logger.info("Status Code: %s", resp.status_code)
            resp.raise_for_status()
            data = resp.json()
            logger.info("Confluence API response: %s", data)  # Debug: print the response
            docs = []
            for result in data.get("results", []):
                title = result.get("title", "")
                body = result.get("body", {}).get("storage", {}).get("value", "")
                if body:
                    docs.append({"page_content": body, "metadata": {"title": title}})
            # Convert to LangChain Document objects
            return [Document(page_content=d["page_content"], metadata=d["metadata"]) for d in docs]
        except Exception as e:
            logger.error("Confluence API error: %s", e, exc_info=True)
            return []

    def _get_confluence_basic_token(self):
        import base64
        token = f"{CONFLUENCE_USER_EMAIL}:{CONFLUENCE_API_TOKEN}"
        return base64.b64encode(token.encode()).decode()

    def load_wiki_docs(self, query):
        # Only use Confluence, do not fall back to Wikipedia
        confluence_docs = self.load_confluence_docs("") if not query else self.load_confluence_docs(query)
        return confluence_docs

    def get_retriever(self, docs):
        # This method is now a no-op or can be removed if not used elsewhere
        return None

    def _chat_complete(self, prompt: str) -> str:
        """Internal helper to perform a chat completion with Azure/OpenAI.

        Tries new 1.x client first, falls back to legacy global API. Returns empty string on failure.
        """
        if not _HAS_OPENAI:
            return ""
        # For Azure OpenAI, GPT_MODEL_NAME should be the deployment name
        deployment_name = os.getenv("GPT_MODEL_NAME", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
        messages = [
            {"role": "system", "content": "You are a helpful assistant for answering questions from internal documentation."},
            {"role": "user", "content": prompt}
        ]
        client = _get_openai_client()
        try:
            if client:  # new style
                # For Azure OpenAI client, 'model' parameter is the deployment name
                resp = client.chat.completions.create(
                    model=deployment_name,
                    messages=messages,
                    temperature=0.7,
                    max_tokens=800
                )
                return (resp.choices[0].message.content or "").strip()
            else:  # legacy
                # type: ignore[attr-defined]
                resp = openai.ChatCompletion.create(model=deployment_name, messages=messages)  # type: ignore
                return (resp['choices'][0]['message']['content'] or "").strip()
        except Exception as e:  # pragma: no cover
            logger.error(f"[WikiRAG] Chat completion error: {e}")
            logger.exception("[WikiRAG] Chat completion traceback")
            return ""

    def run_rag(self, question: str):
        """Simplified RAG flow: single embedding + FAISS search only.

        Steps:
          1. Validate question and strip @wiki tag.
          2. Embed question and perform FAISS similarity search.
          3. If results found, build a prompt with top-k chunk contents.
          4. Return model answer; else return a not-found message.

        No Confluence API fallback, no multi-query expansion.
        """
        if not question or not str(question).strip():
            logger.warning("[WikiRAG] run_rag received empty question.")
            return "Please provide a non-empty question for wiki annotation."
        clean_question = question.replace("@wiki", "").strip()
        logger.info(f"[WikiRAG] run_rag start | question='{clean_question[:80]}'")
        try:
            faiss_results = self.search(clean_question)
            logger.info(f"[WikiRAG] run_rag search_results | raw={faiss_results}")
            # Auto-reload docs if we previously detected mismatch and results returned out-of-range indices
            if self.index_doc_mismatch:
                try:
                    idx_total = getattr(self.index, 'ntotal', None)
                except Exception:
                    idx_total = None
                out_of_range = any(idx >= len(self.faiss_docs) or idx < 0 for idx, _ in faiss_results)
                if out_of_range and idx_total is not None:
                    logger.info("[WikiRAG] Attempting auto-reload of faiss_docs due to mismatch and out-of-range indices.")
                    try:
                        import pickle
                        reload_path = os.getenv("FAISS_DOCS_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "faiss_docs.pkl"))
                        with open(os.path.abspath(reload_path), 'rb') as rf:
                            self.faiss_docs = pickle.load(rf)
                        logger.info(f"[WikiRAG] Reloaded faiss_docs; new len={len(self.faiss_docs)}")
                        # If still mismatched, try loading manifest index now
                        if idx_total is not None and len(self.faiss_docs) != idx_total:
                            man_index_path = self.manifest.get('faiss_index_path') if isinstance(self.manifest, dict) else None
                            if man_index_path:
                                man_index_abs = os.path.abspath(man_index_path)
                                if os.path.exists(man_index_abs):
                                    try:
                                        alt_index = faiss.read_index(man_index_abs)
                                        if alt_index.ntotal == len(self.faiss_docs):
                                            self.index = alt_index
                                            idx_total = alt_index.ntotal
                                            logger.info(f"[WikiRAG] Post-reload switch to manifest index resolved mismatch (ntotal={idx_total})")
                                        else:
                                            logger.info(f"[WikiRAG] Post-reload manifest index ntotal={alt_index.ntotal} still mismatched vs docs_len={len(self.faiss_docs)}")
                                    except Exception as ie:
                                        logger.warning(f"[WikiRAG] Post-reload manifest index load failed: {ie}", exc_info=True)
                        # Clear mismatch flag if resolved after any attempt
                        if idx_total is not None and len(self.faiss_docs) == idx_total:
                            self.index_doc_mismatch = False
                            logger.info("[WikiRAG] Index/doc mismatch resolved after reload (final).")
                    except Exception as re:
                        logger.warning(f"[WikiRAG] Auto-reload failed: {re}", exc_info=True)
            if not faiss_results:
                try:
                    self.last_source = 'faiss-empty'
                except Exception:  # pragma: no cover
                    pass
                logger.info("[WikiRAG] run_rag returning no_results | reason=faiss-empty")
                return "No relevant wiki content found."
            if not self.faiss_docs:
                try:
                    self.last_source = 'faiss-missing-docs'
                except Exception:
                    pass
                logger.info("[WikiRAG] run_rag returning no_results | reason=missing-docs")
                return "Wiki index loaded but document chunks are missing (faiss_docs not loaded)."
            # Additional diagnostic: ensure index/doc alignment
            try:
                index_total = getattr(self.index, 'ntotal', None)
            except Exception:
                index_total = None
            if index_total is not None and index_total != len(self.faiss_docs):
                logger.warning(f"[WikiRAG] Index/doc length mismatch: index.ntotal={index_total} docs_len={len(self.faiss_docs)}")
            raw_indices = [idx for idx, _ in faiss_results]
            logger.info(f"[WikiRAG] run_rag raw_indices={raw_indices}")
            top_docs = [self.faiss_docs[idx] for idx, _ in faiss_results if 0 <= idx < len(self.faiss_docs)]
            if not top_docs:
                if self.index_doc_mismatch:
                    try:
                        self.last_source = 'faiss-mismatch'
                    except Exception:
                        pass
                    return (
                        "Wiki index/doc mismatch: retrieved indices are outside loaded document range. "
                        "Re-run vectorization, ensure FAISS_INDEX_PATH and FAISS_DOCS_PATH match, then restart backend."
                    )
                # Provide clearer reason when indices are out of bounds
                out_of_bounds = [idx for idx in raw_indices if not (0 <= idx < len(self.faiss_docs))]
                if out_of_bounds:
                    logger.warning(
                        f"[WikiRAG] All retrieved indices out of bounds. indices={raw_indices} docs_len={len(self.faiss_docs)}"
                    )
                try:
                    self.last_source = 'faiss-mapped-empty'
                except Exception:
                    pass
                logger.info("[WikiRAG] run_rag returning no_results | reason=faiss-mismatch")
                return "No relevant wiki content found."  # indices out of range or mapping failure
            # Concatenate limited context to avoid huge prompts
            max_chars = int(os.getenv("WIKI_RAG_MAX_CONTEXT_CHARS", "12000"))
            context_parts = []
            total = 0
            for d in top_docs:
                chunk = getattr(d, 'page_content', str(d))
                if total + len(chunk) > max_chars:
                    remaining = max_chars - total
                    if remaining > 500:  # only append if meaningful size left
                        context_parts.append(chunk[:remaining])
                        total += remaining
                    break
                context_parts.append(chunk)
                total += len(chunk)
            context = "\n\n".join(context_parts)
            sources = []
            for d in top_docs:
                try:
                    title = getattr(d, 'metadata', {}).get('title') if hasattr(d, 'metadata') else None
                    if title:
                        sources.append(title)
                except Exception:
                    continue
            sources_line = "Sources: " + "; ".join(sources) if sources else "Sources: (not available)"
            prompt = (
                "You are a helpful assistant. Use ONLY the provided context to answer succinctly. "
                "If the context does not contain the answer, respond with 'I do not have that information.'\n\n"
                f"{sources_line}\n\nContext:\n{context}\n\nQuestion: {clean_question}\nAnswer:"
            )
            answer = self._chat_complete(prompt)
            if not answer or not answer.strip():
                try:
                    self.last_source = 'faiss-no-answer'
                except Exception:
                    pass
                logger.info("[WikiRAG] run_rag returning no_results | reason=no-llm-answer")
                return "No answer could be generated from the retrieved wiki chunks."
            try:
                self.last_source = 'faiss'
            except Exception:  # pragma: no cover
                pass
            logger.info("[WikiRAG] run_rag answer generated | length=%d", len(answer))
            return answer
        except Exception as e:
            logger.warning("Simplified FAISS RAG error: %s", e, exc_info=True)
            try:
                self.last_source = 'faiss-error'
            except Exception:
                pass
            return f"Internal error during wiki search: {e}"

    def rag_status(self) -> Dict[str, Any]:
        """Return diagnostic status for health endpoint."""
        idx_total = None
        idx_dim = None
        if getattr(self, 'index', None) is not None:
            try:
                idx_total = self.index.ntotal
                idx_dim = self.index.d
            except Exception:
                pass
        return {
            'index_path': self.index_path,
            'manifest_path': self.manifest_path,
            'manifest_present': bool(self.manifest),
            'embedding_model_configured': self.embedding_model,
            'index_total': idx_total,
            'docs_len': len(self.faiss_docs),
            'index_doc_mismatch': self.index_doc_mismatch or (idx_total is not None and idx_total != len(self.faiss_docs)),
            'index_dim': idx_dim,
            'manifest_dim': self.manifest.get('dimension'),
            'manifest_model': self.manifest.get('embedding_model'),
            'manifest_num_chunks': self.manifest.get('num_chunks'),
            'compatible': self.index_compatible,
        }

    def load_all_confluence_pages(self):
        """
        Fetch all pages from the configured Confluence space (optionally under a parent/ancestor page).
        Returns a list of LangChain Document objects for all pages.
        """
        if not (CONFLUENCE_API_URL and CONFLUENCE_API_TOKEN and CONFLUENCE_USER_EMAIL):
            logger.warning("Missing Confluence API configuration.")
            return []
        headers = {
            "Authorization": f"Basic {self._get_confluence_basic_token()}",
            "Content-Type": "application/json"
        }
        cql_parts = []
        space_key = os.getenv("CONFLUENCE_SPACE_KEY")
        page_id = os.getenv("CONFLUENCE_PAGE_ID")
        if space_key:
            cql_parts.append(f'space="{space_key}"')
        if page_id:
            cql_parts.append(f'(id={page_id} OR ancestor={page_id})')
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
                logger.info("Request URL: %s", resp.url)
                logger.info("Status Code: %s", resp.status_code)
                resp.raise_for_status()
                data = resp.json()
                results = data.get("results", [])
                for result in results:
                    title = result.get("title", "")
                    body = result.get("body", {}).get("storage", {}).get("value", "")
                    if body:
                        all_docs.append({"page_content": body, "metadata": {"title": title}})
                if len(results) < params["limit"]:
                    break
                start += params["limit"]
            except Exception as e:
                logger.error("Confluence API error: %s", e, exc_info=True)
                break
        return [Document(page_content=d["page_content"], metadata=d["metadata"]) for d in all_docs]

    def run_rag_over_all_pages(self, question):
        """
        Vectorize all Confluence pages and perform RAG over the entire set.
        """
        # This method previously depended on RetrievalQA and an undefined self.llm.
        # Provide a simplified implementation concatenating all pages as context.
        all_docs = self.load_all_confluence_pages()
        if not all_docs:
            return "No Confluence pages found to perform RAG."
        context = "\n\n".join([getattr(d, 'page_content', str(d)) for d in all_docs])
        prompt = f"You are a helpful assistant. Use the following context to answer the user's question.\n\nContext:\n{context}\n\nQuestion: {question}\nAnswer:"
        answer = self._chat_complete(prompt)
        return answer or "No answer generated from all-page context."

def perform_wiki_rag(question: str, correlation_context: Optional[str] = None, search_keywords: Optional[List[str]] = None):
    """Public entry point used by tools & orchestrator.
    
    Args:
        question: The wiki question/search query (may include clarification)
        correlation_context: Optional context from clarification workflow for answer correlation
        search_keywords: Optional specific keywords to emphasize in search
    
    Returns dict {"answer": <string>, "correlation_applied": <bool>}.
    """
    logger.info(
        "[WikiRAG] perform_wiki_rag invoked | question_preview='%s' | "
        "has_correlation=%s has_keywords=%s",
        (question or "").strip()[:80],
        bool(correlation_context),
        bool(search_keywords)
    )
    rag = CustomWikiRAG()
    try:
        if not question or not str(question).strip():
            logger.info("[WikiRAG] perform_wiki_rag returning validation_error | reason=empty-question")
            return WikiRAGResponse(answer="Please provide a non-empty question for wiki annotation.").dict()
        
        # Execute RAG search
        answer = rag.run_rag(question)
        
        if not answer or "No Confluence pages found" in answer:
            logger.info("[WikiRAG] perform_wiki_rag returning no_results | reason=no-answer")
            return WikiRAGResponse(answer="No relevant wiki content found. Please refine your question or check your Confluence configuration.").dict()
        
        # If correlation context provided, enhance answer with correlation
        correlation_applied = False
        if correlation_context:
            logger.info("[WikiRAG] Applying correlation context to answer")
            correlation_applied = True
            
            # Use LLM to correlate wiki findings back to original question
            correlation_prompt = f"""You are a helpful assistant. The user asked a question and provided clarification. 
I searched the Wiki documentation and found relevant information. Please synthesize this into a complete answer 
that addresses the original question while incorporating the clarification context.

{correlation_context}

Wiki Search Results:
{answer}

Instructions:
1. Address the original question directly
2. Incorporate context from the conversation (incidents, topics mentioned)
3. Highlight how the wiki documentation relates to the user's specific situation
4. If search keywords were provided, emphasize those aspects

Provide a complete, contextual answer:"""
            
            try:
                correlated_answer = rag._chat_complete(correlation_prompt)
                if correlated_answer and len(correlated_answer) > 50:  # Valid correlation
                    answer = correlated_answer
                    logger.info("[WikiRAG] Correlation applied successfully | answer_length=%d", len(answer))
                else:
                    logger.warning("[WikiRAG] Correlation failed, using raw answer")
                    correlation_applied = False
            except Exception as e:
                logger.error(f"[WikiRAG] Correlation error: {e}", exc_info=True)
                correlation_applied = False
        
        logger.info(
            "[WikiRAG] perform_wiki_rag returning answer | length=%d correlation=%s",
            len(answer or ""),
            correlation_applied
        )
        
        result = WikiRAGResponse(answer=answer).dict()
        result['correlation_applied'] = correlation_applied
        return result
        
    except Exception as e:
        logger.error(f"Wiki RAG error: {e}", exc_info=True)
        return WikiRAGResponse(answer=f"Wiki RAG failed: {e}").dict()
