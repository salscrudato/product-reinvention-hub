"""Agentic Orchestrator (Auto)

Overview
========
`AgenticOrchestratorAuto` coordinates classification, planning and execution of backend tools
to answer a user's question. It is designed for clarity, resilience and learnability by
non‑programmers. The orchestrator produces a plan (ordered tool steps) then executes each step
sequentially or via a LangGraph when enabled.

Major Responsibilities (Pipeline)
---------------------------------
1. Context preparation & optional compression (rolling + dialogue summarization).
2. Micro‑intent & cache shortcuts (instant answer paths).
3. Intent & persona classification (primary + config heuristics).
4. Incident reference extraction & deterministic prompt augmentation.
5. Shortcut heuristics (assignment, similarity pre-rule).
6. Deterministic recipe build; adaptive augmentation if gaps detected.
7. Unified planner (retrieval prefilter + validation + clarification signaling).
8. Persona-based tool filtering & observability tool injection.
9. Plan hardening (argument propagation + duplicate pruning).
10. Execution (advanced sequential or LangGraph) with dependency inference & chunking.
11. Trace export, observability summary & context card build/caching.
12. Token instrumentation & analytics emission.

Feature Flags (Environment Variables)
------------------------------------
ENABLE_CONTEXT_SUMMARY: rolling summary compression of older context.
ENABLE_MICRO_INTENTS: enable micro-intent fast-path classification.
ENABLE_CONTEXT_CACHE: allow cached incident context card reuse.
ENABLE_AUTOMATIC_DATADOG: inject DataDog observability tools heuristically.
RECIPE_FALLBACK_ENABLED: allow planner augmentation after recipe evaluation gaps.
RECIPE_STRICT: disable augmentation even if gaps.
DISABLE_PRE_RULE: disable similarity pre-rule shortcut.
AGENTIC_USE_RETRIEVAL: enable retrieval-based prefilter for planning.
ENABLE_LANGGRAPH: run multi-node LangGraph execution instead of sequential.
ENABLE_CHAT_SUMMARIES / CHAT_SUMMARY_COUNT: inject compressed prior chat summaries.
ENABLE_CONTEXT_MESSAGES_SUMMARY: compress recent dialogue messages into one system message.

Key Metadata Fields
-------------------
intent, persona, micro_intent(+confidence), cache_hit, rolling_summary_applied(+tokens_saved),
observability_injected(+tools,+service), observability_summary(_struct), plan_source,
recipe_evaluation, incident_context_card, token_entry_id.

Events Emitted (via `emit_event`)
--------------------------------
plan.step.suppressed, observability.steps.injected, observability.summary.generated,
card.generated, context.summary.applied, agent.tool.invoked, agent.answer.prepared.

Logging Model (FLOW Phases)
---------------------------
All human-friendly log lines use the prefix pattern: "FLOW[PHASE] message | {json}".
PHASE values:
  INIT           – Orchestrator instance created.
  SOLVE_START    – Begin solve pipeline.
  QUESTION       – User question captured (truncated for safety).
  SHORTCUT       – A heuristic fast-path chosen (micro-intent / assignment / similarity).
  CLASSIFIED     – Intent & persona determined.
  INCIDENTS      – Incident references collected.
  PLAN           – Planner finished selection & diagnostics.
  PLAN_SUMMARY   – Human-readable one-line numbered plan overview.
  PLAN_READY     – Final hardened plan ready for execution.
  EXEC_START     – Sequential execution start.
  EXEC_STEP_START– Individual step starting (tool + simple args).
  EXEC_STEP_END  – Step completed successfully (duration + preview).
  EXEC_STEP_ERROR– Step failed (error message recorded).
  EXEC_COMPLETE  – Sequential execution finished (success/failure counts).
  GRAPH_START    – LangGraph execution starting.
  GRAPH_COMPLETE – LangGraph execution finished.
  RECIPE_EVAL    – Recipe evaluation result (gaps or pass).
  PLAN_AUGMENT   – Augmentation steps executed due to gaps.
  CLARIFY        – Planner requests user clarification.
  SOLVE_COMPLETE – Final solve completion summary.

Error Handling
--------------
All helper methods swallow exceptions (logging them) to prevent total failure of `solve()`.
This ensures robust operation under partial outages.
"""

import logging, os, json, re, time, traceback
from typing import Any, Dict, List, Optional, Tuple
from os import getenv

logger = logging.getLogger("agentic_orchestrator_auto")
logger.setLevel(logging.INFO)
# Ensure a readable file handler exists (idempotent)
if not any(isinstance(h, logging.FileHandler) and getattr(h, 'baseFilename', '').endswith('agentic_orchestrator_auto.log') for h in logger.handlers):
    fh = logging.FileHandler('agentic_orchestrator_auto.log', mode='a', encoding='utf-8')
    fmt = logging.Formatter('%(asctime)s %(levelname)s FLOW: %(message)s')
    fh.setFormatter(fmt)
    fh.setLevel(logging.INFO)
    logger.addHandler(fh)
if not any(isinstance(h, logging.StreamHandler) for h in logger.handlers):  # console for warnings/errors
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
    ch.setLevel(logging.WARNING)
    logger.addHandler(ch)

# Safe fallback imports (stubs keep runtime resilient)
try:
    from .intent_classifier import classify_intent  # type: ignore
except Exception:  # pragma: no cover
    classify_intent = lambda *a, **k: None  # type: ignore
try:
    from .intent_config import classify_with_config  # type: ignore
except Exception:
    classify_with_config = lambda *a, **k: {"intent": None}  # type: ignore
try:
    from .persona_registry import PERSONA_DEFS, select_persona  # type: ignore
except Exception:
    PERSONA_DEFS = {}
    select_persona = lambda *a, **k: "product_owner"  # type: ignore
try:
    from .plan_recipes import build_recipe  # type: ignore
except Exception:
    build_recipe = lambda *a, **k: None  # type: ignore
try:
    from .recipe_evaluator import evaluate_recipe  # type: ignore
except Exception:
    evaluate_recipe = lambda *a, **k: {"passed": True, "gaps": []}  # type: ignore
try:
    from .servicenowgenaitool import fetch_servicenow_incident_core  # type: ignore
except Exception:
    fetch_servicenow_incident_core = lambda inc: {}  # type: ignore
try:
    from .snowaaonetool import get_similar_incidents_simple  # type: ignore
except Exception:
    get_similar_incidents_simple = lambda *a, **k: []  # type: ignore
try:
    from .card_builder import build_incident_context_card  # type: ignore
except Exception:
    build_incident_context_card = lambda *a, **k: {}  # type: ignore
try:
    from .context_cache import GLOBAL_CONTEXT_CACHE  # type: ignore
except Exception:
    GLOBAL_CONTEXT_CACHE = None  # type: ignore
try:
    from .token_instrumentation import GLOBAL_TOKEN_INSTRUMENTATION  # type: ignore
except Exception:
    GLOBAL_TOKEN_INSTRUMENTATION = None  # type: ignore
try:
    from .trace_export import export_traces  # type: ignore
except Exception:
    export_traces = lambda *a, **k: False  # type: ignore
try:  # Phase3: optional LangGraph support with shim
    from langgraph.graph import StateGraph  # type: ignore
    _STATEGRAPH_IMPORT_ERROR = None
except Exception as e:  # pragma: no cover
    _STATEGRAPH_IMPORT_ERROR = e
    class StateGraph:  # type: ignore
        def __init__(self, *a, **k):
            self._error = _STATEGRAPH_IMPORT_ERROR
            self._nodes: Dict[str, Any] = {}
            self._edges: List[Tuple[str,str]] = []
            self._entry: Optional[str] = None
        def add_node(self, name: str, fn: Any):
            self._nodes[name] = fn
        def add_edge(self, frm: str, to: str):
            self._edges.append((frm, to))
        def add_conditional_edges(self, *a, **k):
            return None
        def set_entry_point(self, name: str):
            self._entry = name
        def compile(self):
            class _Runner:
                def __init__(self, nodes: Dict[str, Any], edges: List[Tuple[str,str]], entry: Optional[str]):
                    self.nodes = nodes; self.edges = edges; self.entry = entry
                def invoke(self, state: Dict[str, Any]):
                    # naive sequential traversal preserving original order of node insertion
                    for name, fn in self.nodes.items():
                        try:
                            out = fn(state)
                            if isinstance(out, dict):
                                state.update(out)
                        except Exception as _e:  # pragma: no cover
                            state.setdefault('errors', []).append(f"graph_node_error:{name}:{_e}")
                    return state
            return _Runner(self._nodes, self._edges, self._entry)
        def __repr__(self):  # pragma: no cover
            return f"StateGraph(shim error={self._error})"
try:
    from .chunking_tool import chunk_output  # type: ignore
except Exception:
    def chunk_output(output: Any, max_tokens: int = 1500) -> List[Any]:  # type: ignore
        # Fallback: simply wrap long strings
        if isinstance(output, str) and len(output) > max_tokens:
            return [output[:max_tokens] + '...']
        return [output]
try:
    from .planner_selector import select_and_plan  # type: ignore
except Exception:
    def select_and_plan(question: str, prompt: str, metadata: Dict[str, Any], username: Optional[str] = None):  # type: ignore
        # Fallback returns empty plan + diagnostics
        return [], {'fallback': True}, 'fallback'
try:
    from .langgraph_flow_retrieval import determine_function_sequence as retrieval_determine_function_sequence, Command as RetrievalCommand  # type: ignore
except Exception:  # pragma: no cover
    retrieval_determine_function_sequence = None  # type: ignore
    RetrievalCommand = None  # type: ignore
try:
    from events.emitter import emit_event  # type: ignore
except Exception:
    def emit_event(*a, **k):  # type: ignore
        return None

INC_PATTERN = re.compile(r"\b(INC0*\d+)\b", re.IGNORECASE)

class AgenticOrchestratorAuto:
    """Refactored agent orchestration engine.

    Responsibilities:
        1. Context preparation & optional rolling summary compression.
        2. Micro-intent + context cache fast-path returning immediate answer plan.
        3. Intent & persona classification (primary + config-based heuristic).
        4. Assignment & similarity heuristic short-circuits for common queries.
        5. Deterministic recipe plan generation with adaptive fallback augmentation.
        6. Persona-based tool filtering (enforces allowed tool lists per persona).
        7. Observability (DataDog) tool injection when heuristic triggers.
        8. Plan validation & hardening (incident argument propagation + dedupe).
        9. Tool execution with trace collection & per-tool event emission.
       10. Incident context card synthesis & caching post micro-intent flows.
       11. Token instrumentation capture for analytics & UI usage metrics.

    Attributes:
        verbose (bool): Optional verbosity toggle for future extended logging.
        plan (List[Dict]): Current plan steps executed or to-be executed.
        tool_outputs (Dict): Collected outputs keyed by function/tool name.
        errors (List[str]): Non-fatal execution/tool resolution errors.
        traces (List[Dict]): Timing & status trace records per executed step.
    """

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.plan: List[Dict[str, Any]] = []
        self.tool_outputs: Dict[str, Any] = {}
        self.errors: List[str] = []
        self.traces: List[Dict[str, Any]] = []
        logger.info("FLOW[INIT] Orchestrator instance created (verbose=%s)", self.verbose)

    # ---------------- Human-friendly helpers ----------------
    def _summarize_plan(self, plan: List[Dict[str, Any]]) -> str:
        """Return a concise human-readable description of the plan.

        Format: StepNumber. ToolName (key arguments)
        Example: 1. fetch_servicenow_incident(incident_number=INC0001234); 2. get_similar_incidents(...)
        """
        try:
            if not plan:
                return "(no steps)"
            rendered: List[str] = []
            for i, step in enumerate(plan, start=1):
                if not isinstance(step, dict):
                    continue
                fname = step.get('function_name') or step.get('tool') or 'unknown'
                args = step.get('arguments') or step.get('args') or {}
                # Keep only simple scalar args for readability
                arg_parts = []
                if isinstance(args, dict):
                    for k, v in list(args.items())[:5]:  # limit
                        if isinstance(v, (str, int, float)):
                            sval = (v[:60] + '...') if isinstance(v, str) and len(v) > 60 else v
                            arg_parts.append(f"{k}={sval}")
                arg_str = ", ".join(arg_parts) if arg_parts else "..."
                rendered.append(f"{i}. {fname}({arg_str})")
            return "; ".join(rendered)
        except Exception as e:
            self._log_exception('_summarize_plan', e)
            return '(summary unavailable)'

    def _log_exception(self, where: str, exc: Exception, **ctx: Any) -> None:
        """Standardized exception logging with stack trace snippet.

        Parameters:
            where: Logical location/method name.
            exc: Caught exception instance.
            ctx: Optional contextual key/value data to serialize.
        """
        try:
            trace = traceback.format_exc()
        except Exception:
            trace = 'traceback_unavailable'
        base = {k: v for k, v in ctx.items() if v is not None}
        base.update({'error': str(exc)})
        try:
            logger.error(f"FLOW[EXCEPTION] {where} failed | {json.dumps(base, default=str)}\n{trace}")
        except Exception:
            logger.error(f"FLOW[EXCEPTION] {where} failed (serialization issue) error={exc}\n{trace}")

    def _log_flow(self, phase: str, message: str, **extra: Any) -> None:
        """Unified logging wrapper adding FLOW phase marker and simple JSON tail for non-programmers."""
        try:
            payload = {k: v for k, v in extra.items() if v is not None}
            tail = f" | {json.dumps(payload, default=str)}" if payload else ""
            logger.info(f"FLOW[{phase}] {message}{tail}")
        except Exception as e:
            logger.info(f"FLOW[{phase}] {message} | serialization_failed error={e}")

    # ---------------- Context utilities ----------------
    def get_recent_chat_summaries(self, username: Optional[str], n: int = 5) -> List[Dict[str, Any]]:
        """Return recent chat summaries for a user.

        Parameters:
            username: The username whose summaries to fetch.
            n: Max number of summary snippets to retrieve.
        Returns:
            List of summary dicts (may be empty if unavailable or error).
        Side-effects: Attempts import of legacy orchestrator; failures are ignored.
        """
        if not username:
            return []
        try:
            from .agentic_orchestrator import AgenticOrchestrator  # type: ignore
            return AgenticOrchestrator().get_recent_chat_summaries(username, n=n)
        except Exception:
            return []

    def _prune_context(self, context_messages: List[Any], max_turns: int = 5) -> List[Any]:
        """Reduce context to a limited number of recent conversational turns.

        Logic: Walk backwards, counting user/assistant/server roles; stop after
        2 * max_turns messages (paired turns approximation).

        Parameters:
            context_messages: Full context list of message dicts or raw items.
            max_turns: Target number of paired turns to retain.
        Returns:
            Pruned list preserving chronological order.
        """
        try:
            pruned: List[Any] = []
            turn_pairs = 0
            for msg in reversed(context_messages):
                pruned.append(msg)
                role = msg.get("role") if isinstance(msg, dict) else None
                if role in ("user", "assistant", "server"):
                    turn_pairs += 1
                if turn_pairs >= max_turns * 2:
                    break
            return list(reversed(pruned))
        except Exception as e:
            self._log_exception('_prune_context', e, max_turns=max_turns)
            return context_messages[-max_turns*2:] if context_messages else []

    def _apply_rolling_summary(self, pruned_context: List[Any], metadata: Dict[str, Any]) -> Tuple[List[Any], Optional[Dict[str, Any]]]:
        """Optionally compress older context into a short rolling summary.

        Triggered by ENABLE_CONTEXT_SUMMARY flag. Produces a system message embedding
        the summary of recent snippets while preserving the last few raw messages.

        Parameters:
            pruned_context: Already pruned conversation context.
            metadata: Mutable metadata dict augmented with summary flags.
        Returns:
            (new_context, summary_payload or None)
        Metadata Mutations:
            rolling_summary_applied, rolling_summary_tokens_saved_estimate
        """
        if os.getenv("ENABLE_CONTEXT_SUMMARY", "").lower() not in ("1","true","yes","on"):
            return pruned_context, None
        if not pruned_context:
            return pruned_context, None
        try:
            recent_snippets = []
            for m in pruned_context[-5:]:
                txt = m.get("content") if isinstance(m, dict) else str(m)
                if txt:
                    recent_snippets.append(txt[:140])
            compressed = " ".join(recent_snippets)
            new_ctx = [{"role":"system","content":f"<rolling_summary>{compressed}</rolling_summary>"}] + pruned_context[-3:]
            saved_est = max(0, (len(pruned_context) - len(new_ctx)) * 25)
            metadata["rolling_summary_applied"] = True
            metadata["rolling_summary_tokens_saved_estimate"] = saved_est
            return new_ctx, {"summary": compressed, "token_savings_estimate": saved_est}
        except Exception:
            return pruned_context, None

    # ---------------- Extraction helpers ----------------
    def _extract_incident_ids_from_messages(self, messages: List[Any]) -> List[str]:
        """Extract incident numbers from message content using INC_PATTERN.

        Parameters:
            messages: List of message dicts or raw items convertible to str.
        Returns:
            List of normalized uppercase incident identifiers.
        """
        try:
            ids: List[str] = []
            for m in messages:
                raw = m.get("content") if isinstance(m, dict) else m
                txt = raw if isinstance(raw, str) else ("" if raw is None else str(raw))
                for match in INC_PATTERN.findall(txt):
                    ids.append(match.upper())
            return ids
        except Exception as e:
            self._log_exception('_extract_incident_ids_from_messages', e, count=len(messages))
            return []

    def _extract_incident_ids_from_tool_outputs(self, tool_outputs: Dict[str, Any]) -> List[str]:
        """Extract incident numbers from prior tool outputs.

        Supports nested dict/list structures typical of incident tools.
        Parameters:
            tool_outputs: Dict of tool name -> output structure.
        Returns:
            List of uppercase incident identifiers found.
        """
        try:
            ids: List[str] = []
            for v in tool_outputs.values():
                if isinstance(v, dict):
                    cand = v.get("incident_number") or v.get("number")
                    if isinstance(cand, str) and INC_PATTERN.search(cand):
                        ids.append(cand.upper())
                if isinstance(v, list):
                    for it in v:
                        if isinstance(it, dict):
                            cand = it.get("incident_number") or it.get("number")
                            if isinstance(cand, str) and INC_PATTERN.search(cand):
                                ids.append(cand.upper())
            return ids
        except Exception as e:
            self._log_exception('_extract_incident_ids_from_tool_outputs', e, output_keys=list(tool_outputs.keys()))
            return []

    # ---------------- Micro intent / cache short-circuit ----------------
    def _micro_intent_cache_short_circuit(self, question: str, pruned_context: List[Any], metadata: Dict[str, Any], username: Optional[str]) -> Optional[Dict[str, Any]]:
        """Attempt micro-intent fast-path using cached incident context card.

        Requires ENABLE_MICRO_INTENTS and optionally ENABLE_CONTEXT_CACHE for cache retrieval.
        If a cached card is found for the most recent incident reference, a minimal
        plan (fetch incident) plus cached output is returned immediately.

        Parameters:
            question: Latest user question text.
            pruned_context: Prepared context messages.
            metadata: Mutable metadata collecting classification results.
            username: User identifier for cache scoping.
        Returns:
            Result dict with plan/tool_outputs if shortcut taken; otherwise None.
        Metadata Mutations:
            micro_intent, micro_intent_confidence, cache_hit, incident_context_card
        """
        if os.getenv("ENABLE_MICRO_INTENTS", "").lower() not in ("1","true","yes","on"):
            return None
        try:
            from .micro_intents import classify_micro_intent  # type: ignore
        except Exception:
            return None
        known_ids = self._extract_incident_ids_from_messages(pruned_context)
        result = classify_micro_intent(question, known_ids)
        if not result.get("micro_intent"):
            return None
        metadata["micro_intent"] = result["micro_intent"]
        metadata["micro_intent_confidence"] = result.get("confidence")
        anchor = known_ids[-1] if known_ids else None
        if not anchor:
            return None
        if GLOBAL_CONTEXT_CACHE and os.getenv("ENABLE_CONTEXT_CACHE", "").lower() in ("1","true","yes","on") and username:
            cached = GLOBAL_CONTEXT_CACHE.get(username, anchor)
            if cached and cached.get("card"):
                metadata["cache_hit"] = True
                metadata["incident_context_card"] = cached["card"]
                return {
                    "plan": [{"function_name": "fetch_servicenow_incident", "arguments": {"incident_number": anchor}}],
                    "tool_outputs": {"fetch_servicenow_incident": cached["card"]},
                    "question": question,
                    "metadata": metadata,
                    "username": username,
                    "context_messages": pruned_context,
                    "traces": [],
                    "errors": []
                }
        return None

    def _merge_summary_with_card(self, metadata: Dict[str, Any]) -> None:
        """Merge rolling summary token savings estimate into incident context card.

        Parameters:
            metadata: Metadata containing potential 'incident_context_card'.
        Side-effects:
            Adds 'rolling_summary_tokens_saved_estimate' to card dict if applicable.
        """
        card = metadata.get("incident_context_card")
        if card and metadata.get("rolling_summary_applied"):
            card["rolling_summary_tokens_saved_estimate"] = metadata.get("rolling_summary_tokens_saved_estimate")

    # ---------------- Intent / persona classification ----------------
    def _classify_intent_and_persona(self, question: str, metadata: Dict[str, Any]) -> None:
        """Determine intent and persona if not already set.

        Strategy: Direct classifier then config-based fuzzy classification.
        Fallback: Ownership phrases imply 'user_incidents'.

        Parameters:
            question: User question text.
            metadata: Mutable metadata receiving intent/persona fields.
        """
        try:
            if not metadata.get("intent"):
                intent_val = classify_intent(question, metadata)
                if intent_val:
                    metadata["intent"] = intent_val
            ownership_phrases = ("my incidents","my open incidents","assigned to me","my backlog","my tickets","incidents for me","incidents assigned to me")
            if not metadata.get("intent"):
                cfg = classify_with_config(question, metadata, enable_fuzzy=True)
                if cfg.get("intent"):
                    metadata["intent"] = cfg["intent"]
                    if cfg.get("auto_persona") and not metadata.get("persona"):
                        metadata["persona"] = cfg["auto_persona"]
                    if cfg.get("context_injection"):
                        metadata["context_injection"] = cfg["context_injection"]
                elif any(p in question.lower() for p in ownership_phrases):
                    metadata["intent"] = "user_incidents"
        except Exception as e:
            logger.warning(f"intent classification failed: {e}")

    # ---------------- Context retention ----------------
    def _handle_context_retention(self, metadata: Dict[str, Any]) -> None:
        """Persist selected tool outputs for future contextual injection.

        Driven by metadata['context_injection'] structure (retain_tool_outputs, summary_key).

        Parameters:
            metadata: Metadata potentially containing 'context_injection'.
        Metadata Mutations:
            context_<summary_key>: Preview retention bundle.
        """
        retention = metadata.get("context_injection")
        if not (retention and isinstance(retention, dict)):
            return
        try:
            retain_list = retention.get("retain_tool_outputs") or []
            subset = {k: v for k, v in self.tool_outputs.items() if k in retain_list}
            if subset:
                metadata[f"context_{retention.get('summary_key','intent_focus')}"] = {
                    "retained_tools": list(subset.keys()),
                    "cached_at": time.time(),
                    "data_preview": {k: (v if isinstance(v,(dict,list)) else str(v)) for k,v in subset.items()}
                }
        except Exception as e:
            logger.warning(f"context retention failed: {e}")

    # ---------------- Prompt augmentation ----------------
    def _augment_prompt_with_incident_resolution(self, prompt: str, incidents: List[str]) -> str:
        """Add clarifying note about incident references to prompt.

        Helps downstream LLM/system clarify 'this incident' when multiple ids appear.
        """
        if len(incidents) == 1:
            return prompt + f"\n\nCONTEXT NOTE: 'this incident' refers to {incidents[-1]}"
        if incidents:
            return prompt + f"\n\nCONTEXT NOTE: Multiple incident numbers present: {incidents}. Clarify if user says 'this incident'."
        return prompt

    def _select_persona_and_augment_prompt(self, question: str, metadata: Dict[str, Any], prompt: str) -> str:
        """Select persona (if absent) and append persona style & structure hints to prompt.

        Parameters:
            question: User question.
            metadata: Mutable metadata with optional persona.
            prompt: Current prompt text.
        Returns:
            Augmented prompt containing persona/style/sections hints.
        """
        try:
            if not metadata.get("persona"):
                metadata["persona"] = select_persona(question, metadata)
            persona_def = PERSONA_DEFS.get(metadata["persona"], {})
            style = persona_def.get("style")
            fmt = persona_def.get("output_format", [])
            return prompt + f"\n\nPERSONA: {metadata['persona']}\nSTYLE: {style or ''}\nSTRUCTURE SECTIONS: {', '.join(fmt) if fmt else ''}\n"
        except Exception:
            return prompt

    # ---------------- Plan construction / filtering ----------------
    def plan_tools(self, question: str, prompt: str, metadata: Dict[str, Any], username: Optional[str]) -> List[Dict[str, Any]] | Dict[str, Any]:
        """Unified planner (Phase1) with optional retrieval narrowing + validation.

        Steps:
            1. Optional retrieval prefilter (AGENTIC_USE_RETRIEVAL=1) reduces candidate tools.
            2. Standard planner selection via select_and_plan (LLM/heuristic).
            3. Fallback heuristic if planner returns no steps.
            4. Validation: unknown / annotated (@) tool names trigger clarification request.

        Returns:
            - List[step dict] on success
            - {'clarify_user': True, ...} dict when invalid entries detected
        """
        diagnostics: Dict[str, Any] = {}
        mode: str = ''
        plan_raw: Any = []
        retrieval_subset_tools: List[str] = []
        retrieval_diag: Dict[str, Any] = {}
        use_retrieval = os.getenv('AGENTIC_USE_RETRIEVAL', '0').lower() in ('1','true','yes','on')
        if use_retrieval and retrieval_determine_function_sequence and RetrievalCommand:
            try:
                r_cmd = RetrievalCommand(question=question, prompt=prompt, metadata=metadata)  # type: ignore[call-arg]
                r_cmd = retrieval_determine_function_sequence(r_cmd)  # type: ignore
                retrieval_plan = r_cmd.function_sequence if hasattr(r_cmd, 'function_sequence') else []
                tmp_tools: List[str] = []
                for _step in retrieval_plan:
                    if isinstance(_step, dict):
                        fn_name = _step.get('function_name') or _step.get('tool')
                        if isinstance(fn_name, str):
                            tmp_tools.append(fn_name)
                retrieval_subset_tools = tmp_tools
                retrieval_diag = {'retrieval_selected_tool_count': len(retrieval_subset_tools), 'retrieval_selected_tools': retrieval_subset_tools, 'retrieval_applied': True}
                logger.info(f"[AO][RETRIEVAL] subset={retrieval_subset_tools}")
            except Exception as r_e:
                retrieval_diag = {'retrieval_error': str(r_e), 'retrieval_applied': False}
                logger.warning(f"[AO][RETRIEVAL] failed: {r_e}")
        # Standard planner
        try:
            plan_raw, std_diag, mode = select_and_plan(question, prompt, metadata, username=username)  # type: ignore[call-arg]
        except Exception as e:
            logger.warning(f"[AO][PLANNER] select_and_plan failed: {e}")
            plan_raw, std_diag, mode = [], {'error': str(e)}, 'error'
        diagnostics = {'standard_planner': std_diag, 'retrieval_prefilter': retrieval_diag, 'planner_mode': mode}
        # Normalize list of dict steps
        norm: List[Dict[str, Any]] = []
        if isinstance(plan_raw, list):
            for s in plan_raw:
                if isinstance(s, dict):
                    norm.append(s)
        plan = norm
        # Fallback heuristic if empty
        if not plan:
            inc = INC_PATTERN.search(question or "")
            if inc:
                plan.append({"function_name": "fetch_servicenow_incident", "arguments": {"incident_number": inc.group(1).upper()}})
            if metadata.get("intent") == "similar_incidents":
                plan.append({"function_name": "get_similar_incidents", "arguments": {}})
            if not plan:
                logger.info("[AO][PLANNER] empty plan post fallback heuristic")
        # Validation
        invalid: List[Tuple[Dict[str, Any], str]] = []
        try:
            from .shared_registry import FUNCTION_REGISTRY  # type: ignore
        except Exception:
            FUNCTION_REGISTRY = {}  # type: ignore
        validated: List[Dict[str, Any]] = []
        for step in plan:
            if not isinstance(step, dict):
                continue
            fn = step.get('function_name') or step.get('tool')
            if isinstance(fn, str) and fn.strip().startswith('@'):
                invalid.append((step, 'annotated function_name'))
                continue
            if fn not in FUNCTION_REGISTRY:
                invalid.append((step, 'unknown function_name'))
                continue
            validated.append(step)
        if invalid:
            logger.warning(f"[AO][PLANNER] invalid entries -> clarify: {invalid}")
            self.plan = []
            self.errors.append(str(invalid))
            return {"clarify_user": True, "invalid_entries": invalid, "raw_plan": plan, "diagnostics": diagnostics}
        self.plan = validated
        # Overlap metrics (if retrieval used)
        if retrieval_subset_tools:
            overlap = [s for s in validated if (s.get('function_name') or s.get('tool')) in retrieval_subset_tools]
            diagnostics['retrieval_overlap_ratio'] = (len(overlap) / len(validated)) if validated else 0.0
            diagnostics['retrieval_overlap_tools'] = list({(s.get('function_name') or s.get('tool')) for s in overlap})
        try:
            emit_event('agent.plan.generated', plan_size=len(validated), used_recipe=False, plan_source='planner', intent=metadata.get('intent'), persona=metadata.get('persona'))
        except Exception:
            pass
        # Human-friendly logging now that plan finalized
        self._log_flow('PLAN', 'Planner completed', plan_steps=len(validated), diagnostics=diagnostics)
        self._log_flow('PLAN_SUMMARY', self._summarize_plan(validated))
        return validated

    def _build_or_fetch_recipe_plan(self, question: str, metadata: Dict[str, Any], prompt: str, username: Optional[str]) -> Tuple[List[Dict[str, Any]] | Dict[str, Any], bool]:
        """Attempt deterministic recipe generation else fall back to heuristic plan.

        Returns:
            (plan, used_recipe_flag)
        """
        recipe_plan = None
        used = False
        try:
            if metadata.get("intent"):
                steps = build_recipe(metadata["intent"], metadata.get("persona"), question, metadata)
                if steps:
                    recipe_plan = [{"function_name": s["tool"], "arguments": s["args"]} for s in steps]
                    used = True
        except Exception as e:
            logger.warning(f"recipe build failed: {e}")
        if recipe_plan:
            return recipe_plan, True
        # May return clarification dict
        return self.plan_tools(question, prompt, metadata, username), used

    def _filter_plan_by_persona(self, plan: List[Dict[str, Any]], metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Filter plan steps based on persona tool allow-list.

        Emits suppression events for disallowed tools.
        """
        persona_key = metadata.get("persona")
        allowed = PERSONA_DEFS.get(persona_key, {}).get("tools") if persona_key in PERSONA_DEFS else None
        if allowed and isinstance(allowed, (list,set,tuple)):
            filtered = []
            for step in plan:
                fname = step.get("function_name") or step.get("tool")
                if fname not in allowed:
                    emit_event("plan.step.suppressed", tool=fname, persona=persona_key, reason="persona_disallowed")
                    continue
                filtered.append(step)
            if filtered:
                plan = filtered
        return plan

    # ---------------- Observability injection & summary ----------------
    def _inject_observability(self, plan: List[Dict[str, Any]], metadata: Dict[str, Any], question: str, incidents: List[str], username: Optional[str]) -> List[Dict[str, Any]]:
        """Inject DataDog observability tools when heuristic triggers.

        Heuristic:
            Persona contains 'sre' or 'engineer' AND (error/performance keywords OR mentions 'incident' OR incident ids present).
        Prevents duplicate injection if datadog_* already in plan.
        Metadata Mutations:
            observability_injected, observability_tools, observability_service
        """
        if os.getenv("ENABLE_AUTOMATIC_DATADOG", "").lower() not in ("1","true","yes","on"):
            return plan
        ql = question.lower()
        persona_key = metadata.get("persona") or ""
        perf_tokens = ("error","failed","failure","timeout","slow","latency","degraded","perf","performance","trace","traces","span","spans","log","logs")
        if not (any(p in persona_key.lower() for p in ("sre","engineer")) and (any(t in ql for t in perf_tokens) or "incident" in ql or incidents)):
            return plan
        existing = {s.get("function_name") for s in plan if isinstance(s, dict)}
        if any(t.startswith("datadog_") for t in existing if t):
            return plan
        service_name = "simulated-service"
        if incidents:
            try:
                canonical = fetch_servicenow_incident_core(incidents[-1]) or {}
                for k in ("service","affected_service","u_service","business_service","assignment_group"):
                    v = canonical.get(k)
                    if isinstance(v, str) and v.strip():
                        service_name = v.strip().lower().replace(" ", "-")[:80]
                        break
            except Exception:
                pass
        injected = [
            {"function_name": "datadog_get_service_traces", "arguments": {"service_name": service_name, "relative_minutes": 60}},
            {"function_name": "datadog_search_spans", "arguments": {"query": f"service:{service_name} error:true", "limit": 50}},
        ]
        if any(t in ql for t in perf_tokens) and username:
            injected.append({"function_name": "datadog_get_user_logs", "arguments": {"user_id": username, "relative_minutes": 60}})
        plan = injected + plan
        metadata["observability_injected"] = True
        metadata["observability_tools"] = [s["function_name"] for s in injected]
        metadata["observability_service"] = service_name
        emit_event("observability.steps.injected", tools=metadata["observability_tools"], service=service_name, persona=persona_key)
        return plan

    def _observability_summary(self, outputs: Dict[str, Any], metadata: Dict[str, Any]) -> None:
        """Summarize observability tool result counts into metadata.

        Populates human-readable summary and structured counts.
        Emits 'observability.summary.generated'.
        """
        try:
            traces = outputs.get("datadog_get_service_traces", {}).get("traces") if isinstance(outputs.get("datadog_get_service_traces"), dict) else None
            spans = outputs.get("datadog_search_spans", {}).get("spans") if isinstance(outputs.get("datadog_search_spans"), dict) else None
            logs = outputs.get("datadog_get_user_logs", {}).get("logs") if isinstance(outputs.get("datadog_get_user_logs"), dict) else None
            if not any([traces, spans, logs]):
                return
            lines = []
            if traces is not None: lines.append(f"Traces: {len(traces)}")
            if spans is not None: lines.append(f"Spans: {len(spans)}")
            if logs is not None: lines.append(f"Logs: {len(logs)}")
            metadata["observability_summary"] = "; ".join(lines)
            metadata["observability_summary_struct"] = {
                "traces_count": len(traces) if isinstance(traces, list) else None,
                "spans_count": len(spans) if isinstance(spans, list) else None,
                "logs_count": len(logs) if isinstance(logs, list) else None,
            }
            emit_event("observability.summary.generated", **metadata["observability_summary_struct"])
        except Exception as e:
            logger.warning(f"observability summary failed: {e}")

    # ---------------- Plan validation ----------------
    def _validate_and_harden_plan(self, plan: List[Dict[str, Any]], incidents: List[str]) -> List[Dict[str, Any]]:
        """Enforce argument completeness and prune redundant fetch steps.

        If incident context exists, propagate last incident number into relevant steps.
        """
        try:
            last_inc = incidents[-1] if incidents else None
            if not plan:
                return plan
            for step in plan:
                if not isinstance(step, dict):
                    continue
                fname = step.get("function_name") or step.get("tool")
                args = step.get("arguments") or {}
                if fname == "fetch_servicenow_incident" and last_inc and "incident_number" not in args:
                    args["incident_number"] = last_inc
                    step["arguments"] = args
                if fname == "get_similar_incidents" and last_inc and "incident_number" not in args:
                    args["incident_number"] = last_inc
                    step["arguments"] = args
            # prune duplicate fetch
            seen = False
            pruned: List[Dict[str, Any]] = []
            for s in plan:
                if isinstance(s, dict) and (s.get("function_name") == "fetch_servicenow_incident"):
                    if seen:
                        continue
                    seen = True
                pruned.append(s)
            return pruned
        except Exception as e:
            self._log_exception('_validate_and_harden_plan', e, incident_count=len(incidents))
            return plan

    # ---------------- Execution ----------------
    def execute_plan(self) -> Dict[str, Any]:
        """Execute current plan sequentially.

        For each step:
            - Resolve callable from FUNCTION_REGISTRY.
            - Invoke with arguments if dict, else no-arg.
            - Record trace (tool, args, status, duration_ms).
            - Collect errors non-fatally.
        Returns:
            Dict of tool name -> output.
        """
        outputs: Dict[str, Any] = {}
        self.tool_outputs = outputs
        for step in self.plan:
            if not isinstance(step, dict):
                continue
            fname_raw = step.get("function_name")
            fname = fname_raw if isinstance(fname_raw, str) and fname_raw else str(fname_raw or f"unknown_tool_{len(self.traces)}")
            args = step.get("arguments") or {}
            started = time.time()
            status = "error"
            try:
                from .shared_registry import FUNCTION_REGISTRY  # type: ignore
            except Exception:
                FUNCTION_REGISTRY = {}  # type: ignore
            registry_entry = FUNCTION_REGISTRY.get(fname)
            tool_fn = None
            tool_meta: Dict[str, Any] = {}
            if callable(registry_entry):
                tool_fn = registry_entry
            elif isinstance(registry_entry, dict):
                tool_meta = registry_entry
                inner = registry_entry.get("function")
                if callable(inner):
                    tool_fn = inner
            if tool_fn:
                try:
                    outputs[fname] = tool_fn(**args) if isinstance(args, dict) else tool_fn()
                    status = "ok"
                except Exception as call_ex:
                    status = "error"
                    self.errors.append(f"{fname} execution failed: {call_ex}")
            else:
                self.errors.append(f"unknown tool or non-callable registry entry: {fname}")
            self.traces.append({
                "tool": fname,
                "arguments": args,
                "status": status,
                "duration_ms": (time.time()-started)*1000.0,
                **({"description": tool_meta.get("description")} if tool_meta.get("description") else {})
            })
        return outputs

    # -------- Phase2: Advanced execution w/ dependency inference + chunking (sequential path) --------
    def _infer_dependencies(self, step_args: Dict[str, Any], prior_outputs: Dict[str, Any]) -> List[str]:
        deps: List[str] = []
        if not isinstance(step_args, dict) or not prior_outputs:
            return deps
        try:
            serialized: Dict[str, str] = {}
            for k, v in prior_outputs.items():
                try:
                    s = json.dumps(v, default=str)
                except Exception:
                    s = str(v)
                serialized[k] = s[:2000]
            for val in step_args.values():
                if isinstance(val, (str, int, float)):
                    sval = str(val)
                    for k, s in serialized.items():
                        if sval and sval in s:
                            deps.append(k); break
        except Exception:
            return deps
        return deps

    def execute_plan_advanced(self, question: str, prompt: str, metadata: Dict[str, Any], username: Optional[str]) -> Dict[str, Any]:
        """Enhanced sequential executor with rich traces & chunking (Phase2 fallback when LangGraph disabled)."""
        outputs: Dict[str, Any] = {}
        self.tool_outputs = {}
        self.traces = []
        total_steps = len(self.plan)
        if total_steps == 0:
            self._log_flow('EXEC', 'No steps to execute')
            return outputs
        self._log_flow('EXEC_START', 'Beginning sequential execution', total_steps=total_steps)
        try:
            from .shared_registry import FUNCTION_REGISTRY  # type: ignore
        except Exception:
            FUNCTION_REGISTRY = {}  # type: ignore
        reasoning_map = {
            'fetch_servicenow_incident': 'Fetch canonical incident record',
            'get_similar_incidents': 'Retrieve similar incidents',
            'find_incidents_by_short_description': 'Search incidents by short description',
            'fetch_user_incidents': 'List incidents for current user',
            'assignment_group_prediction': 'Predict assignment group',
            'wiki_rag_tool': 'Retrieve wiki snippets'
        }
        for idx, step in enumerate(self.plan, start=1):
            if not isinstance(step, dict):
                continue
            fname = step.get('function_name') or step.get('tool')
            if not isinstance(fname, str):
                continue
            args = step.get('arguments') or step.get('args') or {}
            dependencies = self._infer_dependencies(args if isinstance(args, dict) else {}, outputs)
            # Log start of step (human-readable args snippet)
            arg_snippet = {k: v for k, v in (args.items() if isinstance(args, dict) else []) if isinstance(v, (str,int,float))}
            self._log_flow('EXEC_STEP_START', f"Step {idx}/{total_steps}: {fname}", args=arg_snippet, deps=dependencies)
            trace: Dict[str, Any] = {
                'tool': fname,
                'arguments': args,
                'start_time': time.time(),
                'step_index': idx,
                'total_steps': total_steps,
                'reason': step.get('description') or reasoning_map.get(fname, 'Execute tool step'),
                'dependencies': dependencies
            }
            try:
                registry_entry = FUNCTION_REGISTRY.get(fname)
                fn_meta: Dict[str, Any] = {}
                if callable(registry_entry):
                    fn = registry_entry
                elif isinstance(registry_entry, dict):
                    fn_meta = registry_entry
                    inner = registry_entry.get('function')
                    if callable(inner):
                        fn = inner  # type: ignore
                    else:
                        raise Exception(f"Tool '{fname}' registry entry missing callable under 'function'")
                else:
                    raise Exception(f"Tool '{fname}' not found in registry")
                # Basic schema presence checks (non-fatal warnings)
                try:
                    input_schema = fn_meta.get('input_schema') if fn_meta else None
                    if isinstance(input_schema, dict):
                        missing = [k for k in input_schema.keys() if k not in (args if isinstance(args, dict) else {})]
                        if missing:
                            logger.warning(f"[AO][EXEC] {fname} missing expected args {missing} per input_schema")
                except Exception:
                    pass
                try:
                    output = fn(**args) if isinstance(args, dict) else fn(args)  # type: ignore
                except TypeError:
                    output = fn(args)  # type: ignore
                # Chunk output
                output_chunks = chunk_output(output, max_tokens=1500)
                stored = output_chunks if len(output_chunks) > 1 else output
                outputs[fname] = stored
                self.tool_outputs[fname] = stored
                trace['end_time'] = time.time()
                trace['duration_ms'] = round((trace['end_time'] - trace['start_time']) * 1000, 2)
                trace['status'] = 'ok'
                if isinstance(output, (str, list, dict)):
                    prev = output if not isinstance(output, str) else (output[:300] + '...' if len(output) > 300 else output)
                    trace['output_preview'] = prev
                if fn_meta.get('description'):
                    trace['description'] = fn_meta.get('description')
            except Exception as e:
                trace['end_time'] = time.time()
                trace['duration_ms'] = round((trace['end_time'] - trace['start_time']) * 1000, 2)
                trace['status'] = 'error'
                trace['error'] = str(e)
                self.errors.append(f"{fname}: {e}")
            self.traces.append(trace)
            # Log end of step with concise output / error summary
            if trace.get('status') == 'ok':
                preview = trace.get('output_preview')
                if isinstance(preview, str) and len(preview) > 200:
                    preview = preview[:200] + '...'
                self._log_flow('EXEC_STEP_END', f"Step {idx} complete", tool=fname, status='ok', ms=trace.get('duration_ms'), output_preview=preview)
            else:
                self._log_flow('EXEC_STEP_ERROR', f"Step {idx} error", tool=fname, error=trace.get('error'), ms=trace.get('duration_ms'))
        self._log_flow('EXEC_COMPLETE', 'Sequential execution finished', successes=sum(1 for t in self.traces if t.get('status')=='ok'), failures=sum(1 for t in self.traces if t.get('status')=='error'))
        return outputs

    # -------- Phase3: LangGraph multi-node execution --------
    def _compute_step_dependencies(self, plan: List[Dict[str, Any]]) -> Dict[int, List[int]]:
        """Compute dependency indices based on argument value presence in prior output previews.

        Heuristic: If an argument string matches a tool name executed earlier OR references an 'incident_number' arg provided by earlier step, treat as dependency.
        Returns mapping of step index -> list of prior step indices it depends on.
        """
        deps_map: Dict[int, List[int]] = {}
        prior_inc_numbers: List[str] = []
        for i, step in enumerate(plan):
            if not isinstance(step, dict):
                continue
            args = step.get('arguments') or step.get('args') or {}
            step_deps: List[int] = []
            # simple incident propagation heuristic
            inc_arg = None
            if isinstance(args, dict):
                inc_arg = args.get('incident_number')
            if isinstance(inc_arg, str) and inc_arg in prior_inc_numbers:
                # depend on the most recent prior step that introduced this incident_number
                for j in range(i-1, -1, -1):
                    prev = plan[j]
                    prev_args = prev.get('arguments') or prev.get('args') or {}
                    if isinstance(prev_args, dict) and prev_args.get('incident_number') == inc_arg:
                        step_deps.append(j)
                        break
            # record incident numbers introduced
            if isinstance(inc_arg, str) and inc_arg not in prior_inc_numbers:
                prior_inc_numbers.append(inc_arg)
            deps_map[i] = step_deps
        return deps_map

    def _build_langgraph(self, question: str, prompt: str, metadata: Dict[str, Any], username: Optional[str]) -> Optional[Any]:
        """Compile a LangGraph StateGraph from current plan if available & enabled."""
        flag_val = os.getenv('ENABLE_LANGGRAPH', '0')
        if flag_val.lower() not in ('1','true','yes','on'):
            try:
                self._log_flow('GRAPH_SKIP', 'LangGraph disabled via flag', flag=flag_val)
            except Exception:
                pass
            return None
        if _STATEGRAPH_IMPORT_ERROR is not None:
            try:
                self._log_flow('GRAPH_SKIP', 'StateGraph import error', error=_STATEGRAPH_IMPORT_ERROR)
            except Exception:
                logger.warning(f"[AO][LANGGRAPH] Import unavailable: {_STATEGRAPH_IMPORT_ERROR}")
            return None
        if not self.plan:
            try:
                self._log_flow('GRAPH_SKIP', 'No plan available to build graph')
            except Exception:
                pass
            return None
        # Initial diagnostic
        try:
            self._log_flow('GRAPH_DIAG', 'Preparing LangGraph build', plan_steps=len(self.plan))
        except Exception:
            pass
        try:
            from .shared_registry import FUNCTION_REGISTRY  # type: ignore
        except Exception:
            FUNCTION_REGISTRY = {}  # type: ignore
        sg = StateGraph(dict)  # state is a dict
        deps_map = self._compute_step_dependencies(self.plan)
        # Node builders
        for idx, step in enumerate(self.plan):
            if not isinstance(step, dict):
                continue
            fname = step.get('function_name') or step.get('tool')
            if not isinstance(fname, str):
                continue
            args = step.get('arguments') or step.get('args') or {}
            def _make_node(fn_name: str, fn_args: Dict[str, Any], step_index: int):
                def _node(state: Dict[str, Any]):
                    start = time.time()
                    state.setdefault('traces', [])
                    state.setdefault('tool_outputs', {})
                    state.setdefault('errors', [])
                    try:
                        registry_entry = FUNCTION_REGISTRY.get(fn_name)
                        tool_fn = None
                        fn_meta: Dict[str, Any] = {}
                        if callable(registry_entry):
                            tool_fn = registry_entry
                        elif isinstance(registry_entry, dict):
                            fn_meta = registry_entry
                            inner = registry_entry.get('function')
                            if callable(inner):
                                tool_fn = inner
                        if not callable(tool_fn):
                            raise Exception(f"tool '{fn_name}' not found or registry entry malformed")
                        try:
                            raw_out = tool_fn(**fn_args) if isinstance(fn_args, dict) else tool_fn(fn_args)
                        except TypeError:
                            raw_out = tool_fn(fn_args)
                        out_chunks = chunk_output(raw_out, max_tokens=1500)
                        stored = out_chunks if len(out_chunks) > 1 else raw_out
                        state['tool_outputs'][fn_name] = stored
                        trace = {
                            'tool': fn_name,
                            'arguments': fn_args,
                            'status': 'ok',
                            'duration_ms': round((time.time()-start)*1000,2),
                            'step_index': step_index+1,
                            'total_steps': len(self.plan),
                            'graph': True
                        }
                        if isinstance(raw_out, (str, list, dict)):
                            prev = raw_out if not isinstance(raw_out, str) else (raw_out[:300] + '...' if len(raw_out) > 300 else raw_out)
                            trace['output_preview'] = prev
                        if fn_meta.get('description'):
                            trace['description'] = fn_meta.get('description')
                        state['traces'].append(trace)
                        return state
                    except Exception as e:
                        logger.error(f"FLOW[GRAPH_STEP_ERROR] node={fn_name} error={e}")
                        trace = {
                            'tool': fn_name,
                            'arguments': fn_args,
                            'status': 'error',
                            'error': str(e),
                            'duration_ms': round((time.time()-start)*1000,2),
                            'step_index': step_index+1,
                            'total_steps': len(self.plan),
                            'graph': True
                        }
                        state['traces'].append(trace)
                        state['errors'].append(f"{fn_name}: {e}")
                        return state
                return _node
            sg.add_node(f"step_{idx}_{fname}", _make_node(fname, args if isinstance(args, dict) else {}, idx))
        # Edges: sequential chain + dependency edges
        node_names = [f"step_{i}_{(self.plan[i].get('function_name') or self.plan[i].get('tool'))}" for i in range(len(self.plan))]
        for i in range(len(node_names)-1):
            sg.add_edge(node_names[i], node_names[i+1])
        for idx, dep_indices in deps_map.items():
            for d in dep_indices:
                if d < idx:
                    sg.add_edge(node_names[d], node_names[idx])
        # Entry point = first node
        if node_names:
            try:
                sg.set_entry_point(node_names[0])
            except Exception:
                pass
        try:
            app = sg.compile()
            try:
                self._log_flow('GRAPH_READY', 'LangGraph compiled', nodes=len(node_names))
            except Exception:
                pass
            return app
        except Exception as e:
            try:
                self._log_flow('GRAPH_ERROR', 'LangGraph compile failed', error=str(e))
            except Exception:
                logger.warning(f"[AO][LANGGRAPH] compile failed: {e}")
            return None

    def execute_plan_langgraph(self, question: str, prompt: str, metadata: Dict[str, Any], username: Optional[str]) -> Dict[str, Any]:
        app = self._build_langgraph(question, prompt, metadata, username)
        if not app:
            # Fallback to advanced sequential
            return self.execute_plan_advanced(question, prompt, metadata, username)
        self._log_flow('GRAPH_START', 'LangGraph execution starting', total_steps=len(self.plan))
        init_state: Dict[str, Any] = {
            'question': question,
            'prompt': prompt,
            'metadata': metadata,
            'tool_outputs': {},
            'traces': [],
            'errors': []
        }
        try:
            final_state = app.invoke(init_state)
            # Mirror attributes for downstream usage
            self.tool_outputs = final_state.get('tool_outputs', {})
            self.traces = final_state.get('traces', [])
            self.errors.extend(final_state.get('errors', []))
            self._log_flow('GRAPH_COMPLETE', 'LangGraph finished', successes=sum(1 for t in self.traces if t.get('status')=='ok'), failures=sum(1 for t in self.traces if t.get('status')=='error'))
            return self.tool_outputs
        except Exception as e:
            self.errors.append(str(e))
            logger.error(f"[AO][LANGGRAPH] invoke failed: {e}")
            return {}

    # ---------------- Solve orchestration ----------------
    def solve(self, messages: List[Any], prompt: str, metadata: Dict[str, Any], username: Optional[str] = None) -> Dict[str, Any]:
        """Primary orchestration entrypoint for a user query.

        Pipeline Overview:
            1. Extract question & prepare/prune context (+ optional rolling summary).
            2. Micro-intent cache shortcut (if enabled) returns early.
            3. Intent & persona classification.
            4. Incident id extraction (messages + tool outputs).
            5. Assignment or similarity heuristic shortcuts.
            6. Context retention snapshot.
            7. Prompt augmentation (incident resolution + persona hints).
            8. Plan build (recipe or heuristic) + persona filtering.
            9. Observability injection + plan hardening.
           10. Execute plan collecting outputs & traces.
           11. Adaptive recipe augmentation if evaluation reveals gaps.
           12. Observability summary + incident card build & caching.
           13. Token instrumentation & analytics event emission.

        Parameters:
            messages: Full chat messages including latest user input.
            prompt: System / instruction prompt base.
            metadata: Mutable dict for classification & analytics enrichment.
            username: Optional user identifier for caching & metrics.
        Returns:
            Comprehensive result dict containing plan, tool outputs, metadata, traces.
        Resilience: Any exception returns error + traceback without raising.
        """
        try:
            self._log_flow('SOLVE_START', 'Solve begin')
            question: str = ""
            context_messages: List[Any] = []
            if messages:
                last = messages[-1]
                raw_q = last.get("content") if isinstance(last, dict) else last
                question = raw_q if isinstance(raw_q, str) else ("" if raw_q is None else str(raw_q))
                context_messages = messages[:-1]
            self._log_flow('QUESTION', question[:400])
            # Optional lightweight historical summaries (already assumed pre-summarized elsewhere).
            summaries: List[Dict[str, Any]] = []
            if username and os.getenv("ENABLE_CHAT_SUMMARIES", "").lower() in ("1","true","yes","on"):
                # Configurable count (default 3). These should be pre-summarized short snippets, not raw turns.
                try:
                    count = int(os.getenv("CHAT_SUMMARY_COUNT", "3"))
                except ValueError:
                    count = 3
                raw_summaries = self.get_recent_chat_summaries(username, n=count)
                # Compress into a single synthetic system message to avoid per-summary token overhead.
                if raw_summaries:
                    # Keep each snippet short (first 160 chars) and join.
                    joined = " | ".join([str(s.get("summary") or s)[:160] for s in raw_summaries])
                    summaries = [{"role": "system", "content": f"<chat_history_summaries>{joined}</chat_history_summaries>"}]
            all_context = summaries + context_messages
            pruned = self._prune_context(all_context, max_turns=5)
            # Optional summarization of pruned context into a single message to reduce token load.
            if os.getenv("ENABLE_CONTEXT_MESSAGES_SUMMARY", "").lower() in ("1","true","yes","on") and pruned:
                try:
                    # Keep only user/assistant messages for summarization input.
                    convo_snippets: List[str] = []
                    for m in pruned:
                        if isinstance(m, dict) and m.get("role") in ("user","assistant"):
                            txt = m.get("content") or ""
                            if isinstance(txt, str) and txt.strip():
                                convo_snippets.append(txt.strip()[:300])  # truncate each piece
                    joined = " \n".join(convo_snippets[-8:])  # limit to last 8 snippets to avoid bloat
                    # Lightweight heuristic summary (no LLM call) – could be upgraded later.
                    summary_prefix = "Conversation recap (compressed):"
                    compressed_text = f"{summary_prefix} {joined[:1800]}"  # cap total length
                    pruned = [{"role": "system", "content": f"<compressed_recent_dialogue>{compressed_text}</compressed_recent_dialogue>"}]
                    metadata["context_messages_summarized"] = True
                    metadata["context_messages_original_count"] = len(all_context)
                except Exception as ce:
                    logger.warning(f"context_messages summarization failed: {ce}")
            pruned, rolling_payload = self._apply_rolling_summary(pruned, metadata)
            if username and "username" not in metadata:
                metadata["username"] = username
            early = self._micro_intent_cache_short_circuit(question or "", pruned, metadata, username)
            if early:
                self._log_flow('SHORTCUT', 'Micro-intent cache shortcut used', micro_intent=metadata.get('micro_intent'), incident=metadata.get('incident_context_card', {}).get('incident_number'))
                self._merge_summary_with_card(metadata)
                return early
            self._classify_intent_and_persona(question or "", metadata)
            self._log_flow('CLASSIFIED', 'Intent/persona determined', intent=metadata.get('intent'), persona=metadata.get('persona'))
            incidents_ctx = self._extract_incident_ids_from_messages(pruned)
            incidents_tool = self._extract_incident_ids_from_tool_outputs(self.tool_outputs)
            incidents = incidents_tool + [i for i in incidents_ctx if i not in incidents_tool]
            self._log_flow('INCIDENTS', 'Incident refs collected', incidents=incidents)
            assignment_short = self._early_assignment_short_circuit(question or "", incidents, pruned, metadata, username)
            if assignment_short:
                self._log_flow('SHORTCUT', 'Assignment heuristic shortcut used', incidents=incidents)
                return assignment_short
            self._handle_context_retention(metadata)
            similarity_short = self._pre_rule_similarity(question or "", metadata)
            if similarity_short:
                self._log_flow('SHORTCUT', 'Similarity pre-rule shortcut used')
                return similarity_short
            augmented_prompt = self._augment_prompt_with_incident_resolution(prompt, incidents)
            augmented_prompt = self._select_persona_and_augment_prompt(question or "", metadata, augmented_prompt)
            plan, used_recipe = self._build_or_fetch_recipe_plan(question or "", metadata, augmented_prompt, username)
            # If planner signaled clarification, bypass filtering/execution later
            if isinstance(plan, list):
                plan = self._filter_plan_by_persona(plan, metadata)
            if isinstance(plan, list):
                plan = self._inject_observability(plan, metadata, question or "", incidents, username)
                plan = self._validate_and_harden_plan(plan, incidents)
                self.plan = plan  # only set when list
                self._log_flow('PLAN_READY', 'Plan finalized', steps=len(plan))
                self._log_flow('PLAN_SUMMARY', self._summarize_plan(plan))
            else:
                # clarify_user dict passed through unchanged; self.plan remains []
                self.plan = []
            # Phase3 dispatch: choose execution path
            use_graph = os.getenv('ENABLE_LANGGRAPH', '0').lower() in ('1','true','yes','on')
            if isinstance(plan, dict) and plan.get('clarify_user'):
                self._log_flow('CLARIFY', 'Planner requires user clarification', invalid=plan.get('invalid_entries'))
                # Clarification request from planner
                return {"plan": [], "tool_outputs": {}, "errors": self.errors, "clarify_user": True, "clarification_details": plan.get('invalid_entries'), "question": question, "metadata": metadata, "username": username, "context_messages": pruned, "traces": []}
            if use_graph:
                outputs = self.execute_plan_langgraph(question or '', augmented_prompt, metadata, username)
            else:
                # Use advanced executor for richer traces instead of legacy execute_plan
                outputs = self.execute_plan_advanced(question or '', augmented_prompt, metadata, username)
            adaptive_enabled = getenv("RECIPE_FALLBACK_ENABLED", "true").lower() in ("1","true","yes","on")
            strict_mode = getenv("RECIPE_STRICT", "false").lower() in ("1","true","yes","on")
            if used_recipe and adaptive_enabled and not strict_mode:
                try:
                    eval_res = evaluate_recipe(metadata.get("intent",""), outputs)
                    metadata["recipe_evaluation"] = eval_res
                    if not eval_res.get("passed"):
                        self._log_flow('RECIPE_EVAL', 'Recipe gaps detected', gaps=eval_res.get('gaps'))
                        gaps = eval_res.get("gaps", [])
                        gap_prompt = augmented_prompt + f"\nGAPS: {', '.join(gaps) if gaps else 'unspecified'}\nAdd only steps to fill these gaps."
                        extra_plan_raw = self.plan_tools(question or "", gap_prompt, metadata, username)
                        executed = {s.get("function_name") for s in plan if isinstance(s, dict)}
                        extra_filtered: List[Dict[str, Any]] = []
                        if isinstance(extra_plan_raw, list):
                            for st in extra_plan_raw:
                                if not isinstance(st, dict):
                                    continue
                                fn = st.get("function_name") or st.get("tool")
                                if fn in executed and fn not in gaps:
                                    continue
                                extra_filtered.append(st)
                        if extra_filtered:
                            self._log_flow('PLAN_AUGMENT', 'Executing augmentation steps', new_steps=len(extra_filtered))
                            self.plan = extra_filtered
                            extra_outputs = self.execute_plan()
                            for k,v in extra_outputs.items():
                                if k not in outputs:
                                    outputs[k] = v
                            if isinstance(plan, list):
                                plan = plan + extra_filtered
                                self.plan = plan
                        metadata["plan_source"] = "recipe+planner"
                    else:
                        self._log_flow('RECIPE_EVAL', 'Recipe passed without gaps')
                        metadata["plan_source"] = "recipe"
                except Exception as e:
                    logger.warning(f"recipe fallback failed: {e}")
            else:
                metadata["plan_source"] = "recipe" if used_recipe else "planner"
            export_traces(self.traces)
            self._observability_summary(outputs, metadata)
            result = {"plan": self.plan, "tool_outputs": outputs, "errors": self.errors, "question": question, "metadata": metadata, "username": username, "context_messages": pruned, "traces": self.traces}
            try:
                if metadata.get("micro_intent") and GLOBAL_CONTEXT_CACHE and os.getenv("ENABLE_CONTEXT_CACHE","" ).lower() in ("1","true","yes","on"):
                    inc_out = outputs.get("fetch_servicenow_incident") or outputs.get("fetch_user_incidents")
                    canonical_inc = inc_out if isinstance(inc_out, dict) else (inc_out[0] if isinstance(inc_out, list) and inc_out else None)
                    if canonical_inc:
                        include_logs = metadata.get("micro_intent") in ("incident_logs_lookup",)
                        include_traces = metadata.get("micro_intent") in ("incident_traces_lookup",)
                        card = build_incident_context_card(
                            canonical_inc,
                            include_logs,
                            include_traces,
                            outputs.get("datadog_get_user_logs") if include_logs else None,
                            outputs.get("datadog_get_service_traces") if include_traces else None,
                        )
                        metadata["incident_context_card"] = card
                        emit_event("card.generated", user=username, incident=card.get("number") or card.get("incident_number"), micro_intent=metadata.get("micro_intent"))
                        inc_number = card.get("incident_number") or metadata.get("incident_number")
                        if inc_number:
                            GLOBAL_CONTEXT_CACHE.store({
                                "incident_number": inc_number,
                                "username": username or "anonymous",
                                "card": card,
                                "compressed_history": "",
                                "micro_intents_served": [metadata.get("micro_intent")],
                                "saved_tokens_estimate": 0,
                            })
                        metadata["synthetic_answer_preview"] = json.dumps({"assigned_to": card.get("assigned_to"), "priority": card.get("priority")})
                        self._merge_summary_with_card(metadata)
            except Exception as e:
                logger.warning(f"card build failed: {e}")
            try:
                if GLOBAL_TOKEN_INSTRUMENTATION:
                    entry_id = GLOBAL_TOKEN_INSTRUMENTATION.record(username or "anonymous", question or "", augmented_prompt, result["plan"], metadata.get("micro_intent"), metadata.get("cache_hit", False), metadata)
                    if entry_id:
                        metadata["token_entry_id"] = entry_id
                    if rolling_payload:
                        emit_event("context.summary.applied", user=username, savings_tokens=rolling_payload.get("token_savings_estimate"))
            except Exception:
                pass
            for tr in self.traces:
                try:
                    emit_event("agent.tool.invoked", tool_name=tr.get("tool"), latency_ms=tr.get("duration_ms"), success=(tr.get("status") == "ok"), intent=metadata.get("intent"), plan_source=metadata.get("plan_source"), persona=metadata.get("persona"), question=question)
                except Exception:
                    pass
            emit_event("agent.answer.prepared", intent=metadata.get("intent"), plan_source=metadata.get("plan_source"), persona=metadata.get("persona"))
            self._log_flow('SOLVE_COMPLETE', 'Solve finished', plan_steps=len(self.plan), errors=len(self.errors), plan_source=metadata.get('plan_source'), intent=metadata.get('intent'), persona=metadata.get('persona'))
            return result
        except Exception as e:
            logger.error(f"solve exception: {e}\n{traceback.format_exc()}")
            return {"error": str(e), "traceback": traceback.format_exc()}

    # ---------------- Short-circuit helpers reused in solve ----------------
    def _early_assignment_short_circuit(self, question: str, incidents: List[str], pruned: List[Any], metadata: Dict[str, Any], username: Optional[str]) -> Optional[Dict[str, Any]]:
        """Shortcut: Directly fetch incident & answer assignment ownership questions.

        Triggers when question contains assignment phrases and at least one incident id.
        Returns immediate minimal plan & tool output bundle.
        """
        phrases = ("who is this assigned to","who is it assigned to","who is assigned to this","who owns this incident","who is the assignee","who is assigned","who owns this ticket")
        if any(p in question.lower() for p in phrases) and incidents:
            target = incidents[-1]
            canonical = fetch_servicenow_incident_core(target)
            assigned_to = canonical.get("assigned_to") or canonical.get("u_assigned_to") if isinstance(canonical, dict) else None
            assignment_group = canonical.get("assignment_group") if isinstance(canonical, dict) else None
            return {
                "plan": [{"function_name": "fetch_servicenow_incident", "arguments": {"incident_number": target}}],
                "tool_outputs": {"fetch_servicenow_incident": canonical},
                "question": question,
                "metadata": {**metadata, "plan_source": "assignment_heuristic", "known_incidents": incidents},
                "username": username,
                "context_messages": pruned,
                "traces": [{"tool": "fetch_servicenow_incident", "arguments": {"incident_number": target}, "status": "ok", "assignment_fields": {"assigned_to": assigned_to, "assignment_group": assignment_group}}],
                "errors": self.errors,
            }
        return None

    def _pre_rule_similarity(self, question: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Shortcut: Similar incidents retrieval based on explicit user request.

        Detects phrases like 'similar incidents' when an incident id is present.
        Returns small plan result bundle or None if not triggered / disabled.
        """
        inc_match = INC_PATTERN.search(question or "")
        if getenv("DISABLE_PRE_RULE", "false").lower() in ("1","true","yes","on"):
            return None
        if inc_match and re.search(r"similar|similar incidents|other similar|like this one", question or "", re.IGNORECASE):
            inc_num = inc_match.group(1).upper()
            canonical = fetch_servicenow_incident_core(inc_num)
            sd = canonical.get("short_description") if isinstance(canonical, dict) else None
            similar = get_similar_incidents_simple(sd or inc_num)
            return {"plan": [{"function_name": "get_similar_incidents", "arguments": {"incident_number": inc_num}}], "tool_outputs": {"get_similar_incidents": similar}, "errors": self.errors}
        return None

__all__ = ["AgenticOrchestratorAuto"]

