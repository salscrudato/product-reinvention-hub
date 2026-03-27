import sys
import os
import importlib

# Ensure backend package is importable when pytest runs from repo root
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest

ao = importlib.import_module('components.agentic_orchestrator_auto')


def test_short_circuit_similarity_by_inc_number(monkeypatch):
    """When the user explicitly references an INC number and asks for similar incidents,
    the orchestrator should short-circuit to a deterministic similarity lookup for that incident.
    """
    # Stub external helpers to avoid FAISS/ServiceNow calls
    monkeypatch.setattr(ao, 'fetch_servicenow_incident_core', lambda inc: {'short_description': 'Unable to Quote for Auto Insurance in NJ due to missing  Underinsured Motorist Coverage limits'})
    monkeypatch.setattr(ao, 'get_similar_incidents_simple', lambda key: [{'number': 'INC0000005', 'short_description': 'Underinsured Motorist Coverage value missing'}])

    orchestrator = ao.AgenticOrchestratorAuto()

    messages = [
        {'role': 'assistant', 'content': 'The short description for incident number INC0000001 is: "Unable to Quote for Auto Insurance in NJ due to missing  Underinsured Motorist Coverage limits".'},
        {'role': 'user', 'content': 'What are the other Similar Incidents like INC0000001?'}
    ]

    result = orchestrator.solve(messages, prompt='You are a ServiceNow assistant.', metadata={}, username='super')

    # Expect the orchestrator to short-circuit and return a deterministic plan referencing get_similar_incidents
    assert isinstance(result, dict)
    assert 'plan' in result
    plan = result['plan']
    assert isinstance(plan, list)
    assert any((step.get('function_name') == 'get_similar_incidents' or step.get('tool') == 'get_similar_incidents') for step in plan), f"Plan did not contain get_similar_incidents: {plan}"

    # If the short-circuit path was taken, arguments should include the incident_number or the short_description
    for step in plan:
        if step.get('function_name') == 'get_similar_incidents' or step.get('tool') == 'get_similar_incidents':
            args = step.get('arguments') or step.get('args') or {}
            assert args.get('incident_number') == 'INC0000001' or 'short_description' in args
            break
