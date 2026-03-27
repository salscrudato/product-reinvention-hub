import os
import json
import pytest

# We will stub select_and_plan to return explicit tool sequences for each query.
# Tools used: fetch_servicenow_incident_core, workaround_lookup_core, find_incidents_by_short_description_tool

@pytest.fixture(autouse=True)
def stub_registry(monkeypatch):
    # Import tools directly
    from components.servicenowgenaitool import (
        fetch_servicenow_incident_core,
        workaround_lookup_core,
        get_similar_incidents_simple,
    )
    from components.snowaaonetool import find_incidents_by_short_description_tool
    # Build a narrow registry subset
    registry = {
        'fetch_servicenow_incident': fetch_servicenow_incident_core,
        # Provide a shim so we can pass incident_number directly in tests without needing full question context
        'workaround_lookup': lambda incident_number=None, question=None: {
            'incident_number': incident_number or (question or 'UNKNOWN'),
            'workaround': f"Stub workaround for {incident_number or question}" ,
            'applied': True
        },
        'get_similar_incidents': get_similar_incidents_simple,
        'find_incidents_by_short_description': find_incidents_by_short_description_tool.func if hasattr(find_incidents_by_short_description_tool, 'func') else find_incidents_by_short_description_tool,
    }
    # Monkeypatch FUNCTION_REGISTRY for predictable tests
    monkeypatch.setattr('components.shared_registry.FUNCTION_REGISTRY', registry, raising=False)
    return registry


def _run_orchestrator(question, plan_steps, monkeypatch):
    # Stub planner selector to return the provided plan
    stub = lambda q,p,m,username=None: (plan_steps, {"dropped":[],"modified":[]}, 'function_call')
    # Patch both the source module and the already-imported symbol inside the orchestrator module
    monkeypatch.setattr('components.planner_selector.select_and_plan', stub, raising=False)
    monkeypatch.setattr('components.agentic_orchestrator_auto.select_and_plan', stub, raising=False)
    from components.agentic_orchestrator_auto import AgenticOrchestratorAuto
    orch = AgenticOrchestratorAuto()
    # If the plan uses workaround_lookup, inject a shim tool that accepts incident_number directly
    if any((s.get('function_name') or s.get('tool')) == 'workaround_lookup' for s in plan_steps):
        orch.tools['workaround_lookup'] = lambda incident_number=None, question=None: {
            'incident_number': incident_number or question,
            'workaround': f"Stub workaround for {incident_number or question}",
            'applied': True
        }
    result = orch.solve([{"role":"user","content":question}], "You are an assistant.", {}, username="tester")
    return result


def test_short_description_inc0000001(monkeypatch):
    plan = [{"function_name": "fetch_servicenow_incident", "arguments": {"incident_number": "INC0000001"}}]
    res = _run_orchestrator("Can you please tell me the short description for the incident numbered INC0000001?", plan, monkeypatch)
    assert res['plan'] and res['plan'][0]['function_name'] == 'fetch_servicenow_incident'
    assert 'tool_outputs' in res


def test_summary_inc0000001(monkeypatch):
    plan = [{"function_name": "fetch_servicenow_incident", "arguments": {"incident_number": "INC0000001"}}]
    res = _run_orchestrator("What is the Summary of INC0000001?", plan, monkeypatch)
    assert res['plan'][0]['function_name'] == 'fetch_servicenow_incident'
    assert res['tool_outputs']


def test_workaround_compare_two_incidents(monkeypatch):
    plan = [
        {"function_name": "workaround_lookup", "arguments": {"incident_number": "INC0000001"}},
        {"function_name": "workaround_lookup", "arguments": {"incident_number": "INC0000002"}},
    ]
    res = _run_orchestrator("Find the Work around for this incident INC0000001 and then check if the same can be applied to INC0000002 and let me know", plan, monkeypatch)
    assert len(res['plan']) == 2
    assert all(step['function_name'] == 'workaround_lookup' for step in res['plan'])
    assert 'workaround_lookup' in res['tool_outputs']  # last call output retained/keyed


def test_quote_issue_related_incidents(monkeypatch):
    plan = [{"function_name": "find_incidents_by_short_description", "arguments": {"short_description": "Quote"}}]
    res = _run_orchestrator("Give me the incidents related to Quote Issues in short description", plan, monkeypatch)
    assert res['plan'][0]['function_name'] == 'find_incidents_by_short_description'
    # Output presence
    assert 'tool_outputs' in res

