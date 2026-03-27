import os
import json
import faiss
from tinydb import TinyDB

paths = [
    os.path.abspath(os.path.join(os.getcwd(), 'code_embeddings.index')),
    os.path.abspath(os.path.join(os.getcwd(), 'Embeddings_Lookup_cache.index')),
    os.path.abspath(os.path.join(os.getcwd(), 'backend', 'Embeddings_Lookup_cache.index')),
    os.path.abspath(os.path.join(os.getcwd(), 'backend', 'code_embeddings.index')),
]

print('Checking candidate FAISS index files:')
for p in paths:
    exists = os.path.exists(p)
    print(f"- {p}: {'FOUND' if exists else 'missing'}")
    if exists:
        try:
            idx = faiss.read_index(p)
            print(f"  - ntotal={idx.ntotal}")
        except Exception as e:
            print(f"  - Error loading FAISS index: {e}")

# TinyDB checks
candidates = [
    os.path.abspath(os.path.join(os.getcwd(), 'code_embeddings.json')),
    os.path.abspath(os.path.join(os.getcwd(), 'backend', 'code_embeddings.json')),
]
print('\nChecking TinyDB files:')
for c in candidates:
    if os.path.exists(c):
        try:
            db = TinyDB(c)
            n = len(db.all())
            print(f"- {c}: FOUND with {n} entries")
        except Exception as e:
            print(f"- {c}: Error opening TinyDB: {e}")
    else:
        print(f"- {c}: missing")

# Print ENV vars related to indices
print('\nEnvironment variables:')
for k in ['CODE_EMBEDDINGS_INDEX_PATH', 'EMBEDDINGS_INDEX_PATH', 'FAISS_INDEX_PATH']:
    print(f"- {k} = {os.getenv(k)}")

print('\nDiagnostic complete')
