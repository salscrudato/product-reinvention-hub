import json
import pytest

from components.agentic_orchestrator_auto import AgenticOrchestratorAuto


def fake_fetch_servicenow_incident_core(inc_num):
    return {"number": inc_num, "short_description": "Test short description for injection"}


def fake_find_incidents_by_short_description_tool(args):
    # just echo back the args so we can assert injection
    return {"matched": ["INC0000002", "INC0000003"], "used_args": args}


def test_inject_find_incidents_args(monkeypatch):
    # Prepare orchestrator with tools where the finder is our fake
    tools = {"find_incidents_by_short_description": fake_find_incidents_by_short_description_tool}
    orchestrator = AgenticOrchestratorAuto(tools=tools)

    # Monkeypatch the fetch function used for canonical lookup
    monkeypatch.setattr("components.agentic_orchestrator_auto.fetch_servicenow_incident_core", fake_fetch_servicenow_incident_core)

    # Simulate pruned_context containing a quoted short description for INC0000001
    pruned_context = [
        {"role": "assistant", "content": 'The summary of incident INC0000001 is: "Test short description for injection".'}
    ]

    # Create a message list where the last message is the user asking for similar incidents
    messages = [
        {"role": "user", "content": "What are the other incidents similar to this incident ?"}
    ]

    # Force known_incidents to contain the canonical incident by setting tool_outputs before solve
    orchestrator.tool_outputs = {"fetch_servicenow_incident": {"number": "INC0000001", "short_description": "Test short description for injection"}}

    # Monkeypatch get_recent_chat_summaries to return our pruned_context so solve will pick it up
    monkeypatch.setattr(orchestrator, "get_recent_chat_summaries", lambda username, n=5: pruned_context)

    # Monkeypatch plan_tools to return a plan that contains find_incidents_by_short_description with no args
    def fake_plan_tools(question, prompt, metadata, username=None):
        return [{"function_name": "find_incidents_by_short_description"}]

    monkeypatch.setattr(orchestrator, "plan_tools", fake_plan_tools)

    result = orchestrator.solve(messages, "You are a ServiceNow assistant.", {}, username="testuser")

    # Assert that the plan step was injected with args and the tool executed
    assert "plan" in result
    assert result["plan"][0]["function_name"] == "find_incidents_by_short_description"
    # The tool outputs should include the used args
    assert "find_incidents_by_short_description" in result["tool_outputs"]
    used = result["tool_outputs"]["find_incidents_by_short_description"]
    assert isinstance(used, dict)
    used_args = used.get("used_args")
    assert isinstance(used_args, dict) and used_args, "used_args should be a non-empty dict"
    # ensure we injected short_description or incident_number
    assert ("short_description" in used_args) or ("incident_number" in used_args)
