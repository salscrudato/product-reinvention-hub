_STATEGRAPH_IMPORT_ERROR = None
try:
    from langgraph.graph import StateGraph  # type: ignore
except Exception as e:  # pragma: no cover
    _STATEGRAPH_IMPORT_ERROR = e
    class StateGraph:  # type: ignore
        def __init__(self, *args, **kwargs):
            self._error = _STATEGRAPH_IMPORT_ERROR
            self._nodes = {}
            self._edges = []
        def add_node(self, name, fn):
            self._nodes[name] = fn
        def add_edge(self, a, b):
            self._edges.append((a,b))
    import logging
    logging.getLogger(__name__).warning(f"[langgraph_flow] Failed importing StateGraph: {_STATEGRAPH_IMPORT_ERROR}; using shim (LangGraph disabled).")
from .servicenowgenaitool import fetch_incident_table_metadata_core  # core helper for metadata
import openai
import json
import re
from .shared_registry import FUNCTION_REGISTRY  # Import FUNCTION_REGISTRY from shared_registry
from .embedding_utils import generate_embedding
from dotenv import load_dotenv  # Import load_dotenv to load environment variables
import os  # Import os to access environment variables
from tinydb import TinyDB, Query
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import TfidfVectorizer
from flask import Blueprint, request, jsonify
from flask_cors import CORS
import requests
from langsmith import trace
from typing import TypedDict, Any, List, Dict, Optional
import numpy as np
import logging
import sys
import traceback
import time

# Load environment variables from .env file
load_dotenv()

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

# Define the GPT model name with safe fallback
GPT_MODEL_NAME = os.getenv("GPT_MODEL_NAME") or "gpt-4"

# Initialize TinyDB
db = TinyDB("state_db.json")
# Define a state graph for managing the workflow
# Define the initial state

class Command:
    """Lightweight container for orchestration state.

    Attributes are intentionally dynamic/flexible; add explicit ones here so
    static analysis (pyright/pylance) recognizes them.
    """
    question: str | None
    prompt: str | None
    metadata: dict
    function_sequence: list
    results: dict
    context: dict
    errors: list
    username: str | None
    context_messages: list  # NEW: Conversation history for short-term memory

    def __init__(self, question: str | None = None, prompt: str | None = None, metadata: dict | None = None):
        self.question = question
        self.prompt = prompt
        self.metadata = metadata or {}
        self.function_sequence: list = []
        self.results: dict = {}
        self.context: dict = {}
        self.errors: list = []
        self.username: str | None = None
        self.context_messages: list = []  # NEW: Initialize conversation history

    def update_result(self, function_name, result):
        self.results[function_name] = result

    def get_result(self, function_name):
        return self.results.get(function_name)

    def to_dict(self):
        return {
            "question": self.question,
            "prompt": self.prompt,
            "metadata": self.metadata,
            "function_sequence": self.function_sequence,
            "results": self.results,
            "context": self.context,
            "errors": self.errors,
        }

# Add a TinyDB table for function sequences
function_sequence_table = db.table("function_sequences")

# Utility: Normalize LLM-generated argument names to match function's expected input schema

def normalize_arguments(function_name, arguments):
    """
    Normalize LLM-generated argument names to match the function's expected input schema.
    Uses exact and simple fuzzy matching (ignoring underscores/case).
    Now uses the Pydantic args_schema from FUNCTION_REGISTRY.
    """
    func_meta = FUNCTION_REGISTRY.get(function_name)
    canonical_args = set()
    if func_meta and hasattr(func_meta, 'args_schema') and func_meta.args_schema:
        canonical_args = set(func_meta.args_schema.__fields__.keys())
    normalized = {}
    for key, value in arguments.items():
        # Exact match
        if key in canonical_args:
            normalized[key] = value
            continue
        # Fuzzy match: ignore underscores and case
        key_norm = key.replace("_", "").lower()
        for canon in canonical_args:
            if key_norm == canon.replace("_", "").lower():
                normalized[canon] = value
                break
        else:
            # If no match, keep as-is (optional: log a warning)
            normalized[key] = value
    return normalized

# Utility: Get embedding for a question using OpenAI (or your preferred embedding model)
def get_openai_embedding(question):
    try:
        return generate_embedding(question)
    except Exception as e:
        logger.warning("[langgraph_flow] Question embedding failed: %s", e, exc_info=True)
        return None

# Utility: Compute cosine similarity between two vectors
def cosine_sim(a, b):
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

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


def extract_canonical_incident_from_chat_memory(chat_memory, current_question: str | None = None):
    """
    Extract the most relevant incident number from chat context.
    
    Priority order:
    1. Skip extraction if current_question is JIRA-related (context switch)
    2. Explicit incident mention in current_question (if provided)
    3. Recent assistant answers with incident + short description
    4. Fallback to any incident mention in chat history
    
    Args:
        chat_memory: List of conversation turns with 'text'/'answer' fields
        current_question: Current user query (optional, prioritized if provided)
        
    Returns:
        Dict {"number": "INC0010001", "short_description": "..."} or None
    """
    import re
    
    # CONTEXT SWITCH DETECTION: If current question is about JIRA, don't extract ServiceNow incidents
    if current_question:
        jira_signals = re.search(r'\b(user\s+stor(?:y|ies)|jira\s+(?:issue|ticket|story)|epic|sprint|[A-Z]{2,10}-\d+)\b', current_question, re.IGNORECASE)
        if jira_signals:
            logger.info(f"[extract_canonical] CONTEXT SWITCH: Skipping canonical incident extraction due to JIRA context: {jira_signals.group(1)}")
            return None
    
    # PRIORITY 1: Check current question for explicit incident mention
    # This ensures "How was INC0010001 resolved?" correctly extracts INC0010001
    # instead of falling back to previous context (INC0010014)
    if current_question:
        m = re.search(r"\b(INC0\d+)\b", current_question, re.IGNORECASE)
        if m:
            incident_num = m.group(1).upper()
            logger.info(f"[extract_canonical] Found explicit incident in current question: {incident_num}")
            return {"number": incident_num, "short_description": None}
    
    # PRIORITY 2: Scan chat_memory for recent incident mentions
    if not chat_memory:
        return None
    
    # iterate from newest to oldest
    for entry in reversed(chat_memory):
        text = entry.get('answer') or entry.get('text') or ''
        # look for patterns: INC number and quoted short description
        m = re.search(r"\b(INC0\d+)\b", text, re.IGNORECASE)
        q = re.search(r'"([^"]{10,200})"', text)
        if m and q:
            incident_num = m.group(1).upper()
            return {"number": incident_num, "short_description": q.group(1)}
        # fallback: if text mentions INC but not quoted description, return number only
        if m:
            incident_num = m.group(1).upper()
            return {"number": incident_num, "short_description": None}
    return None


def _compress_conversation_context(context_messages: List[Dict], current_question: str) -> str:
    """
    Compress conversation context for token optimization.
    
    Detects if current question is a follow-up (references 'this', 'that', 'those', etc.)
    and extracts only key facts from previous messages instead of full text.
    
    Args:
        context_messages: List of previous conversation messages
        current_question: Current user question
        
    Returns:
        Compressed context string or empty string if not needed
    """
    if not context_messages or len(context_messages) == 0:
        return ""
    
    # Detect follow-up patterns
    follow_up_patterns = [
        r'\b(this|that|these|those)\s+(incident|ticket|issue|request|case)\b',
        r'\b(it|them)\b',
        r'\bI\s+(am\s+)?referring\s+to\b',
        r'\b(the\s+)?(same|previous|last)\b',
        r'\babove\s+(mentioned|incident)\b'
    ]
    
    is_followup = False
    for pattern in follow_up_patterns:
        if re.search(pattern, current_question, re.IGNORECASE):
            is_followup = True
            break
    
    # If not a follow-up, skip context compression
    if not is_followup:
        return ""
    
    # Extract key facts from conversation history
    facts = []
    incidents_mentioned = set()
    topics_mentioned = set()
    
    for msg in context_messages[-5:]:  # Last 5 messages only
        content = msg.get('content', '')
        
        # Extract incident numbers
        incident_matches = re.findall(r'INC\d+', content)
        incidents_mentioned.update(incident_matches)
        
        # Extract key topics/entities
        if 'work notes' in content.lower():
            topics_mentioned.add('work_notes')
        if 'assignment group' in content.lower():
            topics_mentioned.add('assignment_group')
        if 'similar' in content.lower():
            topics_mentioned.add('similar_incidents')
        if 'priority' in content.lower():
            topics_mentioned.add('priority')
        if 'root cause' in content.lower() or 'rca' in content.lower():
            topics_mentioned.add('root_cause')
    
    # Build compressed context
    if incidents_mentioned:
        facts.append(f"Incidents in context: {', '.join(sorted(incidents_mentioned))}")
    if topics_mentioned:
        facts.append(f"Topics discussed: {', '.join(sorted(topics_mentioned))}")
    
    if not facts:
        # Fallback: just mention that conversation context exists
        return "\n[Context: Previous conversation available]\n"
    
    return "\n[Context: " + "; ".join(facts) + "]\n"


# Function to determine the sequence of function calls
def determine_function_sequence(command: Command):
    """
    Determine the sequence of functions to execute based on the user's question and metadata.
    If the user message contains '@checkpref' (from annotation config), check previous liked/disliked function sequences for the exact question or similar ones.
    Otherwise, always invoke the LLM to determine the sequence, ignoring previous preferences.
    """
    question = command.question or ""
    prompt = command.prompt or ""
    metadata = command.metadata or {}

    if not question:
        raise ValueError("Question is required.")

    annotation = get_annotation_from_message(question)
    if annotation == "@checkpref":
        FunctionSeq = Query()
        # 1. Exact match for liked function sequence
        exact_match = function_sequence_table.get((FunctionSeq.question == question) & (FunctionSeq.liked == True))
        if isinstance(exact_match, dict) and exact_match.get("function_sequence"):
            command.function_sequence = exact_match["function_sequence"]  # type: ignore[index]
            return command

        # 2. Embedding-based similarity search for highly liked function sequence
        all_liked = function_sequence_table.search(FunctionSeq.liked == True)
        if all_liked:
            q_emb = get_question_embedding(question)
            if q_emb is not None:
                best_sim: float = -1.0
                best_seq = None
                for entry in all_liked:
                    prev_emb = entry.get("embedding")
                    if not prev_emb:
                        continue
                    sim = cosine_sim(q_emb, prev_emb)  # type: ignore[arg-type]
                    if sim > best_sim:
                        best_sim = sim
                        best_seq = entry.get("function_sequence")
                if best_seq is not None and best_sim >= 0.8:
                    command.function_sequence = best_seq  # type: ignore[assignment]
                    return command


    # Annotation hint collection (soft guidance unless STRICT_ANNOTATIONS=1)
    planner_hints = []
    strict_mode = os.getenv('STRICT_ANNOTATIONS') == '1'
    import re
    if annotation in ("@code", "@wiki", "@log") or (question and question.strip().lower().startswith(('@code','@wiki','@log'))):
        q_lower = question.lower()
        # Generic explanation per annotation
        if '@code' in q_lower or annotation == '@code':
            planner_hints.append("User included @code annotation: consider code_annotation_tool for code-related summarization or analysis.")
            if strict_mode:
                command.function_sequence = [{"function_name": "code_annotation_tool", "arguments": {"question": question}}]
                return command
        if '@wiki' in q_lower or annotation == '@wiki':
            # Enhanced wiki workflow with interactive clarification
            from .wiki_clarification_engine import should_clarify_wiki_request, generate_wiki_clarification
            
            # Check if this is a clarification response (metadata will have wiki_clarification_state_id)
            wiki_state_id = metadata.get('wiki_clarification_state_id')
            
            if wiki_state_id:
                # User is responding to clarification - process and execute refined Wiki RAG
                logger.info(f"[WIKI_FLOW] Processing clarification response | state_id={wiki_state_id}")
                from .wiki_clarification_engine import get_wiki_clarification_engine
                engine = get_wiki_clarification_engine()
                
                refined = engine.process_clarification_response(wiki_state_id, question)
                
                # Execute wiki_rag_tool with refined query and correlation context
                command.function_sequence = [{
                    "function_name": "wiki_rag_tool",
                    "arguments": {
                        "question": refined['refined_question'],
                        "correlation_context": refined['correlation_context'],
                        "search_keywords": refined['search_keywords']
                    }
                }]
                logger.info(
                    f"[WIKI_FLOW] Executing refined Wiki RAG | "
                    f"keywords={refined['search_keywords']}"
                )
                return command
            
            # Check if clarification is needed
            context_messages = metadata.get('context_messages', [])
            has_annotation = '@wiki' in q_lower or annotation == '@wiki'
            
            if should_clarify_wiki_request(question, context_messages, has_annotation):
                # Generate clarification questions instead of executing immediately
                clarification = generate_wiki_clarification(question, context_messages, has_annotation)
                
                logger.info(
                    f"[WIKI_FLOW] Wiki clarification needed | "
                    f"options={len(clarification.get('suggested_options', []))}"
                )
                
                # Return special clarification command
                command.function_sequence = [{
                    "function_name": "wiki_clarification_request",
                    "arguments": {
                        "clarification_text": clarification['clarification_text'],
                        "options": clarification['suggested_options'],
                        "followup_prompt": clarification['followup_prompt'],
                        "state_id": clarification['state_id']
                    }
                }]
                # Mark this as a clarification request, not regular execution
                command.metadata['awaiting_wiki_clarification'] = True
                command.metadata['wiki_clarification_state_id'] = clarification['state_id']
                return command
            else:
                # Sufficiently specific - execute directly
                logger.info("[WIKI_FLOW] Wiki request sufficiently specific - executing directly")
                planner_hints.append("User included @wiki annotation: consider wiki_rag_tool for documentation / runbook retrieval.")
                if strict_mode:
                    command.function_sequence = [{"function_name": "wiki_rag_tool", "arguments": {"question": question}}]
                    return command
        if '@log' in q_lower or annotation == '@log':
            # Extract potential parameters to help the LLM build arguments
            rel_match = re.search(r'(\b\d+)(?:\s*)(m|min|mins|minutes)\b', q_lower)
            rel_minutes = rel_match.group(1) if rel_match else '60'
            user_match = re.search(r'\b(u|user|usr)[_-]?(\d+)\b', q_lower)
            svc_match = re.search(r'(?:service|microservice)\s+([a-zA-Z0-9._-]+)', q_lower)
            hints = ["User included @log annotation: consider DataDog observability tools (datadog_get_user_logs, datadog_get_service_traces, datadog_search_spans, datadog_auto_investigate)."]
            if user_match:
                hints.append(f"Potential user_id=u{user_match.group(2)}")
            if svc_match:
                hints.append(f"Potential service_name={svc_match.group(1)}")
            hints.append(f"Suggested relative_minutes={rel_minutes}")
            if 'investigate' in q_lower or 'what went wrong' in q_lower or 'monitor' in q_lower:
                hints.append("Question implies broad investigation; datadog_auto_investigate may be suitable.")
            planner_hints.extend(hints)
            if strict_mode:
                # Default strict path: composite investigation
                service_name = svc_match.group(1) if svc_match else 'simulated-service'
                command.function_sequence = [{"function_name": "datadog_auto_investigate", "arguments": {"question": question, "service_name": service_name, "relative_minutes": int(rel_minutes)}}]
                return command
            if '@mapping' in q_lower or annotation == '@mapping':
                planner_hints.append("User included @mapping annotation: invoke mapping_assignment_plan to stage assignment artifacts and summaries.")
                if strict_mode:
                    args_payload = {"question": question}
                    if metadata.get("assignment_link"):
                        args_payload["assignment_link"] = metadata["assignment_link"]
                    command.function_sequence = [
                        {"function_name": "mapping_assignment_plan", "arguments": args_payload}
                    ]
                    return command

    # Always use LLM to determine the function sequence (default path)
    # Build a list of function descriptions including docstrings
    
    # CRITICAL: Filter FUNCTION_REGISTRY by retrieval-selected tools if provided
    # This enforces semantic tool selection from the retrieval system
    retrieval_tools = metadata.get('retrieval_subset_tools')
    filtered_registry = FUNCTION_REGISTRY
    retrieval_constraint_msg = ""
    
    if retrieval_tools and isinstance(retrieval_tools, list) and len(retrieval_tools) > 0:
        # Create filtered registry with only retrieval-selected tools
        filtered_registry = {k: v for k, v in FUNCTION_REGISTRY.items() if k in retrieval_tools}
        logger.info(f"[determine_function_sequence] Retrieval constraint active: {len(filtered_registry)} tools allowed from {len(retrieval_tools)} retrieved (full registry: {len(FUNCTION_REGISTRY)})")
        logger.info(f"[determine_function_sequence] Allowed tools: {list(filtered_registry.keys())}")
        
        retrieval_constraint_msg = f"\nCRITICAL: RETRIEVAL SYSTEM CONSTRAINT\nThe semantic retrieval system has identified these tools as relevant for this query:\n{', '.join(retrieval_tools)}\n\nYou MUST ONLY use tools from this list. Do not use any other tools from the registry.\n"
        
        # If no valid tools after filtering, log error and fall back to full registry
        if not filtered_registry:
            logger.error(f"[determine_function_sequence] Retrieval tools resulted in empty registry! Tools: {retrieval_tools}")
            filtered_registry = FUNCTION_REGISTRY
            retrieval_constraint_msg = ""
    
    function_descriptions = []
    for fname, f in filtered_registry.items():
        doc = f.__doc__ or "No description provided."
        function_descriptions.append(f"- {fname}: {doc.strip()}")
    function_descriptions_str = "\n".join(function_descriptions)

    # --- Inject user context and memory into the prompt ---
    user_context_str = ""
    if command.username:
        user_context_str += f"\nCurrent user: {command.username}"
    if command.context.get("user_incidents"):
        user_context_str += f"\nIncidents assigned to this user:\n{json.dumps(command.context['user_incidents'], indent=2)}"
    
    # Smart context injection (TOKEN-OPTIMIZED)
    # Only adds context when needed, using compressed facts instead of full text
    compressed_context = _compress_conversation_context(
        command.context_messages or [], 
        question
    )
    if compressed_context:
        user_context_str += compressed_context
        # Add hint for planner
        user_context_str += "(Use context to resolve references like 'I am referring to...', 'this incident', 'those requirements')\n"
    
    # Legacy chat_memory (if still used)
    if command.context.get("chat_memory"):
        user_context_str += f"\nRecent chat memory (last 5 Q&A):\n{json.dumps(command.context['chat_memory'], indent=2)}"
    # If chat memory contains an explicit recent incident mention, surface it as the canonical incident
    canonical = None
    try:
        canonical = extract_canonical_incident_from_chat_memory(command.context.get('chat_memory', []))
    except Exception:
        canonical = None
    if canonical:
        command.context['canonical_incident'] = canonical
        user_context_str += f"\nCanonical incident (recently referenced):\n{json.dumps(canonical, indent=2)}"

    # Build planner hint block
    hints_block = "" if not planner_hints else ("\nPLANNER_HINTS:\n" + "\n".join(planner_hints) + "\n")

    # ═══════════════════════════════════════════════════════════════════════
    # PRE-ANALYSIS GUIDANCE INJECTION
    # ═══════════════════════════════════════════════════════════════════════
    # If pre-analysis was run, inject its guidance to help planner make better decisions
    pre_analysis_guidance = ""
    pre_analysis = metadata.get('pre_analysis', {})
    if pre_analysis and pre_analysis.get('action') == 'proceed' and pre_analysis.get('confidence', 0) > 0.6:
        pre_analysis_guidance = f"""
════════════════════════════════════════════════════════════════════════
PRE-ANALYSIS GUIDANCE (Scope Validated & Context Enriched)
════════════════════════════════════════════════════════════════════════

Intent Detected: {pre_analysis.get('intent', 'unknown')}
Operation Mode: {pre_analysis.get('operation_mode', 'single')}

"""
        
        # Add temporal context if available
        temporal = pre_analysis.get('temporal_context', {})
        if temporal:
            pre_analysis_guidance += f"""TEMPORAL CONTEXT:
  Current Date: {temporal.get('current_date', 'N/A')}
  User Reference: "{temporal.get('user_reference', 'N/A')}"
  Calculated Range: {temporal.get('calculated_range', {})}
  Requires Time Component: {temporal.get('requires_time_component', False)}

"""
        
        # Add incident scope if available
        incident_scope = pre_analysis.get('incident_scope', {})
        if incident_scope:
            pre_analysis_guidance += f"""INCIDENT SCOPE:
  Source: {incident_scope.get('source', 'N/A')}
  Count: {incident_scope.get('count', 'N/A')}
  Filter: {incident_scope.get('filter', 'None')}
  Canonical Incident: {incident_scope.get('canonical_incident', 'None')}

"""
        
        # Add format requirements if available
        format_reqs = pre_analysis.get('format_requirements', {})
        if format_reqs:
            pre_analysis_guidance += f"""FORMAT REQUIREMENTS:
  DateTime Format: {format_reqs.get('datetime_format', 'N/A')}
  Batch Size Limit: {format_reqs.get('batch_size_limit', 'N/A')}
  Aggregation Needed: {format_reqs.get('aggregation_needed', False)}

"""
        
        # Add planner hints from pre-analysis
        pa_hints = pre_analysis.get('planner_hints', [])
        if pa_hints:
            pre_analysis_guidance += f"""SPECIFIC PLANNING HINTS:
"""
            for hint in pa_hints:
                pre_analysis_guidance += f"  • {hint}\n"
        
        pre_analysis_guidance += f"""
PRE-ANALYSIS CONFIDENCE: {pre_analysis.get('confidence', 0):.2f}

Use this guidance to create your plan. The pre-analyzer has already:
✓ Validated this request is within system capabilities
✓ Extracted temporal context (no need to guess dates from training data)
✓ Identified operation mode (single vs bulk processing)
✓ Determined format requirements
✓ Analyzed user's true intent

Build your function sequence based on this pre-analysis.
════════════════════════════════════════════════════════════════════════

"""

    # CRITICAL FIX: Inject current date so LLM can calculate relative dates correctly
    from datetime import datetime, timedelta
    current_date = datetime.now().strftime("%Y-%m-%d")
    example_3_days_ago = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
    current_date_info = f"\n{'='*80}\nCRITICAL: Current Date Information\nToday's date is: {current_date}\n\nWhen calculating date ranges:\n- 'last N days' means from {example_3_days_ago} to {current_date} (for N=3)\n- 'last N weeks' means N*7 days back from today\n- Always use YYYY-MM-DD format for start_date and end_date parameters\n- Calculate dates relative to {current_date}, NOT from your training data\n{'='*80}\n\n"

    llm_prompt = f"""
    You are a ServiceNow assistant. Based on the user's question, prompt, metadata, and context, determine which functions to call 
    from the following list (with descriptions):
    {function_descriptions_str}
    
    {retrieval_constraint_msg}
    {pre_analysis_guidance}
    {current_date_info}
    CONTEXT:{user_context_str}
    {hints_block}

    IMPORTANT: Context-Aware Planning:
    - If the user says "I am referring to...", "about that", "this incident", etc., check the CONTEXT above to understand WHAT they are referring to
    - If previous question asked about "Assignment Groups for incidents today", and current question says "referring to incidents in last 3 days", 
      the user wants the SAME information (Assignment Groups) but for a different time period (3 days instead of today)
    - Generate a plan that answers the COMPLETE intent, not just the literal words in the current question
    - Use entities from metadata and context to resolve references

    IMPORTANT: Tool Selection Rules:
    - If the user's question is to retrieve a specific field (such as "short description", "status", etc.) for a given incident number, ONLY call fetch_servicenow_incident.
    - Do NOT call get_similar_incidents unless the user explicitly asks to find incidents similar to a description or requests a similarity search.
    - Do NOT chain fetch_servicenow_incident and get_similar_incidents unless the user requests both actions in their question.
    - get_similar_incidents is for finding incidents similar to a provided description, NOT for retrieving fields from a specific incident.
    - For field lookups by incident number, do not invoke any other tool except fetch_servicenow_incident.
    
    CRITICAL: Search vs Similarity Distinction:
    - Use run_incident_query for keyword filtering/search (e.g., "incidents with PAS and NIGO", "priority 1 incidents", "incidents assigned to team X")
    - Use get_similar_incidents for semantic similarity (e.g., "find incidents similar to 'server crashed'", "incidents like this description")
    - run_incident_query uses direct ServiceNow queries with LIKE/IN operators - FAST and EXACT keyword matching
    - get_similar_incidents uses FAISS embeddings - SLOW and SEMANTIC similarity
    - For queries with keywords like "overview", "all incidents", "list", "filter", "PAS", "NIGO" -> use run_incident_query
    - For queries with "similar to", "like this", "resembling" -> use get_similar_incidents
    
    CRITICAL: Compound Search + Analysis Queries:
    - If user asks to "find all X incidents AND suggest root cause/solution/workaround", create a multi-step plan:
      Step 1: run_incident_query to find matching incidents
      Step 2: summarize_incident_work_notes for EACH incident found (use the incident numbers from Step 1)
    - Example: "find all MIB incidents and suggest root cause" -> run_incident_query + multiple summarize_incident_work_notes
    - Example: "list remittance incidents and show their resolutions" -> run_incident_query + multiple summarize_incident_work_notes
    - The run_incident_query will return a list of incidents; plan to analyze each one with summarize_incident_work_notes
    - Limit to analyzing the first 5-10 incidents for performance (use limit parameter in run_incident_query)

    IMPORTANT: Annotation and output rules:
    - NEVER generate annotation tokens that start with '@' (for example '@code' or '@wiki') unless the USER literally included that token in their question.
    - Your output MUST be valid JSON. Do not include any extraneous commentary outside of the JSON structure.
    - Return only the allowed function names as they appear in the registry; do not invent new function names or prefixes.
    
    PLANNING ENHANCEMENTS (ML Model Integration):
    - The metadata may contain 'intent_confidence' (0.0-1.0) from ML intent classification model
    - If confidence < 0.7, consider adding exploratory tools or ask for clarification
    - The metadata may contain 'related_questions' from contextual suggestion model - use these to understand user's broader intent
    - Example: If related_questions include "find similar incidents", consider adding get_similar_incidents even if not explicitly asked

    Question: "{question}"
    Prompt: "{prompt}"
    Metadata: {json.dumps(metadata, indent=2)}

    Respond with a JSON object containing the sequence of functions to call, their arguments, 
    and which function's output should be passed as input to the next function.
    Example:
    {{
        "function_calls": [
            {{"function_name": "get_similar_incidents", "arguments": {{"short_description": "Server is down"}}}}
        ]
    }}
    """

    messages = [
        {"role": "system", "content": "You are a ServiceNow assistant."},
        {"role": "user", "content": llm_prompt}
    ]

    try:
        primary_start = time.time()
        try:
            chat_completion = get_openai_chat_completion(  # type: ignore[attr-defined]
                model=GPT_MODEL_NAME,
                messages=messages,  # type: ignore[arg-type]
                max_tokens=500,
                temperature=0.0
            )
        except Exception as primary_exc:
            # Collect rich diagnostics similar to retry path
            diag = {
                "phase": "primary",
                "error_type": type(primary_exc).__name__,
                "error_str": str(primary_exc),
                "error_repr": repr(primary_exc),
                "model": GPT_MODEL_NAME,
                "endpoint": os.getenv('OPENAI_API_BASE') or os.getenv('AZURE_OPENAI_ENDPOINT') or os.getenv('OPENAI_API_HOST'),
                "api_version": os.getenv('OPENAI_API_VERSION'),
                "timeout_env": os.getenv('OPENAI_TIMEOUT'),
            }
            for attr in ["status_code", "status", "response", "request_id"]:
                if hasattr(primary_exc, attr):
                    try:
                        val = getattr(primary_exc, attr)
                        if isinstance(val, (bytes, bytearray)):
                            val = val[:500].decode('utf-8', errors='ignore')
                        diag[attr] = str(val)[:1000]
                    except Exception:
                        pass
            try:
                resp = getattr(primary_exc, 'response', None)
                if resp and hasattr(resp, 'json'):
                    rj = None
                    try:
                        rj = resp.json()
                    except Exception:
                        txt = getattr(resp, 'text', '')
                        rj = txt[:1000]
                    diag['response_body'] = rj
            except Exception:
                pass
            tb = traceback.format_exc(limit=8)
            logger.error(f"[determine_function_sequence][primary][exception] diagnostics={json.dumps(diag, default=str)} traceback={tb}")
            # Propagate for outer catch block to record planner error
            raise

        latency_ms_primary = int((time.time() - primary_start) * 1000)
        raw_response = ''
        try:
            raw_response = chat_completion.choices[0].message.content
        except Exception:
            raw_response = str(chat_completion)
        logger.info(f"[determine_function_sequence] raw planner response (latency={latency_ms_primary}ms): {raw_response}")
        # Telemetry: persist raw planner response for offline analysis
        try:
            logger.info(f"[planner_telemetry] QUESTION={question} LATENCY_MS={latency_ms_primary} RAW_RESPONSE={raw_response}")
        except Exception as te:
            logger.warning(f"Could not log planner telemetry: {te}")

        # Parse JSON and enforce strict schema
        function_sequence = json.loads(raw_response)
        # Defensive validation: ensure returned function names are registered
        returned_calls = function_sequence.get("function_calls") or function_sequence.get("function_sequence") or []
        invalid = []
        for fc in returned_calls:
            fname = fc.get("function_name")
            if not fname:
                invalid.append((fc, 'missing function_name'))
                continue
            # disallow any annotation tokens
            if isinstance(fname, str) and fname.strip().startswith("@"):
                invalid.append((fc, 'annotated function_name'))
                continue
            if fname not in FUNCTION_REGISTRY:
                invalid.append((fc, 'unknown function_name'))

        if invalid:
            # Attempt one strict retry before failing
            logger.warning(f"[determine_function_sequence] Planner returned invalid function calls: {invalid}. Attempting one strict retry.")
            # build very strict prompt with allowed function names
            allowed_names = sorted(list(FUNCTION_REGISTRY.keys()))
            strict_note = (
                "STRICT MODE: You must return valid JSON with key 'function_calls'.\n"
                "Only use these function names: " + ", ".join(allowed_names) + ".\n"
                "Do NOT generate annotations starting with '@'. Do not invent names. If you cannot determine a function, return an empty list."
            )
            messages_retry = [
                {"role": "system", "content": "You are a ServiceNow assistant."},
                {"role": "user", "content": strict_note + "\nOriginal prompt:\n" + llm_prompt}
            ]
            try:
                retry_start = time.time()
                try:
                    chat_completion2 = get_openai_chat_completion(  # type: ignore[attr-defined]
                        model=GPT_MODEL_NAME,
                        messages=messages_retry,  # type: ignore[arg-type]
                        max_tokens=500,
                        temperature=0.0
                    )
                except Exception as retry_exc:
                    # Gather rich diagnostics for connection / auth errors
                    diag = {
                        "error_type": type(retry_exc).__name__,
                        "error_str": str(retry_exc),
                        "error_repr": repr(retry_exc),
                        "model": GPT_MODEL_NAME,
                        "endpoint": os.getenv('OPENAI_API_BASE') or os.getenv('AZURE_OPENAI_ENDPOINT') or os.getenv('OPENAI_API_HOST'),
                        "api_version": os.getenv('OPENAI_API_VERSION'),
                        "timeout_env": os.getenv('OPENAI_TIMEOUT'),
                    }
                    # OpenAI / Azure specific attributes (best-effort)
                    for attr in ["status_code", "status", "response", "request_id"]:
                        if hasattr(retry_exc, attr):
                            try:
                                val = getattr(retry_exc, attr)
                                if isinstance(val, (bytes, bytearray)):
                                    val = val[:500].decode('utf-8', errors='ignore')
                                diag[attr] = str(val)[:1000]
                            except Exception:
                                pass
                    # If the exception has a .response with JSON, attempt to extract
                    try:
                        resp = getattr(retry_exc, 'response', None)
                        if resp and hasattr(resp, 'json'):
                            rj = None
                            try:
                                rj = resp.json()
                            except Exception:
                                # maybe .text
                                txt = getattr(resp, 'text', '')
                                rj = txt[:1000]
                            diag['response_body'] = rj
                    except Exception:
                        pass
                    tb = traceback.format_exc(limit=8)
                    logger.error(f"[determine_function_sequence][retry][exception] diagnostics={json.dumps(diag, default=str)} traceback={tb}")
                    # Surface succinct message for downstream handling
                    raise

                latency_ms = int((time.time() - retry_start) * 1000)
                raw_response2 = ''
                try:
                    raw_response2 = chat_completion2.choices[0].message.content
                except Exception:
                    raw_response2 = str(chat_completion2)
                logger.info(f"[determine_function_sequence] raw planner retry response (latency={latency_ms}ms): {raw_response2}")
                # telemetry
                try:
                    logger.info(f"[planner_telemetry][RETRY] QUESTION={question} LATENCY_MS={latency_ms} RAW_RESPONSE={raw_response2}")
                except Exception:
                    pass

                function_sequence2 = json.loads(raw_response2)
                returned_calls2 = function_sequence2.get("function_calls") or function_sequence2.get("function_sequence") or []
                invalid2 = []
                for fc in returned_calls2:
                    fname = fc.get("function_name")
                    if not fname or (isinstance(fname, str) and fname.strip().startswith('@')) or fname not in FUNCTION_REGISTRY:
                        invalid2.append((fc, 'invalid on retry'))
                if invalid2:
                    logger.error(f"[determine_function_sequence] Retry also returned invalid calls: {invalid2}. Asking for user clarification.")
                    command.errors.append("Planner produced invalid function calls after retry; clarification required.")
                    command.context['clarify_user'] = True
                    return command
                # accept retry
                command.function_sequence = returned_calls2
                embedding = get_question_embedding(question)
                function_sequence_table.insert({
                    "question": question,
                    "prompt": prompt,
                    "metadata": metadata,
                    "function_sequence": command.function_sequence,
                    "liked": False,
                    "embedding": embedding,
                    "timestamp": __import__('datetime').datetime.utcnow().isoformat()
                })
                return command
            except Exception as exc:
                logger.error(f"[determine_function_sequence] Retry failed: {exc}")
                command.errors.append("Planner retry failed; clarification required.")
                command.context['clarify_user'] = True
                return command

        # No invalid entries: accept the original response
        command.function_sequence = returned_calls
        embedding = get_question_embedding(question)
        function_sequence_table.insert({
            "question": question,
            "prompt": prompt,
            "metadata": metadata,
            "function_sequence": command.function_sequence,
            "liked": False,
            "embedding": embedding,
            "timestamp": __import__('datetime').datetime.utcnow().isoformat()
        })
        return command
    except Exception as e:
        command.errors.append(f"Error in determining function sequence: {str(e)}")
        return command

def execute_function(command: Command, function_call):
    """
    Execute a single function based on the function call details.

    Args:
        command (Command): The current command object.
        function_call (dict): Details of the function to execute.

    Returns:
        Command: Updated command with the function result.
    """
    function_name = function_call["function_name"]
    arguments = function_call["arguments"]

    # Resolve dynamic arguments (e.g., output of previous functions)
    for key, value in arguments.items():
        if isinstance(value, str) and value.startswith("output_of_"):
            previous_function = value.replace("output_of_", "")
            arguments[key] = command.get_result(previous_function)

    # Normalize argument names to match function's input schema
    arguments = normalize_arguments(function_name, arguments)

    # Call the function
    if function_name not in FUNCTION_REGISTRY:
        command.errors.append(f"Function '{function_name}' is not registered.")
        return command
    try:
        func_entry = FUNCTION_REGISTRY[function_name]
        func = func_entry["function"] if isinstance(func_entry, dict) else func_entry
        result = func(**arguments)
        command.update_result(function_name, result)
    except Exception as e:
        command.errors.append(f"Error running {function_name}: {str(e)}")
    return command

def should_continue_or_adjust_plan(command: Command):
    """
    Only check if the user's question is resolved based on the results so far. Do not ask the LLM to hallucinate new plans or functions.
    If the question is resolved, return None to stop. Otherwise, return the current function sequence (filtered for valid functions).
    """
    # Simple exit criteria: if the last function in the sequence has a result, consider the question resolved
    if command.function_sequence:
        last_func = command.function_sequence[-1]["function_name"]
        if last_func in command.results and command.results[last_func]:
            return None  # Stop execution, question is resolved
    # Filter out any functions not in the registry (defensive)
    filtered_sequence = [fc for fc in command.function_sequence if fc.get("function_name") in FUNCTION_REGISTRY]
    return filtered_sequence if filtered_sequence else None

# Function to execute the entire sequence (autonomous version)
def execute_function_sequence(command: Command):
    """
    Execute the sequence of functions determined by the LLM, allowing for dynamic plan adjustment after each step.
    Now, only manages the sequence from determine_function_sequence, and stops if the last function has a result.
    """
    raw_schema = fetch_incident_table_metadata_core()
    if isinstance(raw_schema, dict) and not raw_schema.get('error'):
        reference_fields_data = raw_schema.get("result", {}).get("referenceFieldsData", {})  # type: ignore[assignment]
        incidentFieldsSchema = reference_fields_data.get("incident", {}).get("fields", {}) or {}
    else:
        incidentFieldsSchema = {}
    i = 0
    while i < len(command.function_sequence):
        function_call = command.function_sequence[i]
        # If there is a next function, use LLM to decide next function's arguments
        if i < len(command.function_sequence) - 1:
            # Use LLM to decide what to pass to the next function
            # Deterministic override: if the next function needs incident context and
            # we have a canonical incident extracted from chat memory, prefer that.
            next_fc = command.function_sequence[i + 1]
            next_input = {}
            
            # List of tools that require incident_number from context
            incident_tools = [
                "get_similar_incidents",
                "get_incident_work_notes", 
                "summarize_incident_work_notes",
                "summarize_work_notes",  # Enhanced work notes summary tool
                "add_incident_work_note",
                "update_incident",
                "get_incident_comments"
            ]
            
            try:
                next_func_name = next_fc.get("function_name")
                canonical = command.context.get('canonical_incident')
                
                # If next tool needs incident context AND we have canonical incident
                if next_func_name in incident_tools and canonical:
                    # prefer passing incident_number if available
                    if canonical.get('number'):
                        next_input.update({"incident_number": canonical.get('number')})
                    elif canonical.get('short_description'):
                        next_input.update({"short_description": canonical.get('short_description')})
                    else:
                        # fallback to LLM decision if canonical incident has no usable fields
                        next_input = decide_next_input_command(command, incidentFieldsSchema)
                else:
                    next_input = decide_next_input_command(command, incidentFieldsSchema)
            except Exception as e:
                # On any error, fall back to LLM decision
                command.errors.append(f"Error determining next input deterministically: {e}")
                next_input = decide_next_input_command(command, incidentFieldsSchema)
            # Update the arguments for the next function in the sequence
            command.function_sequence[i + 1]["arguments"].update(next_input)
        command = execute_function(command, function_call)
        db.insert({"step": i, "command": command.to_dict()})
        # If this is the last function, break
        if i == len(command.function_sequence) - 1:
            break
        i += 1

    # If there is only one function or after all functions are executed, use LLM to extract the final answer
    if len(command.function_sequence) == 1 or i == len(command.function_sequence) - 1:
        try:
            # Prepare context for LLM to extract the answer
            context_str = ""
            if hasattr(command, "username") and command.username:
                context_str += f"\nCurrent user: {command.username}"
            if command.context.get("user_incidents"):
                context_str += f"\nIncidents assigned to this user:\n{json.dumps(command.context['user_incidents'], indent=2)}"
            if command.context.get("chat_memory"):
                context_str += f"\nRecent chat memory (last 5 Q&A):\n{json.dumps(command.context['chat_memory'], indent=2)}"

            answer_prompt = f"""
            You are a ServiceNow assistant. The user's question is: "{command.question or 'No question provided'}".
            CONTEXT:{context_str}
            Here are the results of the function(s) executed:
            {json.dumps(command.results, indent=2)}
            Based on the above, extract and return the answer to the user's question as a short, direct response.
            """
            response = get_openai_chat_completion(  # type: ignore[attr-defined]
                model=GPT_MODEL_NAME,
                messages=[  # type: ignore[arg-type]
                    {"role": "system", "content": "You are a ServiceNow assistant."},
                    {"role": "user", "content": answer_prompt}
                ],
                max_tokens=500,
                temperature=0.0
            )
            command.context["final_answer"] = response.choices[0].message.content.strip()
        except Exception as e:
            command.errors.append(f"Error extracting final answer: {str(e)}")
    # If no function sequence and marked for direct LLM answer, answer directly
    if getattr(command, 'context', {}).get('llm_direct_answer', False):
        context_str = ""
        if hasattr(command, "username") and command.username:
            context_str += f"\nCurrent user: {command.username}"
        if command.context.get("user_incidents"):
            context_str += f"\nIncidents assigned to this user:\n{json.dumps(command.context['user_incidents'], indent=2)}"
        if command.context.get("chat_memory"):
            context_str += f"\nRecent chat memory (last 5 Q&A):\n{json.dumps(command.context['chat_memory'], indent=2)}"
        answer_prompt = f"""
        You are DevCopilot, an intelligent assistant. The user's question is: \"{command.question or 'No question provided'}\".
        CONTEXT:{context_str}
        Answer the user's question as helpfully and concisely as possible, using the context above if relevant.
        """
        try:
            response = get_openai_chat_completion(  # type: ignore[attr-defined]
                model=GPT_MODEL_NAME,
                messages=[  # type: ignore[arg-type]
                    {"role": "system", "content": "You are DevCopilot, an intelligent assistant."},
                    {"role": "user", "content": answer_prompt}
                ],
                max_tokens=500,
                temperature=0.0
            )
            command.context["final_answer"] = response.choices[0].message.content.strip()
        except Exception as e:
            command.errors.append(f"Error extracting direct LLM answer: {str(e)}")
    return command

# Define the LangGraph flow
class LangGraphFlowState(TypedDict, total=False):
    messages: List[Any]
    prompt: str
    metadata: Dict[str, Any]
    username: Optional[str]
    tool_outputs: Dict[str, Any]
    plan: List[Any]
    plan_step: int
    done: Optional[bool]
    planner_error: Optional[str]
    planner_traceback: Optional[str]
    toolrunner_error: Optional[str]
    toolrunner_traceback: Optional[str]
    question: Optional[str]
    context_messages: Optional[List[Any]]

# (Optional) LangGraph wiring retained but type-ignored to avoid static signature mismatch.
graph = None
try:
    if _STATEGRAPH_IMPORT_ERROR is None:
        graph = StateGraph(state_schema=LangGraphFlowState)  # type: ignore[call-arg]
        graph.add_node("START", lambda state: state)  # type: ignore[arg-type]
        graph.add_node("Determine Function Sequence", lambda state: state)  # type: ignore[arg-type]
        graph.add_node("Execute Function Sequence", lambda state: state)  # type: ignore[arg-type]
        graph.add_edge("START", "Determine Function Sequence")  # type: ignore[arg-type]
        graph.add_edge("Determine Function Sequence", "Execute Function Sequence")  # type: ignore[arg-type]
    else:
        # Skip wiring when shim active; optional: expose diagnostic
        graph = StateGraph()  # type: ignore[call-arg]
except Exception as gw_err:  # pragma: no cover
    import logging
    logging.getLogger(__name__).warning(f"[langgraph_flow] Graph wiring failed: {gw_err}; continuing without LangGraph flow.")


# Helper: Similarity search between next function's expected arguments and previous results
def similarity_search_on_results(next_function_args, previous_results, top_k=1):
    """
    For each argument in next_function_args, find the most similar value from previous_results using TF-IDF and cosine similarity.
    Args:
        next_function_args (list[str]): List of argument names (or descriptions) expected by the next function.
        previous_results (dict): Dict of {function_name: result_dict} from previous steps.
        top_k (int): Number of top matches to return per argument.
    Returns:
        dict: {arg_name: (function_name, value)} for the most similar previous result for each argument.
    """
    # Flatten previous results to a list of (function_name, key, value) tuples
    flattened = []
    for func, res in previous_results.items():
        if isinstance(res, dict):
            for k, v in res.items():
                flattened.append((func, k, str(v)))
        else:
            flattened.append((func, func, str(res)))
    
    # Prepare corpus: all previous result keys and values
    corpus = [f"{func} {k} {v}" for func, k, v in flattened]
    arg_to_best = {}
    for arg in next_function_args:
        # Vectorize argument and corpus
        texts = [arg] + corpus
        vectorizer = TfidfVectorizer().fit(texts)
        arg_vec = vectorizer.transform([arg])
        corpus_vecs = vectorizer.transform(corpus)
        # Compute cosine similarity
        sims = cosine_similarity(arg_vec, corpus_vecs)[0]
        # Get top_k most similar
        if len(sims) == 0:
            continue
        top_indices = sims.argsort()[::-1][:top_k]
        matches = [flattened[i] for i in top_indices]
        # For top match, return (function_name, value)
        if matches:
            func, k, v = matches[0]
            arg_to_best[arg] = {"source_function": func, "source_key": k, "value": v, "similarity": float(sims[top_indices[0]])}
    return arg_to_best

def decide_next_input_command(command: Command, incident_schema):
    """
    Use OpenAI to decide which data from the last function's output should be passed to the next function.

    Args:
        command (Command): The current command object.
        incident_schema (dict): The schema of the incident table.

    Returns:
        dict: The data to pass to the next function.
    """
    # Extract the function sequence from the state
    function_sequence = command.function_sequence

    # Find the next function and its arguments
    current_idx = 0
    for idx, fc in enumerate(function_sequence):
        if fc["function_name"] not in command.results:
            current_idx = idx
            break
    next_func = function_sequence[current_idx] if current_idx < len(function_sequence) else None
    next_func_args = list(next_func["arguments"].keys()) if next_func else []
    # Similarity search on previous results for next function's arguments
    # Only perform similarity search if there are previous results
    if command.results:
        similar_results = similarity_search_on_results(next_func_args, command.results)
    else:
        similar_results = {}
    # Define the prompt for OpenAI
    prompt = f"""
    You are an intelligent ServiceNow assistant tasked with dynamically solving a user's question related to ServiceNow incidents.
    Your goal is to decide what data from the last function's output should be passed to the next function in the sequence.

    The user's question is: \"{command.question or 'No question provided'}\"

    Here is the schema of the incident table:
    {json.dumps(incident_schema, indent=2)}

    Here is the function sequence:
    {json.dumps(function_sequence, indent=2)}

    Here are the results so far:
    {json.dumps(command.results, indent=2)}

    Here are the most relevant previous results for the next function's arguments (by similarity):
    {json.dumps(similar_results, indent=2)}

    Based on the above context, decide which fields from the last function's output should be passed to the next function.
    Respond with a JSON object containing the data to pass to the next function. Be concise and specific in your response.
    """

    # Call OpenAI GPT
    try:
        response = openai.chat.completions.create(  # type: ignore[attr-defined]
            model=GPT_MODEL_NAME,
            messages=[  # type: ignore[arg-type]
                {"role": "system", "content": "You are an intelligent ServiceNow assistant."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=500,
            temperature=0.0
        )
        content = response.choices[0].message.content or "{}"
        try:
            next_input = json.loads(content)
        except json.JSONDecodeError:
            next_input = {}
        return next_input
    except Exception as e:
        command.errors.append(f"Error in OpenAI call for next input: {str(e)}")
        return {}

def _sn_auth():
    user = os.getenv("SERVICENOW_USER")
    pwd = os.getenv("SERVICENOW_PASSWORD")
    if user and pwd:
        return (user, pwd)  # type: ignore[return-value]
    return None

def fetch_user_incidents(username, limit=10):
    """Fetch incidents assigned to the user from ServiceNow (best-effort)."""
    url = f"{os.getenv('SERVICENOW_INSTANCE')}/api/now/table/incident"
    params = {"sysparm_limit": limit, "u_assigned_to": username}
    try:
        response = requests.get(url, params=params, auth=_sn_auth())
        response.raise_for_status()
        return response.json().get("result", [])
    except Exception as e:  # pragma: no cover
        logger.warning(f"Failed to fetch user incidents: {e}")
        return []

def fetch_last_5_qa_pairs(username):
    """
    Fetch the last 5 Q&A pairs for the user from chat_history.
    """
    chat_table = db.table("chat_history")
    # Get all messages for this user
    messages = chat_table.search((Query().username == username))
    # Sort by insertion order or timestamp if available
    messages = sorted(messages, key=lambda x: x.get("timestamp", 0))
    # Build Q&A pairs (user, then server)
    qa_pairs = []
    i = 0
    while i < len(messages) - 1:
        if messages[i]["sender"] == "user" and messages[i+1]["sender"] == "server":
            qa_pairs.append({
                "question": messages[i]["text"],
                "answer": messages[i+1]["text"]
            })
            if len(qa_pairs) == 5:
                break
            i += 2
        else:
            i += 1
    return qa_pairs[-5:] if len(qa_pairs) > 5 else qa_pairs

def process_question_with_prompt_and_metadata(question, prompt, metadata, username=None, agentic_mode=False, retrieval_subset_tools=None):  # type: ignore[override]
    # Shortcut: If the user asks about their identity, answer directly with the username
    if question and question.strip().lower() in [
        "who am i?", "what is my username?", "who is the current user?", "who's logged in?", "who is logged in?", "what user am i?", "what's my username?", "who signed in?", "who signed in as?"]:
        return {
            "final_answer": f"You are signed in as: {username}",
            "function_sequence": [],
            "user_incidents": [],
            "chat_memory": [],
            "feedback_payload": {
                "question": question,
                "function_sequence": []
            }
        }
    # ...existing code for context injection and LLM orchestration...
    command = Command(question=question, prompt=prompt, metadata=metadata)
    
    # NEW: Pass retrieval_subset_tools via metadata for determine_function_sequence
    if retrieval_subset_tools and isinstance(retrieval_subset_tools, list):
        command.metadata['retrieval_subset_tools'] = retrieval_subset_tools
        logger.info(f"[PROCESS] Retrieval tools passed to planner: {retrieval_subset_tools}")
    
    # NEW: Extract context_messages from metadata for short-term memory
    # This enables follow-up question understanding ("I am referring to...")
    context_msgs = metadata.get("context_messages", [])
    if context_msgs and isinstance(context_msgs, list):
        command.context_messages = context_msgs
        logger.info(f"[PROCESS] Context messages loaded: {len(context_msgs)} messages for conversation history")
    
    if username:
        try:
            user_incidents = fetch_user_incidents(username)
        except Exception as e:
            logger.warning(f"Failed to fetch user incidents for {username}: {e}")
            user_incidents = []
        command.context["user_incidents"] = [
            {"number": inc.get("number"), "short_description": inc.get("short_description")} for inc in user_incidents
        ]
        command.context["chat_memory"] = fetch_last_5_qa_pairs(username)
        # extract canonical incident from chat memory if present
        try:
            canonical = extract_canonical_incident_from_chat_memory(command.context.get('chat_memory', []))
            if canonical:
                command.context['canonical_incident'] = canonical
        except Exception:
            pass
    command.username = username
    command = determine_function_sequence(command)
    # Enterprise error handling: abort if no function sequence determined
    if not command.function_sequence:
        return {
            "final_answer": None,
            "error": {
                "code": 100001,
                "message": "System error: No functions identified in determine_function_sequence to execute."
            },
            "function_sequence": [],
            "user_incidents": command.context.get("user_incidents", []),
            "chat_memory": command.context.get("chat_memory", []),
            "feedback_payload": {
                "question": command.question,
                "function_sequence": []
            }
        }
    # Only execute function sequence if not in agentic_mode
    if not agentic_mode:
        command = execute_function_sequence(command)
    return {
        "final_answer": command.context.get("final_answer"),
        "function_sequence": command.function_sequence,
        "user_incidents": command.context.get("user_incidents", []),
        "chat_memory": command.context.get("chat_memory", []),
        "feedback_payload": {
            "question": command.question,
            "function_sequence": command.function_sequence
        }
    }

def process_question_with_metadata_only(question, metadata, username=None):
    command = Command(question=question, metadata=metadata)
    if username:
        try:
            user_incidents = fetch_user_incidents(username)
        except Exception as e:
            logger.warning(f"Failed to fetch user incidents for {username}: {e}")
            user_incidents = []
        command.context["user_incidents"] = [
            {"number": inc.get("number"), "short_description": inc.get("short_description")} for inc in user_incidents
        ]
        command.context["chat_memory"] = fetch_last_5_qa_pairs(username)
        try:
            canonical = extract_canonical_incident_from_chat_memory(command.context.get('chat_memory', []))
            if canonical:
                command.context['canonical_incident'] = canonical
        except Exception:
            pass
    command.username = username
    command = determine_function_sequence(command)
    command = execute_function_sequence(command)
    return {
        **command.to_dict(),
        "function_sequence": command.function_sequence,
        "user_incidents": command.context.get("user_incidents", []),
        "chat_memory": command.context.get("chat_memory", []),
        "feedback_payload": {
            "question": command.question,
            "function_sequence": command.function_sequence
        }
    }

def process_question_basic(question, username=None):
    command = Command(question=question)
    if username:
        try:
            user_incidents = fetch_user_incidents(username)
        except Exception as e:
            logger.warning(f"Failed to fetch user incidents for {username}: {e}")
            user_incidents = []
        command.context["user_incidents"] = [
            {"number": inc.get("number"), "short_description": inc.get("short_description")} for inc in user_incidents
        ]
        command.context["chat_memory"] = fetch_last_5_qa_pairs(username)
        try:
            canonical = extract_canonical_incident_from_chat_memory(command.context.get('chat_memory', []))
            if canonical:
                command.context['canonical_incident'] = canonical
        except Exception:
            pass
    command.username = username
    command = determine_function_sequence(command)
    command = execute_function_sequence(command)
    return {
        **command.to_dict(),
        "function_sequence": command.function_sequence,
        "user_incidents": command.context.get("user_incidents", []),
        "chat_memory": command.context.get("chat_memory", []),
        "feedback_payload": {
            "question": command.question,
            "function_sequence": command.function_sequence
        }
    }

def handle_function_sequence_feedback(data):
    """
    Internal handler for function sequence feedback. Accepts a dict with 'user_id', 'question', 'liked', and optionally 'function_sequence'.
    Returns (result_dict, status_code) for use in API forwarding.
    If 'function_sequence' is provided, it will be saved/updated in the DB for the user and question.
    """
    user_id = data.get("user_id")
    question = data.get("question")
    liked = data.get("liked", True)
    function_sequence = data.get("function_sequence")
    if not user_id or not question:
        return {"error": "user_id and question are required."}, 400
    FunctionSeq = Query()
    update_fields = {"liked": liked}
    if function_sequence is not None:
        update_fields["function_sequence"] = function_sequence
    updated = function_sequence_table.update(
        update_fields,
        (FunctionSeq.user_id == user_id) & (FunctionSeq.question == question)
    )
    # If no record exists, insert a new one with all available info (accept likes without function_sequence)
    if not updated:
        function_sequence_table.insert({
            "user_id": user_id,
            "question": question,
            "function_sequence": function_sequence if function_sequence is not None else [],
            "liked": liked,
            "timestamp": __import__('datetime').datetime.utcnow().isoformat()
        })
        print(f"[handle_function_sequence_feedback] Inserted new record for user: {user_id}, question: {question}, liked: {liked}, function_sequence: {function_sequence}")
        return {"message": "Feedback recorded (new record inserted)."}, 200

    print(f"[handle_function_sequence_feedback] Feedback received for user: {user_id}, question: {question}, liked: {liked}, updated: {updated}, function_sequence: {function_sequence}")
    if updated:
        return {"message": "Feedback recorded.", "updated": updated}, 200
    else:
        # Shouldn't reach here, but return a safe 200 with info
        return {"message": "No update performed, but feedback accepted."}, 200

def get_openai_chat_completion(**kwargs):
    # Remove @trace decorator, just call the OpenAI API directly
    return openai.chat.completions.create(**kwargs)

def get_question_embedding(question):
    return get_openai_embedding(question)