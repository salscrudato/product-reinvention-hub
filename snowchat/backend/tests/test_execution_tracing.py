import json
import pytest


def fake_tool(question: str):
    return {"echo": question}


def test_traces_present(monkeypatch):
    from components.agentic_orchestrator_auto import AgenticOrchestratorAuto
    orch = AgenticOrchestratorAuto(tools={"code_annotation_tool": fake_tool})
    # Inject a pre-made plan
    orch.plan = [{"function_name": "code_annotation_tool", "arguments": {"question": "@code test"}}]
    outputs = orch.execute_plan("@code test", "", {}, username="tester")
    assert "code_annotation_tool" in outputs
    assert len(orch.traces) == 1
    trace = orch.traces[0]
    assert trace["tool"] == "code_annotation_tool"
    assert trace["status"] == "ok"
    assert trace["duration_ms"] >= 0


def test_traces_in_solve_result(monkeypatch):
    from components.agentic_orchestrator_auto import AgenticOrchestratorAuto
    # Monkeypatch planner to deterministic plan
    monkeypatch.setattr("components.planner_selector.select_and_plan", lambda q,p,m,username=None: ([{"function_name": "code_annotation_tool", "arguments": {"question": q}}], {"dropped":[],"modified":[]}, "langgraph"))
    orch = AgenticOrchestratorAuto(tools={"code_annotation_tool": fake_tool})
    result = orch.solve([{"role":"user","content":"@code something"}], "", {}, username="tester")
    assert "traces" in result
    assert len(result["traces"]) == 1
    t = result["traces"][0]
    assert t["tool"] == "code_annotation_tool"
    assert t["status"] == "ok"
