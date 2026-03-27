

from flask import Blueprint, request, jsonify
from datetime import datetime
from uuid import uuid4
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
import json
import logging

from .components.agentic_orchestrator import LangGraphAgenticOrchestrator
from .components.snowaaonetool import snow_tools

# === MCP Data Models ===
@dataclass
class Step:
    id: str
    type: str  # 'user' | 'model' | 'tool'
    input: Dict[str, Any]
    output: Dict[str, Any]
    timestamp: str
    tool_name: Optional[str] = None

@dataclass
class Invocation:
    input: str
    context: List[Step]
    tools: List[str]

# === Utility Functions ===
def current_time():
    return datetime.utcnow().isoformat() + "Z"

def create_step(step_type: str, input_data: dict, output_data: dict, tool_name=None):
    return Step(
        id=str(uuid4()),
        type=step_type,
        input=input_data,
        output=output_data,
        timestamp=current_time(),
        tool_name=tool_name
    )

def deserialize_context(raw_context):
    if not raw_context:
        return []
    return [Step(**s) for s in raw_context]

# === MCP LangGraph Agent ===
def mcp_plan_and_run(user_input: str, context: List[Step], tools: List[str]):
    orchestrator = LangGraphAgenticOrchestrator(tools={k: snow_tools[k] for k in tools if k in snow_tools})
    state = {
        "messages": [{"role": "user", "content": user_input}],
        "prompt": "",
        "metadata": {},
        "username": None,
        "plan": [],
        "plan_step": 0,
        "question": user_input,
        "context_messages": [],
        "done": False
    }
    plan = orchestrator.agentic_planner_suggest(state)
    steps = context.copy()
    for idx, step in enumerate(plan):
        tool_name = step.get("tool")
        args = step.get("args", {})
        tool_func = snow_tools.get(tool_name)
        if not tool_func:
            output = {"error": f"Tool '{tool_name}' not found"}
        else:
            try:
                output = tool_func(**args) if isinstance(args, dict) else tool_func(args)
            except Exception as e:
                output = {"error": str(e)}
        mcp_step = create_step("tool", args, output, tool_name=tool_name)
        steps.append(mcp_step)
    final_output = steps[-1].output if steps else {}
    return final_output, steps

mcp_blueprint = Blueprint("mcp_api", __name__)

@mcp_blueprint.route('/mcp/invoke', methods=['POST'])
def invoke():
    data = request.get_json()
    user_input = data.get("message", "")
    raw_context = data.get("context", [])
    tools = data.get("tools") or list(snow_tools.keys())
    context = deserialize_context(raw_context)
    invocation = Invocation(
        input=user_input,
        context=context,
        tools=tools
    )
    final_output, updated_steps = mcp_plan_and_run(invocation.input, invocation.context, invocation.tools)
    return jsonify({
        "final_output": final_output,
        "context": [asdict(s) for s in updated_steps],
        "steps_summary": [f"tool({s.tool_name})" for s in updated_steps]
    })

# To use: register mcp_blueprint in your Flask app
# from .mcp_api import mcp_blueprint
# app.register_blueprint(mcp_blueprint)
