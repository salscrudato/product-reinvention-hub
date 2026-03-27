import logging
from typing import Any, List

logger = logging.getLogger(__name__)

def chunk_text(text: str, max_tokens: int = 1500) -> List[str]:
    """
    Splits a long string into chunks of approximately max_tokens (words) each.
    Args:
        text (str): The input text to chunk.
        max_tokens (int): The maximum number of words per chunk.
    Returns:
        List[str]: List of text chunks.
    """
    words = text.split()
    chunks = []
    for i in range(0, len(words), max_tokens):
        chunk = ' '.join(words[i:i+max_tokens])
        chunks.append(chunk)
    logger.info(f"[ChunkingTool] Split text into {len(chunks)} chunks of up to {max_tokens} words each.")
    return chunks

def chunk_output(output: Any, max_tokens: int = 1500) -> List[str]:
    """
    Splits a tool output (str, dict, or list) into manageable chunks for LLM processing.
    Args:
        output (Any): The tool output to chunk.
        max_tokens (int): The maximum number of words per chunk.
    Returns:
        List[str]: List of output chunks as strings.
    """
    import json
    if isinstance(output, str):
        return chunk_text(output, max_tokens)
    elif isinstance(output, dict) or isinstance(output, list):
        text = json.dumps(output, default=str)
        return chunk_text(text, max_tokens)
    else:
        return [str(output)]
