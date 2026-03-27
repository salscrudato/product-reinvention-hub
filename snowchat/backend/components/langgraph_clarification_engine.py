"""
LangGraph-Based Clarification Framework

Redesigned to use LangGraph's state management for robust, persistent multi-turn clarification.

Architecture:
- Uses StateGraph for workflow management
- TypedDict for type-safe state schema
- Checkpointing for persistence across restarts
- Nodes: analyze → clarify → wait_for_response → process → execute
- Conditional edges based on clarification needs

Author: DevCopilot Enhancement Framework  
Date: January 20, 2026
"""

import logging
import os
from typing import TypedDict, List, Dict, Optional, Any, Literal, Annotated
from datetime import datetime
from enum import Enum
import json

try:
    from langgraph.graph import StateGraph, END
    LANGGRAPH_AVAILABLE = True
except ImportError:
    LANGGRAPH_AVAILABLE = False
    StateGraph = None
    END = "END"

try:
    from langgraph.checkpoint.sqlite import SqliteSaver
except (ImportError, AttributeError):
    SqliteSaver = None  # type: ignore

try:
    from langgraph.checkpoint.memory import MemorySaver  # type: ignore
except (ImportError, AttributeError):
    MemorySaver = None  # type: ignore

logger = logging.getLogger("agentic_orchestrator_auto").getChild("langgraph_clarification")
logger.setLevel(logging.INFO)


# ============================================================================
# STATE SCHEMA - Type-safe state definition
# ============================================================================

class ClarificationState(TypedDict, total=False):
    """LangGraph state schema for clarification workflow.
    
    Using TypedDict ensures type safety and clear state structure.
    """
    # Input from user
    original_question: str
    detected_intent: Optional[str]
    extracted_entities: Dict[str, Any]
    available_tools: List[str]
    context_messages: List[Dict[str, Any]]
    planner_confidence: float
    username: Optional[str]
    
    # Analysis results
    needs_clarification: bool
    triggers: List[str]
    missing_params: List[str]
    ambiguous_entities: List[Dict[str, Any]]
    suggested_clarifications: List[str]
    analysis_reason: str
    
    # Clarification request
    clarification_text: str
    questions: List[Dict[str, Any]]
    priority: str
    
    # User responses
    user_responses: Dict[str, Any]
    response_timestamp: Optional[str]
    
    # Enriched output
    enriched_question: str
    enriched_entities: Dict[str, Any]
    enriched_metadata: Dict[str, Any]
    ready_to_plan: bool
    
    # Workflow control
    current_node: str
    next_action: Literal["clarify", "execute", "cancel", "error"]
    error_message: Optional[str]
    cancelled: bool
    
    # Metadata
    session_id: str
    created_at: str
    updated_at: str
    workflow_version: str


# ============================================================================
# CLARIFICATION NODES - LangGraph workflow nodes
# ============================================================================

def analyze_feasibility_node(state: ClarificationState) -> ClarificationState:
    """
    LangGraph Node: Analyze if clarification is needed.
    
    This replaces analyze_plan_feasibility() from the dict-based approach.
    """
    logger.info(
        f"[CLARIFY_NODE:analyze] Processing | intent={state.get('detected_intent')} "
        f"session={state.get('session_id')}"
    )
    
    question = state.get('original_question', '')
    intent = state.get('detected_intent')
    entities = state.get('extracted_entities', {})
    tools = state.get('available_tools', [])
    context = state.get('context_messages', [])
    confidence = state.get('planner_confidence', 1.0)
    
    # Import the analysis logic (can refactor this into smaller functions)
    from .general_clarification_engine import GeneralClarificationEngine
    engine = GeneralClarificationEngine()
    
    analysis = engine.analyze_plan_feasibility(
        question, intent, entities, tools, context, confidence
    )
    
    # Update state with analysis results
    state['needs_clarification'] = analysis['needs_clarification']
    state['triggers'] = analysis['triggers']
    state['missing_params'] = analysis['missing_params']
    state['ambiguous_entities'] = analysis['ambiguous_entities']
    state['suggested_clarifications'] = analysis['suggested_clarifications']
    state['analysis_reason'] = analysis['reason']
    state['current_node'] = 'analyze_feasibility'
    state['updated_at'] = datetime.now().isoformat()
    
    # Determine next action
    if analysis['needs_clarification']:
        state['next_action'] = 'clarify'
    else:
        state['next_action'] = 'execute'
        state['ready_to_plan'] = True
    
    logger.info(
        f"[CLARIFY_NODE:analyze] Complete | needs_clarification={state['needs_clarification']} "
        f"next_action={state['next_action']}"
    )
    
    return state


def generate_clarification_node(state: ClarificationState) -> ClarificationState:
    """
    LangGraph Node: Generate clarification questions.
    
    This replaces generate_clarification_request() from dict-based approach.
    """
    logger.info(f"[CLARIFY_NODE:generate] Generating questions | session={state.get('session_id')}")
    
    from .general_clarification_engine import GeneralClarificationEngine
    engine = GeneralClarificationEngine()
    
    # Build analysis dict from state
    analysis = {
        'needs_clarification': state.get('needs_clarification', False),
        'triggers': state.get('triggers', []),
        'missing_params': state.get('missing_params', []),
        'ambiguous_entities': state.get('ambiguous_entities', []),
        'suggested_clarifications': state.get('suggested_clarifications', []),
        'reason': state.get('analysis_reason', '')
    }
    
    clarification = engine.generate_clarification_request(
        state.get('original_question', ''),
        state.get('detected_intent') or 'unknown',
        analysis,
        state.get('context_messages', [])
    )
    
    # Update state with clarification
    state['clarification_text'] = clarification['clarification_text']
    state['questions'] = clarification['questions']
    state['priority'] = clarification['priority']
    state['current_node'] = 'generate_clarification'
    state['updated_at'] = datetime.now().isoformat()
    
    # Next: wait for user response (handled by orchestrator)
    state['next_action'] = 'clarify'  # Signal to return to user
    
    logger.info(
        f"[CLARIFY_NODE:generate] Complete | questions={len(state['questions'])} "
        f"priority={state['priority']}"
    )
    
    return state


def process_response_node(state: ClarificationState) -> ClarificationState:
    """
    LangGraph Node: Process user's clarification responses.
    
    This replaces process_clarification_responses() from dict-based approach.
    """
    logger.info(f"[CLARIFY_NODE:process] Processing responses | session={state.get('session_id')}")
    
    responses = state.get('user_responses', {})
    questions = state.get('questions', [])
    
    enriched_entities = {}
    enriched_metadata = {}
    clarification_summary = []
    
    # Process each response (same logic as before)
    for question in questions:
        q_id = question['id']
        if q_id not in responses:
            if question.get('required'):
                state['next_action'] = 'error'
                state['error_message'] = f"Required response missing: {question['question']}"
                state['ready_to_plan'] = False
                return state
            continue
        
        user_response = responses[q_id]
        q_type = question['type']
        
        # Extract structured data from response
        if q_type == 'parameter_value':
            param_name = q_id.replace("param_", "")
            enriched_entities[param_name] = user_response
            clarification_summary.append(f"{param_name}={user_response}")
        
        elif q_type == 'entity_selection':
            entity_type = q_id.replace("entity_", "")
            enriched_entities[entity_type] = user_response
            clarification_summary.append(f"Selected {entity_type}: {user_response}")
        
        elif q_type == 'execution_path':
            enriched_metadata['execution_path'] = user_response
            clarification_summary.append(f"Approach: {user_response}")
        
        elif q_type == 'confirmation':
            confirmed = user_response.lower() in ['yes', '1', 'proceed', 'confirm', 'true']
            enriched_metadata['user_confirmed'] = confirmed
            clarification_summary.append(f"Confirmed: {confirmed}")
            
            if not confirmed:
                state['next_action'] = 'cancel'
                state['cancelled'] = True
                state['error_message'] = 'User cancelled operation'
                state['ready_to_plan'] = False
                return state
    
    # Build enriched question
    enriched_question = state.get('original_question', '')
    if clarification_summary:
        enriched_question += f" [Clarified: {'; '.join(clarification_summary)}]"
    
    # Update state
    state['enriched_question'] = enriched_question
    state['enriched_entities'] = enriched_entities
    state['enriched_metadata'] = enriched_metadata
    state['ready_to_plan'] = True
    state['next_action'] = 'execute'
    state['current_node'] = 'process_response'
    state['updated_at'] = datetime.now().isoformat()
    state['response_timestamp'] = datetime.now().isoformat()
    
    logger.info(
        f"[CLARIFY_NODE:process] Complete | entities={list(enriched_entities.keys())} "
        f"ready={state['ready_to_plan']}"
    )
    
    return state


def should_clarify(state: ClarificationState) -> Literal["clarify", "execute"]:
    """
    Conditional edge: Route based on whether clarification is needed.
    """
    if state.get('next_action') == 'clarify':
        return "clarify"
    elif state.get('next_action') == 'execute':
        return "execute"
    else:
        return "execute"  # Default to execute


def should_continue_after_response(state: ClarificationState) -> Literal["execute", "cancel", "error"]:
    """
    Conditional edge: Route after processing response.
    """
    next_action = state.get('next_action', 'execute')
    # Only return valid continuation values
    if next_action == 'cancel':
        return 'cancel'
    elif next_action == 'error':
        return 'error'
    else:
        return 'execute'


# ============================================================================
# CLARIFICATION GRAPH BUILDER
# ============================================================================

def create_clarification_graph(
    checkpointer: Optional[Any] = None,
    use_sqlite: bool = True
):
    """
    Create LangGraph-based clarification workflow.
    
    Args:
        checkpointer: Optional checkpointer (SqliteSaver, MemorySaver, etc.)
        use_sqlite: If True and no checkpointer provided, create SqliteSaver
    
    Returns:
        Compiled StateGraph ready for execution
    """
    if not LANGGRAPH_AVAILABLE:
        raise ImportError("LangGraph not available. Install with: pip install langgraph")
    
    # Create checkpointer if not provided
    if checkpointer is None and use_sqlite:
        if SqliteSaver is not None:
            db_path = os.path.join(
                os.path.dirname(__file__), 
                '..', 
                'clarification_checkpoints.sqlite'
            )
            checkpointer = SqliteSaver.from_conn_string(db_path)
            logger.info(f"[CLARIFY_GRAPH] Using SQLite checkpointer: {db_path}")
        elif MemorySaver is not None:
            checkpointer = MemorySaver()
            logger.info("[CLARIFY_GRAPH] Using in-memory checkpointer (SqliteSaver not available)")
        else:
            logger.warning("[CLARIFY_GRAPH] No checkpointer available")
    elif checkpointer is None:
        if MemorySaver is not None:
            checkpointer = MemorySaver()
            logger.info("[CLARIFY_GRAPH] Using in-memory checkpointer")
    
    # Create state graph
    if StateGraph is None:
        raise ImportError("StateGraph not available. Install with: pip install langgraph")
    
    workflow = StateGraph(ClarificationState)
    
    # Add nodes
    workflow.add_node("analyze_feasibility", analyze_feasibility_node)
    workflow.add_node("generate_clarification", generate_clarification_node)
    workflow.add_node("process_response", process_response_node)
    
    # Set entry point
    workflow.set_entry_point("analyze_feasibility")
    
    # Add conditional edges
    workflow.add_conditional_edges(
        "analyze_feasibility",
        should_clarify,
        {
            "clarify": "generate_clarification",
            "execute": END
        }
    )
    
    # After generating clarification, workflow pauses (returns to user)
    workflow.add_edge("generate_clarification", END)
    
    # When user responds, workflow resumes at process_response
    workflow.add_conditional_edges(
        "process_response",
        should_continue_after_response,
        {
            "execute": END,
            "cancel": END,
            "error": END
        }
    )
    
    # Compile with checkpointer
    compiled = workflow.compile(checkpointer=checkpointer)
    
    logger.info("[CLARIFY_GRAPH] Workflow compiled successfully")
    
    return compiled


# ============================================================================
# STATEFUL CLARIFICATION MANAGER
# ============================================================================

class StatefulClarificationManager:
    """
    Manages clarification workflow using LangGraph's state management.
    
    This replaces the dictionary-based GeneralClarificationEngine.
    """
    
    def __init__(self, use_sqlite: bool = True):
        """
        Initialize manager with LangGraph workflow.
        
        Args:
            use_sqlite: Use SQLite for persistence (True) or in-memory (False)
        """
        self.graph = create_clarification_graph(use_sqlite=use_sqlite)
        logger.info("[CLARIFY_MGR] Initialized with LangGraph workflow")
    
    def start_clarification_session(
        self,
        question: str,
        detected_intent: Optional[str],
        extracted_entities: Dict[str, Any],
        available_tools: List[str],
        context_messages: List[Dict[str, Any]],
        planner_confidence: float = 1.0,
        username: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Start a new clarification session.
        
        Returns:
            {
                "session_id": str,
                "needs_clarification": bool,
                "clarification": Optional[Dict],  # If needs clarification
                "ready_to_plan": bool  # If no clarification needed
            }
        """
        # Generate unique session ID
        session_id = f"clarify_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
        
        # Create initial state
        initial_state: ClarificationState = {
            'original_question': question,
            'detected_intent': detected_intent,
            'extracted_entities': extracted_entities,
            'available_tools': available_tools,
            'context_messages': context_messages,
            'planner_confidence': planner_confidence,
            'username': username,
            'session_id': session_id,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'workflow_version': '1.0',
            'needs_clarification': False,
            'ready_to_plan': False,
            'cancelled': False,
            'triggers': [],
            'missing_params': [],
            'ambiguous_entities': [],
            'suggested_clarifications': [],
            'questions': [],
            'user_responses': {},
            'enriched_entities': {},
            'enriched_metadata': {},
            'current_node': 'init',
            'next_action': 'clarify'
        }
        
        # Run workflow with thread_id (enables checkpointing)
        config = {"configurable": {"thread_id": session_id}}  # type: ignore
        
        logger.info(f"[CLARIFY_MGR] Starting session | session_id={session_id}")
        
        # Execute workflow (will stop at first END or clarification point)
        final_state = self.graph.invoke(initial_state, config)  # type: ignore
        
        # Build response
        if final_state['needs_clarification']:
            return {
                "session_id": session_id,
                "needs_clarification": True,
                "clarification": {
                    "clarification_text": final_state['clarification_text'],
                    "questions": final_state['questions'],
                    "priority": final_state['priority'],
                    "intent": detected_intent
                },
                "ready_to_plan": False
            }
        else:
            return {
                "session_id": session_id,
                "needs_clarification": False,
                "ready_to_plan": True,
                "enriched_question": final_state['original_question'],
                "enriched_entities": extracted_entities,
                "enriched_metadata": {}
            }
    
    def submit_clarification_response(
        self,
        session_id: str,
        responses: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Submit user responses to clarification questions.
        
        Args:
            session_id: The clarification session ID
            responses: Dict mapping question IDs to user responses
        
        Returns:
            {
                "ready_to_plan": bool,
                "enriched_question": str,
                "enriched_entities": Dict,
                "enriched_metadata": Dict,
                "cancelled": bool,
                "error": Optional[str]
            }
        """
        config = {"configurable": {"thread_id": session_id}}  # type: ignore
        
        logger.info(f"[CLARIFY_MGR] Submitting responses | session_id={session_id}")
        
        # Get current state from checkpoint
        try:
            current_state = self.graph.get_state(config)  # type: ignore
            
            if current_state is None:
                return {
                    "ready_to_plan": False,
                    "error": "Session not found or expired",
                    "cancelled": False
                }
            
            # Update state with responses
            state_values = current_state.values
            state_values['user_responses'] = responses
            state_values['current_node'] = 'awaiting_processing'
            
            # Resume workflow at process_response node
            final_state = self.graph.invoke(
                state_values,  # type: ignore
                config,  # type: ignore
                input_keys=["user_responses"]  # Only update responses
            )
            
            # Build response
            return {
                "ready_to_plan": final_state.get('ready_to_plan', False),
                "enriched_question": final_state.get('enriched_question', ''),
                "enriched_entities": final_state.get('enriched_entities', {}),
                "enriched_metadata": final_state.get('enriched_metadata', {}),
                "cancelled": final_state.get('cancelled', False),
                "error": final_state.get('error_message')
            }
            
        except Exception as e:
            logger.error(f"[CLARIFY_MGR] Error processing response: {e}", exc_info=True)
            return {
                "ready_to_plan": False,
                "error": str(e),
                "cancelled": False
            }
    
    def get_session_state(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve current state of a clarification session.
        
        Useful for debugging and monitoring.
        """
        config = {"configurable": {"thread_id": session_id}}  # type: ignore
        try:
            state = self.graph.get_state(config)  # type: ignore
            if state:
                return dict(state.values)
            return None
        except Exception as e:
            logger.error(f"[CLARIFY_MGR] Error getting state: {e}")
            return None
    
    def cancel_session(self, session_id: str) -> bool:
        """
        Cancel an active clarification session.
        """
        config = {"configurable": {"thread_id": session_id}}  # type: ignore
        try:
            current_state = self.graph.get_state(config)  # type: ignore
            if current_state:
                state_values = current_state.values
                state_values['cancelled'] = True
                state_values['next_action'] = 'cancel'
                # Update checkpoint
                self.graph.update_state(config, state_values)  # type: ignore
                logger.info(f"[CLARIFY_MGR] Session cancelled | session_id={session_id}")
                return True
            return False
        except Exception as e:
            logger.error(f"[CLARIFY_MGR] Error cancelling session: {e}")
            return False


# ============================================================================
# CONVENIENCE FUNCTIONS (Compatible with old API)
# ============================================================================

_global_manager: Optional[StatefulClarificationManager] = None

def get_clarification_manager(use_sqlite: bool = True) -> StatefulClarificationManager:
    """Get or create global clarification manager."""
    global _global_manager
    if _global_manager is None:
        _global_manager = StatefulClarificationManager(use_sqlite=use_sqlite)
    return _global_manager


def should_request_clarification_stateful(
    question: str,
    intent: Optional[str],
    entities: Dict[str, Any],
    tools: List[str],
    context: List[Dict],
    planner_confidence: float = 1.0
) -> tuple[bool, Optional[str]]:
    """
    Check if clarification needed and start session if so.
    
    Returns:
        (needs_clarification: bool, session_id: Optional[str])
    """
    manager = get_clarification_manager()
    result = manager.start_clarification_session(
        question, intent, entities, tools, context, planner_confidence
    )
    return result['needs_clarification'], result.get('session_id')
