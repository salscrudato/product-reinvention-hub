import requests
import os

def perform_code_rag(question):
    """
    Calls the local /code_annotation_query endpoint for code RAG.
    """
    backend_url = os.getenv("BACKEND_URL", "http://localhost:5000")
    url = f"{backend_url}/code_annotation_query"
    resp = requests.post(url, json={"question": question})
    resp.raise_for_status()
    data = resp.json()
    return data.get("answer", "[No answer returned]")
