"""
Enhanced LangGraph Integration with Entity Memory Framework

Extends GraphState with persistent entity caching using checkpointers.
Replaces homegrown short_term_memory.py with configuration-driven approach.

Key Features:
- LangGraph MemorySaver/SqliteSaver for state persistence
- Generic entity caching (incidents, user_stories, wiki_pages, etc.)
- Thread-based conversation continuity
- Reference detection nodes before planning
- Cache management nodes after execution
"""

import os
import logging
from typing import TypedDict, Dict, List, Any, Optional, Annotated

# Import fallback pattern for different LangGraph/LangChain versions
try:
    from langgraph.graph import StateGraph
    from langgraph.checkpoint.memory import MemorySaver
except ImportError:
    # LangGraph not available - will be handled at runtime
    StateGraph = None
    MemorySaver = None

try:
    from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
except ImportError:
    # Fallback if messages not available
    BaseMessage = dict
    HumanMessage = dict
    AIMessage = dict

from .entity_memory_framework import (
    extract_entities,
    detect_reference,
    build_fetch_plan,
    merge_entities,
    ENABLED as ENTITY_MEMORY_ENABLED
)

logger = logging.getLogger("agentic_orchestrator_auto.langgraph_enhanced")

# Feature flag
USE_ENHANCED_GRAPH = os.getenv("USE_ENHANCED_LANGGRAPH", "0").lower() in ("1", "true", "yes", "on")


# ==================== ENHANCED STATE SCHEMA ====================

class EnhancedGraphState(TypedDict, total=False):
    """
    LangGraph state schema with entity memory support.
    
    Backward compatible with existing GraphState fields.
    """
    # Core orchestration (existing fields)
    question: str
    prompt: str
    metadata: Dict[str, Any]
    plan: List[Dict[str, Any]]
    plan_source: str
    current_step: int
    tool_outputs: Dict[str, Any]
    errors: List[str]
    traces: List[Dict[str, Any]]
    clarification_needed: bool
    clarification_details: Any
    done: bool
    adaptive_cycle: int
    incidents: List[str]  # Legacy field (keep for compatibility)
    observability_injected: bool
    graph_execution_used: bool
    route: str
    
    # ✅ NEW: Entity memory fields
    messages: list                                         # Conversation history (stored as simple list)
    cached_entities: Dict[str, List[str]]                  # {"incidents": [...], "user_stories": [...]}
    last_tool_outputs: Dict[str, Any]                      # Most recent tool execution results
    reference_context: Optional[Dict[str, Any]]            # Active reference info
    skip_planner: bool                                     # Flag to bypass planner when reference detected
    entity_memory_active: bool                             # Framework enabled for this request


# ==================== ENTITY MEMORY NODES ====================

def detect_reference_node(state: EnhancedGraphState) -> Dict[str, Any]:
    """
    Check if user question references cached entities.
    Runs BEFORE planning to intercept reference queries.
    
    If reference detected:
    - Builds direct fetch plan
    - Sets skip_planner=True
    - Stores reference_context
    
    Returns:
        Updates for state (reference_context, skip_planner, plan)
    """
    if not ENTITY_MEMORY_ENABLED or not state.get("entity_memory_active"):
        return {"skip_planner": False, "reference_context": None}
    
    messages = state.get("messages", [])
    if not messages:
        logger.debug("[RefDetect] No messages in state")
        return {"skip_planner": False, "reference_context": None}
    
    # Get last user message
    question = messages[-1].content if hasattr(messages[-1], 'content') else str(messages[-1])
    cached_entities = state.get("cached_entities", {})
    
    if not cached_entities:
        logger.debug("[RefDetect] No cached entities")
        return {"skip_planner": False, "reference_context": None}
    
    # Generic reference detection
    ref_info = detect_reference(question, cached_entities)
    
    if ref_info:
        entity_type = ref_info.get("entity_type")
        entity_count = ref_info.get("count", 0)
        pattern = ref_info.get("pattern")
        
        logger.info(f"[RefDetect] ✅ Reference detected | type={entity_type} count={entity_count} pattern='{pattern}'")
        
        # Build fetch plan (limit to 5 for performance)
        fetch_plan = build_fetch_plan(ref_info, limit=5)
        
        logger.info(f"[RefDetect] Built fetch plan | steps={len(fetch_plan)}")
        
        return {
            "reference_context": ref_info,
            "plan": fetch_plan,      # Override planner's plan
            "skip_planner": True,    # Skip planning phase
            "plan_source": "entity_memory_reference",
            "current_step": 0        # Reset step counter
        }
    
    logger.debug("[RefDetect] No reference detected")
    return {"skip_planner": False, "reference_context": None}


def cache_entities_node(state: EnhancedGraphState) -> Dict[str, Any]:
    """
    Extract entities from tool outputs and update cache.
    Runs AFTER tool execution to capture new entities.
    
    Returns:
        Updates for state (cached_entities)
    """
    if not ENTITY_MEMORY_ENABLED or not state.get("entity_memory_active"):
        return {}
    
    # Get most recent tool outputs
    tool_outputs = state.get("last_tool_outputs", {}) or state.get("tool_outputs", {})
    
    if not tool_outputs:
        logger.debug("[CacheEntities] No tool outputs to process")
        return {}
    
    existing_cache = state.get("cached_entities", {})
    
    # Generic extraction for ALL entity types
    new_entities = extract_entities(tool_outputs)
    
    if new_entities:
        # Merge with existing, maintaining limits
        updated_cache = merge_entities(existing_cache, new_entities, max_per_type=20)
        
        # Log what was extracted
        for entity_type, entities in new_entities.items():
            logger.info(f"[CacheEntities] ✅ Extracted {len(entities)} {entity_type}")
        
        return {"cached_entities": updated_cache}
    
    logger.debug("[CacheEntities] No new entities extracted")
    return {}


# ==================== GRAPH BUILDER ====================

def build_enhanced_graph(
    planner_node_func,
    executor_node_func,
    postprocess_node_func,
    done_node_func,
    use_checkpointer: bool = True
):
    """
    Build enhanced LangGraph with entity memory support.
    
    Args:
        planner_node_func: Existing planner node function
        executor_node_func: Existing executor node function
        postprocess_node_func: Existing postprocess node function
        done_node_func: Existing done node function
        use_checkpointer: Enable persistent state (MemorySaver)
    
    Returns:
        Compiled LangGraph app with checkpointer
    """
    # Build graph
    if StateGraph is None:
        raise RuntimeError("LangGraph not available - install langgraph package")
    
    workflow = StateGraph(EnhancedGraphState)
    
    # Add entity memory nodes (NEW)
    workflow.add_node("detect_reference", detect_reference_node)
    workflow.add_node("cache_entities", cache_entities_node)
    
    # Add existing nodes (wrapped for compatibility)
    workflow.add_node("planner", planner_node_func)
    workflow.add_node("executor", executor_node_func)
    workflow.add_node("postprocess", postprocess_node_func)
    workflow.add_node("done", done_node_func)
    
    # Define flow
    workflow.set_entry_point("detect_reference")
    
    # Conditional: Skip planner if reference detected
    def should_skip_planner(state: EnhancedGraphState) -> str:
        if state.get("skip_planner"):
            logger.info("[Graph] Bypassing planner - using reference-based plan")
            return "executor"  # Go straight to execution with pre-built plan
        return "planner"       # Normal flow
    
    workflow.add_conditional_edges("detect_reference", should_skip_planner)
    
    # Normal flow edges
    workflow.add_edge("planner", "executor")
    workflow.add_edge("executor", "cache_entities")  # Cache after execution
    
    # Route to postprocess or done
    def should_continue(state: EnhancedGraphState) -> str:
        cs = state.get("current_step", 0)
        total = len(state.get("plan", []))
        if cs >= total:
            return "postprocess"
        return "executor"
    
    workflow.add_conditional_edges("cache_entities", should_continue)
    workflow.add_edge("postprocess", "done")
    
    # Compile with checkpointer
    if use_checkpointer and ENTITY_MEMORY_ENABLED:
        if MemorySaver is None:
            logger.warning("MemorySaver not available - compiling without checkpointer")
            app = workflow.compile()
        else:
            memory = MemorySaver()  # In-memory for development
            # Production: use SqliteSaver
            # from langgraph.checkpoint.sqlite import SqliteSaver
            # memory = SqliteSaver.from_conn_string("checkpoints.db")
            
            app = workflow.compile(checkpointer=memory)
        logger.info("[Graph] ✅ Compiled with MemorySaver checkpointer")
    else:
        app = workflow.compile()
        logger.info("[Graph] Compiled WITHOUT checkpointer (stateless)")
    
    return app


# ==================== HELPER FUNCTIONS ====================

def build_thread_id(username: str, session_id: str) -> str:
    """
    Build thread_id for state persistence.
    
    Format: username_sessionid
    Example: "john.doe@company.com_abc123"
    """
    return f"{username}_{session_id}"


def prepare_initial_state(
    question: str,
    username: str,
    metadata: Dict[str, Any],
    existing_plan: Optional[List[Dict[str, Any]]] = None,
    enable_entity_memory: bool = True
) -> EnhancedGraphState:
    """
    Prepare initial state for graph execution.
    
    Args:
        question: User's question
        username: Current user
        metadata: Request metadata
        existing_plan: Pre-built plan (from catalog prompt, recipe, etc.)
        enable_entity_memory: Activate entity memory for this request
    
    Returns:
        Initial state dict
    """
    return {
        # Core fields
        "question": question,
        "metadata": metadata,
        "plan": existing_plan or [],
        "current_step": 0,
        "tool_outputs": {},
        "errors": [],
        "traces": [],
        "done": False,
        "adaptive_cycle": 0,
        "observability_injected": False,
        "graph_execution_used": True,
        
        # Entity memory fields
        "messages": [HumanMessage(content=question)],
        "cached_entities": {},      # Will be populated from checkpointer if thread exists
        "last_tool_outputs": {},
        "reference_context": None,
        "skip_planner": False,
        "entity_memory_active": enable_entity_memory and ENTITY_MEMORY_ENABLED,
    }


def extract_response_from_state(state: EnhancedGraphState) -> Dict[str, Any]:
    """
    Extract final response from graph state.
    
    Returns:
        Response dict compatible with existing orchestrator format
    """
    return {
        "answer": state.get("answer", ""),
        "context": state.get("context", {}),
        "tool_outputs": state.get("tool_outputs", {}),
        "plan": state.get("plan", []),
        "plan_source": state.get("plan_source", "unknown"),
        "errors": state.get("errors", []),
        "traces": state.get("traces", []),
        "cached_entities": state.get("cached_entities", {}),  # Expose to frontend for debugging
        "reference_resolved": bool(state.get("reference_context")),
    }


# ==================== BACKWARD COMPATIBILITY ====================

def migrate_legacy_state_to_enhanced(legacy_state: Dict[str, Any]) -> EnhancedGraphState:
    """
    Migrate legacy GraphState to EnhancedGraphState.
    
    Ensures backward compatibility with existing orchestrator code.
    """
    enhanced = dict(legacy_state)  # Copy all existing fields
    
    # Add missing entity memory fields with defaults
    if "messages" not in enhanced:
        question = legacy_state.get("question", "")
        enhanced["messages"] = [HumanMessage(content=question)] if question else []
    
    if "cached_entities" not in enhanced:
        enhanced["cached_entities"] = {}
    
    if "last_tool_outputs" not in enhanced:
        enhanced["last_tool_outputs"] = legacy_state.get("tool_outputs", {})
    
    if "reference_context" not in enhanced:
        enhanced["reference_context"] = None
    
    if "skip_planner" not in enhanced:
        enhanced["skip_planner"] = False
    
    if "entity_memory_active" not in enhanced:
        enhanced["entity_memory_active"] = ENTITY_MEMORY_ENABLED
    
    return enhanced  # type: ignore[return-value]


__all__ = [
    "EnhancedGraphState",
    "detect_reference_node",
    "cache_entities_node",
    "build_enhanced_graph",
    "build_thread_id",
    "prepare_initial_state",
    "extract_response_from_state",
    "migrate_legacy_state_to_enhanced",
    "USE_ENHANCED_GRAPH",
]
