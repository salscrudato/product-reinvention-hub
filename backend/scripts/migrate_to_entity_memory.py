"""
Migration Script: Integrating Entity Memory Framework into Existing Orchestrator

This script shows the specific code changes needed to replace short_term_memory.py
with the generic entity_memory_framework.py.

DO NOT RUN THIS DIRECTLY - Use as reference for manual integration.
"""

import os

# ==================== STEP 1: Environment Variables ====================

print("""
STEP 1: Add Environment Variables
==================================
Add to .env or set in environment:

# Enable entity memory framework
ENABLE_ENTITY_MEMORY=1

# Enable enhanced LangGraph with checkpointers
USE_ENHANCED_LANGGRAPH=1

# Session management
SNOWCHAT_SESSION_TIMEOUT=3600  # 1 hour in seconds
""")

# ==================== STEP 2: Update agentic_orchestrator_auto.py ====================

print("""
STEP 2: Update Orchestrator Imports
====================================
File: backend/components/agentic_orchestrator_auto.py

REPLACE:
    # ❌ OLD
    from .short_term_memory import get_short_term_memory, STM_ENABLED

WITH:
    # ✅ NEW
    from .entity_memory_framework import ENABLED as ENTITY_MEMORY_ENABLED
    from .langgraph_enhanced import (
        build_enhanced_graph,
        build_thread_id,
        prepare_initial_state,
        extract_response_from_state,
        USE_ENHANCED_GRAPH,
    )
    
    # Backward compatibility
    from .short_term_memory import get_short_term_memory, STM_ENABLED
    
    # Choose framework
    USE_ENTITY_MEMORY = ENTITY_MEMORY_ENABLED and os.getenv("USE_ENTITY_MEMORY", "1") == "1"
""")

print("""
STEP 3: Update orchestrate_agentic_workflow Function
=====================================================
File: backend/components/agentic_orchestrator_auto.py

FIND the orchestrate_agentic_workflow function definition (around line 1450)

ADD session_id parameter:

    # ❌ OLD signature
    def orchestrate_agentic_workflow(
        question: str, 
        username: str, 
        metadata: Optional[Dict[str, Any]] = None
    ):
    
    # ✅ NEW signature
    def orchestrate_agentic_workflow(
        question: str, 
        username: str, 
        metadata: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None  # NEW parameter
    ):
""")

print("""
STEP 4: Replace STM Detection Logic
====================================
File: backend/components/agentic_orchestrator_auto.py

FIND the STM detection block (around line 1650):

    # ❌ OLD: Manual STM detection
    if STM_ENABLED:
        stm = get_short_term_memory()
        ref = stm.detect_reference(question)
        if ref and ref.get("has_cached_data"):
            stm.resolve_query(question, metadata)

REPLACE WITH:

    # ✅ NEW: Use enhanced graph or legacy STM
    if USE_ENTITY_MEMORY and USE_ENHANCED_GRAPH and session_id:
        # Enhanced LangGraph handles entity memory via nodes
        logger.info("[Orchestrator] Using Entity Memory Framework with Enhanced LangGraph")
        
        # Build thread ID for state persistence
        thread_id = build_thread_id(username, session_id)
        config = {"configurable": {"thread_id": thread_id}}
        
        # Prepare initial state
        initial_state = prepare_initial_state(
            question=question,
            username=username,
            metadata=metadata,
            existing_plan=catalog_plan_steps,  # From catalog prompt if exists
            enable_entity_memory=True
        )
        
        # Run enhanced graph
        result_state = enhanced_app.invoke(initial_state, config=config)
        
        # Extract response
        response = extract_response_from_state(result_state)
        
        return response
    
    elif STM_ENABLED:
        # Legacy STM for backward compatibility
        logger.info("[Orchestrator] Using legacy short_term_memory")
        stm = get_short_term_memory()
        ref = stm.detect_reference(question)
        if ref and ref.get("has_cached_data"):
            stm.resolve_query(question, metadata)
    
    else:
        logger.info("[Orchestrator] No entity memory active")
""")

print("""
STEP 5: Build Enhanced Graph at Module Level
=============================================
File: backend/components/agentic_orchestrator_auto.py

ADD after class AgenticOrchestrator definition (around line 1990):

    # ✅ NEW: Build enhanced graph with entity memory
    if USE_ENTITY_MEMORY and USE_ENHANCED_GRAPH:
        try:
            from .langgraph_enhanced import build_enhanced_graph
            
            # Wrap existing node functions for compatibility
            def planner_wrapper(state):
                # Call existing planner logic
                pass  # Use existing planner code
            
            def executor_wrapper(state):
                # Call existing executor logic
                pass  # Use existing executor code
            
            enhanced_app = build_enhanced_graph(
                planner_node_func=planner_wrapper,
                executor_node_func=executor_wrapper,
                postprocess_node_func=lambda s: s,
                done_node_func=lambda s: s,
                use_checkpointer=True
            )
            
            logger.info("[Orchestrator] ✅ Enhanced LangGraph app built with entity memory")
        except Exception as e:
            logger.error(f"[Orchestrator] Failed to build enhanced graph: {e}")
            enhanced_app = None
    else:
        enhanced_app = None
""")

# ==================== STEP 6: Update API Endpoint ====================

print("""
STEP 6: Update API Endpoint to Accept session_id
=================================================
File: backend/components/agentic_orchestrator_api.py

FIND the /chat endpoint (around line 50):

    @bp.route('/chat', methods=['POST'])
    def chat():
        data = request.json
        question = data.get('question')
        username = data.get('username')
        
        # ✅ ADD session_id extraction
        session_id = data.get('session_id')
        if not session_id:
            # Generate fallback session ID
            import uuid
            session_id = str(uuid.uuid4())
            logger.warning(f"No session_id provided, generated: {session_id}")
        
        # ✅ Pass session_id to orchestrator
        result = orchestrate_agentic_workflow(
            question=question,
            username=username,
            metadata=data.get('metadata', {}),
            session_id=session_id  # NEW parameter
        )
        
        return jsonify(result)
""")

# ==================== STEP 7: Update Frontend ====================

print("""
STEP 7: Update Frontend to Send session_id
===========================================
File: frontend/src/components/ChatInterface.tsx (or similar)

ADD session management:

    import { v4 as uuidv4 } from 'uuid';
    
    const ChatInterface = () => {
        // Generate session ID once per chat session
        const [sessionId] = useState(() => uuidv4());
        
        const sendMessage = async (question: string) => {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    question,
                    username: currentUser.email,
                    session_id: sessionId,  // ✅ Send to backend
                })
            });
            
            return response.json();
        };
    };

NOTE: Session persists for entire browser session. If user closes browser
and reopens, they get a new session (can be enhanced with localStorage).
""")

# ==================== STEP 8: Deprecate short_term_memory.py ====================

print("""
STEP 8: Add Deprecation Notice to short_term_memory.py
=======================================================
File: backend/components/short_term_memory.py

ADD at top of file:

    '''
    DEPRECATED: This module is replaced by entity_memory_framework.py
    
    Kept for backward compatibility only. New code should use:
    - entity_memory_framework.py for entity extraction/detection
    - langgraph_enhanced.py for LangGraph integration
    
    To disable this module and use new framework:
        export ENABLE_ENTITY_MEMORY=1
        export USE_ENHANCED_LANGGRAPH=1
    
    Migration guide: components/ENTITY_MEMORY_INTEGRATION_GUIDE.md
    '''
    
    import warnings
    warnings.warn(
        "short_term_memory.py is deprecated. Use entity_memory_framework.py",
        DeprecationWarning,
        stacklevel=2
    )
""")

# ==================== STEP 9: Testing ====================

print("""
STEP 9: Test Multi-Turn Conversations
======================================

Test Scenario 1: Same Session
------------------------------
1. Start chat session (get session_id from frontend)
2. Q1: "What are the top incidents in backlog?"
   → Should cache incidents
3. Q2: "List those incidents"
   → Should detect reference and fetch incidents
4. Verify logs show:
   [RefDetect] ✅ Reference detected | type=incidents count=13
   [CacheEntities] ✅ Extracted 13 incidents

Test Scenario 2: Cross-Browser Session
---------------------------------------
1. Q1: "What incidents are there?" in Chrome
2. Copy session_id from network tab
3. Close Chrome, open Firefox
4. Send Q2: "Show me those" with SAME session_id
   → Should still work (state persisted via checkpointer)

Test Scenario 3: Entity Type Switching
---------------------------------------
1. Q1: "Show me user stories"
   → Caches user_stories
2. Q2: "What incidents are related?"
   → Caches both user_stories AND incidents
3. Q3: "Tell me about those stories"
   → Should resolve to user_stories, NOT incidents
4. Q4: "What about those incidents?"
   → Should resolve to incidents

Test Scenario 4: Legacy Fallback
---------------------------------
Set ENABLE_ENTITY_MEMORY=0
Verify system falls back to short_term_memory.py
""")

# ==================== STEP 10: Monitoring ====================

print("""
STEP 10: Add Monitoring Metrics
================================

Add to observability dashboard:

1. Entity extraction rate
   - Metric: entity_extractions_per_request
   - Track: How many entities extracted per tool execution

2. Reference detection rate
   - Metric: reference_detection_rate
   - Track: % of queries that reference cached entities

3. Cache hit rate
   - Metric: entity_cache_hit_rate
   - Track: % of references successfully resolved

4. Entity types active
   - Metric: active_entity_types
   - Track: Which entity types being used (incidents, stories, etc.)

5. Checkpointer storage
   - Metric: checkpointer_size_mb
   - Track: Size of state persistence storage

Sample log analysis query:
    grep "RefDetect.*Reference detected" agentic_orchestrator_auto.log | wc -l
    grep "CacheEntities.*Extracted" agentic_orchestrator_auto.log | wc -l
""")

# ==================== STEP 11: Production Considerations ====================

print("""
STEP 11: Production Deployment
===============================

1. Switch to SqliteSaver for Production
   -------------------------------------
   File: backend/components/langgraph_enhanced.py
   
   REPLACE:
       from langgraph.checkpoint.memory import MemorySaver
       memory = MemorySaver()  # In-memory (dev only)
   
   WITH:
       from langgraph.checkpoint.sqlite import SqliteSaver
       db_path = os.getenv("CHECKPOINTER_DB", "checkpoints.db")
       memory = SqliteSaver.from_conn_string(db_path)
       logger.info(f"Using SqliteSaver at {db_path}")

2. Add Checkpoint Cleanup Job
   ---------------------------
   File: backend/scripts/cleanup_checkpoints.py
   
   '''
   Cleanup old checkpoints to prevent storage bloat
   Run daily via cron
   '''
   import sqlite3
   import time
   
   def cleanup_old_checkpoints(db_path, max_age_days=7):
       conn = sqlite3.connect(db_path)
       cutoff = time.time() - (max_age_days * 86400)
       conn.execute("DELETE FROM checkpoints WHERE timestamp < ?", (cutoff,))
       conn.commit()
       deleted = conn.total_changes
       conn.close()
       print(f"Deleted {deleted} checkpoints older than {max_age_days} days")

3. Configure Session Timeout
   --------------------------
   Add to .env:
       SNOWCHAT_SESSION_TIMEOUT=3600  # 1 hour
   
   Cleanup sessions on frontend after timeout

4. Monitor Storage Growth
   ----------------------
   Add alerting if checkpoints.db > 1GB

5. Load Testing
   ------------
   Test with 100+ concurrent sessions
   Verify checkpointer performance

""")

# ==================== Summary ====================

print("""
================================
MIGRATION CHECKLIST
================================

Phase 1: Setup (30 minutes)
□ Add entity_memory_framework.py to backend/components/
□ Add langgraph_enhanced.py to backend/components/
□ Add test_entity_memory_framework.py to backend/tests/
□ Set environment variables (ENABLE_ENTITY_MEMORY=1)
□ Run tests: pytest backend/tests/test_entity_memory_framework.py

Phase 2: Backend Integration (2 hours)
□ Update orchestrator imports
□ Add session_id parameter to orchestrate_agentic_workflow
□ Replace STM detection with entity memory logic
□ Build enhanced graph at module level
□ Update API endpoint to accept session_id
□ Test backend in isolation

Phase 3: Frontend Integration (1 hour)
□ Add uuid library to frontend
□ Generate session_id in ChatInterface
□ Pass session_id in API requests
□ Test multi-turn conversations

Phase 4: Testing (2 hours)
□ Test same-session references
□ Test cross-browser session persistence
□ Test entity type switching
□ Test legacy fallback
□ Load test with concurrent sessions

Phase 5: Production (1 hour)
□ Switch to SqliteSaver
□ Add checkpoint cleanup job
□ Configure monitoring
□ Deploy to staging
□ Monitor for 24 hours
□ Deploy to production

Phase 6: Cleanup (30 minutes)
□ Add deprecation notice to short_term_memory.py
□ Update documentation
□ Announce to team

TOTAL TIME: ~7 hours

ROLLBACK PLAN:
Set ENABLE_ENTITY_MEMORY=0 to instantly fall back to legacy STM

SUCCESS METRICS:
✅ Multi-turn queries work without manual metadata injection
✅ State persists across browser reloads
✅ <20ms overhead per request
✅ Zero code changes to add new entity types
✅ 100% backward compatible with existing features

""")

if __name__ == "__main__":
    print("Migration guide generated. Follow steps manually - DO NOT RUN THIS SCRIPT.")
