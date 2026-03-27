from flask import Blueprint, request, jsonify
from tinydb import TinyDB, Query
import datetime
import os

feedback_bp = Blueprint('function_sequence_feedback', __name__)
DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'state_db.json'))
db = TinyDB(DB_PATH)

@feedback_bp.route('/chat_history', methods=['GET'])
def chat_history():
    import sys
    print(f"[DEBUG] /chat_history called", file=sys.stderr)
    username = request.args.get('username')
    print(f"[DEBUG] username param: {username}", file=sys.stderr)
    db_instance = TinyDB(DB_PATH)
    print(f"[DEBUG] TinyDB loaded", file=sys.stderr)
    chat_table = db_instance.table('chat_history')
    print(f"[DEBUG] chat_history table loaded, total records: {len(chat_table)}", file=sys.stderr)
    if username:
        User = Query()
        # Tolerant matching: try exact match on top-level username,
        # then try case-insensitive match, then check nested text.username
        # This makes the frontend resilient when Keycloak returns preferred_username
        # while stored records use the display `name` (e.g., 'Super User').
        try:
            # Exact or case-insensitive on top-level username
            cond_top_exact = (User.username == username)
            cond_top_ci = User.username.test(lambda s: isinstance(s, str) and s.lower() == username.lower())
            # Check nested text field if it's a dict containing a username
            cond_text_nested = User.text.test(lambda t: isinstance(t, dict) and (
                t.get('username') == username or (isinstance(t.get('username'), str) and t.get('username').lower() == username.lower())
            ))
            combined = cond_top_exact | cond_top_ci | cond_text_nested
            history = chat_table.search(combined)
        except Exception:
            # Fallback to simple equality if any Query.test error arises
            history = chat_table.search(User.username == username)
        print(f"[DEBUG] Found {len(history)} records for username {username} (tolerant match)", file=sys.stderr)
    else:
        history = chat_table.all()
        print(f"[DEBUG] Returning all {len(history)} chat records", file=sys.stderr)
    print(f"[DEBUG] Returning chat_history response", file=sys.stderr)
    response = jsonify({'chat_history': history})
    # Allow the frontend origin used in development
    response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    return response, 200


@feedback_bp.route('/function_sequence_feedback', methods=['POST', 'OPTIONS'])
def function_sequence_feedback():
    """Accept function sequence feedback from frontend and forward to internal handler."""
    # Handle CORS preflight requests explicitly to avoid running validation logic on OPTIONS
    if request.method == 'OPTIONS':
        response = jsonify({"message": "ok"})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST,OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200

    try:
        data = request.get_json(force=True)
    except Exception:
        data = request.json or {}

    try:
        result, status = handle_function_sequence_feedback(data)
    except Exception as e:
        # Log the exception and return 500
        import traceback
        traceback.print_exc()
        result, status = ({"error": str(e)}, 500)

    response = jsonify(result)
    # Allow the frontend origin (kept explicit)
    response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'POST,OPTIONS')
    return response, status
"""Generic Tool Orchestrator (legacy / transitional)

Modernized LangChain imports:
 - Removed initialize_agent (deprecated in 1.x) to prevent ImportError.
 - Layered Tool import fallbacks: core -> community -> legacy -> agents -> stub.
 - ConversationBufferMemory fallback from community -> legacy.
 - AgentType optional; some newer versions relocate or deprecate it.
"""
AgentType = None  # type: ignore
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
try:
    from langchain_community.memory import ConversationBufferMemory  # type: ignore
except Exception:  # pragma: no cover
    try:
        from langchain.memory import ConversationBufferMemory  # type: ignore
    except Exception:
        class ConversationBufferMemory:  # type: ignore
            def __init__(self, *a, **k): self.buffer = []
            def save_context(self, inputs, outputs): self.buffer.append((inputs, outputs))
            def load_memory_variables(self, inputs): return {"history": self.buffer}
try:  # Optional AgentType (safe fallback)
    from langchain.agents import AgentType  # type: ignore
except Exception:
    AgentType = None  # type: ignore
from flask import Flask, Blueprint, request, jsonify
from dotenv import load_dotenv
from tinydb import TinyDB, Query
import os
import json
import time
import traceback
from .snowaaonetool import snow_tools, get_incident_table_metadata as snow_get_incident_table_metadata
import openai
import importlib.util
from flask_cors import CORS
from .servicenowgenaitool import get_incident_table_metadata as sn_get_incident_table_metadata, generate_embeddings
from components.langgraph_flow import process_question_with_prompt_and_metadata as lg_process_question_with_prompt_and_metadata, handle_function_sequence_feedback
import requests as ext_requests
from .CustomWikiRAG import perform_wiki_rag
import numpy as np
from .agent_planner import CustomPlanner
from .agent_executor import CustomExecutor
import logging
import sys


# Load environment variables
load_dotenv()

# Set Azure OpenAI credentials from environment variables
openai.api_base = os.getenv("AZURE_OPENAI_ENDPOINT")  # type: ignore[attr-defined]
openai.api_key = os.getenv("AZURE_OPENAI_API_KEY")  # type: ignore[attr-defined]
openai.api_version = os.getenv("OPENAI_API_VERSION")  # type: ignore[attr-defined]
GPT_MODEL_NAME = os.getenv("GPT_MODEL_NAME") or "gpt-4"

app = Flask(__name__)
# Register the feedback blueprint so its routes are available under the same
# '/generic_tool_orchestrator' prefix used by the main blueprint and tests.
app.register_blueprint(feedback_bp, url_prefix="/generic_tool_orchestrator")
# Define and register your blueprint
blueprint = Blueprint("generic_tool_orchestrator", __name__)


# Also expose a top-level /chat_history route to support frontend calls to http://localhost:5000/chat_history
@app.route('/chat_history', methods=['GET'])
def chat_history_root():
    # Delegate to the blueprint handler (keeps logic in a single place)
    return chat_history()



# Initialize LangChain memory
memory = ConversationBufferMemory(memory_key="chat_history", return_messages=True)

# Define a maximum token limit for LLM
MAX_TOKEN_LIMIT = 3000

# Initialize TinyDB

# Define tables
feedback_table = db.table("feedback")
execution_table = db.table("execution")
chat_history_table = db.table("chat_history")





def get_additional_filters_from_user(prompt):
    """
    Simulate getting additional filtering criteria from the user.

    Args:
        prompt (str): The prompt to display to the user.

    Returns:
        dict: The additional filtering criteria provided by the user.
    """
    print(prompt)
    # Simulate user input for now (replace with actual user interaction in production)
    user_input = input("Enter additional filtering criteria (as JSON): ")
    try:
        filters = json.loads(user_input)
        return filters
    except json.JSONDecodeError:
        print("Invalid input. Please provide filtering criteria in JSON format.")
        return None


def store_execution_history(tool_name, inputs, outputs):
    """
    Store the execution history of a tool in TinyDB.
    """
    execution_table.insert({
        "tool_name": tool_name,
        "inputs": inputs,
        "outputs": outputs
    })


def summarize_qa_pair(question, answer):
    """
    Use the LLM to summarize a Q&A pair for efficient context storage.
    """
    summary_prompt = (
        f"Summarize the following Q&A in 1-2 sentences for context recall.\n"
        f"Q: {question}\nA: {answer}"
    )
    response = openai.chat.completions.create(  # type: ignore[attr-defined]
        model=GPT_MODEL_NAME,
        messages=[  # type: ignore[arg-type]
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": summary_prompt}
        ],
        max_tokens=100
    )
    return response.choices[0].message.content.strip()


def store_chat_message(sender, text, username=None, answer=None, liked=None, function_sequence=None, tool_outputs=None, feedback_payload=None):
    """Persist a chat message (user or server) to TinyDB chat_history table.

    Adds a numeric 'timestamp' (epoch seconds) for reliable chronological sorting.
    For server messages representing an answer (answer + function_sequence present), stores an LLM summary.
    Implements rolling retention policy to prevent unbounded growth.

    Args:
        sender: 'user' or 'server'.
        text: Raw message text or dict containing structured fields.
        username: Username for scoping; required for user messages.
        answer: Optional answer text (paired with preceding user message).
        liked: Optional boolean user feedback.
        function_sequence: Optional executed plan sequence for analytics.
        tool_outputs: Optional tool outputs snapshot.
        feedback_payload: Optional payload from frontend feedback mechanism.
    """
    # If sender is 'user', require username in text (either as dict with 'username' or as string with fallback)
    if sender == 'user':
        if isinstance(text, dict):
            if not text.get('username'):
                print('[WARN] Attempted to store user message without username. Skipping.')
                return
        else:
            print('[WARN] Attempted to store user message without username. Skipping.')
            return
    # Build metadata for all messages
    entry = {
        "sender": sender,
        "text": text,
        "username": username,
        "answer": answer,
        "liked": liked,
        "function_sequence": function_sequence,
        "tool_outputs": tool_outputs,
        "feedback_payload": feedback_payload,
        "timestamp": int(time.time())
    }
    # If this is a Q&A pair (i.e., answer and function_sequence provided), store summary
    if sender == 'server' and answer is not None and username is not None:
        entry["summary"] = summarize_qa_pair(text, answer)
    # Remove keys with None values for cleaner storage
    entry = {k: v for k, v in entry.items() if v is not None}
    chat_history_table.insert(entry)
    
    # Apply rolling retention policy per user
    _enforce_chat_retention(username)


def _enforce_chat_retention(username):
    """
    Enforce rolling retention policy for chat history to prevent unbounded TinyDB growth.
    
    Retention strategy:
    - Keep last N interactions per user (configurable via CHAT_RETENTION_LIMIT env var)
    - Always preserve liked/disliked items regardless of age (user feedback is valuable)
    - Default: 50 interactions (25 Q&A pairs) if not configured
    - Set CHAT_RETENTION_LIMIT=0 to disable retention (keep all history)
    
    Args:
        username: Username to enforce retention for
    """
    if not username:
        return
    
    # Get retention limit from environment (default: 50 messages = ~25 Q&A pairs)
    retention_limit = int(os.getenv('CHAT_RETENTION_LIMIT', '50'))
    
    # If retention is disabled (0), skip cleanup
    if retention_limit <= 0:
        return
    
    try:
        User = Query()
        # Get all messages for this user, sorted by timestamp
        all_messages = chat_history_table.search(User.username == username)
        
        if len(all_messages) <= retention_limit:
            return  # Under limit, no cleanup needed
        
        # Sort by timestamp descending (newest first)
        sorted_messages = sorted(all_messages, key=lambda m: m.get('timestamp', 0), reverse=True)
        
        # Keep: latest N messages + all liked/disliked items
        messages_to_keep = set()
        
        # 1. Keep latest N messages
        for msg in sorted_messages[:retention_limit]:
            messages_to_keep.add(msg.doc_id)
        
        # 2. Always keep liked/disliked feedback (user preferences are valuable)
        for msg in all_messages:
            if msg.get('liked') is not None:  # True or False, but not None
                messages_to_keep.add(msg.doc_id)
        
        # 3. Remove messages not in keep set
        messages_to_remove = [msg.doc_id for msg in all_messages if msg.doc_id not in messages_to_keep]
        
        if messages_to_remove:
            chat_history_table.remove(doc_ids=messages_to_remove)
            print(f"[INFO] Enforced retention for {username}: removed {len(messages_to_remove)} old messages, kept {len(messages_to_keep)}")
    
    except Exception as e:
        print(f"[WARN] Failed to enforce chat retention for {username}: {e}")


def get_last_n_summaries(username, n=5):
    """
    Retrieve the last n Q&A summaries for a user from TinyDB.
    """
    history = chat_history_table.search(Query().username == username)
    # Only keep Q&A pairs with summaries
    summaries = [msg["summary"] for msg in history if "summary" in msg]
    return summaries[-n:]


def get_top_liked_function_sequences(username, new_question, top_k=5):
    """
    For the given user and new question, find the top_k most similar liked Q&A pairs and return their function sequences.
    """
    history = chat_history_table.search((Query().username == username) & (Query().liked == True) & (Query().function_sequence.exists()))
    if not history:
        return []
    # Embed the new question
    new_q_emb = generate_embeddings([new_question])[0]
    # Embed previous questions
    prev_questions = [msg["text"] for msg in history]
    prev_embeddings = [generate_embeddings([q])[0] for q in prev_questions]
    # Compute similarities
    def cosine_similarity(a, b):
        a, b = np.array(a), np.array(b)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
    similarities = [cosine_similarity(new_q_emb, emb) for emb in prev_embeddings]
    # Get top_k indices
    top_indices = np.argsort(similarities)[-top_k:][::-1]
    return [history[i]["function_sequence"] for i in top_indices]


def register_all_blueprints(app, backend_dir="C:/dev/snowchat/backend"):
    """
    Dynamically discover and register all blueprints in the backend directory.

    Args:
        app (Flask): The Flask application instance.
        backend_dir (str): The path to the backend directory.
    """
    for root, _, files in os.walk(backend_dir):
        for file in files:
            if file.endswith(".py") and file != "__init__.py":
                module_path = os.path.join(root, file)
                module_name = os.path.relpath(module_path, backend_dir).replace("\\", ".").replace("/", ".")[:-3]

                # Dynamically import the module
                spec = importlib.util.spec_from_file_location(module_name, module_path)
                if spec and spec.loader:
                    module = importlib.util.module_from_spec(spec)
                    try:
                        spec.loader.exec_module(module)  # type: ignore[attr-defined]
                    except Exception:  # pragma: no cover
                        continue
                else:  # pragma: no cover
                    continue

                # Check if the module has a blueprint and register it
                if hasattr(module, "blueprint"):
                    app.register_blueprint(module.blueprint)
                    print(f"Registered blueprint: {module_name}")



# Load annotation commands from shared config
ANNOTATION_CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'annotation_commands.json')
with open(ANNOTATION_CONFIG_PATH, 'r', encoding='utf-8') as f:
    ANNOTATION_COMMANDS = json.load(f)
ANNOTATION_COMMAND_SET = set(a['command'] for a in ANNOTATION_COMMANDS)

def get_annotation_from_message(message):
    for cmd in ANNOTATION_COMMAND_SET:
        if cmd in (message or ''):
            return cmd
    return None


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

@blueprint.route('/orchestrate', methods=['POST'])
def orchestrate_tools():
    """
    Orchestrate tools dynamically based on the user's question and prompt using LangGraph by default,
    or AutoGen if the USE_AUTOGEN environment variable is set to true.
    Now: Use last 5 Q&A turns as context for the LLM (memory-aware chat).
    This endpoint is part of the DevCopilot backend (formerly SnowChat).
    """
    try:
        data = request.json
        question = data.get("question")
        prompt = data.get("prompt")
        username = data.get("username")  # Optionally sent from frontend

        USE_AUTOGEN = os.getenv("USE_AUTOGEN", "false").lower() == "true"

        # Sanitize the incident number if present in the question
        if question and "incident_number:" in question:
            question = question.replace("incident_number:", "").strip()
        # Store user message with username if available
        store_chat_message(
            "user",
            question if not username else {"text": question, "username": username},
            username=username,
            tool_outputs=None,
            feedback_payload=None
        )

        # --- Annotation detection (standardized) ---
        annotation = get_annotation_from_message(question)
        if annotation == "@wiki":
            # Remove @wiki from the question for cleaner RAG
            clean_question = question.replace("@wiki", "").strip()
            rag_result = perform_wiki_rag(clean_question)
            # Store server message
            store_chat_message("server", rag_result, username=username, tool_outputs=None, feedback_payload=None)
            return jsonify({"response": rag_result})

        # --- Get incident metadata (used as metadata for both flows) ---
        # Prefer ServiceNow version; fallback to snow tool variant.
        incident_metadata_resp = sn_get_incident_table_metadata()
        if isinstance(incident_metadata_resp, tuple):  # route style (Response, status)
            # Best effort extract JSON if Flask response
            try:
                incident_metadata_json = incident_metadata_resp[0].json if hasattr(incident_metadata_resp[0], 'json') else {}
            except Exception:  # pragma: no cover
                incident_metadata_json = {}
        else:
            incident_metadata_json = incident_metadata_resp if isinstance(incident_metadata_resp, dict) else {}
        reference_fields_data = (
            incident_metadata_json
            .get("metadata", {})
            .get("result", {})
            .get("referenceFieldsData", {})
            .get("incident", {})
            .get("fields", [])
        )
        metadata = reference_fields_data  # <-- Use this as metadata for both flows

        # --- Use last 5 Q&A turns as context for the LLM ---
        history = chat_history_table.all()
        # Only keep last 10 messages (5 Q&A pairs)
        history = history[-10:]
        messages = [{"role": "system", "content": "You are a ServiceNow assistant."}]
        for msg in history:
            if msg["sender"] == "user":
                # If text is a dict, extract text and username
                if isinstance(msg["text"], dict):
                    messages.append({"role": "user", "content": msg["text"]["text"]})
                else:
                    messages.append({"role": "user", "content": msg["text"]})
            elif msg["sender"] == "server":
                messages.append({"role": "assistant", "content": msg["text"]})
        messages.append({"role": "user", "content": question})

        # --- Use AutoGen orchestration if requested ---
        if USE_AUTOGEN:
            # Place your existing AutoGen orchestration logic here
            # Example placeholder:
            # result = run_autogen_orchestration(question, prompt, metadata)
            return jsonify({"response": "AutoGen orchestration not implemented in this snippet."})

        # --- Default: Use Agentic Planner/Executor orchestration ---
        plan_result = lg_process_question_with_prompt_and_metadata(messages, prompt, metadata, username=username)
        llm_plan = plan_result["function_sequence"] if isinstance(plan_result, dict) else plan_result

        planner = CustomPlanner()
        plan = planner.plan(llm_plan, snow_tools)

        executor = CustomExecutor()
        execution_results = executor.execute(plan, snow_tools)

        # Store server message and return results
        store_chat_message("server", str(execution_results), username=username, tool_outputs=None, feedback_payload=None)
        return jsonify({"plan": plan, "results": execution_results}), 200

    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

@blueprint.route('/orchestrate_old', methods=['POST'])
def orchestrate_tools_old():
    """
    Orchestrate tools dynamically based on the user's question and prompt using either LangChain Agent or AutoGen, depending on system property USE_AUTOGEN.
    """
    try:
        data = request.json
        question = data.get("question")
        prompt = data.get("prompt")
        username = data.get("username")  # Always get username from frontend if present
        metadata = data.get("metadata", {})

        USE_AUTOGEN = os.getenv("USE_AUTOGEN", "false").lower() == "true"

        # Sanitize the incident number if present in the question
        if question and "incident_number:" in question:
            question = question.replace("incident_number:", "").strip()
        # Store user message with username if available
        store_chat_message("user", question if not username else {"text": question, "username": username}, username=username, tool_outputs=None, feedback_payload=None)
        # --- LangChain-based orchestration (existing logic) ---
        incident_metadata_resp = sn_get_incident_table_metadata()
        if isinstance(incident_metadata_resp, tuple):
            try:
                incident_metadata_json = incident_metadata_resp[0].json if hasattr(incident_metadata_resp[0], 'json') else {}
            except Exception:
                incident_metadata_json = {}
        else:
            incident_metadata_json = incident_metadata_resp if isinstance(incident_metadata_resp, dict) else {}
        reference_fields_data = (
            incident_metadata_json
            .get("metadata", {})
            .get("result", {})
            .get("referenceFieldsData", {})
            .get("incident", {})
            .get("fields", [])
        )
        
        if not isinstance(reference_fields_data, list):
            reference_fields_data = []

        # (Legacy path placeholder) Provide a minimal static response since planner agent disabled.
        plan_output = "[Legacy orchestrate_old path executed; planner disabled]"
        store_chat_message("server", plan_output, username=username, tool_outputs=None, feedback_payload=None)
        return jsonify({"response": plan_output, "incident_schema_size": len(reference_fields_data)})
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

# Define the blueprint
app.register_blueprint(blueprint,url_prefix="/generic_tool_orchestrator")
# Apply CORS globally to the Flask app
CORS(app, supports_credentials=True, resources={
    r"/*": {
        "origins": ["http://localhost:3000"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

CORS(app, supports_credentials=True)

if __name__ == "__main__":
    # Register all blueprints dynamically
    register_all_blueprints(app)

def answer_with_context(messages, prompt, metadata, username=None):
    """
    Use the last 5 Q&A pairs (messages) to answer user questions about the conversation context.
    This is agentic: the LLM can summarize, answer meta-questions, or clarify context.
    """
    # Compose a prompt for the LLM to answer about the conversation
    context_prompt = (
        "You are a ServiceNow assistant. Use the following conversation history to answer the user's question. "
        "If the user asks about previous messages, summarize, clarify, or answer as needed."
    )
    full_prompt = context_prompt + (f"\n\n{prompt}" if prompt else "")
    # Add the user's latest question as the last message
    if messages[-1]["role"] != "user":
        raise ValueError("Last message must be from the user.")
    # Prepare messages for LLM
    llm_messages = messages.copy()
    llm_messages.insert(0, {"role": "system", "content": full_prompt})
    # Call OpenAI (or your LLM)
    response = openai.chat.completions.create(  # type: ignore[attr-defined]
        model=GPT_MODEL_NAME,
        messages=llm_messages,  # type: ignore[arg-type]
        max_tokens=500
    )
    return response.choices[0].message.content


def process_question_with_prompt_and_metadata(messages, prompt, metadata, username=None):
    """
    Main orchestration function. Uses conversation context to answer questions and determine function sequence.
    1. For context/meta questions, use semantic similarity to route to answer_with_context.
    2. For function sequence, use semantic search over user's liked Q&A pairs.
    3. Use last 5 Q&A summaries for LLM context to save tokens.
    """
    # Improved: Use semantic similarity to detect context/meta questions
    context_intent_examples = [
        "What did I ask earlier?",
        "Summarize our last conversation.",
        "What was the previous message?",
        "Show me the conversation history.",
        "What is the context so far?",
        "Can you recap our discussion?",
        "What did we talk about before?",
        "Give me a summary of our chat.",
        "Remind me what I said previously."
    ]
    user_question = messages[-1]["content"] if messages and messages[-1]["role"] == "user" else ""
    user_embedding = generate_embeddings([user_question])[0]
    intent_embeddings = [generate_embeddings([ex])[0] for ex in context_intent_examples]
    def cosine_similarity(a, b):
        a, b = np.array(a), np.array(b)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
    similarities = [cosine_similarity(user_embedding, emb) for emb in intent_embeddings]
    if max(similarities) > 0.8:
        return answer_with_context(messages, prompt, metadata, username)

    # 1. Retrieve last 5 Q&A summaries for context
    context_summaries = get_last_n_summaries(username, n=5)
    context_for_llm = "\n".join(context_summaries)

    # 2. Retrieve top 5 liked function sequences for similar questions
    top_function_sequences = get_top_liked_function_sequences(username, user_question, top_k=5)

    # 3. Compose LLM prompt
    orchestration_prompt = (
        f"You are a ServiceNow assistant. Here is a summary of the user's recent conversation:\n{context_for_llm}\n"
        f"The user just asked: {user_question}\n"
        f"Here are function sequences that worked well for similar questions in the past: {top_function_sequences}\n"
        f"Based on this, determine the best function sequence to answer the user's question."
    )
    response = openai.chat.completions.create(  # type: ignore[attr-defined]
        model=GPT_MODEL_NAME,
        messages=[{"role": "system", "content": orchestration_prompt}],  # type: ignore[arg-type]
        max_tokens=500
    )
    return {"function_sequence": response.choices[0].message.content.strip(), "context_used": context_summaries, "function_sequences_considered": top_function_sequences}