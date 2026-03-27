"""
Life & Annuity NIGO Resolver

Context augmentation tool for L&A products (Life Insurance, Annuities).
Queries existing Wiki FAISS with L&A-specific context for better retrieval.

NIGO in L&A context:
- Application processing blockers
- Underwriting requirements not met (APS, medical exams)
- Policy ownership/beneficiary issues
- Payment/premium processing issues
- Compliance/regulatory validation failures
"""

import logging
from typing import Dict, List, Any
from ..servicenowgenaitool import (
    fetch_servicenow_incident_core,
    get_similar_incidents_simple
)
from ..CustomWikiRAG import perform_wiki_rag
from ..shared_registry import FUNCTION_REGISTRY

# The decorator is defined in snowaaonetool.py, which will import this file
# So we need to access it after import or define it here
def register_tool_function(name):
    """Decorator to register a function in the registry."""
    def decorator(func):
        FUNCTION_REGISTRY[name] = func
        return func
    return decorator

logger = logging.getLogger("agentic_orchestrator_auto")


# L&A NIGO-specific patterns
LA_NIGO_PATTERNS = {
    "successor_owner": ["successor", "owner", "beneficiary change", "ownership transfer"],
    "aps": ["aps", "attending physician", "medical records", "medical underwriting"],
    "underwriting": ["underwriting", "risk assessment", "approval", "decline"],
    "missing_requirements": ["missing", "incomplete", "requirement", "document needed"],
    "payment": ["payment", "premium", "funding", "initial premium"],
    "compliance": ["compliance", "regulatory", "state requirement", "suitability"],
    "signature": ["signature", "sign", "esign", "wet signature"],
    "policy_admin": ["policy admin", "pas", "policy system", "servicing"]
}


@register_tool_function("resolve_la_nigo")
def resolve_la_nigo_tool(incident_number: str) -> Dict[str, Any]:
    """
    Resolve Life & Annuity NIGO issues using Wiki knowledge.
    
    Augments context with L&A product information before querying Wiki FAISS.
    Returns L&A-specific NIGO resolution guidance.
    
    Args:
        incident_number: ServiceNow incident (e.g., INC0010001)
    
    Returns:
        {
            "incident": {...},
            "la_nigo_type": str (successor_owner, aps, underwriting, etc.),
            "resolution_knowledge": str (from Wiki with L&A context),
            "wiki_sources": list,
            "similar_la_nigo": list of similar resolved incidents
        }
    """
    try:
        # Fetch incident
        incident = fetch_servicenow_incident_core(incident_number)
        if not incident or "error" in incident:
            return {"error": f"Could not fetch {incident_number}"}
        
        desc = f"{incident.get('short_description', '')} {incident.get('description', '')}"
        
        # Detect L&A NIGO type
        nigo_type = _detect_la_nigo_type(desc)
        logger.info(f"[L&A NIGO Resolver] Detected type: {nigo_type}")
        
        # Build context-augmented Wiki query for existing FAISS
        # Key: Add "Life and Annuity" + NIGO type to improve FAISS retrieval
        wiki_query = (
            f"Life and Annuity Insurance "
            f"NIGO {nigo_type} resolution procedures requirements: {desc}"
        )
        
        logger.info(f"[L&A NIGO Resolver] Querying Wiki FAISS with L&A context")
        wiki_result = perform_wiki_rag(wiki_query)
        
        # Find similar L&A NIGO incidents
        similar_query = f"Life Annuity NIGO {nigo_type} {desc}"
        similar = get_similar_incidents_simple(similar_query)
        if isinstance(similar, dict) and "error" in similar:
            similar = []
        
        # Filter for resolved incidents
        resolved_similar = [
            inc for inc in (similar if isinstance(similar, list) else [])
            if inc.get('state', '').lower() in ['resolved', 'closed', '6', '7']
        ]
        
        result = {
            "incident": {
                "number": incident_number,
                "short_description": incident.get('short_description', ''),
                "status": incident.get('state', ''),
                "priority": incident.get('priority', ''),
                "assignment_group": incident.get('assignment_group', '')
            },
            "la_nigo_type": nigo_type,
            "resolution_knowledge": wiki_result.get('answer', 'No L&A NIGO resolution found in Wiki'),
            "wiki_sources": wiki_result.get('sources', []),
            "similar_la_nigo": [
                {
                    "number": inc.get('number', ''),
                    "short_description": inc.get('short_description', ''),
                    "resolution": inc.get('close_notes', '')[:200] if inc.get('close_notes') else ''
                }
                for inc in resolved_similar
            ][:3]
        }
        
        logger.info(f"[L&A NIGO Resolver] Completed for {incident_number}")
        return result
        
    except Exception as e:
        logger.error(f"[L&A NIGO Resolver] Error: {str(e)}")
        return {"error": str(e)}


@register_tool_function("get_la_nigo_types")
def get_la_nigo_types_tool() -> Dict[str, Any]:
    """
    Get L&A NIGO type definitions and common resolution patterns.
    
    Returns dictionary of L&A NIGO types with descriptions.
    """
    return {
        "nigo_types": {
            "successor_owner": {
                "description": "Beneficiary or ownership succession issues",
                "common_causes": ["Death certificate missing", "Successor documentation incomplete", "Ownership transfer pending"],
                "typical_resolution": "Verify death certificate, obtain successor designation form, process ownership change"
            },
            "aps": {
                "description": "Attending Physician Statement requirements not met",
                "common_causes": ["APS not received", "Medical records incomplete", "APS order not placed"],
                "typical_resolution": "Order APS from physician, follow up on pending requests, review received records"
            },
            "underwriting": {
                "description": "Underwriting requirements or approval pending",
                "common_causes": ["Risk assessment incomplete", "Medical exam needed", "Additional underwriting info required"],
                "typical_resolution": "Complete underwriting requirements, obtain medical exam, provide requested information"
            },
            "missing_requirements": {
                "description": "Application or new business requirements not satisfied",
                "common_causes": ["Application fields incomplete", "Required documents missing", "Client response pending"],
                "typical_resolution": "Contact agent/client for missing info, complete application fields, obtain documents"
            },
            "payment": {
                "description": "Initial premium or payment processing issues",
                "common_causes": ["Premium not received", "Payment method invalid", "Bank draft failed"],
                "typical_resolution": "Confirm payment received, validate payment method, reprocess failed transaction"
            },
            "compliance": {
                "description": "Regulatory or compliance validation failures",
                "common_causes": ["Suitability review needed", "State requirements not met", "Anti-money laundering flags"],
                "typical_resolution": "Complete suitability questionnaire, verify state compliance, resolve AML concerns"
            },
            "signature": {
                "description": "Required signatures missing or invalid",
                "common_causes": ["Application not signed", "E-signature failed", "Witness signature missing"],
                "typical_resolution": "Obtain required signatures, re-execute e-signature, ensure proper witnessing"
            },
            "policy_admin": {
                "description": "Policy administration system or servicing issues",
                "common_causes": ["PAS system error", "Policy data validation failed", "System integration issue"],
                "typical_resolution": "Resolve PAS system error, correct policy data, troubleshoot integration"
            }
        }
    }


def _detect_la_nigo_type(text: str) -> str:
    """Detect L&A NIGO type from incident text."""
    text_lower = text.lower()
    
    for nigo_type, keywords in LA_NIGO_PATTERNS.items():
        if any(kw in text_lower for kw in keywords):
            return nigo_type
    
    return "general_la_nigo"


__all__ = ['resolve_la_nigo_tool', 'get_la_nigo_types_tool']
