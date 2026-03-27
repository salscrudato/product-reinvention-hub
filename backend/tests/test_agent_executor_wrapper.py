import os
import pytest


def test_agent_executor_disabled(monkeypatch):
    monkeypatch.delenv('AGENT_EXECUTOR_ENABLED', raising=False)
    from components.agent_executor_wrapper import AgentExecutorWrapper
    assert AgentExecutorWrapper.is_enabled() is False


def test_agent_executor_enabled(monkeypatch):
    monkeypatch.setenv('AGENT_EXECUTOR_ENABLED', 'true')
    from components.agent_executor_wrapper import AgentExecutorWrapper
    assert AgentExecutorWrapper.is_enabled() is True
    # Use a simple registry with a fake tool
    def echo_tool(question: str):
        return {"echo": question}
    wrapper = AgentExecutorWrapper(registry={"echo_tool": echo_tool})
    plan = [{"function_name": "echo_tool", "arguments": {"question": "hello"}}]
    out = wrapper.run(plan)
    assert out and out[0]['tool'] == 'echo_tool'
    assert out[0]['result']['echo'] == 'hello'
