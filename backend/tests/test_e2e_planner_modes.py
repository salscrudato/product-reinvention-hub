import os
import json
import time
import pytest

PROMPTS = [
    {
        "slug": "short_description_inc1",
        "question": "Can you please tell me the short description for the incident numbered INC0000001?",
        "expected_tools_any": ["fetch_servicenow_incident", "fetch_servicenow_incident_core", "fetch_servicenow_incident_tool"],
    },
    {
        "slug": "summary_inc1",
        "question": "What is the Summary of INC0000001?",
        "expected_tools_any": ["fetch_servicenow_incident", "fetch_servicenow_incident_core"],
    },
]

ARTIFACT_DIR = os.path.join(os.path.dirname(__file__), 'artifacts')


def _artifact_path(slug, mode):
    ts = int(time.time())
    return os.path.join(ARTIFACT_DIR, f"{slug}__{mode}__{ts}.json")


@pytest.mark.parametrize("mode", ["function_call", "langgraph"])  # test both planner modes
@pytest.mark.parametrize("prompt_case", PROMPTS, ids=[p["slug"] for p in PROMPTS])
def test_e2e_planner_modes(prompt_case, mode, monkeypatch):
    # Set planner mode
    monkeypatch.setenv('PLANNER_MODE', mode)
    # We stub OpenAI for deterministic function_call mode only; langgraph path already uses local flow.
    if mode == 'function_call':
        import openai
        class Msg:
            def __init__(self, fc):
                self.function_call = fc
                self.content = None
        class Choice:
            def __init__(self, fc):
                self.message = Msg(fc)
        class Resp:
            def __init__(self, fc):
                self.choices = [Choice(fc)]
        def fake_create(*args, **kwargs):
            # naive mapping: choose first expected tool with question
            fc_args = {"function_sequence": [
                {"function_name": prompt_case['expected_tools_any'][0], "arguments": {"incident_number": "INC0000001"}}
            ]}
            return Resp({"name": "propose_function_sequence", "arguments": json.dumps(fc_args)})
        monkeypatch.setattr(openai.chat.completions, 'create', fake_create)

    from components.agentic_orchestrator_auto import AgenticOrchestratorAuto
    orch = AgenticOrchestratorAuto()
    result = orch.solve([{"role":"user","content":prompt_case['question']}], "You are a helpful assistant.", {}, username="e2e_tester")

    # Basic assertions
    assert 'plan' in result and isinstance(result['plan'], list)
    assert result['plan'], 'Plan empty'
    # Validate at least one expected tool appears (accept function_name or tool key)
    plan_tools = [step.get('function_name') or step.get('tool') for step in result['plan']]
    assert any(t in plan_tools for t in prompt_case['expected_tools_any']), f"None of expected tools {prompt_case['expected_tools_any']} found in plan {plan_tools}"
    assert 'tool_outputs' in result
    # Write artifact
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    artifact = {
        "planner_mode": mode,
        "question": prompt_case['question'],
        "plan": result['plan'],
        "tool_outputs_keys": list(result['tool_outputs'].keys()),
        "traces": result.get('traces', []),
        "errors": result.get('errors', []),
    }
    with open(_artifact_path(prompt_case['slug'], mode), 'w', encoding='utf-8') as f:
        json.dump(artifact, f, ensure_ascii=False, indent=2)
