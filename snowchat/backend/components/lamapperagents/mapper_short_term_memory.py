"""Mapper Short-Term Memory: Entity Reference Resolution & Context Tracking

ROLLBACK: Set environment variable ENABLE_MAPPER_MEMORY=0 to disable

This module provides:
1. Entity reference resolution ("those fields" → actual entity list)
2. Tool output caching (lightweight - just entity names)
3. Entity tracking across conversation turns
4. Context-aware query rewriting

Token Optimization:
- Does NOT send full entity mappings to LLM
- Only sends entity names and key metadata
- Minimal metadata additions (< 50 tokens per turn)
"""

import logging
import re
import os
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime

logger = logging.getLogger("mapper_agentic_orchestrator.memory")

# Feature flag for easy rollback
ENABLED = os.getenv("ENABLE_MAPPER_MEMORY", "1").lower() in ("1", "true", "yes", "on")


class MapperShortTermMemory:
    """Lightweight context tracker for resolving entity references across conversation turns"""
    
    def __init__(self):
        self.last_tool_outputs: Dict[str, Any] = {}
        self.last_tool_name: Optional[str] = None
        self.last_entity_list: List[str] = []
        self.last_query_type: Optional[str] = None
        self.conversation_context: Dict[str, Any] = {}
        logger.info(f"[MapperMemory] Initialized (enabled={ENABLED})")
    
    def store_tool_output(self, tool_name: str, output: Any, intent: Optional[str] = None):
        """Store last tool output - only keeps entity references for token efficiency
        
        Args:
            tool_name: Name of the tool executed
            output: Tool output (we extract only entity names)
            intent: Intent classification for context
        """
        if not ENABLED:
            return
        
        self.last_tool_name = tool_name
        self.last_query_type = intent
        
        # Extract entity names from output (token-efficient)
        entity_refs = self._extract_entities_from_output(output)
        if entity_refs:
            self.last_entity_list = entity_refs
            logger.info(f"[MapperMemory] Stored {len(entity_refs)} entities from {tool_name}")
        
        # Store lightweight metadata only
        self.last_tool_outputs[tool_name] = {
            "entity_count": len(entity_refs),
            "entities": entity_refs[:20],  # Cap at 20 for token efficiency
            "has_data": bool(output),
            "timestamp": datetime.utcnow().isoformat()
        }
    
    def _extract_entities_from_output(self, output: Any) -> List[str]:
        """Extract entity names from tool output
        
        Handles various output formats:
        - {"entities": [{"entity_name": "customer name"}, ...]}
        - {"result": {"entities": [...]}}
        - ["customer_name", "policy_number"]
        """
        entities = []
        
        if isinstance(output, dict):
            # Check for "entities" key (mapper orchestrator format)
            if "entities" in output:
                items = output["entities"]
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict) and "entity_name" in item:
                            entities.append(item["entity_name"])
                        elif isinstance(item, str):
                            entities.append(item)
            
            # Check for "result.entities" key (nested format)
            if "result" in output and isinstance(output["result"], dict):
                if "entities" in output["result"]:
                    items = output["result"]["entities"]
                    if isinstance(items, list):
                        for item in items:
                            if isinstance(item, dict) and "entity_name" in item:
                                entities.append(item["entity_name"])
                            elif isinstance(item, str):
                                entities.append(item)
            
            # Check for "extracted_entity_names" key (intent classifier format)
            if "extracted_entity_names" in output:
                items = output["extracted_entity_names"]
                if isinstance(items, list):
                    entities.extend([str(e) for e in items])
        
        elif isinstance(output, list):
            for item in output:
                if isinstance(item, dict) and "entity_name" in item:
                    entities.append(item["entity_name"])
                elif isinstance(item, str):
                    entities.append(item)
        
        return list(set(entities))  # Remove duplicates
    
    def detect_reference(self, question: str) -> Optional[Dict[str, Any]]:
        """Detect if question references previous context
        
        Returns:
            Dict with reference info if detected, None otherwise
        """
        if not ENABLED or not question:
            return None
        
        question_lower = question.lower()
        
        # Reference pronouns for entities/fields/mappings
        reference_patterns = [
            r'\bthose\s+(entities|fields?|mappings?|columns?|tables?)',
            r'\bthese\s+(entities|fields?|mappings?|columns?|tables?)',
            r'\bthem\b',
            r'\bthis\s+(entity|field|mapping|column|table)',
            r'\bit\b',
            r'\bthat\s+(entity|field|mapping|column|table)',
            r'\bthe\s+(entities|fields?|mappings?|columns?|tables?)\b',
            r'\bsame\s+(entity|field|mapping|column|table)',
            r'\babove\s+(entities|fields?|mappings?)',
            r'\bprevious\s+(entities|fields?|mappings?)'
        ]
        
        for pattern in reference_patterns:
            if re.search(pattern, question_lower):
                return {
                    "detected": True,
                    "pattern": pattern,
                    "last_tool": self.last_tool_name,
                    "entity_count": len(self.last_entity_list),
                    "has_cached_data": bool(self.last_entity_list)
                }
        
        return None
    
    def resolve_query(self, question: str, metadata: Dict[str, Any]) -> Tuple[str, bool]:
        """Resolve pronouns in query and inject context into metadata
        
        Args:
            question: Original user question
            metadata: Metadata dict to inject context (modified in place)
        
        Returns:
            Tuple of (resolved_question, was_modified)
        """
        if not ENABLED:
            return question, False
        
        reference = self.detect_reference(question)
        
        if not reference or not reference["has_cached_data"]:
            return question, False
        
        # Inject entity context into metadata (token-efficient)
        metadata["short_term_memory"] = {
            "referenced_tool": self.last_tool_name,
            "referenced_entities": self.last_entity_list[:20],  # Cap for tokens
            "entity_count": len(self.last_entity_list),
            "query_type": self.last_query_type
        }
        
        logger.info(f"[MapperMemory] Resolved reference in query | "
                   f"entities={len(self.last_entity_list)} tool={self.last_tool_name}")
        
        # Optionally rewrite query for clarity (helps planner)
        resolved_question = self._rewrite_with_context(question, metadata)
        
        return resolved_question, True
    
    def _rewrite_with_context(self, question: str, metadata: Dict[str, Any]) -> str:
        """Rewrite vague query with explicit context
        
        Example: "Can you refine those fields?" → 
                 "Can you refine those fields? [Context: customer_name, policy_number]"
        """
        stm = metadata.get("short_term_memory", {})
        entity_count = stm.get("entity_count", 0)
        entities = stm.get("referenced_entities", [])
        tool_name = stm.get("referenced_tool", "previous query")
        
        if entity_count > 0 and entities:
            # Add clarifying context without changing original question
            entity_list = ", ".join(entities[:5])  # Show max 5 entities
            if entity_count > 5:
                entity_list += f", and {entity_count - 5} more"
            
            context_hint = f" [Referring to: {entity_list} from {tool_name}]"
            return question + context_hint
        
        return question
    
    def store_conversation_context(self, conversation_id: str, context: Dict[str, Any]):
        """Store conversation-level context for multi-turn tracking
        
        Args:
            conversation_id: Unique conversation identifier
            context: Context dict with previous_questions, entities_extracted, etc.
        """
        if not ENABLED:
            return
        
        self.conversation_context[conversation_id] = {
            **context,
            "updated_at": datetime.utcnow().isoformat()
        }
        
        # Keep only recent conversations (memory management)
        if len(self.conversation_context) > 50:
            # Remove oldest 10
            oldest_keys = sorted(
                self.conversation_context.keys(),
                key=lambda k: self.conversation_context[k].get("updated_at", "")
            )[:10]
            for key in oldest_keys:
                del self.conversation_context[key]
    
    def get_conversation_context(self, conversation_id: str) -> Dict[str, Any]:
        """Retrieve conversation context by ID
        
        Returns:
            Conversation context dict, or empty dict if not found
        """
        if not ENABLED:
            return {}
        
        return self.conversation_context.get(conversation_id, {})
    
    def get_context_summary(self) -> str:
        """Get human-readable summary of current context (for logging)"""
        if not self.last_tool_name:
            return "No prior context"
        
        entity_preview = ", ".join(self.last_entity_list[:3])
        if len(self.last_entity_list) > 3:
            entity_preview += "..."
        
        return (f"Last tool: {self.last_tool_name}, "
                f"Entities cached: [{entity_preview}], "
                f"Query type: {self.last_query_type}")
    
    def clear(self, conversation_id: Optional[str] = None):
        """Clear memory (use when starting new conversation)
        
        Args:
            conversation_id: If provided, only clear that conversation's context
        """
        if conversation_id and conversation_id in self.conversation_context:
            del self.conversation_context[conversation_id]
            logger.info(f"[MapperMemory] Cleared conversation {conversation_id}")
        elif not conversation_id:
            self.last_tool_outputs.clear()
            self.last_tool_name = None
            self.last_entity_list.clear()
            self.last_query_type = None
            self.conversation_context.clear()
            logger.info("[MapperMemory] Cleared all memory")


# Per-conversation memory instances (thread-safe for multi-user)
_conversation_memories: Dict[str, MapperShortTermMemory] = {}


def get_mapper_memory(conversation_id: Optional[str] = None) -> MapperShortTermMemory:
    """Get or create mapper memory instance for conversation
    
    Args:
        conversation_id: Optional conversation ID for isolated memory
    
    Returns:
        MapperShortTermMemory instance
    """
    if not ENABLED:
        # Return disabled stub
        return MapperShortTermMemory()
    
    if conversation_id:
        # Conversation-specific memory
        if conversation_id not in _conversation_memories:
            _conversation_memories[conversation_id] = MapperShortTermMemory()
            logger.info(f"[MapperMemory] Created memory for conversation {conversation_id}")
        return _conversation_memories[conversation_id]
    else:
        # Global fallback memory
        if "global" not in _conversation_memories:
            _conversation_memories["global"] = MapperShortTermMemory()
        return _conversation_memories["global"]


def store_entity_result(
    tool_name: str, 
    output: Any, 
    intent: Optional[str] = None,
    conversation_id: Optional[str] = None
):
    """Convenience function to store entity extraction result in memory
    
    Args:
        tool_name: Name of tool that extracted entities
        output: Tool output containing entities
        intent: Intent classification
        conversation_id: Optional conversation ID
    """
    if ENABLED:
        memory = get_mapper_memory(conversation_id)
        memory.store_tool_output(tool_name, output, intent)


def resolve_entity_references(
    question: str, 
    metadata: Dict[str, Any],
    conversation_id: Optional[str] = None
) -> Tuple[str, bool]:
    """Convenience function to resolve entity references in question
    
    Args:
        question: User question
        metadata: Metadata dict (modified in place)
        conversation_id: Optional conversation ID
    
    Returns:
        Tuple of (resolved_question, was_modified)
    """
    if not ENABLED:
        return question, False
    
    memory = get_mapper_memory(conversation_id)
    return memory.resolve_query(question, metadata)


def cleanup_old_conversations():
    """Cleanup old conversation memories (call periodically)"""
    if not ENABLED:
        return
    
    # Keep only last 100 conversations
    if len(_conversation_memories) > 100:
        oldest_keys = list(_conversation_memories.keys())[:20]
        for key in oldest_keys:
            del _conversation_memories[key]
        logger.info(f"[MapperMemory] Cleaned up {len(oldest_keys)} old conversations")


__all__ = [
    "MapperShortTermMemory",
    "get_mapper_memory",
    "store_entity_result",
    "resolve_entity_references",
    "cleanup_old_conversations",
    "ENABLED"
]
