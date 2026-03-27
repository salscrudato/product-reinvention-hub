"""
Life & Annuity Domain Knowledge Tools

Simple, focused tools that provide L&A-specific knowledge to the orchestrator.
These tools DO NOT duplicate planning logic - they feed domain knowledge
into the existing LangGraph orchestrator which does the planning.

Purpose:
- Query Wiki with L&A product context
- Classify incidents by L&A domain concepts
- Retrieve L&A-specific business rules
- Return domain knowledge for orchestrator to use

Pattern for other products (P&C, Group Benefits, Voluntary):
- Create similar minimal knowledge retrieval tools
- Use product-specific Wiki queries
- Return structured knowledge, not plans
"""

import logging
from typing import Dict, List, Optional, Any
from ..servicenowgenaitool import (
    fetch_servicenow_incident_core,
    get_similar_incidents_simple
)
from ..CustomWikiRAG import perform_wiki_rag
from ..shared_registry import FUNCTION_REGISTRY

# The decorator is defined in snowaaonetool.py
def register_tool_function(name):
    """Decorator to register a function in the registry."""
    def decorator(func):
        FUNCTION_REGISTRY[name] = func
        return func
    return decorator

logger = logging.getLogger("agentic_orchestrator_auto")


# ============================================================================
# Domain Knowledge Helpers (not exposed as tools, just internal helpers)
# ============================================================================

LA_DOMAIN_CONCEPTS = [
    "NIGO", "Not In Good Order", "policy status",
    "underwriting", "application processing", "new business",
    "APS", "Attending Physician Statement", "medical underwriting",
    "successor owner", "beneficiary", "policy admin"
]

LA_CONCEPT_PATTERNS = {
    "nigo": ["nigo", "not in good order", "policy status", "validation failure"],
    "aps": ["aps", "attending physician", "medical records", "medical underwriting"],
    "underwriting": ["underwriting", "underwrite", "risk assessment", "approval"],
    "beneficiary": ["beneficiary", "successor", "owner change", "death claim"],
    "policy_admin": ["policy admin", "pas", "policy system", "servicing"]
}
        
LA_CONCEPT_PATTERNS = {
    "nigo": ["nigo", "not in good order", "policy status", "validation failure"],
    "aps": ["aps", "attending physician", "medical records", "medical underwriting"],
    "underwriting": ["underwriting", "underwrite", "risk assessment", "approval"],
    "beneficiary": ["beneficiary", "successor", "owner change", "death claim"],
    "policy_admin": ["policy admin", "pas", "policy system", "servicing"]
}


# ============================================================================
# CORE TOOL: L&A Domain Knowledge Retrieval
# ============================================================================

@register_tool_function("get_la_domain_knowledge")
def get_la_domain_knowledge_tool(incident_number: str) -> Dict[str, Any]:
    """
    Retrieve Life & Annuity domain-specific knowledge for an incident.
    
    This tool queries Wiki with L&A product context and returns domain knowledge
    for the orchestrator to use in planning. Does NOT create plans itself.
    
    Args:
        incident_number: ServiceNow incident number (e.g., INC0010001)
    
    Returns:
        {
            "incident": {basic incident info},
            "la_concept": str (detected L&A concept like "nigo", "aps", etc.),
            "wiki_knowledge": str (relevant L&A procedures/rules from Wiki),
            "wiki_sources": [...],
            "similar_la_incidents": [...] (similar L&A incidents)
        }
    
    Example:
        knowledge = get_la_domain_knowledge_tool("INC0010001")
        # Orchestrator uses knowledge['wiki_knowledge'] in its planning
    """
    logger.info(f"[L&A Knowledge] Retrieving domain knowledge for {incident_number}")
    
    try:
        # Fetch incident
        incident = fetch_servicenow_incident_core(incident_number)
        if not incident or "error" in incident:
            return {"error": f"Could not fetch incident {incident_number}"}
        
        description = f"{incident.get('short_description', '')} {incident.get('description', '')}"
        
        # Detect L&A concept
        detected_concept = _detect_la_concept(description)
        logger.info(f"[L&A Knowledge] Detected concept: {detected_concept}")
        
        # Query Wiki with L&A context
        wiki_query = f"Life and Annuity {detected_concept} procedures and requirements: {description}"
        wiki_result = perform_wiki_rag(wiki_query)
        
        # Find similar L&A incidents
        similar_query = f"Life Annuity {detected_concept} {description}"
        similar_incidents = get_similar_incidents_simple(similar_query)
        
        if isinstance(similar_incidents, dict) and "error" in similar_incidents:
            similar_incidents = []
        
        return {
            "incident": {
                "number": incident_number,
                "short_description": incident.get('short_description', ''),
                "description": incident.get('description', ''),
                "status": incident.get('state', ''),
                "priority": incident.get('priority', '')
            },
            "la_concept": detected_concept,
            "wiki_knowledge": wiki_result.get('answer', 'No L&A knowledge found in Wiki'),
            "wiki_sources": wiki_result.get('sources', []),
            "similar_la_incidents": [
                {
                    "number": inc.get('number', ''),
                    "short_description": inc.get('short_description', ''),
                    "state": inc.get('state', '')
                }
                for inc in (similar_incidents if isinstance(similar_incidents, list) else [])
            ][:3]
        }
        
    except Exception as e:
        logger.error(f"[L&A Knowledge] Error: {e}")
        return {"error": str(e)}


@register_tool_function("get_la_concept_info")
def get_la_concept_info_tool(concept: str) -> Dict[str, Any]:
    """
    Get Life & Annuity concept definitions and context.
    
    Simple lookup tool for L&A terminology and concepts.
    
    Args:
        concept: L&A concept name (e.g., "NIGO", "APS", "underwriting")
    
    Returns:
        {
            "concept": str,
            "definition": str,
            "wiki_knowledge": str (from Wiki RAG),
            "related_concepts": [...]
        }
    
    Example:
        info = get_la_concept_info_tool("NIGO")
        # Returns definition and Wiki knowledge about NIGO
    """
    concept_lower = concept.lower()
    
    # Simple definitions
    definitions = {
        "nigo": "Not In Good Order - A status indicating a policy/application cannot proceed due to missing information, validation failures, or business rule violations.",
        "aps": "Attending Physician Statement - Medical records requested from an applicant's doctor as part of underwriting requirements.",
        "underwriting": "Risk assessment process to determine if coverage should be issued and at what premium.",
        "pas": "Policy Administration System - Core system for managing policy records, changes, and transactions.",
        "beneficiary": "Person designated to receive death benefit proceeds upon insured's passing."
    }
    
    definition = definitions.get(concept_lower, f"Life & Annuity concept: {concept}")
    
    # Query Wiki for more detailed info
    wiki_query = f"Life and Annuity {concept} definition, procedures, and business rules"
    wiki_result = perform_wiki_rag(wiki_query)
    
    return {
        "concept": concept,
        "definition": definition,
        "wiki_knowledge": wiki_result.get('answer', 'No additional information found'),
        "wiki_sources": wiki_result.get('sources', []),
        "related_concepts": _get_related_concepts(concept_lower)
    }


# ============================================================================
# Internal Helper Functions
# ============================================================================

def _detect_la_concept(text: str) -> str:
    """Detect which L&A concept this incident is about."""
    text_lower = text.lower()
    
    for concept, keywords in LA_CONCEPT_PATTERNS.items():
        if any(keyword in text_lower for keyword in keywords):
            return concept
    
    return "general_la"


def _get_related_concepts(concept: str) -> List[str]:
    """Get related L&A concepts."""
    relations = {
        "nigo": ["underwriting", "application processing", "policy admin"],
        "aps": ["underwriting", "medical underwriting", "risk assessment"],
        "underwriting": ["aps", "nigo", "risk assessment"],
        "pas": ["policy admin", "servicing", "transactions"],
        "beneficiary": ["policy admin", "death claim", "owner change"]
    }
    return relations.get(concept, [])


def _analyze_nigo_incident_legacy(incident_number: str) -> Dict[str, Any]:
    """
    LEGACY/DISABLED: Analyze a NIGO incident - references non-existent class.
    Use resolve_la_nigo_tool() from life_annuity_knowledge.py instead.
    """
    logger.warning(f"[L&A NIGO Agent] Legacy function called - disabled")
    return {
        "error": "This function is deprecated",
        "message": "Use resolve_la_nigo_tool() from life_annuity_knowledge.py instead"
    }


# ============================================================================
# LEGACY/ORPHANED CODE - All methods below reference non-existent class
# These were part of an incomplete LifeAnnuityNIGOAgent class that was never implemented
# Use life_annuity_knowledge.py instead which provides working NIGO resolution tools
# ============================================================================
'''
All code from here through line ~620 is commented out because it references 'self'
parameter but there is no class definition. This was part of an incomplete
LifeAnnuityNIGOAgent class that was never implemented.

Use the working tools instead:
  - resolve_la_nigo_tool() from life_annuity_knowledge.py
  - get_la_nigo_types_tool() from life_annuity_knowledge.py
'''



# ============================================================================
# Tool Registration - Expose agent functions to orchestrator
# ============================================================================
# NOTE: These tools are disabled because they reference LifeAnnuityNIGOAgent class
# which is not defined. Use resolve_la_nigo_tool and get_la_nigo_types_tool instead
# from life_annuity_knowledge.py

# @register_tool_function("analyze_la_nigo_incident")
def analyze_la_nigo_incident_tool(incident_number: str) -> Dict[str, Any]:
    """
    Analyze Life & Annuity NIGO incident and provide resolution guidance.
    
    This tool is specialized for Life & Annuity products and understands:
    - NIGO business rules and validation requirements
    - L&A underwriting workflows
    - Policy administration processes
    - Common NIGO resolution patterns
    
    Args:
        incident_number: ServiceNow incident number (e.g., INC0010001)
    
    Returns:
        Comprehensive analysis including:
        - Incident summary
        - NIGO type classification
        - Wiki knowledge (procedures and business rules)
        - Similar resolved incidents
        - Step-by-step resolution plan
        - Clarifications needed
    
    Example:
        result = analyze_la_nigo_incident_tool("INC0010001")
        print(result['nigo_analysis']['nigo_type'])  # "Successor Owner"
        print(result['resolution_plan']['steps'])     # Resolution steps list
    """
    # Disabled - LifeAnnuityNIGOAgent class not defined
    return {"error": "This tool is disabled. Use resolve_la_nigo_tool from life_annuity_knowledge.py instead"}


# @register_tool_function("get_nigo_resolution_steps")
def get_nigo_resolution_steps_tool(nigo_type: str) -> Dict[str, Any]:
    """
    Get standard resolution steps for a specific NIGO type in Life & Annuity.
    
    Args:
        nigo_type: Type of NIGO (e.g., "successor_owner", "alternate_policy", "missing_requirements")
    
    Returns:
        {
            "nigo_type": str,
            "steps": [...],
            "estimated_time": str,
            "required_roles": [...],
            "success_criteria": [...]
        }
    
    Example:
        steps = get_nigo_resolution_steps_tool("successor_owner")
        for step in steps['steps']:
            print(f"Step {step['step']}: {step['action']}")
    """
    # Disabled - LifeAnnuityNIGOAgent class not defined
    return {"error": "This tool is disabled. Use get_la_nigo_types_tool from life_annuity_knowledge.py instead"}


# ============================================================================
# Export for use in other modules
# ============================================================================
# NOTE: Tools are disabled - use life_annuity_knowledge.py instead

__all__ = []
