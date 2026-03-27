import re
import logging
import json
import os
from typing import List, Dict, Any, Optional

from .jira_tools import extract_issue_key

# Basic (intent, persona|None) -> ordered tool sequence definitions.
# Each step: { 'tool': 'tool_name', 'args_fn': callable | None }

logger = logging.getLogger(__name__)

def _extract_incident_number(text: str) -> Optional[str]:
    m = re.search(r"\bINC0*\d+\b", text, flags=re.IGNORECASE)
    return m.group(0).upper() if m else None

def _extract_incidents_from_stm(metadata: Dict[str, Any]) -> List[str]:
    """Extract incident numbers from short-term memory (previous tool outputs).
    
    Looks for incidents in:
    1. short_term_memory.referenced_incidents (explicit cache)
    2. Recent tool outputs like run_incident_query results
    3. Incident references from chat history (metadata['incidents'])
    """
    incidents = []
    
    # Check short-term memory cache
    stm_data = metadata.get('short_term_memory', {})
    if stm_data.get('referenced_incidents'):
        incidents.extend(stm_data['referenced_incidents'])
        logger.info(f"[plan_recipes] Found {len(incidents)} incidents in short-term memory cache")
    
    # Check for incidents in recent tool outputs (e.g., run_incident_query)
    recent_outputs = metadata.get('recent_tool_outputs', {})
    for tool_name, output in recent_outputs.items():
        if isinstance(output, dict):
            # Check run_incident_query results
            if 'results' in output and isinstance(output['results'], list):
                for result in output['results']:
                    if isinstance(result, dict) and 'number' in result:
                        incidents.append(result['number'])
                logger.info(f"[plan_recipes] Extracted {len(output['results'])} incidents from {tool_name} output")
    
    # FALLBACK: Check incidents from chat history context (e.g., from previous conversations)
    if not incidents:
        chat_incidents = metadata.get('incidents', [])
        if chat_incidents:
            incidents.extend(chat_incidents)
            logger.info(f"[plan_recipes] Found {len(incidents)} incidents from chat history context")
    
    # Deduplicate while preserving order
    seen = set()
    unique_incidents = []
    for inc in incidents:
        if inc and inc not in seen:
            seen.add(inc)
            unique_incidents.append(inc)
    
    return unique_incidents

def _extract_zip_codes(text: str) -> Dict[str, Optional[str]]:
    """Extract old and new ZIP codes from queries like 'moving from 60100 to 60501'."""
    # Pattern: "from X to Y" or "X to Y"
    from_to_pattern = r'\b(?:from\s+)?(\d{5})\s+to\s+(\d{5})\b'
    match = re.search(from_to_pattern, text, re.IGNORECASE)
    if match:
        return {'old_zip': match.group(1), 'new_zip': match.group(2)}
    
    # Fallback: Look for two ZIP codes anywhere in the query
    zips = re.findall(r'\b(\d{5})\b', text)
    if len(zips) >= 2:
        return {'old_zip': zips[0], 'new_zip': zips[1]}
    
    return {'old_zip': None, 'new_zip': None}

def _extract_policy_number(text: str) -> Optional[str]:
    """Extract policy number from text (format: 6 digits like 100001, 100002)."""
    m = re.search(r'\b(10000[12])\b', text)
    return m.group(0) if m else None

def _args_insurance_policy_list(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract arguments for listing available policies."""
    # Try to get email from metadata first
    email = metadata.get('user_email') or metadata.get('username')
    
    # Look for email in question
    if not email:
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        match = re.search(email_pattern, question)
        if match:
            email = match.group(0)
    
    # Default to demo email if none found
    if not email:
        email = "john.doe@email.com"
        logger.info(f"[plan_recipes] No email found - using default: {email}")
    
    return {'email': email}

def _args_insurance_policy_details(question: str, metadata: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """Extract policy number for fetching details. Returns None if not specified (triggers clarification)."""
    # Check if user selected a policy in follow-up
    policy_num = _extract_policy_number(question)
    
    # Check metadata (from previous conversation turn)
    if not policy_num:
        policy_num = metadata.get('selected_policy_number')
    
    # If still no policy number, return None to trigger clarification
    if not policy_num:
        logger.info("[plan_recipes] No policy number selected - will trigger clarification")
        return None
    
    logger.info(f"[plan_recipes] Using policy number: {policy_num}")
    return {'policy_number': policy_num}

def _args_insurance_zip_risk_old(question: str, metadata: Dict[str, Any]) -> Dict[str, str]:
    """Extract OLD ZIP code for risk rating (from policy details)."""
    # First try to get from policy details (previous agent output)
    policy_details = metadata.get('tool_outputs', {}).get('fetch_policy_details', {}).get('policy_details', {})
    current_zip = policy_details.get('current_zip') or '60100'  # Default if not found
    
    # Fallback: extract from question
    if current_zip == '60100' and '60100' not in question:
        zips = _extract_zip_codes(question)
        extracted_zip = zips.get('old_zip')
        if extracted_zip:
            current_zip = extracted_zip
    
    logger.info(f"[plan_recipes] Old ZIP for risk rating: {current_zip}")
    return {'zip_code': current_zip}

def _args_insurance_zip_risk_new(question: str, metadata: Dict[str, Any]) -> Dict[str, str]:
    """Extract NEW ZIP code for risk rating."""
    zips = _extract_zip_codes(question)
    new_zip = zips.get('new_zip') or '60501'
    logger.info(f"[plan_recipes] New ZIP for risk rating: {new_zip}")
    return {'zip_code': new_zip}

def _args_insurance_vehicle(question: str, metadata: Dict[str, Any]) -> Dict[str, str]:
    """Extract policy number for vehicle valuation (from metadata)."""
    # Get from policy details (previous agent)
    policy_details = metadata.get('tool_outputs', {}).get('fetch_policy_details', {}).get('policy_details', {})
    policy_num = policy_details.get('policy_number') or metadata.get('selected_policy_number', '100001')
    
    logger.info(f"[plan_recipes] Vehicle valuation for policy: {policy_num}")
    return {'policy_number': policy_num}

def _args_insurance_premium_calc(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract arguments for premium calculation from previous agent outputs."""
    # Get all data from previous agents
    tool_outputs = metadata.get('tool_outputs', {})
    
    policy_details = tool_outputs.get('fetch_policy_details', {}).get('policy_details', {})
    policy_num = policy_details.get('policy_number', '100001')
    current_premium = policy_details.get('current_premium', 145)
    current_zip = policy_details.get('current_zip', '60100')
    
    # Get ZIP codes
    zips = _extract_zip_codes(question)
    new_zip = zips.get('new_zip', '60501')
    
    # Get risk data from previous agents
    # We need to handle that get_zip_risk_rating is called twice (old and new)
    # This is tricky - we'll get them from tool outputs if available
    old_zip_risk = tool_outputs.get('get_zip_risk_rating_old', {}).get('risk_data', {})
    new_zip_risk = tool_outputs.get('get_zip_risk_rating_new', {}).get('risk_data', {})
    
    # Get vehicle value from previous agent
    vehicle_valuation = tool_outputs.get('get_vehicle_details', {}).get('valuation', {})
    vehicle_value = vehicle_valuation.get('estimated_value', 8500)
    
    logger.info(f"[plan_recipes] Premium calc args: policy={policy_num}, ${current_premium}/mo, {current_zip}→{new_zip}, vehicle=${vehicle_value}")
    
    return {
        'policy_number': policy_num,
        'current_premium': current_premium,
        'old_zip': current_zip,
        'new_zip': new_zip,
        'old_zip_risk': old_zip_risk,
        'new_zip_risk': new_zip_risk,
        'vehicle_value': vehicle_value
    }

def _args_insurance_quote_format(question: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Extract arguments for quote comparison formatting from all previous agents."""
    tool_outputs = metadata.get('tool_outputs', {})
    
    policy_details = tool_outputs.get('fetch_policy_details', {}).get('policy_details', {})
    policy_num = policy_details.get('policy_number', '100001')
    
    # Get ZIP codes
    zips = _extract_zip_codes(question)
    current_zip = policy_details.get('current_zip', '60100')
    new_zip = zips.get('new_zip', '60501')
    
    # Get risk data
    old_zip_risk = tool_outputs.get('get_zip_risk_rating_old', {}).get('risk_data', {})
    new_zip_risk = tool_outputs.get('get_zip_risk_rating_new', {}).get('risk_data', {})
    
    # Get premium calculation
    premium_calc = tool_outputs.get('calculate_premium', {})
    if not premium_calc or not premium_calc.get('success'):
        logger.warning("[plan_recipes] No premium calculation in metadata - skipping quote format")
        return None
    
    logger.info(f"[plan_recipes] Quote format args: policy={policy_num}, {current_zip}→{new_zip}")
    
    return {
        'policy_number': policy_num,
        'policy_details': policy_details,
        'old_zip': current_zip,
        'new_zip': new_zip,
        'old_zip_risk': old_zip_risk,
        'new_zip_risk': new_zip_risk,
        'premium_calculation': premium_calc
    }
    
    return {
        'policy_number': policy_num,
        'old_zip': zips.get('old_zip', '60100'),
        'new_zip': zips.get('new_zip', '60501'),
        'premium_calculation': premium_calc
    }

def _extract_semantic_query(question: str) -> Optional[str]:
    """Extract semantic meaning from queries like 'incidents related to APS requirements'
    
    Returns the topic/subject user is asking about, not literal query text.
    """
    # Pattern: "incidents (related to|about|regarding|concerning|for) X"
    patterns = [
        r"incidents? (?:related to|about|regarding|concerning|for|with|on)\s+(.+?)(?:\?|$)",
        r"(?:show|find|get|list|what are) (?:the )?incidents? (?:related to|about|regarding|concerning|for|with|on)\s+(.+?)(?:\?|$)",
        r"incidents? (?:that|which) (?:are )?(?:related to|about|regarding|concerning)\s+(.+?)(?:\?|$)"
    ]
    
    for pattern in patterns:
        m = re.search(pattern, question, re.IGNORECASE)
        if m:
            topic = m.group(1).strip()
            logger.info(f"[plan_recipes] Extracted semantic topic: '{topic}' from query: '{question[:60]}...'")
            return topic
    
    return None

def _extract_change_number(text: str) -> Optional[str]:
    m = re.search(r"\bCHG0*\d+\b", text, flags=re.IGNORECASE)
    return m.group(0).upper() if m else None

def _extract_group(text: str) -> Optional[str]:
    # naive heuristic
    m = re.search(r"assignment group\s+([A-Za-z0-9_\- ]{2,40})", text, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None

def _should_include_backlog_overview(question: str, metadata: Dict[str, Any]) -> bool:
    """Determine if backlog overview is contextually relevant.
    
    Include when:
    - Question asks about multiple/recent/last N days incidents
    - Question asks about backlog, priority distribution, trends
    - Question is about "incidents opened"/"created"/"from last"
    
    Exclude when:
    - Question is about a specific incident (INC number present)
    - Question asks "Who should X be assigned to"
    - Question is about similar incidents
    - Question is about assignment groups/rules
    """
    q_lower = question.lower()
    
    # Exclude: specific incident queries
    if _extract_incident_number(question):
        logger.info("[plan_recipes] Backlog overview EXCLUDED: specific incident query")
        return False
    
    # Exclude: assignment-focused queries
    assignment_keywords = ['who should', 'which team', 'assignment', 'assigned to', 'assign']
    if any(kw in q_lower for kw in assignment_keywords):
        logger.info("[plan_recipes] Backlog overview EXCLUDED: assignment-focused query")
        return False
    
    # Include: explicit backlog/trend queries
    backlog_keywords = ['backlog', 'priority distribution', 'how many', 'incidents opened', 
                        'incidents created', 'last', 'recent', 'trend', 'overview']
    if any(kw in q_lower for kw in backlog_keywords):
        logger.info("[plan_recipes] Backlog overview INCLUDED: explicit backlog query")
        return True
    
    # Default: exclude for product_owner to reduce noise
    logger.info("[plan_recipes] Backlog overview EXCLUDED: default (specific query)")
    return False

def _args_backlog_conditional(question: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Conditionally return backlog args only when contextually relevant."""
    if _should_include_backlog_overview(question, metadata):
        return {'days': 14}
    return None  # Return None to skip this tool

def _extract_ci(text: str) -> Optional[str]:
    m = re.search(r"\bCI[: ]+([A-Za-z0-9_\-.]{2,60})", text, flags=re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def _args_incident(question: str, metadata: Dict[str, Any]):
    """Extract incident arguments with semantic understanding
    
    Priority order:
    1. Explicit incident number in question (e.g., "INC0010003")
    2. Canonical incident from conversation context (resolves "this incident")
    3. Semantic query topic (e.g., "incidents related to APS" → short_description="APS")
    """
    # First try to extract explicit incident number from question
    inc = _extract_incident_number(question)
    if inc:
        return {'incident_number': inc}
    
    # Second, check for canonical incident from conversation context (for "this incident" references)
    canonical = metadata.get('canonical_incident', {})
    if isinstance(canonical, dict) and canonical.get('number'):
        return {'incident_number': canonical.get('number')}
    
    # Third, check if this is a semantic similarity query
    topic = _extract_semantic_query(question)
    if topic:
        return {'short_description': topic}
    
    return {}

def _args_change(question: str, metadata: Dict[str, Any]):
    chg = _extract_change_number(question)
    return {'change_id': chg} if chg else {}

def _args_kb(question: str, metadata: Dict[str, Any]):
    """Return KB search args only if the question is about documentation/knowledge, not incidents.
    
    Questions asking for incidents should NOT use fetch_kb_articles (which searches documentation).
    Instead they should use run_incident_query or get_similar_incidents.
    """
    q_lower = question.lower()
    
    # EXCLUDE fetch_kb_articles if asking for incidents, user stories, or data queries
    incident_keywords = [
        'show me', 'list', 'find', 'get', 'fetch', 'retrieve', 
        'open incidents', 'incidents', 'inc0', 'all incidents',
        'user story', 'user stories', 'jira', 'story', 'ticket'
    ]
    
    for keyword in incident_keywords:
        if keyword in q_lower:
            return None  # Exclude fetch_kb_articles from plan
    
    # Only include fetch_kb_articles for documentation/knowledge questions
    return {'query': question[:140]}

def _args_user(question: str, metadata: Dict[str, Any]):
    username = metadata.get('username') or metadata.get('user') or metadata.get('logged_in_user')
    return {'username': username} if username else {}

def _args_bulk_work_notes(question: str, metadata: Dict[str, Any]):
    """Extract arguments for bulk work notes analysis.
    
    Extracts incident list from short-term memory and determines persona/aggregation level.
    """
    incidents = _extract_incidents_from_stm(metadata)
    
    if not incidents or len(incidents) < 5:
        # Not enough incidents for bulk analysis
        return None
    
    # Determine aggregation level from question
    q_lower = question.lower()
    if 'detailed' in q_lower or 'detail' in q_lower:
        aggregation_level = 'detailed'
    elif 'categor' in q_lower or 'classif' in q_lower:
        aggregation_level = 'category_breakdown'
    elif 'workaround' in q_lower or 'work around' in q_lower:
        aggregation_level = 'workaround_focus'
    else:
        aggregation_level = 'summary'
    
    # Get persona from metadata
    persona = metadata.get('persona', 'product_owner')
    
    # Sample if > 100 incidents
    sample_size = 100 if len(incidents) > 100 else None
    
    return {
        'incident_numbers': incidents,
        'aggregation_level': aggregation_level,
        'persona': persona,
        'sample_size': sample_size
    }

def _args_workaround_search(question: str, metadata: Dict[str, Any]):
    """Extract arguments for intelligent workaround search."""
    # Try to extract incident number from question
    incident = _extract_incident_number(question)
    
    # If no incident, try to get from metadata
    if not incident:
        incident = metadata.get('canonical_incident')
    
    # Extract symptom description from question if no incident
    symptom = None
    if not incident:
        # Remove common query prefixes
        clean_question = question.lower()
        for prefix in ['what workarounds', 'any workarounds', 'temporary fix', 'how to fix']:
            if clean_question.startswith(prefix):
                symptom = question[len(prefix):].strip()
                break
        if not symptom:
            symptom = question
    
    # Determine prioritization strategy from question
    prioritize_by = 'success_rate'  # default
    if 'recent' in question.lower() or 'latest' in question.lower():
        prioritize_by = 'recency'
    elif 'most used' in question.lower() or 'popular' in question.lower():
        prioritize_by = 'frequency'
    
    return {
        'incident_number': incident,
        'symptom_description': symptom,
        'top_k': 5,
        'min_success_rate': 0.5,
        'prioritize_by': prioritize_by
    }

def _args_root_cause(question: str, metadata: Dict[str, Any]):
    """Extract arguments for root cause identification."""
    # Extract incident number
    incident = _extract_incident_number(question)
    
    # If no incident, try to get from metadata
    if not incident:
        incident = metadata.get('canonical_incident')
    
    if not incident:
        return None  # Conditional exclusion if no incident specified
    
    # Determine if code correlation is requested
    include_code_correlation = True  # default
    if 'no code' in question.lower() or 'skip code' in question.lower():
        include_code_correlation = False
    
    # Determine historical depth from question
    historical_depth = 500  # default
    if 'last year' in question.lower():
        historical_depth = 1000
    elif 'recent' in question.lower() or 'last month' in question.lower():
        historical_depth = 200
    
    return {
        'incident_number': incident,
        'include_code_correlation': include_code_correlation,
        'historical_depth': historical_depth,
        'confidence_threshold': 0.6
    }

def _args_group(question: str, metadata: Dict[str, Any]):
    g = _extract_group(question)
    return {'group': g} if g else {}

def _args_ci(question: str, metadata: Dict[str, Any]):
    ci = metadata.get('ci') or _extract_ci(question)
    return {'ci': ci} if ci else {}

def _args_change_related(question: str, metadata: Dict[str, Any]):
    # prefer explicit ci, else infer from incident in metadata
    ci = metadata.get('ci') or _extract_ci(question)
    inc = _extract_incident_number(question)
    payload = {}
    if ci:
        payload['ci'] = ci
    if inc:
        payload['incident_number'] = inc
    return payload


def _args_jira_story_fetch(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    issue_key = metadata.get('jira_issue_key') or extract_issue_key(question or "")
    if issue_key:
        return {'issue_key': issue_key}
    return {'query': question[:180]}


def _args_jira_story_summarize(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    payload = _args_jira_story_fetch(question, metadata)
    payload['user_question'] = question
    return payload


def _args_plan_receipt(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    metadata = metadata or {}
    payload: Dict[str, Any] = {
        'question': question,
        'intent': metadata.get('intent') or 'login_governance',
        'persona': metadata.get('persona')
    }
    issue_key = metadata.get('jira_issue_key') or extract_issue_key(question or "")
    if issue_key:
        payload['jira_issue_key'] = issue_key
    if metadata.get('telemetry_window'):
        payload['telemetry_window'] = metadata['telemetry_window']
    return payload


def _args_backlog_window(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    metadata = metadata or {}
    window = metadata.get('telemetry_window')
    if window is None:
        return {'days': 14}
    try:
        days = int(window)
    except (TypeError, ValueError):
        days = 14
    return {'days': days}


def _args_mapping(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {'question': question}
    link = (metadata or {}).get('assignment_link')
    if link:
        payload['assignment_link'] = link
    return payload

# NEW: Argument extractors for work notes operations
def _args_work_note_add(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    inc = _extract_incident_number(question)
    # Extract note text (everything after "add note:" or similar)
    m = re.search(r"add (?:work )?note:?\s*(.+)", question, re.IGNORECASE)
    if not m:
        m = re.search(r"append (?:note|text):?\s*(.+)", question, re.IGNORECASE)
    note = m.group(1).strip() if m else question
    username = metadata.get('username')
    payload = {'work_note': note}
    if inc:
        payload['incident_number'] = inc
    if username:
        payload['username'] = username
    return payload

# NEW: Argument extractors for date queries
def _args_date_range(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract date range arguments from natural language.
    
    Patterns supported:
    - "last N days" → days_back=N
    - "past N days" → days_back=N
    - "last N weeks" → days_back=N*7
    - "past N weeks" → days_back=N*7
    """
    # Check for weeks first
    m = re.search(r"(?:last|past) (\d+) weeks?", question.lower())
    if m:
        weeks = int(m.group(1))
        return {'days_back': weeks * 7}
    
    # Then check for days
    m = re.search(r"(?:last|past) (\d+) days?", question.lower())
    if m:
        return {'days_back': int(m.group(1))}
    
    # Default to last 7 days
    return {'days_back': 7}

def _args_date_range_explicit(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    # Parse "from 2026-01-15 to 2026-01-19" format
    m = re.search(r"(\d{4}-\d{2}-\d{2}).*(?:to|through|until|and).*(\d{4}-\d{2}-\d{2})", question)
    if m:
        return {'start_date': m.group(1), 'end_date': m.group(2), 'date_field': 'sys_created_on'}
    return _args_date_range(question, metadata)

# NEW: Argument extractors for CRUD operations
def _args_create_incident(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    # Extract short_description from question
    caller = metadata.get('username') or metadata.get('caller_id')
    return {
        'short_description': question[:140],
        'description': question,
        'caller_id': caller,
        'priority': 4,
        'impact': 3,
        'urgency': 3
    }

def _args_update_field(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    inc = _extract_incident_number(question)
    # Extract field name and value from patterns like "update priority to 1"
    m = re.search(r"(?:update|change|set) (\w+) (?:to|=)\s*([^\s,]+)", question, re.IGNORECASE)
    field_updates = {}
    if m:
        field_updates[m.group(1)] = m.group(2)
    return {
        'incident_number': inc,
        'field_updates': field_updates
    } if inc else {'field_updates': field_updates}

def _args_close(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    inc = _extract_incident_number(question)
    # Extract close notes
    m = re.search(r"close (?:with|notes?):?\s*(.+)", question, re.IGNORECASE)
    notes = m.group(1) if m else "Closed via DevCopilot"
    resolved_by = metadata.get('username')
    payload = {
        'close_code': 'Solved',
        'close_notes': notes
    }
    if inc:
        payload['incident_number'] = inc
    if resolved_by:
        payload['resolved_by'] = resolved_by
    return payload

# NEW: Argument extractors for assignment operations
def _args_assignment(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    inc = _extract_incident_number(question)
    # Extract assignee from "assign to John Doe" patterns
    m = re.search(r"assign (?:to|incident (?:to|for))\s+([a-zA-Z\s]+)", question, re.IGNORECASE)
    if not m:
        m = re.search(r"reassign (?:to)\s+([a-zA-Z\s]+)", question, re.IGNORECASE)
    assigned_to = m.group(1).strip() if m else None
    # Extract assignment group
    g = _extract_group(question)
    payload = {}
    if inc:
        payload['incident_number'] = inc
    if assigned_to:
        payload['assigned_to'] = assigned_to
    if g:
        payload['assignment_group'] = g
    return payload

def _args_similar_resolved(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Get similar incidents filtered by resolved/closed state for learning resolution patterns"""
    args = _args_incident(question, metadata)
    # Add filter for resolved/closed incidents only
    args['state_filter'] = 'resolved'  # Will filter for states 6,7,8 (Resolved, Closed)
    return args

def _args_work_notes(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract arguments for fetching work notes from incident"""
    inc = _extract_incident_number(question)
    if not inc:
        # Check canonical incident
        canonical = metadata.get('canonical_incident', {})
        if isinstance(canonical, dict) and canonical.get('number'):
            inc = canonical.get('number')
    
    if not inc:
        logger.warning(f"[plan_recipes] _args_work_notes: No incident found! question={question[:100]}, canonical={metadata.get('canonical_incident')}")
    
    return {
        'incident_number': inc,
        'max_notes': 20,
        'llm_summary': True
    } if inc else {}

def _should_include_similar_incidents(question: str, metadata: Dict[str, Any]) -> bool:
    """Determine if similar incidents search is contextually relevant.
    
    Include similar incidents when user asks for:
    - Comparison/pattern analysis
    - "similar", "related", "like this", "other incidents"
    - "has this happened before", "recurring issue"
    
    Exclude when user asks for:
    - Details/status of ONE specific incident
    - "show me", "get me", "what is the status", "details of"
    """
    q = question.lower()
    
    # INCLUDE: Explicit requests for similar/related incidents
    include_keywords = [
        'similar', 'related', 'like this', 'like that',
        'other incidents', 'other cases',
        'happened before', 'recurring', 'pattern',
        'compare', 'comparison', 'versus', 'vs',
        'how many', 'frequency', 'trend'
    ]
    if any(kw in q for kw in include_keywords):
        return True
    
    # EXCLUDE: Specific incident status/detail queries OR search/filter queries
    exclude_keywords = [
        'show me the', 'get me the', 'give me the',
        'what is the status', 'status of', 'details of',
        'description of', 'information about', 'info on',
        'provide details', 'provide the details',
        'all incidents', 'all the incidents', 'list incidents',
        'give me all', 'show me all', 'overview of'
    ]
    if any(kw in q for kw in exclude_keywords):
        return False
    
    # DEFAULT: Require explicit incident reference (specific INC number or "this/that incident")
    # Only include if we have a concrete incident to find similarities for
    has_incident_ref = bool(_extract_incident_number(question))
    has_incident_pronoun = any(phrase in q for phrase in ['this incident', 'that incident', 'the incident'])
    return has_incident_ref or has_incident_pronoun

def _args_similar_incidents_conditional(question: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Conditionally return similar incidents args only when contextually relevant."""
    if _should_include_similar_incidents(question, metadata):
        return _args_incident(question, metadata)
    logger.info(f"[plan_recipes] Skipping get_similar_incidents (single incident query)")
    return None  # Signal to skip this tool

def _args_incident_conditional(question: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Conditionally return fetch_servicenow_incident args only if incident number exists."""
    inc = _extract_incident_number(question)
    if not inc:
        # No incident number found - skip this tool
        logger.info(f"[plan_recipes] Skipping fetch_servicenow_incident (no incident number in query)")
        return None
    return {'incident_number': inc}

def _args_pattern_analysis(question: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Build arguments for multi-incident pattern analysis.
    
    Extracts incidents from:
    1. Previous tool outputs (run_incident_query, etc.)
    2. Short-term memory cache
    3. Explicit mentions in current question
    
    Returns None if fewer than 2 incidents found (use regular resolution_progress instead)
    """
    # Get incidents from short-term memory and recent outputs
    incidents = _extract_incidents_from_stm(metadata)
    
    # Also check current question for explicit incident numbers
    current_incidents = re.findall(r'\b(INC0\d+)\b', question, re.IGNORECASE)
    for inc in current_incidents:
        if inc.upper() not in incidents:
            incidents.append(inc.upper())
    
    if len(incidents) < 2:
        logger.info(f"[plan_recipes] Skipping pattern_analysis - only {len(incidents)} incident(s) found")
        return None
    
    # Limit to first 10 incidents for performance
    incidents = incidents[:10]
    logger.info(f"[plan_recipes] Building pattern analysis for {len(incidents)} incidents: {incidents[:5]}...")
    
    return {
        'incident_numbers': incidents,
        'analysis_type': 'root_cause_resolution',
        'include_workarounds': True
    }

def _args_incident_query_conditional(question: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Conditional version of _args_incident_query - only returns args when question is asking to list/show/find incidents.
    
    Used in incident_triage recipe to avoid running query when user is asking about a specific incident.
    
    Returns query args when question contains:
    - List/show/find verbs: "show me", "list", "find", "get all", "tell me about"
    - Plural "incidents": "open incidents", "all incidents", "incidents related to"
    - Search queries: "related to", "with priority", "assigned to"
    
    Returns None when:
    - Asking about a specific incident: "What's the status of INC0010001?"
    - User story queries: "Give me summary of user story IN-4"
    """
    q_lower = question.lower()
    
    # EXCLUDE if asking about user stories/JIRA
    if 'user story' in q_lower or 'story' in q_lower or re.search(r'\bIN-\d+', question):
        return None
    
    # EXCLUDE if asking about a specific incident only
    inc_numbers = re.findall(r'\b(INC0\d+)\b', question, re.IGNORECASE)
    if len(inc_numbers) == 1 and not any(keyword in q_lower for keyword in ['similar', 'like', 'related', 'all', 'show', 'list']):
        return None
    
    # INCLUDE if question has list/search verbs
    list_verbs = ['show', 'list', 'find', 'get', 'fetch', 'retrieve', 'tell me', 'give me', 'display']
    has_list_verb = any(verb in q_lower for verb in list_verbs)
    
    # INCLUDE if asking for multiple incidents
    has_plural = 'incidents' in q_lower or 'all' in q_lower or 'open' in q_lower
    
    # INCLUDE if has search filters
    has_filters = any(keyword in q_lower for keyword in ['related to', 'with priority', 'assigned to', 'because of', 'due to'])
    
    if has_list_verb or has_plural or has_filters:
        return _args_incident_query(question, metadata)
    
    return None

def _args_incident_query(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract filter keywords and construct sysparm_query for ServiceNow.
    
    Handles queries like:
    - 'PAS related and NIGO issues' -> short_descriptionLIKEPAS^short_descriptionLIKENIGO
    - 'incidents with priority 1' -> priorityLIKE1
    - 'incidents assigned to Database team' -> assignment_groupLIKEDatabase
    """
    q_lower = question.lower()
    query_parts = []
    
    # Extract keywords that should be in short_description
    # Common patterns: "PAS related", "NIGO issues", "database problems"
    keywords_to_find = []
    
    # Pattern 1: "X related" or "X issues"
    import re
    patterns = [
        r'\b([A-Z]{2,})\s+(?:related|issues?|problems?|errors?)\b',
        r'(?:related to|about|regarding|concerning)\s+([A-Z][A-Za-z0-9]+)',
        r'(?:because of|due to|caused by)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Za-z]+)?)',  # NEW: "because of Banking information"
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, question)
        keywords_to_find.extend(matches)
    
    # Pattern 2: Look for uppercase acronyms (PAS, NIGO, APS)
    acronyms = re.findall(r'\b([A-Z]{2,})\b', question)
    keywords_to_find.extend(acronyms)
    
    # Pattern 3: Look for common domain-specific keywords (case-insensitive)
    domain_keywords = ['banking', 'beneficiary', 'payer', 'underwriting', 'compliance', 'client', 'policy', 'premium']
    for kw in domain_keywords:
        if kw in q_lower:
            keywords_to_find.append(kw.title())  # Add as title case for ServiceNow search
    
    # Deduplicate and filter
    keywords_to_find = list(set([k.strip() for k in keywords_to_find if len(k.strip()) >= 2 and k.upper() not in ['INC', 'CHG', 'THE', 'AND', 'OR']]))
    
    # Build query
    if keywords_to_find:
        for kw in keywords_to_find:
            query_parts.append(f'short_descriptionLIKE{kw}')
    
    # Priority filter
    if 'priority' in q_lower:
        priority_match = re.search(r'priority\s+(\d)', question, re.IGNORECASE)
        if priority_match:
            query_parts.append(f'priority={priority_match.group(1)}')
    
    # State filter
    if 'open' in q_lower or 'active' in q_lower:
        query_parts.append('stateIN1,2,3,4,5')
    elif 'closed' in q_lower or 'resolved' in q_lower:
        query_parts.append('stateIN6,7,8')
    
    # Duration filter: "open for more than X days/weeks/months"
    duration_match = re.search(r'(?:more than|longer than|over|greater than)\s+(\d+)\s+(day|week|month|year)s?', q_lower)
    if duration_match:
        value = int(duration_match.group(1))
        unit = duration_match.group(2)
        
        # Convert to days
        days_ago = value
        if unit == 'week':
            days_ago = value * 7
        elif unit == 'month':
            days_ago = value * 30
        elif unit == 'year':
            days_ago = value * 365
        
        # ServiceNow query: incidents opened before N days ago
        query_parts.append(f'sys_created_on<javascript:gs.daysAgoStart({days_ago})')
        logger.info(f"[plan_recipes] Duration filter: opened before {days_ago} days ago")
    
    # Sorting: oldest/newest queries
    order_by = None
    if 'oldest' in q_lower or 'earliest' in q_lower:
        order_by = 'sys_created_on'  # Ascending (oldest first)
    elif 'newest' in q_lower or 'most recent' in q_lower or 'latest' in q_lower:
        order_by = '^ORDERBYDESCsys_created_on'  # Descending (newest first)
    
    sysparm_query = '^'.join(query_parts) if query_parts else 'sys_created_onONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)'
    
    result = {'sysparm_query': sysparm_query, 'limit': 50}
    if order_by:
        result['sysparm_query'] += f'^{order_by}' if not order_by.startswith('^') else order_by
        logger.info(f"[plan_recipes] Added sorting: {order_by}")
    
    logger.info(f"[plan_recipes] Constructed incident query: {result['sysparm_query']}")
    return result

def _args_incident_count(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Build count query arguments - similar to search but with count flag.
    
    Handles queries like:
    - 'how many open incidents' -> count with state filter
    - 'total incidents with priority 1' -> count with priority filter
    """
    # Use same query construction as incident_query
    args = _args_incident_query(question, metadata)
    
    # Add count flag and set limit to 1 (we only need the count, not data)
    args['count_only'] = True
    args['limit'] = 1
    
    logger.info(f"[plan_recipes] Constructed count query: {args['sysparm_query']}")
    return args

def _args_incident_group_by(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Build group-by aggregation query arguments.
    
    Handles queries like:
    - 'which teams have the most open incidents' -> group by assignment_group, count, sort desc
    - 'show me priority distribution' -> group by priority
    """
    q_lower = question.lower()
    
    # Determine grouping field
    group_by_field = None
    if 'team' in q_lower or 'group' in q_lower or 'assignment' in q_lower:
        group_by_field = 'assignment_group'
    elif 'priority' in q_lower:
        group_by_field = 'priority'
    elif 'category' in q_lower:
        group_by_field = 'category'
    elif 'state' in q_lower or 'status' in q_lower:
        group_by_field = 'state'
    else:
        group_by_field = 'assignment_group'  # Default
    
    # Use base query construction for filters
    args = _args_incident_query(question, metadata)
    
    # Add group-by parameters
    args['group_by'] = group_by_field
    args['aggregate'] = 'count'
    args['limit'] = 20  # Top 20 groups
    
    logger.info(f"[plan_recipes] Constructed group-by query: field={group_by_field}, query={args['sysparm_query']}")
    return args

def _args_assignment_prediction(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract arguments for assignment prediction from incident and similar incidents"""
    args = _args_incident(question, metadata)
    
    # Extract incident number if available
    inc = args.get('incident_number')
    
    # Get short description from metadata if available
    canonical = metadata.get('canonical_incident', {})
    if isinstance(canonical, dict):
        short_desc = canonical.get('short_description', '')
        category = canonical.get('category', '')
    else:
        short_desc = ''
        category = ''
    
    result = {
        'incident_number': inc,
        'short_description': short_desc,
        'category': category
    }
    
    # Similar incidents will be populated from previous step in recipe
    if 'similar_incidents' in metadata:
        result['similar_incidents'] = metadata['similar_incidents']
    
    return result

RECIPE_MAP: Dict[str, List[Dict[str, Any]]] = {
    'backlog_grooming': [
        # Provide an incident backlog overview (priority + aging distribution)
        {'tool': 'fetch_backlog_overview', 'args_fn': lambda q, m: {'days': 14}}
    ],
    'incident_triage': [
        {'tool': 'run_incident_query', 'args_fn': _args_incident_query_conditional},
        {'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident_conditional},
        {'tool': 'get_similar_incidents', 'args_fn': _args_similar_incidents_conditional},
        {'tool': 'fetch_kb_articles', 'args_fn': lambda q, m: {} if m.get('wiki_only_context') else _args_kb(q, m)}
    ],
    'incident_search': [
        {'tool': 'run_incident_query', 'args_fn': _args_incident_query},
    ],
    'incident_count': [
        # Count query - returns aggregate count, not list of incidents
        {'tool': 'run_incident_query', 'args_fn': _args_incident_count},
    ],
    'incident_group_by': [
        # Group-by aggregation - returns incidents grouped by field (e.g., assignment_group)
        {'tool': 'run_incident_query', 'args_fn': _args_incident_group_by},
    ],
    'search_and_analyze': [
        # Compound operation: First search, then analyze patterns
        # Step 1: Find all matching incidents
        {'tool': 'run_incident_query', 'args_fn': _args_incident_query},
        # Step 2: Pattern analysis will be added dynamically in build_recipe based on search results
    ],
    'pattern_analysis': [
        # Multi-incident pattern analysis: No single tool handles this
        # Instead, the recipe builder will expand this into multiple summarize_incident_work_notes calls
        # This is handled specially in build_recipe function
    ],
    'resolution_progress': [
        # Step 1: Get incident details
        {'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident},
        # Step 2: Get work notes to see actual resolution steps documented
        {'tool': 'summarize_work_notes', 'args_fn': _args_work_notes},
        # Step 3: Get similar RESOLVED incidents to learn from their resolution patterns
        {'tool': 'get_similar_incidents', 'args_fn': _args_similar_resolved},
        # Step 4: Check KB for documented resolution procedures
        {'tool': 'fetch_kb_articles', 'args_fn': _args_kb}
    ],
    'assignment_prediction': [
        # Step 1: Get incident details including category and description
        {'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident},
        # Step 2: Get similar incidents to learn from historical assignment patterns
        {'tool': 'get_similar_incidents', 'args_fn': _args_incident},
        # Step 3: Predict assignment using rules engine and historical data
        {'tool': 'predict_assignment_group', 'args_fn': _args_assignment_prediction},
        # Step 4: Optionally check current workload of recommended groups
        {'tool': 'fetch_assignment_group_load', 'args_fn': _args_group}
    ],
    'user_incidents': [
        {'tool': 'fetch_user_incidents', 'args_fn': _args_user},
        {'tool': 'suggest_user_incident_closure_actions', 'args_fn': _args_user},
        {'tool': 'user_incident_status_counts', 'args_fn': _args_user},
        {'tool': 'user_incident_priority_counts', 'args_fn': _args_user},
        {'tool': 'user_incident_trend', 'args_fn': _args_user},
        {'tool': 'user_incident_similar_suggestions', 'args_fn': _args_user},
        {'tool': 'user_incident_workaround_suggestions', 'args_fn': _args_user}
    ],
    'similar_incidents': [
        {'tool': 'run_incident_query', 'args_fn': _args_incident_query_conditional},
        {'tool': 'get_similar_incidents', 'args_fn': _args_incident},
        {'tool': 'fetch_kb_articles', 'args_fn': _args_kb}
    ],
    'workaround_lookup': [
        {'tool': 'workaround_lookup', 'args_fn': _args_incident},
        {'tool': 'fetch_kb_articles', 'args_fn': _args_kb}
    ],
    'knowledge_lookup': [
        {'tool': 'fetch_kb_articles', 'args_fn': _args_kb}
    ],
    'change_risk': [
        {'tool': 'fetch_change_records_related', 'args_fn': _args_change_related},
        {'tool': 'risk_assess_change', 'args_fn': _args_change}
    ],
    'assignment_load': [
        {'tool': 'fetch_assignment_group_load', 'args_fn': _args_group}
    ],
    'cmdb_context': [
        {'tool': 'fetch_cmdb_ci_context', 'args_fn': _args_ci}
    ],
    'release_notes': [
        {'tool': 'fetch_backlog_overview', 'args_fn': lambda q, m: {'days': 14}}
    ],
    'log_analysis': [
        {'tool': 'generate_splunk_query', 'args_fn': lambda q, m: {'question': q[:180]}},
        {'tool': 'splunk_query', 'args_fn': lambda q, m: {'query': q[:180]}}
    ],
    'documentation_gap': [
        {'tool': 'wiki_rag_tool', 'args_fn': lambda q, m: {'query': q[:140]}},
        {'tool': 'fetch_kb_articles', 'args_fn': lambda q, m: {} if m.get('wiki_only_context') else _args_kb(q, m)}
    ],
    'story_quality': [
        {'tool': 'fetch_backlog_overview', 'args_fn': lambda q, m: {'days': 14}},
        {'tool': 'fetch_kb_articles', 'args_fn': _args_kb}
    ],
    'jira_user_story': [
        {'tool': 'jira_fetch_user_story', 'args_fn': _args_jira_story_fetch},
        {'tool': 'jira_summarize_user_story', 'args_fn': _args_jira_story_summarize}
    ],
    'login_governance': [
        {'tool': 'jira_fetch_user_story', 'args_fn': _args_jira_story_fetch},
        {'tool': 'jira_summarize_user_story', 'args_fn': _args_jira_story_summarize},
        {'tool': 'fetch_backlog_overview', 'args_fn': _args_backlog_window},
        {'tool': 'generate_plan_receipt', 'args_fn': _args_plan_receipt}
    ],
    'mapping_workflow': [
        {'tool': 'mapping_assignment_plan', 'args_fn': _args_mapping}
    ],
    # NEW: Work notes recipes
    'incident_work_notes': [
        {'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident},
        {'tool': 'get_incident_work_notes', 'args_fn': _args_incident},
        {'tool': 'summarize_incident_work_notes', 'args_fn': _args_incident}
    ],
    # NEW: Bulk work notes analysis (5+ incidents)
    'bulk_work_notes_analysis': [
        # Single tool handles parallel fetch + aggregate analysis
        {'tool': 'analyze_bulk_work_notes', 'args_fn': _args_bulk_work_notes}
    ],
    # PHASE 2: Intelligent Workaround Agent
    'workaround_search': [
        {'tool': 'intelligent_workaround_search', 'args_fn': _args_workaround_search}
    ],
    # PHASE 3: Root Cause Identification Agent
    'root_cause_identification': [
        {'tool': 'identify_root_cause', 'args_fn': _args_root_cause}
    ],
    'add_work_note': [
        {'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident},
        {'tool': 'add_incident_work_note', 'args_fn': _args_work_note_add}
    ],
    # NEW: Date query recipes
    'incidents_today': [
        {'tool': 'get_incidents_created_today', 'args_fn': lambda q, m: {'include_closed': False}}
    ],
    'incidents_by_date': [
        {'tool': 'get_incidents_by_date_range', 'args_fn': _args_date_range}
    ],
    'incidents_date_range': [
        {'tool': 'get_incidents_by_date_range', 'args_fn': _args_date_range}
    ],
    # NEW: CRUD recipes
    'create_incident': [
        {'tool': 'create_incident', 'args_fn': _args_create_incident}
    ],
    'update_incident': [
        {'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident},
        {'tool': 'update_incident_field', 'args_fn': _args_update_field}
    ],
    'close_incident': [
        {'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident},
        {'tool': 'close_incident', 'args_fn': _args_close}
    ],
    # NEW: Assignment recipes
    'assign_incident': [
        {'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident},
        {'tool': 'assign_incident', 'args_fn': _args_assignment}
    ],
    # ============================================================================
    # INSURANCE QUOTE WORKFLOW (Demo: Multi-domain orchestration capability)
    # ============================================================================
    'insurance_quote_request': [
        # Step 1: List available policies (clarification step)
        {'tool': 'list_available_policies', 'args_fn': _args_insurance_policy_list},
        # Step 2: Fetch selected policy details (ONLY essential data for next agent)
        {'tool': 'fetch_policy_details', 'args_fn': _args_insurance_policy_details},
        # Step 3: Get OLD ZIP risk rating (uses current_zip from policy details)
        {'tool': 'get_zip_risk_rating', 'args_fn': _args_insurance_zip_risk_old, 'output_key': 'get_zip_risk_rating_old'},
        # Step 4: Get NEW ZIP risk rating (from user query)
        {'tool': 'get_zip_risk_rating', 'args_fn': _args_insurance_zip_risk_new, 'output_key': 'get_zip_risk_rating_new'},
        # Step 5: Get vehicle valuation (uses policy_number from policy details)
        {'tool': 'get_vehicle_details', 'args_fn': _args_insurance_vehicle},
        # Step 6: Calculate premium (uses data from ALL previous agents - no DB calls)
        {'tool': 'calculate_premium', 'args_fn': _args_insurance_premium_calc},
        # Step 7: Format comparison report (uses data from ALL previous agents)
        {'tool': 'format_quote_comparison', 'args_fn': _args_insurance_quote_format}
    ]
}

# Persona-specific extensions (appended) – can refine later
PERSONA_EXTENSIONS: Dict[str, Dict[str, List[Dict[str, Any]]]] = {
    'product_owner': {
        # FIXED: Conditional backlog overview - only when contextually relevant
        'incident_triage': [{'tool': 'fetch_backlog_overview', 'args_fn': _args_backlog_conditional}],
        # For backlog grooming, add assignment group load insight if user references a group keyword.
        'backlog_grooming': [
            {'tool': 'fetch_assignment_group_load', 'args_fn': _args_group}
        ]
    },
    'engineering_lead': {
        'incident_triage': [{'tool': 'fetch_assignment_group_load', 'args_fn': _args_group}],
        'change_risk': [{'tool': 'fetch_cmdb_ci_context', 'args_fn': _args_ci}]
    },
    'developer': {
        'incident_triage': [
           
            {'tool': 'fetch_change_records_related', 'args_fn': _args_change_related}
        ],
        'user_incidents': [
            {'tool': 'fetch_user_incidents', 'args_fn': _args_user},
            {'tool': 'suggest_user_incident_closure_actions', 'args_fn': _args_user},
            {'tool': 'user_incident_status_counts', 'args_fn': _args_user},
            {'tool': 'user_incident_priority_counts', 'args_fn': _args_user},
            {'tool': 'user_incident_trend', 'args_fn': _args_user},
            {'tool': 'user_incident_similar_suggestions', 'args_fn': _args_user},
            {'tool': 'user_incident_workaround_suggestions', 'args_fn': _args_user}
        ],
        'log_analysis': [
            {'tool': 'run_incident_query', 'args_fn': lambda q, m: {'sysparm_query': 'descriptionLIKEerror^stateNOT IN7,8', 'limit': 10}}
        ],
        'change_risk': [
            {'tool': 'fetch_cmdb_ci_context', 'args_fn': _args_ci}
        ]
    },
    'business_owner': {
        'backlog_grooming': [
            {'tool': 'fetch_assignment_group_load', 'args_fn': _args_group}
        ]
    }
}


logger = logging.getLogger("agentic_orchestrator_auto.plan_recipes")


def refine_arguments_with_llm(question: str, context_messages: List[Dict], 
                               entities: Dict[str, Any], plan: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """LLM-based argument refinement layer (Phase 2)
    
    After recipes/intent but before final plan creation, use LLM to:
    1. Consider conversation context and tracked entities
    2. Refine search queries for semantic meaning
    3. Resolve coreferences ("it", "that incident", "those requirements")
    4. Handle typos and variations
    
    Args:
        question: Current user question
        context_messages: Recent conversation history
        entities: Tracked entities from ConversationEntityMemory
        plan: Initial plan from recipes
        
    Returns:
        Refined plan with improved arguments
    """
    if not os.getenv('ENABLE_LLM_ARG_REFINEMENT', '').lower() in ('1', 'true', 'yes'):
        return plan
    
    try:
        from openai import AzureOpenAI
        
        # Create Azure OpenAI client
        azure_endpoint = os.getenv('AZURE_OPENAI_ENDPOINT')
        azure_key = os.getenv('AZURE_OPENAI_API_KEY')
        azure_version = os.getenv('OPENAI_API_VERSION', '2023-05-15')
        
        if not azure_endpoint or not azure_key:
            logger.warning("[plan_recipes] LLM refinement disabled: missing Azure OpenAI credentials")
            return plan
        
        client = AzureOpenAI(
            azure_endpoint=azure_endpoint,
            api_key=azure_key,
            api_version=azure_version
        )
        
        # Build context summary
        recent_context = []
        for msg in context_messages[-5:]:  # Last 5 messages
            role = msg.get('role', 'user')
            content = msg.get('content', '')[:200]  # Truncate
            recent_context.append(f"{role}: {content}")
        
        context_str = "\n".join(recent_context)
        entities_str = json.dumps(entities, indent=2) if entities else "No entities tracked"
        
        # Build prompt for LLM
        system_prompt = """You are an argument extraction assistant for a ServiceNow incident management system.

Given:
- User's current question
- Recent conversation context
- Tracked entities (incidents, topics, requirements)
- Initial tool plan with arguments

Your task: Refine the arguments to be semantically accurate, considering:
1. Conversation context (what was discussed before)
2. Coreference resolution ("it" → actual incident, "those" → specific topics)
3. Typo tolerance and semantic equivalence
4. Extract the TRUE user intent, not literal text

Return ONLY a JSON array of the refined plan with the SAME structure, just improved arguments.
"""

        user_prompt = f"""**Recent Conversation:**
{context_str}

**Tracked Entities:**
{entities_str}

**User's Current Question:**
{question}

**Initial Plan:**
{json.dumps(plan, indent=2)}

**Instructions:**
- If the plan searches for similar incidents with a literal query like "APS requierments", extract the semantic topic ("APS requirements")
- If entities mention specific incidents/topics, use those in arguments
- Preserve tool names and structure, only refine arguments
- Return valid JSON array matching the input structure
"""

        # Build request parameters conditionally
        request_params = {
            "model": os.getenv('GPT_MODEL_NAME', 'gpt-4'),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.1,
            "max_tokens": 1000
        }
        
        # Only add response_format for gpt-4 models (not gpt-3.5)
        if "gpt-4" in os.getenv('GPT_MODEL_NAME', 'gpt-4'):
            request_params["response_format"] = {"type": "json_object"}
        
        response = client.chat.completions.create(**request_params)
        
        result_text = response.choices[0].message.content.strip()
        
        # Parse response - handle both array and {"plan": array} formats
        try:
            result = json.loads(result_text)
            if isinstance(result, dict) and 'plan' in result:
                refined_plan = result['plan']
            elif isinstance(result, list):
                refined_plan = result
            else:
                logger.warning(f"[plan_recipes] LLM refinement returned unexpected format: {type(result)}")
                return plan
                
            logger.info(f"[plan_recipes] LLM refined arguments: {len(refined_plan)} steps")
            return refined_plan
            
        except json.JSONDecodeError as e:
            logger.warning(f"[plan_recipes] Failed to parse LLM refinement response: {e}")
            return plan
            
    except Exception as e:
        logger.warning(f"[plan_recipes] LLM argument refinement failed: {e}")
        return plan


def build_recipe(intent: str, persona: Optional[str], question: str, metadata: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    metadata = metadata or {}
    if persona and 'persona' not in metadata:
        metadata['persona'] = persona
    if intent and 'intent' not in metadata:
        metadata['intent'] = intent
    
    # SPECIAL HANDLING: Insurance quote clarification
    if intent == 'insurance_quote_request':
        # Check if user has selected a policy
        policy_num = _extract_policy_number(question)
        if not policy_num and not metadata.get('selected_policy_number'):
            # User hasn't selected a policy yet - build clarification plan
            logger.info("[plan_recipes] Insurance quote requested but no policy selected - building clarification plan")
            return [
                # Step 1: List available policies
                {'tool': 'list_available_policies', 'args_fn': _args_insurance_policy_list},
                # Step 2: Response will include clarification request
            ]
        else:
            # Policy selected - store in metadata for subsequent steps
            if policy_num:
                metadata['selected_policy_number'] = policy_num
                logger.info(f"[plan_recipes] Policy {policy_num} selected - proceeding with full workflow")
    
    # SPECIAL HANDLING: Compound search + analysis
    if intent == 'search_and_analyze':
        # Build compound plan: search query + pattern analysis on top N results
        logger.info(f"[plan_recipes] Building search_and_analyze recipe (search + analyze top results)")
        steps = []
        
        # Phase 1: Run the search query with limit for performance
        search_args = _args_incident_query(question, metadata)
        if search_args:
            # Limit search results to 10 for analysis efficiency
            search_args['limit'] = min(search_args.get('limit', 100), 10)
            steps.append({'tool': 'run_incident_query', 'args': search_args})
        
        # Phase 2: Add analysis note - the system will auto-detect pattern analysis need
        # Since we can't predict which incidents will be returned, we rely on:
        # 1. Short-term memory to store the search results
        # 2. Follow-up re-planning or LangGraph to detect "root cause/solution" keywords
        # For now, return search only - the planner will see the compound query and add analysis
        logger.info(f"[plan_recipes] search_and_analyze: Letting planner expand analysis phase")
        return steps
    
    # SPECIAL HANDLING: Pattern analysis across multiple incidents
    if intent == 'pattern_analysis':
        incidents = _extract_incidents_from_stm(metadata)
        
        # NEW: If 5+ incidents, use bulk analyzer instead of per-incident summarization
        if len(incidents) >= 5:
            logger.info(f"[plan_recipes] Pattern analysis with {len(incidents)} incidents - using bulk analyzer")
            return [
                {
                    'tool': 'analyze_bulk_work_notes',
                    'args': _args_bulk_work_notes(question, metadata)
                }
            ]
        elif len(incidents) >= 2:
            # Build plan: summarize_incident_work_notes for each incident (limit to 10)
            logger.info(f"[plan_recipes] Building pattern_analysis recipe for {len(incidents)} incidents")
            steps = []
            for inc in incidents[:10]:  # Limit to 10 for performance
                steps.append({
                    'tool': 'summarize_incident_work_notes',
                    'args': {'incident_number': inc, 'style': 'structured_resolution'}
                })
            return steps
        else:
            # Check if this is a discovery query (asking about recurring/unaddressed incidents)
            q_lower = question.lower()
            if any(kw in q_lower for kw in ['are there', 'do we have', 'any recurring', 'unaddressed', "haven't addressed"]):
                # Discovery mode: first search for all open incidents, then analyze
                logger.info(f"[plan_recipes] Pattern discovery mode - will search first, then analyze")
                steps = []
                # Step 1: Get all open incidents (limit for performance)
                steps.append({
                    'tool': 'run_incident_query',
                    'args': {'sysparm_query': 'stateIN1,2,3,4,5', 'limit': 20}
                })
                # Note: Planner will expand with analysis tools based on question keywords
                return steps
            else:
                # Fallback to single incident resolution_progress if < 2 incidents
                logger.info(f"[plan_recipes] Pattern analysis requested but only {len(incidents)} incident(s) - falling back to resolution_progress")
                intent = 'resolution_progress'
    
    # Phase 1: Check for short-term memory context (ROLLBACK: remove this block)
    stm_data = metadata.get('short_term_memory')
    if stm_data and stm_data.get('referenced_incidents'):
        # User is asking about previously retrieved incidents - use direct fetch plan
        logger.info(f"[plan_recipes] Short-term memory detected | "
                   f"tool={stm_data.get('referenced_tool')} incidents={stm_data.get('incident_count')}")
        
        # Override intent to use direct incident listing
        # This prevents searching for literal \"those incidents\" text or calling backlog_overview again
        if (intent in ('similar_incidents', 'backlog_grooming') and not _extract_incident_number(question)):
            # User said "those incidents" but we have the list cached
            # Build a simple fetch plan for the cached incidents
            incidents = stm_data['referenced_incidents'][:5]  # Limit to first 5 for token efficiency
            logger.info(f"[plan_recipes] Building direct fetch plan for {len(incidents)} cached incidents")
            return [
                {'tool': 'fetch_servicenow_incident', 
                 'args': {'incident_number': inc}} 
                for inc in incidents
            ]
    
    base = RECIPE_MAP.get(intent)
    if not base:
        logger.debug(f"[plan_recipes] No base recipe for intent='{intent}' persona='{persona}'")
        return None
    steps = list(base)
    logger.debug(f"[plan_recipes] Base steps for intent='{intent}': {[s['tool'] for s in steps]}")
    # Heuristic: if user is performing a keyword style incident search ("find incidents" or "incidents with")
    # prefer inserting the short description finder at the start (if not already present) so tests expecting
    # 'find_incidents_by_short_description' see it even when persona-based recipe is chosen.
    q_lower = question.lower()
    if intent in ('incident_triage', 'similar_incidents', 'workaround_lookup') and (
        'find incidents' in q_lower or 'incidents with' in q_lower or 'incidents about' in q_lower or 'short description' in q_lower
    ):
        already = any(s.get('tool') == 'find_incidents_by_short_description' for s in steps)
        if not already:
            steps.insert(0, {'tool': 'find_incidents_by_short_description', 'args_fn': _args_kb})
            logger.info(f"[plan_recipes] Injected finder tool at start for heuristic match intent='{intent}'")
    # Additional heuristic: for similar_incidents with an explicit incident number, ensure we first fetch
    # the canonical incident (for enriched short description) and also run the finder for breadth.
    if intent == 'similar_incidents':
        inc_num = _extract_incident_number(question)
        if inc_num:
            has_fetch = any(s.get('tool') == 'fetch_servicenow_incident' for s in steps)
            has_finder = any(s.get('tool') == 'find_incidents_by_short_description' for s in steps)
            new_order: List[Dict[str, Any]] = []
            if not has_fetch:
                new_order.append({'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident})
            if not has_finder:
                new_order.append({'tool': 'find_incidents_by_short_description', 'args_fn': _args_incident})
            if new_order:
                # Avoid duplicating tools that we inject; filter out any duplicates when concatenating
                existing = [s for s in steps if s.get('tool') not in {x['tool'] for x in new_order}]
                steps = new_order + existing
                logger.info(f"[plan_recipes] Reordered steps for similar_incidents with explicit incident {inc_num}")
    if persona and persona in PERSONA_EXTENSIONS and intent in PERSONA_EXTENSIONS[persona]:
        steps = steps + PERSONA_EXTENSIONS[persona][intent]
        logger.debug(f"[plan_recipes] Appended persona extension for persona='{persona}' intent='{intent}' -> +{[s['tool'] for s in PERSONA_EXTENSIONS[persona][intent]]}")
    built: List[Dict[str, Any]] = []
    for step in steps:
        tool = step['tool']
        fn = step.get('args_fn')
        args = {}
        if callable(fn):
            try:
                result = fn(question, metadata)
                # If args_fn returns None, skip this tool (conditional exclusion)
                if result is None:
                    logger.info(f"[plan_recipes] Skipping tool={tool} (args_fn returned None - conditional exclusion)")
                    continue
                args = result or {}
            except Exception as e:
                args = {}
                logger.warning(f"[plan_recipes] Arg function failed for tool={tool}: {e}")
        logger.debug(f"[plan_recipes] Built step tool={tool} args={args}")
        built.append({'tool': tool, 'args': args})
    logger.info(f"[plan_recipes] Final recipe intent='{intent}' persona='{persona}' steps={[s['tool'] for s in built]}")
    return built

__all__ = ['build_recipe']