import os
import json
import pytest

from components.plan_sanitizer import sanitize_plan


@pytest.fixture
def stub_function_call(monkeypatch):
    # Monkeypatch openai for function_call planner path
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
        fc_args = {"function_sequence": [{"function_name": "code_annotation_tool", "arguments": {"question": "@code hi"}}]}
        return Resp({"name": "propose_function_sequence", "arguments": json.dumps(fc_args)})
    import openai
    monkeypatch.setattr(openai.chat.completions, 'create', fake_create)
    return fake_create


def test_select_and_plan_function_call_mode(stub_function_call, monkeypatch):
    monkeypatch.setenv('PLANNER_MODE', 'function_call')
    from components.planner_selector import select_and_plan
    plan, diag, mode = select_and_plan("@code hi", "", {}, username="tester")
    assert mode == 'function_call'
    assert len(plan) == 1 and plan[0]['function_name'] == 'code_annotation_tool'
    assert diag['dropped'] == []


def test_select_and_plan_langgraph_mode(monkeypatch):
    # Force langgraph but we will monkeypatch the underlying call to avoid real LLM usage
    monkeypatch.setenv('PLANNER_MODE', 'langgraph')
    from components.planner_selector import plan_with_langgraph, select_and_plan
    def fake_langgraph(q, p, m, username=None):
        return [{"function_name": "code_annotation_tool", "arguments": {"question": "@code test"}}]
    monkeypatch.setattr('components.planner_selector.plan_with_langgraph', fake_langgraph)
    plan, diag, mode = select_and_plan("@code test", "", {}, username="tester")
    assert mode == 'langgraph'
    assert plan[0]['function_name'] == 'code_annotation_tool'
    assert diag['dropped'] == []
