import os
import json
import numpy as np
from dotenv import load_dotenv
from docx import Document
try:
    # Modern OpenAI client classes (Azure + public)
    from openai import OpenAI, AzureOpenAI  # type: ignore
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore
    AzureOpenAI = None  # type: ignore
import openai  # type: ignore  # legacy fallback
import faiss
from langsmith import trace
import logging
import sys

# Configure logging to file and console
log_formatter = logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s')
file_handler = logging.FileHandler('snowchat_backend.log', mode='a', encoding='utf-8')
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
console_handler.setLevel(logging.WARNING)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.hasHandlers():
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

# Function to read config values from the file
def read_config(config_file=r"C:\dev\cfg\config_values.txt"):
    config = {}
    try:
        with open(config_file, "r") as file:
            for line in file:
                key, value = line.strip().split("=")
                config[key.strip()] = value.strip()
    except FileNotFoundError:
        logger.warning(f"Configuration file '{config_file}' not found. Continuing with empty config.")
        return {}
    return config

# Load configuration
config = read_config()

# Load environment variables from .env file
load_dotenv()

# Set Azure OpenAI credentials from environment variables
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT") or ""
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY") or ""
OPENAI_API_VERSION = os.getenv("OPENAI_API_VERSION") or ""
AZURE_OPENAI_EMBEDDING_API_VERSION = os.getenv("AZURE_OPENAI_EMBEDDING_API_VERSION") or OPENAI_API_VERSION
GPT_MODEL_NAME = os.getenv("GPT_MODEL_NAME") or os.getenv("OPENAI_MODEL") or "gpt-4o-mini"
INDEX_NAME = os.getenv("INDEX_NAME")  # FAISS index name (unused but kept for compatibility)
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME") or "text-embedding-3-small"

# Unify embedding logic with embedding_utils for consistency across codebase
try:
    from .embedding_utils import generate_embeddings as _gen_embeds, get_effective_embedding_model  # type: ignore
    # Override EMBEDDING_MODEL_NAME with manifest if present
    manifest_model = get_effective_embedding_model()
    if manifest_model:
        EMBEDDING_MODEL_NAME = manifest_model
except Exception as _eu_err:  # pragma: no cover
    logger.warning(f"embedding_utils not available ({_eu_err}); falling back to direct OpenAI embedding path.")

def _get_client():
    """Return a configured OpenAI client for Azure or public usage. Falls back to legacy global API if unavailable.

    Azure pattern: AzureOpenAI(azure_endpoint=..., api_key=..., api_version=...)
    Public pattern: OpenAI(api_key=OPENAI_API_KEY)
    """
    public_key = os.getenv("OPENAI_API_KEY") or ""
    if not (OpenAI or AzureOpenAI):
        return None
    try:
        if AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY and AzureOpenAI:
            return AzureOpenAI(azure_endpoint=AZURE_OPENAI_ENDPOINT, api_key=AZURE_OPENAI_API_KEY, api_version=AZURE_OPENAI_EMBEDDING_API_VERSION or None)  # type: ignore
        if public_key:
            return OpenAI(api_key=public_key)  # type: ignore
    except Exception as e:  # pragma: no cover
        logger.warning(f"Failed to init OpenAI client: {e}")
    return None


def extract_text_from_docx(docx_path):
    """Extract text content from a Word document (.docx)."""
    doc = Document(docx_path)
    full_text = []
    for para in doc.paragraphs:
        full_text.append(para.text)
    return '\n'.join(full_text)

def generate_embeddings(texts):
    """Generate embeddings for texts using shared embedding_utils when possible.

    Falls back to direct client/legacy calls if embedding_utils not available. Guarantees non-None model string.
    """
    if not texts:
        return []
    # Prefer shared utility to ensure index compatibility
    try:
        return _gen_embeds(texts)  # type: ignore
    except Exception as e:
        logger.warning(f"Shared embedding utility failed ({e}); using direct path.")
    model = EMBEDDING_MODEL_NAME or "text-embedding-3-small"
    client = _get_client()
    # Try modern client first
    if client:
        try:
            resp = client.embeddings.create(model=model, input=texts)  # type: ignore
            return [d.embedding for d in resp.data]
        except Exception as e:
            msg = str(e)
            if "404" in msg and "Resource not found" in msg:
                logger.error(f"Azure embedding 404: deployment '{model}' not found. Ensure EMBEDDING_MODEL_NAME matches Azure deployment name.")
            else:
                logger.error(f"Client embedding error: {e}")
    # Legacy fallback
    try:
        if AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY:
            openai.api_type = "azure"  # type: ignore[attr-defined]
            openai.api_base = AZURE_OPENAI_ENDPOINT  # type: ignore[attr-defined]
            openai.api_key = AZURE_OPENAI_API_KEY  # type: ignore[attr-defined]
            if AZURE_OPENAI_EMBEDDING_API_VERSION:
                openai.api_version = AZURE_OPENAI_EMBEDDING_API_VERSION  # type: ignore[attr-defined]
        resp = openai.embeddings.create(model=model, input=texts)  # type: ignore[attr-defined]
        return [item.embedding for item in resp.data]
    except Exception as e:
        logger.error(f"Failed to generate embeddings (legacy path): {e}")
        raise RuntimeError(f"OpenAI embedding error: {e}")

def create_faiss_index_for_documents(product, state, folder_path):
    """
    Vectorize documents in a folder, summarize content by paragraphs, and store them in a FAISS index
    for the product-state combination.
    """
    index_name = f"{product}-{state}"
    updated_folder_path = os.path.join(folder_path, state, product)

    # Read and vectorize documents
    documents = []
    metadata = []  # To store metadata for each document
    for file_name in os.listdir(updated_folder_path):
        if file_name.endswith(".docx"):
            file_path = os.path.join(updated_folder_path, file_name)
            text = extract_text_from_docx(file_path)

            # Split the document into paragraphs
            paragraphs = text.split("\n\n")  # Assuming paragraphs are separated by double newlines
            summarized_paragraphs = []

            # Summarize each paragraph
            for paragraph in paragraphs:
                if paragraph.strip():  # Skip empty paragraphs
                    summarized_paragraph = summarize_paragraph(paragraph)
                    summarized_paragraphs.append(summarized_paragraph)

            # Combine summarized paragraphs into a single summarized document
            summarized_text = "\n\n".join(summarized_paragraphs)

            # Add the summarized text to the documents list
            documents.append(summarized_text)

            # Update metadata with summarized content
            metadata.append({
                "file_name": file_name,
                "file_path": file_path,
                "original_paragraphs": len(paragraphs),
                "summarized_paragraphs": len(summarized_paragraphs),
                "summary": summarized_text[:500]  # Include the first 500 characters as a summary
            })

    # Create embeddings for the summarized documents using Azure OpenAI Embeddings
    embeddings = generate_embeddings(documents)  # Use your generate_embeddings function

    # Convert vectors to numpy array (required by FAISS)
    vectors_np = np.array(embeddings).astype(np.float32)

    # Create a FAISS index
    index = faiss.IndexFlatL2(vectors_np.shape[1])  # L2 distance index
    index.add(vectors_np)  # type: ignore[arg-type]  # Add the vectors to the index (FAISS expects contiguous float32)

    # Store the index and metadata for future retrieval
    faiss_indices = {
        "index": index,
        "metadata": metadata  # Store metadata here
    }

    logger.info(f"FAISS index for {product}-{state} created successfully.")
    return faiss_indices


def summarize_paragraph(paragraph: str) -> str:
    """Summarize a paragraph using chat completion API (modern). Falls back to returning original text on error.

    We avoid deprecated Completion API to satisfy Pylance and SDK evolution.
    """
    if not paragraph.strip():
        return paragraph
    client = _get_client()
    model = GPT_MODEL_NAME
    messages = [
        {"role": "system", "content": "You are a concise summarization assistant."},
        {"role": "user", "content": f"Summarize the following paragraph in <= 3 sentences:\n\n{paragraph}"}
    ]
    try:
        if client:
            resp = client.chat.completions.create(model=model, messages=messages)  # type: ignore
            return (resp.choices[0].message.content or paragraph).strip()
        # Legacy fallback
        # openai.ChatCompletion may exist for older sdk; guard with try
        try:  # pragma: no cover
            resp = openai.ChatCompletion.create(model=model, messages=messages)  # type: ignore[attr-defined]
            return (resp['choices'][0]['message']['content'] or paragraph).strip()
        except Exception:
            return paragraph
    except Exception as e:
        logger.error(f"Error summarizing paragraph: {e}")
        return paragraph


def save_faiss_index(faiss_index, updated_folder_path, metadata):
    """Save the FAISS index and metadata to files."""
    try:
        # Ensure that the folder path exists
        os.makedirs(os.path.dirname(updated_folder_path), exist_ok=True)

        # Check if faiss_index is a valid faiss.Index object
        if isinstance(faiss_index, faiss.Index):
            # Use FAISS's write_index function to save the index to a file
            faiss.write_index(faiss_index, updated_folder_path)
            logger.info(f"FAISS index saved to {updated_folder_path}")
        else:
            raise ValueError("The provided faiss_index is not a valid faiss.Index object.")

        # Save the metadata to a JSON file
        metadata_file_path = updated_folder_path.replace(".index", "_metadata.json")
        with open(metadata_file_path, "w") as metadata_file:
            json.dump(metadata, metadata_file, indent=4)
        logger.info(f"Metadata saved to {metadata_file_path}")

    except Exception as e:
        logger.error(f"An error occurred while saving the FAISS index or metadata: {e}")


def search_faiss_index(folder_path, product, state, query):
    """Search the FAISS index for relevant documents."""
    try:
        # Construct the FAISS index file path
        index_path = f"{folder_path}/{product}-{state}.index"
        index_path = os.path.normpath(index_path)
        # Load the FAISS index
        index = faiss.read_index(index_path)
        logger.info(f"FAISS index loaded successfully from {index_path}")
    except Exception as e:
        logger.error(f"Error loading FAISS index: {e}")
        return None, None

    # Generate the embedding for the query
    try:
        query_embedding = generate_embeddings([query])[0]  # Generate embedding for the query
        query_vector = np.array(query_embedding).astype(np.float32).reshape(1, -1)  # Reshape for FAISS
    except Exception as e:
        logger.error(f"Error generating embedding for the query: {e}")
        return None, None

    # Perform the search on the FAISS index
    try:
        distances, indices = index.search(query_vector, 3)  # Retrieve top 3 results
        logger.info(f"Search completed. Distances: {distances}, Indices: {indices}")
        return distances, indices
    except Exception as e:
        logger.error(f"Error during FAISS search: {e}")
        return None, None



##def load_faiss_index(file_path="faiss_indices.json"):
##    """Load FAISS indices from a file."""
##    with open(file_path, "r") as f:
##        faiss_indices = json.load(f)
##    return faiss_indices

# Example usage
def main():
    folder_path = config.get("folder_path")
    product = config.get("product")
    state = config.get("state")
    
    # Create the FAISS index for the product-state combination by reading documents from the folder
    #faiss_indices = create_faiss_index_for_documents(product, state, folder_path)
    
    # Construct the file path for saving the index (e.g., "C:/dev/gt/docs/NJ/Auto/Auto-NJ.index")
    #updated_folder_path = os.path.normpath(os.path.join(folder_path, state, product, f"{product}-{state}.index"))
    
    # Save the FAISS index and metadata to files
    #save_faiss_index(
       # faiss_indices["index"],
       # updated_folder_path,
       # faiss_indices["metadata"]
    #)

if __name__ == "__main__":
    main()
