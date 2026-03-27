"""Lamapper Agentic Orchestrator (Hybrid Architecture)

Overview
========
This orchestrator handles mapping-specific queries using a hybrid approach:
1. Simple queries → Deterministic recipes (no LLM, instant response)
2. Entity extraction → CrewAI hierarchical (manager + 3 workers)
3. Iterative refinement → LangGraph stateful workflows (future)

Architecture Decision Points
---------------------------
- Question contains specific table/column → Recipe lookup (0 LLM calls)
- Question asks for multiple entities → CrewAI hierarchical (2-3 LLM calls)
- User refines existing mapping → LangGraph iterative (future)

Agents (CrewAI Hierarchical)
----------------------------
1. AI Consultant (Manager): Delegates to specialists, synthesizes findings
2. AI Business Analyst: Searches requirements docs (Word, Excel, SharePoint)
3. AI Tester: Analyzes test cases and test data
4. AI Data Consultant: Queries database schema, generates SQL

Feature Flags
-------------
ENABLE_MAPPER_CREWAI: Enable CrewAI agents (default: 1)
ENABLE_MAPPER_RECIPES: Enable deterministic recipes (default: 1)
ENABLE_MAPPER_STREAMING: Stream entity updates to frontend (default: 1)

Output Format
-------------
Returns structured entity mapping cards:
{
  "entities": [
    {
      "entity_name": "Customer Name",
      "business_definition": "Legal name of customer...",
      "tables": ["customer_master"],
      "columns": ["first_name", "last_name"],
      "population_logic": "CONCAT(first_name, ' ', last_name)",
      "conditions": ["WHERE status = 'ACTIVE'"],
      "test_data": [{"value": "John Doe", "row_id": 1001}],
      "status": "approved|needs_review|error",
      "confidence": 0.95,
      "sources": ["requirements_v2.3.docx", "test_suite_customer"]
    }
  ],
  "metadata": {
    "plan_source": "crewai_hierarchical|recipe|langgraph",
    "agents_used": ["consultant", "business_analyst", "tester", "data_consultant"],
    "llm_calls": 3,
    "duration_ms": 12500
  }
}

Events Emitted
--------------
mapper.entity.discovered - When new entity extracted from question
mapper.entity.updated - When entity card field populated (business_def, tables, etc.)
mapper.entity.approved - When entity mapping finalized
mapper.plan.started - When orchestrator begins execution
mapper.plan.completed - When all entities mapped
"""

import logging
import os
import time
import json
import re
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
import traceback

logger = logging.getLogger("mapper_agentic_orchestrator")
logger.setLevel(logging.INFO)

# Ensure unified mapping_log.log file handler
if not any(isinstance(h, logging.FileHandler) and 'mapping_log' in getattr(h, 'baseFilename', '') for h in logger.handlers):
    from logging.handlers import RotatingFileHandler
    fh = RotatingFileHandler(
        'mapping_log.log',
        mode='a',
        encoding='utf-8',
        maxBytes=50 * 1024 * 1024,
        backupCount=5
    )
    fmt = logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    fh.setFormatter(fmt)
    fh.setLevel(logging.INFO)
    logger.addHandler(fh)

# Also ensure console handler for immediate feedback
if not any(isinstance(h, logging.StreamHandler) for h in logger.handlers):
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] MAPPER: %(message)s'))
    ch.setLevel(logging.INFO)
    logger.addHandler(ch)

# Feature flags
ENABLE_MAPPER_CREWAI = os.getenv("ENABLE_MAPPER_CREWAI", "1").lower() in ("1", "true", "yes", "on")
ENABLE_MAPPER_RECIPES = os.getenv("ENABLE_MAPPER_RECIPES", "1").lower() in ("1", "true", "yes", "on")
ENABLE_MAPPER_STREAMING = os.getenv("ENABLE_MAPPER_STREAMING", "1").lower() in ("1", "true", "yes", "on")

# Safe imports with fallbacks
try:
    from .mapper_intent_classifier import classify_intent as classify_mapper_intent
    logger.info("Successfully imported mapper_intent_classifier")
except Exception as e:
    logger.warning(f"Failed to import mapper_intent_classifier: {e}. Using fallback classifier")
    def classify_mapper_intent(question: str, context: Dict = None) -> Dict:  # type: ignore
        """Fallback classifier"""
        try:
            logger.debug(f"Fallback classifier processing question: {question[:100]}")
            q_lower = question.lower()
            if any(w in q_lower for w in ["extract", "find", "get", "need", "show me"]):
                intent = "entity_extraction"
            elif any(w in q_lower for w in ["map", "connect", "relate"]):
                intent = "mapping_synthesis"
            elif any(w in q_lower for w in ["how to", "calculate", "formula", "logic"]):
                intent = "logic_generation"
            elif any(w in q_lower for w in ["sample", "example", "test data"]):
                intent = "test_data_lookup"
            elif any(w in q_lower for w in ["what is", "define", "meaning"]):
                intent = "definition_lookup"
            else:
                intent = "entity_extraction"
            logger.debug(f"Fallback classifier determined intent: {intent}")
            return {"intent": intent, "confidence": 0.7, "context": context or {}}
        except Exception as err:
            logger.error(f"Error in fallback classifier: {err}")
            return {"intent": "entity_extraction", "confidence": 0.5, "context": context or {}, "error": str(err)}

try:
    from .mapper_recipes import build_mapper_recipe, execute_mapper_recipe
    logger.info("Successfully imported mapper_recipes")
except Exception as e:
    logger.warning(f"Failed to import mapper_recipes: {e}. Recipe execution disabled")
    def build_mapper_recipe(intent: str, question: str, metadata: Dict) -> Optional[List[Dict]]:
        logger.warning(f"mapper_recipes module unavailable - recipes disabled for intent: {intent}")
        return None
    def execute_mapper_recipe(recipe: List[Dict], context: Dict) -> Dict:
        logger.error(f"mapper_recipes unavailable, cannot execute {len(recipe)} recipe steps")
        return {"error": "recipes_unavailable", "details": "mapper_recipes module not available"}

try:
    from .mapper_crewai_agents import create_mapping_crew, execute_crew_task  # type: ignore[assignment]
    logger.info("Successfully imported mapper_crewai_agents")
except Exception as e:
    logger.warning(f"Failed to import mapper_crewai_agents: {e}. CrewAI execution disabled")
    logger.debug(f"CrewAI import traceback: {traceback.format_exc()}")
    def create_mapping_crew():  # type: ignore[misc]
        logger.error("Cannot create mapping crew - mapper_crewai_agents not available")
        return None
    def execute_crew_task(crew, question: str, metadata: Dict) -> Dict:  #type: ignore[misc]
        logger.error(f"CrewAI unavailable, cannot execute task for question: {question[:100]}")
        return {"error": "crewai_unavailable", "entities": [], "details": "mapper_crewai_agents module not available"}

try:
    from events.emitter import emit_event  # type: ignore[attr-defined]
    logger.info("Successfully imported events.emitter")
except Exception as e:
    logger.warning(f"Failed to import events.emitter: {e}. Event emission disabled")
    def emit_event(*args, **kwargs):  # type: ignore
        logger.debug(f"Event emission skipped (emitter unavailable): {args[0] if args else 'unknown'}")
        return None

# Import memory modules
try:
    from .mapper_short_term_memory import (  # type: ignore[assignment]
        get_mapper_memory,  # type: ignore[assignment]
        store_entity_result,
        resolve_entity_references,
        ENABLED as MEMORY_ENABLED
    )
    from .mapper_conversation_store import get_conversation_store  # type: ignore[assignment]
    logger.info("Successfully imported mapper memory modules")
except Exception as e:
    logger.warning(f"Failed to import memory modules: {e}. Memory features disabled")
    MEMORY_ENABLED = False
    def get_mapper_memory(conversation_id: Optional[str] = None):  # type: ignore[misc]
        return None  # type: ignore[return-value]
    def store_entity_result(tool_name: str, output: Any, intent: Optional[str] = None, conversation_id: Optional[str] = None):  # type: ignore[misc]
        pass
    def resolve_entity_references(question: str, metadata: Dict[str, Any], conversation_id: Optional[str] = None) -> Tuple[str, bool]:  # type: ignore[misc]
        return question, False
    def get_conversation_store():  # type: ignore[misc]
        return None


class MapperAgenticOrchestrator:
    """Hybrid orchestrator for data mapping entity extraction.
    
    Decides between recipes, CrewAI, and LangGraph based on query complexity.
    """
    
    def __init__(self, verbose: bool = False):
        """Initialize the mapper orchestrator.
        
        Args:
            verbose: Enable verbose logging
        """
        try:
            self.verbose = verbose
            self.entities: List[Dict[str, Any]] = []
            self.metadata: Dict[str, Any] = {}
            self.traces: List[Dict[str, Any]] = []
            
            # Initialize memory and conversation store
            self.conversation_store = get_conversation_store()
            
            logger.info("="*80)
            logger.info("MAPPER ORCHESTRATOR INITIALIZED")
            logger.info(f"Verbose mode: {verbose}")
            logger.info(f"CrewAI enabled: {ENABLE_MAPPER_CREWAI}")
            logger.info(f"Recipes enabled: {ENABLE_MAPPER_RECIPES}")
            logger.info(f"Streaming enabled: {ENABLE_MAPPER_STREAMING}")
            logger.info(f"Memory enabled: {MEMORY_ENABLED}")
            logger.info("="*80)
        except Exception as e:
            logger.error(f"Failed to initialize MapperAgenticOrchestrator: {e}")
            logger.error(traceback.format_exc())
            raise
    
    def solve(
        self,
        question: str,
        context: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Main orchestration entry point.
        
        Args:
            question: User's natural language question
            context: Optional context (uploaded docs, selected tables, etc.)
            metadata: Optional metadata (user info, session data)
            
        Returns:
            Dict containing entities, metadata, traces
        """
        start_time = time.time()
        self.entities = []
        self.metadata = metadata or {}
        self.traces = []
        
        try:
            # Extract conversation ID for memory tracking
            conversation_id = metadata.get('session_id') or (context or {}).get('conversation_id')
            username = metadata.get('username', 'anonymous')
            project_id = (context or {}).get('project_id', 'unknown')
            
            logger.info("="*80)
            logger.info("STARTING NEW MAPPING REQUEST")
            logger.info(f"Question: {question}")
            logger.info(f"Conversation ID: {conversation_id}")
            logger.info(f"Context keys: {list(context.keys()) if context else 'None'}")
            logger.info(f"Metadata keys: {list(metadata.keys()) if metadata else 'None'}")
            logger.info("="*80)
            
            # Store user message in conversation history
            if self.conversation_store and conversation_id:
                try:
                    self.conversation_store.store_message(
                        conversation_id=conversation_id,
                        project_id=project_id,
                        username=username,
                        role='user',
                        message=question,
                        metadata={'timestamp': datetime.now().isoformat()}
                    )
                    logger.debug(f"Stored user message for conversation {conversation_id}")
                except Exception as e:
                    logger.warning(f"Failed to store user message: {e}")
            
            # Phase 1.5: Short-term memory pronoun resolution (similar to SnowChat)
            if MEMORY_ENABLED and conversation_id:
                try:
                    resolved_question, was_modified = resolve_entity_references(
                        question, self.metadata, conversation_id
                    )
                    if was_modified:
                        logger.info(f"[MEMORY] Resolved entity references in question")
                        logger.info(f"Original: {question}")
                        logger.info(f"Resolved: {resolved_question}")
                        question = resolved_question
                        self.metadata['reference_resolved'] = True
                        self.metadata['original_question'] = self.metadata.get('original_question', question)
                except Exception as mem_err:
                    logger.warning(f"Failed to resolve entity references: {mem_err}")
            
            try:
                emit_event("mapper.plan.started", {"question": question[:200]})
                logger.debug("Emitted mapper.plan.started event")
            except Exception as e:
                logger.warning(f"Failed to emit mapper.plan.started event: {e}")
            
            # Step 1: Classify intent (fast, no LLM)
            logger.info("STEP 1: Classifying intent")
            try:
                classification_result = classify_mapper_intent(question, context or {})
                intent = classification_result.get("intent", "entity_extraction") if isinstance(classification_result, dict) else classification_result
                self.metadata["intent"] = intent
                if isinstance(classification_result, dict):
                    self.metadata["intent_confidence"] = classification_result.get("confidence", 0.0)
                logger.info(f"Intent classified as: {intent} (confidence: {self.metadata.get('intent_confidence', 'N/A')})")
            except Exception as e:
                logger.error(f"Failed to classify intent: {e}")
                logger.error(traceback.format_exc())
                intent = "entity_extraction"  # fallback
                self.metadata["intent"] = intent
                self.metadata["intent_error"] = str(e)
                logger.warning(f"Using fallback intent: {intent}")
            
            # Step 2: Check for annotations
            logger.info("STEP 2: Detecting annotations")
            try:
                annotation = self._detect_annotation(question)
                if annotation:
                    self.metadata["annotation"] = annotation
                    logger.info(f"Annotation detected: {annotation}")
                else:
                    logger.debug("No annotations found in question")
            except Exception as e:
                logger.error(f"Failed to detect annotations: {e}")
                logger.error(traceback.format_exc())
                annotation = None
                self.metadata["annotation_error"] = str(e)
            
            # Step 3: Extract entities from question (regex/NLP, no LLM)
            logger.info("STEP 3: Extracting entity names from question")
            try:
                extracted_entities = self._extract_entity_names(question)
                if extracted_entities:
                    logger.info(f"Extracted {len(extracted_entities)} entities: {extracted_entities}")
                    self.metadata["extracted_entity_names"] = extracted_entities
                    # Initialize entity cards
                    for entity_name in extracted_entities:
                        try:
                            entity_card = {
                                "entity_name": entity_name,
                                "business_definition": None,
                                "tables": [],
                                "columns": [],
                                "population_logic": None,
                                "conditions": [],
                                "test_data": [],
                                "status": "pending",
                                "confidence": 0.0,
                                "sources": []
                            }
                            self.entities.append(entity_card)
                            logger.info(f"Initialized entity card for: {entity_name}")
                            try:
                                emit_event("mapper.entity.discovered", {"entity": entity_name})
                            except Exception as e:
                                logger.warning(f"Failed to emit entity discovered event for {entity_name}: {e}")
                        except Exception as e:
                            logger.error(f"Failed to create entity card for {entity_name}: {e}")
                            logger.error(traceback.format_exc())
                else:
                    logger.info("No entities extracted from question")
            except Exception as e:
                logger.error(f"Failed to extract entity names: {e}")
                logger.error(traceback.format_exc())
                self.metadata["entity_extraction_error"] = str(e)
            
            # Step 4: Route to appropriate execution path
            logger.info("STEP 4: Routing to appropriate executor")
            try:
                result = self._route_and_execute(intent, question, annotation, context)
                logger.info(f"Execution completed successfully. Result keys: {list(result.keys()) if result else 'None'}")
            except Exception as e:
                logger.error(f"Failed during route and execute: {e}")
                logger.error(traceback.format_exc())
                result = {"error": str(e), "entities": self.entities}
                self.metadata["execution_error"] = str(e)
            
            # Step 5: Post-process and finalize
            logger.info("STEP 5: Finalizing results")
            try:
                duration_ms = int((time.time() - start_time) * 1000)
                self.metadata["duration_ms"] = duration_ms
                logger.info(f"Total processing time: {duration_ms}ms")
                
                try:
                    emit_event("mapper.plan.completed", {
                        "entity_count": len(self.entities),
                        "duration_ms": duration_ms
                    })
                    logger.debug("Emitted mapper.plan.completed event")
                except Exception as e:
                    logger.warning(f"Failed to emit mapper.plan.completed event: {e}")
                
                # Store results in short-term memory
                if MEMORY_ENABLED and conversation_id and self.entities:
                    try:
                        store_entity_result(
                            tool_name='mapper_orchestrator',
                            output={'entities': self.entities},
                            intent=intent,
                            conversation_id=conversation_id
                        )
                        logger.info(f"[MEMORY] Stored {len(self.entities)} entities for conversation {conversation_id}")
                    except Exception as mem_err:
                        logger.warning(f"Failed to store entities in memory: {mem_err}")
                
                # Store assistant response in conversation history
                if self.conversation_store and conversation_id:
                    try:
                        entity_names = [str(e.get('entity_name', '')) for e in self.entities if e.get('entity_name')]
                        response_msg = f"Extracted {len(self.entities)} entity mapping(s): {', '.join(entity_names)}"
                        self.conversation_store.store_message(
                            conversation_id=conversation_id,
                            project_id=project_id,
                            username='assistant',
                            role='assistant',
                            message=response_msg,
                            metadata={
                                'entities_extracted': entity_names,
                                'intent': intent,
                                'duration_ms': duration_ms,
                                'plan_source': self.metadata.get('plan_source')
                            }
                        )
                        logger.debug(f"Stored assistant response for conversation {conversation_id}")
                    except Exception as e:
                        logger.warning(f"Failed to store assistant response: {e}")
                
                logger.info("="*80)
                logger.info(f"MAPPING REQUEST COMPLETED SUCCESSFULLY")
                logger.info(f"Entities extracted: {len(self.entities)}")
                logger.info(f"Duration: {duration_ms}ms")
                logger.info(f"Plan source: {self.metadata.get('plan_source', 'unknown')}")
                logger.info(f"LLM calls: {self.metadata.get('llm_calls', 0)}")
                logger.info("="*80)
            except Exception as e:
                logger.error(f"Error during finalization: {e}")
                logger.error(traceback.format_exc())
            
            return {
                "entities": self.entities,
                "metadata": self.metadata,
                "traces": self.traces
            }
            
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.error("="*80)
            logger.error("MAPPING REQUEST FAILED")
            logger.error(f"Error: {str(e)}")
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"Duration before failure: {duration_ms}ms")
            logger.error(f"Entities extracted before failure: {len(self.entities)}")
            logger.error("Full traceback:")
            logger.error(traceback.format_exc())
            logger.error("="*80)
            
            return {
                "entities": self.entities,  # Return partial results if available
                "metadata": {
                    **self.metadata,
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "duration_ms": duration_ms,
                    "partial_results": len(self.entities) > 0
                },
                "traces": self.traces
            }
    
    def _detect_annotation(self, question: str) -> Optional[str]:
        """Detect special annotations in question.
        
        Args:
            question: User's natural language question
            
        Returns:
            Annotation string or None
        """
        try:
            q_lower = question.lower()
            annotations = ["@entity", "@refine", "@table", "@logic", "@testdata"]
            for annotation in annotations:
                if annotation in q_lower:
                    logger.debug(f"Found annotation: {annotation}")
                    return annotation
            return None
        except Exception as e:
            logger.error(f"Error detecting annotation: {e}")
            logger.error(traceback.format_exc())
            return None
    
    def _extract_entity_names(self, question: str) -> List[str]:
        """Extract entity names from question using regex and heuristics.
        
        Examples:
        - "I need customer name and address" → ["customer name", "address"]
        - "Get the billing address" → ["billing address"]
        - "Extract employee ID, department, salary" → ["employee ID", "department", "salary"]
        
        Args:
            question: User's natural language question
            
        Returns:
            List of entity names
        """
        entities = []
        
        try:
            # Pattern 1: "need X, Y, and Z"
            logger.debug("Trying pattern 1: explicit need/get/extract phrases")
            need_pattern = r"(?:need|get|extract|show me|find)\s+(.+?)(?:\.|$|\?)"
            match = re.search(need_pattern, question, re.IGNORECASE)
            if match:
                items_text = match.group(1)
                logger.debug(f"Found match: {items_text}")
                # Split by commas and 'and'
                items = re.split(r',\s*|\s+and\s+', items_text)
                for item in items:
                    item_clean = item.strip().lower()
                    if item_clean and len(item_clean.split()) <= 4:  # Max 4 words per entity
                        entities.append(item_clean)
                        logger.debug(f"Extracted entity: {item_clean}")
            
            # Pattern 2: Common data entities (fallback)
            if not entities:
                logger.debug("No entities from pattern 1, trying common entity fallback")
                common_entities = [
                    "customer name", "address", "email", "phone", "customer id",
                    "order id", "product name", "price", "quantity", "date",
                    "employee id", "department", "salary", "hire date"
                ]
                for entity in common_entities:
                    if entity in question.lower():
                        entities.append(entity)
                        logger.debug(f"Found common entity: {entity}")
        
        except Exception as e:
            logger.error(f"Error extracting entity names: {e}")
            logger.error(traceback.format_exc())
        
        deduped = list(set(entities))
        logger.debug(f"Final entity list (deduplicated): {deduped}")
        return deduped
    
    def _route_and_execute(
        self,
        intent: str,
        question: str,
        annotation: Optional[str],
        context: Optional[Dict]
    ) -> Dict[str, Any]:
        """Route to appropriate execution path with comprehensive error handling.
        
        Args:
            intent: Classified intent
            question: User's question
            annotation: Detected annotation
            context: Optional context data
            
        Returns:
            Result dictionary
        """
        logger.info(f"Routing request - Intent: {intent}, Annotation: {annotation}")
        
        # Route 1: Simple queries → Recipes (no LLM)
        if ENABLE_MAPPER_RECIPES and intent in ["definition_lookup", "test_data_lookup"]:
            logger.info(f"Route 1: Using deterministic recipe for intent: {intent}")
            try:
                recipe = build_mapper_recipe(intent, question, self.metadata)
                if recipe:
                    logger.info(f"Recipe built successfully with {len(recipe)} steps")
                    try:
                        result = execute_mapper_recipe(recipe, {"question": question, "context": context})
                        logger.info("Recipe executed successfully")
                        try:
                            self._update_entities_from_recipe(result)
                            logger.info("Entity cards updated from recipe results")
                        except Exception as e:
                            logger.error(f"Failed to update entities from recipe: {e}")
                            logger.error(traceback.format_exc())
                        self.metadata["plan_source"] = "recipe"
                        self.metadata["llm_calls"] = 0
                        return result
                    except Exception as e:
                        logger.error(f"Failed to execute recipe: {e}")
                        logger.error(traceback.format_exc())
                        self.metadata["recipe_execution_error"] = str(e)
                else:
                    logger.warning("No recipe could be built for this intent")
            except Exception as e:
                logger.error(f"Failed during recipe routing: {e}")
                logger.error(traceback.format_exc())
                self.metadata["recipe_routing_error"] = str(e)
        
        # Route 2: Entity extraction → CrewAI Hierarchical
        if ENABLE_MAPPER_CREWAI and intent in ["entity_extraction", "mapping_synthesis", "logic_generation"]:
            logger.info(f"Route 2: Using CrewAI hierarchical for intent: {intent}")
            try:
                crew = create_mapping_crew()
                if crew:
                    logger.info("Mapping crew created successfully")
                    try:
                        result = execute_crew_task(crew, question, self.metadata)
                        logger.info(f"CrewAI task executed. Result keys: {list(result.keys()) if result else 'None'}")
                        try:
                            self._update_entities_from_crew(result)
                            logger.info("Entity cards updated from CrewAI results")
                        except Exception as e:
                            logger.error(f"Failed to update entities from crew: {e}")
                            logger.error(traceback.format_exc())
                        self.metadata["plan_source"] = "crewai_hierarchical"
                        self.metadata["agents_used"] = result.get("agents_used", [])
                        self.metadata["llm_calls"] = result.get("llm_calls", 3)
                        return result
                    except Exception as e:
                        logger.error(f"Failed to execute crew task: {e}")
                        logger.error(traceback.format_exc())
                        self.metadata["crew_execution_error"] = str(e)
                else:
                    logger.warning("Failed to create mapping crew (returned None)")
                    self.metadata["crew_creation_failed"] = True
            except Exception as e:
                logger.error(f"Failed during CrewAI routing: {e}")
                logger.error(traceback.format_exc())
                self.metadata["crewai_routing_error"] = str(e)
        
        # Route 3: Fallback - simple entity card creation
        logger.warning(f"Route 3: No suitable executor found for intent '{intent}', using fallback")
        logger.warning(f"CrewAI enabled: {ENABLE_MAPPER_CREWAI}, Recipes enabled: {ENABLE_MAPPER_RECIPES}")
        self.metadata["plan_source"] = "fallback"
        self.metadata["llm_calls"] = 0
        self.metadata["fallback_reason"] = f"No executor available for intent: {intent}"
        return {"entities": self.entities}
    
    def _update_entities_from_recipe(self, result: Dict[str, Any]):
        """Update entity cards from recipe execution result.
        
        Args:
            result: Recipe execution result dictionary
        """
        try:
            recipe_entities = result.get("entities", [])
            logger.info(f"Updating {len(recipe_entities)} entities from recipe results")
            
            for recipe_entity in recipe_entities:
                try:
                    # Find matching entity card or create new
                    entity_name = recipe_entity.get("entity_name")
                    if not entity_name:
                        logger.warning("Recipe entity missing entity_name, skipping")
                        continue
                        
                    existing = next((e for e in self.entities if e["entity_name"] == entity_name), None)
                    if existing:
                        logger.debug(f"Updating existing entity: {entity_name}")
                        # Update fields
                        for key, value in recipe_entity.items():
                            if value is not None:
                                existing[key] = value
                                logger.debug(f"Updated {entity_name}.{key}")
                                try:
                                    emit_event("mapper.entity.updated", {
                                        "entity": entity_name,
                                        "field": key,
                                        "source": "recipe"
                                    })
                                except Exception as e:
                                    logger.debug(f"Failed to emit update event for {entity_name}.{key}: {e}")
                    else:
                        logger.debug(f"Adding new entity from recipe: {entity_name}")
                        self.entities.append(recipe_entity)
                except Exception as e:
                    logger.error(f"Failed to process recipe entity: {e}")
                    logger.error(traceback.format_exc())
                    
            logger.info("Recipe entity update completed successfully")
        except Exception as e:
            logger.error(f"Failed to update entities from recipe: {e}")
            logger.error(traceback.format_exc())
            raise
    
    def _update_entities_from_crew(self, result: Dict[str, Any]):
        """Update entity cards from CrewAI execution result.
        
        Args:
            result: CrewAI execution result dictionary
        """
        try:
            crew_entities = result.get("entities", [])
            agent_contributions = result.get("agent_contributions", {})
            logger.info(f"Updating {len(crew_entities)} entities from CrewAI results")
            
            for crew_entity in crew_entities:
                try:
                    entity_name = crew_entity.get("entity_name")
                    if not entity_name:
                        logger.warning("Crew entity missing entity_name, skipping")
                        continue
                        
                    existing = next((e for e in self.entities if e["entity_name"] == entity_name), None)
                    
                    if existing:
                        logger.debug(f"Updating existing entity from crew: {entity_name}")
                        # Update fields progressively as agents contribute
                        for key, value in crew_entity.items():
                            try:
                                if value is not None and (not existing.get(key) or existing[key] != value):
                                    existing[key] = value
                                    # Determine which agent contributed this field
                                    agent_source = agent_contributions.get(entity_name, {}).get(key, "unknown")
                                    logger.debug(f"Updated {entity_name}.{key} (source: {agent_source})")
                                    try:
                                        emit_event("mapper.entity.updated", {
                                            "entity": entity_name,
                                            "field": key,
                                            "source": f"crewai_{agent_source}"
                                        })
                                    except Exception as e:
                                        logger.debug(f"Failed to emit update event for {entity_name}.{key}: {e}")
                            except Exception as e:
                                logger.warning(f"Failed to update field {key} for {entity_name}: {e}")
                        
                        # Update status if complete
                        try:
                            if all([
                                existing.get("business_definition"),
                                existing.get("tables"),
                                existing.get("columns")
                            ]):
                                existing["status"] = "approved"
                                logger.info(f"Entity {entity_name} marked as approved (all fields complete)")
                                try:
                                    emit_event("mapper.entity.approved", {"entity": entity_name})
                                except Exception as e:
                                    logger.debug(f"Failed to emit approved event for {entity_name}: {e}")
                        except Exception as e:
                            logger.warning(f"Failed to check/update status for {entity_name}: {e}")
                    else:
                        logger.debug(f"Adding new entity from crew: {entity_name}")
                        self.entities.append(crew_entity)
                except Exception as e:
                    logger.error(f"Failed to process crew entity: {e}")
                    logger.error(traceback.format_exc())
            
            logger.info(f"CrewAI entity update completed. Total entities: {len(self.entities)}")
        except Exception as e:
            logger.error(f"Failed to update entities from crew: {e}")
            logger.error(traceback.format_exc())
            raise
    
    def get_entity_by_name(self, entity_name: str) -> Optional[Dict[str, Any]]:
        """Retrieve specific entity card by name.
        
        Args:
            entity_name: Name of entity to retrieve
            
        Returns:
            Entity dictionary or None if not found
        """
        try:
            logger.debug(f"Looking up entity: {entity_name}")
            result = next((e for e in self.entities if e["entity_name"] == entity_name), None)
            if result:
                logger.debug(f"Found entity: {entity_name}")
            else:
                logger.debug(f"Entity not found: {entity_name}")
            return result
        except Exception as e:
            logger.error(f"Error retrieving entity {entity_name}: {e}")
            logger.error(traceback.format_exc())
            return None
    
    def export_training_data(self) -> Dict[str, Any]:
        """Export approved entity mappings as ML training data.
        
        Returns:
            Dict with training examples in format for ML model training
        """
        try:
            logger.info("Exporting training data from approved entities")
            approved = [e for e in self.entities if e.get("status") == "approved"]
            logger.info(f"Found {len(approved)} approved entities out of {len(self.entities)} total")
            
            training_examples = []
            for entity in approved:
                try:
                    example = {
                        "question_pattern": f"get {entity['entity_name']}",
                        "entity_name": entity["entity_name"],
                        "business_definition": entity.get("business_definition"),
                        "tables": entity.get("tables", []),
                        "columns": entity.get("columns", []),
                        "population_logic": entity.get("population_logic"),
                        "conditions": entity.get("conditions", []),
                        "test_data": entity.get("test_data", [])
                    }
                    training_examples.append(example)
                    logger.debug(f"Exported training example for: {entity['entity_name']}")
                except Exception as e:
                    logger.error(f"Failed to export entity {entity.get('entity_name', 'unknown')}: {e}")
            
            result = {
                "training_examples": training_examples,
                "metadata": {
                    "exported_at": datetime.utcnow().isoformat(),
                    "approved_count": len(approved),
                    "total_count": len(self.entities)
                }
            }
            
            logger.info(f"Successfully exported {len(training_examples)} training examples")
            return result
            
        except Exception as e:
            logger.error(f"Failed to export training data: {e}")
            logger.error(traceback.format_exc())
            return {
                "training_examples": [],
                "metadata": {
                    "exported_at": datetime.utcnow().isoformat(),
                    "error": str(e)
                }
            }
