import os
import re
import logging
from flask import Blueprint, request, jsonify
import numpy as np
from .embedding_utils import load_or_create_faiss_index, get_or_create_db
from ..vectorization_and_index_creation import generate_embeddings

logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[code_annotation_api] %(levelname)s: %(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

code_blueprint = Blueprint("code_annotation_api", __name__)

@code_blueprint.route('/code_annotation_query', methods=['POST'])
def code_annotation_query():
    """
    Accepts a question starting with @code, performs RAG over code vectors, and returns an answer.
    Request JSON: { "question": "@code How do I add a new endpoint?" }
    """
    data = request.get_json()
    question = data.get("question", "")
    if not question.lower().startswith("@code"):
        return jsonify({"error": "Question must start with @code annotation."}), 400
    query = question[len("@code"):].strip()
    if not query:
        return jsonify({"error": "No question provided after @code annotation."}), 400

    # Embed the question
    query_embedding = generate_embeddings([query])[0]
    query_embedding_np = np.array(query_embedding, dtype="float32").reshape(1, -1)

    # Load FAISS index and DB
    index = load_or_create_faiss_index()
    db = get_or_create_db()
    db_all = db.all()

    results = []
    try:
        # If index has no vectors, skip search
        ntotal = getattr(index, 'ntotal', None)
        logger.info(f"Loaded FAISS index, ntotal={ntotal}, db_entries={len(db_all)}")
        if ntotal and ntotal > 0:
            # Some FAISS python stubs may expect explicit named parameters or provide multiple overloads.
            # We defensively call search and fallback if signature differs.
            try:
                D, I = index.search(query_embedding_np, 5)  # type: ignore[attr-defined]
            except TypeError:
                # Attempt alternative signature (query, k)
                D, I = index.search(x=query_embedding_np, k=5)  # type: ignore[call-arg]
            for idx in I[0]:  # type: ignore[index]
                if idx < 0:
                    continue
                if idx < len(db_all):
                    entry = db_all[idx]
                    results.append({
                        "file_path": entry.get("file_path"),
                        "symbol": entry.get("symbol"),
                        "snippet": entry.get("snippet")
                    })
                else:
                    logger.warning(f"FAISS returned index {idx} but DB has only {len(db_all)} entries")
        else:
            logger.info("FAISS index is empty or not persisted; skipping vector search")
    except Exception as e:
        logger.exception(f"Error during FAISS search: {e}")

    # Compose context for LLM
    # If no vector results, attempt a filename fallback: pull file contents referenced in the query
    context_parts = []
    if results:
        for r in results:
            context_parts.append(f"File: {r['file_path']}\nSymbol: {r['symbol']}\nCode:\n{r['snippet']}")
    else:
        # Heuristic: look for filenames in the query (e.g., SnowChat.jsx)
        fname_matches = re.findall(r"\b[\w\-\.]+?\.(js|jsx|ts|tsx|py|java|go|cs)\b", query, flags=re.IGNORECASE)
        if fname_matches:
            # re.findall with groups returns only extensions; extract full matches instead
            full_matches = re.findall(r"\b[\w\-\.]+?\.(?:js|jsx|ts|tsx|py|java|go|cs)\b", query, flags=re.IGNORECASE)
            repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
            logger.info(f"No vector hits; attempting filename fallback for: {full_matches} under {repo_root}")
            for fname in full_matches:
                # walk repo to find matching file basenames
                for root, dirs, files in os.walk(repo_root):
                    if fname in files:
                        fp = os.path.join(root, fname)
                        try:
                            with open(fp, 'r', encoding='utf-8', errors='ignore') as fh:
                                content = fh.read()
                            snippet = content[:3000]
                            context_parts.append(f"File: {fp}\nSymbol: {fname}\nCode:\n{snippet}")
                            logger.info(f"Loaded fallback file content from {fp}")
                        except Exception as e:
                            logger.warning(f"Failed to read fallback file {fp}: {e}")
        else:
            logger.info("No filename heuristics found in query and no vector hits")

    context = "\n\n".join(context_parts)
    prompt = f"You are a code assistant. Given the following code context, answer the user's question.\n\nContext:\n{context}\n\nQuestion: {query}\n\nAnswer:"

    # Use LLM to answer
    import openai
    from os import getenv
    model_name = getenv("GPT_MODEL_NAME", "gpt-4")
    try:
        llm_response = openai.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": "You are a code assistant."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=800
        )
        answer = llm_response.choices[0].message.content
    except Exception as e:
        logger.exception(f"LLM call failed: {e}")
        answer = f"[LLM error: {str(e)}]"

    response = {
        "question": question,
        "context": context,
        "answer": answer
    }
    if not context_parts:
        response["note"] = "No relevant vector results found. Provide file content or re-run batch indexer to populate FAISS index (ensure the .index file is saved to the configured path)."
    return jsonify(response)
