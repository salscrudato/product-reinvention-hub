import json
import pytest


def test_wiki_tool_in_function_registry():
    from components.shared_registry import FUNCTION_REGISTRY
    assert 'wiki_rag_tool' in FUNCTION_REGISTRY, 'wiki_rag_tool not registered'
    fn = FUNCTION_REGISTRY['wiki_rag_tool']
    assert callable(fn)


def test_wiki_tool_schema_present():
    from components.tool_schemas import get_tool_specs
    specs = get_tool_specs()
    names = [s['name'] for s in specs]
    assert 'wiki_rag_tool' in names
    schema = next(s for s in specs if s['name'] == 'wiki_rag_tool')['schema']
    assert 'question' in schema['properties']


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
        fc_args = {"function_sequence": [
            {"function_name": "wiki_rag_tool", "arguments": {"question": "@wiki test topic"}}
        ]}
        return Resp({"name": "propose_function_sequence", "arguments": json.dumps(fc_args)})
    import openai
    monkeypatch.setattr(openai.chat.completions, 'create', fake_create)
    return fake_create


def test_function_call_planner_can_return_wiki(stub_openai):
    from components.function_call_planner import plan_with_function_call, build_messages_from_question
    plan, diag = plan_with_function_call(build_messages_from_question("@wiki test topic"))
    assert plan and plan[0]['function_name'] == 'wiki_rag_tool'
    assert plan[0]['arguments']['question'].startswith('@wiki')
    assert diag['dropped'] == []
