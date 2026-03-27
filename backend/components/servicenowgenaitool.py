import os
import json
import openai
import requests
import numpy as np
import faiss
from flask import request, jsonify, Blueprint
from dotenv import load_dotenv
from typing import Dict, Any, List, Optional
from .vectorization_and_index_creation import search_faiss_index, generate_embeddings, extract_text_from_docx
from langsmith import trace  # type: ignore
from tinydb import TinyDB, Query
import logging
import sys
from datetime import datetime, timedelta
import pytz
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
import re


# Load environment variables
load_dotenv()

# Set Azure OpenAI credentials from environment variables
openai.api_base = os.getenv("AZURE_OPENAI_ENDPOINT")  # type: ignore[attr-defined]
openai.api_key = os.getenv("AZURE_OPENAI_API_KEY")  # type: ignore[attr-defined]
openai.api_version = os.getenv("OPENAI_API_VERSION")  # type: ignore[attr-defined]
GPT_MODEL_NAME = os.getenv("GPT_MODEL_NAME") or "gpt-4"

# ServiceNow configuration
servicenow_instance = os.getenv("SERVICENOW_INSTANCE")
servicenow_user = os.getenv("SERVICENOW_USER")
servicenow_password = os.getenv("SERVICENOW_PASSWORD")

TOP_MATCHING_INCIDENTS = int(os.getenv("TOP_MATCHING_INCIDENTS", 10))  # Default to 10 if not set

# Similarity threshold for incident matching (default 0.85 = 85% similarity)
# Lower values (0.8) include more but less relevant results
# Higher values (0.9) are more strict but more relevant
SIMILARITY_THRESHOLD = float(os.getenv('INCIDENT_SIMILARITY_THRESHOLD', '0.85'))

# FAISS index for caching embeddings
EMBEDDINGS_INDEX_PATH = os.getenv("EMBEDDINGS_INDEX_PATH") or "embeddings_cache.index"

# Splunk configuration
SPLUNK_HOST = os.getenv("SPLUNK_HOST")  # e.g., "https://splunk-instance:8089"
SPLUNK_USERNAME = os.getenv("SPLUNK_USERNAME")
SPLUNK_PASSWORD = os.getenv("SPLUNK_PASSWORD")

# Initialize Flask app
#app = Flask(__name__)
#CORS(app, resources={r"/*": {"origins": "http://localhost:3000"}})  # Enable CORS for specific origins

# Define the blueprint
blueprint = Blueprint("servicenowgenaitool", __name__)

# Initialize TinyDB for embedding cache using singleton for performance
from .db_singleton import get_embedding_db
embedding_db = get_embedding_db()
embedding_table = embedding_db.table("embeddings")


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

def _sn_auth():
    """Return (user, password) only if both are set; else None for anonymous requests."""
    if servicenow_user and servicenow_password:
        return (servicenow_user, servicenow_password)  # type: ignore[return-value]
    return None

def load_or_create_faiss_index():
    """Load the FAISS index from file or create a new one if it doesn't exist."""
    if EMBEDDINGS_INDEX_PATH and os.path.exists(EMBEDDINGS_INDEX_PATH):
        index = faiss.read_index(EMBEDDINGS_INDEX_PATH)
        print(f"FAISS index loaded from {EMBEDDINGS_INDEX_PATH}")
    else:
        index = faiss.IndexFlatL2(1536)  # Assuming 1536-dimensional embeddings
        print(f"New FAISS index created at {EMBEDDINGS_INDEX_PATH}")
    return index

def save_faiss_index(index):
    """Save the FAISS index to a file (best-effort)."""
    if not EMBEDDINGS_INDEX_PATH:
        return
    try:
        faiss.write_index(index, EMBEDDINGS_INDEX_PATH)
        print(f"FAISS index saved to {EMBEDDINGS_INDEX_PATH}")
    except Exception as e:  # pragma: no cover
        print(f"Failed to save FAISS index: {e}")

def get_or_create_embedding(text, index):
    """
    Check if the embedding for the given text exists in the FAISS index.
    If not, generate the embedding using OpenAI and add it to the index.
    """
    # Convert the text to a vector for searching
    query_vector = generate_embeddings([text])[0]
    query_vector_np = np.array(query_vector, dtype="float32").reshape(1, -1)

    # Search the FAISS index for the text embedding
    distances, indices = index.search(query_vector_np, 1)  # Top 1 match
    if distances[0][0] < 0.01:  # Threshold for exact match (adjust as needed)
        print(f"Embedding found in FAISS index for text: {text}")
        return query_vector  # Return the existing embedding

    # If not found, generate a new embedding
    print(f"Embedding not found in FAISS index. Generating new embedding for text: {text}")
    new_embedding = generate_embeddings([text])[0]
    new_embedding_np = np.array(new_embedding, dtype="float32").reshape(1, -1)

    # Add the new embedding to the FAISS index
    index.add(new_embedding_np)
    save_faiss_index(index)  # Save the updated index
    return new_embedding


def get_field_from_question(user_question, metadata_fields):
    """
    Map a user's natural language question to the most relevant field name using semantic similarity.
    """
    question_embedding = generate_embeddings([user_question])[0]
    best_score = -1
    best_field = None
    for field in metadata_fields:
        desc = field.get('description', '')
        if not desc:
            continue
        desc_embedding = generate_embeddings([desc])[0]
        score = cosine_similarity(np.array(question_embedding), np.array(desc_embedding))
        if score > best_score:
            best_score = score
            best_field = field.get('name')
    return best_field

@blueprint.route('/fetch_servicenow_incident_genai', methods=['GET'])
def fetch_servicenow_incident_genai():
    """Fetch an incident and either map a user question to a field or format with LLM.

    Query params:
      incident_number (required)
      user_question (optional)
      formatting_context (optional)
    """
    incident_number = request.args.get('incident_number')
    if not incident_number:
        return jsonify({"error": "incident_number is required"}), 400
    user_question = request.args.get('user_question')
    formatting_context = request.args.get('formatting_context')
    url = f"{servicenow_instance}/api/now/table/incident?sysparm_limit=1&number={incident_number}"
    headers = {"Accept": "application/json"}
    try:
        response = requests.get(url, auth=_sn_auth(), headers=headers)
        response.raise_for_status()
        result = response.json()
        if not result.get("result"):
            return jsonify({"error": "No incident found for the provided incident number."}), 404
        raw_incident = result["result"][0]
        if user_question:
            metadata_url = f"{servicenow_instance}/api/sn_table_builder/app/tableSchemaData/incident"
            metadata_response = requests.get(metadata_url, auth=_sn_auth(), headers=headers)
            metadata_response.raise_for_status()
            metadata = metadata_response.json()
            fields = metadata.get('result', {}).get('columns', []) or metadata.get('fields', []) or []
            field_name = get_field_from_question(user_question, fields)
            if not field_name:
                return jsonify({"error": "Could not map question to any incident field."}), 400
            return jsonify({"field": field_name, "value": raw_incident.get(field_name)})
        if not formatting_context:
            formatting_context = (
                "You are an intelligent assistant. Format the following raw incident data into a structured JSON response "
                "that can be easily parsed by an agent. The response should include: incident_number, short_description, "
                "u_assigned_to, status. Raw Incident Data: {raw_incident} Provide JSON only."
            )
        prompt = formatting_context.format(raw_incident=json.dumps(raw_incident, indent=2))
        llm_response = openai.chat.completions.create(  # type: ignore[attr-defined]
            model=GPT_MODEL_NAME,
            messages=[  # type: ignore[arg-type]
                {"role": "system", "content": "You are an assistant that formats incident data."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=500
        )
        formatted_response = llm_response.choices[0].message.content or "{}"
        cleaned_response = formatted_response.strip("```json").strip("```").strip()
        try:
            return jsonify(json.loads(cleaned_response))
        except json.JSONDecodeError:
            return jsonify({"error": "Failed to parse the LLM response as JSON.", "raw_response": formatted_response}), 500
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Error fetching ServiceNow incident: {e}"}), 502
    except Exception as e:
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500

def fetch_servicenow_incident_core(incident_number):
    # Sanitize the input to extract only the incident number
    if ":" in incident_number:
        incident_number = incident_number.split(":")[-1].strip()
    
    # Use sysparm_display_value=true to get human-readable values instead of sys_ids
    url = f"{servicenow_instance}/api/now/table/incident?sysparm_limit=1&number={incident_number}&sysparm_display_value=true"
    headers = {"Accept": "application/json"}
    try:
        response = requests.get(url, auth=_sn_auth(), headers=headers)
        response.raise_for_status()
        result = response.json()
        if result.get("result"):
            return result["result"][0]  # Return the first matching incident
        return None
    except requests.exceptions.RequestException as e:
        return {"error": f"Error fetching ServiceNow incident: {e}"}

def analyze_incident_core(incident_number, question, folder_path="C:/dev/gt/docs/Auto/NJ"):
    # Step 1: Fetch the ServiceNow incident
    incident_json = fetch_servicenow_incident_core(incident_number)
    if not incident_json or "error" in incident_json:
        return {"error": "Failed to fetch the ServiceNow incident.", "details": incident_json}
    # Step 2: Extract "short_description" and "work_notes" fields
    short_description = incident_json.get("short_description", "")
    work_notes = incident_json.get("work_notes", "")
    if not short_description and not work_notes:
        return {"error": "No relevant data found in the incident for RAG."}
    # Step 3: Query the FAISS vector database
    query = f"{short_description} {work_notes}"
    distances, indices = search_faiss_index(folder_path, "Auto", "NJ", query)
    if distances.size == 0 or indices.size == 0:
        return {"error": "No relevant documents found in the vector database."}
    # Step 4: Form the context for the LLM
    context = f"Incident Details: {json.dumps(incident_json, indent=2)}\n"
    context += f"Relevant Documents: {distances.tolist()}, {indices.tolist()}"
    # Step 5: Use Azure OpenAI client to reason and generate a response
    prompt_template = load_prompt_template()
    prompt = prompt_template.format(context=context, question=question)
    messages = [
        {"role": "system", "content": "You are an insurance Agent to fix reported Incidents by referring to documents available"},
        {"role": "user", "content": prompt}
    ]
    chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
        model=GPT_MODEL_NAME,
        messages=messages,  # type: ignore[arg-type]
        max_tokens=4000
    )
    llm_response = chat_completion.choices[0].message.content
    return {
        "incident_number": incident_number,
        "question": question,
        "response": llm_response
    }

@blueprint.route('/fetch_servicenow_incident', methods=['GET'])
def fetch_servicenow_incident_route():
    inc = request.args.get('incident_number', '')
    if not inc:
        return jsonify({"error": "incident_number is required"}), 400
    return jsonify(fetch_servicenow_incident_core(inc) or {})

def fetch_all_incidents_core(limit: int = 10000):
    """Return list of incidents or {'error': ...}. Default: 10000 incidents."""
    url = f"{servicenow_instance}/api/now/table/incident?sysparm_limit={limit}"
    headers = {"Accept": "application/json"}
    try:
        response = requests.get(url, auth=_sn_auth(), headers=headers)
        response.raise_for_status()
        result = response.json()
        return result.get("result", [])
    except requests.exceptions.RequestException as e:
        return {"error": f"Failed to fetch incidents: {e}"}

@blueprint.route('/fetch_all_incidents', methods=['GET'])
def fetch_all_incidents():
    data = fetch_all_incidents_core()
    if isinstance(data, dict) and data.get("error"):
        return jsonify(data), 502
    return jsonify({"incidents": data})

def vectorize_text(text):
    """
    Convert text into embeddings using OpenAI's text-embedding-ada-002 model.
    """
    try:
        response = openai.Embedding.create(  # type: ignore[attr-defined]
            input=text,
            model="text-embedding-ada-002"  # Replace with your embedding model
        )
        return response["data"][0]["embedding"]
    except Exception as e:
        raise ValueError(f"Error generating embeddings: {str(e)}")

def load_prompt_template():
    """Load the prompt template from a text file."""
    prompt_file = 'C:/dev/gt/KnowledgeBaseSearch/prompt_template_sn.txt'
    with open(prompt_file, 'r') as file:
        return file.read()

def cosine_similarity(vector1, vector2):
    """
    Calculate the cosine similarity between two vectors.
    """
    vector1 = np.array(vector1)
    vector2 = np.array(vector2)
    dot_product = np.dot(vector1, vector2)
    norm_vector1 = np.linalg.norm(vector1)
    norm_vector2 = np.linalg.norm(vector2)
    return dot_product / (norm_vector1 * norm_vector2)

def splunk_authenticate():
    """
    Authenticate with Splunk and return the session token.
    """
    url = f"{SPLUNK_HOST}/services/auth/login"
    data = {"username": SPLUNK_USERNAME, "password": SPLUNK_PASSWORD}
    try:
        response = requests.post(url, data=data, verify=False)  # Disable SSL verification if needed
        response.raise_for_status()
        session_key = response.json()["sessionKey"]
        return session_key
    except requests.exceptions.RequestException as e:
        raise Exception(f"Failed to authenticate with Splunk: {str(e)}")

def create_splunk_job(session_key, query):
    """
    Create a Splunk search job.
    """
    url = f"{SPLUNK_HOST}/services/search/jobs"
    headers = {"Authorization": f"Splunk {session_key}"}
    data = {"search": query, "exec_mode": "blocking"}
    try:
        response = requests.post(url, headers=headers, data=data, verify=False)
        response.raise_for_status()
        job_id = response.json()["sid"]
        return job_id
    except requests.exceptions.RequestException as e:
        raise Exception(f"Failed to create Splunk job: {str(e)}")

def get_splunk_job_results(session_key, job_id):
    """
    Retrieve results from a Splunk search job.
    """
    url = f"{SPLUNK_HOST}/services/search/jobs/{job_id}/results"
    headers = {"Authorization": f"Splunk {session_key}"}
    try:
        response = requests.get(url, headers=headers, verify=False)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        raise Exception(f"Failed to retrieve Splunk job results: {str(e)}")

@blueprint.route('/analyze_incident', methods=['POST'])
def analyze_incident():
    """API endpoint to analyze a ServiceNow incident."""
    try:
        # Parse JSON input
        data = request.json
        incident_number = data.get("incident_number")
        question = data.get("question")
        folder_path = data.get("folder_path", "C:/dev/gt/docs/Auto/NJ")

        return jsonify(analyze_incident_core(incident_number, question, folder_path))
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500


@blueprint.route('/get_all_incidents', methods=['GET'])
def get_all_incidents():
    """
    API endpoint to fetch all incidents from ServiceNow.
    """
    return fetch_all_incidents()


@blueprint.route('/similar_incidents', methods=['GET'])
def get_similar_incidents():
    """
    API endpoint to find similar incidents based on short description or incident number.
    """
    # Parse input parameters
    incident_short_description = request.args.get("incident_short_description")
    incident_number = request.args.get("incident_number")

    # Validate input
    if not incident_short_description and not incident_number:
        return jsonify({"error": "Either 'incident_short_description' or 'incident_number' must be provided."}), 400

    return traced_get_similar_incidents_logic(incident_short_description, incident_number)

def traced_get_similar_incidents_logic(incident_short_description, incident_number):
    try:
        # Step 1: derive short description if only number provided
        if incident_number and not incident_short_description:
            incident_data = fetch_servicenow_incident_core(incident_number)
            if not incident_data or (isinstance(incident_data, dict) and incident_data.get("error")):
                return jsonify({"error": "Failed to fetch the ServiceNow incident.", "details": incident_data}), 400
            if incident_data:
                incident_short_description = incident_data.get("short_description", "")  # type: ignore[assignment]
            if not incident_short_description:
                return jsonify({"error": "No short description found for the provided incident number."}), 400
        if not incident_short_description:
            return jsonify({"error": "incident_short_description is required when incident_number not provided."}), 400
        # Step 2: fetch all incidents
        all_incidents = fetch_all_incidents_core()
        if isinstance(all_incidents, dict) and all_incidents.get("error"):
            return jsonify(all_incidents), 502
        # Step 3: index
        faiss_index = load_or_create_faiss_index()
        # Step 4: vectorize
        incident_vectors = []
        for incident in all_incidents:  # type: ignore[assignment]
            if not isinstance(incident, dict):
                continue
            sd = incident.get("short_description", "")
            if not sd:
                continue
            embedding = get_cached_embedding(sd)
            if embedding is None:
                embedding = generate_embeddings([sd])[0]
                cache_embedding(sd, embedding)
                embedding_np = np.array(embedding, dtype="float32").reshape(1, -1)
                faiss_index.add(embedding_np)  # type: ignore[arg-type]
                save_faiss_index(faiss_index)
            incident_vectors.append((incident, embedding))
        input_embedding = get_cached_embedding(incident_short_description)
        if input_embedding is None:
            input_embedding = generate_embeddings([incident_short_description])[0]
            cache_embedding(incident_short_description, input_embedding)
            embedding_np = np.array(input_embedding, dtype="float32").reshape(1, -1)
            faiss_index.add(embedding_np)  # type: ignore[arg-type]
            save_faiss_index(faiss_index)
        # Step 5 similarity
        similar_incidents = []
        for incident, vector in incident_vectors:
            score = cosine_similarity(input_embedding, vector)
            if score > SIMILARITY_THRESHOLD:
                similar_incidents.append({
                    "number": incident.get("number"),
                    "short_description": incident.get("short_description"),
                    "u_assigned_to": incident.get("u_assigned_to"),
                    "sys_id": incident.get("sys_id"),
                    "similarity_score": score
                })
        similar_incidents = sorted(similar_incidents, key=lambda x: x["similarity_score"], reverse=True)[:TOP_MATCHING_INCIDENTS]
        return jsonify({"similar_incidents": similar_incidents})
    except Exception as e:  # pragma: no cover
        return jsonify({"error": f"An error occurred: {e}"}), 500

def get_similar_incidents_simple(short_description):
    """
    Simple function to get similar incidents given a short description. This is intended for direct agentic/LLM calls, not HTTP routes.
    Args:
        short_description (str): The short description to search for similar incidents.
    Returns:
        list: List of similar incidents (dicts).
    """
    import time
    # Use the centralized logger to ensure logs appear in agentic_orchestrator_auto.log
    func_logger = logging.getLogger("agentic_orchestrator_auto")
    start_time = time.time()
    func_logger.info(f"[SIMILARITY] Starting similarity search for: '{short_description[:50]}...'")
    
    # Call the existing route logic directly, but as a function
    try:
        # Step 2: Fetch all incidents from ServiceNow
        fetch_start = time.time()
        all_incidents = fetch_all_incidents_core()
        fetch_elapsed = time.time() - fetch_start
        func_logger.info(f"[SIMILARITY] ServiceNow fetch: {len(all_incidents) if not isinstance(all_incidents, dict) else 0} incidents in {fetch_elapsed:.2f}s")
        if isinstance(all_incidents, dict):
            func_logger.warning(f"[SIMILARITY] ServiceNow API returned error: {all_incidents.get('error', 'unknown')}")
            return []
        if not all_incidents:
            func_logger.warning("[SIMILARITY] No incidents returned from ServiceNow")
            return []
        
        # PERFORMANCE OPTIMIZATION: Bulk load all cached embeddings into memory
        # This eliminates 100+ individual TinyDB queries (1.5s each with 19MB file)
        bulk_load_start = time.time()
        embedding_cache = {}  # In-memory cache for instant lookups
        try:
            all_cached = embedding_table.all()
            for entry in all_cached:
                embedding_cache[entry['short_description']] = entry['embedding']
            bulk_load_elapsed = time.time() - bulk_load_start
            func_logger.info(f"[SIMILARITY] Bulk loaded {len(embedding_cache)} cached embeddings in {bulk_load_elapsed:.2f}s")
        except Exception as e:
            func_logger.warning(f"[SIMILARITY] Bulk load failed: {e}, proceeding with empty cache")
            bulk_load_elapsed = time.time() - bulk_load_start
        
        # Step 3: Load or create the FAISS index
        faiss_start = time.time()
        faiss_index = load_or_create_faiss_index()
        faiss_elapsed = time.time() - faiss_start
        func_logger.info(f"[SIMILARITY] FAISS index loaded in {faiss_elapsed:.2f}s")
        # Step 4: Vectorize all incidents using in-memory cache for instant lookups
        loop_start = time.time()
        incident_vectors = []
        cache_updates_needed = False
        cache_hits = 0
        cache_misses = 0
        embedding_gen_time = 0
        
        func_logger.info(f"[SIMILARITY] Processing {len(all_incidents)} incidents for embeddings...")
        
        for idx, incident in enumerate(all_incidents):
            short_desc = incident.get("short_description", "")
            if not short_desc:
                continue
            
            # CHECK IN-MEMORY CACHE FIRST - instant lookup instead of 1.5s TinyDB query
            embedding = embedding_cache.get(short_desc)
            
            if embedding is None:
                # Cache miss - generate new embedding
                cache_misses += 1
                if cache_misses <= 5:  # Log first 5 misses
                    func_logger.info(f"[SIMILARITY] Cache MISS #{cache_misses}: '{short_desc[:50]}...'")
                
                emb_start = time.time()
                embedding = generate_embeddings([short_desc])[0]
                emb_elapsed = time.time() - emb_start
                embedding_gen_time += emb_elapsed
                
                # Update both in-memory cache and persistent TinyDB
                embedding_cache[short_desc] = embedding
                cache_embedding(short_desc, embedding)
                # Add to FAISS index
                embedding_np = np.array(embedding, dtype="float32").reshape(1, -1)
                faiss_index.add(embedding_np)  # type: ignore[call-arg]
                cache_updates_needed = True
            else:
                cache_hits += 1
                
            incident_vectors.append((incident, embedding))
        
        loop_elapsed = time.time() - loop_start
        func_logger.info(f"[SIMILARITY] Embedding loop complete in {loop_elapsed:.2f}s | Cache hits: {cache_hits} | Cache misses: {cache_misses} | Avg embedding time: {embedding_gen_time/cache_misses if cache_misses > 0 else 0:.2f}s")
        
        # Get input embedding with in-memory cache check
        func_logger.info(f"[SIMILARITY] Getting embedding for input query: '{short_description[:50]}...'")
        input_embedding = embedding_cache.get(short_description)
        if input_embedding is None:
            # Cache miss - generate new embedding
            func_logger.info(f"[SIMILARITY] Query cache MISS - generating new embedding")
            query_emb_start = time.time()
            input_embedding = generate_embeddings([short_description])[0]
            query_emb_elapsed = time.time() - query_emb_start
            func_logger.info(f"[SIMILARITY] Query embedding generated in {query_emb_elapsed:.2f}s")
            
            # Update both in-memory cache and persistent TinyDB
            embedding_cache[short_description] = input_embedding
            cache_embedding(short_description, input_embedding)
            # Add to FAISS index
            embedding_np = np.array(input_embedding, dtype="float32").reshape(1, -1)
            faiss_index.add(embedding_np)  # type: ignore[call-arg]
            cache_updates_needed = True
        else:
            func_logger.info(f"[SIMILARITY] Query cache HIT - using cached embedding")
        
        # Save FAISS index if we added new embeddings
        if cache_updates_needed:
            faiss_save_start = time.time()
            save_faiss_index(faiss_index)
            faiss_save_elapsed = time.time() - faiss_save_start
            func_logger.info(f"[SIMILARITY] FAISS index saved in {faiss_save_elapsed:.2f}s ({cache_misses} new embeddings)")
        
        # Step 5: Perform similarity search
        similarity_start = time.time()
        similar_incidents = []
        for incident, vector in incident_vectors:
            similarity_score = cosine_similarity(input_embedding, vector)
            if similarity_score > SIMILARITY_THRESHOLD:
                similar_incidents.append({
                    "number": incident.get("number"),
                    "short_description": incident.get("short_description"),
                    "u_assigned_to": incident.get("u_assigned_to"),
                    "sys_id": incident.get("sys_id"),
                    "similarity_score": similarity_score
                })
        similarity_elapsed = time.time() - similarity_start
        func_logger.info(f"[SIMILARITY] Cosine similarity search completed in {similarity_elapsed:.2f}s | Found {len(similar_incidents)} matches (threshold={SIMILARITY_THRESHOLD})")
        
        # Step 6: Limit results to TOP_MATCHING_INCIDENTS
        similar_incidents = sorted(similar_incidents, key=lambda x: x["similarity_score"], reverse=True)[:5]
        
        total_elapsed = time.time() - start_time
        func_logger.info(f"[SIMILARITY] ✅ COMPLETE in {total_elapsed:.2f}s | Returned {len(similar_incidents)} similar incidents | Cache efficiency: {cache_hits}/{cache_hits+cache_misses} hits ({100*cache_hits/(cache_hits+cache_misses) if (cache_hits+cache_misses) > 0 else 0:.1f}%)")
        
        return similar_incidents
    except Exception as e:
        func_logger.error(f"[SIMILARITY] ❌ ERROR: {e}", exc_info=True)
        return [{"error": f"An error occurred: {str(e)}"}]


def fetch_kb_articles_core(incident_number: str | None = None, category: str | None = None, query: str | None = None, limit: int = 5) -> Dict[str, Any]:
    """Fetch knowledge base articles from ServiceNow kb_knowledge table.
    
    Args:
        incident_number: Optional incident to find related articles for
        category: Optional category filter (e.g., 'incident_resolution')
        query: Optional text query for article search
        limit: Maximum number of articles to return (default 5)
    
    Returns:
        Dictionary with knowledge base articles and metadata
    """
    logger.info(f"[fetch_kb_articles] incident={incident_number} category={category} query={query}")
    
    if not servicenow_instance:
        logger.warning("[fetch_kb_articles] ServiceNow instance not configured")
        return {"error": "ServiceNow instance not configured", "articles": []}
    
    try:
        # Build query parameters
        query_parts = []
        
        # If incident number provided, get incident details for context
        incident_context = ""
        if incident_number:
            incident = fetch_servicenow_incident_core(incident_number)
            if incident and not incident.get("error"):
                incident_context = f"{incident.get('short_description', '')} {incident.get('category', '')}"
                cat = incident.get('category', 'general')
                if cat:
                    query_parts.append(f"kb_categoryLIKE{cat}")
        
        # Add category filter
        if category:
            query_parts.append(f"kb_categoryLIKE{category}")
        
        # Add text query
        if query:
            query_parts.append(f"textLIKE{query}")
        elif incident_context:
            # Use incident context as fallback query
            keywords = incident_context.split()[:3]  # First 3 words
            if keywords:
                query_parts.append(f"textLIKE{' '.join(keywords)}")
        
        # If no query parts, return error
        if not query_parts:
            return {"error": "At least one of incident_number, category, or query is required", "articles": []}
        
        # Build final query
        sysparm_query = "^".join(query_parts)
        
        # Fetch KB articles
        url = f"{servicenow_instance}/api/now/table/kb_knowledge"
        params = {
            "sysparm_query": sysparm_query,
            "sysparm_limit": limit,
            "sysparm_fields": "number,short_description,text,kb_category,sys_view_count,sys_updated_on"
        }
        headers = {"Accept": "application/json"}
        
        response = requests.get(url, auth=_sn_auth(), headers=headers, params=params, timeout=30)
        response.raise_for_status()
        result = response.json()
        
        articles = result.get("result", [])
        
        logger.info(f"[fetch_kb_articles] Found {len(articles)} articles")
        
        return {
            "incident_number": incident_number,
            "category": category,
            "query": query,
            "articles": articles,
            "count": len(articles)
        }
        
    except requests.exceptions.RequestException as e:
        logger.error(f"[fetch_kb_articles] Request error: {e}")
        return {"error": f"ServiceNow request failed: {str(e)}", "articles": []}
    except Exception as e:
        logger.error(f"[fetch_kb_articles] Unexpected error: {e}")
        return {"error": f"Unexpected error: {str(e)}", "articles": []}


def fetch_backlog_overview_core(days_back: int = 7, 
                                 status_filter: str | None = None,
                                 priority_filter: str | None = None,
                                 group_by: str | None = None) -> Dict[str, Any]:
    """Fetch incident backlog with time-based and status filtering.
    
    Args:
        days_back: Number of days to look back (default 7)
        status_filter: Optional status filter ('open', 'in_progress', 'resolved', 'closed')
        priority_filter: Optional priority (1-5)
        group_by: Optional grouping ('priority', 'state', 'assignment_group', 'day')
    
    Returns:
        Dictionary with incidents and analytics breakdown
    """
    logger.info(f"[fetch_backlog_overview] days={days_back} status={status_filter} priority={priority_filter}")
    
    if not servicenow_instance:
        logger.warning("[fetch_backlog_overview] ServiceNow instance not configured")
        return {"error": "ServiceNow instance not configured", "incidents": []}
    
    try:
        # Calculate date window
        now = datetime.now(pytz.UTC)
        start_date = now - timedelta(days=days_back)
        start_date_str = start_date.strftime('%Y-%m-%d')
        
        # Build query
        query_parts = [f"opened_at>={start_date_str}"]
        
        # Add status filter
        if status_filter:
            status_map = {
                'open': '1',
                'in_progress': '2',
                'resolved': '6',
                'closed': '7'
            }
            state_value = status_map.get(status_filter.lower())
            if state_value:
                query_parts.append(f"state={state_value}")
        
        # Add priority filter
        if priority_filter:
            query_parts.append(f"priority={priority_filter}")
        
        sysparm_query = "^".join(query_parts)
        
        # Fetch incidents
        url = f"{servicenow_instance}/api/now/table/incident"
        params = {
            "sysparm_query": sysparm_query,
            "sysparm_limit": 500,
            "sysparm_fields": "number,short_description,priority,state,opened_at,assignment_group,sys_updated_on"
        }
        headers = {"Accept": "application/json"}
        
        response = requests.get(url, auth=_sn_auth(), headers=headers, params=params, timeout=30)
        response.raise_for_status()
        result = response.json()
        
        incidents = result.get("result", [])
        
        # Apply grouping if requested
        analytics = {}
        if group_by and incidents:
            if group_by == 'priority':
                for inc in incidents:
                    pri = inc.get('priority', 'unknown')
                    analytics[pri] = analytics.get(pri, 0) + 1
            elif group_by == 'state':
                for inc in incidents:
                    state = inc.get('state', 'unknown')
                    analytics[state] = analytics.get(state, 0) + 1
            elif group_by == 'assignment_group':
                for inc in incidents:
                    group = inc.get('assignment_group', {})
                    if isinstance(group, dict):
                        group_val = group.get('value', 'unassigned')
                    else:
                        group_val = 'unassigned'
                    analytics[group_val] = analytics.get(group_val, 0) + 1
            elif group_by == 'day':
                for inc in incidents:
                    opened = inc.get('opened_at', '')
                    if opened:
                        day = opened.split('T')[0]  # Extract date part
                        analytics[day] = analytics.get(day, 0) + 1
        
        logger.info(f"[fetch_backlog_overview] Found {len(incidents)} incidents")
        
        return {
            "days_back": days_back,
            "start_date": start_date_str,
            "status_filter": status_filter,
            "priority_filter": priority_filter,
            "incidents": incidents,
            "count": len(incidents),
            "analytics": analytics if group_by else None
        }
        
    except requests.exceptions.RequestException as e:
        logger.error(f"[fetch_backlog_overview] Request error: {e}")
        return {"error": f"ServiceNow request failed: {str(e)}", "incidents": []}
    except Exception as e:
        logger.error(f"[fetch_backlog_overview] Unexpected error: {e}")
        return {"error": f"Unexpected error: {str(e)}", "incidents": []}


def summarize_work_notes_core(incident_number: str, max_notes: int = 20, llm_summary: bool = True) -> Dict[str, Any]:
    """Enhanced work notes summarization with chronological ordering and key insights.
    
    Args:
        incident_number: Incident number to fetch work notes for
        max_notes: Maximum number of notes to retrieve (default 20)
        llm_summary: Whether to use LLM for intelligent summarization (default True)
    
    Returns:
        Dictionary with work notes, summary, and key insights
    """
    logger.info(f"[summarize_work_notes] incident={incident_number} llm={llm_summary}")
    
    if not servicenow_instance:
        logger.warning("[summarize_work_notes] ServiceNow instance not configured")
        return {"error": "ServiceNow instance not configured", "work_notes": []}
    
    try:
        # Fetch incident to get sys_id
        incident = fetch_servicenow_incident_core(incident_number)
        if not incident or incident.get("error"):
            return {"error": f"Incident {incident_number} not found", "work_notes": []}
        
        sys_id = incident.get('sys_id')
        if not sys_id:
            return {"error": "Could not determine incident sys_id", "work_notes": []}
        
        # Fetch work notes from sys_journal_field table
        url = f"{servicenow_instance}/api/now/table/sys_journal_field"
        params = {
            "sysparm_query": f"element_id={sys_id}^element=work_notes",
            "sysparm_limit": max_notes,
            "sysparm_fields": "value,sys_created_on,sys_created_by",
            "sysparm_order_by": "sys_created_on"
        }
        headers = {"Accept": "application/json"}
        
        response = requests.get(url, auth=_sn_auth(), headers=headers, params=params, timeout=30)
        response.raise_for_status()
        result = response.json()
        
        work_notes = result.get("result", [])
        
        if not work_notes:
            return {
                "incident_number": incident_number,
                "work_notes": [],
                "count": 0,
                "summary": "No work notes found for this incident."
            }
        
        # Format work notes chronologically
        formatted_notes = []
        for note in work_notes:
            formatted_notes.append({
                "timestamp": note.get('sys_created_on', ''),
                "author": note.get('sys_created_by', 'unknown'),
                "text": note.get('value', '')
            })
        
        # Generate summary
        summary = ""
        key_insights = []
        
        if llm_summary and len(work_notes) > 0:
            # Use LLM to generate intelligent summary with structured resolution extraction
            try:
                notes_text = "\n\n".join([f"[{n['timestamp']}] {n['author']}: {n['text']}" for n in formatted_notes])
                
                prompt = f"""Analyze the following work notes from ServiceNow incident {incident_number} and extract structured resolution information:

Work Notes (chronological):
{notes_text}

Extract and format:

1. **Problem Statement:** What was the issue/symptom reported?
2. **Root Cause:** What caused the problem? (if identified)
3. **Workaround:** What temporary fix was applied? (if any)
4. **Resolution Steps:** What steps permanently fixed the issue?
5. **Current Status:** What's the current state?

If a section is not mentioned, state "Not documented" or "Not yet identified".
Be specific and actionable - someone should be able to replicate the resolution."""
                
                llm_response = openai.chat.completions.create(
                    model=GPT_MODEL_NAME,
                    messages=[
                        {"role": "system", "content": "You are a DevCopilot expert extracting actionable resolution guidance from work notes. Focus on technical details and reproducible solutions."},
                        {"role": "user", "content": prompt}
                    ],
                    max_tokens=800,
                    temperature=0.3
                )
                
                summary = llm_response.choices[0].message.content or "Summary generation failed."
                
                # Extract key insights (simple keyword extraction as fallback)
                for note in formatted_notes:
                    text_lower = note['text'].lower()
                    if any(keyword in text_lower for keyword in ['resolved', 'fixed', 'solution', 'workaround']):
                        key_insights.append(f"Resolution: {note['text'][:100]}...")
                    elif any(keyword in text_lower for keyword in ['root cause', 'cause', 'reason']):
                        key_insights.append(f"Root Cause: {note['text'][:100]}...")
                    elif any(keyword in text_lower for keyword in ['escalat', 'priority', 'urgent']):
                        key_insights.append(f"Escalation: {note['text'][:100]}...")
                
            except Exception as llm_error:
                logger.error(f"[summarize_work_notes] LLM error: {llm_error}")
                summary = f"Work notes analysis: {len(work_notes)} entries found. Latest update: {formatted_notes[-1]['text'][:200]}"
        else:
            # Simple concatenation summary
            latest_notes = formatted_notes[-3:] if len(formatted_notes) > 3 else formatted_notes
            summary = " | ".join([note['text'][:100] for note in latest_notes])
        
        logger.info(f"[summarize_work_notes] Processed {len(work_notes)} notes")
        
        return {
            "incident_number": incident_number,
            "work_notes": formatted_notes,
            "count": len(work_notes),
            "summary": summary,
            "key_insights": key_insights if key_insights else None,
            "oldest_note": formatted_notes[0]['timestamp'] if formatted_notes else None,
            "latest_note": formatted_notes[-1]['timestamp'] if formatted_notes else None
        }
        
    except requests.exceptions.RequestException as e:
        logger.error(f"[summarize_work_notes] Request error: {e}")
        return {"error": f"ServiceNow request failed: {str(e)}", "work_notes": []}
    except Exception as e:
        logger.error(f"[summarize_work_notes] Unexpected error: {e}")
        return {"error": f"Unexpected error: {str(e)}", "work_notes": []}


def analyze_bulk_work_notes_core(
    incident_numbers: List[str],
    max_concurrent: int = 10,
    aggregation_level: str = "summary",
    persona: str = "product_owner",
    sample_size: Optional[int] = None
) -> Dict[str, Any]:
    """Analyze work notes across multiple incidents with parallel fetching and intelligent aggregation.
    
    Args:
        incident_numbers: List of incident numbers to analyze
        max_concurrent: Maximum concurrent API calls (default 10, rate limiting)
        aggregation_level: Level of detail - "summary" | "detailed" | "category_breakdown"
        persona: User persona for tailored output - "product_owner" | "developer" | "engineering_lead"
        sample_size: If provided, randomly sample N incidents (for performance when N is large)
    
    Returns:
        Dictionary with aggregate analysis including:
        - incident_count: Total incidents to analyze
        - incidents_analyzed: Successfully fetched
        - common_themes: Recurring patterns with frequency
        - top_categories: Data-driven category classification
        - documentation_gaps: Missing root cause, workaround, resolution
        - resolution_summary: Aggregate insights
        - actionable_insights: Prioritized recommendations
    """
    logger.info(f"[analyze_bulk_work_notes] Starting bulk analysis | incidents={len(incident_numbers)} persona={persona}")
    
    # Sample if requested
    if sample_size and len(incident_numbers) > sample_size:
        import random
        incident_numbers = random.sample(incident_numbers, sample_size)
        logger.info(f"[analyze_bulk_work_notes] Sampled {sample_size} incidents from {len(incident_numbers)}")
    
    # Limit to max 100 incidents for performance
    if len(incident_numbers) > 100:
        logger.warning(f"[analyze_bulk_work_notes] Limiting to first 100 incidents (requested {len(incident_numbers)})")
        incident_numbers = incident_numbers[:100]
    
    # Phase 1: Parallel fetch work notes summaries
    def fetch_single_summary(inc_num: str) -> Dict[str, Any]:
        """Fetch work notes summary for a single incident."""
        try:
            summary = summarize_work_notes_core(inc_num, max_notes=10, llm_summary=True)
            if summary.get("error"):
                logger.warning(f"[analyze_bulk_work_notes] Failed to fetch {inc_num}: {summary['error']}")
                return {"incident_number": inc_num, "error": summary['error']}
            return {
                "incident_number": inc_num,
                "summary": summary.get("summary", ""),
                "count": summary.get("count", 0),
                "key_insights": summary.get("key_insights", [])
            }
        except Exception as e:
            logger.error(f"[analyze_bulk_work_notes] Error fetching {inc_num}: {e}")
            return {"incident_number": inc_num, "error": str(e)}
    
    summaries = []
    failed_count = 0
    
    with ThreadPoolExecutor(max_workers=max_concurrent) as executor:
        future_to_incident = {executor.submit(fetch_single_summary, inc): inc for inc in incident_numbers}
        
        for future in as_completed(future_to_incident):
            result = future.result()
            if result and not result.get('error'):
                summaries.append(result)
            else:
                failed_count += 1
    
    logger.info(f"[analyze_bulk_work_notes] Fetched {len(summaries)} summaries, {failed_count} failed")
    
    if not summaries:
        return {
            "error": "No work notes could be fetched for any incident",
            "incident_count": len(incident_numbers),
            "incidents_analyzed": 0
        }
    
    # Phase 2: Extract structured insights from summaries
    all_summaries_text = "\n\n".join([
        f"Incident {s['incident_number']}:\n{s['summary']}" 
        for s in summaries[:50]  # Limit to 50 for LLM context
    ])
    
    # Phase 3: Analyze documentation gaps
    documentation_stats = {
        "missing_root_cause": 0,
        "missing_workaround": 0,
        "missing_resolution_steps": 0,
        "has_documentation": 0
    }
    
    for summary in summaries:
        summary_text = summary.get("summary", "").lower()
        if "not documented" in summary_text or "not yet identified" in summary_text:
            if "root cause" in summary_text:
                documentation_stats["missing_root_cause"] += 1
            if "workaround" in summary_text:
                documentation_stats["missing_workaround"] += 1
            if "resolution" in summary_text:
                documentation_stats["missing_resolution_steps"] += 1
        else:
            documentation_stats["has_documentation"] += 1
    
    # Calculate percentages
    total = len(summaries)
    doc_gaps_pct = {
        "missing_root_cause_pct": round(documentation_stats["missing_root_cause"] / total * 100, 1),
        "missing_workaround_pct": round(documentation_stats["missing_workaround"] / total * 100, 1),
        "missing_resolution_pct": round(documentation_stats["missing_resolution_steps"] / total * 100, 1)
    }
    
    # Phase 4: Theme extraction with simple keyword frequency
    theme_keywords = []
    for summary in summaries:
        text = summary.get("summary", "")
        # Extract key technical terms (simple heuristic: capitalized phrases or specific patterns)
        phrases = re.findall(r'\b[A-Z][A-Za-z0-9 ]{2,30}(?=[\s,\.\n])', text)
        theme_keywords.extend([p.strip() for p in phrases if len(p.strip()) > 3])
    
    theme_counter = Counter(theme_keywords)
    common_themes = [
        {"theme": theme, "frequency": count, "incident_sample": []}
        for theme, count in theme_counter.most_common(10) if count >= 2
    ]
    
    # Phase 5: LLM-powered aggregate analysis
    try:
        persona_prompts = {
            "product_owner": "Focus on business impact, frequency trends, documentation gaps, and prioritization rationale. Provide actionable backlog recommendations.",
            "developer": "Focus on technical root causes, recurring error patterns, code/config issues, and suggested fixes. Be specific about technical details.",
            "engineering_lead": "Focus on system-level patterns, architectural issues, team/process gaps, and strategic recommendations."
        }
        
        # Customize prompt based on aggregation level
        if aggregation_level == 'workaround_focus':
            analysis_instructions = f"""Provide a comprehensive workaround/solution-focused analysis:

1. **Solutions Summary**: Extract ALL solutions/fixes/actions documented in the work notes, including:
   - Explicit workarounds (temporary fixes)
   - Permanent solutions/resolutions
   - Debugging/troubleshooting steps that led to resolution
   - Configuration changes, data corrections, or manual interventions
   For each solution, specify:
     - Description (what was done)
     - Incidents where it was used
     - Type (temporary workaround vs permanent fix)
     - Outcome/effectiveness

2. **Solution Categories**: Group solutions by type:
   - Configuration/Settings Changes
   - Data Corrections/Updates  
   - Manual User Actions/Workarounds
   - Code/System Fixes
   - Process/Procedural Changes

3. **Problem Patterns**: For incidents with missing explicit workarounds, extract:
   - What problem/symptom was described
   - What actions were taken (even if not labeled as workaround)
   - What was the outcome
   - Key learnings

4. **Documentation Quality**: {doc_gaps_pct['missing_workaround_pct']}% incidents missing explicit workaround docs, but extract ANY solution information from work notes

5. **Actionable Insights**: 
   - Recurring manual workarounds that need automation
   - Knowledge gaps where documentation should be improved
   - Patterns suggesting systemic issues needing permanent fixes"""
            
            json_schema = """{
  "solutions_summary": [
    {"solution": "detailed description of what was done", "incidents": ["INC..."], "type": "temporary_workaround|permanent_fix|manual_action|configuration_change|code_fix", "effectiveness": "successful|partial|unknown", "details": "specific steps/actions taken"},
    ...
  ],
  "solution_categories": [
    {"category": "Configuration/Settings Changes|Data Corrections|Manual Actions|Code/System Fixes|Process Changes", "count": N, "examples": ["solution description 1", "solution description 2"]},
    ...
  ],
  "problem_patterns": [
    {"problem": "symptom/issue description", "incidents": ["INC..."], "actions_taken": "what was done (even if not labeled as workaround)", "outcome": "result/resolution", "learning": "key insight or takeaway"},
    ...
  ],
  "documentation_quality": "assessment of what's documented vs missing, gaps in workaround documentation",
  "key_learnings": [
    "learning 1: insight from patterns",
    "learning 2: preventive measure",
    ...
  ],
  "actionable_insights": [
    {"insight": "specific recommendation", "priority": "high|medium|low", "rationale": "why this matters"},
    ...
  ],
  "executive_summary": "2-3 sentence overview covering solutions found (both explicit and extracted from work notes), problem patterns, and key learnings"
}"""
        else:
            analysis_instructions = """Provide a structured analysis with:

1. **Top 5 Categories**: Classify these incidents into 5 main categories based on symptom/problem type. For each category:
   - Category name
   - Estimated incident count (based on patterns in summaries)
   - Key characteristics

2. **Common Themes**: Identify 3-5 recurring themes or patterns across incidents.

3. **Documentation Quality**: Assess the quality of incident documentation and what's missing.

4. **Actionable Insights**: Provide 3-5 specific, prioritized recommendations."""
            
            json_schema = """{
  "top_categories": [
    {"category": "...", "estimated_count": N, "characteristics": "...", "priority": "high|medium|low"},
    ...
  ],
  "common_themes": ["...", "..."],
  "documentation_assessment": "...",
  "actionable_insights": [
    {"insight": "...", "impact": "high|medium|low", "effort": "low|medium|high"},
    ...
  ],
  "executive_summary": "2-3 sentence overview"
}"""
        
        prompt = f"""Analyze the following work notes summaries from {len(summaries)} ServiceNow incidents.

Persona: {persona}
{persona_prompts.get(persona, persona_prompts["product_owner"])}

Work Notes Summaries (sample of {min(50, len(summaries))} incidents):
{all_summaries_text}

Documentation Gaps Detected:
- {doc_gaps_pct['missing_root_cause_pct']}% missing root cause
- {doc_gaps_pct['missing_workaround_pct']}% missing workaround
- {doc_gaps_pct['missing_resolution_pct']}% missing resolution steps

{analysis_instructions}

Format response as JSON:
{json_schema}"""
        
        llm_response = openai.chat.completions.create(
            model=GPT_MODEL_NAME,
            messages=[
                {"role": "system", "content": f"You are an expert incident analyst for a {persona}. Provide data-driven insights."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=1500,
            temperature=0.3
        )
        
        analysis_text = llm_response.choices[0].message.content or "{}"
        
        # Try to parse JSON response
        try:
            # Extract JSON from markdown code blocks if present
            if "```json" in analysis_text:
                analysis_text = analysis_text.split("```json")[1].split("```")[0].strip()
            elif "```" in analysis_text:
                analysis_text = analysis_text.split("```")[1].split("```")[0].strip()
            
            llm_analysis = json.loads(analysis_text)
        except json.JSONDecodeError:
            logger.warning(f"[analyze_bulk_work_notes] Could not parse LLM JSON, using text response")
            llm_analysis = {
                "executive_summary": analysis_text[:500],
                "top_categories": [],
                "common_themes": common_themes[:5],
                "actionable_insights": []
            }
        
    except Exception as llm_error:
        logger.error(f"[analyze_bulk_work_notes] LLM analysis failed: {llm_error}")
        llm_analysis = {
            "executive_summary": "LLM analysis unavailable - statistical summary provided below",
            "top_categories": [],
            "common_themes": common_themes[:5],
            "actionable_insights": [
                {"insight": f"Improve documentation - {doc_gaps_pct['missing_resolution_pct']}% incidents lack resolution steps", 
                 "impact": "high", "effort": "medium"}
            ]
        }
    
    # Phase 6: Categorize incidents for filtering/drill-down
    incidents_with_doc_gaps = []
    incidents_by_category_map = {}
    
    for summary in summaries:
        inc_num = summary.get("incident_number")
        summary_text = summary.get("summary", "").lower()
        
        # Check for documentation gaps
        if ("not documented" in summary_text or 
            "not yet identified" in summary_text or 
            "no work notes" in summary_text or
            summary.get("count", 0) < 2):  # Less than 2 work notes = poor documentation
            incidents_with_doc_gaps.append(inc_num)
    
    # Map incidents to their categories (if LLM provided categorization)
    # This is best-effort based on keyword matching in summaries
    if llm_analysis.get("top_categories"):
        for category_info in llm_analysis.get("top_categories", []):
            category_name = category_info.get("category", "")
            incidents_by_category_map[category_name] = []
            
            # Simple heuristic: Match category characteristics to incident summaries
            # In production, LLM should explicitly categorize each incident
            characteristics_lower = category_info.get("characteristics", "").lower()
            for summary in summaries:
                if any(keyword in summary.get("summary", "").lower() 
                       for keyword in characteristics_lower.split()[:5]):  # Use first 5 words as keywords
                    incidents_by_category_map[category_name].append(summary["incident_number"])
    
    logger.info(f"[analyze_bulk_work_notes] Categorization complete: {len(incidents_with_doc_gaps)} incidents with doc gaps")
    
    # Phase 7: Construct final response
    result = {
        "incident_count": len(incident_numbers),
        "incidents_analyzed": len(summaries),
        "incidents_failed": failed_count,
        "aggregation_level": aggregation_level,
        "persona": persona,
        "executive_summary": llm_analysis.get("executive_summary", ""),
        "top_categories": llm_analysis.get("top_categories", []),
        "common_themes": llm_analysis.get("common_themes", common_themes[:5]),
        "documentation_gaps": {
            **documentation_stats,
            **doc_gaps_pct
        },
        "actionable_insights": llm_analysis.get("actionable_insights", []),
        "sample_incidents": [s["incident_number"] for s in summaries[:10]],
        "incidents_with_doc_gaps": incidents_with_doc_gaps,
        "incidents_by_category": incidents_by_category_map
    }
    
    # Add workaround-specific fields when aggregation_level is 'workaround_focus'
    if aggregation_level == 'workaround_focus':
        result.update({
            "solutions_summary": llm_analysis.get("solutions_summary", []),
            "solution_categories": llm_analysis.get("solution_categories", []),
            "problem_patterns": llm_analysis.get("problem_patterns", []),
            "key_learnings": llm_analysis.get("key_learnings", [])
        })
    
    logger.info(f"[analyze_bulk_work_notes] Completed bulk analysis | categories={len(result['top_categories'])} themes={len(result['common_themes'])}")
    
    return result


def find_resolutions_from_similar_incidents_core(
    incident_numbers: List[str],
    max_similar_per_incident: int = 5,
    max_concurrent: int = 10,
    include_active_incidents: bool = False
) -> Dict[str, Any]:
    """Find similar incidents for given context incidents and extract their resolutions/workarounds.
    
    This function implements the workflow:
    1. For each incident in context, find similar incidents (using embedding search with cache)
    2. Filter for resolved incidents (state 6,7,8) to learn from successful resolutions
    3. Extract work notes summaries focusing on workarounds/solutions
    4. Aggregate patterns across all similar incidents found
    
    Use this when user asks:
    - "What worked for similar incidents?"
    - "How were similar problems resolved?"
    - "What are the workarounds for incidents like these?"
    - "Show me resolutions from similar cases"
    
    Args:
        incident_numbers: List of incident numbers from context (1-20 incidents)
        max_similar_per_incident: Max similar incidents to find per context incident (default 5)
        max_concurrent: Maximum concurrent API calls for rate limiting
        include_active_incidents: If True, also include unresolved similar incidents
    
    Returns:
        Dictionary with:
        - context_incidents: Original incidents analyzed
        - similar_incidents_found: Total similar incidents discovered
        - resolved_incidents_analyzed: Count of resolved incidents with work notes
        - resolution_patterns: Extracted workarounds/solutions grouped by pattern
        - success_rate_by_solution: How often each solution worked
        - recommended_actions: Top recommended solutions based on similarity + success rate
        - similar_incident_details: Detailed breakdown per context incident
    """
    logger.info(f"[find_resolutions_similar] Starting | context_incidents={len(incident_numbers)} max_similar={max_similar_per_incident}")
    
    if len(incident_numbers) > 20:
        logger.warning(f"[find_resolutions_similar] Limiting to first 20 context incidents (requested {len(incident_numbers)})")
        incident_numbers = incident_numbers[:20]
    
    # Phase 1: For each context incident, find similar incidents
    def find_similar_for_incident(inc_num: str) -> Dict[str, Any]:
        """Find similar incidents for a single context incident."""
        try:
            # Get incident details to extract short description
            incident_data = fetch_servicenow_incident_core(inc_num)
            if incident_data.get("error"):
                logger.warning(f"[find_resolutions_similar] Failed to fetch context incident {inc_num}")
                return {"incident_number": inc_num, "error": incident_data.get("error")}
            
            short_desc = incident_data.get("short_description", "")
            if not short_desc:
                return {"incident_number": inc_num, "error": "No short description found"}
            
            # Find similar incidents using cached embeddings
            similar_incidents = get_similar_incidents_simple(short_desc)
            
            if not similar_incidents or (isinstance(similar_incidents, list) and len(similar_incidents) == 0):
                return {
                    "incident_number": inc_num,
                    "short_description": short_desc,
                    "similar_incidents": [],
                    "resolved_count": 0
                }
            
            # Filter for resolved incidents and fetch their work notes
            resolved_similar = []
            for sim_inc in similar_incidents[:max_similar_per_incident]:
                if isinstance(sim_inc, dict) and not sim_inc.get('error'):
                    sim_num = sim_inc.get('number')
                    if sim_num == inc_num:  # Skip self-reference
                        continue
                    
                    # Fetch full details to check resolution state
                    sim_details = fetch_servicenow_incident_core(sim_num)
                    if sim_details and not sim_details.get('error'):
                        state = str(sim_details.get('state', ''))
                        
                        # Include resolved incidents (6=Resolved, 7=Closed, 8=Closed Complete)
                        if state in ['6', '7', '8']:
                            # Get work notes summary focusing on resolution
                            if sim_num:  # Guard against None
                                work_notes_summary = summarize_work_notes_core(sim_num, max_notes=10, llm_summary=True)
                            else:
                                work_notes_summary = {'summary': '', 'count': 0}
                            
                            resolved_similar.append({
                                "number": sim_num,
                                "short_description": sim_inc.get('short_description'),
                                "similarity_score": sim_inc.get('similarity_score', 0),
                                "state": state,
                                "resolved_at": sim_details.get('resolved_at', ''),
                                "work_notes_summary": work_notes_summary.get('summary', ''),
                                "work_notes_count": work_notes_summary.get('count', 0),
                                "has_workaround": 'workaround' in work_notes_summary.get('summary', '').lower()
                            })
                        elif include_active_incidents and state in ['1', '2', '3', '4', '5']:
                            # Optionally include active incidents for context
                            if sim_num:  # Guard against None
                                work_notes_summary = summarize_work_notes_core(sim_num, max_notes=10, llm_summary=True)
                            else:
                                work_notes_summary = {'summary': '', 'count': 0}
                            resolved_similar.append({
                                "number": sim_num,
                                "short_description": sim_inc.get('short_description'),
                                "similarity_score": sim_inc.get('similarity_score', 0),
                                "state": state,
                                "work_notes_summary": work_notes_summary.get('summary', ''),
                                "work_notes_count": work_notes_summary.get('count', 0),
                                "is_active": True
                            })
            
            return {
                "incident_number": inc_num,
                "short_description": short_desc,
                "similar_incidents": resolved_similar,
                "resolved_count": len([s for s in resolved_similar if not s.get('is_active')])
            }
            
        except Exception as e:
            logger.error(f"[find_resolutions_similar] Error processing {inc_num}: {e}")
            return {"incident_number": inc_num, "error": str(e)}
    
    # Execute parallel similarity searches
    context_results = []
    with ThreadPoolExecutor(max_workers=max_concurrent) as executor:
        future_to_incident = {executor.submit(find_similar_for_incident, inc): inc for inc in incident_numbers}
        
        for future in as_completed(future_to_incident):
            result = future.result()
            if result and not result.get('error'):
                context_results.append(result)
    
    logger.info(f"[find_resolutions_similar] Processed {len(context_results)} context incidents")
    
    if not context_results:
        return {
            "error": "Could not find similar incidents for any context incident",
            "context_incidents": incident_numbers,
            "similar_incidents_found": 0
        }
    
    # Phase 2: Aggregate all similar incidents and their resolutions
    all_similar_incidents = []
    resolved_count = 0
    
    for ctx_result in context_results:
        for sim_inc in ctx_result.get('similar_incidents', []):
            if not sim_inc.get('is_active'):
                resolved_count += 1
            all_similar_incidents.append({
                **sim_inc,
                "context_incident": ctx_result['incident_number']
            })
    
    logger.info(f"[find_resolutions_similar] Found {len(all_similar_incidents)} total similar incidents, {resolved_count} resolved")
    
    # Phase 3: Extract resolution patterns using LLM
    if resolved_count == 0:
        return {
            "context_incidents": [r['incident_number'] for r in context_results],
            "similar_incidents_found": len(all_similar_incidents),
            "resolved_incidents_analyzed": 0,
            "message": "No resolved similar incidents found. Try including active incidents or expanding search criteria."
        }
    
    # Prepare work notes for LLM analysis
    resolved_summaries = [
        f"Incident {inc['number']} (similarity: {inc['similarity_score']:.2f}):\n{inc['work_notes_summary']}"
        for inc in all_similar_incidents 
        if not inc.get('is_active') and inc.get('work_notes_summary')
    ]
    
    summaries_text = "\n\n".join(resolved_summaries[:30])  # Limit to 30 for LLM context
    
    # LLM analysis to extract resolution patterns
    try:
        prompt = f"""Analyze work notes from {resolved_count} RESOLVED similar incidents to extract successful resolution patterns.

Context: User has {len(incident_numbers)} incident(s) and wants to know what worked for similar problems.

Work Notes from Similar Resolved Incidents:
{summaries_text}

Extract and structure the following:

1. **Resolution Patterns**: Identify distinct solutions/workarounds that were successful. For each:
   - Solution description (what was done)
   - Type (temporary workaround | permanent fix | configuration change | manual action | escalation)
   - Incidents where used (numbers)
   - Success indicators (was it marked as resolved after this action?)

2. **Solution Categories**: Group solutions by type and count frequency

3. **Recommended Actions**: Based on similarity scores and success patterns, recommend top 3-5 actions to try, ordered by:
   - Frequency (how often this solution worked)
   - Similarity (how closely the resolved incidents match the context)
   - Success rate (did the incident get resolved after this action?)

4. **Key Insights**: Important learnings or caveats (e.g., "solution X works but requires Y access", "escalation needed if Z condition")

Format as JSON:
{{
  "resolution_patterns": [
    {{
      "solution": "detailed description of what was done",
      "type": "temporary_workaround|permanent_fix|configuration_change|manual_action|escalation",
      "incidents": ["INC..."],
      "frequency": N,
      "success_indicators": "evidence this worked (e.g., incident resolved after action)"
    }},
    ...
  ],
  "solution_categories": [
    {{"category": "Configuration Changes", "count": N, "examples": ["solution 1", "solution 2"]}},
    ...
  ],
  "recommended_actions": [
    {{
      "rank": 1,
      "action": "specific actionable step",
      "rationale": "why this is recommended (frequency, similarity, success rate)",
      "type": "immediate|requires_approval|escalation",
      "estimated_time": "time estimate if available"
    }},
    ...
  ],
  "key_insights": [
    "insight 1: important caveat or learning",
    "insight 2: prerequisite or condition",
    ...
  ],
  "summary": "2-3 sentence executive summary of what typically works for these types of incidents"
}}"""
        
        llm_response = openai.chat.completions.create(
            model=GPT_MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are an expert incident resolution analyst. Extract actionable resolution patterns from work notes."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=1500,
            temperature=0.3
        )
        
        analysis_text = llm_response.choices[0].message.content or "{}"
        
        # Parse JSON response
        try:
            if "```json" in analysis_text:
                analysis_text = analysis_text.split("```json")[1].split("```")[0].strip()
            elif "```" in analysis_text:
                analysis_text = analysis_text.split("```")[1].split("```")[0].strip()
            
            resolution_analysis = json.loads(analysis_text)
        except json.JSONDecodeError:
            logger.warning(f"[find_resolutions_similar] Could not parse LLM JSON")
            resolution_analysis = {
                "summary": analysis_text[:500],
                "resolution_patterns": [],
                "recommended_actions": []
            }
    
    except Exception as llm_error:
        logger.error(f"[find_resolutions_similar] LLM analysis failed: {llm_error}")
        resolution_analysis = {
            "summary": "LLM analysis unavailable - raw work notes provided in similar_incident_details",
            "resolution_patterns": [],
            "recommended_actions": []
        }
    
    # Phase 4: Construct final response
    result = {
        "context_incidents": [r['incident_number'] for r in context_results],
        "similar_incidents_found": len(all_similar_incidents),
        "resolved_incidents_analyzed": resolved_count,
        "active_incidents_found": len(all_similar_incidents) - resolved_count,
        "summary": resolution_analysis.get("summary", ""),
        "resolution_patterns": resolution_analysis.get("resolution_patterns", []),
        "solution_categories": resolution_analysis.get("solution_categories", []),
        "recommended_actions": resolution_analysis.get("recommended_actions", []),
        "key_insights": resolution_analysis.get("key_insights", []),
        "similar_incident_details": context_results  # Detailed breakdown per context incident
    }
    
    logger.info(f"[find_resolutions_similar] Completed | patterns={len(result['resolution_patterns'])} recommendations={len(result['recommended_actions'])}")
    
    return result


def _predict_assignment_group_logic(data):
    try:
        incident_number = data.get("incident_number")
        short_description = data.get("short_description")
        similar_incidents = data.get("similar_incidents", [])

        # Validate input
        if not (incident_number or short_description):
            return jsonify({"error": "Either 'incident_number' or 'short_description' must be provided."}), 400
        if not similar_incidents:
            return jsonify({"error": "No similar incidents provided."}), 400

        # Step 1: Prepare the context for the LLM
        context = "\n".join(
            f"Incident Number: {incident['number']}, Assigned To: {incident.get('u_assigned_to', 'Unassigned')}, Short Description: {incident['short_description']}"
            for incident in similar_incidents
        )

        # Use the provided short description or fetch the incident details if incident_number is provided
        if not short_description and incident_number:
            incident_data = fetch_servicenow_incident_core(incident_number)
            if not incident_data or "error" in incident_data:
                return jsonify({"error": "Failed to fetch the ServiceNow incident.", "details": incident_data}), 400
            short_description = incident_data.get("short_description", "")

        if not short_description:
            return jsonify({"error": "No short description available for the new incident."}), 400

        # Step 2: Formulate the prompt
        question = f"What should be the 'Assigned To' value for the new incident with the following short description: '{short_description}'?"
        prompt_template = """
        Based on the following similar incidents, predict the most appropriate assignment group for the new incident:
        Context:
        {context}

        Question:
        {question}

        Provide a ranked list of possible assignment groups values only and nothing else.
        """
        prompt = prompt_template.format(context=context, question=question)

        # Step 3: Use the Azure OpenAI client to generate the response
        messages = [
            {"role": "system", "content": "You are an expert ServiceNow assistant."},
            {"role": "user", "content": prompt}
        ]

        print("Sending request to OpenAI with the following prompt:")
        print(prompt)

        chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
            model=GPT_MODEL_NAME,
            messages=messages,  # type: ignore[arg-type]
            max_tokens=500
        )
        llm_response = chat_completion.choices[0].message.content

        # Parse the LLM response into a list of assignment groups
        def parse_assignment_groups(text):
            # Split by lines, remove numbering/bullets, strip whitespace, filter empty
            groups = []
            for line in text.splitlines():
                line = line.strip()
                if not line:
                    continue
                # Remove leading numbers/bullets (e.g., '1. ', '- ', '* ')
                line = line.lstrip("-•* ")
                if line and (line[0].isdigit() and (line[1:3] == '. ' or line[1:3] == ') ')):
                    line = line[3:].strip()
                elif line and line[0].isdigit() and line[1] == '.':
                    line = line[2:].strip()
                elif line and line[0] == '.':
                    line = line[1:].strip()
                groups.append(line)
            # Remove any empty or duplicate entries
            return [g for i, g in enumerate(groups) if g and g not in groups[:i]]

        ranked_groups = parse_assignment_groups(llm_response)
        return jsonify({"ranked_groups": ranked_groups, "raw_response": llm_response})
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

@blueprint.route('/predict_assignment_group', methods=['POST'])
def predict_assignment_group_route():
    data = request.json
    return _predict_assignment_group_logic(data)

@blueprint.route('/splunk_query', methods=['POST'])
def splunk_query():
    """(Rolled-back version) Generate and run a Splunk query directly from POST body."""
    try:
        data = request.json or {}
        indexes = data.get("indexes", [])
        key_values = data.get("key_values", {})
        timestamp_start = data.get("timestamp_start")
        timestamp_end = data.get("timestamp_end")
        if not indexes or not key_values or not timestamp_start or not timestamp_end:
            return jsonify({"error": "Indexes, key_values, timestamp_start, and timestamp_end are required."}), 400
        genai_result = generate_splunk_query_core(indexes, key_values, timestamp_start, timestamp_end)
        if isinstance(genai_result, dict) and genai_result.get("error"):
            return jsonify(genai_result), 500
        generated_query = genai_result.get("query")
        session_key = splunk_authenticate()
        job_id = create_splunk_job(session_key, generated_query)
        results = get_splunk_job_results(session_key, job_id)
        return jsonify({"generated_query": generated_query, "results": results})
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

@blueprint.route('/splunk_completed_query', methods=['POST'])
def splunk_completed_query():
    """(Rolled-back version) Execute a fully prepared Splunk query from POST body."""
    try:
        data = request.json or {}
        prepared_query = data.get("query")
        if not prepared_query:
            return jsonify({"error": "A prepared query is required."}), 400
        session_key = splunk_authenticate()
        job_id = create_splunk_job(session_key, prepared_query)
        results = get_splunk_job_results(session_key, job_id)
        return jsonify({"results": results})
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500
    
@blueprint.route('/incident_table_metadata', methods=['GET'])
def get_incident_table_metadata():
    """
    API endpoint to fetch the metadata of the ServiceNow Incident Table.
    """
    # Delegate to the core helper so callers outside of a Flask request context
    # (for example, internal orchestration code) can fetch metadata safely.
    metadata = fetch_incident_table_metadata_core()
    if isinstance(metadata, dict) and metadata.get("error"):
        return jsonify({"error": metadata.get("error")}), 500
    return jsonify({"metadata": metadata})


def fetch_incident_table_metadata_core():
    """
    Core helper to fetch ServiceNow incident table metadata. Returns a parsed JSON
    dict on success or a dict containing an 'error' key on failure. This can be
    called both from the Flask route and from internal code without needing an
    application context.
    """
    try:
        # ServiceNow API URL for fetching table metadata
        url = f"{servicenow_instance}/api/sn_table_builder/app/tableSchemaData/incident"
        headers = {"Accept": "application/json"}
        response = requests.get(url, auth=_sn_auth(), headers=headers)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        return {"error": f"Failed to fetch metadata: {str(e)}"}
    
@blueprint.route('/faiss_indices', methods=['GET'])
def get_faiss_indices():
    """
    API endpoint to fetch available FAISS indices based on the folder structure.
    """
    try:
        # Base folder where FAISS indices are stored
        base_folder = "C:/dev/gt/docs"

        # List to store available indices
        available_indices = []

        # Traverse the folder structure to find all .index files
        for root, dirs, files in os.walk(base_folder):
            for file in files:
                if file.endswith(".index"):
                    # Construct the relative path for the index
                    relative_path = os.path.relpath(os.path.join(root, file), base_folder)
                    # Remove the ".index" extension for cleaner display
                    index_name = relative_path.replace(".index", "")
                    available_indices.append(index_name)

        # Return the list of indices as a JSON response
        return jsonify({"indices": available_indices})

    except Exception as e:
        return jsonify({"error": f"Failed to fetch indices: {str(e)}"}), 500
    
        
@blueprint.route('/retrieve_context', methods=['POST'])
def retrieve_context():
    """(Rolled-back version) Retrieve context from FAISS and produce LLM answer inline."""
    try:
        base_folder = "C:/dev/gt/docs"
        data = request.json or {}
        index = data.get("index")
        problem_statement = data.get("problem_statement")
        if not index or not problem_statement:
            return jsonify({"error": "Both 'index' and 'problem_statement' are required."}), 400
        try:
            parts = index.split("\\") if "\\" in index else index.split("/")
            state = parts[0]
            product = parts[1]
            product_state = f"{product}-{state}"
        except Exception:
            return jsonify({"error": "Invalid index format. Expected format: 'State/Product/Product-State'."}), 400
        base_folder = os.path.normpath(os.path.join(base_folder, state, product))
        distances, indices = search_faiss_index(base_folder, product, state, problem_statement)
        if distances is None or indices is None:
            return jsonify({"error": "No relevant documents found in the FAISS index."}), 404
        metadata_file_path = os.path.join(base_folder, f"{product_state}_metadata.json")
        if not os.path.exists(metadata_file_path):
            return jsonify({"error": f"Metadata file not found at {metadata_file_path}."}), 404
        with open(metadata_file_path, "r") as file:
            metadata = json.load(file)
        relevant_documents = []
        for idx in indices[0]:
            if idx < len(metadata):
                document = metadata[idx]
                file_name = document.get("file_name")
                file_path = os.path.normpath(document.get("file_path")) if document.get("file_path") else None
                summary = document.get("summary", "No summary available")
                distance = distances[0][list(indices[0]).index(idx)]
                relevant_text = "No relevant content found"
                if file_path and os.path.exists(file_path):
                    try:
                        content = extract_text_from_docx(file_path)
                        problem_embedding = generate_embeddings([problem_statement])[0]
                        max_similarity = -1
                        for paragraph in content.split("\n\n"):
                            paragraph_embedding = generate_embeddings([paragraph])[0]
                            similarity = cosine_similarity(problem_embedding, paragraph_embedding)
                            if similarity > max_similarity:
                                max_similarity = similarity
                                relevant_text = paragraph
                    except Exception as e:
                        relevant_text = f"Error reading or processing file: {str(e)}"
                relevant_documents.append({
                    "file_name": file_name,
                    "summary": summary,
                    "distance": distance,
                    "relevant_text": relevant_text
                })
        context = f"Problem Statement: {problem_statement}\n" + "Relevant Documents:\n"
        for doc in relevant_documents:
            context += f"- File Name: {doc['file_name']}\n  Summary: {doc['summary']}\n  Relevance Score (Distance): {doc['distance']}\n  Relevant Text: {doc['relevant_text'][:500]}...\n"
        prompt = f"""
        You are a Business Analyst in the Insurance domain tasked with solving a reported problem.
        Use the following context and business rules to identify violations, issues, and resolutions.

        {context}

        Based on the above, provide a detailed analysis of the problem, identify any violations or issues, and suggest resolutions.
        """
        messages = [
            {"role": "system", "content": "You are a Business Analyst in the Insurance domain."},
            {"role": "user", "content": prompt}
        ]
        chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
            model=GPT_MODEL_NAME,
            messages=messages,  # type: ignore[arg-type]
            max_tokens=4000
        )
        llm_response = chat_completion.choices[0].message.content
        return jsonify({"response": llm_response})
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500


def generate_splunk_query_core(indexes, key_values, timestamp_start, timestamp_end):
    """
    Core function to generate a Splunk query using GenAI. Returns the generated query string.
    """
    try:
        prompt = (
            f"Generate a Splunk query with the following details:\n"
            f"Indexes: {', '.join(indexes)}\n"
            f"Key-Value Pairs: {', '.join([f'{k}={v}' for k, v in key_values.items()])}\n"
            f"Time Range: {timestamp_start} to {timestamp_end}\n"
            f"Output the query in Splunk's search syntax."
        )
        messages = [
            {"role": "system", "content": "You are an expert Splunk Logging tool and APM assistant."},
            {"role": "user", "content": prompt}
        ]
        chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
            model=GPT_MODEL_NAME,
            messages=messages,  # type: ignore[arg-type]
            max_tokens=4000
        )
        llm_response = chat_completion.choices[0].message.content
        return {"query": llm_response}
    except Exception as e:
        return {"error": f"An error occurred: {str(e)}"}




def workaround_lookup_core(similar_incident_ids, question):
    """
    Core function to fetch detailed incident data for similar incidents and process it using OpenAI GPT.
    Returns a dict with the response and detailed incidents.
    """
    try:
        detailed_incidents = []
        for incident_id in similar_incident_ids:
            url = f"{servicenow_instance}/api/now/table/incident?sysparm_limit=1&number={incident_id}&sysparm_display_value=true"
            headers = {"Accept": "application/json"}
            try:
                response = requests.get(url, auth=_sn_auth(), headers=headers)
                response.raise_for_status()
                result = response.json()
                if result.get("result"):
                    detailed_incidents.append(result["result"][0])
            except requests.exceptions.RequestException as e:
                print(f"Error fetching incident {incident_id}: {e}")
        if not detailed_incidents:
            return {"error": "No detailed incidents could be fetched."}
        context = "Similar Incidents:\n"
        for incident in detailed_incidents:
            context += f"- Incident Number: {incident.get('number')}\n"
            context += f"  Short Description: {incident.get('short_description')}\n"
            context += f"  Assigned To: {incident.get('assigned_to', 'Unassigned')}\n"
            context += f"  Work Notes: {incident.get('work_notes', 'No work notes available')}\n"
            context += f"  Workaround: {incident.get('u_workaround', 'No workaround available')}\n\n"
        prompt = f"""
        You are an insurance company Triage  Analyst and for given question you are expected to find 
        requied workaround to let user move forward in completing insurance quote application.
        Use the following context and business rules to identify violations, issues, and resolutions.
        {context}
        Question: {question}
        Provide a detailed response based on the similar incident details only.
        """
        messages = [
            {"role": "system", "content": "You are a insurance company Triage  Analyst in the Insurance domain."},
            {"role": "user", "content": prompt}
        ]
        chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
            model=GPT_MODEL_NAME,
            messages=messages,  # type: ignore[arg-type]
            max_tokens=4000
        )
        llm_response = chat_completion.choices[0].message.content
        return {"response": llm_response, "detailed_incidents": detailed_incidents}
    except Exception as e:
        return {"error": f"An error occurred: {str(e)}"}


def predict_assignment_group_core(incident_number=None, short_description=None, similar_incidents=None, category=None):
    """
    Enhanced core function for assignment group prediction with rules engine and historical learning.
    
    Args:
        incident_number: ServiceNow incident number (e.g., INC0010014)
        short_description: Description of the incident
        similar_incidents: List of similar historical incidents with assignment data
        category: Optional category for direct rule matching
    
    Returns:
        Dict with assignment group recommendations, reasoning, and confidence scores
    """
    try:
        # Input validation
        if not (incident_number or short_description):
            return {"error": "Either 'incident_number' or 'short_description' must be provided."}
        
        # Load assignment rules
        import json
        from pathlib import Path
        rules_path = Path(__file__).parent / "assignment_rules.json"
        try:
            with open(rules_path, 'r') as f:
                rules_config = json.load(f)
        except Exception as e:
            logger.warning(f"Could not load assignment rules: {e}. Using fallback logic.")
            rules_config = None
        
        # Fetch incident details if only incident_number provided
        if not short_description and incident_number:
            incident_data = fetch_servicenow_incident_core(incident_number)
            if not incident_data or "error" in incident_data:
                return {"error": "Failed to fetch the ServiceNow incident.", "details": incident_data}
            short_description = incident_data.get("short_description", "")
            category = incident_data.get("category") or category
        
        if not short_description:
            return {"error": "No short description available for the incident."}
        
        recommendations = []
        reasoning_steps = []
        
        # Step 1: Check rules-based matching if rules are available
        if rules_config and rules_config.get("rules"):
            rules = rules_config["rules"]
            
            # 1a. Check category rules (highest priority)
            if category and "category_rules" in rules:
                for rule in rules["category_rules"].get("mappings", []):
                    rule_category = rule.get("category", "")
                    if rule_category and (rule_category.lower() in category.lower() or category.lower() in rule_category.lower()):
                        # Handle both schema formats: assignment_groups (array) or assignment_group (string)
                        groups = rule.get("assignment_groups", [rule.get("assignment_group")] if rule.get("assignment_group") else [])
                        confidence = rule.get("confidence", 0.9)
                        
                        for group in groups:
                            if group:  # Skip None/empty values
                                recommendations.append({
                                    "assignment_group": group,
                                    "confidence": confidence,
                                    "source": "category_rule",
                                    "reasoning": f"Category '{category}' matched rule for {group}"
                                })
                        
                        reasoning_steps.append(f"✓ Category rule matched: '{category}' → {groups}")
            
            # 1b. Check keyword rules
            if "keyword_rules" in rules:
                description_lower = short_description.lower()
                for rule in rules["keyword_rules"].get("mappings", []):
                    # Handle both schema formats: keywords (array) or keyword (string)
                    keywords_to_check = rule.get("keywords", [rule.get("keyword")] if rule.get("keyword") else [])
                    matched_keywords = [kw for kw in keywords_to_check if kw and kw.lower() in description_lower]
                    
                    if matched_keywords:
                        # Handle both schema formats: assignment_groups (array) or assignment_group (string)
                        groups = rule.get("assignment_groups", [rule.get("assignment_group")] if rule.get("assignment_group") else [])
                        confidence = rule.get("confidence", 0.7)
                        
                        for group in groups:
                            if group:  # Skip None/empty values
                                recommendations.append({
                                    "assignment_group": group,
                                    "confidence": confidence,
                                    "source": "keyword_rule",
                                    "reasoning": f"Keywords {matched_keywords} matched rule for {group}"
                                })
                        
                        reasoning_steps.append(f"✓ Keyword rule matched: {matched_keywords} → {groups}")
        
        # Step 2: Analyze historical patterns from similar incidents
        if similar_incidents:
            assignment_frequency = {}
            for incident in similar_incidents:
                assigned_group = incident.get('u_assigned_to') or incident.get('assignment_group')
                if assigned_group and assigned_group != 'Unassigned':
                    assignment_frequency[assigned_group] = assignment_frequency.get(assigned_group, 0) + 1
            
            if assignment_frequency:
                total = sum(assignment_frequency.values())
                for group, count in sorted(assignment_frequency.items(), key=lambda x: x[1], reverse=True):
                    historical_confidence = count / total
                    recommendations.append({
                        "assignment_group": group,
                        "confidence": historical_confidence * 0.85,  # Weight historical slightly lower
                        "source": "historical_pattern",
                        "reasoning": f"Found in {count}/{total} similar incidents ({int(historical_confidence*100)}% match rate)"
                    })
                reasoning_steps.append(f"✓ Historical analysis: {len(similar_incidents)} similar incidents analyzed")
        
        # Step 3: Consolidate recommendations (combine duplicates, average confidence)
        consolidated = {}
        for rec in recommendations:
            group = rec["assignment_group"]
            if group not in consolidated:
                consolidated[group] = {
                    "assignment_group": group,
                    "confidence": 0,
                    "sources": [],
                    "reasoning": []
                }
            consolidated[group]["confidence"] = max(consolidated[group]["confidence"], rec["confidence"])
            consolidated[group]["sources"].append(rec["source"])
            consolidated[group]["reasoning"].append(rec["reasoning"])
        
        # Sort by confidence descending
        final_recommendations = sorted(
            consolidated.values(),
            key=lambda x: x["confidence"],
            reverse=True
        )
        
        # Step 4: If no rules matched and no similar incidents, use LLM fallback
        if not final_recommendations and similar_incidents:
            reasoning_steps.append("⚠ No rules matched, using LLM analysis of similar incidents")
            context = "\n".join(
                f"Incident Number: {incident['number']}, Assigned To: {incident.get('u_assigned_to', 'Unassigned')}, Short Description: {incident['short_description']}"
                for incident in similar_incidents[:10]  # Limit to top 10
            )
            
            question = f"What should be the assignment group for the new incident: '{short_description}'?"
            prompt_template = """
Based on the following similar incidents, predict the most appropriate assignment group for the new incident:

Context:
{context}

Question:
{question}

Provide a ranked list of possible assignment groups (just the group names, one per line).
"""
            prompt = prompt_template.format(context=context, question=question)
            messages = [
                {"role": "system", "content": "You are an expert ServiceNow assignment routing assistant."},
                {"role": "user", "content": prompt}
            ]
            
            chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
                model=GPT_MODEL_NAME,
                messages=messages,  # type: ignore[arg-type]
                max_tokens=500
            )
            llm_response = chat_completion.choices[0].message.content
            
            # Parse LLM response into recommendations
            for line in llm_response.splitlines():
                line = line.strip().lstrip("-•* 0123456789.")
                if line:
                    final_recommendations.append({
                        "assignment_group": line,
                        "confidence": 0.60,  # Lower confidence for LLM fallback
                        "sources": ["llm_fallback"],
                        "reasoning": ["LLM prediction based on similar incidents"]
                    })
        
        # Step 5: Apply fallback if still no recommendations
        if not final_recommendations:
            if rules_config and "fallback" in rules_config.get("rules", {}):
                fallback = rules_config["rules"]["fallback"]
                for group in fallback["assignment_groups"]:
                    final_recommendations.append({
                        "assignment_group": group,
                        "confidence": fallback["confidence"],
                        "sources": ["fallback_rule"],
                        "reasoning": [fallback["description"]]
                    })
                reasoning_steps.append("⚠ Using fallback assignment groups (no specific rules matched)")
            else:
                final_recommendations.append({
                    "assignment_group": "Service Desk",
                    "confidence": 0.50,
                    "sources": ["default_fallback"],
                    "reasoning": ["No matching rules or historical data found"]
                })
                reasoning_steps.append("⚠ Using default fallback assignment (Service Desk)")
        
        return {
            "recommendations": final_recommendations[:5],  # Top 5 recommendations
            "reasoning_steps": reasoning_steps,
            "incident_description": short_description,
            "category": category,
            "rules_engine_used": rules_config is not None,
            "similar_incidents_count": len(similar_incidents) if similar_incidents else 0
        }
        
    except Exception as e:
        logger.error(f"Error in predict_assignment_group_core: {e}", exc_info=True)
        return {"error": f"An error occurred: {str(e)}"}

def get_cached_embedding(text):
    """Retrieve cached embedding for incident short description.
    
    Args:
        text: Incident short_description to look up
        
    Returns:
        Embedding vector if cached, None if cache miss
    """
    cache_logger = logging.getLogger("agentic_orchestrator_auto")
    Embedding = Query()
    result = embedding_table.get(Embedding.short_description == text)
    if result:
        cache_logger.debug(f"[CACHE] HIT for: '{text[:50]}...'")
        return result["embedding"]  # type: ignore[index]
    cache_logger.debug(f"[CACHE] MISS for: '{text[:50]}...'")
    return None

def cache_embedding(text, embedding):
    """Save embedding to cache for future use.
    
    Args:
        text: Incident short_description (cache key)
        embedding: 1536-dimensional embedding vector
    """
    cache_logger = logging.getLogger("agentic_orchestrator_auto")
    Embedding = Query()
    embedding_table.upsert({"short_description": text, "embedding": embedding}, Embedding.short_description == text)
    cache_logger.debug(f"[CACHE] SAVED: '{text[:50]}...' ({len(embedding)} dims)")

# ============================================================================
# NEW SERVICENOW AGENT TOOLS - Phase 1 Implementation
# ============================================================================

def get_incident_work_notes_core(incident_number: str, include_empty: bool = False) -> Dict[str, Any]:
    """Extract work_notes and comments from ServiceNow incident journal entries.
    
    Work notes and comments are stored in sys_journal_field table, not as direct fields on the incident.
    This function queries the journal table to retrieve both:
    - work_notes: Internal notes (not customer-visible)
    - comments: Additional comments (customer-visible)
    
    Args:
        incident_number: Incident number (e.g., INC0010013)
        include_empty: Return result even if no notes/comments exist
    
    Returns:
        Dict with work_notes (combined text), work_notes_entries (list), work_notes_count, and metadata
    """
    try:
        # First verify incident exists
        incident = fetch_servicenow_incident_core(incident_number)
        if not incident or "error" in incident:
            return {"error": f"Incident {incident_number} not found"}
        
        # Query sys_journal_field table for work notes
        # Import here to avoid circular dependency
        from .servicenow_extended_tools import _table_get, _env_instance
        
        if not _env_instance():
            return {"error": "ServiceNow instance not configured"}
        
        # Query journal entries where element=work_notes OR element=comments
        # Note: element_id contains the sys_id, but we can use number field query
        # In ServiceNow: work_notes = internal notes, comments = customer-visible "Additional comments"
        sys_id = incident.get("sys_id", "")
        if not sys_id:
            return {"error": f"Could not retrieve sys_id for incident {incident_number}"}
        
        # Query journal field table for both work_notes AND comments entries
        journal_entries = _table_get(
            'sys_journal_field',
            f"element_id={sys_id}^element=work_notes^ORelement=comments",
            fields='value,sys_created_on,sys_created_by,element',
            limit=100,
            order='ORDERBYDESCsys_created_on'
        )
        
        if not journal_entries:
            if include_empty:
                return {
                    "incident_number": incident_number,
                    "work_notes": "No work notes or comments recorded",
                    "work_notes_entries": [],
                    "work_notes_count": 0,
                    "last_updated": incident.get("sys_updated_on", "")
                }
            return {"error": f"No work notes or comments found for incident {incident_number}"}
        
        # Format journal entries (most recent first)
        formatted_entries = []
        for entry in journal_entries:
            value = entry.get('value', '')
            created_on = entry.get('sys_created_on', '')
            created_by = entry.get('sys_created_by', 'Unknown')
            element_type = entry.get('element', 'work_notes')
            note_type = 'Additional Comment' if element_type == 'comments' else 'Work Note'
            
            formatted_entries.append({
                'value': value,
                'created_on': created_on,
                'created_by': created_by,
                'type': note_type,
                'element': element_type
            })
        
        # Combine all work notes into a single string
        combined_notes = "\n\n---\n\n".join([
            f"[{entry['type']} - {entry['created_on']} by {entry['created_by']}]\n{entry['value']}"
            for entry in formatted_entries
        ])
        
        return {
            "incident_number": incident_number,
            "work_notes": combined_notes,
            "work_notes_entries": formatted_entries,
            "work_notes_count": len(journal_entries),
            "last_updated": incident.get("sys_updated_on", ""),
            "status": "success"
        }
    except Exception as e:
        logger.error(f"[get_incident_work_notes_core] Error: {e}")
        return {"error": f"Failed to retrieve work notes: {str(e)}"}


def summarize_incident_work_notes_core(incident_number: str, max_tokens: int = 300, style: str = "structured_resolution") -> Dict[str, Any]:
    """LLM-powered summarization of incident work notes with structured resolution extraction.
    
    Args:
        incident_number: Incident number
        max_tokens: Maximum tokens for summary (default 300 for structured output)
        style: Summary style (structured_resolution, bullet_points, paragraph, timeline)
    
    Returns:
        Dict with summary containing problem_statement, root_cause, workaround, resolution_steps
    """
    try:
        notes_data = get_incident_work_notes_core(incident_number, include_empty=True)
        if "error" in notes_data:
            return notes_data
        
        work_notes = notes_data["work_notes"]
        if work_notes == "No work notes recorded":
            return {
                "incident_number": incident_number,
                "summary": "No work notes available to summarize",
                "problem_statement": "Not documented",
                "root_cause": "Not documented",
                "workaround": "None documented",
                "resolution_steps": "No resolution steps recorded",
                "original_length": 0,
                "summary_method": "none"
            }
        
        # Format style-specific prompt
        if style == "structured_resolution":
            # NEW: Structured extraction for DevCopilot resolution guidance
            prompt = f"""Analyze the following incident work notes and extract structured resolution information:

Incident: {incident_number}
Work Notes:
{work_notes[:3000]}

Extract and format the following sections:

1. **Problem Statement:** What was the issue/symptom reported?
2. **Root Cause:** What caused the problem? (if identified)
3. **Workaround:** What temporary fix or workaround was applied? (if any)
4. **Resolution Steps:** What were the steps taken to permanently fix the issue?

If a section is not mentioned in the notes, state "Not documented" or "Not yet identified".
Be specific and actionable - someone should be able to follow these steps to fix similar issues."""
            
            system_prompt = """You are a DevCopilot expert specializing in extracting actionable resolution guidance from incident work notes.
Your goal is to help developers and support engineers understand how to fix issues by providing clear, structured information.
Focus on technical details, specific steps, and reproducible solutions."""
        else:
            # Legacy style support
            style_instructions = {
                "bullet_points": "Provide a bulleted list of key points",
                "paragraph": "Provide a concise paragraph summary",
                "timeline": "Provide a chronological timeline of events"
            }
            instruction = style_instructions.get(style, "Provide a concise summary")
            prompt = f"""Summarize the following incident work notes. {instruction}:

Incident: {incident_number}
Work Notes:
{work_notes[:2000]}

Provide a concise summary highlighting key actions, decisions, and current status."""
            system_prompt = "You are an expert at summarizing technical incident notes. Be concise and highlight only the most important information."
        
        response = openai.chat.completions.create(
            model=GPT_MODEL_NAME,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            max_tokens=max_tokens,
            temperature=0.3
        )
        
        summary = response.choices[0].message.content or "Summary generation failed"
        
        result = {
            "incident_number": incident_number,
            "summary": summary.strip(),
            "original_length": len(work_notes),
            "summary_method": style,
            "status": "success"
        }
        
        # Parse structured fields if using structured_resolution style
        if style == "structured_resolution":
            import re
            # Extract structured sections from LLM response
            problem_match = re.search(r"\*\*Problem Statement:\*\*\s*(.+?)(?=\n\*\*|$)", summary, re.DOTALL | re.IGNORECASE)
            root_cause_match = re.search(r"\*\*Root Cause:\*\*\s*(.+?)(?=\n\*\*|$)", summary, re.DOTALL | re.IGNORECASE)
            workaround_match = re.search(r"\*\*Workaround:\*\*\s*(.+?)(?=\n\*\*|$)", summary, re.DOTALL | re.IGNORECASE)
            resolution_match = re.search(r"\*\*Resolution Steps:\*\*\s*(.+?)(?=\n\*\*|$)", summary, re.DOTALL | re.IGNORECASE)
            
            result["problem_statement"] = problem_match.group(1).strip() if problem_match else "Not documented"
            result["root_cause"] = root_cause_match.group(1).strip() if root_cause_match else "Not yet identified"
            result["workaround"] = workaround_match.group(1).strip() if workaround_match else "None documented"
            result["resolution_steps"] = resolution_match.group(1).strip() if resolution_match else "No resolution steps recorded"
        
        return result
    except Exception as e:
        logger.error(f"[summarize_incident_work_notes_core] Error: {e}")
        return {"error": f"Failed to summarize work notes: {str(e)}"}


def add_incident_work_note_core(incident_number: str, work_note: str, username: str | None = None) -> Dict[str, Any]:
    """Append work note entry to ServiceNow incident.
    
    Args:
        incident_number: Incident number
        work_note: Note text to append
        username: Optional username for attribution
    
    Returns:
        Dict with status and sys_id
    """
    try:
        # First get incident sys_id
        incident = fetch_servicenow_incident_core(incident_number)
        if not incident or "error" in incident:
            return {"error": f"Incident {incident_number} not found"}
        
        sys_id = incident.get("sys_id")
        if not sys_id:
            return {"error": "Could not retrieve incident sys_id"}
        
        # Format note with timestamp and user attribution
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        user_prefix = f"[{username}] " if username else ""
        formatted_note = f"{user_prefix}{timestamp}: {work_note}"
        
        # ServiceNow API endpoint
        url = f"{servicenow_instance}/api/now/table/incident/{sys_id}"
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        
        # Append to existing work_notes
        current_notes = incident.get("work_notes", "")
        updated_notes = f"{current_notes}\n{formatted_note}" if current_notes else formatted_note
        
        payload = {"work_notes": updated_notes}
        
        response = requests.patch(url, auth=_sn_auth(), headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        
        return {
            "incident_number": incident_number,
            "status": "success",
            "message": f"Work note added successfully",
            "sys_id": sys_id,
            "note_preview": work_note[:100]
        }
    except requests.exceptions.RequestException as e:
        logger.error(f"[add_incident_work_note_core] API error: {e}")
        return {"error": f"Failed to add work note: {str(e)}"}
    except Exception as e:
        logger.error(f"[add_incident_work_note_core] Error: {e}")
        return {"error": f"Unexpected error: {str(e)}"}


def query_incidents_by_date_core(date_field: str = "opened_at", 
                                  start_date: str | None = None, 
                                  end_date: str | None = None,
                                  state: str | None = None,
                                  limit: int = 100) -> Dict[str, Any]:
    """Query ServiceNow incidents with date filtering.
    
    Args:
        date_field: Field to filter on (opened_at, sys_created_on, sys_updated_on, closed_at)
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
        state: Optional state filter
        limit: Maximum results to return
    
    Returns:
        Dict with incidents array, total_count, and query metadata
    """
    try:
        # Build ServiceNow encoded query string
        # NOTE: Use >= and <= operators, NOT GREATERTHANOREQUALTO/LESSTHANOREQUALTO
        # ServiceNow API handles date comparisons better with simple operators
        query_parts = []
        
        # For datetime fields, need to append time component for proper comparison
        # ServiceNow stores datetime as "YYYY-MM-DD HH:MM:SS" in UTC
        if start_date:
            # Start of day: append 00:00:00
            start_datetime = f"{start_date} 00:00:00" if " " not in start_date else start_date
            query_parts.append(f"{date_field}>={start_datetime}")
        
        if end_date:
            # End of day: append 23:59:59 to include entire day
            end_datetime = f"{end_date} 23:59:59" if " " not in end_date else end_date
            query_parts.append(f"{date_field}<={end_datetime}")
        
        if state:
            query_parts.append(f"state={state}")
        
        query_string = "^".join(query_parts) if query_parts else ""
        
        url = f"{servicenow_instance}/api/now/table/incident"
        # Use sysparm_display_value=all to get both sys_id and display_value for reference fields
        # This allows date filtering to work while still getting readable names
        params = {
            "sysparm_query": query_string,
            "sysparm_limit": limit,
            "sysparm_display_value": "all",
            "sysparm_fields": "number,short_description,state,priority,assigned_to,assignment_group,sys_created_on,sys_updated_on,opened_at"
        }
        headers = {"Accept": "application/json"}
        
        logger.info(f"[query_incidents_by_date_core] API REQUEST:")
        logger.info(f"  URL: {url}")
        logger.info(f"  Date Filter: {date_field} | Start: {start_date} | End: {end_date}")
        logger.info(f"  Query String (encoded): {query_string}")
        logger.info(f"  Full Params: {params}")
        logger.info(f"  Auth User: {os.getenv('SNOW_USER')}")
        logger.info(f"  Instance: {servicenow_instance}")
        
        response = requests.get(url, auth=_sn_auth(), headers=headers, params=params, timeout=30)
        logger.info(f"[query_incidents_by_date_core] HTTP Status: {response.status_code}")
        logger.info(f"[query_incidents_by_date_core] Response length: {len(response.text)} bytes")
        
        response.raise_for_status()
        
        # Parse JSON with error handling
        try:
            result = response.json()
        except ValueError as json_err:
            logger.error(f"[query_incidents_by_date_core] JSON parsing failed: {json_err}")
            logger.error(f"[query_incidents_by_date_core] Response text (first 500 chars): {response.text[:500]}")
            return {"error": f"Invalid JSON response from ServiceNow: {str(json_err)}"}
        
        incidents = result.get("result", [])
        
        # When using sysparm_display_value=all, ServiceNow returns {display_value, value} dicts
        # Normalize to just use display_value for cleaner output
        normalized_incidents = []
        for inc in incidents:
            normalized = {}
            for key, val in inc.items():
                if isinstance(val, dict) and 'display_value' in val:
                    # Use display_value for human-readable output, fallback to value
                    normalized[key] = val.get('display_value') or val.get('value')
                else:
                    normalized[key] = val
            normalized_incidents.append(normalized)
        
        logger.info(f"[query_incidents_by_date_core] API RESPONSE: {len(normalized_incidents)} incidents returned")
        if normalized_incidents:
            logger.info(f"  First incident sample: {normalized_incidents[0]}")
            logger.info(f"  Date fields in first incident: opened_at={normalized_incidents[0].get('opened_at')}, sys_created_on={normalized_incidents[0].get('sys_created_on')}")
        else:
            logger.warning(f"[query_incidents_by_date_core] ⚠️ ZERO RESULTS RETURNED ⚠️")
            logger.warning(f"  Query: {query_string}")
            logger.warning(f"  Date Field: {date_field} | Range: {start_date} to {end_date}")
            logger.warning(f"  Possible causes:")
            logger.warning(f"    1. No incidents exist in this date range for field '{date_field}'")
            logger.warning(f"    2. Field name '{date_field}' might not exist on incident table")
            logger.warning(f"    3. Timezone mismatch (ServiceNow stores UTC, query might be in different timezone)")
            logger.warning(f"    4. Date format issue with datetime field comparison")
            logger.warning(f"  Raw response keys: {list(result.keys())}")
            logger.warning(f"  Suggestion: Try querying with 'opened_at' instead of 'sys_created_on' to see if data exists")
        
        output = {
            "incidents": normalized_incidents,
            "total_count": len(normalized_incidents),
            "date_range": f"{start_date or 'beginning'} to {end_date or 'now'}",
            "query_params": {
                "date_field": date_field,
                "start_date": start_date,
                "end_date": end_date,
                "state": state,
                "limit": limit
            },
            "status": "success"
        }
        logger.info(f"[query_incidents_by_date_core] OUTPUT | total_count={len(incidents)} incident_numbers={[i.get('number') for i in incidents[:5]]}")
        return output
    except ValueError as json_err:
        # JSONDecodeError is a subclass of ValueError
        logger.error(f"[query_incidents_by_date_core] JSON parsing error: {json_err}")
        logger.error(f"[query_incidents_by_date_core] Response text (first 1000 chars): {response.text[:1000] if 'response' in locals() else 'N/A'}")
        return {"error": f"Date query failed: {str(json_err)}"}
    except requests.exceptions.RequestException as e:
        logger.error(f"[query_incidents_by_date_core] API error: {e}")
        logger.error(f"[query_incidents_by_date_core] Request details: URL={url}, Query={query_string}")
        return {"error": f"Date query failed: {str(e)}"}
    except Exception as e:
        logger.error(f"[query_incidents_by_date_core] Error: {e}")
        logger.error(f"[query_incidents_by_date_core] Full traceback:", exc_info=True)
        return {"error": f"Unexpected error: {str(e)}"}


def get_incidents_created_today_core(include_closed: bool = False, timezone: str = "UTC") -> Dict[str, Any]:
    """Convenience function for 'incidents created today' queries.
    
    Args:
        include_closed: Whether to include closed incidents
        timezone: Timezone for date boundary (default UTC)
    
    Returns:
        Dict with incident_numbers, incident_count, and full incidents array
    """
    try:
        from datetime import datetime
        import pytz
        
        tz = pytz.timezone(timezone)
        today = datetime.now(tz)
        today_str = today.strftime("%Y-%m-%d")
        
        logger.info(f"[get_incidents_created_today_core] ===== FUNCTION START =====")
        logger.info(f"[get_incidents_created_today_core] INPUT | timezone={timezone} include_closed={include_closed}")
        logger.info(f"[get_incidents_created_today_core] Current datetime in {timezone}: {today}")
        logger.info(f"[get_incidents_created_today_core] Formatted date string: {today_str}")
        
        # States: 1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed
        state_filter = None if include_closed else "1,2,3"
        logger.info(f"[get_incidents_created_today_core] State filter: {state_filter} ({'all states' if include_closed else 'open only'})")
        
        # Use ServiceNow's dynamic date query instead of fixed date strings
        # This correctly handles timezone and date boundaries
        logger.info(f"[get_incidents_created_today_core] Using ServiceNow ONToday dynamic query")
        
        servicenow_instance = os.getenv("SERVICENOW_INSTANCE")
        if not servicenow_instance:
            return {"error": "SERVICENOW_INSTANCE not configured"}
        
        # Build query using ServiceNow's dynamic date operators
        query_parts = ["opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)"]
        if state_filter:
            # Use IN operator for state filter (comma-separated doesn't work)
            query_parts.append(f"stateIN{state_filter}")
        
        query_string = "^".join(query_parts)
        
        url = f"{servicenow_instance}/api/now/table/incident"
        params = {
            "sysparm_query": query_string,
            "sysparm_limit": 500,
            "sysparm_fields": "number,short_description,state,priority,assigned_to,sys_created_on,sys_updated_on,opened_at"
        }
        headers = {"Accept": "application/json"}
        
        logger.info(f"[get_incidents_created_today_core] API REQUEST: {url}")
        logger.info(f"[get_incidents_created_today_core] Query: {query_string}")
        
        response = requests.get(url, auth=_sn_auth(), headers=headers, params=params, timeout=30)
        response.raise_for_status()
        result = response.json()
        incidents = result.get("result", [])
        
        logger.info(f"[get_incidents_created_today_core] ServiceNow returned {len(incidents)} incidents")
        incident_numbers = [inc.get("number") for inc in incidents if inc.get("number")]
        
        output = {
            "incident_numbers": incident_numbers,
            "incident_count": len(incidents),
            "created_date": today_str,
            "incidents": incidents,
            "include_closed": include_closed,
            "status": "success"
        }
        logger.info(f"[get_incidents_created_today_core] ===== FUNCTION END =====")
        logger.info(f"[get_incidents_created_today_core] OUTPUT | incident_count={len(incidents)} incident_numbers={incident_numbers}")
        return output
    except Exception as e:
        logger.error(f"[get_incidents_created_today_core] Error: {e}")
        return {"error": f"Failed to query today's incidents: {str(e)}"}


def get_incidents_by_date_range_core(days_back: int | None = None, 
                                       start_date: str | None = None, 
                                       end_date: str | None = None,
                                       group_by: str | None = None) -> Dict[str, Any]:
    """Flexible date range queries with optional analytics.
    
    Args:
        days_back: Number of days to look back (e.g., 7 for last week)
        start_date: Explicit start date (YYYY-MM-DD)
        end_date: Explicit end date (YYYY-MM-DD)
        group_by: Optional grouping (day, priority, state)
    
    Returns:
        Dict with incidents, total_count, analytics, and date_range_description
    """
    try:
        from datetime import datetime, timedelta
        from collections import defaultdict
        
        logger.info(f"[get_incidents_by_date_range_core] Called with days_back={days_back}, start_date={start_date}, end_date={end_date}")
        
        # Calculate dates
        if days_back:
            end = datetime.now().date()
            start = end - timedelta(days=days_back)
            start_date = start.strftime("%Y-%m-%d")
            end_date = end.strftime("%Y-%m-%d")
            logger.info(f"[get_incidents_by_date_range_core] Calculated dates from days_back: start={start_date}, end={end_date}")
        
        result = query_incidents_by_date_core(
            start_date=start_date,
            end_date=end_date,
            limit=500
        )
        
        logger.info(f"[get_incidents_by_date_range_core] query_incidents_by_date_core returned: {list(result.keys())}")
        
        if "error" in result:
            logger.error(f"[get_incidents_by_date_range_core] Error from query_incidents_by_date_core: {result['error']}")
            return result
        
        incidents = result["incidents"]
        
        # Perform analytics if group_by specified
        analytics = {}
        if group_by == "priority":
            priority_counts = defaultdict(int)
            for inc in incidents:
                priority = inc.get("priority", "unknown")
                priority_counts[str(priority)] += 1
            analytics = dict(priority_counts)
        elif group_by == "day":
            day_counts = defaultdict(int)
            for inc in incidents:
                created = inc.get("sys_created_on", "")[:10]  # YYYY-MM-DD
                if created:
                    day_counts[created] += 1
            analytics = dict(sorted(day_counts.items()))
        elif group_by == "state":
            state_counts = defaultdict(int)
            for inc in incidents:
                state = inc.get("state", "unknown")
                state_counts[str(state)] += 1
            analytics = dict(state_counts)
        
        date_desc = f"{start_date} to {end_date}"
        if days_back:
            date_desc += f" ({days_back} days)"
        
        return {
            "incidents": incidents,
            "total_count": len(incidents),
            "analytics": analytics,
            "date_range_description": date_desc,
            "group_by": group_by,
            "status": "success"
        }
    except Exception as e:
        logger.error(f"[get_incidents_by_date_range_core] Error: {e}")
        return {"error": f"Failed to query date range: {str(e)}"}


def search_incidents_by_keywords_core(
    keywords: List[str],
    search_fields: Optional[List[str]] = None,
    state_filter: Optional[str] = None,
    priority_filter: Optional[str] = None,
    limit: int = 20
) -> Dict[str, Any]:
    """Search ServiceNow incidents by multiple keywords with AND logic.
    
    Searches for incidents that contain ALL specified keywords in at least one
    of the search fields. This enables natural language queries like:
    - "bank NIGO incident" → finds incidents with both "bank" AND "NIGO"
    - "payment failure MIB" → finds incidents with all three keywords
    
    Args:
        keywords: List of keywords to search for (case-insensitive, all must match)
        search_fields: Fields to search in (default: ['short_description', 'description', 'work_notes'])
        state_filter: Optional state filter ('1'=New, '2'=In Progress, '3'=On Hold, '6'=Resolved, '7'=Closed)
        priority_filter: Optional priority filter ('1'=Critical to '5'=Planning)
        limit: Maximum number of incidents to return (default: 20)
    
    Returns:
        Dict with:
            - incidents: List of matching incidents
            - keywords_searched: Keywords used
            - fields_searched: Fields searched
            - match_count: Number of matches
            - query_string: ServiceNow query used (for debugging)
    
    Example:
        search_incidents_by_keywords_core(
            keywords=["bank", "NIGO"],
            search_fields=["short_description", "work_notes"],
            state_filter="1"
        )
    """
    logger.info(f"[search_incidents_by_keywords] Searching for keywords: {keywords}")
    
    try:
        # Validate inputs
        if not keywords or not isinstance(keywords, list) or len(keywords) == 0:
            return {
                "error": "At least one keyword is required",
                "incidents": []
            }
        
        # Default search fields if not specified
        if not search_fields:
            search_fields = ["short_description", "description", "work_notes"]
        
        # Build ServiceNow query using OR for fields and AND for keywords
        # Format: (field1LIKEkeyword1^ORfield2LIKEkeyword1^ORfield3LIKEkeyword1)^(field1LIKEkeyword2...)
        query_parts = []
        
        for keyword in keywords:
            # Sanitize keyword (remove special chars that break ServiceNow queries)
            sanitized_keyword = keyword.strip().replace("^", "").replace("&", "and")
            
            if not sanitized_keyword:
                continue
            
            # Build OR clause for this keyword across all search fields
            field_queries = []
            for field in search_fields:
                field_queries.append(f"{field}LIKE{sanitized_keyword}")
            
            # ServiceNow OR syntax: field1LIKEword^ORfield2LIKEword^ORfield3LIKEword
            # Join fields with ^OR to create proper OR logic (no parentheses needed)
            if len(field_queries) > 1:
                keyword_query = "^OR".join(field_queries)
            elif len(field_queries) == 1:
                keyword_query = field_queries[0]
            else:
                continue
            
            query_parts.append(keyword_query)
        
        if not query_parts:
            return {
                "error": "No valid keywords provided after sanitization",
                "incidents": []
            }
        
        # Join keyword groups with AND operator (^ in ServiceNow)
        # This creates: (field1LIKEword1^field2LIKEword1)^(field1LIKEword2^field2LIKEword2)
        query_string = "^".join(query_parts)
        
        # Add optional filters
        if state_filter:
            query_string += f"^state={state_filter}"
        if priority_filter:
            query_string += f"^priority={priority_filter}"
        
        # Build request URL
        url = f"{servicenow_instance}/api/now/table/incident"
        params = {
            "sysparm_query": query_string,
            "sysparm_limit": limit,
            "sysparm_display_value": "true",
            "sysparm_fields": "number,short_description,description,priority,state,opened_at,sys_created_on,assigned_to,assignment_group,work_notes"
        }
        headers = {"Accept": "application/json"}
        
        logger.info(f"[search_incidents_by_keywords] Query string: {query_string}")
        logger.info(f"[search_incidents_by_keywords] Searching across fields: {search_fields}")
        
        # Execute request
        response = requests.get(url, auth=_sn_auth(), headers=headers, params=params, timeout=30)
        response.raise_for_status()
        result = response.json()
        
        incidents = result.get("result", [])
        
        # Calculate match scores based on keyword frequency
        for incident in incidents:
            match_count = 0
            matched_fields = []
            
            # Check each field for keyword matches
            for field in search_fields:
                field_value = str(incident.get(field, "")).lower()
                for keyword in keywords:
                    if keyword.lower() in field_value:
                        match_count += 1
                        if field not in matched_fields:
                            matched_fields.append(field)
            
            incident["_match_score"] = match_count
            incident["_matched_fields"] = matched_fields
        
        # Sort by match score (higher = better)
        incidents.sort(key=lambda x: x.get("_match_score", 0), reverse=True)
        
        logger.info(f"[search_incidents_by_keywords] Found {len(incidents)} matching incidents")
        
        return {
            "incidents": incidents,
            "keywords_searched": keywords,
            "fields_searched": search_fields,
            "match_count": len(incidents),
            "query_string": query_string,
            "status": "success"
        }
        
    except requests.exceptions.RequestException as e:
        logger.error(f"[search_incidents_by_keywords] ServiceNow request error: {e}")
        return {
            "error": f"ServiceNow request failed: {str(e)}",
            "incidents": []
        }
    except Exception as e:
        logger.error(f"[search_incidents_by_keywords] Unexpected error: {e}")
        return {
            "error": f"Unexpected error: {str(e)}",
            "incidents": []
        }


def get_assignment_groups_core():
    """Get list of all available assignment groups from assignment_rules.json.
    
    Returns:
        Dict with assignment groups information
    """
    try:
        # Load assignment rules
        rules_file = os.path.join(os.path.dirname(__file__), 'assignment_rules.json')
        if not os.path.exists(rules_file):
            return {
                "error": "Assignment rules file not found",
                "groups": []
            }
        
        with open(rules_file, 'r', encoding='utf-8') as f:
            rules_data = json.load(f)
        
        groups = rules_data.get('metadata', {}).get('all_assignment_groups', [])
        
        # Build detailed info for each group
        group_details = []
        for group in groups:
            # Find rules that mention this group
            category_rules = []
            keyword_rules = []
            
            # Check category rules
            for rule in rules_data.get('rules', {}).get('category_rules', {}).get('mappings', []):
                rule_groups = rule.get('assignment_groups', [rule.get('assignment_group')] if rule.get('assignment_group') else [])
                if group in rule_groups:
                    category_rules.append(rule.get('category'))
            
            # Check keyword rules
            for rule in rules_data.get('rules', {}).get('keyword_rules', {}).get('mappings', []):
                rule_groups = rule.get('assignment_groups', [rule.get('assignment_group')] if rule.get('assignment_group') else [])
                if group in rule_groups:
                    keywords = rule.get('keywords', [rule.get('keyword')] if rule.get('keyword') else [])
                    keyword_rules.extend(keywords)
            
            group_details.append({
                "name": group,
                "categories_handled": list(set(category_rules))[:5],  # Top 5
                "keywords": list(set(keyword_rules))[:10],  # Top 10
                "specialization": _infer_specialization(group, category_rules, keyword_rules)
            })
        
        return {
            "total_groups": len(groups),
            "groups": group_details,
            "data_source": rules_data.get('metadata', {}).get('data_source', 'Unknown'),
            "last_updated": rules_data.get('metadata', {}).get('last_updated', 'Unknown')
        }
    
    except Exception as e:
        logger.error(f"[get_assignment_groups_core] Error: {e}", exc_info=True)
        return {
            "error": f"Failed to load assignment groups: {str(e)}",
            "groups": []
        }


def _infer_specialization(group_name, categories, keywords):
    """Infer specialization description from group name and patterns."""
    name_lower = group_name.lower()
    
    # Network teams
    if any(x in name_lower for x in ['network', 'infrastructure', 'connectivity']):
        return "Network operations, connectivity issues, infrastructure"
    
    # Database teams
    if 'database' in name_lower or 'db' in name_lower:
        return "Database administration, queries, performance"
    
    # Hardware teams
    if 'hardware' in name_lower:
        return "Physical hardware, servers, equipment"
    
    # Software/Application teams
    if any(x in name_lower for x in ['software', 'app', 'application']):
        return "Software applications, application support"
    
    # Service Desk
    if 'service' in name_lower or 'desk' in name_lower or 'help' in name_lower:
        return "First-line support, general inquiries, password resets"
    
    # Underwriting teams (insurance-specific)
    if any(x in name_lower for x in ['uw', 'underwriting', 'retail']):
        return "Policy underwriting, risk assessment, compliance"
    
    # ITSM teams
    if 'itsm' in name_lower:
        return "IT service management, process automation"
    
    # Use categories and keywords if specific pattern not found
    if categories:
        return f"Handles: {', '.join(categories[:3])}"
    elif keywords:
        return f"Keywords: {', '.join(keywords[:5])}"
    else:
        return "General assignment group"


def get_assignment_rules_core():
    """Get assignment routing rules and their configuration.
    
    Returns:
        Dict with rules information
    """
    try:
        # Load assignment rules
        rules_file = os.path.join(os.path.dirname(__file__), 'assignment_rules.json')
        if not os.path.exists(rules_file):
            return {
                "error": "Assignment rules file not found",
                "rules": {}
            }
        
        with open(rules_file, 'r', encoding='utf-8') as f:
            rules_data = json.load(f)
        
        rules_obj = rules_data.get('rules', {})
        
        # Format category rules
        category_rules = []
        for rule in rules_obj.get('category_rules', {}).get('mappings', []):
            category_rules.append({
                "category": rule.get('category'),
                "assignment_group": rule.get('assignment_group') or ', '.join(rule.get('assignment_groups', [])),
                "confidence": rule.get('confidence', 0),
                "sample_size": rule.get('sample_size', 0)
            })
        
        # Format keyword rules
        keyword_rules = []
        for rule in rules_obj.get('keyword_rules', {}).get('mappings', []):
            keyword_rules.append({
                "keyword": rule.get('keyword') or ', '.join(rule.get('keywords', [])),
                "assignment_group": rule.get('assignment_group') or ', '.join(rule.get('assignment_groups', [])),
                "confidence": rule.get('confidence', 0),
                "sample_size": rule.get('sample_size', 0)
            })
        
        # Format functionality rules
        functionality_rules = []
        for rule in rules_obj.get('functionality_rules', {}).get('mappings', []):
            functionality_rules.append({
                "context": rule.get('context'),
                "description": rule.get('description'),
                "assignment_groups": rule.get('assignment_groups', []),
                "confidence": rule.get('confidence', 0)
            })
        
        return {
            "category_rules": {
                "count": len(category_rules),
                "rules": category_rules
            },
            "keyword_rules": {
                "count": len(keyword_rules),
                "rules": keyword_rules
            },
            "functionality_rules": {
                "count": len(functionality_rules),
                "rules": functionality_rules
            },
            "priority_order": rules_obj.get('priority_order', []),
            "fallback": rules_obj.get('fallback', {}),
            "data_source": rules_data.get('metadata', {}).get('data_source', 'Unknown'),
            "last_updated": rules_data.get('metadata', {}).get('last_updated', 'Unknown')
        }
    
    except Exception as e:
        logger.error(f"[get_assignment_rules_core] Error: {e}", exc_info=True)
        return {
            "error": f"Failed to load assignment rules: {str(e)}",
            "rules": {}
        }
