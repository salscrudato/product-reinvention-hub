"""
Entity Memory Framework - Generic, Configuration-Driven Context Management

Replaces homegrown short_term_memory.py with a scalable, entity-agnostic pattern.
Works seamlessly with LangGraph state management.

Key Features:
- Configuration-driven entity extractors (no code changes for new entity types)
- Generic pronoun resolution for ANY entity type
- Tool-to-entity mapping registry
- Integrates with LangGraph state schema
- Token-efficient caching

Usage:
    # Add new entity type (zero code changes needed):
    ENTITY_CONFIG["code_files"] = {
        "extractors": [lambda out: [f.get("path") for f in out.get("files", [])]],
        "patterns": [r"\\bthose\\s+files?\\b", r"\\bthe\\s+code\\b"],
        "fetch_tool": "fetch_file_content",
        "id_param": "file_path"
    }
"""

import os
import re
import logging
from typing import Dict, List, Any, Optional, Tuple, Callable

logger = logging.getLogger("agentic_orchestrator_auto.entity_memory")

# Feature flag (rollback: set ENABLE_ENTITY_MEMORY=0)
ENABLED = os.getenv("ENABLE_ENTITY_MEMORY", "1").lower() in ("1", "true", "yes", "on")

# ==================== CONFIGURATION REGISTRY ====================
# Add new entity types here WITHOUT changing any framework code

ENTITY_CONFIG: Dict[str, Dict[str, Any]] = {
    "incidents": {
        # Extractors: list of functions that pull entity IDs from tool output
        "extractors": [
            # Extract from backlog overview sample field
            lambda output: [
                item.get("number") 
                for item in (output.get("sample") or [])
                if isinstance(item, dict) and item.get("number")
            ],
            # Extract from incidents array
            lambda output: [
                item.get("number") 
                for item in (output.get("incidents") or [])
                if isinstance(item, dict) and item.get("number")
            ],
            # Extract single incident
            lambda output: [output.get("number")] if output.get("number") else [],
        ],
        # Reference patterns: regex patterns that indicate user is referring to this entity type
        "patterns": [
            r"\bthose\s+incidents?\b",
            r"\bthese\s+tickets?\b",
            r"\bthe\s+issues?\b",
            r"\bthem\b",  # Generic pronoun (only matches if incidents are in context)
            r"\bit\b",     # Singular reference
        ],
        # Tool to fetch individual entity
        "fetch_tool": "fetch_servicenow_incident",
        # Parameter name for entity ID
        "id_param": "incident_number",
        # Tools that produce this entity type
        "source_tools": ["fetch_backlog_overview", "fetch_servicenow_incident", 
                        "get_similar_incidents", "find_incidents_by_short_description",
                        "query_incidents_by_date", "get_incidents_created_today",
                        "get_incidents_by_date_range"],
    },
    
    "user_stories": {
        "extractors": [
            # Extract from JIRA response
            lambda output: [
                item.get("key") 
                for item in (output.get("issues") or output.get("stories") or [])
                if isinstance(item, dict) and item.get("key")
            ],
            # Single story
            lambda output: [output.get("key")] if output.get("key") else [],
        ],
        "patterns": [
            r"\bthose\s+stories\b",
            r"\bthese\s+epics?\b",
            r"\bthe\s+features?\b",
            r"\bthe\s+user\s+stories?\b",
            r"\bthem\b",
        ],
        "fetch_tool": "jira_fetch_user_story",
        "id_param": "story_key",
        "source_tools": ["jira_fetch_user_story", "jira_summarize_user_story"],
    },
    
    "wiki_pages": {
        "extractors": [
            # Extract from wiki search results
            lambda output: [
                item.get("page_id") or item.get("title") or item.get("url")
                for item in (output.get("pages") or output.get("results") or output.get("chunks") or [])
                if isinstance(item, dict)
            ],
            # Single page
            lambda output: [output.get("page_id") or output.get("title")] 
                if (output.get("page_id") or output.get("title")) else [],
        ],
        "patterns": [
            r"\bthose\s+pages?\b",
            r"\bthose\s+docs?\b",
            r"\bthe\s+articles?\b",
            r"\bthe\s+wiki\s+pages?\b",
            r"\bthem\b",
        ],
        "fetch_tool": "wiki_rag_tool",
        "id_param": "page_id",
        "source_tools": ["wiki_rag_tool", "wiki_clarification_request"],
    },
    
    "change_records": {
        "extractors": [
            lambda output: [
                item.get("number") or item.get("change_id")
                for item in (output.get("changes") or output.get("records") or [])
                if isinstance(item, dict)
            ],
            lambda output: [output.get("number") or output.get("change_id")] 
                if (output.get("number") or output.get("change_id")) else [],
        ],
        "patterns": [
            r"\bthose\s+changes?\b",
            r"\bthese\s+change\s+records?\b",
            r"\bthe\s+CRs?\b",
            r"\bthem\b",
        ],
        "fetch_tool": "fetch_change_records_related",
        "id_param": "change_id",
        "source_tools": ["fetch_change_records_related", "fetch_recent_failed_changes"],
    },
    
    # ✅ Add new entity types here with 4-6 lines of config
    # No code changes needed in framework functions below
}


class EntityMemoryFramework:
    """
    Generic entity memory manager - works for ANY entity type via configuration.
    
    Designed to integrate with LangGraph state schema:
        class GraphState(TypedDict):
            cached_entities: Dict[str, List[str]]  # {"incidents": [...], "user_stories": [...]}
            last_tool_outputs: Dict[str, Any]      # {"fetch_backlog": {...}}
    """
    
    def __init__(self):
        self.enabled = ENABLED
        if self.enabled:
            logger.info("[EntityMemory] Framework initialized | entity_types=%d", len(ENTITY_CONFIG))
        else:
            logger.warning("[EntityMemory] Framework DISABLED via ENABLE_ENTITY_MEMORY=0")
    
    def extract_entities_from_outputs(self, tool_outputs: Dict[str, Any]) -> Dict[str, List[str]]:
        """
        Generic entity extraction - works for ALL configured entity types.
        
        Args:
            tool_outputs: {"tool_name": tool_output_dict}
        
        Returns:
            {"entity_type": ["entity_id1", "entity_id2", ...]}
        """
        if not self.enabled or not tool_outputs:
            return {}
        
        extracted = {}
        
        for entity_type, config in ENTITY_CONFIG.items():
            entities = []
            extractors = config.get("extractors", [])
            source_tools = config.get("source_tools", [])
            
            # Check each tool output
            for tool_name, tool_output in tool_outputs.items():
                if not isinstance(tool_output, dict):
                    continue
                
                # Only extract if this tool produces this entity type
                if source_tools and tool_name not in source_tools:
                    continue
                
                # Try each extractor for this entity type
                for extractor in extractors:
                    try:
                        extracted_ids = extractor(tool_output)
                        if extracted_ids:
                            entities.extend([e for e in extracted_ids if e])
                    except Exception as e:
                        logger.debug(f"[EntityMemory] Extractor failed for {entity_type}: {e}")
            
            if entities:
                # Deduplicate and limit
                unique_entities = list(dict.fromkeys(entities))[:20]  # Keep order, cap at 20
                extracted[entity_type] = unique_entities
                logger.info(f"[EntityMemory] Extracted {len(unique_entities)} {entity_type}")
        
        return extracted
    
    def detect_entity_reference(self, question: str, cached_entities: Dict[str, List[str]]) -> Optional[Dict[str, Any]]:
        """
        Generic pronoun resolution - checks ALL entity types.
        
        Args:
            question: User's question
            cached_entities: {"entity_type": ["id1", "id2"]}
        
        Returns:
            {
                "entity_type": "incidents",
                "entities": ["INC001", "INC002"],
                "pattern": "those incidents",
                "fetch_tool": "fetch_servicenow_incident",
                "id_param": "incident_number"
            }
            or None if no reference detected
        """
        if not self.enabled or not question or not cached_entities:
            return None
        
        question_lower = question.lower()
        
        # Check each entity type for references
        for entity_type, config in ENTITY_CONFIG.items():
            entities = cached_entities.get(entity_type, [])
            if not entities:
                continue
            
            patterns = config.get("patterns", [])
            
            # Check if question matches any reference pattern
            for pattern in patterns:
                match = re.search(pattern, question_lower)
                if match:
                    return {
                        "entity_type": entity_type,
                        "entities": entities,
                        "pattern": match.group(0),
                        "fetch_tool": config.get("fetch_tool"),
                        "id_param": config.get("id_param"),
                        "count": len(entities)
                    }
        
        return None
    
    def build_fetch_plan(self, reference_info: Dict[str, Any], limit: int = 5) -> List[Dict[str, Any]]:
        """
        Build execution plan to fetch referenced entities.
        
        Args:
            reference_info: Output from detect_entity_reference()
            limit: Max entities to fetch
        
        Returns:
            [{"tool": "fetch_tool", "args": {"id_param": "entity_id"}}, ...]
        """
        if not reference_info:
            return []
        
        tool_name = reference_info.get("fetch_tool")
        id_param = reference_info.get("id_param")
        entities = reference_info.get("entities", [])
        
        if not tool_name or not id_param or not entities:
            return []
        
        # Build plan for each entity (limited)
        plan = [
            {
                "function_name": tool_name,
                "arguments": {id_param: entity_id}
            }
            for entity_id in entities[:limit]
        ]
        
        logger.info(f"[EntityMemory] Built fetch plan | tool={tool_name} entities={len(plan)}")
        return plan
    
    def merge_cached_entities(self, existing: Dict[str, List[str]], new: Dict[str, List[str]], 
                              max_per_type: int = 20) -> Dict[str, List[str]]:
        """
        Merge new entities with existing, maintaining uniqueness and limits.
        
        Args:
            existing: Current cached entities
            new: Newly extracted entities
            max_per_type: Max entities to keep per type
        
        Returns:
            Merged entity cache
        """
        merged = dict(existing)  # Copy
        
        for entity_type, new_entities in new.items():
            existing_entities = merged.get(entity_type, [])
            
            # Merge: new entities first (more recent), then existing
            combined = new_entities + [e for e in existing_entities if e not in new_entities]
            
            # Limit
            merged[entity_type] = combined[:max_per_type]
        
        return merged


# ==================== GLOBAL SINGLETON ====================

_global_framework: Optional[EntityMemoryFramework] = None


def get_entity_memory() -> EntityMemoryFramework:
    """Get or create global entity memory framework instance"""
    global _global_framework
    if _global_framework is None:
        _global_framework = EntityMemoryFramework()
    return _global_framework


# ==================== CONVENIENCE FUNCTIONS (for LangGraph nodes) ====================

def extract_entities(tool_outputs: Dict[str, Any]) -> Dict[str, List[str]]:
    """
    Extract entities from tool outputs.
    Use in cache node after tool execution.
    
    Example:
        def cache_node(state: GraphState):
            entities = extract_entities(state["last_tool_outputs"])
            return {"cached_entities": merge_entities(state.get("cached_entities", {}), entities)}
    """
    framework = get_entity_memory()
    return framework.extract_entities_from_outputs(tool_outputs)


def detect_reference(question: str, cached_entities: Dict[str, List[str]]) -> Optional[Dict[str, Any]]:
    """
    Detect if question references cached entities.
    Use in reference detection node before planning.
    
    Example:
        def detect_ref_node(state: GraphState):
            ref = detect_reference(state["messages"][-1].content, state.get("cached_entities", {}))
            if ref:
                plan = build_fetch_plan(ref, limit=5)
                return {"current_plan": plan, "reference_resolved": True}
            return {"reference_resolved": False}
    """
    framework = get_entity_memory()
    return framework.detect_entity_reference(question, cached_entities)


def build_fetch_plan(reference_info: Dict[str, Any], limit: int = 5) -> List[Dict[str, Any]]:
    """
    Build plan to fetch referenced entities.
    Use after detect_reference returns a match.
    """
    framework = get_entity_memory()
    return framework.build_fetch_plan(reference_info, limit)


def merge_entities(existing: Dict[str, List[str]], new: Dict[str, List[str]], 
                   max_per_type: int = 20) -> Dict[str, List[str]]:
    """
    Merge new entities with existing cache.
    Use in cache node to update state.
    """
    framework = get_entity_memory()
    return framework.merge_cached_entities(existing, new, max_per_type)


__all__ = [
    "EntityMemoryFramework",
    "get_entity_memory",
    "extract_entities",
    "detect_reference",
    "build_fetch_plan",
    "merge_entities",
    "ENTITY_CONFIG",
    "ENABLED"
]
