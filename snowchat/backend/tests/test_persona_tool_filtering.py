from components.agentic_orchestrator_auto import AgenticOrchestratorAuto
from components.persona_registry import PERSONA_DEFS


def test_persona_tool_filtering_engineering_lead(monkeypatch):
    orch = AgenticOrchestratorAuto()
    # Force a plan with mixed tools
    def fake_plan_tools(question, prompt, metadata, username):
        return [
            {'function_name': 'fetch_servicenow_incident', 'arguments': {'incident_number': 'INC001'}},
            {'function_name': 'fetch_kb_articles', 'arguments': {'query': 'login'}},
            {'function_name': 'unknown_tool_x', 'arguments': {}},
        ]
    monkeypatch.setattr(orch, 'plan_tools', fake_plan_tools)
    metadata = {'persona': 'engineering_lead'}
    result = orch.solve([{'role':'user','content':'Need triage for INC001'}], 'prompt', metadata)
    plan = result.get('plan') or []
    allowed = PERSONA_DEFS['engineering_lead']['tools']
    assert all(step.get('function_name') in allowed for step in plan)
    # Ensure unknown_tool_x removed
    assert not any(step.get('function_name') == 'unknown_tool_x' for step in plan)
