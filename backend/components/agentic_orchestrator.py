import sys
import logging
import traceback
import json
import os  # added for PLANNER_VERSION env flag
import openai
from os import getenv
from typing import TypedDict, Optional, List, Dict, Any, cast
from tinydb import TinyDB, Query
db = TinyDB("state_db.json")
_STATEGRAPH_IMPORT_ERROR = None
try:
    from langgraph.graph import StateGraph  # type: ignore
except Exception as e:  # pragma: no cover
    _STATEGRAPH_IMPORT_ERROR = e
    class StateGraph:  # type: ignore
        def __init__(self, *a, **k):
            self._error = _STATEGRAPH_IMPORT_ERROR
            self.nodes = {}
            self.edges = []
        def add_node(self, name, fn):
            self.nodes[name] = fn
        def add_edge(self, frm, to):
            self.edges.append((frm, to))
        def add_conditional_edges(self, *a, **k):  # placeholder
            return None
        def set_entry_point(self, *a, **k):
            return None
        def compile(self):
            class _Runner:
                def invoke(self, state):
                    return state
            return _Runner()
    logger = logging.getLogger("agentic_orchestrator")
    logger.warning(f"[agentic_orchestrator] Failed importing StateGraph: {_STATEGRAPH_IMPORT_ERROR}; using shim (LangGraph disabled).")
from .snowaaonetool import snow_tools
from .agent_planner import CustomPlanner
from .agent_executor import CustomExecutor
from .langgraph_flow import process_question_with_prompt_and_metadata

# Configure logging to file and console
log_formatter = logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s')
file_handler = logging.FileHandler('agentic_orchestrator.log', mode='a', encoding='utf-8')
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
console_handler.setLevel(logging.WARNING)  # Only warnings/errors to stdout
logger = logging.getLogger("agentic_orchestrator")
logger.setLevel(logging.INFO)
if not logger.hasHandlers():
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

PLANNER_ONLY_KEYS = {"messages", "prompt", "metadata", "username", "question", "context_messages", "plan", "plan_step", "done"}
TOOL_ONLY_KEYS = {"tool_outputs"}

class LangGraphAgenticOrchestrator:
    def agentic_planner_suggest(self, state):
        """
        Prefer liked function sequences for similar questions from TinyDB. If none found, generate a plan using the LLM agent.
        Returns a list of dicts: [{"tool": ..., "args": ...}, ...] or an empty list if no suggestion.
        """
        question = state.get("question", "")
        prompt = state.get("prompt", "")
        metadata = state.get("metadata", {})
        username = state.get("username", None)
        # Try to find a liked function sequence for a similar question
        Question = Query()
        # Simple similarity: exact match or substring match (can be improved with embeddings)
        liked_entry = db.search(
            (Question.like_status == "like") &
            ((Question.question == question) | (Question.question.matches(f".*{question}.*", flags=0)))
        )
        if liked_entry:
            # Use the most recent liked sequence
            liked_seq = liked_entry[-1].get("function_sequence", [])
            if isinstance(liked_seq, list) and liked_seq:
                logger.info(f"[AgenticPlannerSuggest] Using liked function sequence from DB for question: {question}")
                return liked_seq
        # Fallback: generate plan using LLM agent
        agentic_result = process_question_with_prompt_and_metadata(question, prompt, metadata, username=username, agentic_mode=True)
        if isinstance(agentic_result, dict) and "function_sequence" in agentic_result:
            seq = agentic_result["function_sequence"]
            if isinstance(seq, list) and seq:
                logger.info(f"[AgenticPlannerSuggest] Full function sequence from LLM: {json.dumps(seq, default=str)}")
                return seq
        elif isinstance(agentic_result, list) and agentic_result:
            logger.info(f"[AgenticPlannerSuggest] Function sequence (list) from LLM: {json.dumps(agentic_result, default=str)}")
            return agentic_result
        logger.warning(f"[AgenticPlannerSuggest] No function sequence returned by LLM. agentic_result={agentic_result}")
        return []
    def __init__(self, tools=snow_tools, verbose=None, use_llm_plan_comparison=False):
        # Allow verbose to be set via environment variable AGENTIC_VERBOSE
        if verbose is None:
            env_verbose = getenv("AGENTIC_VERBOSE", "false").lower()
            self.verbose = env_verbose in ("1", "true", "yes", "on")
        else:
            self.verbose = verbose
        self.tools = tools
        self.use_llm_plan_comparison = use_llm_plan_comparison  # New config flag
        self.graph = self._build_graph()

    def _build_graph(self):
        if self.verbose:
            print("[AgenticOrchestrator] Entered _build_graph", file=sys.stderr)
        class AgenticState(TypedDict, total=False):
            messages: List[Any]
            prompt: str
            metadata: Dict[str, Any]
            username: Optional[str]
            tool_outputs: Dict[str, Any]
            plan: List[Any]
            plan_step: int
            done: Optional[bool]
            planner_error: Optional[str]
            planner_traceback: Optional[str]
            toolrunner_error: Optional[str]
            toolrunner_traceback: Optional[str]
            question: str  # Ensure question is preserved in state
            context_messages: List[Any]  # Ensure context_messages is preserved
        if _STATEGRAPH_IMPORT_ERROR is None:
            graph = StateGraph(state_schema=AgenticState)  # type: ignore[call-arg]
        else:
            graph = StateGraph()  # shim

        def tool_dispatch_node(state):
            plan = state.get("plan", [])
            step = state.get("plan_step", 0)
            plan_step = plan[step] if plan and step < len(plan) else None
            tool_name = None
            if plan_step:
                # Accept both 'tool' and 'function_name' as the tool name key
                tool_name = plan_step.get("tool") or plan_step.get("function_name")
            logger.info(f"[ToolDispatch] Entered tool_dispatch_node | plan_step={step} | tool_name={tool_name} | state_keys={list(state.keys())}")
            logger.info(f"[ToolDispatch] parking_lot at entry: {state.get('parking_lot', 'MISSING')}")
            print(f"[ToolDispatch] Entered tool_dispatch_node | plan_step={step} | tool_name={tool_name} | state_keys={list(state.keys())}", file=sys.stderr)
            # Always propagate parking_lot, even if missing
            if "parking_lot" not in state or not isinstance(state["parking_lot"], dict):
                state = dict(state)
                state["parking_lot"] = {}
            if not tool_name:
                logger.warning(f"[ToolDispatch] No tool for this plan step. Returning to planner.")
                # Always propagate parking_lot
                return {"__next__": "planner", **state}
            tool = self.tools.get(tool_name)
            if not tool:
                logger.error(f"[ToolDispatch] Tool '{tool_name}' not found in registered tools. Returning to planner.")
                print(f"[ToolDispatch] Tool '{tool_name}' not found in registered tools. Plan step: {plan_step}", file=sys.stderr)
                # Always propagate parking_lot
                return {"__next__": "planner", **state}
            return self._run_tool(state, tool, tool_name)

        graph.add_node("tool_dispatch", tool_dispatch_node)
        graph.add_node("planner", self._planner_node)
        graph.add_node("done", self._done_node)
        # Remove static edges and use conditional edges for dynamic routing
        def edge_selector(state):
            # Route to the node specified by '__next__' in the state
            return state.get("__next__")
        graph.add_conditional_edges(
            "planner",
            edge_selector,
            ["tool_dispatch", "done"]
        )
        graph.add_conditional_edges(
            "tool_dispatch",
            edge_selector,
            ["tool_dispatch", "planner", "done"]
        )
        # No outgoing edges from 'done' node
        graph.set_entry_point("planner")
        logger.info(f"[GraphBuild] Nodes: {list(graph.nodes.keys())}")
        logger.info(f"[GraphBuild] Edges: {graph.edges}")
        if self.verbose:
            print(f"[GraphBuild] Nodes: {list(graph.nodes.keys())}", file=sys.stderr)
            print(f"[GraphBuild] Edges: {graph.edges}", file=sys.stderr)
            print("[AgenticOrchestrator] Finished building graph", file=sys.stderr)
        return graph

    def _summarize_tool_output(self, tool_name, result, question=None):
        """
        Summarize a tool's output using the LLM. Returns a string summary.
        """
        try:
            model = getenv("GPT_MODEL_NAME", "gpt-3.5-turbo")
            prompt = (
                f"You are an expert ServiceNow assistant.\n"
                f"The user question is: {question}\n"
                f"Here is the output from the tool '{tool_name}':\n{json.dumps(result, default=str)}\n"
                "Summarize this output in 2-3 sentences, focusing on the most important information for the user."
            )
            response = openai.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": "You are a helpful AI assistant."},
                          {"role": "user", "content": prompt}],
                max_tokens=120
            )
            summary = response.choices[0].message.content.strip()
            return summary
        except Exception as e:
            logger.error(f"[SummarizeToolOutput] Exception: {e}\n{traceback.format_exc()}")
            return "[Summary unavailable due to error]"

    def _done_node(self, state):
        if self.verbose:
            print("[AgenticOrchestrator] [DONE] Workflow complete. Final state:", state, file=sys.stderr)
        logger.info("[DoneNode] Workflow complete. Final state: %s", state)
        # Do NOT synthesize final_answer here; let the API do it after receiving tool_outputs
        return {"__next__": None, **state}

    def _planner_node(self, state):
        if self.verbose:
            print(f"[AgenticOrchestrator] [PLANNER] Entered _planner_node with state: {json.dumps(state, default=str)}", file=sys.stderr)
        logger.info(f"[PlannerNode] Entered with state: {json.dumps(state, default=str)}")
        logger.info(f"[PlannerNode] parking_lot at entry: {state.get('parking_lot', 'MISSING')}")
        # Only the planner node should update planner-only keys; filter out tool-only keys
        filtered_state = {k: v for k, v in state.items() if k not in TOOL_ONLY_KEYS}
        # Explicitly ensure tool_outputs is not present
        if 'tool_outputs' in filtered_state:
            if self.verbose:
                print(f"[AgenticOrchestrator] [PLANNER] Removing tool_outputs from filtered_state before return. State keys: {list(filtered_state.keys())}", file=sys.stderr)
            del filtered_state['tool_outputs']
        # Always propagate parking_lot, even if missing
        if "parking_lot" not in filtered_state or not isinstance(filtered_state["parking_lot"], dict):
            filtered_state["parking_lot"] = state.get("parking_lot", {}) if isinstance(state.get("parking_lot", None), dict) else {}
        def log_and_return(next_node, state_dict):
            return_state = dict(state_dict)
            # Remove tool_outputs if present, and DO NOT set it to None
            if 'tool_outputs' in return_state:
                del return_state['tool_outputs']
            # Always propagate parking_lot
            if "parking_lot" not in return_state or not isinstance(return_state["parking_lot"], dict):
                return_state["parking_lot"] = state.get("parking_lot", {}) if isinstance(state.get("parking_lot", None), dict) else {}
            logger.info(f"[PlannerNode] log_and_return to {next_node} with state keys: {list(return_state.keys())}")
            logger.info(f"[PlannerNode] log_and_return parking_lot: {return_state.get('parking_lot', 'MISSING')}")
            print(f"[AgenticOrchestrator] [PLANNER] Returning to {next_node} with state keys: {list(return_state.keys())}", file=sys.stderr)
            return {"__next__": next_node, **return_state}
        # Robustly check for done in all cases
        if state.get("done"):
            logger.info(f"[PlannerNode] Plan is done. Routing to done node. Returning state: {json.dumps(filtered_state, default=str)}")
            filtered_state = dict(filtered_state)
            filtered_state["done"] = True
            return log_and_return("done", filtered_state)
        plan = state.get("plan", [])
        plan_step = state.get("plan_step", 0)
        if plan and plan_step < len(plan):
            logger.info(f"[PlannerNode] Routing to tool_dispatch (plan_step={plan_step}). Returning state: {json.dumps(filtered_state, default=str)}")
            print(f"[AgenticOrchestrator] [PLANNER] Routing to tool_dispatch (plan_step={plan_step}). Returning state: {json.dumps(filtered_state, default=str)}", file=sys.stderr)
            return log_and_return("tool_dispatch", filtered_state)
        if plan and plan_step >= len(plan):
            logger.info(f"[PlannerNode] All plan steps complete. Routing to done node. Returning state: {json.dumps(filtered_state, default=str)}")
            print(f"[AgenticOrchestrator] [PLANNER] All plan steps complete. Routing to done node. Returning state: {json.dumps(filtered_state, default=str)}", file=sys.stderr)
            filtered_state = dict(filtered_state)
            filtered_state["done"] = True
            return log_and_return("done", filtered_state)
        # If a plan exists and is not done, immediately route to tool_dispatch with the current state
        if state.get("plan") and len(state["plan"]) > 0 and state.get("plan_step", 0) < len(state["plan"]):
            logger.info(f"[PlannerNode] Already have a plan and not done, routing to tool_dispatch. Returning state: {json.dumps(state, default=str)}")
            print(f"[AgenticOrchestrator] [PLANNER] Already have a plan and not done, routing to tool_dispatch. Returning state: {json.dumps(state, default=str)}", file=sys.stderr)
            return {"__next__": "tool_dispatch", **state}
        # --- CONDITIONAL LLM PLAN COMPARISON LOGIC ---
        if getattr(self, "use_llm_plan_comparison", False):
            try:
                logger.info(f"[Planner] Planning next steps with state: {state}")
                messages = state.get("messages", [])
                prompt = state.get("prompt", "")
                metadata = state.get("metadata", {})
                username = state.get("username", None)
                question = state.get("question", "")
                # Fetch both agentic (LLM) and custom function sequence plans
                agentic_result = process_question_with_prompt_and_metadata(question, prompt, metadata, username=username, agentic_mode=True)
                agentic_plan = agentic_result["function_sequence"] if isinstance(agentic_result, dict) else agentic_result
                # Fetch custom plan (legacy/rules-based)
                try:
                    # Conditional planner version selection
                    planner_version = os.getenv('PLANNER_VERSION', 'default').lower()
                    if planner_version == 'retrieval':
                        from .langgraph_flow_retrieval import determine_function_sequence, Command  # type: ignore
                    else:
                        from .langgraph_flow import determine_function_sequence, Command  # type: ignore
                    custom_command = Command(question=question, prompt=prompt, metadata=metadata)
                    if username:
                        custom_command.username = username
                    custom_command = determine_function_sequence(custom_command)  # type: ignore
                    custom_plan = custom_command.function_sequence
                except Exception as e:
                    logger.error(f"[Planner] Exception fetching custom plan: {e}\n{traceback.format_exc()}")
                    custom_plan = []
                # Log both plans
                logger.info(f"[Planner] Agentic (LLM) plan: {agentic_plan}")
                logger.info(f"[Planner] Custom function sequence: {custom_plan}")
                if self.verbose:
                    print(f"[AgenticOrchestrator] [PLANNER] Agentic (LLM) plan: {agentic_plan}", file=sys.stderr)
                    print(f"[AgenticOrchestrator] [PLANNER] Custom function sequence: {custom_plan}", file=sys.stderr)
                # If plans differ, ask LLM to compare and recommend/adjust
                final_plan = agentic_plan
                if agentic_plan != custom_plan and custom_plan:
                    try:
                        model = getenv("GPT_MODEL_NAME", "gpt-3.5-turbo")
                        compare_prompt = (
                            "You are an expert AI workflow orchestrator.\n"
                            f"The user question is: {question}\n"
                            f"Here is a plan generated by an LLM agent: {agentic_plan}\n"
                            f"Here is a plan generated by a custom rules-based system: {custom_plan}\n"
                            "Compare both plans. If the custom plan is more appropriate, adjust the agentic plan to match it, or merge the best aspects of both. "
                            "Return the final, step-by-step function sequence (as a JSON list of tool calls with arguments) that should be executed to best answer the user's question."
                        )
                        response = openai.chat.completions.create(
                            model=model,
                            messages=[{"role": "system", "content": "You are a helpful AI assistant."},
                                      {"role": "user", "content": compare_prompt}],
                            max_tokens=500
                        )
                        content = response.choices[0].message.content if response and response.choices and response.choices[0].message else None
                        try:
                            llm_adjusted = json.loads(content) if content else agentic_plan  # fall back to original plan
                        except Exception:
                            llm_adjusted = agentic_plan
                        logger.info(f"[Planner] LLM-adjusted plan after comparison: {llm_adjusted}")
                        if self.verbose:
                            print(f"[AgenticOrchestrator] [PLANNER] LLM-adjusted plan after comparison: {llm_adjusted}", file=sys.stderr)
                        final_plan = llm_adjusted
                    except Exception as e:
                        logger.error(f"[Planner] Exception during LLM plan comparison/adjustment: {e}\n{traceback.format_exc()}")
                        print(f"[AgenticOrchestrator] [PLANNER] Exception during LLM plan comparison/adjustment: {e}\n{traceback.format_exc()}", file=sys.stderr)
                # Use the final plan for execution
                from .agent_planner import CustomPlanner
                planner = CustomPlanner()
                plan = planner.plan(final_plan, self.tools)
                logger.info(f"[Planner] Final plan to execute (tool sequence):")
                if self.verbose:
                    print(f"[AgenticOrchestrator] [PLANNER] Final plan to execute:")
                    for idx, step in enumerate(plan):
                        tool_name = step.get('tool')
                        args = step.get('args', {})
                        print(f"    Step {idx+1}: tool='{tool_name}', args={args}", file=sys.stderr)
                logger.info(f"[PlannerNode] Routing to tool_dispatch after planning. Returning state: {json.dumps(filtered_state, default=str)}")
                print(f"[AgenticOrchestrator] [PLANNER] Routing to tool_dispatch after planning. Returning state: {json.dumps(filtered_state, default=str)}", file=sys.stderr)
                return log_and_return("tool_dispatch", filtered_state)
            except Exception as e:
                logger.error(f"[Planner] Exception: {e}\n{traceback.format_exc()}")
                print(f"[AgenticOrchestrator] Exception in _planner_node: {e}\n{traceback.format_exc()}", file=sys.stderr)
                filtered_state = dict(filtered_state)
                filtered_state["planner_error"] = str(e)
                filtered_state["planner_traceback"] = traceback.format_exc()
                filtered_state["done"] = True
                logger.info(f"[PlannerNode] Exception branch. Returning state: {json.dumps(filtered_state, default=str)}")
                print(f"[AgenticOrchestrator] [PLANNER] Exception branch. Returning state: {json.dumps(filtered_state, default=str)}", file=sys.stderr)
                return log_and_return("done", filtered_state)
        # --- END CONDITIONAL LLM PLAN COMPARISON LOGIC ---
        # Default: always propose a new agentic plan if no plan exists
        agentic_plan = self.agentic_planner_suggest(state)
        plan = agentic_plan if agentic_plan else []
        if self.verbose:
            print(f"[AgenticOrchestrator] [PLANNER] (Agentic only) Full plan to execute: {json.dumps(plan, default=str)}", file=sys.stderr)
        for idx, step in enumerate(plan):
            if isinstance(step, dict):
                logger.info(f"[PlannerNode] Step {idx+1}: tool='{step.get('tool')}', args={step.get('args', {})}")
            else:
                logger.warning(f"[PlannerNode] Plan step {idx+1} is not a dict: {step}")
        filtered_state = dict(filtered_state)
        filtered_state["plan"] = plan
        filtered_state["plan_step"] = 0
        filtered_state["done"] = False
        return log_and_return("tool_dispatch", filtered_state)

    def _run_tool(self, state, tool, tool_name):
        logger.info(f"[ToolRunner] Entered _run_tool for {tool_name} with plan_step={state.get('plan_step')}, plan={json.dumps(state.get('plan', []), default=str)}")
        print(f"[AgenticOrchestrator] [TOOL] Entered _run_tool for {tool_name} with plan_step={state.get('plan_step')}, plan={json.dumps(state.get('plan', []), default=str)}", file=sys.stderr)
        logger.info(f"[ToolRunner] parking_lot at entry: {state.get('parking_lot', 'MISSING')}")
        if state.get("done"):
            logger.info(f"[ToolRunner] Plan is done. Routing to done node.")
            print(f"[AgenticOrchestrator] [TOOL] Plan is done. Routing to done node.", file=sys.stderr)
            # Only remove PLANNER_ONLY_KEYS except parking_lot
            filtered_state = {k: v for k, v in state.items() if k not in (PLANNER_ONLY_KEYS - {"parking_lot"})}
            return {"__next__": "done", **filtered_state}
        try:
            plan = state.get("plan", [])
            step = state.get("plan_step", 0)
            if not plan:
                logger.warning(f"[ToolRunner] Plan is empty. Returning to planner to generate a plan.")
                print(f"[AgenticOrchestrator] [TOOL] Plan is empty. Returning to planner to generate a plan.", file=sys.stderr)
                filtered_state = {k: v for k, v in state.items() if k not in (PLANNER_ONLY_KEYS - {"parking_lot"})}
                return {"__next__": "planner", **filtered_state}
            if step >= len(plan):
                logger.info(f"[ToolRunner] All plan steps complete. Routing to done node.")
                print(f"[AgenticOrchestrator] [TOOL] All plan steps complete. Routing to done node.", file=sys.stderr)
                state["done"] = True
                # Ensure parking_lot is present in both state and filtered_state
                if "parking_lot" not in state or not isinstance(state["parking_lot"], dict):
                    state["parking_lot"] = {}
                filtered_state = {k: v for k, v in state.items() if k not in (PLANNER_ONLY_KEYS - {"parking_lot"})}
                filtered_state["parking_lot"] = state["parking_lot"]
                return {"__next__": "done", **filtered_state}

            tool_call = plan[step]
            tool_name_from_plan = tool_call.get("tool") or tool_call.get("function_name")
            args = tool_call.get("args") or tool_call.get("arguments") or {}
            if not isinstance(args, dict):  # Defensive: normalize args to dict
                # If args is a list with single dict element, unwrap; else replace
                if isinstance(args, list) and len(args) == 1 and isinstance(args[0], dict):
                    args = args[0]
                else:
                    logger.warning(f"[ToolRunner] Unexpected args type {type(args)}, resetting to empty dict for tool {tool_name}")
                    args = {}
            if tool_name_from_plan != tool_name:
                logger.warning(f"[ToolRunner] Not this tool's turn: expected {tool_name_from_plan}, got {tool_name}. Skipping. State plan_step={step}, plan={plan}, state keys={list(state.keys())}")
                print(f"[AgenticOrchestrator] [TOOL] Not this tool's turn: expected {tool_name_from_plan}, got {tool_name}. Skipping. State plan_step={step}, plan={plan}, state keys={list(state.keys())}", file=sys.stderr)
                filtered_state = {k: v for k, v in state.items() if k not in (PLANNER_ONLY_KEYS - {"parking_lot"})}
                return {"__next__": "planner", **filtered_state}

            # --- Smart input resolution from parking_lot ---
            # Ensure parking_lot exists in state and is a dict
            state = dict(state)  # Ensure state is mutable
            if "parking_lot" not in state or not isinstance(state["parking_lot"], dict):
                state["parking_lot"] = {}
            parking_lot = dict(state["parking_lot"])  # Make a mutable copy

            # Argument resolution for tool chaining: replace placeholders like <short_description_from_previous_step>
            def resolve_placeholder(val):
                if isinstance(val, str) and val.startswith("<") and val.endswith(">"):
                    # Example: <short_description_from_previous_step>
                    # Try to extract the field and previous tool name
                    # Convention: <field_from_previous_step> or <field_from_toolname>
                    field = val[1:-1]
                    # Try to resolve from previous tool output (last step)
                    prev_step = step - 1
                    if prev_step >= 0:
                        prev_tool_call = plan[prev_step]
                        prev_tool_name = prev_tool_call.get("tool") or prev_tool_call.get("function_name")
                        prev_output = parking_lot.get(prev_tool_name, {}).get("output", {})
                        # Try direct field
                        if field in prev_output:
                            return prev_output[field]
                        # Try nested dicts (e.g., incident dict)
                        if isinstance(prev_output, dict):
                            for v in prev_output.values():
                                if isinstance(v, dict) and field in v:
                                    return v[field]
                    # Fallback: try all previous tool outputs
                    for prev_tool, data in parking_lot.items():
                        output = data.get("output", {})
                        if field in output:
                            return output[field]
                        if isinstance(output, dict):
                            for v in output.values():
                                if isinstance(v, dict) and field in v:
                                    return v[field]
                    logger.warning(f"[ToolRunner] Could not resolve placeholder {val} for tool {tool_name}")
                return val

            # Recursively resolve all placeholders in args
            def resolve_args(obj):
                if isinstance(obj, dict):
                    return {k: resolve_args(v) for k, v in obj.items()}
                elif isinstance(obj, list):
                    return [resolve_args(v) for v in obj]
                else:
                    return resolve_placeholder(obj)

            args = resolve_args(args)

            # Check for explicit 'input_from' in args
            if isinstance(args, dict) and "input_from" in args:
                prev_tool = args.get("input_from")
                if isinstance(prev_tool, str) and prev_tool in parking_lot:
                    args["input"] = parking_lot[prev_tool]

            # Scan all args for dicts like {"from_tool": "tool_name"} and resolve
            def resolve_arg(val):
                if isinstance(val, dict) and "from_tool" in val:
                    ref_tool = val["from_tool"]
                    return parking_lot.get(ref_tool)
                return val
            if isinstance(args, dict):
                args = {k: resolve_arg(v) for k, v in args.items()}

            # --- LLM-assisted input resolution (legacy, optional) ---
            # --- NEW: Dynamic LLM-assisted extraction of missing required arguments ---
            missing_params = []
            # Try to inspect tool for required arguments (Pydantic or function signature)
            if hasattr(tool, 'args_schema') and hasattr(tool.args_schema, 'schema'):
                schema = tool.args_schema.schema()
                for prop, details in schema.get('properties', {}).items():
                    if prop not in args and prop not in ['self', 'cls']:
                        if prop in schema.get('required', []):
                            missing_params.append(prop)
                        elif 'default' not in details:
                            missing_params.append(prop)
            elif hasattr(tool, '__code__'):
                import inspect
                sig = inspect.signature(tool)
                for name, param in sig.parameters.items():
                    if name not in args and param.default is param.empty and name not in ['self', 'cls']:
                        missing_params.append(name)
            if missing_params:
                logger.info(f"[ToolRunner] Missing params for {tool_name}: {missing_params}. Invoking LLM to resolve.")
                context = f"Previous tool outputs: {json.dumps(state.get('tool_outputs', {}), default=str)}\nParking lot: {json.dumps(parking_lot, default=str)}\nCurrent tool: {tool_name}\nRequired params: {missing_params}"
                llm_prompt = (
                    f"Given the following previous tool outputs and parking lot, and the current tool's requirements, "
                    f"provide values for the missing parameters: {missing_params}.\n"
                    f"Context: {context}"
                    "\nReturn a JSON object with keys for each missing parameter."
                )
                model = getenv("GPT_MODEL_NAME", "gpt-3.5-turbo")
                try:
                    response = openai.chat.completions.create(
                        model=model,
                        messages=[{"role": "system", "content": "You are a helpful AI assistant."},
                                  {"role": "user", "content": llm_prompt}],
                        max_tokens=200
                    )
                    llm_content = response.choices[0].message.content if response and response.choices and response.choices[0].message else None
                    if llm_content:
                        try:
                            llm_args = json.loads(llm_content)
                            if isinstance(llm_args, dict):
                                if not isinstance(args, dict):
                                    logger.warning(f"[ToolRunner] Args became non-dict before LLM arg merge; resetting to empty dict. type={type(args)}")
                                    args = {}
                                for param in missing_params:
                                    if param in llm_args:
                                        args[param] = llm_args[param]
                            logger.info(f"[ToolRunner] LLM resolved args: {llm_args}")
                        except Exception as parse_e:
                            logger.warning(f"[ToolRunner] Failed to parse LLM args JSON: {parse_e}")
                except Exception as e:
                    logger.error(f"[ToolRunner] LLM input resolution failed: {e}\n{traceback.format_exc()}")

            # Run the tool
            try:
                logger.info(f"[ToolRunner] Running tool {tool_name} with args: {json.dumps(args, default=str)}")
                result = tool(**args) if isinstance(args, dict) else tool(args)
                logger.info(f"[ToolRunner] Tool {tool_name} executed successfully. Result: {json.dumps(result, default=str)}")
            except Exception as e:
                logger.error(f"[ToolRunner] Error running tool {tool_name}: {e}\n{traceback.format_exc()}")
                result = {"error": str(e), "traceback": traceback.format_exc()}

            # Store output in tool_outputs and parking_lot (with summary)
            if "tool_outputs" not in state:
                state["tool_outputs"] = {}
            tool_outputs = dict(state["tool_outputs"])
            tool_outputs[tool_name] = [result]
            state["tool_outputs"] = tool_outputs

            # Summarize the tool output using LLM
            question = state.get("question", "")
            summary = self._summarize_tool_output(tool_name, result, question=question)
            # Add to parking_lot: store both full output and summary
            parking_lot[tool_name] = {"output": result, "summary": summary}
            state["parking_lot"] = parking_lot
            logger.info(f"[ToolRunner] Updated parking_lot: {json.dumps(state['parking_lot'], default=str)}")

            state["plan_step"] = step + 1
            logger.info(f"[ToolRunner] Finished {tool_name}, incremented plan_step to {state['plan_step']}")
            if self.verbose:
                print(f"[AgenticOrchestrator] [TOOL] Finished {tool_name}, incremented plan_step to {state['plan_step']}", file=sys.stderr)
            # --- Always include parking_lot and plan_step in filtered_state ---
            filtered_state = {k: v for k, v in state.items() if k not in (PLANNER_ONLY_KEYS - {"parking_lot", "plan_step"})}
            filtered_state["plan_step"] = state["plan_step"]  # Always persist the incremented plan_step
            # --- Ensure parking_lot is always present and is a dict in filtered_state ---
            if "parking_lot" not in state or not isinstance(state["parking_lot"], dict):
                filtered_state["parking_lot"] = {}
            else:
                filtered_state["parking_lot"] = dict(state["parking_lot"])  # Make a mutable copy
            logger.info(f"[ToolRunner] Returning state with plan_step={filtered_state['plan_step']} (should be incremented)")
            if self.verbose:
                print(f"[AgenticOrchestrator] [TOOL] Returning state with plan_step={filtered_state['plan_step']} (should be incremented)", file=sys.stderr)
            if state["plan_step"] >= len(plan):
                logger.info(f"[ToolRunner] All plan steps complete after {tool_name}. Routing to done node.")
                if self.verbose:
                    print(f"[AgenticOrchestrator] [TOOL] All plan steps complete after {tool_name}. Routing to done node.", file=sys.stderr)
                state["done"] = True
                return {"__next__": "done", **filtered_state}
            logger.info(f"[ToolRunner] Routing to tool_dispatch for next tool after {tool_name}.")
            if self.verbose:
                print(f"[AgenticOrchestrator] [TOOL] Routing to tool_dispatch for next tool after {tool_name}.", file=sys.stderr)
            return {"__next__": "tool_dispatch", **filtered_state}
        except Exception as e:
            logger.error(f"[ToolRunner] Exception in _run_tool for {tool_name}: {e}\n{traceback.format_exc()}")
            if self.verbose:
                print(f"[AgenticOrchestrator] Exception in _run_tool for {tool_name}: {e}\n{traceback.format_exc()}", file=sys.stderr)
            state["toolrunner_error"] = str(e)
            state["toolrunner_traceback"] = traceback.format_exc()
            state["done"] = True
            filtered_state = {k: v for k, v in state.items() if k not in (PLANNER_ONLY_KEYS - {"parking_lot"})}
            return {"__next__": "done", **filtered_state}

    def export_graph_dot(self, runner=None, dot_path="langgraph_latest.dot"):
        """
        Export the compiled LangGraph to DOT format and save to a file.
        If runner is not provided, compiles the current graph.
        Returns the DOT string.
        """
        try:
            if runner is None:
                runner = self.graph.compile()
            # The following line is commented out because CompiledStateGraph does not have to_dot().
            # dot_str = runner.to_dot()
            # with open(dot_path, "w", encoding="utf-8") as f:
            #     f.write(dot_str)
            # logger.info(f"[AgenticOrchestrator] Exported LangGraph DOT to {dot_path}")
            # return dot_str
            logger.info(f"[AgenticOrchestrator] DOT export is not supported in this version of LangGraph.")
            return None
        except Exception as e:
            logger.error(f"[AgenticOrchestrator] Failed to export DOT: {e}\n{traceback.format_exc()}")
            return None

    def get_recent_chat_summaries(self, username, n=5):
        """
        Fetch the last n Q&A summaries for the user from chat_history (TinyDB).
        Returns a list of dicts: [{question, answer}, ...]
        """
        db = TinyDB("state_db.json")
        chat_table = db.table("chat_history")
        messages = chat_table.search((Query().username == username))
        messages = sorted(messages, key=lambda x: x.get("timestamp", 0))
        qa_pairs = []
        i = 0
        while i < len(messages) - 1:
            if messages[i]["sender"] == "user" and messages[i+1]["sender"] == "server":
                qa_pairs.append({
                    "question": messages[i]["text"],
                    "answer": messages[i+1]["text"]
                })
                if len(qa_pairs) == n:
                    break
                i += 2
            else:
                i += 1
        return qa_pairs[-n:] if len(qa_pairs) > n else qa_pairs

    def solve(self, messages, prompt, metadata, username=None, max_iters=5):
        if self.verbose:
            print(f"[AgenticOrchestrator] Entered solve with messages: {messages}, prompt: {prompt}, metadata: {metadata}, username: {username}", file=sys.stderr)
        # Use only the last N chat summaries for context
        chat_summaries = self.get_recent_chat_summaries(username, n=5) if username else []
        # Use the last message as the question, others as context
        if messages:
            question = messages[-1]["content"] if isinstance(messages[-1], dict) and "content" in messages[-1] else str(messages[-1])
            context_messages = messages[:-1]
        else:
            question = ""
            context_messages = []
        if self.verbose:
            print(f"[AgenticOrchestrator] Using question: {question}", file=sys.stderr)
            print(f"[AgenticOrchestrator] Using context_messages: {context_messages}", file=sys.stderr)
            print(f"[AgenticOrchestrator] Using chat_summaries: {chat_summaries}", file=sys.stderr)
        # Only keep the last N chat summaries in state
        if chat_summaries:
            state_messages = chat_summaries
        else:
            # If no chat summaries, use the current question as the only message
            state_messages = [{"role": "user", "content": question}]
        # Prune context_messages to last 5 user/assistant turns
        def prune_context_messages(context_messages, max_turns=5):
            pruned = []
            for msg in reversed(context_messages):
                if isinstance(msg, dict) and msg.get('role') in ('user', 'assistant'):
                    pruned.append(msg)
                if len(pruned) >= max_turns * 2:
                    break
            return list(reversed(pruned))
        context_messages = prune_context_messages(context_messages, max_turns=5)
        # Initialize state with all required fields
        state = {
            "messages": state_messages,  # Use chat_summaries or current question
            "prompt": prompt,
            "metadata": metadata,
            "username": username,
            "plan": [],
            "plan_step": 0,
            "question": question,
            "context_messages": context_messages,
            "done": False
        }
        # Compile the graph for execution (LangGraph >=0.5.1)
        runner = self.graph.compile()
        # Export the graph to DOT format after compilation
        self.export_graph_dot(runner)
        for i in range(max_iters):
            if self.verbose:
                print(f"[AgenticOrchestrator] Iteration {i} state BEFORE invoke: {state}", file=sys.stderr)
            try:
                if self.verbose:
                    print(f"[AgenticOrchestrator] Invoking runner for iteration {i}...", file=sys.stderr)
                # Cast for static type checker; runtime API accepts a dict matching schema.
                state = runner.invoke(state)  # type: ignore[arg-type]
                if self.verbose:
                    print(f"[AgenticOrchestrator] Iteration {i} state AFTER invoke: {state}", file=sys.stderr)
            except Exception as e:
                logger.error(f"[AgenticOrchestrator] Exception during runner.invoke at iteration {i}: {e}\n{traceback.format_exc()}")
                if self.verbose:
                    print(f"[AgenticOrchestrator] Exception during runner.invoke at iteration {i}: {e}\n{traceback.format_exc()}", file=sys.stderr)
                state["runner_error"] = str(e)
                state["runner_traceback"] = traceback.format_exc()
                state["done"] = True
                break
            if state.get("done"):
                if self.verbose:
                    print(f"[AgenticOrchestrator] Exiting solve early, state: {state}", file=sys.stderr)
                break
        if self.verbose:
            print(f"[AgenticOrchestrator] Returning state from solve: {state}", file=sys.stderr)
        # Always attach function_sequence and feedback_payload for frontend feedback
        # Use the executed plan as function_sequence
        state["function_sequence"] = state.get("plan", [])
        # feedback_payload can be the plan results or tool_outputs
        state["feedback_payload"] = state.get("tool_outputs", {})
        return state

# Alias for import compatibility
AgenticOrchestrator = LangGraphAgenticOrchestrator
