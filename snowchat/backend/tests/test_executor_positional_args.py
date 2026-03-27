import pytest
from components.agentic_orchestrator_auto import AgenticOrchestratorAuto


def dummy_positional_tool(args):
    # expects a single positional arg (a dict)
    return {"received": args}


def test_executor_falls_back_to_positional():
    orchestrator = AgenticOrchestratorAuto(tools={"pos_tool": dummy_positional_tool})
    # craft a plan that uses the tool with no kwargs (planner omitted arguments)
    orchestrator.plan = [{"function_name": "pos_tool"}]
    # execute_plan should call the tool and populate tool_outputs
    outputs = orchestrator.execute_plan("q", "p", {}, username="u")
    assert "pos_tool" in outputs
    assert outputs["pos_tool"] == {"received": {}}
