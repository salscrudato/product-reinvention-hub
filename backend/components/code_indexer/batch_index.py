import os
from backend.components.code_indexer.file_utils import find_code_files
from backend.components.code_indexer.embedding_utils import load_or_create_faiss_index, save_faiss_index, get_or_create_db, embed_and_store


# Chunk code file by lines to avoid exceeding embedding model context limits
def split_code_file(file_path, max_lines=200, max_chars=8000):
    """
    Splits a code file into chunks of up to max_lines and max_chars.
    Returns a list of (symbol, code_chunk) tuples.
    """
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    chunks = []
    chunk = []
    chunk_char_count = 0
    chunk_idx = 0
    for line in lines:
        if len(chunk) >= max_lines or chunk_char_count + len(line) > max_chars:
            if chunk:
                symbol = f"{os.path.basename(file_path)}:chunk{chunk_idx}"
                chunks.append((symbol, ''.join(chunk)))
                chunk = []
                chunk_char_count = 0
                chunk_idx += 1
        chunk.append(line)
        chunk_char_count += len(line)
    if chunk:
        symbol = f"{os.path.basename(file_path)}:chunk{chunk_idx}"
        chunks.append((symbol, ''.join(chunk)))
    return chunks

def main(root_dir):
    code_files = find_code_files(root_dir)
    print(f"Found {len(code_files)} code files.")
    index = load_or_create_faiss_index()
    db = get_or_create_db()
    for file_path in code_files:
        for symbol, snippet in split_code_file(file_path):
            embed_and_store(snippet, file_path, symbol, index, db)
            print(f"Indexed: {file_path} [{symbol}]")
    save_faiss_index(index)
    print("Batch code indexing complete.")

if __name__ == "__main__":
    import sys
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
    main(root)
