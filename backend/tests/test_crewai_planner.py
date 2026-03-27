import os
import pytest
from components.agentic_orchestrator_auto import AgenticOrchestratorAuto
from components.prompt_library import list_prompts

# Use a small representative subset of prompts to validate CrewAI adapter integration
SUBSET_IDS = {
    'inc_fetch_single_number',
    'inc_find_similar_phrase',
    'kb_search_basic',
    'code_annotation_usage',
    'triage_high_priority_detection'
}

PROMPTS = [p for p in list_prompts() if p['id'] in SUBSET_IDS]

@pytest.mark.parametrize('prompt', PROMPTS, ids=lambda p: p['id'])
def test_crewai_plan_and_execution(prompt):
    os.environ['PLANNER_MODE'] = 'crewai'
    os.environ['DISABLE_PRE_RULE'] = '1'
    orch = AgenticOrchestratorAuto()
    message = prompt['input']['message']
    result = orch.solve([{'role': 'user', 'content': message}], 'You are a helpful assistant.', {})
    assert result.get('plan'), f"No plan produced for {prompt['id']}"
    # Ensure at least one expected tool present
    expected_any = prompt['expect'].get('must_include_tools_any', [])
    if expected_any:
        tools_in_plan = {step.get('function_name') for step in result['plan']}
        assert any(t in tools_in_plan for t in expected_any), f"CrewAI plan missing expected tools {expected_any}; saw {tools_in_plan}"
