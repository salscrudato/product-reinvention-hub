"""CrewAI Mapping Agents - Hierarchical Multi-Agent Setup

This module creates 4 specialized AI agents that collaborate to extract
entity mappings from user questions.

Agents:
-------
1. AI Consultant (Manager)
   - Role: Orchestrates the team, delegates tasks, synthesizes findings  
   - Can delegate to: Business Analyst, Tester, Data Consultant
   - Outputs: Final entity mapping cards

2. AI Business Analyst
   - Role: Extracts business definitions from requirements documents
   - Tools: Search requirements, parse Word/Excel, search SharePoint
   - Outputs: Business definitions, entity descriptions

3. AI Tester
   - Role: Analyzes test cases and test data
   - Tools: Search test cases, analyze test data patterns
   - Outputs: Test data samples, validation rules, field patterns

4. AI Data Consultant
   - Role: Maps entities to database tables/columns
   - Tools: Query schema, analyze data dictionary, generate SQL
   - Outputs: Table mappings, column mappings, population logic, SQL queries

Process: Hierarchical
--------------------
The AI Consultant (manager) receives the task and automatically delegates
to specialist agents as needed. CrewAI handles the delegation logic.

Example Flow:
User: "I need customer name and address"
  → Consultant delegates to Business Analyst
  → Business Analyst searches requirements for "customer name" definition
  → Consultant delegates to Tester
  → Tester finds test data with first_name, last_name fields
  → Consultant delegates to Data Consultant
  → Data Consultant queries schema, finds customer_master table
  → Consultant synthesizes all findings into entity cards
"""

import logging
import os
from typing import Any, Dict, List, Optional
import json

logger = logging.getLogger("mapper_crewai_agents")

# Safe imports
try:
    from crewai import Agent, Task, Crew, Process
    from crewai.tools import BaseTool
    CREWAI_AVAILABLE = True
except Exception as e:
    logger.error(f"CrewAI import failed: {e}")
    CREWAI_AVAILABLE = False
    Agent = None
    Task = None
    Crew = None
    Process = None
    BaseTool = None

try:
    from .mapper_tools import (
        search_requirements_tool,
        parse_word_doc_tool,
        search_test_cases_tool,
        analyze_test_data_tool,
        query_schema_tool,
        generate_sql_tool,
        get_all_mapper_tools
    )
    TOOLS_AVAILABLE = True
except Exception as e:
    logger.warning(f"Mapper tools unavailable: {e}")
    TOOLS_AVAILABLE = False
    search_requirements_tool = None
    parse_word_doc_tool = None
    search_test_cases_tool = None
    analyze_test_data_tool = None
    query_schema_tool = None
    generate_sql_tool = None
    def get_all_mapper_tools():
        return []

# Get LLM from environment
def _get_llm():
    """Get configured LLM for agents."""
    try:
        from langchain_openai import AzureChatOpenAI
        return AzureChatOpenAI(
            azure_deployment=os.getenv("GPT_MODEL_NAME", "gpt-4"),
            temperature=0.7,
            api_version=os.getenv("OPENAI_API_VERSION", "2023-05-15")
        )
    except Exception as e:
        logger.error(f"Failed to initialize LLM: {e}")
        return None


def create_mapping_crew():  # type: ignore
    """Create the mapping agent crew with hierarchical process.
    
    Returns:
        Crew object ready for task execution, or None if unavailable
    """
    if not CREWAI_AVAILABLE:
        logger.error("CrewAI not available - cannot create crew")
        return None
    
    if not TOOLS_AVAILABLE:
        logger.warning("Mapper tools not available - crew will have limited capabilities")
    
    llm = _get_llm()
    if not llm:
        logger.error("LLM not available - cannot create crew")
        return None
    
    try:
        # Agent 1: AI Consultant (Manager)
        consultant = Agent(  # type: ignore[misc]
            role="AI Consultant (Mapping Orchestrator)",
            goal="Coordinate the team to extract complete entity mappings from user questions. "
                 "Delegate to Business Analyst for definitions, Tester for test data, "
                 "and Data Consultant for database mappings. Synthesize all findings.",
            backstory="You are an experienced data architect who coordinates specialists "
                     "to answer complex data mapping questions. You delegate tasks to "
                     "your team and synthesize their findings into comprehensive entity cards.",
            verbose=True,
            allow_delegation=True,  # KEY: Manager can delegate
            llm=llm,
            max_iter=5
        )
        
        # Agent 2: AI Business Analyst
        business_analyst = Agent(  # type: ignore[misc]
            role="AI Business Analyst",
            goal="Find business definitions and descriptions for data entities by searching "
                 "requirements documents, Word files, Excel data dictionaries, and SharePoint sites.",
            backstory="You are a business analyst who understands requirements documentation. "
                     "You excel at finding business definitions, field descriptions, and "
                     "data element meanings from business requirements and specifications.",
            tools=[search_requirements_tool, parse_word_doc_tool] if TOOLS_AVAILABLE else [],  # type: ignore[list-item]
            verbose=True,
            allow_delegation=False,
            llm=llm,
            max_iter=3
        )
        
        # Agent 3: AI Tester
        tester = Agent(  # type: ignore[misc]
            role="AI Tester",
            goal="Analyze test cases and test data to find sample values, validation rules, "
                 "and field patterns for data entities.",
            backstory="You are a QA engineer who understands test data structures. "
                     "You can find test cases, analyze test data patterns, and identify "
                     "validation rules and edge cases from test suites.",
            tools=[search_test_cases_tool, analyze_test_data_tool] if TOOLS_AVAILABLE else [],  # type: ignore[list-item]
            verbose=True,
            allow_delegation=False,
            llm=llm,
            max_iter=3
        )
        
        # Agent 4: AI Data Consultant
        data_consultant = Agent(  # type: ignore[misc]
            role="AI Data Consultant",
            goal="Map data entities to database tables and columns. Query database schema, "
                 "understand table relationships, and generate SQL queries for data extraction.",
            backstory="You are a database expert who knows schema design and SQL. "
                     "You can query data dictionaries, understand table relationships, "
                     "and generate optimal SQL queries for data extraction.",
            tools=[query_schema_tool, generate_sql_tool] if TOOLS_AVAILABLE else [],  # type: ignore[list-item]
            verbose=True,
            allow_delegation=False,
            llm=llm,
            max_iter=3
        )
        
        # Create crew with hierarchical process
        crew = Crew(  # type: ignore[misc,call-arg]
            agents=[consultant, business_analyst, tester, data_consultant],
            tasks=[],  # Tasks will be added dynamically
            process=Process.hierarchical,  # Manager-delegated process
            manager_llm=llm,  # LLM for manager decisions
            verbose=True,
            memory=True,  # Enable conversation memory
            cache=True,  # Cache tool results
        )
        
        logger.info("CREW[INIT] Created mapping crew with 4 agents (hierarchical process)")
        return crew
        
    except Exception as e:
        logger.error(f"Failed to create crew: {e}", exc_info=True)
        return None


def execute_crew_task(
    crew,  # type: ignore
    question: str,
    metadata: Dict[str, Any]
) -> Dict[str, Any]:
    """Execute a mapping task using the crew.
    
    Args:
        crew: Initialized Crew object
        question: User's question
        metadata: Request metadata (entity names, context, etc.)
        
    Returns:
        Dict containing extracted entities and agent contributions
    """
    if not crew:
        return {"error": "crew_unavailable", "entities": []}
    
    try:
        logger.info("CREW[TASK_START] Executing task for question: %s", question[:200])
        
        # Extract entity names from metadata (pre-extracted by orchestrator)
        entity_names = metadata.get("extracted_entity_names", [])
        if not entity_names:
            logger.warning("CREW[WARN] No entity names provided in metadata")
            entity_names = ["unknown entity"]
        
        # Create task description
        task_description = f"""Extract complete mapping information for these entities: {', '.join(entity_names)}

User Question: {question}

For each entity, find:
1. Business Definition: Search requirements documents for the business meaning
2. Database Tables: Identify which database tables contain this data
3. Database Columns: List specific column names
4. Population Logic: SQL logic or formula to populate this field (e.g., CONCAT, calculations)
5. Conditions: WHERE clauses or filters (e.g., WHERE status='ACTIVE')
6. Test Data: Sample values from test cases

Output Format (JSON):
{{
  "entities": [
    {{
      "entity_name": "customer name",
      "business_definition": "Legal name of the customer as registered...",
      "tables": ["customer_master"],
      "columns": ["first_name", "last_name"],
      "population_logic": "CONCAT(first_name, ' ', last_name)",
      "conditions": ["WHERE status='ACTIVE'"],
      "test_data": [{{"value": "John Doe", "row_id": 1001}}],
      "confidence": 0.95,
      "sources": ["requirements_v2.3.docx", "test_customer_suite"]
    }}
  ]
}}
"""
        
        # Create task for manager agent
        task = Task(  # type: ignore[misc]
            description=task_description,
            expected_output="JSON object with entity mapping cards containing business definitions, "
                          "database tables/columns, population logic, conditions, and test data",
            agent=crew.agents[0]  # Consultant (manager) receives the task
        )
        
        # Add task to crew
        crew.tasks = [task]
        
        # Execute crew
        import time
        start_time = time.time()
        
        result = crew.kickoff()
        
        duration_ms = int((time.time() - start_time) * 1000)
        logger.info("CREW[TASK_COMPLETE] Completed in %dms", duration_ms)
        
        # Parse result
        parsed_result = _parse_crew_output(result, entity_names)
        parsed_result["duration_ms"] = duration_ms
        parsed_result["llm_calls"] = _estimate_llm_calls(crew)
        parsed_result["agents_used"] = ["consultant", "business_analyst", "tester", "data_consultant"]
        
        return parsed_result
        
    except Exception as e:
        logger.error(f"CREW[ERROR] Task execution failed: {e}", exc_info=True)
        return {
            "error": str(e),
            "entities": [],
            "llm_calls": 0
        }


def _parse_crew_output(result: Any, expected_entities: List[str]) -> Dict[str, Any]:
    """Parse CrewAI output into structured entity cards.
    
    Args:
        result: Raw output from crew.kickoff()
        expected_entities: List of entity names we expect to find
        
    Returns:
        Dict with parsed entities and agent contributions
    """
    try:
        # Convert result to string if needed
        result_str = str(result)
        
        # Try to extract JSON from result
        json_match = None
        if "{" in result_str:
            # Find JSON block
            start_idx = result_str.find("{")
            end_idx = result_str.rfind("}") + 1
            if end_idx > start_idx:
                json_str = result_str[start_idx:end_idx]
                try:
                    json_data = json.loads(json_str)
                    if "entities" in json_data:
                        logger.info("CREW[PARSE] Extracted %d entities from JSON", len(json_data["entities"]))
                        return {
                            "entities": json_data["entities"],
                            "agent_contributions": _track_agent_contributions(json_data["entities"])
                        }
                except json.JSONDecodeError:
                    logger.warning("CREW[PARSE] Failed to parse JSON from result")
        
        # Fallback: Create placeholder entity cards
        logger.warning("CREW[PARSE] Could not parse structured output, creating placeholders")
        entities = []
        for entity_name in expected_entities:
            entities.append({
                "entity_name": entity_name,
                "business_definition": f"Definition pending for {entity_name}",
                "tables": [],
                "columns": [],
                "population_logic": None,
                "conditions": [],
                "test_data": [],
                "status": "needs_review",
                "confidence": 0.3,
                "sources": ["crewai_output_parse_failed"]
            })
        
        return {
            "entities": entities,
            "agent_contributions": {}
        }
        
    except Exception as e:
        logger.error(f"CREW[PARSE_ERROR] Failed to parse output: {e}")
        return {"entities": [], "agent_contributions": {}}


def _track_agent_contributions(entities: List[Dict]) -> Dict[str, Dict[str, str]]:
    """Track which agent contributed which fields to each entity.
    
    Returns:
        Dict mapping entity_name → field_name → agent_name
    """
    contributions = {}
    
    for entity in entities:
        entity_name = entity.get("entity_name")
        if not entity_name:
            continue
        
        field_agents = {}
        
        # Business definition → Business Analyst
        if entity.get("business_definition"):
            field_agents["business_definition"] = "business_analyst"
        
        # Tables/columns → Data Consultant
        if entity.get("tables"):
            field_agents["tables"] = "data_consultant"
        if entity.get("columns"):
            field_agents["columns"] = "data_consultant"
        if entity.get("population_logic"):
            field_agents["population_logic"] = "data_consultant"
        if entity.get("conditions"):
            field_agents["conditions"] = "data_consultant"
        
        # Test data → Tester
        if entity.get("test_data"):
            field_agents["test_data"] = "tester"
        
        contributions[entity_name] = field_agents
    
    return contributions


def _estimate_llm_calls(crew) -> int:  # type: ignore[no-untyped-def]
    """Estimate number of LLM calls made during crew execution.
    
    Hierarchical process typically makes:
    - 1 call for manager to decide delegation
    - 1-3 calls for worker agents
    - 1 call for final synthesis
    
    Returns:
        Estimated number of LLM calls
    """
    # TODO: Get actual count from CrewAI metrics when available
    # For now, return reasonable estimate
    return 3


# Export for easy importing
__all__ = [
    "create_mapping_crew",
    "execute_crew_task"
]
