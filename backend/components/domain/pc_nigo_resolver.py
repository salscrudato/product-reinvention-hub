"""
Property & Casualty (P&C) NIGO Resolver

Context augmentation tool for P&C products (Auto, Homeowners, Property).
Queries existing Wiki FAISS with P&C-specific context for better retrieval.

NIGO in P&C context:
- Policy binding issues
- Coverage validation failures
- Underwriting documentation gaps
- Vehicle/property information incomplete
- Premium calculation errors
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


# P&C NIGO-specific patterns
PC_NIGO_PATTERNS = {
    "binding": ["binding", "bind", "effective date", "policy issuance"],
    "coverage": ["coverage", "limit", "deductible", "exclusion"],
    "vehicle": ["vehicle", "vin", "auto", "car", "driver"],
    "property": ["property", "address", "dwelling", "home", "building"],
    "underwriting": ["underwriting", "risk assessment", "inspection", "appraisal"],
    "premium": ["premium", "payment", "rate", "pricing"],
    "documentation": ["document", "signature", "declaration", "application"]
}


@register_tool_function("resolve_pc_nigo")
def resolve_pc_nigo_tool(incident_number: str) -> Dict[str, Any]:
    """
    Resolve Property & Casualty NIGO issues using Wiki knowledge.
    
    Augments context with P&C product information before querying Wiki FAISS.
    Returns P&C-specific NIGO resolution guidance.
    
    Args:
        incident_number: ServiceNow incident (e.g., INC0010001)
    
    Returns:
        {
            "incident": {...},
            "pc_nigo_type": str (binding, coverage, vehicle, etc.),
            "resolution_knowledge": str (from Wiki with P&C context),
            "wiki_sources": [...],
            "similar_pc_nigo": [...] (similar P&C NIGO cases)
        }
    
    Example:
        result = resolve_pc_nigo_tool("INC0010001")
        # Returns P&C-specific NIGO resolution from Wiki
    """
    logger.info(f"[P&C NIGO Resolver] Processing {incident_number}")
    
    try:
        # Fetch incident
        incident = fetch_servicenow_incident_core(incident_number)
        if not incident or "error" in incident:
            return {"error": f"Could not fetch {incident_number}"}
        
        desc = f"{incident.get('short_description', '')} {incident.get('description', '')}"
        
        # Detect P&C NIGO type
        nigo_type = _detect_pc_nigo_type(desc)
        logger.info(f"[P&C NIGO Resolver] Detected type: {nigo_type}")
        
        # Build context-augmented Wiki query for existing FAISS
        # Key: Add "Property Casualty" + NIGO type to improve FAISS retrieval
        wiki_query = (
            f"Property and Casualty Auto Homeowners Insurance "
            f"NIGO {nigo_type} resolution procedures requirements: {desc}"
        )
        
        logger.info(f"[P&C NIGO Resolver] Querying Wiki FAISS with P&C context")
        wiki_result = perform_wiki_rag(wiki_query)
        
        # Find similar P&C NIGO incidents
        similar_query = f"Property Casualty Auto Homeowners NIGO {nigo_type} {desc}"
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
            "pc_nigo_type": nigo_type,
            "resolution_knowledge": wiki_result.get('answer', 'No P&C NIGO resolution found in Wiki'),
            "wiki_sources": wiki_result.get('sources', []),
            "similar_pc_nigo": [
                {
                    "number": inc.get('number', ''),
                    "short_description": inc.get('short_description', ''),
                    "resolution": inc.get('close_notes', '')[:200] if inc.get('close_notes') else ''
                }
                for inc in resolved_similar
            ][:3]
        }
        
        logger.info(f"[P&C NIGO Resolver] Found {len(result['wiki_sources'])} Wiki sources, "
                   f"{len(result['similar_pc_nigo'])} similar cases")
        
        return result
        
    except Exception as e:
        logger.error(f"[P&C NIGO Resolver] Error: {e}")
        return {"error": str(e)}


@register_tool_function("get_pc_nigo_types")
def get_pc_nigo_types_tool() -> Dict[str, Any]:
    """
    Get P&C NIGO type definitions and common resolution patterns.
    
    Returns dictionary of P&C NIGO types with descriptions.
    """
    return {
        "nigo_types": {
            "binding": {
                "description": "Policy binding or effective date issues",
                "common_causes": ["Missing signature", "Payment not received", "Underwriting not complete"],
                "typical_resolution": "Verify all binding requirements met, process payment, confirm UW approval"
            },
            "coverage": {
                "description": "Coverage limits, deductibles, or exclusion validation failures",
                "common_causes": ["Limit exceeds guidelines", "Invalid deductible selection", "Coverage not available"],
                "typical_resolution": "Review underwriting guidelines, adjust coverage to approved limits"
            },
            "vehicle": {
                "description": "Vehicle information incomplete or invalid (Auto insurance)",
                "common_causes": ["Missing VIN", "Invalid vehicle year/make/model", "Driver info incomplete"],
                "typical_resolution": "Request complete vehicle details, verify VIN, validate driver licenses"
            },
            "property": {
                "description": "Property information incomplete or invalid (Homeowners/Property)",
                "common_causes": ["Address verification failed", "Property details missing", "Inspection required"],
                "typical_resolution": "Verify property address, order inspection if needed, obtain property details"
            },
            "underwriting": {
                "description": "Underwriting requirements not satisfied",
                "common_causes": ["Loss history needed", "Inspection pending", "Additional info required"],
                "typical_resolution": "Complete underwriting requirements, provide requested documentation"
            },
            "premium": {
                "description": "Premium calculation or payment issues",
                "common_causes": ["Rate calculation error", "Payment method invalid", "Premium financing issue"],
                "typical_resolution": "Recalculate premium, verify payment method, resolve financing setup"
            },
            "documentation": {
                "description": "Required documentation missing or invalid",
                "common_causes": ["Signature missing", "Application incomplete", "Declaration page not signed"],
                "typical_resolution": "Obtain required signatures, complete all application fields, execute documents"
            }
        }
    }


def _detect_pc_nigo_type(text: str) -> str:
    """Detect P&C NIGO type from incident text."""
    text_lower = text.lower()
    
    for nigo_type, keywords in PC_NIGO_PATTERNS.items():
        if any(kw in text_lower for kw in keywords):
            return nigo_type
    
    return "general_pc_nigo"


__all__ = ['resolve_pc_nigo_tool', 'get_pc_nigo_types_tool']
