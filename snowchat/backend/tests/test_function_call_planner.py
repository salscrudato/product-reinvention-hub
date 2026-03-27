import json
import pytest


@pytest.fixture
def stub_openai(monkeypatch):
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
        fc_args = {
            "function_sequence": [
                {"function_name": "unknown_tool", "arguments": {"x": 1}},
                {"function_name": "code_annotation_tool", "arguments": {"question": "@code test"}}
            ]
        }
        return Resp({"name": "propose_function_sequence", "arguments": json.dumps(fc_args)})

    import openai
    monkeypatch.setattr(openai.chat.completions, 'create', fake_create)
    return fake_create


def test_plan_with_function_call_sanitizes(stub_openai):
    from components.function_call_planner import plan_with_function_call, build_messages_from_question
    clean, diag = plan_with_function_call(build_messages_from_question("@code test please"))
    assert len(clean) == 1
    assert clean[0]['function_name'] == 'code_annotation_tool'
    assert clean[0]['arguments']['question'] == '@code test'
    # diagnostics should record a dropped unknown tool
    dropped_reasons = [d['reason'] for d in diag['dropped']]
    assert 'unknown_tool' in dropped_reasons
    assert 'raw' in diag

