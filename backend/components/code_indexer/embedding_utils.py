import os
import json
from ..vectorization_and_index_creation import generate_embeddings
import numpy as np
import faiss
from tinydb import TinyDB, Query


# Resolve repository root (three levels up from this file)
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_THIS_DIR, "..", "..", ".."))

# Environment / fallback candidates for index and DB paths
# Try these env vars in order and then sensible file locations under repo root
_index_env_candidates = [
    os.getenv("CODE_EMBEDDINGS_INDEX_PATH"),
    os.getenv("EMBEDDINGS_INDEX_PATH"),
    os.getenv("FAISS_INDEX_PATH"),
]

_db_env_candidates = [
    os.getenv("CODE_EMBEDDINGS_DB_PATH"),
    os.getenv("EMBEDDINGS_DB_PATH"),
]


def _choose_existing_path(candidates, default_names):
    """Return the first existing path from candidates or constructed defaults.

    candidates: list of possibly-None path strings (env vars first)
    default_names: list of filenames to try under repo root
    """
    for c in candidates:
        if c:
            # if relative, make absolute relative to repo root
            p = c if os.path.isabs(c) else os.path.abspath(os.path.join(_REPO_ROOT, c))
            if os.path.exists(p):
                return p
            # if env var provided but missing, still return absolute path (we'll create later)
            return p

    # Try defaults under repo root
    for name in default_names:
        p = os.path.abspath(os.path.join(_REPO_ROOT, name))
        if os.path.exists(p):
            return p

    # If none exist, return first default under repo root (path to create)
    return os.path.abspath(os.path.join(_REPO_ROOT, default_names[0]))


# Determine final paths
EMBEDDINGS_INDEX_PATH = _choose_existing_path(_index_env_candidates, ["code_embeddings.index", "Embeddings_Lookup_cache.index"])
EMBEDDINGS_DB_PATH = _choose_existing_path(_db_env_candidates, ["code_embeddings.json"]) 


def load_or_create_faiss_index(dim=1536):
    # Ensure parent folder exists for potential writes
    try:
        os.makedirs(os.path.dirname(EMBEDDINGS_INDEX_PATH), exist_ok=True)
    except Exception:
        pass

    if os.path.exists(EMBEDDINGS_INDEX_PATH):
        try:
            index = faiss.read_index(EMBEDDINGS_INDEX_PATH)
        except Exception:
            # fallback to a new empty index if read fails
            index = faiss.IndexFlatL2(dim)
    else:
        index = faiss.IndexFlatL2(dim)
    return index


def save_faiss_index(index):
    # Ensure parent folder exists
    try:
        os.makedirs(os.path.dirname(EMBEDDINGS_INDEX_PATH), exist_ok=True)
    except Exception:
        pass
    faiss.write_index(index, EMBEDDINGS_INDEX_PATH)


def get_or_create_db():
    # Make sure the DB path is absolute and parent exists
    try:
        os.makedirs(os.path.dirname(EMBEDDINGS_DB_PATH), exist_ok=True)
    except Exception:
        pass
    return TinyDB(EMBEDDINGS_DB_PATH)


def embed_and_store(snippet, file_path, symbol, index, db):
    """
    Only generate and store embedding if file_path+symbol is new or file has changed (by mtime).
    """
    # Get last modified time of the file
    try:
        last_modified = os.path.getmtime(file_path)
    except Exception:
        last_modified = None

    # Check if this file_path+symbol+last_modified is already in DB
    Entry = Query()
    existing = db.get((Entry.file_path == file_path) & (Entry.symbol == symbol) & (Entry.last_modified == last_modified))
    if existing:
        # Already embedded and up to date, add to index if not present
        embedding = existing["embedding"]
        embedding_np = np.array(embedding, dtype="float32").reshape(1, -1)
        index.add(embedding_np)
        return embedding

    # Remove any old entries for this file_path+symbol (stale mtime)
    db.remove((Entry.file_path == file_path) & (Entry.symbol == symbol))

    # Generate embedding and store
    embedding = generate_embeddings([snippet])[0]
    embedding_np = np.array(embedding, dtype="float32").reshape(1, -1)
    index.add(embedding_np)
    db.insert({
        "file_path": file_path,
        "symbol": symbol,
        "snippet": snippet,
        "embedding": embedding,
        "last_modified": last_modified
    })
    return embedding
