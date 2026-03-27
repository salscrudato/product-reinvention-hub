
# --- ALL IMPORTS AT THE VERY TOP ---
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
import os, json, logging, sys, openai
from datetime import datetime
from flask import Blueprint
from dotenv import load_dotenv
try:  # Prefer modern community split package first
    from langchain_community.tools import Tool  # type: ignore
except Exception:  # pragma: no cover
    try:
        from langchain.tools import Tool  # type: ignore
    except Exception:
        try:
            from langchain.agents import Tool  # type: ignore
        except Exception:
            # Final stub to satisfy type checkers if none available
            class Tool:  # type: ignore
                def __init__(self, *a, **k): pass
from .shared_registry import FUNCTION_REGISTRY
from .snowaaone import my_fetch_all_incidents, fetch_servicenow_incident, find_incidents_by_short_description
from .servicenowgenaitool import (
    fetch_servicenow_incident_core,
    fetch_servicenow_incident_genai,
    analyze_incident_core,
    get_incident_table_metadata,
    get_faiss_indices,
    workaround_lookup_core,
    generate_splunk_query_core,
    predict_assignment_group_core,
    get_assignment_groups_core,
    get_assignment_rules_core,
    splunk_query,
    splunk_completed_query,
    retrieve_context,
    get_similar_incidents_simple,
    fetch_kb_articles_core,
    fetch_backlog_overview_core,
    summarize_work_notes_core,
    analyze_bulk_work_notes_core,
    find_resolutions_from_similar_incidents_core,
    search_incidents_by_keywords_core
)
from .similarity_search_optimized import (
    get_similar_incidents_optimized,
    check_production_index_status
)
from .intelligent_agents import (
    intelligent_workaround_search_core,
    track_workaround_success,
    identify_root_cause_core
)
from .jira_tools import jira_fetch_user_story, jira_summarize_user_story
from .domain.life_annuity_knowledge import (
    resolve_la_nigo_tool,
    get_la_nigo_types_tool
)
from .domain.pc_nigo_resolver import (
    resolve_pc_nigo_tool,
    get_pc_nigo_types_tool
)

# --- DECORATOR DEFINITION ---
def register_tool_function(name):
    """Decorator to register a function in the registry."""
    def decorator(func):
        if name in FUNCTION_REGISTRY:
            print(f"Warning: Function '{name}' is already registered and will be overwritten.")
        FUNCTION_REGISTRY[name] = func
        return func
    return decorator

# --- SCHEMAS AND TOOL REGISTRATION ---
class FindIncidentsByShortDescriptionInputSchema(BaseModel):
    short_description: str

class FindIncidentsByShortDescriptionOutputSchema(BaseModel):
    incidents: List[Dict[str, Any]]

@register_tool_function("find_incidents_by_short_description")
def find_incidents_by_short_description_tool(short_description: str):
    """Fetch incidents from ServiceNow filtered by short description substring.
    
    Args:
        short_description: Substring to search for in incident short descriptions
    
    Returns:
        List of matching incidents with their details
    """
    return find_incidents_by_short_description(short_description)

# Separate Tool instance variable name to avoid shadowing function reference
find_incidents_by_short_description_tool_def = Tool(
    name="find_incidents_by_short_description",
    func=lambda args: find_incidents_by_short_description_tool(args),
    description="Fetch incidents from ServiceNow filtered by short description substring.",
    args_schema=FindIncidentsByShortDescriptionInputSchema,
    return_schema=FindIncidentsByShortDescriptionOutputSchema
)

 # Removed duplicate find_incidents_by_short_description second definition
# Use wiki RAG for wiki annotation
from .CustomWikiRAG import perform_wiki_rag

@register_tool_function("wiki_rag_tool")
def wiki_rag_tool(question: str, correlation_context: Optional[str] = None, search_keywords: Optional[List[str]] = None):
    """Retrieve internal wiki knowledge relevant to a '@wiki' annotated question.
    
    Enhanced with interactive clarification workflow:
    - Analyzes request for specificity
    - Generates clarifying questions if needed
    - Uses clarification to refine search
    - Correlates findings back to original question

    Args:
        question: Full user question (may include clarification)
        correlation_context: Optional context from clarification workflow
        search_keywords: Optional specific keywords to emphasize
        
    Returns:
        dict: {"summary": <RAG answer dict or text>}
    """
    logger = logging.getLogger(__name__)
    if not isinstance(question, str):
        question = str(question)
    logger.info(
        f"[WikiRAGTool] Invoked | question='{question[:100]}' | "
        f"has_correlation={bool(correlation_context)} keywords={search_keywords}"
    )
    result = perform_wiki_rag(question, correlation_context, search_keywords)
    logger.info(f"[WikiRAGTool] Result keys: {list(result.keys()) if isinstance(result, dict) else 'not-dict'}")
    return {"summary": result}


@register_tool_function("wiki_clarification_request")
def wiki_clarification_request(
    clarification_text: str,
    options: List[Dict[str, str]],
    followup_prompt: str,
    state_id: str
):
    """Present clarification questions to user for Wiki RAG refinement.
    
    This is a special tool that doesn't execute Wiki search immediately.
    Instead, it asks the user for clarification to refine the search.
    
    Args:
        clarification_text: Main clarification question/text
        options: List of suggested options for user selection
        followup_prompt: Instructions on how to respond
        state_id: Session identifier for tracking clarification state
        
    Returns:
        dict: Formatted clarification response to show user
    """
    logger = logging.getLogger(__name__)
    logger.info(f"[WikiClarification] Presenting clarification | state_id={state_id} | options={len(options)}")
    
    # Format options for display
    options_text = "\n".join([
        f"{i+1}. {opt['label']}" 
        for i, opt in enumerate(options)
    ])
    
    full_response = f"""{clarification_text}

{options_text}

{followup_prompt}

*[Session ID: {state_id}]*"""
    
    return {
        "summary": full_response,
        "clarification_state_id": state_id,
        "awaiting_clarification": True
    }


# Context QA tool: answer questions over in-memory context (e.g., incidents, chat summaries)
import json as _json









 # Removed duplicate register_tool_function definition

# Registerable function for context QA (must be after register_tool_function is defined)
def perform_context_qa(context, question):
    """
    Answer a user question using the provided context (list of dicts or strings) via LLM.
    """
    import openai
    from os import getenv
    model = getenv("GPT_MODEL_NAME", "gpt-3.5-turbo")
    logger = logging.getLogger(__name__)
    if isinstance(context, list):
        context_str = "\n".join([_json.dumps(item, default=str) for item in context])
    else:
        context_str = str(context)
    prompt = (
        f"You are a helpful assistant. Here is the context:\n{context_str}\n\n"
        f"User question: {question}\n\n"
        "Answer:"
    )
    try:
        logger.info(f"[perform_context_qa] Invoking LLM for context QA. Question: {question}. Context: {context_str[:500]}...")
        response = openai.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful AI assistant."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=300
        )
        msg_obj = response.choices[0].message if response and response.choices else None
        content = getattr(msg_obj, "content", None) or ""
        answer = content.strip()
        logger.info(f"[perform_context_qa] LLM answer: {answer}")
        return answer
    except Exception as e:
        logger.error(f"[perform_context_qa] Error: {e}")
        return f"[Context QA error: {e}]"



 # Removed duplicate import block

# Load environment variables
load_dotenv()

# Set Azure OpenAI credentials from environment variables
os.environ.setdefault("OPENAI_API_KEY", os.getenv("AZURE_OPENAI_API_KEY", ""))
GPT_MODEL_NAME = os.getenv("GPT_MODEL_NAME") or os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# ServiceNow configuration
servicenow_instance = os.getenv("SERVICENOW_INSTANCE")
servicenow_user = os.getenv("SERVICENOW_USER")
servicenow_password = os.getenv("SERVICENOW_PASSWORD")

TOP_MATCHING_INCIDENTS = int(os.getenv("TOP_MATCHING_INCIDENTS", 10))  # Default to 10 if not set
EMBEDDINGS_INDEX_PATH = os.getenv("EMBEDDINGS_INDEX_PATH")

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
blueprint = Blueprint("snowaaonetool", __name__)

# Example: This is a decorator used to register functions in the FUNCTION_REGISTRY.
 # Duplicate register_tool_function removed earlier

# ------------------- Pydantic Schemas -------------------
class EmptyInputSchema(BaseModel):
    pass

class IncidentNumberInputSchema(BaseModel):
    incident_number: str

class IncidentOutputSchema(BaseModel):
    incident: Dict

class IncidentsOutputSchema(BaseModel):
    incidents: List[Dict]

class AnalyzeIncidentInputSchema(BaseModel):
    incident_number: str
    question: str

class AnalyzeIncidentOutputSchema(BaseModel):
    analysis: str

class SimilarIncidentInputSchema(BaseModel):
    incident_short_description: str

class SimilarIncidentsOutputSchema(BaseModel):
    similar_incidents: List[Dict]


class PlanReceiptInputSchema(BaseModel):
    question: Optional[str] = None
    persona: Optional[str] = None
    intent: Optional[str] = None
    jira_issue_key: Optional[str] = None
    telemetry_window: Optional[str] = None

class WorkaroundLookupInputSchema(BaseModel):
    similar_incident_ids: List[str]
    question: str

class WorkaroundOutputSchema(BaseModel):
    workaround: str

class QueryInputSchema(BaseModel):
    key_values: Dict
    timestamp_start: str
    timestamp_end: str

class QueryOutputSchema(BaseModel):
    query: str

class PredictAssignmentGroupInputSchema(BaseModel):
    incident_number: str
    short_description: str
    similar_incidents: List[Dict]

class PredictAssignmentGroupOutputSchema(BaseModel):
    assignment_group_suggestions: Optional[str] = None
    error: Optional[str] = None

class SplunkQueryInputSchema(BaseModel):
    indexes: List[str]
    key_values: Dict
    timestamp_start: str
    timestamp_end: str

class SplunkCompletedQueryInputSchema(BaseModel):
    query: str

class SplunkCompletedQueryOutputSchema(BaseModel):
    results: List[Dict]

class RetrieveContextInputSchema(BaseModel):
    index: str
    problem_statement: str

class RetrieveContextOutputSchema(BaseModel):
    context: str

class JiraFetchUserStoryInputSchema(BaseModel):
    issue_key: Optional[str] = Field(None, description="JIRA issue key (e.g., 'IN-4', 'PROJ-123'). Use this to fetch a specific user story.")
    query: Optional[str] = Field(None, description="Natural language search query to find user stories")
    max_results: Optional[int] = Field(3, description="Maximum number of results to return when searching")

class JiraSummarizeUserStoryInputSchema(BaseModel):
    issue_key: Optional[str] = Field(None, description="JIRA issue key (e.g., 'IN-4', 'PROJ-123') to summarize")
    query: Optional[str] = Field(None, description="Search query to find user story before summarizing")
    user_question: Optional[str] = Field(None, description="Specific question the user wants answered about the story")

# ------------------- Tool Definitions -------------------
my_fetch_all_incidents_tool = Tool(
    name="my_fetch_all_incidents",
    func=my_fetch_all_incidents,
    description="This tool retrieves all incidents from the ServiceNow instance that the user has access to. Useful for gaining an overview of all incidents.",
    args_schema=EmptyInputSchema,
    return_schema=IncidentsOutputSchema
)

from .servicenowgenaitool import get_similar_incidents_simple

# Accepts either a dict or a Pydantic object for compatibility
def _normalize_args(args, attr):
    if isinstance(args, dict):
        return args.get(attr)
    return getattr(args, attr, None)

get_similar_incidents_simple_tool = Tool(
    name="get_similar_incidents_simple",
    func=lambda args: get_similar_incidents_simple(_normalize_args(args, "incident_short_description")),
    description="Given an incident short description, returns a list of similar incidents.",
    args_schema=SimilarIncidentInputSchema,
    return_schema=SimilarIncidentsOutputSchema
)

fetch_servicenow_incident_tool = Tool(
    name="fetch_servicenow_incident",
    func=lambda args: post_process_response(
        fetch_servicenow_incident_core(str(_normalize_args(args, "incident_number") or args).split(":")[-1].strip())),
    description="Fetch detailed information about a specific incident.",
    args_schema=IncidentNumberInputSchema,
    return_schema=IncidentOutputSchema
)

analyze_incident_tool = Tool(
    name="analyze_incident",
    func=lambda args: analyze_incident_core(_normalize_args(args, "incident_number"), _normalize_args(args, "question")),
    description="Analyze a specific incident based on a user-provided question.",
    args_schema=AnalyzeIncidentInputSchema,
    return_schema=AnalyzeIncidentOutputSchema
)

get_incident_table_metadata_tool = Tool(
    name="get_incident_table_metadata",
    func=get_incident_table_metadata,
    description="Fetch the metadata of the ServiceNow Incident Table.",
    args_schema=EmptyInputSchema,
    return_schema=None
)

get_faiss_indices_tool = Tool(
    name="get_faiss_indices",
    func=get_faiss_indices,
    description="Fetch available FAISS indices based on the folder structure.",
    args_schema=EmptyInputSchema,
    return_schema=None
)

workaround_lookup_tool = Tool(
    name="workaround_lookup",
    func=lambda args: workaround_lookup_core(_normalize_args(args, "similar_incident_ids"), _normalize_args(args, "question")),
    description="Retrieve actionable workarounds for recurring issues.",
    args_schema=WorkaroundLookupInputSchema,
    return_schema=WorkaroundOutputSchema
)

predict_assignment_group_tool = Tool(
    name="predict_assignment_group",
    func=lambda args: predict_assignment_group_core(
        incident_number=_normalize_args(args, "incident_number"),
        short_description=_normalize_args(args, "short_description"),
        similar_incidents=_normalize_args(args, "similar_incidents"),
        category=_normalize_args(args, "category")),
    description="Predict the assignment group for a new incident using rules engine and historical patterns. Returns ranked recommendations with confidence scores and reasoning.",
    args_schema=PredictAssignmentGroupInputSchema,
    return_schema=PredictAssignmentGroupOutputSchema
)

get_assignment_groups_tool = Tool(  # type: ignore[assignment]
    name="get_assignment_groups",
    func=lambda args: get_assignment_groups_core(),
    description="Get list of all available assignment groups with their specializations and example incident types they handle. Returns group names, categories handled, keywords, and specialization descriptions.",
)

get_assignment_rules_tool = Tool(  # type: ignore[assignment]
    name="get_assignment_rules",
    func=lambda args: get_assignment_rules_core(),
    description="Get assignment routing rules including category rules, keyword rules, and functionality rules. Shows how incidents are automatically routed to teams based on patterns.",
)

def _wrap_splunk_query(args):
    # Route functions expect flask request normally; here we forward parameters to underlying logic.
    return splunk_query()

splunk_query_tool = Tool(
    name="splunk_query",
    func=_wrap_splunk_query,
    description="Query Splunk with index and key-value pairs.",
    args_schema=SplunkQueryInputSchema,
    return_schema=None
)

def _wrap_splunk_completed(args):
    return splunk_completed_query()

splunk_completed_query_tool = Tool(
    name="splunk_completed_query",
    func=_wrap_splunk_completed,
    description="Run a completed Splunk query.",
    args_schema=SplunkCompletedQueryInputSchema,
    return_schema=SplunkCompletedQueryOutputSchema
)

def _wrap_retrieve_context(args):
    return retrieve_context()

retrieve_context_tool = Tool(
    name="retrieve_context",
    func=_wrap_retrieve_context,
    description="Retrieve context from FAISS based on index and problem statement.",
    args_schema=RetrieveContextInputSchema,
    return_schema=RetrieveContextOutputSchema
)

@register_tool_function("jira_fetch_user_story")
def jira_fetch_user_story_tool(args: Any):
    """
    Fetch a JIRA user story by issue key or search query.
    
    Arguments (JSON format):
    {
        "issue_key": "IN-4",  // REQUIRED: JIRA issue key like "IN-4", "PROJ-123"
        "query": "optional search string",  // Optional: natural language search
        "max_results": 3  // Optional: max results for search
    }
    
    Examples:
    - {"issue_key": "IN-4"}  // Fetch specific story IN-4
    - {"query": "authentication bug"}  // Search for stories
    """
    issue_key = _normalize_args(args, "issue_key")
    query = _normalize_args(args, "query")
    max_results = _normalize_args(args, "max_results")
    if issue_key is None and query is None and isinstance(args, str):
        issue_key = args.strip()
    try:
        max_results_int = int(max_results) if max_results is not None else 3
    except (TypeError, ValueError):
        max_results_int = 3
    return jira_fetch_user_story(issue_key=issue_key, query=query, max_results=max_results_int)

# Attach schema for plan sanitizer
jira_fetch_user_story_tool.args_schema = JiraFetchUserStoryInputSchema

jira_fetch_user_story_tool_def = Tool(
    name="jira_fetch_user_story",
    func=lambda args: jira_fetch_user_story_tool(args),
    description="Fetch a JIRA user story by issue_key (e.g., 'IN-4') or search by query. REQUIRED PARAMETER: issue_key (str) - the JIRA issue identifier like 'IN-4', 'PROJ-123'.",
    args_schema=JiraFetchUserStoryInputSchema,
    return_schema=None
)

@register_tool_function("jira_summarize_user_story")
def jira_summarize_user_story_tool(args: Any):
    """
    Summarize a JIRA user story with optional focused analysis.
    
    Arguments (JSON format):
    {
        "issue_key": "IN-4",  // REQUIRED: JIRA issue key like "IN-4", "PROJ-123"
        "query": "optional search string",  // Optional: search for story first
        "user_question": "optional specific question"  // Optional: focus summary on specific aspect
    }
    
    Examples:
    - {"issue_key": "IN-4"}  // Summarize story IN-4
    - {"issue_key": "IN-4", "user_question": "What is the acceptance criteria?"}  // Focused summary
    """
    issue_key = _normalize_args(args, "issue_key")
    query = _normalize_args(args, "query")
    user_question = _normalize_args(args, "user_question")
    if issue_key is None and query is None and isinstance(args, str):
        issue_key = args.strip()
    return jira_summarize_user_story(issue_key=issue_key, query=query, user_question=user_question)

# Attach schema for plan sanitizer
jira_summarize_user_story_tool.args_schema = JiraSummarizeUserStoryInputSchema

jira_summarize_user_story_tool_def = Tool(
    name="jira_summarize_user_story",
    func=lambda args: jira_summarize_user_story_tool(args),
    description="Summarize a JIRA user story by issue_key (e.g., 'IN-4') or search query. REQUIRED PARAMETER: issue_key (str) - the JIRA issue identifier like 'IN-4', 'PROJ-123'. Optional: user_question (str) for specific questions.",
    args_schema=JiraSummarizeUserStoryInputSchema,
    return_schema=None
)


@register_tool_function("generate_plan_receipt")
def generate_plan_receipt(args: Any) -> Dict[str, Any]:
    question = _normalize_args(args, "question")
    if not question and isinstance(args, str):
        question = args
    persona = _normalize_args(args, "persona") or "business_owner"
    intent = _normalize_args(args, "intent") or "login_governance"
    issue_key = _normalize_args(args, "jira_issue_key") or _normalize_args(args, "issue_key")
    telemetry_window = _normalize_args(args, "telemetry_window")
    issued_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    checklist = [
        "Confirm policyholder entitlements block unsanctioned application starts.",
        "Review latest login regression suite output for SSN and residency validation.",
        "Validate linked JIRA stories include acceptance criteria, business value, and dependencies.",
        "Inspect telemetry or audit logs for lockout spikes within the requested window."
    ]
    return {
        "receipt_type": "login_governance",
        "issued_at": issued_at,
        "persona": persona,
        "intent": intent,
        "question": question,
        "jira_issue_key": issue_key,
        "telemetry_window": telemetry_window,
        "checklist": checklist
    }


generate_plan_receipt_tool_def = Tool(
    name="generate_plan_receipt",
    func=lambda args: generate_plan_receipt(args),
    description="Generate a structured plan receipt summarizing login governance checks for business owners.",
    args_schema=PlanReceiptInputSchema,
    return_schema=None
)

# Register tools for agentic orchestrator as a dict with planner-expected names

# Use code RAG for code annotation
from .code_indexer.code_rag_client import perform_code_rag
def code_annotation_tool(*args, **kwargs):
    # Accepts dict, str, or keyword for question
    question = None
    if args:
        if isinstance(args[0], dict) and "question" in args[0]:
            question = args[0]["question"]
        else:
            question = str(args[0])
    elif "question" in kwargs:
        question = kwargs["question"]
    else:
        question = str(args) if args else str(kwargs)
    return {"summary": perform_code_rag(question)}

snow_tools = {
    "fetch_servicenow_incident": fetch_servicenow_incident_core,
    "fetch_servicenow_incident_genai": fetch_servicenow_incident_genai,
    "analyze_incident": analyze_incident_core,
    "get_incident_table_metadata": get_incident_table_metadata,
    "get_faiss_indices": get_faiss_indices,
    "workaround_lookup": workaround_lookup_core,
    "generate_splunk_query": generate_splunk_query_core,
    "predict_assignment_group": predict_assignment_group_core,
    "get_assignment_groups": get_assignment_groups_core,
    "get_assignment_rules": get_assignment_rules_core,
    "splunk_query": splunk_query,
    "splunk_completed_query": splunk_completed_query,
    "retrieve_context": retrieve_context,
    "get_similar_incidents": get_similar_incidents_simple,
    "find_resolutions_from_similar_incidents": find_resolutions_from_similar_incidents_core,
    "code_annotation_tool": code_annotation_tool,
    "wiki_rag_tool": wiki_rag_tool,
    "generate_plan_receipt": generate_plan_receipt,
    "jira_fetch_user_story": jira_fetch_user_story,
    "jira_summarize_user_story": jira_summarize_user_story
}

# ============================================================================
# NEW SERVICENOW AGENT TOOL REGISTRATIONS - Phase 1
# ============================================================================

from .servicenowgenaitool import (
    get_incident_work_notes_core,
    summarize_incident_work_notes_core,
    add_incident_work_note_core,
    query_incidents_by_date_core,
    get_incidents_created_today_core,
    get_incidents_by_date_range_core
)

@register_tool_function("get_incident_work_notes")
def get_incident_work_notes_tool(incident_number: str, include_empty: bool = False):
    """Extract work_notes field from a ServiceNow incident.
    
    Args:
        incident_number: Incident number (e.g., INC0010013)
        include_empty: Return result even if work_notes is empty
    
    Returns:
        Work notes content with metadata
    """
    return get_incident_work_notes_core(incident_number, include_empty)

@register_tool_function("summarize_incident_work_notes")
def summarize_incident_work_notes_tool(incident_number: str, max_tokens: int = 200, style: str = "bullet_points"):
    """Generate LLM-powered summary of incident work notes.
    
    Args:
        incident_number: Incident number
        max_tokens: Maximum tokens for summary (default 200)
        style: Summary style - bullet_points, paragraph, or timeline
    
    Returns:
        Work notes summary with metadata
    """
    return summarize_incident_work_notes_core(incident_number, max_tokens, style)

@register_tool_function("analyze_bulk_work_notes")
def analyze_bulk_work_notes_tool(
    incident_numbers: List[str], 
    aggregation_level: str = "summary",
    persona: str = "product_owner",
    sample_size: Optional[int] = None
):
    """Analyze work notes across MULTIPLE incidents (5 to 100) with aggregate insights.
    
    Use this when user asks about:
    - "these incidents" (when N > 5 in short-term memory)
    - "overall summary" or "aggregate" or "common patterns"
    - "top categories" or "classify these incidents"
    - "what are the patterns in these X incidents"
    
    Args:
        incident_numbers: List of incident numbers to analyze (5-100 incidents)
        aggregation_level: "summary" | "detailed" | "category_breakdown"
        persona: "product_owner" | "developer" | "engineering_lead"
        sample_size: Optional random sample size if list is large
    
    Returns:
        Dictionary with:
        - top_categories: Data-driven classification (top 5 categories)
        - common_themes: Recurring patterns with frequency
        - documentation_gaps: Missing root cause/workaround/resolution stats
        - actionable_insights: Prioritized recommendations
        - executive_summary: Overall narrative
    """
    return analyze_bulk_work_notes_core(
        incident_numbers=incident_numbers,
        max_concurrent=10,
        aggregation_level=aggregation_level,
        persona=persona,
        sample_size=sample_size
    )

analyze_bulk_work_notes_tool_def = Tool(
    name="analyze_bulk_work_notes",
    func=lambda args: analyze_bulk_work_notes_tool(**args) if isinstance(args, dict) else analyze_bulk_work_notes_tool(incident_numbers=args),
    description="Analyze work notes across MULTIPLE incidents (5-100) with aggregate insights: top categories, common themes, documentation gaps, actionable insights. Use for bulk analysis, pattern recognition, classification."
)

@register_tool_function("find_resolutions_from_similar_incidents")
def find_resolutions_from_similar_incidents_tool(
    incident_numbers: List[str],
    max_similar_per_incident: int = 5,
    include_active_incidents: bool = False
):
    """Find similar incidents for given context incidents and extract their resolutions/workarounds.
    
    This tool answers: "What worked for similar incidents?" or "How were similar problems resolved?"
    
    Workflow:
    1. For each context incident, finds similar incidents using embedding similarity search
    2. Filters for RESOLVED incidents (closed/resolved state) to learn from successful resolutions
    3. Extracts work notes summaries focusing on workarounds and solutions
    4. Aggregates resolution patterns and recommends actions based on what worked
    
    Use when user asks:
    - "What are the workarounds for incidents like these?"
    - "How were similar incidents resolved?"
    - "What solutions worked for similar problems?"
    - "Show me resolutions from similar cases"
    - "What did teams do to fix incidents like mine?"
    
    Args:
        incident_numbers: List of incident numbers from context (1-20 incidents)
        max_similar_per_incident: Max similar incidents to find per context incident (default 5)
        include_active_incidents: If True, also show unresolved similar incidents for context
    
    Returns:
        Dictionary with:
        - resolution_patterns: Extracted solutions/workarounds from similar resolved incidents
        - solution_categories: Solutions grouped by type (config changes, manual actions, etc.)
        - recommended_actions: Top 3-5 actions to try, ranked by frequency and success
        - key_insights: Important learnings, prerequisites, or caveats
        - similar_incident_details: Breakdown of similar incidents found per context incident
    """
    return find_resolutions_from_similar_incidents_core(
        incident_numbers=incident_numbers,
        max_similar_per_incident=max_similar_per_incident,
        max_concurrent=10,
        include_active_incidents=include_active_incidents
    )

find_resolutions_from_similar_incidents_tool_def = Tool(
    name="find_resolutions_from_similar_incidents",
    func=lambda args: find_resolutions_from_similar_incidents_tool(**args) if isinstance(args, dict) else find_resolutions_from_similar_incidents_tool(incident_numbers=args),
    description="Find similar incidents for context incidents and extract their resolutions/workarounds. Use when user asks 'What worked for similar incidents?' or 'How were similar problems resolved?'. Returns resolution patterns, recommended actions based on what successfully resolved similar cases, and key insights."
)

# ============================================================================
# PHASE 2: INTELLIGENT WORKAROUND AGENT TOOLS
# ============================================================================

@register_tool_function("intelligent_workaround_search")
def intelligent_workaround_search_tool(
    incident_number: Optional[str] = None,
    symptom_description: Optional[str] = None,
    top_k: int = 5,
    min_success_rate: float = 0.5,
    prioritize_by: str = "success_rate"
):
    """Search for relevant workarounds using semantic similarity and success tracking.
    
    THIS IS PHASE 2 IMPLEMENTATION: Intelligent Workaround Agent with semantic search,
    success ranking, and escalation recommendations.
    
    Use this when user asks:
    - "What workarounds are available for [incident/symptom]?"
    - "What temporary fixes have worked for similar issues?"
    - "Any known workarounds for [problem]?"
    - "How have others resolved [symptom] temporarily?"
    
    Args:
        incident_number: ServiceNow incident (will extract symptom from it)
        symptom_description: Direct symptom description for search
        top_k: Number of workarounds to return (default 5)
        min_success_rate: Minimum effectiveness threshold 0.0-1.0 (default 0.5)
        prioritize_by: Ranking strategy - "success_rate" (highest success first), 
                       "recency" (most recent first), "frequency" (most used first)
    
    Returns:
        Dictionary with:
        - workarounds: Ranked list with description, success rate, applied count, components
        - escalation_recommendations: Workarounds used too frequently (need permanent fix)
        - symptom_analyzed: What was searched
        - search_method: semantic_embedding_search
    """
    return intelligent_workaround_search_core(
        incident_number=incident_number,
        symptom_description=symptom_description,
        top_k=top_k,
        min_success_rate=min_success_rate,
        prioritize_by=prioritize_by
    )

intelligent_workaround_search_tool_def = Tool(
    name="intelligent_workaround_search",
    func=lambda args: intelligent_workaround_search_tool(**args) if isinstance(args, dict) else intelligent_workaround_search_tool(incident_number=args),
    description="Semantic search for relevant workarounds with success tracking and ranking. Returns workarounds with effectiveness metrics, escalation recommendations. Use for 'what workarounds', 'temporary fix', 'how have others resolved'."
)

@register_tool_function("track_workaround_outcome")
def track_workaround_outcome_tool(
    workaround_id: str,
    incident_number: str,
    outcome: str
):
    """Track the outcome of applying a workaround for feedback loop.
    
    Updates workaround success rate based on real-world effectiveness.
    
    Args:
        workaround_id: Workaround identifier (e.g., WA-0001)
        incident_number: Incident where workaround was applied
        outcome: Result - "success" (worked), "partial" (helped somewhat), "failed" (didn't work)
    
    Returns:
        Updated workaround record with new success rate
    """
    return track_workaround_success(workaround_id, incident_number, outcome)

track_workaround_outcome_tool_def = Tool(
    name="track_workaround_outcome",
    func=lambda args: track_workaround_outcome_tool(**args) if isinstance(args, dict) else {},
    description="Track workaround application outcome (success/partial/failed) to update effectiveness metrics in knowledge base."
)

# ============================================================================
# PHASE 3: ROOT CAUSE IDENTIFICATION AGENT TOOLS
# ============================================================================

@register_tool_function("identify_root_cause")
def identify_root_cause_tool(
    incident_number: str,
    include_code_correlation: bool = True,
    historical_depth: int = 500,
    confidence_threshold: float = 0.6
):
    """Identify likely root causes using pattern analysis, correlation, and historical data.
    
    THIS IS PHASE 3 IMPLEMENTATION: Root Cause Identification Agent with symptom-to-cause
    mapping, multi-incident correlation, code-change correlation.
    
    Use this when user asks:
    - "What might be the root cause of [incident]?"
    - "Why did [incident] happen?"
    - "What's causing [symptom]?"
    - "Has this root cause been seen before?"
    - "Is this related to recent code changes?"
    
    Args:
        incident_number: ServiceNow incident number to analyze
        include_code_correlation: Link to recent PRs/commits (requires GitHub, default True)
        historical_depth: Number of historical incidents to analyze (default 500)
        confidence_threshold: Minimum confidence to include root cause 0.0-1.0 (default 0.6)
    
    Returns:
        Dictionary with:
        - likely_root_causes: Ranked list with confidence scores, evidence, investigation steps
        - cascading_failures: Related incidents opened nearby in time
        - code_correlation: Suspicious PRs/commits that may have introduced issue
        - escalation_needed: Boolean - true if novel issue requiring engineering
        - recommended_action: Investigation strategy
    """
    return identify_root_cause_core(
        incident_number=incident_number,
        include_code_correlation=include_code_correlation,
        historical_depth=historical_depth,
        confidence_threshold=confidence_threshold
    )

identify_root_cause_tool_def = Tool(
    name="identify_root_cause",
    func=lambda args: identify_root_cause_tool(**args) if isinstance(args, dict) else identify_root_cause_tool(incident_number=args),
    description="Identify root causes using historical pattern analysis, symptom-to-cause mapping, cascading failure detection, code-change correlation. Returns ranked causes with confidence scores, evidence, investigation steps. Use for 'why did this happen', 'what's the root cause', 'what's causing this'."
)

@register_tool_function("add_incident_work_note")
def add_incident_work_note_tool(incident_number: str, work_note: str, username: Optional[str] = None):
    """Append a work note entry to a ServiceNow incident.
    
    Args:
        incident_number: Incident number
        work_note: Note text to append
        username: Optional username for attribution
    
    Returns:
        Status of the work note addition
    """
    return add_incident_work_note_core(incident_number, work_note, username)

@register_tool_function("query_incidents_by_date")
def query_incidents_by_date_tool(date_field: str = "sys_created_on", 
                                  start_date: Optional[str] = None, 
                                  end_date: Optional[str] = None,
                                  state: Optional[str] = None,
                                  limit: int = 100):
    """Query ServiceNow incidents with date filtering.
    
    Args:
        date_field: Field to filter on (sys_created_on, sys_updated_on, opened_at)
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
        state: Optional state filter
        limit: Maximum results (default 100)
    
    Returns:
        Incidents matching date criteria with metadata
    """
    return query_incidents_by_date_core(date_field, start_date, end_date, state, limit)

@register_tool_function("get_incidents_created_today")
def get_incidents_created_today_tool(include_closed: bool = False, timezone: str = "UTC"):
    """Get all incidents created today.
    
    Args:
        include_closed: Whether to include closed incidents (default False)
        timezone: Timezone for date boundary (default UTC)
    
    Returns:
        List of incident numbers and full incident data created today
    """
    return get_incidents_created_today_core(include_closed, timezone)

@register_tool_function("get_incidents_by_date_range")
def get_incidents_by_date_range_tool(days_back: Optional[int] = None,
                                       start_date: Optional[str] = None,
                                       end_date: Optional[str] = None,
                                       group_by: Optional[str] = None):
    """Flexible date range queries with optional analytics.
    
    Args:
        days_back: Number of days to look back (e.g., 7 for last week)
        start_date: Explicit start date (YYYY-MM-DD)
        end_date: Explicit end date (YYYY-MM-DD)
        group_by: Optional grouping (day, priority, state)
    
    Returns:
        Incidents with optional analytics breakdown
    """
    return get_incidents_by_date_range_core(days_back, start_date, end_date, group_by)


# ===== QUICK WIN TOOLS =====

@register_tool_function("fetch_kb_articles")
def fetch_kb_articles_tool(incident_number: Optional[str] = None, category: Optional[str] = None, query: Optional[str] = None, limit: int = 5):
    """Fetch ServiceNow knowledge base articles related to incidents or categories.
    
    Args:
        incident_number: Optional incident number to find related KB articles
        category: Optional KB category filter
        query: Optional text query for searching articles
        limit: Maximum articles to return (default 5)
    
    Returns:
        Dictionary with KB articles, count, and metadata
    """
    return fetch_kb_articles_core(incident_number, category, query, limit)


@register_tool_function("fetch_backlog_overview")
def fetch_backlog_overview_tool(days_back: int = 7, 
                                 status_filter: Optional[str] = None,
                                 priority_filter: Optional[str] = None,
                                 group_by: Optional[str] = None):
    """Get incident backlog with time-based filtering and analytics.
    
    Commonly used for questions like:
    - "What are the top priority incidents this week?"
    - "Show me incidents opened today"
    - "Get me all incidents from the last 7 days"
    
    Args:
        days_back: Number of days to look back (default 7)
        status_filter: Filter by status ('open', 'in_progress', 'resolved', 'closed')
        priority_filter: Filter by priority (1-5)
        group_by: Group results by ('priority', 'state', 'assignment_group', 'day')
    
    Returns:
        Dictionary with incidents, count, analytics, and date range info
    """
    return fetch_backlog_overview_core(days_back, status_filter, priority_filter, group_by)


@register_tool_function("get_similar_incidents")
def get_similar_incidents_tool(short_description: Optional[str] = None, incident_number: Optional[str] = None, state_filter: Optional[str] = None):
    """Find similar incidents based on description, with optional filtering by resolution state.
    
    Args:
        short_description: Text description to find similar incidents for
        incident_number: Incident number to find similar incidents for (will extract description)
        state_filter: Optional filter - 'resolved' returns only closed/resolved incidents (states 6,7,8)
                      to learn resolution patterns, 'active' returns open incidents (1-5), None=all
    
    Returns:
        List of similar incidents with similarity scores. When state_filter='resolved', includes
        work_notes and close_notes to learn from past resolutions.
        
    Use Cases:
        - Learning resolution patterns: state_filter='resolved' 
        - Finding active similar issues: state_filter='active'
        - General similarity: state_filter=None
    """
    # Get short description from incident if needed
    if incident_number and not short_description:
        incident_data = fetch_servicenow_incident_core(incident_number)
        if incident_data and not incident_data.get("error"):
            short_description = incident_data.get("short_description", "")
    
    if not short_description:
        return {"error": "Either short_description or incident_number must be provided"}
    
    # Check if production index is available for optimized search
    index_status = check_production_index_status()
    logger.info(f"[SimilaritySearch] Index status: available={index_status.get('index_available')}, " +
                f"count={index_status.get('total_incidents', 0)}")
    
    # Use optimized search if index available, otherwise fall back to real-time
    if index_status.get('index_available'):
        logger.info("[SimilaritySearch] Using OPTIMIZED production index (fast path)")
        similar_incidents = get_similar_incidents_optimized(short_description, top_k=10)
    else:
        logger.warning("[SimilaritySearch] Production index unavailable, using real-time search (slow path)")
        similar_incidents = get_similar_incidents_simple(short_description)
    
    # Apply state filtering if specified
    if state_filter == 'resolved':
        # Filter for resolved/closed incidents to learn resolution patterns
        filtered = []
        for inc in similar_incidents:
            if isinstance(inc, dict) and not inc.get('error'):
                inc_details = fetch_servicenow_incident_core(inc.get('number', ''))
                if inc_details and not inc_details.get('error'):
                    state = str(inc_details.get('state', ''))
                    if state in ['6', '7', '8']:  # Resolved, Closed, Closed Complete
                        inc['state'] = state
                        inc['work_notes'] = inc_details.get('work_notes', '')
                        inc['close_notes'] = inc_details.get('close_notes', '')
                        inc['resolved_at'] = inc_details.get('resolved_at', '')
                        filtered.append(inc)
        return {"similar_incidents": filtered, "filter_applied": "resolved", "total_found": len(similar_incidents), "resolution_patterns_available": len(filtered)}
    
    elif state_filter == 'active':
        # Filter for active/open incidents
        filtered = []
        for inc in similar_incidents:
            if isinstance(inc, dict) and not inc.get('error'):
                inc_details = fetch_servicenow_incident_core(inc.get('number', ''))
                if inc_details and not inc_details.get('error'):
                    state = str(inc_details.get('state', ''))
                    if state in ['1', '2', '3', '4', '5']:  # New, In Progress, etc.
                        inc['state'] = state
                        filtered.append(inc)
        return {"similar_incidents": filtered, "filter_applied": "active", "total_found": len(similar_incidents)}
    
    # No filter - return all
    return {"similar_incidents": similar_incidents}


@register_tool_function("summarize_work_notes")
def summarize_work_notes_tool(incident_number: str, max_notes: int = 20, llm_summary: bool = True):
    """Summarize work notes for an incident with key insights extraction.
    
    Provides:
    - Chronological work notes list
    - AI-generated summary of actions taken
    - Key insights (resolutions, root causes, escalations)
    - Timeline information (oldest/latest notes)
    
    Args:
        incident_number: Incident number to analyze
        max_notes: Maximum notes to retrieve (default 20)
        llm_summary: Use LLM for intelligent summarization (default True)
    
    Returns:
        Dictionary with work notes, summary, insights, and timeline
    """
    return summarize_work_notes_core(incident_number, max_notes, llm_summary)


@register_tool_function("search_incidents_by_keywords")
def search_incidents_by_keywords_tool(
    keywords: List[str],
    search_fields: Optional[List[str]] = None,
    state_filter: Optional[str] = None,
    priority_filter: Optional[str] = None,
    limit: int = 20
):
    """Search ServiceNow incidents using multiple keywords with intelligent matching.
    
    **Use this when users ask about incidents using descriptive terms instead of incident numbers.**
    
    Examples of natural language queries this handles:
    - "What is the bank NIGO incident?" → keywords=["bank", "NIGO"]
    - "Show me payment failure issues" → keywords=["payment", "failure"]
    - "Find MIB requirement problems" → keywords=["MIB", "requirement"]
    - "Which incident had chronic care rider removal?" → keywords=["chronic care", "rider", "removal"]
    
    The function searches for incidents that contain ALL keywords in at least one of the
    specified fields, using AND logic. Results are ranked by relevance (number of matches).
    
    Args:
        keywords: List of keywords to search for (all must be present in incident)
        search_fields: Fields to search (default: ['short_description', 'description', 'work_notes'])
        state_filter: Filter by state - '1'=New, '2'=In Progress, '3'=On Hold, '6'=Resolved, '7'=Closed
        priority_filter: Filter by priority - '1'=Critical, '2'=High, '3'=Moderate, '4'=Low, '5'=Planning
        limit: Maximum incidents to return (default: 20)
    
    Returns:
        Dictionary containing:
        - incidents: List of matching incidents (sorted by relevance)
        - keywords_searched: Keywords used
        - fields_searched: Fields searched
        - match_count: Number of matches found
        - _match_score: Each incident includes a relevance score
        - _matched_fields: Which fields contained the keywords
    
    Best Practices:
    - Extract key descriptive terms from user's question
    - Use 2-4 keywords for best results (too many may return no results)
    - Common keywords: NIGO, bank, payment, MIB, beneficiary, compliance, etc.
    - If no results, try fewer keywords or search only short_description field
    """
    return search_incidents_by_keywords_core(
        keywords=keywords,
        search_fields=search_fields,
        state_filter=state_filter,
        priority_filter=priority_filter,
        limit=limit
    )


@register_tool_function("get_assignment_groups")
def get_assignment_groups_tool():
    """Get list of all available assignment groups with their specializations.
    
    Returns information about:
    - All assignment groups available in ServiceNow
    - Categories each group handles
    - Keywords associated with each group
    - Group specializations (Network, Database, Applications, etc.)
    - Total number of groups
    
    Use this tool when users ask:
    - "What teams are available?"
    - "Which assignment groups exist?"
    - "What teams handle network issues?"
    - "Show me all support groups"
    
    Returns:
        Dictionary with:
        - total_groups: Total number of assignment groups
        - groups: List of group details (name, categories, keywords, specialization)
        - data_source: Where the data comes from
        - last_updated: When rules were last updated
    """
    return get_assignment_groups_core()


@register_tool_function("get_assignment_rules")
def get_assignment_rules_tool():
    """Get incident assignment routing rules and their configuration.
    
    Returns information about:
    - Category-based assignment rules
    - Keyword-based assignment rules  
    - Confidence scores for each rule
    - Sample sizes used to build rules
    - Default assignment groups
    
    Use this tool when users ask:
    - "What are the assignment rules?"
    - "How are incidents routed to teams?"
    - "What keywords trigger which assignments?"
    - "What's the logic for assigning incidents?"
    
    Returns:
        Dictionary with:
        - category_rules: Rules based on incident category
        - keyword_rules: Rules based on description keywords
        - default_group: Fallback assignment group
        - total_rules: Total number of rules configured
        - metadata: Information about rule data source
    """
    return get_assignment_rules_core()


# Reintroducing the post_process_response function
def post_process_response(raw_response):
    """
    Validates and reformats the raw response to ensure it matches the expected JSON structure.
    Args:
        raw_response (str): The raw response from the fetch_servicenow_incident_genai function.
    Returns:
        dict: A validated and reformatted response.
    """
    if isinstance(raw_response, dict):
        return raw_response
    try:
        # Parse the raw response as JSON
        response = json.loads(raw_response)

        # Validate required fields
        required_fields = ["incident_number", "short_description", "assigned_to", "status"]
        for field in required_fields:
            if field not in response:
                raise ValueError(f"Missing required field: {field}")

        return response
    except (json.JSONDecodeError, ValueError) as e:
        # Log the error and return a default error response
        print(f"Error processing response: {e}")
        return {
            "error": "Invalid response format",
            "details": str(e)
        }


# ============================================================================
# INSURANCE QUOTE TOOLS (Mock insurance domain demonstration)
# ============================================================================

from .insurance_quote_tool import (
    list_available_policies_core,
    fetch_policy_details_core,
    fetch_policy_by_holder_core,
    get_zip_risk_rating_core,
    get_vehicle_details_core,
    calculate_premium_core,
    format_quote_comparison_core
)

@register_tool_function("list_available_policies")
def list_available_policies_tool(email: Optional[str] = None):
    """
    List all available insurance policies for the user (for selection).
    
    Args:
        email: Policy holder email address (optional)
        
    Returns:
        List of policies with policy_number, vehicle description, current premium
    """
    return list_available_policies_core(email)

@register_tool_function("fetch_policy_details")
def fetch_policy_details_tool(policy_number: str):
    """
    Fetch specific policy details by policy number.
    Returns ONLY essential data needed for quote calculation (lean API pattern).
    
    Args:
        policy_number: Policy number to fetch
        
    Returns:
        Essential policy details: policy_number, current_zip, current_premium, vehicle info
    """
    return fetch_policy_details_core(policy_number)

@register_tool_function("fetch_policy_by_holder")
def fetch_policy_by_holder_tool(email: str):
    """
    Fetch insurance policy details by policyholder email.
    
    Args:
        email: Policy holder email address
        
    Returns:
        Policy details including vehicle, coverage, current premium, and location
    """
    return fetch_policy_by_holder_core(email=email)

@register_tool_function("get_zip_risk_rating")
def get_zip_risk_rating_tool(zip_code: str):
    """
    Get insurance risk rating for a ZIP code.
    
    Args:
        zip_code: 5-digit ZIP code
        
    Returns:
        Risk zone, theft rate, collision frequency, and premium factors
    """
    return get_zip_risk_rating_core(zip_code)

@register_tool_function("get_vehicle_details")
def get_vehicle_details_tool(policy_number: str):
    """
    Get vehicle valuation details.
    Returns ONLY current value (lean data for premium calculation).
    
    Args:
        policy_number: Policy number
        
    Returns:
        Vehicle valuation: estimated_value, vehicle_age
    """
    return get_vehicle_details_core(policy_number)

@register_tool_function("calculate_premium")
def calculate_premium_tool(policy_number: str, current_premium: float, old_zip: str, new_zip: str,
                          old_zip_risk: dict, new_zip_risk: dict, vehicle_value: float):
    """
    Calculate new insurance premium based on risk factors from previous agents.
    Uses data passed from upstream agents (no redundant DB calls).
    
    Args:
        policy_number: Policy number
        current_premium: Current monthly premium (from policy details agent)
        old_zip: Current ZIP code (from policy details agent)
        new_zip: New ZIP code (from user query)
        old_zip_risk: Risk data for old ZIP (from risk analyzer agent)
        new_zip_risk: Risk data for new ZIP (from risk analyzer agent)
        vehicle_value: Current vehicle value (from vehicle valuation agent)
        
    Returns:
        Premium calculation: new_premium_monthly, change_amount, change_percent, risk zones
    """
    return calculate_premium_core(policy_number, current_premium, old_zip, new_zip,
                                  old_zip_risk, new_zip_risk, vehicle_value)

@register_tool_function("format_quote_comparison")
def format_quote_comparison_tool(policy_number: str, policy_details: dict, old_zip: str, new_zip: str,
                                 old_zip_risk: dict, new_zip_risk: dict, premium_calculation: dict):
    """
    Format comprehensive insurance quote comparison report using data from all previous agents.
    
    Args:
        policy_number: Policy number
        policy_details: Policy data from fetch_policy_details agent
        old_zip: Current ZIP
        new_zip: New ZIP
        old_zip_risk: Risk data from risk analyzer agent (old)
        new_zip_risk: Risk data from risk analyzer agent (new)
        premium_calculation: Calculation from premium calculator agent
        
    Returns:
        Natural language summary report
    """
    return format_quote_comparison_core(policy_number, policy_details, old_zip, new_zip,
                                       old_zip_risk, new_zip_risk, premium_calculation)

# ============================================================================
# NIGO RESOLVERS (Product-specific context augmentation)
# ============================================================================

# Tools already registered via @register_tool_function decorator:
#
# L&A NIGO Resolver:
#   - resolve_la_nigo: Query Wiki FAISS with L&A context for NIGO resolution
#   - get_la_nigo_types: Get L&A NIGO type definitions
#
# P&C NIGO Resolver:
#   - resolve_pc_nigo: Query Wiki FAISS with P&C context for NIGO resolution
#   - get_pc_nigo_types: Get P&C NIGO type definitions
#
# Both query existing Embeddings_Lookup_cache.index with augmented context


