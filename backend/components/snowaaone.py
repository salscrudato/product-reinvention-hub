def find_incidents_by_short_description(short_description):
    """
    Fetch incidents from ServiceNow filtered by short_description (case-insensitive substring match).
    Returns a list of matching incidents or an error dict.
    """
    if not short_description:
        return {"error": "short_description is required"}
    # ServiceNow query: use sysparm_query for LIKE search
    # Example: short_descriptionLIKE<substring>
    url = f"{servicenow_instance}/api/now/table/incident?sysparm_limit=20&sysparm_query=short_descriptionLIKE{short_description}&sysparm_display_value=true"
    headers = {"Accept": "application/json"}
    try:
        response = requests.get(url, auth=(servicenow_user, servicenow_password), headers=headers)
        response.raise_for_status()
        result = response.json()
        return {"incidents": result.get("result", [])}
    except requests.exceptions.RequestException as e:
        return {"error": f"Failed to fetch incidents by short_description: {str(e)}"}
import os
import json
import logging
import sys
from typing import List, Dict, Optional, Any, Sequence, cast

import requests
import numpy as np
import faiss
from flask import request, jsonify, Blueprint
from dotenv import load_dotenv
from pydantic import BaseModel
"""LangChain Tool import modernization

Order of preference (newest first):
1. langchain_core.tools.Tool (1.x core unified interface)
2. langchain_community.tools.Tool (split community package)
3. langchain.tools.Tool (legacy pre-1.x)
4. langchain.agents.Tool (older agents surface) as last resort
5. Minimal stub if none available (keeps runtime resilient; Pylance will still know symbol)

This layered approach prevents breaking when upgrading LangChain while keeping
backwards compatibility for existing tool construction code.
"""
try:
    from langchain_core.tools import Tool  # type: ignore
except Exception:  # pragma: no cover
    try:
        from langchain_community.tools import Tool  # type: ignore
    except Exception:
        try:
            from langchain.tools import Tool  # type: ignore
        except Exception:
            try:
                from langchain.agents import Tool  # type: ignore
            except Exception:
                class Tool:  # type: ignore
                    def __init__(self, *a, **k): pass

from .vectorization_and_index_creation import search_faiss_index, generate_embeddings, extract_text_from_docx
from .langgraph_flow import process_question_with_prompt_and_metadata, process_question_with_metadata_only, process_question_basic
from .shared_registry import FUNCTION_REGISTRY

# Load environment variables
load_dotenv()

# --------------------------------------------
# OpenAI / Azure OpenAI client initialization
# --------------------------------------------
# The modern OpenAI SDK (>=1.x) prefers client objects instead of setting
# module-level attributes like `openai.api_base` which triggers Pylance errors.
# We create a client if credentials are present; otherwise downstream embedding
# helpers (generate_embeddings) will use their own fallback logic.
AZURE_OPENAI_ENDPOINT: str = os.getenv("AZURE_OPENAI_ENDPOINT", "")
AZURE_OPENAI_API_KEY: str = os.getenv("AZURE_OPENAI_API_KEY", "")
OPENAI_API_VERSION: str = os.getenv("OPENAI_API_VERSION", "")
GPT_MODEL_NAME: str = os.getenv("GPT_MODEL_NAME", "text-embedding-3-large")
openai_client = None  # type: ignore
try:  # pragma: no cover - best effort; embedding code uses its own logic
    if AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY:
        from openai import AzureOpenAI  # type: ignore
        openai_client = AzureOpenAI(
            api_key=AZURE_OPENAI_API_KEY,
            azure_endpoint=AZURE_OPENAI_ENDPOINT,
            api_version=OPENAI_API_VERSION or "2024-02-01"
        )
    else:
        from openai import OpenAI  # type: ignore
        std_key = os.getenv("OPENAI_API_KEY", "")
        if std_key:
            openai_client = OpenAI(api_key=std_key)
except Exception as _openai_init_err:  # pragma: no cover
    # We do not raise here; downstream code will still work with generate_embeddings fallbacks.
    print(f"[snowaaone] OpenAI client init skipped: {_openai_init_err}")

# ServiceNow configuration
servicenow_instance: str = os.getenv("SERVICENOW_INSTANCE", "")
servicenow_user: str = os.getenv("SERVICENOW_USER", "")
servicenow_password: str = os.getenv("SERVICENOW_PASSWORD", "")

TOP_MATCHING_INCIDENTS = int(os.getenv("TOP_MATCHING_INCIDENTS", 10))  # Default to 10 if not set

# FAISS index for caching embeddings
EMBEDDINGS_INDEX_PATH: str = os.getenv("EMBEDDINGS_INDEX_PATH", "embeddings.index")



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

# Define the blueprint
blueprint = Blueprint("snowaaone", __name__)

# Modern Pydantic schemas for tool inputs/outputs
class EmptyInputSchema(BaseModel):
    pass

class IncidentNumberInputSchema(BaseModel):
    incident_number: str

class IncidentsOutputSchema(BaseModel):
    incidents: List[Dict]

class SimilarIncidentInputSchema(BaseModel):
    short_description: Optional[str] = None
    incident_number: Optional[str] = None

class SimilarIncidentsOutputSchema(BaseModel):
    similar_incidents: List[Dict]

class IncidentOutputSchema(BaseModel):
    incident: Optional[Dict] = None
    error: Optional[str] = None
    details: Optional[Dict] = None

# Enhanced decorator to register a function with metadata in the registry
# Usage:
# @register_function(name="fetch_all_incidents", description="...", input_schema={}, output_schema={})
def register_function(name, description=None, input_schema=None, output_schema=None):
    """Decorator to register a function in the registry with metadata."""
    def decorator(func):
        FUNCTION_REGISTRY[name] = {
            "function": func,
            "description": description or func.__doc__,
            "input_schema": input_schema or {},
            "output_schema": output_schema or {},
        }
        return func
    return decorator


# Example: Register a function
@register_function(
    name="my_fetch_all_incidents",
    description="This functions fetches all incidents from the ServiceNow instance. It is intended to be used when you want to retrieve all incidents without any specific filtering.",
    input_schema={},
    output_schema={"incidents": list}
)
def my_fetch_all_incidents() -> Dict[str, Any]:
    """Fetch all incidents from the ServiceNow instance. This should be used only when you intend to 
    get all the incidents without any specific filtering."""
    url = f"{servicenow_instance}/api/now/table/incident?sysparm_limit=100"  # Adjust limit as needed
    headers = {"Accept": "application/json"}

    if not (servicenow_instance and servicenow_user and servicenow_password):
        return {"error": "ServiceNow credentials are not fully configured."}
    try:
        response = requests.get(url, auth=(servicenow_user, servicenow_password), headers=headers)  # type: ignore[arg-type]
        response.raise_for_status()
        result = response.json()
        return {"incidents": result.get("result", [])}
    except requests.exceptions.RequestException as e:
        return {"error": f"Failed to fetch incidents: {str(e)}"}



# Utility functions
def load_or_create_faiss_index() -> faiss.Index:
    """Load the FAISS index from file or create a new one if it doesn't exist."""
    if EMBEDDINGS_INDEX_PATH and os.path.exists(EMBEDDINGS_INDEX_PATH):
        index = faiss.read_index(EMBEDDINGS_INDEX_PATH)
        print(f"FAISS index loaded from {EMBEDDINGS_INDEX_PATH}")
    else:
        index = faiss.IndexFlatL2(1536)  # Assuming 1536-dimensional embeddings
        print(f"New FAISS index created at {EMBEDDINGS_INDEX_PATH}")
    return index


def save_faiss_index(index: faiss.Index) -> None:
    """Save the FAISS index to a file."""
    faiss.write_index(index, EMBEDDINGS_INDEX_PATH)
    print(f"FAISS index saved to {EMBEDDINGS_INDEX_PATH}")


def get_or_create_embedding(text: str, index: faiss.Index) -> List[float]:
    """
    Check if the embedding for the given text exists in the FAISS index.
    If not, generate the embedding using OpenAI and add it to the index.
    """
    # Generate the embedding for the input text
    query_vector = generate_embeddings([text])[0]
    query_vector_np = np.array(query_vector, dtype="float32").reshape(1, -1)

    # Search the FAISS index for the text embedding
    # Some FAISS stubs expect extra optional parameters; runtime signature returns (distances, indices)
    distances, indices = index.search(query_vector_np, 1)  # type: ignore[call-arg]
    if distances[0][0] < 0.01:  # Threshold for exact match (adjust as needed)
        print(f"Embedding found in FAISS index for text: {text}")
        return query_vector  # Return the existing embedding

    # If not found, add the new embedding to the FAISS index
    print(f"Embedding not found in FAISS index. Generating new embedding for text: {text}")
    index.add(query_vector_np)  # type: ignore[call-arg]
    save_faiss_index(index)  # Save the updated index
    return query_vector


def cosine_similarity(vector1: Sequence[float], vector2: Sequence[float]) -> float:
    """Calculate cosine similarity between two numeric sequences."""
    v1 = np.asarray(vector1, dtype="float32")
    v2 = np.asarray(vector2, dtype="float32")
    denom = (np.linalg.norm(v1) * np.linalg.norm(v2))
    if denom == 0:
        return 0.0
    return float(np.dot(v1, v2) / denom)


# Example API functions
@register_function(
    name="get_similar_incidents",
    description=(
        "Finds similar incidents based on a provided short description or incident number. "
        "If a short description is provided, this function will directly search for similar incidents using that description. "
        "If an incident number is provided, it will first fetch the incident to get its short description, then search for similar incidents. "
        "You do NOT need to call fetch_servicenow_incident separately—this function handles both cases internally. "
        "Use this function alone for similarity search."
    ),
    input_schema={"short_description": (str, "optional"), "incident_number": (str, "optional")},
    output_schema={"similar_incidents": list}
)
def get_similar_incidents(short_description: Optional[str] = None, incident_number: Optional[str] = None) -> Dict[str, Any]:
    """
    Find similar incidents based on short description or incident number.
    This function fetches all incidents internally and performs similarity search.
    **You do NOT need to call fetch_all_incidents separately.**
    Use this function alone for similarity search.
    """
    if not short_description and not incident_number:
        return {"error": "Either 'short_description' or 'incident_number' must be provided."}

    # Fetch the incident if incident_number is provided
    if incident_number:
        incident_data = fetch_servicenow_incident(incident_number)
        if not incident_data or "error" in incident_data:
            return {"error": "Failed to fetch the ServiceNow incident.", "details": incident_data}
        short_description = incident_data.get("short_description", "")
        if not short_description:
            return {"error": "No short description found for the provided incident number."}

    # Fetch all incidents
    all_incidents_response = my_fetch_all_incidents()
    if "error" in all_incidents_response:
        return all_incidents_response
    # Cast for type checker clarity: incidents should be list of dicts
    raw_incidents = all_incidents_response.get("incidents", [])
    all_incidents: List[Dict[str, Any]] = [i for i in raw_incidents if isinstance(i, dict)]

    # Load or create the FAISS index
    faiss_index = load_or_create_faiss_index()

    # Vectorize all incidents and the input short description
    incident_vectors = []
    for incident in all_incidents:
        inc_short_desc = incident.get("short_description", "")  # type: ignore[assignment]
        if inc_short_desc:
            vector = get_or_create_embedding(inc_short_desc, faiss_index)
            incident_vectors.append((incident, vector))

    # Use the original input for the query embedding!
    # short_description guaranteed non-None at this point; cast for type checker
    input_vector = get_or_create_embedding(cast(str, short_description), faiss_index)

    # Perform similarity search
    similar_incidents = []
    for incident, vector in incident_vectors:
        similarity_score = cosine_similarity(input_vector, vector)
        if similarity_score > 0.8:
            similar_incidents.append({
                "number": incident.get("number"),
                "short_description": incident.get("short_description"),
                "u_assigned_to": incident.get("u_assigned_to"),
                "sys_id": incident.get("sys_id"),
                "similarity_score": similarity_score
            })

    # Limit results to top 5 incidents
    similar_incidents = sorted(similar_incidents, key=lambda x: x["similarity_score"], reverse=True)[:5]

    return {"similar_incidents": similar_incidents}


@register_function(
    name="fetch_servicenow_incident",
    description="Based on the Incident Number provided in the input, this function tries to look up ServiceNow using provided Incident Number and return this ONE incident details. REQUIRED PARAMETER: incident_number (str) - the ServiceNow incident number (e.g., 'INC0010001'). This function is useful when you want to retrieve a specific incident details from ServiceNow. If the incident is not found, it returns None. In case of an error, it logs the details and provides more information in the error response.",
    input_schema={"incident_number": str},
    output_schema={"incident": dict}
)
def fetch_servicenow_incident(incident_number: str) -> Any:
    """
    Fetch a ServiceNow incident by its number.
    
    Args:
        incident_number (str): The ServiceNow incident number (e.g., 'INC0010001')

    This function connects to the ServiceNow instance provided in the URL and retrieves
    the incident details for the given incident number. In case of an error, it logs the
    details and provides more information in the error response. If no data is found, it returns None.
    """
    url = f"{servicenow_instance}/api/now/table/incident?sysparm_limit=1&number={incident_number}&sysparm_display_value=true"
    headers = {"Accept": "application/json"}
    if not (servicenow_instance and servicenow_user and servicenow_password):
        return {"error": "ServiceNow credentials are not fully configured."}
    try:
        response = requests.get(url, auth=(servicenow_user, servicenow_password), headers=headers)  # type: ignore[arg-type]
        response.raise_for_status()
        result = response.json()
        if result.get("result"):
            return result["result"][0]
        return None
    except requests.exceptions.HTTPError as http_err:
        error_message = f"HTTP error occurred while fetching ServiceNow incident: {http_err} - URL: {url}"
        print(error_message)
        return {"error": error_message}
    except requests.exceptions.ConnectionError as conn_err:
        error_message = f"Connection error occurred while connecting to ServiceNow: {conn_err} - URL: {url}"
        print(error_message)
        return {"error": error_message}
    except requests.exceptions.Timeout as timeout_err:
        error_message = f"Timeout error occurred while fetching ServiceNow incident: {timeout_err} - URL: {url}"
        print(error_message)
        return {"error": error_message}
    except requests.exceptions.RequestException as req_err:
        error_message = f"An error occurred while fetching ServiceNow incident: {req_err} - URL: {url}"
        print(error_message)
        return {"error": error_message}




# Function calling API
@blueprint.route('/call_function', methods=['POST'])
def call_function():
    """
    API endpoint to call a registered function dynamically.
    """
    try:
        data = request.json
        function_name = data.get("function_name")
        arguments = data.get("arguments", {})

        if not function_name or function_name not in FUNCTION_REGISTRY:
            return jsonify({"error": f"Function '{function_name}' is not registered."}), 400

        # Call the registered function with the provided arguments
        result = FUNCTION_REGISTRY[function_name](**arguments)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500


@blueprint.route('/mcp', methods=['POST'])
def mcp():
    """
    Model Context Protocol (MCP) endpoint to process context and questions dynamically.

    This endpoint takes a user question, a prompt, and metadata (incident details)
    and uses an autonomous agent to determine the functions to execute, their sequence,
    and chaining outputs to solve the user's query.
    """
    try:
        data = request.json
        question = data.get("question", "")
        prompt = data.get("prompt", "")
        metadata = data.get("metadata", {})

        if not question:
            return jsonify({"error": "Question is required."}), 400

        # Log the inputs for debugging
        print(f"Question: {question}")
        print(f"Prompt: {prompt}")
        print(f"Metadata: {metadata}")

         # Call the appropriate process_question function
        if prompt and metadata:
            final_state = process_question_with_prompt_and_metadata(question, prompt, metadata)
        elif metadata:
            final_state = process_question_with_metadata_only(question, metadata)
        else:
            final_state = process_question_basic(question)

        # Return the final state as the response
        return jsonify(final_state)
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500


@blueprint.route('/mcp', methods=['OPTIONS'])
def mcp_options():
    """
    Handle preflight OPTIONS request for /mcp.
    """
    return jsonify({"message": "Preflight request successful"}), 200


@blueprint.route('/test', methods=['GET'])
def test():
    return jsonify({"message": "CORS is working!"})

# Modern tool definitions
my_fetch_all_incidents_tool = Tool(
    name="my_fetch_all_incidents",
    func=my_fetch_all_incidents,
    description="Fetch all incidents from the ServiceNow instance. Use for retrieving all incidents without filtering.",
    args_schema=EmptyInputSchema,
    return_schema=IncidentsOutputSchema
)

get_similar_incidents_tool = Tool(
    name="get_similar_incidents",
    func=get_similar_incidents,
    description="Find similar incidents based on a provided short description or incident number. Handles both cases internally.",
    args_schema=SimilarIncidentInputSchema,
    return_schema=SimilarIncidentsOutputSchema
)

fetch_servicenow_incident_tool = Tool(
    name="fetch_servicenow_incident",
    func=fetch_servicenow_incident,
    description="Fetch a ServiceNow incident by its number. Returns details or error if not found.",
    args_schema=IncidentNumberInputSchema,
    return_schema=IncidentOutputSchema
)


