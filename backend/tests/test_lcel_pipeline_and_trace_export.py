import pytest


def test_run_pipeline_basic(monkeypatch):
    # stub planner to deterministic plan
    monkeypatch.setattr('components.planner_selector.select_and_plan', lambda q,p,m,username=None: ([{"function_name": "echo_tool", "arguments": {"question": q}}], {"dropped":[],"modified":[]}, "function_call"))
    from components.lcel_pipeline import run_pipeline

    # inject echo tool into registry temporarily
    from components.shared_registry import FUNCTION_REGISTRY
    FUNCTION_REGISTRY['echo_tool'] = lambda question: {"echo": question}

    result = run_pipeline("@code test echo")
    assert result['plan'] and result['plan'][0]['function_name'] == 'echo_tool'
    assert result['tool_outputs']['echo_tool']['echo'].startswith('@code')
    assert result['traces'] and result['traces'][0]['tool'] == 'echo_tool'


def test_trace_export_enabled(monkeypatch):
    # Enable export and ensure export_traces returns True
    monkeypatch.setenv('TRACE_EXPORT_ENABLED', 'true')
    from components.trace_export import export_traces
    ok = export_traces([{"tool":"x","status":"ok","duration_ms":1.2}])
    assert ok is True
