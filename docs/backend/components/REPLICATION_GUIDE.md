# Product Domain Knowledge Tools - Replication Guide

**Purpose:** Add domain-specific knowledge tools for each insurance product line

---

## ✅ What We Built (L&A Example)

**File:** `backend/components/domain/life_annuity_knowledge.py` (~120 lines)

**Two simple tools:**
1. `get_la_domain_knowledge(incident_number)` - Retrieves L&A knowledge for incidents
2. `get_la_concept_info(concept)` - Gets L&A concept definitions

**What they DO:**
- Query Wiki with L&A product context
- Detect L&A concepts (NIGO, APS, underwriting, etc.)
- Find similar L&A incidents
- Return structured knowledge

**What they DON'T do:**
- ❌ Create plans (orchestrator does this)
- ❌ Execute steps (orchestrator does this)  
- ❌ Duplicate existing framework

---

## 🎯 Philosophy

### The Right Pattern:
```
User Question
    ↓
Orchestrator detects "L&A incident"
    ↓
Calls get_la_domain_knowledge() → Returns Wiki knowledge + similar incidents
    ↓
Orchestrator uses knowledge in ITS OWN planning logic
    ↓
Orchestrator executes plan using existing tools
```

### The Wrong Pattern (what I initially built):
```
❌ Domain agent has own planning logic
❌ Domain agent duplicates orchestrator functionality
❌ Two competing planning systems
```

---

## 📋 Replication Steps for New Products

### Example: P&C (Property & Casualty)

**1. Create file:** `backend/components/domain/property_casualty_knowledge.py`

```python
"""
Property & Casualty Domain Knowledge Tools
"""

import logging
from typing import Dict, List, Any
from ..servicenowgenaitool import (
    fetch_servicenow_incident_core,
    get_similar_incidents_simple
)
from ..CustomWikiRAG import perform_wiki_rag
from ..shared_registry import register_tool_function

logger = logging.getLogger("agentic_orchestrator_auto")

# P&C domain concepts
PC_CONCEPTS = {
    "claims": ["claim", "loss", "damage", "accident"],
    "liability": ["liability", "fault", "responsible", "at-fault"],
    "coverage": ["coverage", "covered", "exclusion", "policy limit"],
    "adjuster": ["adjuster", "inspect", "estimate", "assessment"],
    "subrogation": ["subrogation", "recovery", "third party"]
}


@register_tool_function("get_pc_domain_knowledge")
def get_pc_domain_knowledge_tool(incident_number: str) -> Dict[str, Any]:
    """
    Get Property & Casualty domain knowledge for an incident.
    
    Queries Wiki with P&C context (claims, liability, coverage).
    Orchestrator uses this in its planning.
    """
    logger.info(f"[P&C Knowledge] Fetching for {incident_number}")
    
    try:
        incident = fetch_servicenow_incident_core(incident_number)
        if not incident or "error" in incident:
            return {"error": f"Could not fetch {incident_number}"}
        
        desc = f"{incident.get('short_description', '')} {incident.get('description', '')}"
        
        # Detect P&C concept
        concept = _detect_pc_concept(desc)
        logger.info(f"[P&C Knowledge] Concept: {concept}")
        
        # Query Wiki with P&C context
        wiki_query = f"Property Casualty {concept} procedures: {desc}"
        wiki_result = perform_wiki_rag(wiki_query)
        
        # Find similar P&C incidents
        similar_query = f"Property Casualty {concept} {desc}"
        similar = get_similar_incidents_simple(similar_query, top_k=3)
        if isinstance(similar, dict) and "error" in similar:
            similar = []
        
        return {
            "incident": {
                "number": incident_number,
                "short_description": incident.get('short_description', '')
            },
            "pc_concept": concept,
            "wiki_knowledge": wiki_result.get('answer', 'No P&C knowledge found'),
            "wiki_sources": wiki_result.get('sources', []),
            "similar_pc_incidents": [
                {"number": i.get('number', ''), "short_description": i.get('short_description', '')}
                for i in (similar if isinstance(similar, list) else [])
            ][:3]
        }
    except Exception as e:
        logger.error(f"[P&C Knowledge] Error: {e}")
        return {"error": str(e)}


@register_tool_function("get_pc_concept_info")
def get_pc_concept_info_tool(concept: str) -> Dict[str, Any]:
    """Get P&C concept definition and Wiki knowledge."""
    definitions = {
        "claims": "P&C claims processing - handling reported losses and damage",
        "liability": "Liability determination - assessing fault and responsibility",
        "coverage": "Coverage analysis - determining what policy covers",
        "adjuster": "Claims adjuster assignment and inspections"
    }
    
    wiki_result = perform_wiki_rag(f"Property Casualty {concept} definition procedures")
    
    return {
        "concept": concept,
        "definition": definitions.get(concept.lower(), f"P&C concept: {concept}"),
        "wiki_knowledge": wiki_result.get('answer', 'No additional info'),
        "wiki_sources": wiki_result.get('sources', [])
    }


def _detect_pc_concept(text: str) -> str:
    """Detect P&C concept from text."""
    text_lower = text.lower()
    for concept, keywords in PC_CONCEPTS.items():
        if any(kw in text_lower for kw in keywords):
            return concept
    return "general_pc"


__all__ = ['get_pc_domain_knowledge_tool', 'get_pc_concept_info_tool']
```

**2. Register in `snowaaonetool.py`:**

```python
from .domain.property_casualty_knowledge import (
    get_pc_domain_knowledge_tool,
    get_pc_concept_info_tool
)
```

**3. Done!** Orchestrator can now call `get_pc_domain_knowledge()` when it detects P&C incidents.

---

## 🔨 Quick Template

**File:** `{product}_knowledge.py`

```python
"""
{Product Name} Domain Knowledge Tools
"""
import logging
from typing import Dict, Any
from ..servicenowgenaitool import fetch_servicenow_incident_core, get_similar_incidents_simple
from ..CustomWikiRAG import perform_wiki_rag
from ..shared_registry import register_tool_function

logger = logging.getLogger("agentic_orchestrator_auto")

# Define your product's concepts
CONCEPTS = {
    "concept1": ["keyword1", "keyword2"],
    "concept2": ["keyword3", "keyword4"]
}

@register_tool_function("get_{product_abbrev}_domain_knowledge")
def get_domain_knowledge_tool(incident_number: str) -> Dict[str, Any]:
    """Get {product} domain knowledge for incident."""
    incident = fetch_servicenow_incident_core(incident_number)
    desc = f"{incident.get('short_description', '')} {incident.get('description', '')}"
    
    concept = _detect_concept(desc)
    wiki_query = f"{Product Name} {concept} procedures: {desc}"
    wiki_result = perform_wiki_rag(wiki_query)
    
    similar_query = f"{Product Name} {concept} {desc}"
    similar = get_similar_incidents_simple(similar_query, top_k=3)
    
    return {
        "incident": {"number": incident_number, "short_description": incident.get('short_description', '')},
        "concept": concept,
        "wiki_knowledge": wiki_result.get('answer', 'No knowledge found'),
        "wiki_sources": wiki_result.get('sources', []),
        "similar_incidents": [...]
    }

@register_tool_function("get_{product_abbrev}_concept_info")
def get_concept_info_tool(concept: str) -> Dict[str, Any]:
    """Get {product} concept definition."""
    definitions = {"concept1": "Definition..."}
    wiki_result = perform_wiki_rag(f"{Product Name} {concept} definition")
    return {
        "concept": concept,
        "definition": definitions.get(concept.lower(), f"{Product} concept: {concept}"),
        "wiki_knowledge": wiki_result.get('answer', '')
    }

def _detect_concept(text: str) -> str:
    """Detect concept from text."""
    text_lower = text.lower()
    for concept, keywords in CONCEPTS.items():
        if any(kw in text_lower for kw in keywords):
            return concept
    return "general"
```

---

## 📊 Product Priority

| Product | Concept Examples | Tool Names | Priority |
|---------|------------------|------------|----------|
| **L&A** ✅ | NIGO, APS, underwriting | `get_la_domain_knowledge` | Done! |
| **P&C** | Claims, liability, adjuster | `get_pc_domain_knowledge` | High |
| **Group Benefits** | Enrollment, eligibility, QLE | `get_gb_domain_knowledge` | High |
| **Voluntary** | Elections, payroll, enrollment | `get_vb_domain_knowledge` | Medium |

---

## 🎯 Key Points

1. **Keep it simple** - 2 tools per product (~100-150 lines total)
2. **No planning logic** - Just retrieve knowledge, let orchestrator plan
3. **Product-specific queries** - Query Wiki with product context for better results
4. **Concept detection** - Simple keyword matching to detect domain concepts
5. **Similar incidents** - Find past resolutions in same product area

---

## ✅ Success Criteria

Each product domain tool should:
- [ ] Query Wiki with product-specific context
- [ ] Detect product concepts (3-6 main concepts)
- [ ] Find similar incidents in product area
- [ ] Return structured knowledge (not plans!)
- [ ] Total ~100-150 lines of code
- [ ] Register 2 tools: `get_{product}_domain_knowledge` and `get_{product}_concept_info`

---

## 🚀 Next Steps

1. **Test L&A tools** with real incidents (INC0010001, INC0010002)
2. **Create P&C tools** following template
3. **Create Group Benefits tools** following template  
4. **Create Voluntary tools** following template
5. **Update orchestrator** to detect product line and route to appropriate knowledge tool

---

**Status:** Template ready, L&A implemented, P&C/GB/VB pending
