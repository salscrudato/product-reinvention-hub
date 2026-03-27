"""Mapper Recipes - Deterministic Plan Building

Recipes are pre-defined sequences of tool calls for common mapping queries.
They execute WITHOUT LLM calls, making them instant and cost-free.

Use Cases:
---------
1. definition_lookup: User asks "What is customer name?"
   → Search data dictionary → Return cached definition

2. test_data_lookup: User asks "Show me test data for address"
   → Query test suite → Return sample values

3. table_lookup: User asks "Which table has email?"
   → Search schema metadata → Return table name

4. column_lookup: User asks "What columns are in customer_master?"
   → Query schema → Return column list

Benefits:
--------
- 0 LLM calls (instant, free)
- Deterministic results (consistent)
- Fast response (< 100ms)
- Useful for FAQ-style questions

When NOT to Use:
---------------
- Complex multi-entity extraction (use CrewAI)
- Logic generation / SQL synthesis (use CrewAI)
- Business definition from unstructured docs (use CrewAI)
"""

import logging
from typing import Any, Dict, List, Optional
import re

logger = logging.getLogger("mapper_recipes")


def build_mapper_recipe(
    intent: str,
    question: str,
    metadata: Dict[str, Any]
) -> Optional[List[Dict[str, Any]]]:
    """Build a deterministic recipe based on intent.
    
    Args:
        intent: Classified intent (definition_lookup, test_data_lookup, etc.)
        question: User's question
        metadata: Request metadata
        
    Returns:
        List of tool steps, or None if no recipe available
    """
    try:
        logger.info("RECIPE[BUILD] Building recipe for intent: %s", intent)
        
        if intent == "definition_lookup":
            return _build_definition_lookup_recipe(question, metadata)
        
        elif intent == "test_data_lookup":
            return _build_test_data_lookup_recipe(question, metadata)
        
        elif intent == "table_lookup":
            return _build_table_lookup_recipe(question, metadata)
        
        elif intent == "column_lookup":
            return _build_column_lookup_recipe(question, metadata)
        
        else:
            logger.info("RECIPE[BUILD] No recipe for intent: %s", intent)
            return None
            
    except Exception as e:
        logger.error(f"RECIPE[BUILD_ERROR] Failed to build recipe: {e}")
        return None


def _build_definition_lookup_recipe(question: str, metadata: Dict) -> List[Dict]:
    """Recipe for definition lookup.
    
    Example: "What is customer name?" → Search data dictionary
    """
    # Extract entity name from question
    entity_name = _extract_entity_from_question(question)
    
    return [
        {
            "step": "search_data_dictionary",
            "args": {"entity_name": entity_name},
            "description": f"Search data dictionary for '{entity_name}'"
        },
        {
            "step": "format_definition",
            "args": {"entity_name": entity_name},
            "description": "Format definition as entity card"
        }
    ]


def _build_test_data_lookup_recipe(question: str, metadata: Dict) -> List[Dict]:
    """Recipe for test data lookup.
    
    Example: "Show me test data for address" → Query test suite
    """
    entity_name = _extract_entity_from_question(question)
    
    return [
        {
            "step": "query_test_suite",
            "args": {"entity_name": entity_name, "limit": 5},
            "description": f"Query test data for '{entity_name}'"
        },
        {
            "step": "format_test_samples",
            "args": {"entity_name": entity_name},
            "description": "Format test samples as entity card"
        }
    ]


def _build_table_lookup_recipe(question: str, metadata: Dict) -> List[Dict]:
    """Recipe for table lookup.
    
    Example: "Which table has email?" → Search schema metadata
    """
    entity_name = _extract_entity_from_question(question)
    
    return [
        {
            "step": "search_schema_tables",
            "args": {"entity_name": entity_name},
            "description": f"Search tables containing '{entity_name}'"
        },
        {
            "step": "format_table_mapping",
            "args": {"entity_name": entity_name},
            "description": "Format table mapping as entity card"
        }
    ]


def _build_column_lookup_recipe(question: str, metadata: Dict) -> List[Dict]:
    """Recipe for column lookup.
    
    Example: "What columns are in customer_master?" → Query schema
    """
    # Extract table name from question
    table_pattern = r"(?:in|from|table)\s+([a-z_]+)"
    match = re.search(table_pattern, question, re.IGNORECASE)
    table_name = match.group(1) if match else "unknown"
    
    return [
        {
            "step": "query_table_columns",
            "args": {"table_name": table_name},
            "description": f"Query columns in '{table_name}'"
        },
        {
            "step": "format_column_list",
            "args": {"table_name": table_name},
            "description": "Format column list"
        }
    ]


def _extract_entity_from_question(question: str) -> str:
    """Extract entity name from question using regex.
    
    Examples:
    - "What is customer name?" → "customer name"
    - "Show me test data for address" → "address"
    - "Define billing amount" → "billing amount"
    """
    # Pattern 1: "What is X?"
    pattern1 = r"(?:what is|define|meaning of)\s+(.+?)(?:\?|$)"
    match = re.search(pattern1, question, re.IGNORECASE)
    if match:
        return match.group(1).strip().lower()
    
    # Pattern 2: "test data for X"
    pattern2 = r"(?:test data|sample|example)(?:\s+for)?\s+(.+?)(?:\?|$)"
    match = re.search(pattern2, question, re.IGNORECASE)
    if match:
        return match.group(1).strip().lower()
    
    # Pattern 3: "X table" or "X column"
    pattern3 = r"([a-z_]+)\s+(?:table|column)"
    match = re.search(pattern3, question, re.IGNORECASE)
    if match:
        return match.group(1).strip().lower()
    
    # Fallback: last 1-3 words before ? or end
    words = question.rstrip("?").split()
    if len(words) >= 2:
        return " ".join(words[-2:]).lower()
    elif words:
        return words[-1].lower()
    
    return "unknown"


def execute_mapper_recipe(
    recipe: List[Dict[str, Any]],
    context: Dict[str, Any]
) -> Dict[str, Any]:
    """Execute a deterministic recipe.
    
    Args:
        recipe: List of steps to execute
        context: Execution context (question, metadata, etc.)
        
    Returns:
        Dict containing extracted entities
    """
    try:
        logger.info("RECIPE[EXEC] Executing %d steps", len(recipe))
        
        results = {}
        entities = []
        
        for i, step_def in enumerate(recipe):
            step_name = step_def.get("step", "")
            step_args = step_def.get("args", {})
            description = step_def.get("description", "")
            
            if not step_name:
                logger.warning("RECIPE[SKIP] Step %d has no name", i+1)
                continue
            
            logger.info("RECIPE[STEP %d] %s - %s", i+1, step_name, description)
            
            # Execute step
            step_result = _execute_recipe_step(step_name, step_args, context, results)
            results[step_name] = step_result
            
            # Check if step produced entities
            if isinstance(step_result, dict) and "entity" in step_result:
                entities.append(step_result["entity"])
        
        logger.info("RECIPE[COMPLETE] Extracted %d entities", len(entities))
        
        return {
            "entities": entities,
            "recipe_results": results,
            "steps_executed": len(recipe)
        }
        
    except Exception as e:
        logger.error(f"RECIPE[EXEC_ERROR] Execution failed: {e}", exc_info=True)
        return {"entities": [], "error": str(e)}


def _execute_recipe_step(
    step_name: str,
    args: Dict[str, Any],
    context: Dict[str, Any],
    previous_results: Dict[str, Any]
) -> Any:
    """Execute a single recipe step.
    
    This is a simplified implementation. In production, this would
    call actual tools from mapper_tools.py.
    """
    entity_name = args.get("entity_name", "unknown")
    
    # Simulate deterministic lookups
    if step_name == "search_data_dictionary":
        # Mock: Return cached definition
        return {
            "entity": {
                "entity_name": entity_name,
                "business_definition": f"Mock definition for {entity_name} from data dictionary",
                "status": "approved",
                "confidence": 0.9,
                "sources": ["data_dictionary_cache"]
            }
        }
    
    elif step_name == "query_test_suite":
        # Mock: Return sample test data
        return {
            "entity": {
                "entity_name": entity_name,
                "test_data": [
                    {"value": f"Sample {entity_name} 1", "row_id": 1001},
                    {"value": f"Sample {entity_name} 2", "row_id": 1002}
                ],
                "status": "approved",
                "confidence": 0.85,
                "sources": ["test_suite_customer"]
            }
        }
    
    elif step_name == "search_schema_tables":
        # Mock: Return table names
        return {
            "entity": {
                "entity_name": entity_name,
                "tables": [f"{entity_name.replace(' ', '_')}_table"],
                "status": "needs_review",
                "confidence": 0.7,
                "sources": ["schema_metadata"]
            }
        }
    
    elif step_name == "query_table_columns":
        table_name = args.get("table_name", "unknown")
        # Mock: Return column names
        return {
            "columns": [f"{table_name}_id", f"{table_name}_name", f"{table_name}_value"]
        }
    
    elif step_name in ["format_definition", "format_test_samples", "format_table_mapping", "format_column_list"]:
        # Formatting steps just pass through previous results
        return previous_results
    
    else:
        logger.warning(f"RECIPE[STEP] Unknown step: {step_name}")
        return {"error": f"unknown_step:{step_name}"}


# Export for easy importing
__all__ = [
    "build_mapper_recipe",
    "execute_mapper_recipe"
]
