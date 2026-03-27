"""Short-Term Memory: Coreference Resolution & Context Tracking

ROLLBACK: Set environment variable ENABLE_SHORT_TERM_MEMORY=0 to disable

This module provides:
1. Pronoun resolution ("those incidents" → actual incident list)
2. Tool output caching (lightweight - just incident numbers)
3. Entity tracking across conversation turns
4. Context-aware query rewriting

Token Optimization:
- Does NOT send full tool outputs to LLM
- Only sends incident numbers and entity references
- Minimal metadata additions (< 50 tokens per turn)
"""

import logging
import re
import os
from typing import Dict, List, Any, Optional, Tuple

logger = logging.getLogger("agentic_orchestrator_auto.short_term_memory")

# Feature flag for easy rollback
ENABLED = os.getenv("ENABLE_SHORT_TERM_MEMORY", "1").lower() in ("1", "true", "yes", "on")


class ShortTermMemory:
    """Lightweight context tracker for resolving references across conversation turns"""
    
    def __init__(self):
        self.last_tool_outputs: Dict[str, Any] = {}
        self.last_tool_name: Optional[str] = None
        self.last_incident_list: List[str] = []
        self.last_query_type: Optional[str] = None
        logger.info(f"[ShortTermMemory] Initialized (enabled={ENABLED})")
    
    def store_tool_output(self, tool_name: str, output: Any, intent: Optional[str] = None):
        """Store last tool output - only keeps incident references for token efficiency
        
        Args:
            tool_name: Name of the tool executed
            output: Tool output (we extract only incident numbers)
            intent: Intent classification for context
        """
        if not ENABLED:
            return
        
        self.last_tool_name = tool_name
        self.last_query_type = intent
        
        # Extract incident numbers from output (token-efficient)
        incident_refs = self._extract_incidents_from_output(output)
        if incident_refs:
            self.last_incident_list = incident_refs
            logger.info(f"[ShortTermMemory] Stored {len(incident_refs)} incidents from {tool_name}")
        
        # Store lightweight metadata only
        self.last_tool_outputs[tool_name] = {
            "incident_count": len(incident_refs),
            "incidents": incident_refs[:20],  # Cap at 20 for token efficiency
            "has_data": bool(output)
        }
        
        # ═══════════════════════════════════════════════════════════════════════
        # DRILL-DOWN DATA: Store additional fields for filtering queries
        # ═══════════════════════════════════════════════════════════════════════
        # For bulk analysis tools, store categorized data to enable efficient
        # drill-down queries without re-running expensive analysis
        if tool_name == 'analyze_bulk_work_notes' and isinstance(output, dict):
            # Store drill-down fields from bulk analysis
            drill_down_data = {}
            if 'incidents_with_doc_gaps' in output:
                drill_down_data['incidents_with_doc_gaps'] = output['incidents_with_doc_gaps']
            if 'incidents_by_category' in output:
                drill_down_data['incidents_by_category'] = output['incidents_by_category']
            if 'sample_incidents' in output:
                drill_down_data['sample_incidents'] = output['sample_incidents']
            
            # Merge into existing entry
            if drill_down_data:
                self.last_tool_outputs[tool_name].update(drill_down_data)
                logger.info(f"[ShortTermMemory] Stored drill-down data: {list(drill_down_data.keys())}")
    
    def _extract_incidents_from_output(self, output: Any) -> List[str]:
        """Extract incident numbers from tool output
        
        Handles various output formats:
        - {"incidents": [{"number": "INC..."}, ...]}
        - {"by_priority": {...}, "sample": [{"number": "INC..."}, ...]}
        - ["INC0010001", "INC0010002"]
        """
        incidents = []
        
        if isinstance(output, dict):
            # Check for "incidents" key
            if "incidents" in output:
                items = output["incidents"]
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict) and "number" in item:
                            incidents.append(item["number"])
                        elif isinstance(item, str) and item.startswith("INC"):
                            incidents.append(item)
            
            # Check for "results" key (run_incident_query format)
            if "results" in output:
                items = output["results"]
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict) and "number" in item:
                            incidents.append(item["number"])
            
            # Check for "sample" key (backlog overview format)
            if "sample" in output:
                items = output["sample"]
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict) and "number" in item:
                            incidents.append(item["number"])
        
        elif isinstance(output, list):
            for item in output:
                if isinstance(item, dict) and "number" in item:
                    incidents.append(item["number"])
                elif isinstance(item, str) and item.startswith("INC"):
                    incidents.append(item)
        
        return incidents
    
    def detect_reference(self, question: str) -> Optional[Dict[str, Any]]:
        """Detect if question references previous context
        
        Returns:
            Dict with reference info if detected, None otherwise
        """
        if not ENABLED or not question:
            return None
        
        question_lower = question.lower()
        
        # Reference pronouns
        reference_patterns = [
            r'\bthose\s+(incidents?|tickets?|issues?)',
            r'\bthese\s+(incidents?|tickets?|issues?)',
            r'\bthem\b',
            r'\bthis\s+(incident|ticket|issue)',
            r'\bit\b',
            r'\bthat\s+(incident|ticket|issue)',
            r'\bthe\s+(incidents?|tickets?|issues?)\b'
        ]
        
        for pattern in reference_patterns:
            if re.search(pattern, question_lower):
                return {
                    "detected": True,
                    "pattern": pattern,
                    "last_tool": self.last_tool_name,
                    "incident_count": len(self.last_incident_list),
                    "has_cached_data": bool(self.last_incident_list)
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
        
        # Inject incident context into metadata (token-efficient)
        metadata["short_term_memory"] = {
            "referenced_tool": self.last_tool_name,
            "referenced_incidents": self.last_incident_list[:20],  # Cap for tokens
            "incident_count": len(self.last_incident_list),
            "query_type": self.last_query_type
        }
        
        # Add drill-down data if available (for efficient filtering queries)
        if self.last_tool_name and self.last_tool_name in self.last_tool_outputs:
            last_output = self.last_tool_outputs[self.last_tool_name]
            # Only include drill-down fields (not full output)
            drill_down_keys = ['incidents_with_doc_gaps', 'incidents_by_category', 'sample_incidents']
            for key in drill_down_keys:
                if key in last_output:
                    metadata["short_term_memory"][key] = last_output[key]
        
        logger.info(f"[ShortTermMemory] Resolved reference in query | "
                   f"incidents={len(self.last_incident_list)} tool={self.last_tool_name}")
        
        # Optionally rewrite query for clarity (helps planner)
        resolved_question = self._rewrite_with_context(question, metadata)
        
        return resolved_question, True
    
    def _rewrite_with_context(self, question: str, metadata: Dict[str, Any]) -> str:
        """Rewrite vague query with explicit context
        
        Example: "Can you list those incidents?" → 
                 "Can you list those incidents? [Context: 13 incidents from backlog]"
        """
        stm = metadata.get("short_term_memory", {})
        incident_count = stm.get("incident_count", 0)
        tool_name = stm.get("referenced_tool", "previous query")
        
        if incident_count > 0:
            # Add clarifying context without changing original question
            context_hint = f" [Referring to {incident_count} incidents from {tool_name}]"
            return question + context_hint
        
        return question
    
    def get_context_summary(self) -> str:
        """Get human-readable summary of current context (for logging)"""
        if not self.last_tool_name:
            return "No prior context"
        
        return (f"Last tool: {self.last_tool_name}, "
                f"Incidents cached: {len(self.last_incident_list)}, "
                f"Query type: {self.last_query_type}")
    
    def get_drill_down_data(self) -> Optional[Dict[str, Any]]:
        """Get drill-down data from last tool execution for efficient filtering
        
        Returns:
            Dict containing:
            - tool_name: Name of last tool
            - incidents: List of incident numbers
            - incidents_with_doc_gaps: (if available) List of incidents with documentation gaps
            - incidents_by_category: (if available) Map of category -> incidents
            - sample_incidents: (if available) Sample incidents from analysis
            
            Returns None if no relevant drill-down data is available
        """
        if not self.last_tool_name or self.last_tool_name not in self.last_tool_outputs:
            return None
        
        last_output = self.last_tool_outputs[self.last_tool_name]
        
        # Check if we have drill-down data (only from bulk analysis tools)
        has_drill_down = any(key in last_output for key in 
                            ['incidents_with_doc_gaps', 'incidents_by_category', 'sample_incidents'])
        
        if not has_drill_down:
            return None
        
        result = {
            "tool_name": self.last_tool_name,
            "incidents": self.last_incident_list,
            "incident_count": len(self.last_incident_list)
        }
        
        # Add available drill-down fields
        drill_down_keys = ['incidents_with_doc_gaps', 'incidents_by_category', 'sample_incidents']
        for key in drill_down_keys:
            if key in last_output:
                result[key] = last_output[key]
        
        return result
    
    def clear(self):
        """Clear memory (use when starting new conversation)"""
        self.last_tool_outputs.clear()
        self.last_tool_name = None
        self.last_incident_list.clear()
        self.last_query_type = None
        logger.info("[ShortTermMemory] Cleared")


# Global singleton instance (lightweight)
_global_memory: Optional[ShortTermMemory] = None


def get_short_term_memory() -> ShortTermMemory:
    """Get or create global short-term memory instance"""
    global _global_memory
    if _global_memory is None:
        _global_memory = ShortTermMemory()
    return _global_memory


def store_tool_result(tool_name: str, output: Any, intent: Optional[str] = None):
    """Convenience function to store tool result in memory"""
    if ENABLED:
        memory = get_short_term_memory()
        memory.store_tool_output(tool_name, output, intent)


def resolve_question_references(question: str, metadata: Dict[str, Any]) -> Tuple[str, bool]:
    """Convenience function to resolve references in question
    
    Returns:
        Tuple of (resolved_question, was_modified)
    """
    if not ENABLED:
        return question, False
    
    memory = get_short_term_memory()
    return memory.resolve_query(question, metadata)


__all__ = [
    "ShortTermMemory",
    "get_short_term_memory", 
    "store_tool_result",
    "resolve_question_references",
    "ENABLED"
]
