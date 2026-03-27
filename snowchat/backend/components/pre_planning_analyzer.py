"""Pre-Planning Analyzer with Scope Validation

This module analyzes user questions BEFORE planning to:
1. Validate the request is within system capabilities
2. Identify the true intent and operation mode (single vs bulk)
3. Extract and enrich temporal context
4. Prepare guidance for the planner

Philosophy
----------
Instead of fixing errors after execution (reflection/retry), we PREVENT errors
by understanding what the user needs and ensuring the system can provide it.

This is a general "understand and validate" layer, not situation-specific fixes.
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

# Use unified logger hierarchy to write to agentic_orchestrator_auto.log
logger = logging.getLogger("agentic_orchestrator_auto.pre_planning_analyzer")
logger.setLevel(logging.INFO)
logger.propagate = True  # Propagate to parent logger (agentic_orchestrator_auto) which writes to file

# Import system capabilities
try:
    from .system_capabilities import (  # type: ignore[assignment]
        get_system_capabilities,
        is_domain_supported,
        get_domain_operations,
        get_unsupported_reason,
        check_capability_boundaries,
        identify_domain_from_question,
        get_clarification_guidance
    )
except ImportError:
    logger.warning("[PRE_ANALYSIS] Could not import system_capabilities, using minimal fallback")
    def get_system_capabilities():  # type: ignore[misc]
        return {}
    def is_domain_supported(domain: str) -> bool:  # type: ignore[misc]
        return True
    def get_domain_operations(domain: str) -> list:  # type: ignore[misc]
        return []
    def get_unsupported_reason(domain: str) -> str:  # type: ignore[misc]
        return "Domain not supported"
    def check_capability_boundaries(operation_type: str, requested_value: int) -> dict:  # type: ignore[misc]
        return {"within_bounds": True}
    def identify_domain_from_question(question: str) -> list:  # type: ignore[misc]
        return []
    def get_clarification_guidance(question: str) -> dict:  # type: ignore[misc]
        return {"needs_clarification": False}

# Import OpenAI helper
try:
    from .langgraph_flow import get_openai_chat_completion
except ImportError:
    logger.warning("[PRE_ANALYSIS] Could not import get_openai_chat_completion")
    get_openai_chat_completion = None  # type: ignore[assignment]


# ============================================================================
# PRE-PLANNING ANALYZER (Main Entry Point)
# ============================================================================

def pre_planning_analyzer(
    question: str,
    metadata: Dict[str, Any],
    conversation_history: Optional[List[Dict]] = None,
    enable_scope_validation: bool = True
) -> Dict[str, Any]:
    """
    Analyze user question before planning to enrich context and validate feasibility.
    
    This is the main entry point that:
    1. Validates question is within system capabilities
    2. Enriches context (dates, bulk vs single, format requirements)
    3. Generates planning guidance
    
    Args:
        question: User's question text
        metadata: Current metadata dict (includes short_term_memory, etc.)
        conversation_history: Recent conversation turns
        enable_scope_validation: If True, checks against system capabilities
    
    Returns:
        Dict with:
        - feasibility: "supported" | "needs_clarification" | "rejected"
        - action: "proceed" | "clarify" | "reject"
        - user_message: Message to return to user (if clarify/reject)
        - enriched context fields (if proceed):
          - intent, operation_mode, temporal_context, incident_scope,
            format_requirements, planner_hints
    """
    
    logger.info("="*80)
    logger.info(f"[PRE_ANALYSIS] STARTING PRE-PLANNING ANALYSIS")
    logger.info("="*80)
    logger.info(f"[PRE_ANALYSIS] User Question: {question}")
    
    # ═══════════════════════════════════════════════════════════════════════
    # CRITICAL ANNOTATION BYPASS: @wiki and @code queries ALWAYS proceed
    # These annotations explicitly request specific data sources (Confluence/GitHub)
    # DO NOT let LLM reject based on content assumptions  
    # ═══════════════════════════════════════════════════════════════════════
    annotation = metadata.get('annotation', '')
    if annotation in ('@wiki', '@code'):
        logger.info(f"[PRE_ANALYSIS] ⚡ ANNOTATION BYPASS: {annotation} detected - Auto-approving without LLM validation")
        logger.info(f"[PRE_ANALYSIS] Reason: {annotation} queries explicitly target configured data sources")
        
        bypass_result = {
            "feasibility": "supported",
            "confidence": 1.0,
            "action": "proceed",
            "intent": "wiki_search" if annotation == '@wiki' else "code_search",
            "operation_mode": "single",
            "temporal_context": {
                "current_date": datetime.now().strftime("%Y-%m-%d"),
                "current_datetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "requires_time_component": False
            },
            "incident_scope": {
                "source": "na",
                "count": 0,
                "canonical_incident": None
            },
            "format_requirements": {},
            "planner_hints": [
                f"Use {annotation} annotation routing - proceed directly to tool execution",
                "No incident context or temporal filtering needed",
                "Query is self-contained with explicit data source target"
            ],
            "capability_match": {
                "primary_domain": "knowledge_retrieval" if annotation == '@wiki' else "code_search",
                "domain_supported": True,
                "required_operations": ["wiki_rag_tool"] if annotation == '@wiki' else ["code_search"],
                "operations_available": True,
                "data_source": "Confluence" if annotation == '@wiki' else "GitHub",
                "data_available": True,
                "capability_boundaries_met": True,
                "boundary_violations": []
            },
            "annotation_bypass": True
        }
        
        logger.info("="*80)
        logger.info(f"[PRE_ANALYSIS] ✓ {annotation.upper()} AUTO-APPROVAL COMPLETE")
        logger.info("="*80)
        return bypass_result
    
    # Log conversation context
    stm = metadata.get('short_term_memory', {})
    if stm:
        logger.info(f"[PRE_ANALYSIS] Short-term Memory Context: tool={stm.get('referenced_tool')} incidents={stm.get('incident_count', 0)} type={stm.get('query_type')}")
    if conversation_history:
        logger.info(f"[PRE_ANALYSIS] Conversation History: {len(conversation_history)} previous turns available")
    
    # Get system capabilities
    logger.info("[PRE_ANALYSIS] Step 1: Loading system capabilities...")
    system_capabilities = get_system_capabilities()
    logger.info(f"[PRE_ANALYSIS] Loaded {len(system_capabilities.get('supported_domains', {}))} supported domains")
    
    # Quick pattern-based clarification check
    logger.info("[PRE_ANALYSIS] Step 2: Pattern-based clarification check...")
    clarification = get_clarification_guidance(question)
    
    if clarification.get("bypass_reason"):
        logger.info(f"[PRE_ANALYSIS] ✓ Pattern bypass triggered: {clarification.get('bypass_reason')} - Query is complete, skipping clarification")
    
    if clarification.get("needs_clarification"):
        patterns = clarification.get("patterns_matched", [])
        
        # CONTEXT-AWARE OVERRIDE: Check if we have enough context to proceed despite pattern match
        context_available = False
        context_reasons = []
        
        # Check 1: Short-term memory has incident data?
        if stm and stm.get('incident_count', 0) > 0:
            context_available = True
            context_reasons.append(f"STM has {stm.get('incident_count')} incidents from {stm.get('referenced_tool')}")
        
        # Check 2: Conversation history mentions incidents/analysis?
        if conversation_history and len(conversation_history) > 0:
            recent_text = str(conversation_history[-5:]).lower()  # Last 5 turns
            if any(kw in recent_text for kw in ['pattern', 'analysis', 'bulk_work_notes', 'documentation gap', 'sample_incidents']):
                context_available = True
                context_reasons.append("Recent conversation discusses pattern analysis or bulk results")
            
            # Also check for incident numbers in recent conversation
            import re
            inc_pattern = r'\binc\d{7}\b'
            inc_matches = re.findall(inc_pattern, recent_text, re.IGNORECASE)
            if len(inc_matches) > 0:
                context_available = True
                context_reasons.append(f"Recent conversation lists {len(inc_matches)} incidents")
        
        # Check 3: Question is a filtering/detail request on previous results?
        q_lower = question.lower()
        is_follow_up_filter = any(phrase in q_lower for phrase in [
            'which incidents', 'what incidents', 'show me the incidents', 
            'list the incidents', 'tell me which', 'can you tell me',
            'suffering with', 'having', 'that have'
        ])
        
        # Check 3b: Pattern analysis question referencing previous results?
        is_pattern_question = any(phrase in q_lower for phrase in [
            'pattern', 'common', 'similarity', 'similarities', 'trend', 'trends',
            'see any', 'notice any', 'find any', 'recurring'
        ]) and any(ref in q_lower for ref in [
            'these incidents', 'those incidents', 'these', 'those', 'them',
            'above', 'listed'
        ])
        
        # Check 4: JIRA story ID mentioned in question or recent context?
        import re
        jira_story_pattern = r'\b[A-Z]{2,10}-\d+\b'
        has_jira_id_in_question = bool(re.search(jira_story_pattern, question))
        has_jira_id_in_recent_context = False
        
        if conversation_history and len(conversation_history) > 0:
            # Check last 3 turns for JIRA story IDs
            recent_turns = conversation_history[-3:]
            recent_text = ' '.join([str(turn) for turn in recent_turns])
            if re.search(jira_story_pattern, recent_text):
                has_jira_id_in_recent_context = True
                context_available = True
                # Extract the story ID from context
                match = re.search(jira_story_pattern, recent_text)
                if match:
                    context_reasons.append(f"JIRA story {match.group()} discussed in recent context")
        
        if has_jira_id_in_question:
            context_available = True
            match = re.search(jira_story_pattern, question)
            if match:
                context_reasons.append(f"JIRA story ID {match.group()} provided in question")
        
        # For JIRA queries, "this" or "it" is clear if story was just discussed
        is_jira_follow_up = any(phrase in q_lower for phrase in [
            'user story', 'story', 'acceptance criteria', 'test script', 
            'test case', 'jira', 'backlog'
        ])
        
        if has_jira_id_in_recent_context and is_jira_follow_up:
            context_available = True
            context_reasons.append("Follow-up question about JIRA story from previous turn")
        
        if context_available and is_follow_up_filter:
            logger.info(f"[PRE_ANALYSIS] ✓ CONTEXT OVERRIDE: Pattern suggested clarification but sufficient context available")
            for reason in context_reasons:
                logger.info(f"[PRE_ANALYSIS]   - Context: {reason}")
            logger.info(f"[PRE_ANALYSIS]   - Question type: Follow-up filter/detail request")
            logger.info("[PRE_ANALYSIS] ✓ Proceeding with context-based analysis instead of clarification")
            # Don't return clarification - continue to LLM analysis
        elif context_available and is_pattern_question:
            logger.info(f"[PRE_ANALYSIS] ✓ CONTEXT OVERRIDE: Pattern suggested clarification but asking about patterns in previous results")
            for reason in context_reasons:
                logger.info(f"[PRE_ANALYSIS]   - Context: {reason}")
            logger.info(f"[PRE_ANALYSIS]   - Question type: Pattern analysis on recent incidents")
            logger.info("[PRE_ANALYSIS] ✓ Proceeding with context-based analysis instead of clarification")
            # Don't return clarification - continue to LLM analysis
        elif context_available and is_jira_follow_up:
            logger.info(f"[PRE_ANALYSIS] ✓ CONTEXT OVERRIDE: Pattern suggested clarification but JIRA story context available")
            for reason in context_reasons:
                logger.info(f"[PRE_ANALYSIS]   - Context: {reason}")
            logger.info(f"[PRE_ANALYSIS]   - Question type: JIRA story follow-up or query with story ID")
            logger.info("[PRE_ANALYSIS] ✓ Proceeding to LLM analysis - will fetch story details")
            # Don't return clarification - continue to LLM analysis
        else:
            # No context override - proceed with clarification
            logger.warning(f"[PRE_ANALYSIS] ✗ CLARIFICATION NEEDED (Pattern-based): {len(patterns)} patterns matched")
            for p in patterns:
                logger.warning(f"[PRE_ANALYSIS]   - Pattern: {p.get('type')} | Ask for: {p.get('ask_for')}")
            logger.info(f"[PRE_ANALYSIS] User message: {clarification.get('suggested_response')}")
            logger.info("="*80)
            return {
                "feasibility": "needs_clarification",
            "confidence": 0.6,
            "action": "clarify",
            "user_message": clarification.get("suggested_response"),
            "patterns_matched": clarification.get("patterns_matched")
        }
    else:
        logger.info("[PRE_ANALYSIS] ✓ Pattern check passed - No clarification patterns matched")
    
    # Build LLM analysis prompt
    logger.info("[PRE_ANALYSIS] Step 3: Building LLM analysis prompt...")
    analysis_prompt = build_pre_analysis_prompt(
        question=question,
        metadata=metadata,
        system_capabilities=system_capabilities,
        conversation_history=conversation_history or [],
        enable_scope_validation=enable_scope_validation
    )
    logger.info(f"[PRE_ANALYSIS] Prompt built: {len(analysis_prompt)} characters")
    
    # Call LLM for analysis
    logger.info("[PRE_ANALYSIS] Step 4: Calling LLM for feasibility analysis...")
    try:
        if get_openai_chat_completion is None:
            raise Exception("OpenAI chat completion not available")
        
        model_name = os.getenv("GPT_MODEL_NAME", "gpt-4")
        logger.info(f"[PRE_ANALYSIS] Using model: {model_name} (temperature=0.2 for analytical consistency)")
        
        response = get_openai_chat_completion(
            model=model_name,
            messages=[
                {"role": "system", "content": "You are a capability-aware pre-planning analyzer for an agentic AI system."},
                {"role": "user", "content": analysis_prompt}
            ],
            max_tokens=1500,
            temperature=0.2  # Low temperature for analytical tasks
        )
        
        logger.info("[PRE_ANALYSIS] ✓ LLM response received, parsing...")
        
        # Parse response
        try:
            raw_content = response.choices[0].message.content
        except:
            raw_content = str(response)
        
        logger.info(f"[PRE_ANALYSIS] Raw response length: {len(raw_content)} characters")
        result = json.loads(raw_content)
        logger.info("[PRE_ANALYSIS] ✓ JSON parsing successful")
        
        # Log detailed analysis results
        logger.info("-"*80)
        logger.info("[PRE_ANALYSIS] Step 5: DECISION ANALYSIS")
        logger.info("-"*80)
        
        feasibility = result.get('feasibility')
        action = result.get('action')
        confidence = result.get('confidence', 0)
        
        # Main decision
        if feasibility == 'supported':
            logger.info(f"[PRE_ANALYSIS] ✓ FEASIBILITY: SUPPORTED (confidence={confidence:.2f})")
        elif feasibility == 'needs_clarification':
            logger.warning(f"[PRE_ANALYSIS] ⚠ FEASIBILITY: NEEDS_CLARIFICATION (confidence={confidence:.2f})")
        else:
            logger.error(f"[PRE_ANALYSIS] ✗ FEASIBILITY: REJECTED (confidence={confidence:.2f})")
        
        logger.info(f"[PRE_ANALYSIS] Action: {action.upper()}")
        
        # Capability match details
        if result.get('capability_match'):
            cap = result['capability_match']
            logger.info("[PRE_ANALYSIS] Capability Assessment:")
            logger.info(f"[PRE_ANALYSIS]   - Primary domain: {cap.get('primary_domain')}")
            logger.info(f"[PRE_ANALYSIS]   - Domain supported: {cap.get('domain_supported')}")
            logger.info(f"[PRE_ANALYSIS]   - Operations available: {cap.get('operations_available')}")
            logger.info(f"[PRE_ANALYSIS]   - Data source: {cap.get('data_source')}")
            logger.info(f"[PRE_ANALYSIS]   - Data available: {cap.get('data_available')}")
            if cap.get('required_operations'):
                logger.info(f"[PRE_ANALYSIS]   - Required operations: {', '.join(cap.get('required_operations', [])[:3])}")
        
        # Action-specific logging
        if action == 'clarify':
            logger.warning("[PRE_ANALYSIS] Clarification Required:")
            logger.warning(f"[PRE_ANALYSIS]   Reason: {result.get('user_message', '')[:300]}")
            
        elif action == 'reject':
            logger.error("[PRE_ANALYSIS] Request Rejected:")
            logger.error(f"[PRE_ANALYSIS]   Reason: {result.get('user_message', '')[:300]}")
            
        elif action == 'proceed':
            logger.info("[PRE_ANALYSIS] ✓ Proceeding to Planning Phase:")
            logger.info(f"[PRE_ANALYSIS]   - Intent: {result.get('intent')}")
            logger.info(f"[PRE_ANALYSIS]   - Operation mode: {result.get('operation_mode')}")
            
            # Temporal context
            if result.get('temporal_context'):
                tc = result['temporal_context']
                if tc.get('calculated_range'):
                    logger.info(f"[PRE_ANALYSIS]   - Time range: {tc['calculated_range'].get('start')} to {tc['calculated_range'].get('end')}")
            
            # Incident scope
            if result.get('incident_scope'):
                isc = result['incident_scope']
                logger.info(f"[PRE_ANALYSIS]   - Incident scope: {isc.get('source')} (count={isc.get('count', 0)})")
                if isc.get('canonical_incident'):
                    logger.info(f"[PRE_ANALYSIS]   - Canonical incident: {isc.get('canonical_incident')}")
            
            # Planning hints
            hints = result.get('planner_hints', [])
            if hints:
                logger.info(f"[PRE_ANALYSIS]   - Planning hints: {len(hints)} guidance items")
                for i, hint in enumerate(hints[:3], 1):
                    logger.info(f"[PRE_ANALYSIS]       {i}. {hint[:100]}")
                if len(hints) > 3:
                    logger.info(f"[PRE_ANALYSIS]       ... and {len(hints)-3} more")
        
        logger.info("="*80)
        logger.info("[PRE_ANALYSIS] PRE-PLANNING ANALYSIS COMPLETE")
        logger.info("="*80)
        
        return result
        
    except Exception as e:
        logger.error("="*80)
        logger.error(f"[PRE_ANALYSIS] ✗ ANALYSIS FAILED: {e}")
        logger.error(f"[PRE_ANALYSIS] Error type: {type(e).__name__}")
        logger.error("[PRE_ANALYSIS] Stack trace:", exc_info=True)
        logger.error("="*80)
        logger.warning("[PRE_ANALYSIS] Falling back to minimal confidence mode...")
        
        # Fallback: proceed with minimal confidence
        fallback_result = {
            "feasibility": "supported",
            "confidence": 0.3,
            "action": "proceed",
            "intent": "unknown",
            "operation_mode": "single",
            "planner_hints": [],
            "error": str(e),
            "fallback": True
        }
        
        logger.warning(f"[PRE_ANALYSIS] Fallback mode: Proceeding with confidence=0.3")
        logger.info("="*80)
        
        return fallback_result


# ============================================================================
# PROMPT BUILDER
# ============================================================================

def build_pre_analysis_prompt(
    question: str,
    metadata: Dict[str, Any],
    system_capabilities: Dict[str, Any],
    conversation_history: List[Dict],
    enable_scope_validation: bool
) -> str:
    """
    Build the LLM prompt for pre-planning analysis.
    
    Returns:
        Formatted prompt string
    """
    
    # Get current date for temporal context
    current_date = datetime.now().strftime("%Y-%m-%d")
    current_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Format conversation history (last 3 turns)
    history_text = format_conversation_history(conversation_history[-3:] if conversation_history else [])
    
    # Format short-term memory
    stm = metadata.get('short_term_memory', {})
    stm_text = json.dumps(stm, indent=2) if stm else "No short-term memory"
    
    # Format entities (CRITICAL: Include entities from metadata)
    entities = metadata.get('entities', {})
    entities_text = json.dumps(entities, indent=2) if entities else "No entities tracked"
    
    # Format canonical incident (CRITICAL: Include canonical incident)
    canonical = metadata.get('canonical_incident', {})
    canonical_text = json.dumps(canonical, indent=2) if canonical else "No canonical incident"
    
    # Build prompt
    prompt = f"""You are a pre-planning analyzer for an agentic AI system supporting developers.

Your CRITICAL responsibility: Determine if you CAN answer the user's question 
before attempting to plan. This prevents errors instead of fixing them after execution.

⚠️ CONTEXT-AWARE ANALYSIS PRINCIPLE:
ALWAYS check conversation_history, short_term_memory, entities, and canonical_incident BEFORE deciding a question needs clarification.
Most "ambiguous" questions are actually CLEAR follow-ups with existing context!

Examples of VALID follow-ups (DO NOT ask for clarification):
- "what workarounds for these issues?" → Previous turn discussed issue categories (CLEAR!)
- "classify these incidents" → short_term_memory shows incident_count=50 (CLEAR!)  
- "what's the pattern?" → Previous query returned data (CLEAR - analyze that data!)
- "summarize all of them" → "them" refers to results in short_term_memory (CLEAR!)
- "What is the Bank related Incident here?" → entities shows canonical_incident=INC0010062 + conversation mentions "PAS and NIGO" (CLEAR - use keyword search for "bank" + "NIGO")
- "this was not the bank NIGO incident" → canonical_incident shows INC0010062 + user says "not this one" (CLEAR - search for "bank NIGO" excluding INC0010062)

═══════════════════════════════════════════════════════════════════════
CURRENT CONTEXT:
Date: {current_date}
DateTime: {current_datetime}

USER QUESTION:
{question}

CONVERSATION HISTORY (last 3 turns):
{history_text}

SHORT-TERM MEMORY:
{stm_text}

TRACKED ENTITIES (from conversation):
{entities_text}

CANONICAL INCIDENT (most recent incident discussed):
{canonical_text}

⚠️ CRITICAL: If canonical_incident or entities show incident numbers, DO NOT ask for clarification!
The user is referring to incidents already discussed. Use keyword search or fetch those incidents.

YOUR SYSTEM CAPABILITIES:
{json.dumps(system_capabilities.get('supported_domains', {}), indent=2)}

WHAT YOU DO NOT SUPPORT:
{json.dumps(system_capabilities.get('unsupported_domains', {}), indent=2)}

CAPABILITY BOUNDARIES:
{json.dumps(system_capabilities.get('capability_boundaries', {}), indent=2)}

COMMON PITFALLS TO AVOID:
{json.dumps(system_capabilities.get('common_pitfalls', {}), indent=2)}
═══════════════════════════════════════════════════════════════════════

ANALYSIS PROCESS:

STEP 1: IDENTIFY PRIMARY DOMAIN
What is the user asking about?
- Incident management? (ServiceNow)
- Documentation? (Confluence)  
- Logs/traces? (DataDog)
- Code search? (GitHub)
- Backlog? (JIRA)
- Insurance quote? (Insurance Policy System - keywords: insurance, premium, quote, zip code, moving, vehicle)
- Something else?

⚠️ IMPORTANT: Check for SPECIFIC domain keywords FIRST before defaulting to generic categories:
- If question mentions "insurance", "premium", "quote", "policy", "zip code + moving" → insurance_quote domain
- If question mentions "incident", "INC", "ServiceNow" → incident_management domain  
- If question has "@wiki" or "documentation" → knowledge_retrieval domain

STEP 2: CAPABILITY MATCH
Check if primary domain is in "supported_domains":
- YES → Continue to Step 3
- NO → Check "unsupported_domains" for alternative
- CRITICAL: Match domain by KEYWORDS in the question, not just topic similarity
  * Example: "insurance premium" matches insurance_quote domain (NOT billing_finance)
  * Example: "deployment cost" matches billing_finance unsupported (deployment is separate)

STEP 3: OPERATION VALIDATION
What specific operation do they want?
- Is it in the supported operations list?
- Is it within capability boundaries?
- Do we have the required data to proceed?

**DATA AVAILABILITY RULES:**
  * **Wiki/Documentation queries with @wiki annotation:** data_available = TRUE
    - data_source = "Confluence" (NOT ServiceNow)
    - System has Confluence/wiki integration configured
    - Can search wiki by keywords directly
    - NO conversation context needed - proceed with wiki_rag_tool immediately
  * **JIRA/Backlog queries with user story ID (e.g., IN-4, PROJ-123):** data_available = TRUE
    - data_source = "JIRA" (NOT ServiceNow/Internal)
    - System has JIRA integration configured (jira_fetch_user_story, jira_summarize_user_story)
    - Can fetch user stories by ID directly from JIRA API
    - Pattern: [A-Z]{2,10}-\\d+ (e.g., IN-4, SCRUM-123, TEAM-456)
    - NO conversation context needed - the ID IS sufficient
    - **CRITICAL: NEVER ask "do you want me to fetch?" - Just set data_available=TRUE and feasibility="supported"!**
    - The story ID is a direct data pointer - treat like an INC number or URL
    - Examples that should NEVER trigger clarification:
      * "Provide acceptance criteria for User Story IN-4" → data_available=TRUE, proceed
      * "Can you provide test scripts for this?" (after discussing IN-4) → data_available=TRUE, proceed
      * "Summarize IN-4" → data_available=TRUE, proceed
  * **ServiceNow queries with INC number (e.g., INC0010062):** data_available = TRUE  
    - data_source = "ServiceNow" (NOT JIRA)
    - System has ServiceNow integration
    - Can fetch incidents by number directly
    - NO conversation context needed - the INC number IS sufficient
  * **Insurance quote queries with ZIP codes:** data_available = TRUE
    - data_source = "Insurance Policy System" (NOT billing/finance)
    - System has insurance quote calculation tools
    - Requires: old ZIP, new ZIP (can extract from question)
    - Workflow: List policies → User selects → Calculate premium
    - Keywords: "insurance", "premium", "quote", "moving", "zip code", "auto insurance"
    - Examples that should PROCEED (NOT reject):
      * "Moving from 60100 to 60501, what's my insurance quote?" → data_available=TRUE, feasibility="supported"
      * "Premium impact if I move to zip 60614?" → data_available=TRUE, feasibility="supported"
      * "Calculate insurance quote for relocation" → data_available=TRUE, feasibility="supported"
    - **CRITICAL: Insurance quotes are SUPPORTED - do NOT route to billing_finance domain!**
  * **Bulk/filter queries without specific IDs:** data_available = TRUE if query is complete
    - Examples: "incidents from last week", "all high priority tickets"
    - These queries are self-contained and can be executed
  * **Only return data_available = FALSE when:**
    - Query references something undefined ("that issue", "those items") AND no context exists
    - Query requires external data not in any integrated system

STEP 4: CONTEXT ANALYSIS (if supported)
Extract key context:
- **CONVERSATION CONTEXT (CHECK FIRST!):**
  * Review conversation_history for references to entities, issues, categories
  * If user says "these", "those", "them", "from before" → LOOK BACK at previous turns
  * Short_term_memory contains referenced data (incident_count, referenced_incidents, query_type)
  * **Example:** "workarounds for these issues" after discussing Top 5 categories → Issues are the 5 categories (CLEAR!)
  * **Example:** "these incidents" when short_term_memory shows incident_count=50 → 50 incidents from memory (CLEAR!)
  * **Example:** "classify all of them" after incident query → "them" = incidents from query (CLEAR!)
- Temporal references: "yesterday", "last 3 days", etc.
  * Calculate actual dates from current_date: {current_date}
  * NEVER use training data dates (June 2024 or earlier)
  * ServiceNow fields need full timestamp YYYY-MM-DD HH:MM:SS
- Operation mode:
  * SINGLE: user asks about specific INC number, or "the incident"
  * BULK: user says "all", "these", "overall", "not just one", or short_term_memory has incident_count > 1
- Data references:
  * Does user refer to previous conversation? ("these", "from before")
  * Check short_term_memory for incident_count, canonical_incident
  * Any category/filter mentioned?
- **Follow-up question detection:**
  * If question builds on previous answer → It's a FOLLOW-UP (mark as supported)
  * Examples: "what about workarounds?", "can you classify?", "what's the summary?"
  * These are NOT ambiguous if context exists - they're clarifying/expanding previous data

STEP 5: FEASIBILITY DECISION

Option A: SUPPORTED
- Have the tools and data to answer this
- Action: Proceed to planning with enriched context

Option B: NEEDS_CLARIFICATION ⚠️ USE SPARINGLY - Check context first!
- Question is too vague or ambiguous AND no context available
- Missing critical information (which incident? which service?) AND not in conversation history
- **IMPORTANT: Check conversation history, short_term_memory, entities, AND canonical_incident BEFORE flagging as unclear**
- **Common false positives to AVOID:**
  * "these incidents" → Check short_term_memory.incident_count (if > 0, it's clear!)
  * "the bank NIGO incident" → Check entities.canonical_incident or conversation_history for NIGO incidents (if found, it's CLEAR!)
  * "this was not..." → Check canonical_incident to see what "this" refers to (if present, it's CLEAR!)
  * "workarounds for these issues" → Previous conversation shows issue categories? (CLEAR - proceed!)
  * "what about X" → If X mentioned in last 3 turns OR in entities? (CLEAR - it's a follow-up)
  * "for all of them" → Check if "them" refers to data in short_term_memory OR entities.incidents (CLEAR if yes)
  * References like "the pattern", "those problems", "from before", "here" → Context exists in entities or history? (CLEAR!)
  * **"Acceptance criteria for User Story IN-4" → Story ID provided = data pointer (CLEAR - fetch it!)** 
  * **"Test scripts for this" after JIRA story discussion → Story in context (CLEAR - proceed!)**
  * **ANY query with JIRA story ID format ([A-Z]{2,10}-\\d+) → NEVER ask permission to fetch (CLEAR!)**
- **Only ask for clarification when:**
  * Question genuinely lacks specificity (e.g., "show me it")
  * No conversation context exists to resolve ambiguity (checked ALL: history, stm, entities, canonical_incident)
  * Multiple conflicting interpretations with no context to disambiguate
- Action: Ask user specific follow-up question (ONLY if truly needed)

Option C: REJECTED
- Request is outside capabilities
- No relevant integration or tool available
- Exceeds capability boundaries
- Action: Explain what you don't support + suggest alternative

═══════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON):

{{
  "feasibility": "supported" | "needs_clarification" | "rejected",
  "confidence": 0.0-1.0,
  
  "capability_match": {{
    "primary_domain": "incident_management|knowledge_retrieval|log_analysis|backlog_management|...",
    "domain_supported": true/false,
    "required_operations": ["list", "of", "operations"],
    "operations_available": true/false,
    "data_source": "ServiceNow|Confluence|DataDog|JIRA|GitHub|...",
    "data_available": true/false,
    "capability_boundaries_met": true/false,
    "boundary_violations": []
  }},
  
  "action": "proceed" | "clarify" | "reject",
  
  "user_message": "Message to show user if clarify/reject",
  
  // If feasibility = "supported", include enriched context:
  "intent": "query_incidents|summarize_work_notes|wiki_search|...",
  "operation_mode": "single" | "bulk",
  
  "temporal_context": {{
    "current_date": "{current_date}",
    "current_datetime": "{current_datetime}",
    "user_reference": "what user said about time",
    "calculated_range": {{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}},
    "requires_time_component": true/false
  }},
  
  "incident_scope": {{
    "source": "explicit" | "short_term_memory" | "query_needed",
    "count": number,
    "filter": "optional category/type filter",
    "canonical_incident": "INC... if referenced"
  }},
  
  "format_requirements": {{
    "datetime_format": "YYYY-MM-DD HH:MM:SS" | null,
    "batch_size_limit": number | null,
    "aggregation_needed": true/false
  }},
  
  "planner_hints": [
    "Specific guidance for planner",
    "Tool recommendations",
    "Parameter requirements",
    "Pitfall warnings"
  ]
}}

═══════════════════════════════════════════════════════════════════════
CRITICAL REMINDERS:

1. DATE CALCULATIONS: 
   - Today is {current_date}
   - "yesterday" = {(datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')}
   - "last 3 days" = {(datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')} to {current_date}
   - NEVER use June 2024 or training data dates

2. BULK VS SINGLE:
   - incident_count > 1 in memory → BULK
   - User says "all", "these", "overall", "not just one" → BULK
   - Specific INC number or "the incident" → SINGLE

3. SERVICENOW DATETIME:
   - Must include time component: "2026-02-25 00:00:00" 
   - Date-only will fail: "2026-02-25" ✗

4. BE HONEST:
   - Better to reject than hallucinate capabilities
   - Better to ask than guess
   - Suggest alternatives when rejecting

Now analyze the user's question:
"""
    
    return prompt


def format_conversation_history(history: List[Dict]) -> str:
    """Format conversation history for LLM context."""
    if not history:
        return "No recent conversation"
    
    formatted = []
    for turn in history:
        role = turn.get('role', 'user')
        content = turn.get('content', '')
        
        # Smart truncation: preserve incident numbers and structured data
        if len(content) > 1500:
            # For very long messages, keep more context if they contain incident/entity data
            if 'INC' in content.upper() or any(marker in content for marker in ['1.', '2.', '3.', 'pattern', 'NIGO', 'PAS']):
                # Preserve up to 1500 chars for messages with incident data
                content = content[:1500] + "... [truncated for brevity]"
            else:
                # Regular truncation for other long messages
                content = content[:500] + "... [truncated]"
        
        formatted.append(f"{role.upper()}: {content}")
    
    return "\n".join(formatted)


# ============================================================================
# HELPER FUNCTIONS FOR POST-PROCESSING
# ============================================================================

def validate_pre_analysis_result(result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate and sanitize pre-analysis result.
    
    Ensures all required fields are present and consistent.
    """
    
    # Required fields
    if 'feasibility' not in result:
        result['feasibility'] = 'supported'
    
    if 'action' not in result:
        result['action'] = 'proceed' if result['feasibility'] == 'supported' else 'reject'
    
    if 'confidence' not in result:
        result['confidence'] = 0.5
    
    # Ensure action matches feasibility
    if result['feasibility'] == 'rejected' and result['action'] != 'reject':
        result['action'] = 'reject'
    elif result['feasibility'] == 'needs_clarification' and result['action'] != 'clarify':
        result['action'] = 'clarify'
    
    # Ensure user_message exists for non-proceed actions
    if result['action'] in ['reject', 'clarify'] and not result.get('user_message'):
        if result['action'] == 'reject':
            result['user_message'] = "I'm unable to help with that request. It's outside my current capabilities."
        else:
            result['user_message'] = "I need more information to help you. Can you provide more details?"
    
    return result


def extract_temporal_context_from_analysis(result: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """
    Extract temporal context from pre-analysis result.
    
    Returns:
        Dict with start_date and end_date if temporal analysis was performed
    """
    temporal = result.get('temporal_context', {})
    if temporal and temporal.get('calculated_range'):
        range_data = temporal['calculated_range']
        return {
            'start_date': range_data.get('start'),
            'end_date': range_data.get('end'),
            'requires_time_component': temporal.get('requires_time_component', False)
        }
    return None


def should_use_batch_processing(result: Dict[str, Any]) -> bool:
    """
    Determine if batch processing should be used based on pre-analysis.
    
    Returns:
        True if operation_mode is 'bulk' or incident count > 1
    """
    if result.get('operation_mode') == 'bulk':
        return True
    
    incident_scope = result.get('incident_scope', {})
    count = incident_scope.get('count', 1)
    
    return count > 1


# ============================================================================
# MODULE TEST
# ============================================================================

if __name__ == "__main__":
    # Test pre-analysis with sample questions
    test_questions = [
        "Show me incidents created yesterday",
        "Deploy the auth service to production",
        "What happened with that incident?",
        "For these incidents, give me overall summary ..not just one"
    ]
    
    for q in test_questions:
        print(f"\n{'=' * 60}")
        print(f"Question: {q}")
        print('=' * 60)
        
        result = pre_planning_analyzer(
            question=q,
            metadata={'short_term_memory': {'incident_count': 100}},
            conversation_history=[],
            enable_scope_validation=True
        )
        
        print(json.dumps(result, indent=2))
