import sys
import logging
import os
import json
import re
from os import getenv
from typing import List, Dict, Any, Optional, Iterable, Sequence
import time
try:  # Modern split packages attempt first
    from langchain.agents import initialize_agent  # type: ignore
except Exception:  # pragma: no cover
    def initialize_agent(*a, **k):  # type: ignore
        return None
try:
    from langchain_community.tools import Tool  # type: ignore
except Exception:  # pragma: no cover
    try:
        from langchain.tools import Tool  # type: ignore
    except Exception:
        class Tool:  # type: ignore
            def __init__(self, *a, **k): pass
try:
    # OpenAI provider moved to separate package in newer versions
    from langchain_openai import OpenAI  # type: ignore
except Exception:  # pragma: no cover
    try:
        from langchain.llms import OpenAI  # type: ignore
    except Exception:
        class OpenAI:  # type: ignore
            def __init__(self, *a, **k): pass
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
        def add_conditional_edges(self, *a, **k):
            return None
        def set_entry_point(self, *a, **k):
            return None
        def compile(self):
            class _Runner:
                def invoke(self, state):
                    return state
            return _Runner()
    logger = logging.getLogger("agentic_orchestrator_auto")
    logger.warning(f"[agentic_orchestrator_auto] Failed importing StateGraph: {_STATEGRAPH_IMPORT_ERROR}; using shim (LangGraph disabled).")
from .agentic_orchestrator_auto_tools import agentic_orchestrator_auto_tools
from .chunking_tool import chunk_output
import traceback
from .planner_selector import select_and_plan
try:
    # Lightweight import of retrieval planner determine_function_sequence if available.
    from .langgraph_flow_retrieval import determine_function_sequence as retrieval_determine_function_sequence, Command as RetrievalCommand  # type: ignore
except Exception:  # pragma: no cover
    retrieval_determine_function_sequence = None  # type: ignore
    RetrievalCommand = None  # type: ignore
from .servicenowgenaitool import get_similar_incidents_simple, fetch_servicenow_incident_core
from .trace_export import export_traces
from .persona_registry import select_persona, PERSONA_DEFS
from .intent_classifier import classify_intent
from .intent_config import classify_with_config
from .plan_recipes import build_recipe
from .recipe_evaluator import evaluate_recipe
from .servicenow_incident_schema_planner import answer_field_question
try:
    from backend.events.emitter import emit_event  # type: ignore
except Exception:  # pragma: no cover
    def emit_event(*a: Any, **k: Any) -> Optional[Dict[str, Any]]:  # Fallback stub keeps return signature flexible
        return None

# Configure logging
class PrettyJSONFormatter(logging.Formatter):
    """Formatter that pretty-prints embedded JSON substrings when env flag PRETTY_JSON_LOG is enabled.

    Heuristic: if the message looks like a JSON object/array (starts with '{' or '[' and ends with '}' or ']') or contains a '"plan": [' sequence,
    attempt to reformat. Avoid raising exceptions; fall back to original msg when parsing fails.
    """
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        msg = record.getMessage()
        pretty = msg
        try:
            candidate = msg.strip()
            if (candidate.startswith('{') and candidate.endswith('}')) or (candidate.startswith('[') and candidate.endswith(']')):
                obj = json.loads(candidate)
                pretty_obj = json.dumps(obj, indent=2, sort_keys=True)
                pretty = pretty_obj
            elif '"plan": [' in candidate and candidate.count('{') > 0:
                # Try to extract the JSON part after first '{'
                first_brace = candidate.find('{')
                fragment = candidate[first_brace:]
                # Balance braces roughly
                # Simple fallback: attempt full parse
                try:
                    obj = json.loads(fragment)
                    pretty = candidate[:first_brace] + json.dumps(obj, indent=2, sort_keys=True)
                except Exception:
                    pass
        except Exception:
            pass
        # Replace only the message portion, keep timestamp/level prefix from base
        if pretty != msg:
            # base contains prefix + original message; swap trailing portion
            prefix_len = len(base) - len(msg)
            return base[:prefix_len] + pretty
        return base

use_pretty = os.getenv('PRETTY_JSON_LOG', '').lower() in ('1','true','yes','on')
base_format = '%(asctime)s %(levelname)s %(name)s: %(message)s'
log_formatter = PrettyJSONFormatter(base_format) if use_pretty else logging.Formatter(base_format)
file_handler = logging.FileHandler('agentic_orchestrator_auto.log', mode='a', encoding='utf-8')
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
console_handler.setLevel(logging.WARNING)
logger = logging.getLogger("agentic_orchestrator_auto")
logger.setLevel(logging.INFO)
if not logger.hasHandlers():
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

# If verbose ServiceNow logging requested, elevate file handler + logger to DEBUG so propagated debug entries are written.
if os.getenv('SERVICENOW_VERBOSE_LOG', '').lower() in ('1','true','yes','on'):
    try:
        logger.setLevel(logging.DEBUG)
        for h in logger.handlers:
            if isinstance(h, logging.FileHandler):
                h.setLevel(logging.DEBUG)
        logger.debug('[AgenticOrchestratorAuto] Elevated log level to DEBUG due to SERVICENOW_VERBOSE_LOG')
    except Exception as _e:  # pragma: no cover
        pass

class AgenticOrchestratorAuto:
    def get_recent_chat_summaries(self, username, n=5):
        """
        Fetch the last n Q&A summaries for the user from chat_history (TinyDB).
        Returns a list of dicts: [{"role": "user", "content": question}, {"role": "assistant", "content": answer}, ...]
        """
        from tinydb import TinyDB, Query
        db = TinyDB("state_db.json")
        chat_table = db.table("chat_history")
        messages = chat_table.search((Query().username == username))
        messages = sorted(messages, key=lambda x: x.get("timestamp", 0))
        qa_pairs = []
        i = 0
        while i < len(messages) - 1:
            if messages[i]["sender"] == "user" and messages[i+1]["sender"] == "server":
                qa_pairs.append({
                    "role": "user",
                    "content": messages[i]["text"]
                })
                qa_pairs.append({
                    "role": "assistant",
                    "content": messages[i+1]["text"]
                })
                if len(qa_pairs) // 2 == n:
                    break
                i += 2
            else:
                i += 1
        return qa_pairs[-2*n:] if len(qa_pairs) > 2*n else qa_pairs
    def __init__(self, tools=agentic_orchestrator_auto_tools, verbose: Optional[bool] = None):
        env_verbose = getenv("AGENTIC_VERBOSE", "false").lower()
        self.verbose = verbose if verbose is not None else env_verbose in ("1", "true", "yes", "on")
        # Use the central registry for all tools
        self.tools: Dict[str, Any] = tools
        # Active execution plan (list of step dicts)
        self.plan: List[Dict[str, Any]] = []
        # Accumulated tool outputs keyed by tool name
        self.tool_outputs: Dict[str, Any] = {}
        # Error messages collected during planning/execution
        self.errors: List[str] = []
        # Execution traces
        self.traces: List[Dict[str, Any]] = []

    def plan_tools(self, question: str, prompt: str, metadata: Dict[str, Any], username: Optional[str] = None) -> List[Dict[str, Any]] | Dict[str, Any]:
        # Use LLM or DB to generate a plan (function sequence)
        # Enhancement: optional retrieval narrowing prior to standard planner selection.
        # Controlled by env AGENTIC_USE_RETRIEVAL=1 (non-breaking default disabled).
        try:
            diagnostics: Dict[str, Any] = {}
            mode: str = ''
            plan_raw: Any = []
            use_retrieval = os.getenv('AGENTIC_USE_RETRIEVAL', '0').lower() in ('1','true','yes','on')
            retrieval_plan: List[Dict[str, Any]] = []
            retrieval_subset_tools: List[str] = []
            retrieval_diag: Dict[str, Any] = {}
            if use_retrieval and retrieval_determine_function_sequence and RetrievalCommand:
                try:
                    r_cmd = RetrievalCommand(question=question, prompt=prompt, metadata=metadata)  # type: ignore[call-arg]
                    r_cmd = retrieval_determine_function_sequence(r_cmd)  # type: ignore
                    retrieval_plan = r_cmd.function_sequence if hasattr(r_cmd, 'function_sequence') else []
                    # Only keep valid string function names to satisfy declared type List[str]
                    tmp_tools: List[str] = []
                    for _step in retrieval_plan:
                        if isinstance(_step, dict):
                            fn_name = _step.get('function_name')
                            if isinstance(fn_name, str):
                                tmp_tools.append(fn_name)
                    retrieval_subset_tools = tmp_tools
                    retrieval_diag = {
                        'retrieval_selected_tool_count': len(retrieval_subset_tools),
                        'retrieval_selected_tools': retrieval_subset_tools,
                        'retrieval_applied': True
                    }
                    logger.info(f"[AgenticOrchestratorAuto][RETRIEVAL] Pre-selected tools via retrieval subset={retrieval_subset_tools}")
                except Exception as r_e:
                    logger.warning(f"[AgenticOrchestratorAuto][RETRIEVAL] Retrieval pre-planning failed; falling back. Error={r_e}")
                    retrieval_diag = {'retrieval_error': str(r_e), 'retrieval_applied': False}
            # Proceed with existing planner selection (select_and_plan). We do NOT force retrieval plan; we may log it for comparison.
            plan_raw, std_diag, mode = select_and_plan(question, prompt, metadata, username=username)  # type: ignore[call-arg]
            diagnostics = {'standard_planner': std_diag, 'retrieval_prefilter': retrieval_diag}
            # Ensure plan_raw is an iterable of dict steps; planner may return other structures on failure
            plan_list: List[Dict[str, Any]] = []
            if isinstance(plan_raw, list):
                for s in plan_raw:
                    if isinstance(s, dict):
                        plan_list.append(s)
            plan = plan_list
            # Diagnostic enrichment: compare overlap (if retrieval applied)
            if retrieval_subset_tools:
                overlap = [step for step in plan if (step.get('function_name') or step.get('tool')) in retrieval_subset_tools]
                diagnostics['retrieval_overlap_ratio'] = (len(overlap) / len(plan)) if plan else 0.0
                diagnostics['retrieval_overlap_tools'] = list({(step.get('function_name') or step.get('tool')) for step in overlap})
            logger.info(f"[AgenticOrchestratorAuto] Planner mode={mode} plan={plan} diagnostics={json.dumps(diagnostics, default=str)}")

            # Validate plan entries: disallow annotations and unknown function names
            validated_plan = []
            invalid_entries = []
            for step in plan:
                # Defensive: skip any non-dict (should not happen after filtering)
                if not isinstance(step, dict):
                    continue
                fn = step.get('function_name') or step.get('tool')
                if isinstance(fn, str) and fn.strip().startswith('@'):
                    invalid_entries.append((step, 'annotated function_name'))
                    continue
                if fn not in self.tools:
                    invalid_entries.append((step, 'unknown function_name'))
                    continue
                validated_plan.append(step)
            if invalid_entries:
                logger.warning(f"[AgenticOrchestratorAuto] Planner returned invalid plan entries: {invalid_entries}. Requesting clarification.")
                # Signal caller (solve) that clarification is required instead of throwing
                # Return a special object indicating clarification is needed
                self.plan = []
                self.errors.append(str(invalid_entries))
                return {"clarify_user": True, "invalid_entries": invalid_entries, "raw_plan": plan}

            self.plan = validated_plan  # type: ignore[assignment]
            logger.info(f"[AgenticOrchestratorAuto] Generated plan: {json.dumps(validated_plan, default=str)}")
            try:
                emit_event('agent.plan.generated', plan_size=len(validated_plan), used_recipe=False, plan_source='planner', intent=metadata.get('intent'), persona=metadata.get('persona'))
            except Exception:
                pass
            return validated_plan
        except Exception as e:
            logger.error(f"[AgenticOrchestratorAuto] Error generating plan: {e}\n{traceback.format_exc()}")
            self.errors.append(str(e))
            return []

    def execute_plan(self, question: str, prompt: str, metadata: Dict[str, Any], username: Optional[str] = None) -> Dict[str, Any]:
        self.tool_outputs = {}
        self.traces = []
        total_steps = len(self.plan)
        if total_steps == 0:
            logger.info("[AgenticOrchestratorAuto][EXEC_PLAN] No steps to execute (empty plan)")
            return self.tool_outputs

        # Pre-compute a simple reasoning map for known tools; can be expanded later or replaced by metadata in the plan
        reasoning_map = {
            'fetch_servicenow_incident': 'Fetch canonical incident record for downstream field or similarity operations',
            'get_similar_incidents': 'Retrieve similar incidents for comparison / related context',
            'find_incidents_by_short_description': 'Search incidents matching a short description fragment',
            'fetch_user_incidents': 'List incidents associated with the current user (ownership view)',
            'assignment_group_prediction': 'Predict likely assignment group based on context',
            'wiki_rag_tool': 'Retrieve contextual knowledge base / wiki snippets for enrichment'
        }

        logger.info(
            "[AgenticOrchestratorAuto][EXEC_PLAN] Starting execution: total_steps=%s intent=%s persona=%s question=%s",
            total_steps, metadata.get('intent'), metadata.get('persona'), (question or '')[:200]
        )

        # Helper to infer lightweight dependencies: checks if arg values appear inside previous tool output previews
        def infer_dependencies(arg_dict: Dict[str, Any], prior_outputs: Dict[str, Any]) -> List[str]:
            deps: List[str] = []
            if not isinstance(arg_dict, dict) or not prior_outputs:
                return deps
            # Serialize prior outputs (truncated) once
            serialized: Dict[str, str] = {}
            for k, v in prior_outputs.items():
                try:
                    s = json.dumps(v, default=str)
                except Exception:
                    s = str(v)
                serialized[k] = s[:2000]  # cap to avoid heavy scans
            for a_val in arg_dict.values():
                if not isinstance(a_val, (str, int, float)):
                    continue
                sval = str(a_val)
                for k, s in serialized.items():
                    if sval and sval in s:
                        deps.append(k)
                        break
            return deps

        executed = 0
        success = 0
        failures = 0
        for idx, step in enumerate(self.plan, start=1):
            if not isinstance(step, dict):
                logger.warning("[AgenticOrchestratorAuto][EXEC_PLAN] Skipping non-dict plan step index=%s raw=%s", idx, str(step))
                continue
            tool_name_any = step.get("tool") or step.get("function_name")
            tool_name: Optional[str] = tool_name_any if isinstance(tool_name_any, str) else None
            args = step.get("args") or step.get("arguments") or {}
            if tool_name is None:
                logger.error("[AgenticOrchestratorAuto][EXEC_PLAN] Invalid step missing tool/function_name at index=%s", idx)
                failures += 1
                continue
            pre_available = list(self.tool_outputs.keys())
            dependencies = infer_dependencies(args if isinstance(args, dict) else {}, self.tool_outputs)
            reason = step.get('description') or reasoning_map.get(tool_name, 'Execute tool as specified in plan order')
            progress_before = round(((idx - 1) / total_steps) * 100, 2)
            step_start_log = {
                'event': 'plan.step.start',
                'step_index': idx,
                'total_steps': total_steps,
                'progress_pct_before': progress_before,
                'tool': tool_name,
                'reason': reason,
                'args': args,
                'available_tools_prior': pre_available,
                'inferred_dependencies': dependencies,
            }
            try:
                logger.info("[AgenticOrchestratorAuto][EXEC_PLAN] %s", json.dumps(step_start_log, default=str))
            except Exception:
                logger.info("[AgenticOrchestratorAuto][EXEC_PLAN] STEP_START idx=%s tool=%s args=%s", idx, tool_name, str(args))
            try:
                tool_fn = self.tools.get(tool_name)
                if not tool_fn:
                    raise Exception(f"Tool '{tool_name}' not found.")
                if hasattr(tool_fn, 'func'):
                    fn_to_call = tool_fn.func  # LangChain Tool
                else:
                    fn_to_call = tool_fn
                trace_record: Dict[str, Any] = {
                    'tool': tool_name,
                    'arguments': args,
                    'start_time': time.time(),
                    'step_index': idx,
                    'total_steps': total_steps,
                    'reason': reason,
                    'dependencies': dependencies,
                }
                # Execute with kwargs if dict else positional
                try:
                    if isinstance(args, dict):
                        output = fn_to_call(**args)
                    else:
                        output = fn_to_call(args)
                except TypeError:
                    # Retry passing entire args object positionally
                    output = fn_to_call(args)
                # Chunk output
                output_chunks = chunk_output(output, max_tokens=1500)
                stored_output = output_chunks if len(output_chunks) > 1 else output
                self.tool_outputs[tool_name] = stored_output
                trace_record['end_time'] = time.time()
                trace_record['duration_ms'] = round((trace_record['end_time'] - trace_record['start_time']) * 1000, 2)
                trace_record['status'] = 'ok'
                # Output preview
                try:
                    if isinstance(output, (str, list, dict)):
                        preview = output
                        if isinstance(output, str) and len(output) > 300:
                            preview = output[:300] + '...'
                        trace_record['output_preview'] = preview
                    else:
                        trace_record['output_type'] = type(output).__name__
                except Exception:
                    pass
                self.traces.append(trace_record)
                executed += 1
                success += 1
                progress_after = round((idx / total_steps) * 100, 2)
                carried_forward = list(self.tool_outputs.keys())
                step_end_log = {
                    'event': 'plan.step.end',
                    'step_index': idx,
                    'tool': tool_name,
                    'status': 'ok',
                    'duration_ms': trace_record['duration_ms'],
                    'progress_pct_after': progress_after,
                    'new_output_keys': [tool_name],
                    'carried_forward_keys': carried_forward,
                }
                try:
                    logger.info("[AgenticOrchestratorAuto][EXEC_PLAN] %s", json.dumps(step_end_log, default=str))
                except Exception:
                    logger.info("[AgenticOrchestratorAuto][EXEC_PLAN] STEP_END idx=%s tool=%s status=ok duration_ms=%s", idx, tool_name, trace_record['duration_ms'])
            except Exception as e:
                failures += 1
                executed += 1
                err_trace = {
                    'tool': tool_name,
                    'arguments': args,
                    'error': str(e),
                    'status': 'error',
                    'step_index': idx,
                    'total_steps': total_steps,
                    'end_time': time.time()
                }
                if 'trace_record' in locals() and isinstance(trace_record, dict) and 'start_time' in trace_record:
                    err_trace['start_time'] = trace_record['start_time']
                    err_trace['duration_ms'] = round((err_trace['end_time'] - trace_record['start_time']) * 1000, 2)
                self.traces.append(err_trace)
                self.errors.append(f"{tool_name}: {str(e)}")
                progress_after = round((idx / total_steps) * 100, 2)
                step_error_log = {
                    'event': 'plan.step.error',
                    'step_index': idx,
                    'tool': tool_name,
                    'status': 'error',
                    'error': str(e),
                    'progress_pct_after': progress_after
                }
                logger.error(f"[AgenticOrchestratorAuto][EXEC_PLAN] {json.dumps(step_error_log, default=str)}\n{traceback.format_exc()}")
                # Continue to next step (no break) to maximize plan completion
                continue

        completion_log = {
            'event': 'plan.execution.complete',
            'total_steps': total_steps,
            'executed_steps': executed,
            'successes': success,
            'failures': failures,
            'completion_pct': round((executed / total_steps) * 100, 2),
            'all_steps_completed': executed == total_steps,
            'intent': metadata.get('intent'),
            'persona': metadata.get('persona')
        }
        try:
            logger.info("[AgenticOrchestratorAuto][EXEC_PLAN] %s", json.dumps(completion_log, default=str))
        except Exception:
            logger.info("[AgenticOrchestratorAuto][EXEC_PLAN] EXECUTION_COMPLETE executed=%s/%s success=%s failures=%s", executed, total_steps, success, failures)
        return self.tool_outputs

    # --------- Helpers for deterministic reference resolution ---------
    def _extract_incident_ids_from_messages(self, messages: List[Dict[str, Any]]) -> List[str]:
        """
        Return a list of incident ids (e.g., INC0000001) found in messages in order of appearance.
        messages: list of dicts with 'role' and 'content' or plain strings.
        """
        ids: List[str] = []
        if not messages:
            return ids
        pattern = re.compile(r"\bINC0*\d+\b", flags=re.IGNORECASE)
        for m in messages:
            text = ""
            if isinstance(m, dict):
                text = str(m.get('content', ''))
            else:
                text = str(m)
            try:
                found = pattern.findall(text)
                for f in found:
                    ids.append(f.upper())
            except Exception as e:
                logger.error(f"[AgenticOrchestratorAuto] Error extracting ids from message text: {e}")
        return ids

    def _extract_incident_ids_from_tool_outputs(self, tool_outputs: Dict[str, Any]) -> List[str]:
        """
        Extract incident ids from previous tool outputs. Serialize each output value to string and search for patterns.
        Returns ids in order of appearance across tool outputs.
        """
        ids: List[str] = []
        if not tool_outputs:
            return ids
        pattern = re.compile(r"\bINC0*\d+\b", flags=re.IGNORECASE)
        try:
            # Iterate in insertion order to preserve chronology
            for k, v in tool_outputs.items():
                txt = ''
                try:
                    txt = json.dumps(v, default=str)
                except Exception:
                    txt = str(v)
                found = pattern.findall(txt)
                for f in found:
                    ids.append(f.upper())
        except Exception as e:
            logger.error(f"[AgenticOrchestratorAuto] Error extracting ids from tool_outputs: {e}")
        return ids

    def solve(self, messages: List[Any], prompt: str, metadata: Dict[str, Any], username: Optional[str] = None) -> Dict[str, Any]:
        try:
            # Use recent chat summaries for context if available
            chat_summaries = self.get_recent_chat_summaries(username, n=5) if username else []
            # Use the last message as the question, others as context
            if messages:
                question = messages[-1]["content"] if isinstance(messages[-1], dict) and "content" in messages[-1] else str(messages[-1])
                context_messages = messages[:-1]
            else:
                question = ""
                context_messages = []
            # Combine chat_summaries and context_messages, prune to last 10 turns
            all_context = chat_summaries + context_messages
            def prune_context_messages(context_messages, max_turns=5):
                pruned = []
                for msg in reversed(context_messages):
                    if isinstance(msg, dict) and msg.get('role') in ('user', 'assistant'):
                        pruned.append(msg)
                    if len(pruned) >= max_turns * 2:
                        break
                return list(reversed(pruned))
            pruned_context = prune_context_messages(all_context, max_turns=5)
            logger.info(f"[AgenticOrchestratorAuto] solve called with question={question}, prompt={prompt}, metadata={metadata}, username={username}, context={pruned_context}")
            # Propagate username into metadata for recipe arg functions (e.g., fetch_user_incidents)
            if username and 'username' not in metadata:
                metadata['username'] = username

            # Intent classification (only if not already provided)
            try:
                if not metadata.get('intent'):
                    classified = classify_intent(question, metadata)
                    if classified:
                        metadata['intent'] = classified
                        logger.info(f"[AgenticOrchestratorAuto][INTENT] Classified intent='{classified}' from question.")
                # Post intent heuristic: detect user-owned incident queries
                q_lower = (question or '').lower()
                ownership_phrases = (
                    "my incidents","my open incidents","assigned to me","my backlog","my tickets",
                    "incidents for me","incidents assigned to me","incidents assigned to my user","show my incidents"
                )
                if not metadata.get('intent'):
                    cfg_hit = classify_with_config(question, metadata, enable_fuzzy=True)
                    if cfg_hit.get('intent'):
                        metadata['intent'] = cfg_hit['intent']
                        logger.info(f"[AgenticOrchestratorAuto][INTENT_HEURISTIC_CFG] Intent from config='{cfg_hit['intent']}'")
                        # Auto persona injection (does not override explicit or token persona already set earlier)
                        if cfg_hit.get('auto_persona') and not metadata.get('persona'):
                            metadata['persona'] = cfg_hit['auto_persona']
                            logger.info(f"[AgenticOrchestratorAuto][INTENT_HEURISTIC_CFG] Auto persona applied='{cfg_hit['auto_persona']}'")
                        # Store context injection spec for later retention
                        if cfg_hit.get('context_injection'):
                            metadata['context_injection'] = cfg_hit['context_injection']
                        # Attach debug of match type for observability (non-invasive)
                        if cfg_hit.get('_debug'):
                            metadata.setdefault('_intent_debug', cfg_hit['_debug'])
                    elif any(p in q_lower for p in ownership_phrases):
                        metadata['intent'] = 'user_incidents'
                        logger.info("[AgenticOrchestratorAuto][INTENT_HEURISTIC] Mapped ownership phrase to user_incidents intent (fallback)")
            except Exception as ic_e:
                logger.warning(f"[AgenticOrchestratorAuto][INTENT] Intent classification failed: {ic_e}")

            # Deterministic reference resolution: extract incident ids from the pruned context and prior tool outputs
            context_ids = self._extract_incident_ids_from_messages(pruned_context)
            tool_output_ids = self._extract_incident_ids_from_tool_outputs(self.tool_outputs)
            # prefer IDs from tool outputs first (they reflect executed data), then context
            known_incidents = tool_output_ids + [i for i in context_ids if i not in tool_output_ids]
            if known_incidents:
                logger.info(f"[AgenticOrchestratorAuto][RESOLVE] known_incidents={known_incidents} source=(tool_outputs then pruned_context)")
            else:
                logger.info("[AgenticOrchestratorAuto][RESOLVE] known_incidents=[]")

            # Assignment query heuristic: if user asks who it's assigned to and we have a single canonical incident in context
            try:
                q_low = (question or '').lower()
                assignment_phrases = (
                    'who is this assigned to',
                    'who is it assigned to',
                    'who is assigned to this',
                    'who owns this incident',
                    'who is the assignee',
                    'who is assigned',
                    'who owns this ticket'
                )
                # Only trigger when we have at least one known incident; prefer last (most recent) and avoid multi-step plan.
                if any(p in q_low for p in assignment_phrases) and known_incidents:
                    target_incident = known_incidents[-1]
                    logger.info(f"[AgenticOrchestratorAuto][ASSIGNMENT_HEURISTIC] Short-circuiting to single fetch for incident {target_incident}")
                    canonical = fetch_servicenow_incident_core(target_incident)
                    # Build lightweight answer fields (Assigned_To and assignment_group plus username normalization)
                    assigned_to = canonical.get('assigned_to') or canonical.get('u_assigned_to') if isinstance(canonical, dict) else None
                    assignment_group = canonical.get('assignment_group') if isinstance(canonical, dict) else None
                    # Return early with deterministic single-step plan
                    return {
                        'plan': [{'function_name': 'fetch_servicenow_incident', 'arguments': {'incident_number': target_incident}}],
                        'tool_outputs': {'fetch_servicenow_incident': canonical},
                        'question': question,
                        'metadata': {**metadata, 'plan_source': 'assignment_heuristic', 'known_incidents': known_incidents},
                        'username': username,
                        'context_messages': pruned_context,
                        'traces': [{'tool': 'fetch_servicenow_incident', 'arguments': {'incident_number': target_incident}, 'status': 'ok', 'assignment_fields': {'assigned_to': assigned_to, 'assignment_group': assignment_group}}],
                        'errors': self.errors
                    }
            except Exception as ah_e:
                logger.warning(f"[AgenticOrchestratorAuto][ASSIGNMENT_HEURISTIC] Failed: {ah_e}")

            # Context injection retention (for user_incidents etc.)
            retention = metadata.get('context_injection')
            if retention and isinstance(retention, dict):
                try:
                    summary_key = retention.get('summary_key') or 'intent_focus'
                    # Expire previous retained context(s) based on max_age_minutes if present
                    max_age = retention.get('max_age_minutes')
                    if isinstance(max_age, (int, float)) and max_age > 0:
                        cutoff = time.time() - (max_age * 60)
                        for mk in list(metadata.keys()):
                            if mk.startswith('context_') and isinstance(metadata.get(mk), dict):
                                cached_at = metadata[mk].get('cached_at') if isinstance(metadata[mk], dict) else None
                                if cached_at and cached_at < cutoff:
                                    logger.info(f"[AgenticOrchestratorAuto][CONTEXT_RETAIN] Expired retained context key={mk} age={(time.time()-cached_at)/60:.1f}m > {max_age}m")
                                    try:
                                        del metadata[mk]
                                    except Exception:
                                        pass
                    # Retain selected tool outputs executed previously when available
                    retain_list = retention.get('retain_tool_outputs') or []
                    retained_subset = {k: v for k, v in self.tool_outputs.items() if k in retain_list}
                    if retained_subset:
                        metadata[f'context_{summary_key}'] = {
                            'retained_tools': list(retained_subset.keys()),
                            'cached_at': time.time(),
                            'data_preview': {k: (v if isinstance(v, (dict, list)) else str(v)) for k, v in retained_subset.items()}
                        }
                        logger.info(f"[AgenticOrchestratorAuto][CONTEXT_RETAIN] Stored retained tools for summary_key={summary_key}: {list(retained_subset.keys())}")
                except Exception as ce:
                    logger.warning(f"[AgenticOrchestratorAuto][CONTEXT_RETAIN] Failed retention injection: {ce}")

            # If the context contains exactly one incident id, augment the planner prompt to force deterministic resolution
            augmented_prompt = prompt
            if len(known_incidents) == 1:
                augmented_prompt = (
                    f"{prompt}\n\nCONTEXT NOTE: In the recent conversation 'this incident' should be interpreted as {known_incidents[-1]}.\n"
                    "If the user asks about 'this incident' refer to that incident number and do not invent or change incident numbers."
                )
                logger.info(f"[AgenticOrchestratorAuto][PROMPT_AUGMENT] Injected resolution for 'this incident' -> {known_incidents[-1]}")
            else:
                # If ambiguous (multiple known incidents) include a short instruction to ask for clarification rather than guessing
                augmented_prompt = (
                    f"{prompt}\n\nCONTEXT NOTE: Multiple incident numbers appear in recent messages: {known_incidents}.\n"
                    "When the user says 'this incident' ask for clarification rather than guessing which incident they mean."
                ) if known_incidents else prompt
            # Pass pruned_context as messages to planning
            # Use augmented_prompt when invoking planner
            # Orchestrator pre-rule: if the user's question explicitly references an incident number
            # and asks for similar incidents, short-circuit the planner and call the similarity tool directly.
            inc_match = re.search(r"\b(INC0*\d+)\b", question or "", flags=re.IGNORECASE)
            disable_pre_rule = getenv("DISABLE_PRE_RULE", "false").lower() in ("1", "true", "yes", "on")
            if not disable_pre_rule and inc_match and re.search(r"similar|similar incidents|other similar|like this one", question or "", flags=re.IGNORECASE):
                inc_num = inc_match.group(1).upper()
                logger.info(f"[AgenticOrchestratorAuto][PRE_RULE] Detected explicit incident {inc_num} in question; short-circuiting to deterministic similarity lookup.")
                # Fetch canonical incident to obtain short_description if needed
                canonical = fetch_servicenow_incident_core(inc_num)
                short_desc = canonical.get('short_description') if isinstance(canonical, dict) else None
                if short_desc:
                    similar = get_similar_incidents_simple(short_desc)
                else:
                    similar = get_similar_incidents_simple(inc_num)
                return {
                    "plan": [{"function_name": "get_similar_incidents", "arguments": {"incident_number": inc_num}}],
                    "tool_outputs": {"get_similar_incidents": similar},
                    "errors": self.errors
                }
            # Persona selection & prompt augmentation
            try:
                # Only run heuristic if persona not already set (token/explicit/session precedence)
                if not metadata.get('persona'):
                    persona_key = select_persona(question, metadata)
                    metadata["persona"] = persona_key
                else:
                    existing_persona = metadata.get('persona')
                    persona_key = existing_persona if isinstance(existing_persona, str) else 'product_owner'
                persona = PERSONA_DEFS.get(persona_key if isinstance(persona_key, str) else 'product_owner', {})
                style = persona.get("style")
                fmt = persona.get("output_format", [])
                persona_injection = "\n\nPERSONA: {}\nSTYLE: {}\nSTRUCTURE SECTIONS: {}\n".format(
                    persona_key,
                    style or "",
                    ", ".join(fmt) if fmt else "")
                augmented_prompt = augmented_prompt + persona_injection
            except Exception:
                pass

            # Attempt recipe-based plan if intent recognized
            recipe_plan = None
            try:
                persona_for_recipe = metadata.get('persona')
                if metadata.get('intent'):
                    recipe_steps = build_recipe(metadata['intent'], persona_for_recipe, question, metadata)
                    if recipe_steps:
                        recipe_plan = [{'function_name': s['tool'], 'arguments': s['args']} for s in recipe_steps]
                        logger.info(f"[AgenticOrchestratorAuto][RECIPE] Using recipe for intent='{metadata['intent']}' persona='{persona_for_recipe}' -> {recipe_plan}")
            except Exception as rp_e:
                logger.warning(f"[AgenticOrchestratorAuto][RECIPE] Failed to build recipe: {rp_e}")

            used_recipe = False
            plan_candidate: Any = None  # ensure defined for later checks
            if recipe_plan:
                self.plan = recipe_plan  # type: ignore[assignment]
                plan = recipe_plan  # type: ignore[assignment]
                used_recipe = True
            else:
                plan_candidate = self.plan_tools(question, augmented_prompt, metadata, username)
                if isinstance(plan_candidate, list):
                    plan = [s for s in plan_candidate if isinstance(s, dict)]
                elif isinstance(plan_candidate, dict) and plan_candidate.get('clarify_user'):
                    # Clarification request short-circuit
                    logger.info(f"[AgenticOrchestratorAuto] Planner requested clarification: {plan_candidate.get('invalid_entries')}")
                    return {
                        "plan": [],
                        "tool_outputs": {},
                        "errors": self.errors,
                        "clarify_user": True,
                        "clarification_details": plan_candidate.get('invalid_entries')
                    }
                else:
                    plan = []
            # Retain previous separate clarification check for safety (plan_candidate always defined)
            if isinstance(plan_candidate, dict) and plan_candidate.get('clarify_user'):
                logger.info(f"[AgenticOrchestratorAuto] Planner requested clarification: {plan_candidate.get('invalid_entries')}")
                return {
                    "plan": [],
                    "tool_outputs": {},
                    "errors": self.errors,
                    "clarify_user": True,
                    "clarification_details": plan_candidate.get('invalid_entries')
                }

            # Explicit, clear logging of the generated plan and the parameters used to generate it
            try:
                logger.info("[AgenticOrchestratorAuto] >>> PLAN GENERATED (clear log) >>>\n%s", json.dumps(plan, default=str, indent=2))
            except Exception:
                logger.info("[AgenticOrchestratorAuto] >>> PLAN GENERATED (non-serializable object) >>> %s", str(plan))

            # Persona tool filtering: remove any steps not in persona's allowed tool set (if defined)
            try:
                persona_for_filter = metadata.get('persona')
                allowed_tools = None
                if persona_for_filter and persona_for_filter in PERSONA_DEFS:
                    allowed_tools = PERSONA_DEFS[persona_for_filter].get('tools')
                if allowed_tools and isinstance(allowed_tools, (set, list, tuple)):
                    original_len = len(plan)
                    filtered = [s for s in plan if isinstance(s, dict) and (s.get('function_name') or s.get('tool') or s.get('name')) in allowed_tools]
                    # Safety: if filtering would drop all steps for intent user_incidents, retain original
                    intent_for_plan = metadata.get('intent')
                    if intent_for_plan == 'user_incidents' and not filtered and original_len > 0:
                        logger.info(f"[AgenticOrchestratorAuto][FILTER] Bypassed filtering for user_incidents intent (persona {persona_for_filter}) to preserve recipe tools")
                    else:
                        if len(filtered) != original_len:
                            logger.info(f"[AgenticOrchestratorAuto][FILTER] Persona '{persona_for_filter}' filtered plan from {original_len} -> {len(filtered)} steps")
                            try:
                                emit_event('plan.filtered.persona', persona=persona_for_filter, before=original_len, after=len(filtered))
                            except Exception:
                                pass
                            plan = filtered
            except Exception as f_e:
                logger.warning(f"[AgenticOrchestratorAuto][FILTER] Failed filtering by persona tools: {f_e}")

            try:
                params_log = {
                    "question": question,
                    "prompt": prompt,
                    "metadata": metadata,
                    "username": username,
                    "context_messages": pruned_context
                }
                logger.info("[AgenticOrchestratorAuto] >>> PLAN PARAMETERS >>>\n%s", json.dumps(params_log, default=str, indent=2))
            except Exception:
                logger.info("[AgenticOrchestratorAuto] >>> PLAN PARAMETERS (non-serializable) >>> question=%s prompt=%s metadata=%s username=%s context=%s",
                            str(question), str(prompt), str(metadata), str(username), str(pruned_context))

            # Post-plan validation: ensure incident_number in plan is anchored to known_incidents
            try:
                # prefer the most recent known incident (last in the list)
                last_known_incident = known_incidents[-1] if known_incidents else None
                # Inject missing incident_number into empty fetch_servicenow_incident steps
                for step in plan:
                    if isinstance(step, dict):
                        fname = step.get('function_name') or step.get('tool')
                        args = step.get('args') or step.get('arguments') or {}
                        if fname == 'fetch_servicenow_incident' and (not args or 'incident_number' not in args) and last_known_incident:
                            logger.info(f"[AgenticOrchestratorAuto][HARDEN] Injecting missing incident_number={last_known_incident} into blank fetch_servicenow_incident step")
                            args['incident_number'] = last_known_incident
                            if 'arguments' in step:
                                step['arguments'] = args
                            else:
                                step['args'] = args
                # prefer the most recent tool_output id (we prepended tool_output ids)
                for step in plan:
                    if not isinstance(step, dict):
                        continue
                    args = step.get('args') or step.get('arguments') or {}
                    # If this step references an incident_number, ensure it matches known incidents and override if not
                    if isinstance(args, dict) and 'incident_number' in args:
                        plan_id = str(args.get('incident_number')).upper()
                        if known_incidents and plan_id not in known_incidents:
                            logger.warning(f"[AgenticOrchestratorAuto][PLAN_CHECK] model_incident={plan_id} not in known_incidents={known_incidents}; overriding with {last_known_incident}")
                            if last_known_incident:
                                args['incident_number'] = last_known_incident
                                if 'arguments' in step:
                                    step['arguments'] = args
                                else:
                                    step['args'] = args
                        else:
                            logger.info(f"[AgenticOrchestratorAuto][PLAN_CHECK] model_incident={plan_id} validated against known_incidents")
                    # Additional deterministic override: if the function is get_similar_incidents, prefer to use
                    # the canonical/recent incident's short_description or incident_number from pruned_context.
                    try:
                        func_name = step.get('function_name') or step.get('tool') if isinstance(step, dict) else None
                        if func_name == 'get_similar_incidents':
                            # attempt to extract short description for last_known_incident from pruned_context
                            if last_known_incident and pruned_context:
                                short_desc = None
                                for msg in reversed(pruned_context):
                                    text = msg.get('content') if isinstance(msg, dict) else str(msg)
                                    if last_known_incident in (text or ''):
                                        safe_text = text or ""
                                        m = re.search(r'"([^"\n]{10,200})"', safe_text)
                                        if m:
                                            short_desc = m.group(1)
                                            break
                                # If we found a short description, override the argument
                                if short_desc:
                                    args['short_description'] = short_desc
                                    if 'arguments' in step:
                                        step['arguments'] = args
                                    else:
                                        step['args'] = args
                                    logger.info(f"[AgenticOrchestratorAuto][PLAN_CHECK] Overrode get_similar_incidents.short_description with canonical short description for {last_known_incident}")
                                else:
                                    # if no short description found but we have the incident number, prefer passing it
                                    if last_known_incident:
                                        args['incident_number'] = last_known_incident
                                        if 'arguments' in step:
                                            step['arguments'] = args
                                        else:
                                            step['args'] = args
                                        logger.info(f"[AgenticOrchestratorAuto][PLAN_CHECK] Set get_similar_incidents.incident_number={last_known_incident} for deterministic lookup")
                                # If the planner returned a generic short-description finder without args,
                                # and we have a canonical incident, inject deterministic args so the tool can run.
                                if func_name == 'find_incidents_by_short_description':
                                    # If the planner omitted arguments, provide short_description or incident_number
                                    if not args:
                                        injected = {}
                                        # Prefer canonical short_description if we can fetch it from a canonical incident
                                        try:
                                            if last_known_incident:
                                                canonical = fetch_servicenow_incident_core(last_known_incident)
                                                sd = canonical.get('short_description') if isinstance(canonical, dict) else None
                                                if sd:
                                                    injected['short_description'] = sd
                                                else:
                                                    injected['incident_number'] = last_known_incident
                                        except Exception as inj_e:
                                            logger.warning(f"[AgenticOrchestratorAuto][PLAN_CHECK] Failed to fetch canonical for injection: {inj_e}")
                                        # Apply injection if we found anything; otherwise leave it to the tool to error/ask
                                        if injected:
                                            args.update(injected)
                                            if 'arguments' in step:
                                                step['arguments'] = args
                                            else:
                                                step['args'] = args
                                            logger.info(f"[AgenticOrchestratorAuto][PLAN_CHECK] Injected args into find_incidents_by_short_description: {injected}")
                    except Exception as inner_e:
                        logger.warning(f"[AgenticOrchestratorAuto][PLAN_CHECK] Error during get_similar_incidents override: {inner_e}")
                    # Separate injection handling for find_incidents_by_short_description
                    try:
                        func_name_finder = step.get('function_name') or step.get('tool') if isinstance(step, dict) else None
                        if func_name_finder == 'find_incidents_by_short_description':
                            args_f = step.get('args') or step.get('arguments') or {}
                            if not args_f:
                                injected = {}
                                try:
                                    if last_known_incident:
                                        canonical = fetch_servicenow_incident_core(last_known_incident)
                                        sd = canonical.get('short_description') if isinstance(canonical, dict) else None
                                        if sd:
                                            injected['short_description'] = sd
                                        else:
                                            injected['incident_number'] = last_known_incident
                                except Exception as inj_e:
                                    logger.warning(f"[AgenticOrchestratorAuto][PLAN_CHECK] Failed to fetch canonical for finder injection: {inj_e}")
                                if injected:
                                    args_f.update(injected)
                                    if 'arguments' in step:
                                        step['arguments'] = args_f
                                    else:
                                        step['args'] = args_f
                                    logger.info(f"[AgenticOrchestratorAuto][PLAN_CHECK] Injected args into find_incidents_by_short_description: {injected}")
                    except Exception as finder_e:
                        logger.warning(f"[AgenticOrchestratorAuto][PLAN_CHECK] Error during finder injection: {finder_e}")
                # Prune duplicate fetch_servicenow_incident steps (keep first with populated args)
                seen_fetch = False
                pruned_plan = []
                for step in plan:
                    if isinstance(step, dict):
                        fname = step.get('function_name') or step.get('tool')
                        if fname == 'fetch_servicenow_incident':
                            if not seen_fetch:
                                pruned_plan.append(step)
                                seen_fetch = True
                            else:
                                logger.info("[AgenticOrchestratorAuto][HARDEN] Dropping duplicate fetch_servicenow_incident step")
                            continue
                    pruned_plan.append(step)
                if len(pruned_plan) != len(plan):
                    plan = pruned_plan
                    logger.info(f"[AgenticOrchestratorAuto][HARDEN] Pruned plan size {len(pruned_plan)} (was {len(self.plan)})")
            except Exception as e:
                logger.error(f"[AgenticOrchestratorAuto][PLAN_CHECK] Exception during plan validation: {e}")

            # Ensure the orchestrator's plan attribute reflects the validated/possibly modified plan
            try:
                self.plan = plan  # type: ignore[assignment]
            except Exception:
                # fallback: ensure it's at least an empty list
                self.plan = plan or []  # type: ignore[assignment]

            outputs = self.execute_plan(question, augmented_prompt, metadata, username)

            # Adaptive fallback: evaluate recipe sufficiency and optionally invoke planner for gaps.
            adaptive_enabled = getenv('RECIPE_FALLBACK_ENABLED', 'true').lower() in ('1','true','yes','on')
            strict_mode = getenv('RECIPE_STRICT', 'false').lower() in ('1','true','yes','on')
            extra_plan = []
            recipe_eval = None
            if used_recipe and adaptive_enabled and not strict_mode:
                try:
                    recipe_eval = evaluate_recipe(metadata.get('intent', ''), outputs)
                    metadata['recipe_evaluation'] = recipe_eval
                    if not recipe_eval.get('passed'):
                        # Build gap description
                        gaps = recipe_eval.get('gaps', [])
                        gap_text = ', '.join(gaps) if gaps else 'unspecified gaps'
                        logger.info(f"[AgenticOrchestratorAuto][RECIPE_FALLBACK] Gaps detected: {gaps}; invoking planner for augmentation.")
                        augmentation_prompt = (
                            augmented_prompt +
                            "\n\nCONTEXT GAP NOTICE: The initial deterministic recipe execution had gaps (" + gap_text + ")" \
                            "\nProvide ONLY additional tool steps that fill these gaps. Avoid repeating already executed tools unless required."\
                        )
                        # Invoke planner for augmentation
                        planned = self.plan_tools(question, augmentation_prompt, metadata, username)
                        # Filter out duplicate tools unless explicitly needed for a gap
                        executed_tools = {(step.get('function_name') or step.get('tool')) for step in plan if isinstance(step, dict)}
                        filtered_steps = []
                        for step in planned if isinstance(planned, list) else []:
                            tname = step.get('function_name') or step.get('tool')
                            if tname in executed_tools and tname not in gaps:
                                continue
                            filtered_steps.append(step)
                        if filtered_steps:
                            logger.info(f"[AgenticOrchestratorAuto][RECIPE_FALLBACK] Augmentation steps accepted: {filtered_steps}")
                            # Set self.plan to combined plan
                            combined_plan = plan + filtered_steps  # both lists of dicts
                            self.plan = combined_plan  # type: ignore[assignment]
                            # Execute only new steps
                            try:
                                self.plan = filtered_steps  # type: ignore[assignment]
                                extra_outputs = self.execute_plan(question, augmentation_prompt, metadata, username) or {}
                            finally:
                                # restore full combined plan for final result
                                self.plan = combined_plan  # type: ignore[assignment]
                            # Merge outputs without overwriting existing keys
                            for k, v in extra_outputs.items():
                                if k not in outputs:
                                    outputs[k] = v
                            extra_plan = filtered_steps
                        metadata['plan_source'] = 'recipe+planner'
                    else:
                        metadata['plan_source'] = 'recipe'
                except Exception as eval_e:
                    logger.warning(f"[AgenticOrchestratorAuto][RECIPE_FALLBACK] Evaluation failed: {eval_e}")
            else:
                if used_recipe:
                    metadata['plan_source'] = 'recipe'
                else:
                    metadata['plan_source'] = 'planner'
            try:
                export_traces(self.traces)
            except Exception:
                logger.warning("[AgenticOrchestratorAuto] Trace export failed (non-fatal)")
            result = {
                "plan": self.plan if used_recipe and extra_plan else plan,
                "tool_outputs": outputs,
                "errors": self.errors,
                "question": question,
                "metadata": metadata,
                "username": username,
                "context_messages": pruned_context,
                "traces": self.traces
            }
            # Record token usage for this interaction if instrumentation is enabled
            try:
                from .token_instrumentation import GLOBAL_TOKEN_INSTRUMENTATION
                if GLOBAL_TOKEN_INSTRUMENTATION:
                    entry_id = GLOBAL_TOKEN_INSTRUMENTATION.record(
                        username or "anonymous",
                        question or "",
                        augmented_prompt,
                        result.get("plan") or [],
                        metadata.get("micro_intent"),
                        metadata.get("cache_hit", False),
                        metadata,
                    )
                    if entry_id:
                        metadata["token_entry_id"] = entry_id
            except Exception:
                logger.debug("[AgenticOrchestratorAuto][TOKEN] Failed to record token metrics", exc_info=True)
            # Emit events for each trace (tool invocation)
            for tr in self.traces:
                try:
                    emit_event(
                        'agent.tool.invoked',
                        tool_name=tr.get('tool'),
                        latency_ms=tr.get('duration_ms'),
                        success=(tr.get('status') == 'ok'),
                        intent=metadata.get('intent'),
                        plan_source=metadata.get('plan_source'),
                        persona=metadata.get('persona'),
                        question=question
                    )
                except Exception:
                    pass
            # Emit final answer synthesis event stub (no answer here; API layer may override)
            try:
                emit_event('agent.answer.prepared', intent=metadata.get('intent'), plan_source=metadata.get('plan_source'), persona=metadata.get('persona'))
            except Exception:
                pass
            logger.info(f"[AgenticOrchestratorAuto] Final result: {json.dumps(result, default=str)}")
            return result
        except Exception as e:
            logger.error(f"[AgenticOrchestratorAuto] Exception in solve: {e}\n{traceback.format_exc()}")
            return {"error": str(e), "traceback": traceback.format_exc()}
