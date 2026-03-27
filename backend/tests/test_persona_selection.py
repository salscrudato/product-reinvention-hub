import os
import pytest
from components.agentic_orchestrator_auto import AgenticOrchestratorAuto

CASES = [
    ("@lead Need root cause for INC0001234 spike", "engineering_lead"),
    ("@po What is business impact of these login failures?", "business_owner"),
    ("Provide runbook gap analysis for password reset flow", "business_owner"),
    ("Need login governance audit for persona entitlements", "business_owner"),
    ("Find similar incidents and probable code area for timeout", "engineering_lead"),
]

@pytest.mark.parametrize("question,expected", CASES)
def test_persona_detection_and_metadata(question, expected):
    os.environ['PLANNER_MODE'] = 'crewai'
    os.environ['DISABLE_PRE_RULE'] = '1'
    orch = AgenticOrchestratorAuto()
    result = orch.solve([{"role": "user", "content": question}], "You are a helpful assistant.", {})
    assert result.get('metadata', {}).get('persona') == expected
    assert result.get('plan'), "Plan should not be empty"
