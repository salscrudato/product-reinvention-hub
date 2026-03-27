import os
import re
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)

# Core intents (initial set)
INTENTS = [
    'incident_triage',
    'incident_search',
    'incident_count',
    'search_and_analyze',
    'similar_incidents',
    'resolution_progress',
    'pattern_analysis',
    'assignment_prediction',
    'assign_incident',
    'incident_group_by',
    'workaround_lookup',
    'knowledge_lookup',
    'code_annotation',
    'backlog_grooming',
    'change_risk',
    'assignment_load',
    'cmdb_context',
    'release_notes',
    'log_analysis',
    'documentation_gap',
    'story_quality',
    'login_governance',
    'jira_user_story',
    'insurance_quote_request'  # NEW: Insurance quote domain
]

# Keyword heuristics mapping (lowercase regex patterns -> intent)
KEYWORD_PATTERNS = [
    # NEW: Insurance quote queries (MUST be checked FIRST before billing/finance rejection)
    (r"insurance|premium|(?:auto|vehicle|car) (?:insurance|policy)|(?:insurance|premium) (?:quote|impact|calculation|estimate)", 'insurance_quote_request'),
    (r"(?:moving|relocat\w+|chang\w+ (?:my )?address).*(?:zip|zip code|location).*(?:insurance|premium|policy|quote|impact)", 'insurance_quote_request'),
    (r"(?:what|how much|calculate).*(?:will|would).*(?:my )?(?:insurance|premium|policy).*(?:be|cost|change)", 'insurance_quote_request'),
    (r"(?:zip|zip code).*(?:\d{5}).*(?:insurance|premium|quote|policy impact)", 'insurance_quote_request'),
    (r"(?:insurance|premium) (?:quote|calculation|estimate|impact).*(?:zip|location|moving|relocat)", 'insurance_quote_request'),
    # NEW: Assignment operations (MUST be checked FIRST before generic incident pattern)
    (r"who should (?:this |the |INC\d+ )?(?:incident |ticket |be )?be assigned|which (?:team|group) (?:should |to |can )?(?:handle|resolve|work on)|assignment (?:recommendation|suggestion|predict)", 'assignment_prediction'),
    (r"recommend (?:an? )?assignment|suggest (?:an? )?(?:team|group)|(?:predict|determine) assignment", 'assignment_prediction'),
    (r"assign (?:incident |INC\d+ )?(?:to |the incident to)", 'assign_incident'),
    (r"reassign (?:the )?(?:ticket|incident)|assign to", 'assign_incident'),
    # NEW: Compound search + pattern analysis queries (find incidents AND analyze them)
    (r"(?:find|get|show|list|search).*(?:all|incidents?).*(?:and|then).*(?:root cause|solution|workaround|pattern|resolution)", 'search_and_analyze'),
    (r"(?:all|incidents?).*(?:with|containing|matching|related to).*(?:suggest|what is|analyze).*(?:root cause|solution|workaround)", 'search_and_analyze'),
    (r"(?:what are|show me|get|find).*(?:oldest|newest|most recent|latest|earliest).*incidents?.*(?:why|what|explain|analyze)", 'search_and_analyze'),
    # NEW: Pattern analysis queries (multi-incident analysis) - MUST PRECEDE SINGLE-INCIDENT ROOT CAUSE
    (r"(?:are there|do we have|any).*(?:recurring|repeating|repeat|frequent).*incidents?", 'pattern_analysis'),
    (r"(?:recurring|repeating|repeat|frequent) incidents?.*(?:patterns?|haven'?t addressed|unaddressed|unresolved)", 'pattern_analysis'),
    (r"(?:what is |what are )?(?:the )?patterns? (?:on|in|for|of|across)", 'pattern_analysis'),
    (r"(?:common|recurring) (?:root cause|issue|problem|resolution)", 'pattern_analysis'),
    (r"(?:of|for|across|in) (?:these|those|this|all|the) incidents.*(?:pattern|root cause|resolution|workaround|summary|summarization)", 'pattern_analysis'),
    (r"(?:root cause|resolution|workaround|summary|summarization).*(?:pattern|trend|commonality|in (?:these|those|this|the) incidents?)", 'pattern_analysis'),
    (r"(?:workaround|resolution|root cause) (?:summary|summarization).*(?:in|for|of|across) (?:these|those|this|the) incidents?", 'pattern_analysis'),
    # PRIORITY: Resolution progress queries (MUST match AFTER pattern_analysis but BEFORE generic "incidents related to")
    # Root cause analysis (should fetch work notes)
    (r"root cause|rca|cause (?:of|for) (?:the |this )?(?:incident|issue|problem)|what caused|why (?:did|is) (?:this|the)", 'resolution_progress'),
    # Workarounds and fixes (should fetch work notes for documented workarounds)
    (r"workaround|temporary fix|interim solution|quick fix|work around|bypass (?:the |this )?(?:issue|problem)", 'resolution_progress'),
    # Resolution steps and progress (single incident focus)
    (r"(?:what|which) steps (?:are )?(?:currently )?(?:being )?taken|steps (?:to )?resolv(?:e|ing)|resolution (?:progress|steps|status)", 'resolution_progress'),
    (r"how (?:to|is|are|was|were) (?:this|the) (?:incident|issue).*?(?:being )?resolv(?:e|ed|ing)|resolution (?:approach|plan|strategy)", 'resolution_progress'),
    (r"(?:what )?work (?:is )?(?:being done|in progress|done so far)|current (?:status|progress) (?:of|on) resolv", 'resolution_progress'),
    # NEW: Count/aggregation queries (MUST come BEFORE incident_search to avoid list response)
    (r"(?:how many|what is the (?:count|number) of|total (?:number of)?|count (?:of|the)?|what'?s the count)\s+(?:open |active |closed |resolved |all )?incidents?", 'incident_count'),
    (r"(?:give me|show me|get|provide) (?:the )?(?:count|total|number) of (?:open |active |closed |resolved |all )?incidents?", 'incident_count'),
    (r"incidents? (?:count|total|statistics|metrics|summary)", 'incident_count'),
    # NEW: Search/filter queries (keyword-based, not semantic similarity)
    (r"(?:what are|show me|get|find).*(?:oldest|newest|most recent|latest|earliest).*(?:open |active |closed |resolved |all )?incidents?", 'incident_search'),
    (r"(?:overview|list|show|find|get|search|filter) (?:all )?incidents? (?:that|which) (?:are|have|match|contain)", 'incident_search'),
    (r"(?:give|show|provide|get) (?:me )?(?:an? )?(?:overview|list) of (?:all )?incidents?", 'incident_search'),
    (r"incidents? (?:with|containing|matching) \w+", 'incident_search'),
    (r"(?:all|show|list|find|give me|get me|show me) (?:the )?incidents? (?:that|which) (?:are|have)", 'incident_search'),
    # Enhanced: Match "show me [the] incidents [state] [and] related to X" OR "show me [the] [state] incidents related to X"
    # Handles both word orders: "incidents open and related" and "open incidents related"
    # Fixed: Allow multi-word topics after "related to" (e.g., "APS requirement", "MIB Requirements")
    (r"(?:all|show|list|find|give me|get me|show me) (?:the )?(?:(?:open |active |closed |resolved |all )?incidents?|incidents? (?:that (?:are )?)?(?:open |active |closed |resolved ))(?:and |or |that (?:are )?)?(?:related to|about|for|with|containing|regarding) (?:PAS|NIGO|APS|[\w\s]+)", 'incident_search'),
    # NOTE: These patterns are AFTER resolution_progress to avoid matching "root cause of incident related to X"
    (r"incidents? (?:related to|about|regarding|concerning|for|with|on) [\w\s]+", 'similar_incidents'),
    (r"similar incidents?|find (?:related|similar) incident|(?:show|get|find) similar", 'similar_incidents'),
    (r"kb |knowledge (?:article|base)", 'knowledge_lookup'),
    (r"annotate code|explain code|code annotation", 'code_annotation'),
    (r"backlog|groom|refine user stor|prioriti[sz]e stor", 'backlog_grooming'),
    (r"change risk|risk of change|impact analysis", 'change_risk'),
    (r"(?:which|what) (?:teams?|groups?|assignment groups?).*(?:have|has|with).*(?:most|highest|top|maximum|largest number|greatest).*(?:open |active |unresolved )?incidents?", 'incident_group_by'),
    (r"(?:show me|get|find|list).*(?:teams?|groups?).*(?:by|ranked by|sorted by).*incident.*(?:count|volume|load)", 'incident_group_by'),
    (r"assignment load|team capacity|group workload", 'assignment_load'),
    (r"cmdb|configuration item|ci context", 'cmdb_context'),
    (r"release notes|what changed this releas", 'release_notes'),
    (r"log analysis|stack trace|error pattern", 'log_analysis'),
    (r"doc(?:umentation)? gap|missing doc|outdated page", 'documentation_gap'),
    (r"story quality|acceptance criteria|improve this story", 'story_quality'),
    (r"login governance|persona entitlement|business owner login|lockout audit", 'login_governance'),
    # JIRA user story patterns (MUST be BEFORE generic incident pattern)
    # Use case-insensitive matching for issue keys since text is lowercased
    (r"user stor(?:y|ies)\s+[a-z]{2,10}-\d+|[a-z]{2,10}-\d+\s+(?:user )?stor(?:y|ies)", 'jira_user_story'),
    (r"(?:give me|show me|what is|summarize|summary of).*user stor(?:y|ies).*[a-z]{2,10}-\d+", 'jira_user_story'),
    (r"[a-z]{2,10}-\d+.*(?:summary|details|status|acceptance criteria)", 'jira_user_story'),
    (r"jira (?:issue|ticket|story|task|epic)|jira\s+[a-z]{2,10}-\d+", 'jira_user_story'),
    # NEW: Work notes operations
    (r"work notes|work note summary|summarize (?:the )?notes?|show (?:me )?(?:the )?notes", 'incident_work_notes'),
    (r"add (?:a )?work note|append (?:a )?note|write (?:a )?note|post (?:a )?note", 'add_work_note'),
    # NEW: Date filtering queries
    (r"incidents? (?:created|opened) today|today'?s? incidents?", 'incidents_today'),
    (r"incidents? (?:in|from|during) (?:last|past) \d+ days?", 'incidents_by_date'),
    (r"incidents? (?:open|opened|active|unresolved) (?:for )?(?:more than|longer than|over|greater than) \d+ (?:day|week|month|year)s?", 'incident_search'),
    (r"incidents? (?:created|opened|between|from).*(?:to|and|through)", 'incidents_date_range'),
    # NEW: Context-based incident identification (asks "which incident" based on criteria)
    (r"(?:which|what) incidents? (?:is|are|relates?|relate to|has|have|contains?|match(?:es)?)\s+(?:in |about |regarding |for |with |related to )?(?:NIGO|PAS|banking|beneficiary|[\w\s]+)", 'incident_search'),
    # NEW: CRUD operations
    (r"create (?:a|an|new) incident|open (?:a|an) (?:new )?ticket|new incident", 'create_incident'),
    (r"update incident|change (?:the )?(?:priority|status|field|state)|set (?:the )?(?:priority|status)", 'update_incident'),
    (r"close incident|resolve incident|mark (?:as )?(?:closed|resolved)", 'close_incident'),
    # Keep generic incident pattern LAST; we'll gate it below to avoid overshadowing ownership queries
    (r"incident|INC\d+", 'incident_triage')
]

LLM_FALLBACK_ENABLED = os.getenv('INTENT_LLM_FALLBACK', 'false').lower() in ('1','true','yes','on')

def classify_intent(text: str, metadata: Dict[str, Any] | None = None) -> Optional[str]:
    """Classify intent with optional context-awareness for entity tracking"""
    if not text:
        return None
    lt = text.lower()
    
    # EXPLICIT INTENT KEYWORDS - Check these FIRST before context boost
    # These override any context-aware shortcuts
    explicit_intent_keywords = [
        'root cause', 'rca', 'what caused', 'why did', 'why is',  # Root cause
        'workaround', 'temporary fix', 'work around', 'bypass',   # Workarounds
        'resolution steps', 'how to resolve', 'how is being resolved',  # Resolution
        'who should', 'which team', 'suggest assignment', 'recommend assignment',  # Assignment
        'assign to', 'reassign',  # Direct assignment
    ]
    
    has_explicit_intent = any(keyword in lt for keyword in explicit_intent_keywords)
    
    if has_explicit_intent:
        logger.info(f"[IntentClassifier] Explicit intent keyword detected - skipping context boost")
    
    # Context-aware boost: If metadata contains entities and question references them,
    # boost similarity intent for semantic queries - BUT ONLY IF no explicit intent
    if not has_explicit_intent and metadata and 'entities' in metadata:
        entities = metadata.get('entities', {})
        # Check if question references tracked topics/incidents
        has_entity_ref = False
        for entity_type, entity_values in entities.items():
            if isinstance(entity_values, list):
                if any(str(val).lower() in lt for val in entity_values if val):
                    has_entity_ref = True
                    break
        
        # If user asks about something mentioned before with "related"/"about"/"similar"
        if has_entity_ref and any(keyword in lt for keyword in ['related', 'about', 'similar', 'concerning', 'regarding']):
            logger.info(f"[IntentClassifier] Context boost: detected entity reference with semantic query -> similar_incidents")
            return 'similar_incidents'
    ownership_markers = ("my incidents","assigned to me","my tickets","my backlog","incidents assigned to me","show my incidents")
    for pattern, intent in KEYWORD_PATTERNS:
        if re.search(pattern, lt):
            # If this is the generic incident_triage match but we have ownership markers, skip so that
            # downstream config/classifier can map to user_incidents
            if intent == 'incident_triage' and any(m in lt for m in ownership_markers):
                continue
            logger.info(f"[IntentClassifier] Matched pattern '{pattern}' -> intent '{intent}'")
            return intent
    if LLM_FALLBACK_ENABLED:
        try:
            import openai
            system = ("You map a user request to a single intent label from this list: "
                      + ", ".join(INTENTS) + ". Respond with just the label.")
            prompt_msg = f"User request: {text}\nLabel:"
            resp = openai.chat.completions.create(
                model=os.getenv('GPT_MODEL_NAME','gpt-3.5-turbo'),
                messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt_msg}],
                max_tokens=8,
                temperature=0
            )
            cand = resp.choices[0].message.content.strip().lower()
            if cand in INTENTS:
                logger.info(f"[IntentClassifier] LLM fallback selected intent '{cand}'")
                return cand
        except Exception as e:
            logger.warning(f"[IntentClassifier] LLM fallback failed: {e}")
    return None

__all__ = ['classify_intent','INTENTS']