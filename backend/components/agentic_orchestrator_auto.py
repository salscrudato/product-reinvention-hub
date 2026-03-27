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
ENABLE_ML_INTENT_CLASSIFIER: use ML-based hybrid intent classifier (default: 1 / enabled).
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

from . import mapping_agents  # noqa: F401 ensure mapping tools register on import

# Phase 2: Context retriever for entity tracking
try:
    from .context_retriever import get_retriever  # type: ignore
    CONTEXT_RETRIEVER_AVAILABLE = True
except Exception:
    get_retriever = lambda: None  # type: ignore
    CONTEXT_RETRIEVER_AVAILABLE = False

logger = logging.getLogger("agentic_orchestrator_auto")
logger.setLevel(logging.INFO)
# Ensure a readable file handler exists (idempotent) with rotation
if not any(isinstance(h, logging.FileHandler) and getattr(h, 'baseFilename', '').endswith('agentic_orchestrator_auto.log') for h in logger.handlers):
    from logging.handlers import RotatingFileHandler
    # Configure log rotation: 50MB max per file, keep 5 backups
    fh = RotatingFileHandler(
        'agentic_orchestrator_auto.log', 
        mode='a', 
        encoding='utf-8',
        maxBytes=50 * 1024 * 1024,  # 50MB
        backupCount=5
    )
    fmt = logging.Formatter('%(asctime)s %(levelname)s FLOW: %(message)s')
    fh.setFormatter(fmt)
    fh.setLevel(logging.INFO)
    logger.addHandler(fh)
# Console handler disabled - all output goes to file only
# Uncomment below if you need console output for critical errors:
# if not any(isinstance(h, logging.StreamHandler) for h in logger.handlers):
#     ch = logging.StreamHandler()
#     ch.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
#     ch.setLevel(logging.CRITICAL)  # Only critical errors to console
#     logger.addHandler(ch)

# Safe fallback imports (stubs keep runtime resilient)
try:
    from .intent_classifier import classify_intent  # type: ignore
except Exception:  # pragma: no cover
    classify_intent = lambda *a, **k: None  # type: ignore
try:
    from .intent_classifier_hybrid import get_hybrid_classifier  # type: ignore
    _ML_CLASSIFIER_INSTALLED = True
except Exception:  # pragma: no cover
    get_hybrid_classifier = None  # type: ignore
    _ML_CLASSIFIER_INSTALLED = False

# Check if ML classifier should be enabled (requires both installation + env flag)
HYBRID_CLASSIFIER_AVAILABLE = (_ML_CLASSIFIER_INSTALLED and 
                               getenv('ENABLE_ML_INTENT_CLASSIFIER', '1').lower() in ('1', 'true', 'yes', 'on'))

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
    # Import the module to ensure all @register_tool_function decorators execute
    from . import snowaaonetool  # type: ignore
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
try:  # PHASE3 prompt catalog integration (rollback: remove this block + _catalog_prompt_short_circuit usage in solve)
    from .prompt_resolver import resolve_prompt  # type: ignore
    from .arg_extractors import EXTRACTOR_REGISTRY  # type: ignore
except Exception:
    def resolve_prompt(*a, **k):  # type: ignore
        return {'matched': False, 'reason': 'import_error'}
    EXTRACTOR_REGISTRY = {}
try:  # Short-term memory for coreference resolution (rollback: set ENABLE_SHORT_TERM_MEMORY=0)
    from .short_term_memory import resolve_question_references, store_tool_result, ENABLED as STM_ENABLED  # type: ignore
except Exception:
    resolve_question_references = lambda q, m: (q, False)  # type: ignore
    store_tool_result = lambda *a, **k: None  # type: ignore
    STM_ENABLED = False
try:  # Wiki knowledge enrichment preprocessor (Option B implementation)
    from .CustomWikiRAG import perform_wiki_rag  # type: ignore
    WIKI_RAG_AVAILABLE = True
except Exception:
    perform_wiki_rag = lambda *a, **k: {"summary": {"answer": "", "correlation_applied": False}}  # type: ignore
    WIKI_RAG_AVAILABLE = False
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

# Pre-planning analyzer for scope validation
try:
    from .pre_planning_analyzer import pre_planning_analyzer  # type: ignore
    PRE_ANALYSIS_AVAILABLE = True
except Exception:
    logger.warning("[ORCHESTRATOR] pre_planning_analyzer not available, scope validation disabled")
    def pre_planning_analyzer(*a, **k):  # type: ignore
        return {"feasibility": "supported", "action": "proceed", "confidence": 0.0, "fallback": True}
    PRE_ANALYSIS_AVAILABLE = False

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
        # Environment / dependency health snapshot (helps debug interpreter mismatches)
        try:
            import sys, importlib, importlib.metadata as _md  # type: ignore
            pyexe = sys.executable
            lg_file = None; lc_file = None
            lg_ver = None; lc_ver = None
            try:
                import langgraph as _lg  # type: ignore
                lg_file = getattr(_lg, '__file__', None)
                lg_ver = _md.version('langgraph') if 'langgraph' in {d.metadata['Name'].lower(): d for d in _md.distributions()} else None  # type: ignore
            except Exception as _e_lg:  # pragma: no cover
                lg_file = f"unavailable: {_e_lg}"  # store error string
            try:
                import langchain as _lc  # type: ignore
                lc_file = getattr(_lc, '__file__', None)
                lc_ver = _md.version('langchain') if 'langchain' in {d.metadata['Name'].lower(): d for d in _md.distributions()} else None  # type: ignore
            except Exception as _e_lc:  # pragma: no cover
                lc_file = f"unavailable: {_e_lc}"  # store error string
            sys_path_head = sys.path[:5]
            logger.info(
                "FLOW[GRAPH_HEALTH] Interpreter & deps | %s",
                json.dumps({
                    'python_executable': pyexe,
                    'langgraph_file': lg_file,
                    'langgraph_version': lg_ver,
                    'langchain_file': lc_file,
                    'langchain_version': lc_ver,
                    'sys_path_head': sys_path_head
                }, default=str)
            )
        except Exception as _health_e:  # pragma: no cover
            logger.info(f"FLOW[GRAPH_HEALTH] health_snapshot_failed | error={_health_e}")

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
            qlower = (question or "").lower()
            annotation = metadata.get("annotation")
            # Handle @wiki annotation - force documentation_gap intent to use wiki_rag_tool instead of fetch_kb_articles
            if annotation == "@wiki" or "@wiki" in qlower:
                if not metadata.get("intent"):
                    metadata["intent"] = "documentation_gap"
                metadata["wiki_only_context"] = True  # Flag to prevent ServiceNow KB tool injection
                self._log_flow('ANNOTATION_INTENT', 'Wiki annotation detected - setting intent to documentation_gap', annotation=annotation)
                return
            if annotation == "@mapping" or "@mapping" in qlower:
                if not metadata.get("intent"):
                    metadata["intent"] = "mapping_workflow"
                if not metadata.get("persona"):
                    metadata["persona"] = metadata.get("persona") or "developer"
                return
            if not metadata.get("intent"):
                # Try ML-based hybrid classifier first (ML + regex fallback)
                if HYBRID_CLASSIFIER_AVAILABLE and get_hybrid_classifier:
                    try:
                        hybrid = get_hybrid_classifier()
                        intent_val, classification_meta = hybrid.classify(question, metadata)
                        if intent_val:
                            metadata["intent"] = intent_val
                            metadata["intent_confidence"] = classification_meta.get('confidence', 0.0)
                            metadata["intent_method"] = classification_meta.get('method', 'unknown')
                            self._log_flow('INTENT_ML', f'ML classifier used: {classification_meta.get("method")}',
                                         intent=intent_val,
                                         confidence=classification_meta.get('confidence'),
                                         ml_intent=classification_meta.get('ml_intent'))
                    except Exception as e:
                        logger.warning(f"[Intent] ML classifier failed, falling back to regex: {e}")
                        intent_val = classify_intent(question, metadata)
                        if intent_val:
                            metadata["intent"] = intent_val
                            metadata["intent_method"] = 'regex_fallback'
                else:
                    # Fallback to regex-only classifier
                    intent_val = classify_intent(question, metadata)
                    if intent_val:
                        metadata["intent"] = intent_val
                        metadata["intent_method"] = 'regex'
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

    # ---------------- PHASE3: Catalog prompt short-circuit ----------------
    def _catalog_prompt_short_circuit(self, question: str, metadata: Dict[str, Any], base_prompt: str) -> Optional[Dict[str, Any]]:
        """If catalog prompt matches with sufficient confidence, prepare a plan derived from tool hints.

        Returns a payload describing the catalog-generated plan so the caller can continue with normal
        execution (LangGraph build + run). None indicates no catalog match.
        """
        if os.getenv('PROMPT_CATALOG_ENABLED','1').lower() not in ('1','true','yes','on'):
            return None
        try:
            persona = metadata.get('persona') or None
            catalog_res = resolve_prompt(question, persona, metadata)
            if not catalog_res.get('matched'):
                return None
            prompt_id = catalog_res.get('prompt_id')
            metadata['catalog_prompt_id'] = prompt_id
            metadata['plan_source'] = 'catalog'
            # Intent override if provided (retain original for analytics if changed)
            intent_override = catalog_res.get('intent_override')
            if intent_override and intent_override != metadata.get('intent'):
                metadata['original_intent'] = metadata.get('intent')
                metadata['intent'] = intent_override
            # Extract parameters via registry
            extracted: Dict[str, Any] = {}
            for ex_key in catalog_res.get('param_extractors', []):
                fn = EXTRACTOR_REGISTRY.get(ex_key)
                if not fn:
                    continue
                try:
                    val = fn(question)
                    if val:
                        extracted[ex_key] = val
                except Exception:
                    continue
            # Build plan steps from tool hints; include extracted params where keys align
            plan: List[Dict[str, Any]] = []
            for tool in catalog_res.get('tool_hints', []):
                args_subset = {}
                # heuristic mapping: incident_number extractor -> incident_number arg, change_id -> change_id, ci -> ci
                if 'incident_number' in extracted:
                    args_subset['incident_number'] = extracted['incident_number']
                if 'change_id' in extracted:
                    args_subset['change_id'] = extracted['change_id']
                if 'ci' in extracted:
                    args_subset['ci'] = extracted['ci']
                if 'assignment_group' in extracted:
                    args_subset['assignment_group'] = extracted['assignment_group']
                plan.append({'function_name': tool, 'arguments': args_subset})
            catalog_prompt_text = catalog_res.get('prompt_text') or ''
            payload = {
                'plan': plan,
                'catalog_prompt_text': catalog_prompt_text,
                'catalog_prompt_id': prompt_id,
                'confidence': catalog_res.get('confidence'),
            }
            self._log_flow('SHORTCUT', 'Catalog prompt match used', prompt_id=prompt_id, confidence=catalog_res.get('confidence'), plan_steps=len(plan))
            return payload
        except Exception as e:
            self._log_exception('_catalog_prompt_short_circuit', e)
            return None

    def _drill_down_shortcut(self, question: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Answer drill-down/filter questions from previous tool outputs without re-analyzing.
        
        Detects when user asks for specific subset of data from previous bulk analysis (e.g.,
        "which incidents have documentation gaps?" after "analyze these 50 incidents").
        
        Instead of re-running expensive analysis, extracts answer from short-term memory.
        
        Args:
            question: User question
            metadata: Request metadata
            
        Returns:
            Result dict with final_answer if drill-down answered, None otherwise
        """
        if not STM_ENABLED:
            return None
        
        try:
            from .short_term_memory import get_short_term_memory
            memory = get_short_term_memory()
            drill_down_data = memory.get_drill_down_data()
            
            # No drill-down data available
            if not drill_down_data:
                return None
            
            q_lower = question.lower()
            
            # ═══════════════════════════════════════════════════════════════════════
            # PATTERN 1: Documentation gaps
            # ═══════════════════════════════════════════════════════════════════════
            doc_gap_patterns = [
                'documentation gap', 'doc gap', 'missing documentation',
                'not documented', 'lack of documentation', 'undocumented'
            ]
            
            if any(pattern in q_lower for pattern in doc_gap_patterns):
                if 'incidents_with_doc_gaps' in drill_down_data:
                    incidents = drill_down_data['incidents_with_doc_gaps']
                    
                    if not incidents:
                        answer = "No incidents with documentation gaps were found in the previous analysis."
                    else:
                        answer = f"**Incidents with Documentation Gaps ({len(incidents)} total):**\n\n"
                        for inc in incidents[:20]:  # Limit to 20 for readability
                            answer += f"- {inc}\n"
                        
                        if len(incidents) > 20:
                            answer += f"\n*({len(incidents) - 20} more incidents not shown)*"
                    
                    self._log_flow('DRILL_DOWN_SHORTCUT', 'Answered from previous analysis',
                                  pattern='doc_gaps', incidents=len(incidents), 
                                  source_tool=drill_down_data.get('tool_name'))
                    
                    return {
                        'final_answer': answer,
                        'plan': [],
                        'tool_outputs': {'drill_down': incidents},
                        'metadata': {
                            'shortcut': 'drill_down',
                            'pattern': 'documentation_gaps',
                            'source_tool': drill_down_data.get('tool_name'),
                            'incident_count': len(incidents)
                        }
                    }
            
            # ═══════════════════════════════════════════════════════════════════════
            # PATTERN 2: Category-based filtering
            # ═══════════════════════════════════════════════════════════════════════
            category_patterns = [
                'category', 'type of incident', 'what kind of', 'classification'
            ]
            
            if any(pattern in q_lower for pattern in category_patterns):
                if 'incidents_by_category' in drill_down_data:
                    categories = drill_down_data['incidents_by_category']
                    
                    if not categories:
                        answer = "No category information was extracted in the previous analysis."
                    else:
                        answer = "**Incidents by Category:**\n\n"
                        for category, incs in categories.items():
                            if incs:  # Only show non-empty categories
                                answer += f"**{category}** ({len(incs)} incidents):\n"
                                for inc in incs[:5]:  # Show first 5 per category
                                    answer += f"  - {inc}\n"
                                if len(incs) > 5:
                                    answer += f"  *({len(incs) - 5} more)*\n"
                                answer += "\n"
                    
                    self._log_flow('DRILL_DOWN_SHORTCUT', 'Answered from previous analysis',
                                  pattern='categories', category_count=len(categories), 
                                  source_tool=drill_down_data.get('tool_name'))
                    
                    return {
                        'final_answer': answer,
                        'plan': [],
                        'tool_outputs': {'drill_down': categories},
                        'metadata': {
                            'shortcut': 'drill_down',
                            'pattern': 'categories',
                            'source_tool': drill_down_data.get('tool_name'),
                            'category_count': len(categories)
                        }
                    }
            
            # ═══════════════════════════════════════════════════════════════════════
            # PATTERN 3: Sample/examples request
            # ═══════════════════════════════════════════════════════════════════════
            sample_patterns = [
                'sample', 'example', 'show me some', 'list a few', 'give me some'
            ]
            
            if any(pattern in q_lower for pattern in sample_patterns):
                if 'sample_incidents' in drill_down_data:
                    samples = drill_down_data['sample_incidents']
                    
                    if not samples:
                        answer = "No sample incidents were extracted in the previous analysis."
                    else:
                        answer = f"**Sample Incidents ({len(samples)} shown):**\n\n"
                        for inc in samples[:10]:  # Show up to 10 samples
                            answer += f"- {inc}\n"
                    
                    self._log_flow('DRILL_DOWN_SHORTCUT', 'Answered from previous analysis',
                                  pattern='samples', incidents=len(samples), 
                                  source_tool=drill_down_data.get('tool_name'))
                    
                    return {
                        'final_answer': answer,
                        'plan': [],
                        'tool_outputs': {'drill_down': samples},
                        'metadata': {
                            'shortcut': 'drill_down',
                            'pattern': 'samples',
                            'source_tool': drill_down_data.get('tool_name'),
                            'incident_count': len(samples)
                        }
                    }
            
            # No matching drill-down pattern
            return None
            
        except Exception as e:
            logger.warning(f"Drill-down shortcut failed: {e}", exc_info=True)
            return None

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

    # ---------------- Wiki Knowledge Enrichment (Option B) ----------------
    def _call_llm_for_keyword_extraction(self, wiki_content: str) -> str:
        """Call LLM to extract keywords from wiki content.
        
        Uses same pattern as CustomWikiRAG._chat_complete()
        """
        try:
            from openai import AzureOpenAI, OpenAI  # type: ignore
            
            # Get deployment name
            deployment_name = os.getenv("GPT_MODEL_NAME", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
            logger.info(f"[WIKI_ENRICH] Starting keyword extraction | content_length={len(wiki_content)} model={deployment_name}")
            
            # Create client
            api_key = os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
            endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
            api_version = os.getenv("OPENAI_API_VERSION", "2024-05-01-preview")
            
            if not api_key:
                logger.warning("[WIKI_ENRICH] No API key found in environment")
                return ""
            
            if endpoint and "azure" in endpoint.lower():
                logger.info(f"[WIKI_ENRICH] Using Azure OpenAI | endpoint={endpoint[:50]}...")
                client = AzureOpenAI(
                    api_key=api_key,
                    azure_endpoint=endpoint,
                    api_version=api_version
                )
            else:
                logger.info("[WIKI_ENRICH] Using OpenAI API")
                client = OpenAI(api_key=api_key)
            
            # Call LLM
            messages = [
                {"role": "system", "content": "You are a keyword extraction specialist. Extract only the most relevant search terms."},
                {"role": "user", "content": f"""Extract 5-8 key search terms or phrases from the following knowledge base content. 
Focus on:
- Technical terms, error codes, system names
- Specific requirements or rules
- Problem indicators or symptoms
- Process names or workflow stages

Return ONLY a comma-separated list of terms, no explanations.

Content:
{wiki_content[:1500]}

Key terms:"""}
            ]
            
            logger.info(f"[WIKI_ENRICH] Calling LLM | model={deployment_name} temp=0.3 max_tokens=200")
            response = client.chat.completions.create(
                model=deployment_name,
                messages=messages,  # type: ignore[arg-type]
                temperature=0.3,
                max_tokens=200
            )
            
            result = (response.choices[0].message.content or "").strip()
            logger.info(f"[WIKI_ENRICH] LLM response received | length={len(result)} preview={result[:100] if result else '(empty)'}")
            return result
            
        except Exception as e:
            logger.warning(f"[WIKI_ENRICH] LLM call failed: {type(e).__name__}: {e}")
            import traceback
            logger.debug(f"[WIKI_ENRICH] Full traceback: {traceback.format_exc()}")
            return ""
    
    def _extract_keywords_from_wiki_output(self, wiki_result: Dict[str, Any]) -> List[str]:
        """Extract key search terms from wiki RAG output using LLM.
        
        Args:
            wiki_result: Wiki RAG tool output with 'summary' -> 'answer'
            
        Returns:
            List of extracted keywords/phrases (max 8)
        """
        try:
            wiki_answer = wiki_result.get("summary", {}).get("answer", "")
            if not wiki_answer or len(wiki_answer) < 20:
                return []
            
            # Call LLM for keyword extraction
            response = self._call_llm_for_keyword_extraction(wiki_answer)
            
            if response and isinstance(response, str):
                # Parse comma-separated terms
                keywords = [term.strip() for term in response.split(',')]
                keywords = [k for k in keywords if k and len(k) > 2 and len(k) < 50][:8]
                return keywords
            return []
        except Exception as e:
            logger.warning(f"[WIKI_ENRICH] Keyword extraction failed: {e}")
            return []
    
    def _preprocess_wiki_enrichment(self, question: str, metadata: Dict[str, Any]) -> Tuple[str, Optional[Dict[str, Any]]]:
        """Smart preprocessor: Execute wiki first if @wiki + multi-tool query detected.
        
        Detects patterns like:
        - "@wiki [topic] and find incidents..."
        - "review @wiki [topic] and check JIRA..."
        - "@wiki [rules] find related incidents"
        
        Returns:
            (enhanced_question, wiki_result_or_none)
        """
        if not WIKI_RAG_AVAILABLE:
            return question, None
            
        annotation = metadata.get("annotation")
        if annotation != "@wiki":
            return question, None
        
        # Check if question suggests multi-tool orchestration (not just wiki-only query)
        question_lower = question.lower()
        multi_tool_indicators = [
            "find incident", "related incident", "any incident", "which incident",
            "find jira", "check jira", "review jira", 
            "find issue", "related issue",
            "what was the root cause", "root cause",
            "and find", "and check", "and review", "and analyze",
            "then find", "then check"
        ]
        
        has_multi_tool_intent = any(indicator in question_lower for indicator in multi_tool_indicators)
        
        if not has_multi_tool_intent:
            # Pure wiki query - let normal flow handle it
            return question, None
        
        self._log_flow('WIKI_ENRICH_START', 'Multi-tool query detected - executing wiki first for knowledge enrichment',
                      question=question[:100])
        
        try:
            # Step 1: Extract wiki topic from question (remove multi-tool parts)
            # Example: "@wiki MIB rules and find incidents" -> "MIB rules"
            wiki_topic = question
            for indicator in [" and find", " and check", " and review", " and analyze", " then find"]:
                if indicator in question_lower:
                    wiki_topic = question[:question_lower.index(indicator)]
                    break
            
            # Remove @wiki annotation from topic
            wiki_topic = wiki_topic.replace("@wiki", "").strip()
            
            # Step 2: Execute wiki RAG
            self._log_flow('WIKI_ENRICH_QUERY', f'Executing wiki RAG for topic: {wiki_topic}')
            wiki_result = perform_wiki_rag(wiki_topic)
            
            # Step 3: Extract keywords from wiki output
            keywords = self._extract_keywords_from_wiki_output(wiki_result)
            
            if keywords:
                # Step 4: Enhance question with extracted keywords
                keyword_str = ", ".join(keywords)
                # Inject keywords into question for planner context
                enhanced_question = f"{question} [Wiki knowledge keywords: {keyword_str}]"
                
                self._log_flow('WIKI_ENRICH_COMPLETE', 'Wiki knowledge extracted and injected into query',
                              keywords_count=len(keywords),
                              keywords=keywords[:5],  # Log first 5
                              original_q_len=len(question),
                              enhanced_q_len=len(enhanced_question))
                
                # Mark that enrichment was applied
                metadata['wiki_enrichment_applied'] = True
                metadata['wiki_knowledge_keywords'] = keywords
                metadata['wiki_result_preview'] = wiki_result.get("summary", {}).get("answer", "")[:200]
                
                return enhanced_question, wiki_result
            else:
                # Even without keywords, we have wiki knowledge and detected multi-tool intent
                # Set enrichment flag to allow planner to orchestrate multi-tool execution
                wiki_preview = wiki_result.get("summary", {}).get("answer", "")[:500]
                
                self._log_flow('WIKI_ENRICH_FALLBACK', 'Keyword extraction failed but wiki knowledge available - enabling multi-tool',
                              wiki_content_length=len(wiki_preview))
                
                metadata['wiki_enrichment_applied'] = True
                metadata['wiki_result_preview'] = wiki_preview
                metadata['wiki_enrichment_mode'] = 'fallback'  # Indicate keywords failed but wiki succeeded
                
                return question, wiki_result
                
        except Exception as e:
            logger.warning(f"[WIKI_ENRICH] Preprocessing failed: {e}", exc_info=True)
            self._log_flow('WIKI_ENRICH_ERROR', f'Wiki enrichment failed: {str(e)}')
            return question, None
    
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
    def _enrich_metadata_with_suggestions(self, question: str, metadata: Dict[str, Any], username: Optional[str]) -> None:
        """Enrich metadata with contextual suggestions for better planning.
        
        Uses the contextual question suggester model to generate related questions,
        which can help the planner understand user intent and expand the plan.
        """
        try:
            from .contextual_question_suggester import get_contextual_suggester
            suggester = get_contextual_suggester()
            
            # Generate contextual suggestions based on history
            suggestions = suggester.get_contextual_suggestions(username or 'default', limit=3, use_llm=False)
            
            if suggestions:
                metadata['related_questions'] = suggestions
                metadata['planning_hints'] = [
                    f"User may also be interested in: {sugg}" for sugg in suggestions[:2]
                ]
                logger.info(f"[Planning] Added {len(suggestions)} contextual suggestions to metadata")
        except Exception as e:
            logger.debug(f"[Planning] Could not enrich with contextual suggestions: {e}")
    
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
            plan_raw, std_diag, mode = select_and_plan(question, prompt, metadata, username=username, retrieval_subset_tools=retrieval_subset_tools)  # type: ignore[call-arg]
        except Exception as e:
            import traceback
            logger.error(f"[AO][PLANNER] select_and_plan failed: {e}\n{traceback.format_exc()}")
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
        # Skip recipe building if annotation detected (@wiki, @code, @mapping, @checkpref)
        # EXCEPT when wiki_enrichment_applied flag is set (means preprocessor already ran)
        # These annotations should route directly to specialized tools via retrieval system
        annotation = metadata.get("annotation")
        if annotation in ("@wiki", "@code", "@mapping", "@checkpref"):
            # Check if wiki enrichment was applied - if so, let planner handle multi-tool orchestration
            if annotation == "@wiki" and metadata.get("wiki_enrichment_applied"):
                logger.info(f"[_build_or_fetch_recipe_plan] Wiki enrichment applied - proceeding to planner for multi-tool orchestration")
                # Continue to recipe/planner instead of bypassing
            else:
                logger.info(f"[_build_or_fetch_recipe_plan] Skipping recipe due to annotation: {annotation}")
                return self.plan_tools(question, prompt, metadata, username), False
        
        recipe_plan = None
        used = False
        try:
            if metadata.get("intent"):
                steps = build_recipe(metadata["intent"], metadata.get("persona"), question, metadata)
                if steps:
                    recipe_plan = [{"function_name": s["tool"], "arguments": s["args"]} for s in steps]
                    logger.info(f"[DEBUG] Recipe built {len(steps)} steps, converting to plan with {len(recipe_plan)} steps")
                    for i, (step, plan_step) in enumerate(zip(steps, recipe_plan)):
                        logger.info(f"[DEBUG] Step {i+1}: tool={step['tool']}, args={step['args']}, has_args={bool(step['args'])}")
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
                if not isinstance(args, dict):
                    args = {}
                    step["arguments"] = args
                if fname == "fetch_servicenow_incident":
                    alias = None
                    if "incident_number" not in args:
                        alias = args.pop("number", None) or args.pop("task_effective_number", None) or args.pop("task_number", None)
                        if alias:
                            args["incident_number"] = alias
                    else:
                        # Remove redundant alias keys when incident_number already provided
                        alias = args.pop("number", None) or args.pop("task_effective_number", None) or args.pop("task_number", None)
                    if alias:
                        inc_id = str(alias).upper()
                        if inc_id:
                            last_inc = inc_id
                            if inc_id not in incidents:
                                incidents.append(inc_id)
                    step["arguments"] = args
                if fname == "fetch_servicenow_incident" and last_inc and "incident_number" not in args:
                    args["incident_number"] = last_inc
                    step["arguments"] = args
                if fname == "get_similar_incidents" and last_inc and "incident_number" not in args:
                    args["incident_number"] = last_inc
                    step["arguments"] = args
                # Backup orchestrator style hardening: override mismatched incident_number with most recent known
                # BUT DO NOT override if plan_id looks like a valid incident number that was explicitly requested
                if fname in ("fetch_servicenow_incident","get_similar_incidents","find_incidents_by_short_description") and isinstance(args, dict) and "incident_number" in args:
                    plan_id = str(args.get("incident_number")).upper()
                    # Only override if plan_id is NOT a valid incident pattern (INCxxxxxxx)
                    # If it's a valid incident number, respect it even if not in context yet
                    import re
                    is_valid_incident = re.match(r'^INC\d{7,}$', plan_id) if plan_id else False
                    if incidents and plan_id not in incidents and last_inc and not is_valid_incident:
                        # Override silently but log for transparency
                        self._log_flow('PLAN_HARDEN', f"Override mismatched incident_number {plan_id} -> {last_inc}", tool=fname)
                        args["incident_number"] = last_inc
                        step["arguments"] = args
                    elif is_valid_incident and plan_id not in incidents:
                        # Valid incident requested explicitly - respect it
                        self._log_flow('PLAN_HARDEN', f"Keeping explicit incident request {plan_id} (not in context but valid pattern)", tool=fname)
                # Advanced injection for similarity/finder tools (bring across short_description if canonical available)
                if fname in ("get_similar_incidents","find_incidents_by_short_description") and last_inc:
                    try:
                        canonical = fetch_servicenow_incident_core(last_inc)  # type: ignore
                        sd = canonical.get('short_description') if isinstance(canonical, dict) else None
                        if sd and fname == "get_similar_incidents" and 'short_description' not in args:
                            args['short_description'] = sd
                            step['arguments'] = args
                            self._log_flow('PLAN_HARDEN', 'Injected short_description for get_similar_incidents', incident=last_inc)
                        if sd and fname == "find_incidents_by_short_description" and not args:
                            args['short_description'] = sd
                            step['arguments'] = args
                            self._log_flow('PLAN_HARDEN', 'Injected short_description for finder tool', incident=last_inc)
                        elif fname == "find_incidents_by_short_description" and not args:
                            # fallback to incident_number to ensure tool can still execute deterministically
                            args['incident_number'] = last_inc
                            step['arguments'] = args
                            self._log_flow('PLAN_HARDEN', 'Injected incident_number for finder tool (no short_description)', incident=last_inc)
                    except Exception as inj_e:
                        self._log_flow('PLAN_HARDEN', 'Canonical incident fetch failed for injection', error=str(inj_e))
            # prune duplicate fetch (same incident number only, allow different incidents)
            seen_incidents = set()
            pruned: List[Dict[str, Any]] = []
            for s in plan:
                if isinstance(s, dict) and (s.get("function_name") == "fetch_servicenow_incident"):
                    args = s.get("arguments") or {}
                    incident_num = args.get("incident_number")
                    if incident_num and incident_num in seen_incidents:
                        # Skip duplicate fetch of same incident
                        continue
                    if incident_num:
                        seen_incidents.add(incident_num)
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
                
                # Store tool outputs - if same tool called multiple times, append to list
                if fname in self.tool_outputs:
                    # Tool already called - convert to list if needed and append
                    if not isinstance(self.tool_outputs[fname], list):
                        self.tool_outputs[fname] = [self.tool_outputs[fname]]
                    self.tool_outputs[fname].append(stored)
                else:
                    # First call of this tool
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
        """Compile a simplified LangGraph using existing planner output (supervisor + executor + postprocess).

        Design rationale:
            - Reuse externally prepared self.plan (no re-planning inside graph for determinism).
            - Single executor node loops implicit via supervisor routing.
            - Supports future augmentation by appending steps and resetting current_step.
        """
        flag_val = os.getenv('ENABLE_LANGGRAPH', '1')
        if flag_val.lower() not in ('1','true','yes','on'):
            self._log_flow('GRAPH_SKIP', 'LangGraph disabled via flag', flag=flag_val)
            return None
        if _STATEGRAPH_IMPORT_ERROR is not None:
            self._log_flow('GRAPH_SKIP', 'StateGraph import error', error=_STATEGRAPH_IMPORT_ERROR)
            return None
        if not self.plan:
            self._log_flow('GRAPH_SKIP', 'No plan available to build graph')
            return None
        try:
            from langgraph.graph import StateGraph  # type: ignore
        except Exception as e:
            self._log_flow('GRAPH_SKIP', 'Runtime import failed', error=str(e))
            return None
        try:
            from .shared_registry import FUNCTION_REGISTRY  # type: ignore
        except Exception:
            FUNCTION_REGISTRY = {}  # type: ignore
        self._log_flow('GRAPH_DIAG', 'Preparing LangGraph build', plan_steps=len(self.plan))
        # Dynamic per-step graph construction (optional) creates a node per tool step.
        # NOTE: Indentation fix – dynamic_enabled must be inside method scope.
        dynamic_enabled = os.getenv('ENABLE_LANGGRAPH_DYNAMIC', os.getenv('ENABLE_LANGGRAPH','0')).lower() in ('1','true','yes','on')
        if dynamic_enabled:
            try:
                from typing import TypedDict
                class DynamicGraphState(TypedDict):  # required keys variant to satisfy type checker item access
                    question: str
                    prompt: str
                    metadata: Dict[str, Any]
                    tool_outputs: Dict[str, Any]
                    traces: List[Dict[str, Any]]
                    errors: List[str]
                    done: bool
                sg = StateGraph(DynamicGraphState)
            except Exception:
                DynamicGraphState = Dict[str, Any]  # type: ignore
                sg = StateGraph(dict)  # type: ignore

            def _make_step_fn(step_index: int, step_def: Dict[str, Any]):
                def _fn(state: DynamicGraphState) -> DynamicGraphState:  # type: ignore[name-defined]
                    fname = step_def.get('function_name') or step_def.get('tool')
                    args = step_def.get('arguments') or step_def.get('args') or {}
                    start = time.time()
                    # Initialization (keys are required in DynamicGraphState but guard for runtime resilience)
                    if 'traces' not in state: state['traces'] = []  # type: ignore[index]
                    if 'tool_outputs' not in state: state['tool_outputs'] = {}  # type: ignore[index]
                    if 'errors' not in state: state['errors'] = []  # type: ignore[index]
                    self._log_flow('GRAPH_DYNAMIC_STEP', f"Dynamic step {step_index+1}/{len(self.plan)}: {fname}", args={k:v for k,v in (args.items() if isinstance(args, dict) else []) if isinstance(v,(str,int,float))})
                    status = 'ok'; error_msg = None; output = None
                    try:
                        registry_entry = FUNCTION_REGISTRY.get(fname)
                        tool_fn = registry_entry if callable(registry_entry) else (registry_entry.get('function') if isinstance(registry_entry, dict) and callable(registry_entry.get('function')) else None)
                        if not callable(tool_fn):
                            raise Exception(f"Tool '{fname}' not found")
                        
                        # Parameter name normalization for common LLM mistakes
                        if isinstance(args, dict) and fname == 'fetch_servicenow_incident':
                            # Fix: LLM sometimes uses 'number' instead of 'incident_number'
                            if 'number' in args and 'incident_number' not in args:
                                args['incident_number'] = args.pop('number')
                                logger.info(f"[GRAPH_PARAM_FIX] Normalized parameter 'number' -> 'incident_number' for {fname}")
                        
                        try:
                            output = tool_fn(**args) if isinstance(args, dict) else tool_fn(args)
                        except TypeError:
                            output = tool_fn(args)
                        chunks = chunk_output(output, max_tokens=1500)
                        stored = chunks if len(chunks) > 1 else output
                        if isinstance(fname, str):
                            state['tool_outputs'][fname] = stored  # type: ignore[index]
                    except Exception as e:
                        status = 'error'; error_msg = str(e); state['errors'].append(f"{fname}: {e}")  # type: ignore[index]
                    end = time.time()
                    trace: Dict[str, Any] = {
                        'tool': fname,
                        'arguments': args,
                        'status': status,
                        'error': error_msg,
                        'duration_ms': round((end-start)*1000,2),
                        'step_index': step_index+1,
                        'total_steps': len(self.plan),
                        'graph': True
                    }
                    if output is not None and isinstance(output, (str,list,dict)):
                        prev = output if not isinstance(output, str) else (output[:300] + '...' if len(output) > 300 else output)
                        trace['output_preview'] = prev
                    state['traces'].append(trace)  # type: ignore[index]
                    return state
                return _fn

            # Build nodes per step
            for idx, step_def in enumerate(self.plan):
                node_name = f"step_{idx}"
                sg.add_node(node_name, _make_step_fn(idx, step_def))  # type: ignore[arg-type]
            # Postprocess node
            def _post(state: DynamicGraphState) -> DynamicGraphState:  # type: ignore[name-defined]
                try:
                    self._observability_summary(state.get('tool_outputs', {}), metadata)
                except Exception:
                    pass
                state['done'] = True
                self._log_flow('GRAPH_COMPLETE', 'Dynamic LangGraph finished', successes=sum(1 for t in state.get('traces', []) if t.get('status')=='ok'), failures=sum(1 for t in state.get('traces', []) if t.get('status')=='error'))
                return state
            sg.add_node('postprocess', _post)  # type: ignore[arg-type]
            # Sequential edges (use dependency map for potential future branching)
            deps_map = self._compute_step_dependencies(self.plan)
            for idx in range(len(self.plan)):
                next_idx = idx + 1
                if next_idx < len(self.plan):
                    sg.add_edge(f'step_{idx}', f'step_{next_idx}')
                else:
                    sg.add_edge(f'step_{idx}', 'postprocess')
            sg.set_entry_point('step_0')
            try:
                app = sg.compile()
                self._log_flow('GRAPH_READY', 'Dynamic LangGraph compiled', nodes=len(self.plan)+1, dynamic=True)
                return app
            except Exception as e:
                self._log_flow('GRAPH_ERROR', 'Dynamic LangGraph compile failed', error=str(e))
                # fall back to legacy supervisor/executor graph below
        # ORIGINAL supervisor/executor graph path
        # LangGraph 1.x prefers a schema (TypedDict or dataclass). Use a lightweight dict-compatible class.
        # Define a minimal TypedDict schema for LangGraph
        try:
            from typing import TypedDict
            class GraphState(TypedDict, total=False):
                question: str
                prompt: str
                metadata: Dict[str, Any]
                plan: List[Dict[str, Any]]
                plan_source: str
                current_step: int
                tool_outputs: Dict[str, Any]
                errors: List[str]
                traces: List[Dict[str, Any]]
                clarification_needed: bool
                clarification_details: Any
                done: bool
                adaptive_cycle: int
                incidents: List[str]
                observability_injected: bool
                graph_execution_used: bool
                route: str
            sg = StateGraph(GraphState)
        except Exception:
            # Fallback: attempt with raw dict (may still work depending on version)
            sg = StateGraph(dict)  # type: ignore

        def supervisor(state: GraphState) -> GraphState:  # type: ignore[name-defined]
            # Initialize current_step
            if 'current_step' not in state:
                state['current_step'] = 0
                state['adaptive_cycle'] = 0
                state['graph_execution_used'] = True
                self._log_flow('GRAPH_SUPERVISOR', 'Supervisor init', total_steps=len(self.plan))
            cs = state.get('current_step', 0)
            total = len(self.plan)
            # Completed all steps -> move to postprocess
            if cs >= total:
                state['route'] = 'postprocess'
                return state
            # Route to executor
            state['route'] = 'tool_executor'
            return state

        def tool_executor(state: GraphState) -> GraphState:  # type: ignore[name-defined]
            cs = state.get('current_step', 0)
            total = len(self.plan)
            if cs >= total:
                return state
            step = self.plan[cs]
            fname = step.get('function_name') or step.get('tool')
            args = step.get('arguments') or step.get('args') or {}
            start = time.time()
            state['traces'] = state.get('traces', [])  # ensure list
            state['tool_outputs'] = state.get('tool_outputs', {})  # ensure dict
            state['errors'] = state.get('errors', [])  # ensure list
            self._log_flow('GRAPH_STEP_START', f"Graph step {cs+1}/{total}: {fname}", args={k:v for k,v in (args.items() if isinstance(args, dict) else []) if isinstance(v,(str,int,float))})
            status = 'ok'
            error_msg = None
            output = None
            try:
                registry_entry = FUNCTION_REGISTRY.get(fname)
                tool_fn = None
                if callable(registry_entry):
                    tool_fn = registry_entry
                elif isinstance(registry_entry, dict):
                    inner = registry_entry.get('function')
                    if callable(inner):
                        tool_fn = inner
                if not callable(tool_fn):
                    raise Exception(f"Tool '{fname}' not found")
                try:
                    output = tool_fn(**args) if isinstance(args, dict) else tool_fn(args)
                except TypeError:
                    output = tool_fn(args)
                chunks = chunk_output(output, max_tokens=1500)
                stored = chunks if len(chunks) > 1 else output
                if isinstance(fname, str):
                    state['tool_outputs'][fname] = stored
            except Exception as e:
                status = 'error'
                error_msg = str(e)
                if isinstance(fname, str):
                    state['errors'].append(f"{fname}: {e}")
            end = time.time()
            trace: Dict[str, Any] = {
                'tool': fname,
                'arguments': args,
                'status': status,
                'error': error_msg,
                'duration_ms': round((end-start)*1000,2),
                'step_index': cs+1,
                'total_steps': total,
                'graph': True
            }
            if output is not None and isinstance(output, (str,list,dict)):
                prev = output if not isinstance(output, str) else (output[:300] + '...' if len(output) > 300 else output)
                trace['output_preview'] = prev
            state['traces'].append(trace)
            if status == 'ok':
                self._log_flow('GRAPH_STEP_END', f"Graph step {cs+1} complete", tool=fname, ms=trace['duration_ms'])
            else:
                self._log_flow('GRAPH_STEP_ERROR', f"Graph step {cs+1} error", tool=fname, error=error_msg, ms=trace['duration_ms'])
            state['current_step'] = cs + 1
            state['route'] = 'supervisor'
            return state

        def postprocess(state: GraphState) -> GraphState:  # type: ignore[name-defined]
            # Observability summary & finalize
            try:
                self._observability_summary(state.get('tool_outputs', {}), metadata)
                # Demo augmentation: attach synthesized observability bundle
                if os.getenv('DEMO_DATADOG', '').lower() in ('1','true','yes','on'):
                    obs_tools = {
                        'traces': state.get('tool_outputs', {}).get('datadog_get_service_traces'),
                        'spans': state.get('tool_outputs', {}).get('datadog_search_spans'),
                        'logs': state.get('tool_outputs', {}).get('datadog_get_user_logs'),
                    }
                    # Build a concise demo card if data present
                    if any(obs_tools.values()):
                        demo_card = {
                            'observability_demo': True,
                            'service': metadata.get('observability_service') or 'simulated-service',
                            'summary': metadata.get('observability_summary'),
                            'counts': metadata.get('observability_summary_struct'),
                            'traces_preview': (obs_tools['traces'].get('summary') if isinstance(obs_tools.get('traces'), dict) else None),
                            'spans_preview': (obs_tools['spans'].get('summary') if isinstance(obs_tools.get('spans'), dict) else None),
                            'logs_preview': (obs_tools['logs'].get('summary') if isinstance(obs_tools.get('logs'), dict) else None),
                            'synthesis': 'Demo Mode: Automated investigation surfaced error traces, slow spans, and correlated user errors.'
                        }
                        metadata['observability_demo_card'] = demo_card
            except Exception:
                pass
            state['done'] = True
            self._log_flow('GRAPH_COMPLETE', 'LangGraph finished', successes=sum(1 for t in state.get('traces', []) if t.get('status')=='ok'), failures=sum(1 for t in state.get('traces', []) if t.get('status')=='error'))
            return state

        sg.add_node('supervisor', supervisor)
        sg.add_node('tool_executor', tool_executor)
        sg.add_node('postprocess', postprocess)
        sg.set_entry_point('supervisor')

        # IMPORTANT: Use conditional edges instead of unconditional fan‑out.
        # The previous implementation added BOTH edges from supervisor (to tool_executor AND postprocess)
        # unconditionally, causing LangGraph to treat them as parallel branches writing the same keys
        # (e.g. 'question') in a single step -> INVALID_CONCURRENT_GRAPH_UPDATE.
        # We now drive routing via the 'route' key set inside node functions.
        def _route_from_supervisor(state):  # type: ignore
            return state.get('route', 'tool_executor')
        def _route_from_executor(state):  # type: ignore
            # executor always sets route to 'supervisor' (loop) unless finished then supervisor routes to postprocess
            return state.get('route', 'supervisor')

        try:
            sg.add_conditional_edges('supervisor', _route_from_supervisor, {
                'tool_executor': 'tool_executor',
                'postprocess': 'postprocess'
            })
            sg.add_conditional_edges('tool_executor', _route_from_executor, {
                'supervisor': 'supervisor',
                'postprocess': 'postprocess'
            })
        except Exception:
            # Fallback if this LangGraph version lacks add_conditional_edges:
            # retain single necessary edges only (no direct supervisor->postprocess fan-out)
            sg.add_edge('supervisor', 'tool_executor')
            sg.add_edge('tool_executor', 'supervisor')
            sg.add_edge('tool_executor', 'postprocess')
        try:
            app = sg.compile()
            self._log_flow('GRAPH_READY', 'LangGraph compiled', nodes=len(self.plan)+3)
            return app
        except Exception as e:
            self._log_flow('GRAPH_ERROR', 'LangGraph compile failed', error=str(e))
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
            if question:
                qlower = question.lower()
                # Annotation detection - route directly to specialized tools
                if "@wiki" in qlower:
                    metadata["annotation"] = "@wiki"
                    self._log_flow('ANNOTATION', 'Wiki annotation detected - will skip recipe planning')
                elif "@code" in qlower:
                    metadata["annotation"] = "@code"
                    self._log_flow('ANNOTATION', 'Code annotation detected - will skip recipe planning')
                elif "@mapping" in qlower:
                    metadata["annotation"] = "@mapping"
                    if not metadata.get("assignment_link"):
                        match = re.search(r"https?://[^\s>]+", question)
                        if match:
                            metadata["assignment_link"] = match.group(0).rstrip(').,')
                elif "@checkpref" in qlower:
                    metadata["annotation"] = "@checkpref"
                    self._log_flow('ANNOTATION', 'CheckPref annotation detected')
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
            
            # CRITICAL: Store FULL context for pre-analysis BEFORE compression
            # Pre-analysis needs to see full incident lists, not truncated summaries
            pruned_for_pre_analysis = pruned  # Save before compression
            
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
            
            # NEW: Store context_messages in metadata for planner access
            # This enables short-term memory in the LLM planner
            metadata["context_messages"] = pruned
            self._log_flow('CONTEXT', f'Context messages stored: {len(pruned)} messages')
            
            # Phase 1.5: Short-term memory pronoun resolution (ROLLBACK: set ENABLE_SHORT_TERM_MEMORY=0)
            if STM_ENABLED:
                resolved_question, was_modified = resolve_question_references(question, metadata)
                if was_modified:
                    self._log_flow('STM_RESOLVE', f'Resolved reference in query', 
                                  original=question[:60], resolved=resolved_question[:60],
                                  stm_data=metadata.get('short_term_memory', {}))
                    question = resolved_question  # Use resolved version for planning
            
            if username and "username" not in metadata:
                metadata["username"] = username
            
            # Phase 2: Extract entities from conversation history and inject into metadata
            # CRITICAL: Pass current question to prioritize explicit entity mentions
            if CONTEXT_RETRIEVER_AVAILABLE and os.getenv("ENABLE_ENTITY_TRACKING", "1").lower() in ("1", "true", "yes", "on"):
                try:
                    retriever = get_retriever()
                    if retriever:
                        # Pass current question so "INC0010001" in query takes priority over historical context
                        entities = retriever.extract_entities(window=5, current_question=question)
                        metadata["entities"] = entities
                        self._log_flow('ENTITIES', 'Extracted conversation entities', entities=entities)
                except Exception as e:
                    logger.warning(f"Entity extraction failed: {e}")
            
            # Phase 2.5: Extract canonical incident from chat memory for coreference resolution
            # This allows "this incident" to resolve to the last mentioned incident number
            # CRITICAL: Pass current question to prioritize explicit incident mentions
            try:
                from components.langgraph_flow import extract_canonical_incident_from_chat_memory
                # Convert pruned messages to format expected by extract_canonical_incident_from_chat_memory
                chat_memory_for_canonical = []
                for msg in context_messages:
                    if isinstance(msg, dict):
                        if msg.get('role') == 'user':
                            chat_memory_for_canonical.append({'role': 'user', 'text': msg.get('content', '')})
                        elif msg.get('role') == 'assistant':
                            chat_memory_for_canonical.append({'role': 'assistant', 'answer': msg.get('content', '')})
                
                # Pass current question so explicit mentions (e.g., "INC0010001" in query) 
                # take priority over stale context from previous questions
                canonical = extract_canonical_incident_from_chat_memory(chat_memory_for_canonical, current_question=question)
                if canonical:
                    metadata["canonical_incident"] = canonical
                    self._log_flow('CANONICAL', 'Extracted canonical incident from chat history', incident=canonical.get('number'))
            except Exception as e:
                logger.warning(f"Canonical incident extraction failed: {e}")
            
            # Phase 3: Vague Query Context Inference
            # If user asks vague questions like "what's the status?", infer from recent entities
            if CONTEXT_RETRIEVER_AVAILABLE and os.getenv("ENABLE_VAGUE_QUERY_INFERENCE", "1").lower() in ("1", "true", "yes", "on"):
                try:
                    retriever = get_retriever()
                    if retriever:
                        vague_context = retriever.infer_context_from_vague_query(question or "")
                        if vague_context.get('is_vague') and vague_context.get('confidence', 0) > 0.5:
                            metadata["vague_query_context"] = vague_context
                            # If we inferred an incident, add to canonical if not already present
                            if not metadata.get("canonical_incident") and vague_context.get('incident_number'):
                                metadata["canonical_incident"] = {'number': vague_context['incident_number']}
                            self._log_flow('VAGUE_INFERENCE', 'Inferred context from vague query', 
                                         incident=vague_context.get('incident_number'), 
                                         intent=vague_context.get('likely_intent'), 
                                         confidence=vague_context.get('confidence'))
                except Exception as e:
                    logger.warning(f"Vague query inference failed: {e}")
            
            # Phase 4: Proactive Context Injection
            # Auto-retrieve relevant past conversations for better context
            if CONTEXT_RETRIEVER_AVAILABLE and os.getenv("ENABLE_PROACTIVE_CONTEXT", "1").lower() in ("1", "true", "yes", "on"):
                try:
                    retriever = get_retriever()
                    if retriever:
                        proactive_turns = retriever.get_proactive_context(question or "", k=2)
                        if proactive_turns:
                            metadata["proactive_context"] = proactive_turns
                            # Add to pruned messages for LLM context
                            proactive_summary = "Relevant past conversations:\n" + "\n".join([
                                f"- Q: {turn['question'][:100]}... A: {turn['answer'][:100]}..." 
                                for turn in proactive_turns
                            ])
                            pruned.insert(0, {"role": "system", "content": f"<proactive_context>{proactive_summary}</proactive_context>"})
                            self._log_flow('PROACTIVE_CTX', 'Injected proactive context', turns=len(proactive_turns))
                except Exception as e:
                    logger.warning(f"Proactive context injection failed: {e}")
            
            early = self._micro_intent_cache_short_circuit(question or "", pruned, metadata, username)
            if early:
                self._log_flow('SHORTCUT', 'Micro-intent cache shortcut used', micro_intent=metadata.get('micro_intent'), incident=metadata.get('incident_context_card', {}).get('incident_number'))
                self._merge_summary_with_card(metadata)
                return early
            
            # Phase 7.5: Enrich metadata with contextual suggestions for better planning
            self._enrich_metadata_with_suggestions(question or "", metadata, username)
            
            # Phase 8: Intent classification with ML model
            self._classify_intent_and_persona(question or "", metadata)
            self._log_flow('CLASSIFIED', 'Intent/persona determined', intent=metadata.get('intent'), persona=metadata.get('persona'))
            
            # ═══════════════════════════════════════════════════════════════════════
            # DRILL-DOWN SHORTCUT: Answer filter questions from previous tool outputs
            # ═══════════════════════════════════════════════════════════════════════
            # If user asks "which incidents have X?" after bulk analysis, extract answer
            # from previous tool output instead of re-running expensive analysis
            # Example: After "analyze 50 incidents" → "which have doc gaps?" → Extract from cache
            # Feature flag: ENABLE_SHORT_TERM_MEMORY (same flag as pronoun resolution)
            # ═══════════════════════════════════════════════════════════════════════
            drill_down = self._drill_down_shortcut(question or "", metadata)
            if drill_down:
                self._log_flow('SHORTCUT', 'Drill-down shortcut answered from previous analysis', 
                              pattern=drill_down.get('metadata', {}).get('pattern'),
                              source_tool=drill_down.get('metadata', {}).get('source_tool'))
                # Return early with answer - no need for planning or execution
                return drill_down
            
            # ═══════════════════════════════════════════════════════════════════════
            # PRE-PLANNING ANALYSIS: Validate scope and enrich context
            # ═══════════════════════════════════════════════════════════════════════
            # This prevents errors by understanding intent and checking capabilities
            # BEFORE attempting to plan, rather than fixing errors after execution.
            # Feature flag: ENABLE_PRE_ANALYSIS (default: enabled)
            # ═══════════════════════════════════════════════════════════════════════
            pre_analysis_enabled = os.getenv("ENABLE_PRE_ANALYSIS", "1").lower() in ("1", "true", "yes", "on")
            if PRE_ANALYSIS_AVAILABLE and pre_analysis_enabled:
                try:
                    self._log_flow('PRE_ANALYSIS_START', 'Running pre-planning analysis')
                    pre_analysis_result = pre_planning_analyzer(
                        question=question or "",
                        metadata=metadata,
                        conversation_history=pruned_for_pre_analysis,  # Use FULL context, not compressed
                        enable_scope_validation=True
                    )
                    
                    # Store in metadata for planner access
                    metadata['pre_analysis'] = pre_analysis_result
                    
                    self._log_flow('PRE_ANALYSIS_COMPLETE', 'Pre-analysis finished',
                                 feasibility=pre_analysis_result.get('feasibility'),
                                 action=pre_analysis_result.get('action'),
                                 confidence=pre_analysis_result.get('confidence'))
                    
                    # ═══════════════════════════════════════════════════════════════
                    # HANDLE PRE-ANALYSIS OUTCOMES
                    # ═══════════════════════════════════════════════════════════════
                    
                    if pre_analysis_result.get('action') == 'reject':
                        # Request is out of scope - return explanation to user
                        self._log_flow('PRE_ANALYSIS_REJECT', 'Question rejected - out of scope',
                                     domain=pre_analysis_result.get('capability_match', {}).get('primary_domain'))
                        
                        user_msg = pre_analysis_result.get('user_message', 
                            "I'm unable to help with that request. It's outside my current capabilities.")
                        
                        return {
                            "plan": [],
                            "tool_outputs": {},
                            "errors": ["out_of_scope"],
                            "out_of_scope": True,
                            "question": question,
                            "metadata": metadata,
                            "username": username,
                            "context_messages": pruned,
                            "traces": [],
                            "user_message": user_msg,
                            "alternative_suggested": pre_analysis_result.get('capability_match', {})
                        }
                    
                    elif pre_analysis_result.get('action') == 'clarify':
                        # Need more information from user
                        self._log_flow('PRE_ANALYSIS_CLARIFY', 'Question needs clarification',
                                     patterns=pre_analysis_result.get('patterns_matched', []))
                        
                        user_msg = pre_analysis_result.get('user_message',
                            "I need more information to help you. Can you provide more details?")
                        
                        return {
                            "plan": [],
                            "tool_outputs": {},
                            "errors": [],
                            "clarify_user": True,
                            "clarification_needed": True,
                            "question": question,
                            "metadata": metadata,
                            "username": username,
                            "context_messages": pruned,
                            "traces": [],
                            "user_message": user_msg,
                            "clarification_guidance": pre_analysis_result.get('patterns_matched', [])
                        }
                    
                    # Action is 'proceed' - continue with enriched context
                    self._log_flow('PRE_ANALYSIS_PROCEED', 'Question validated - continuing to planning',
                                 intent=pre_analysis_result.get('intent'),
                                 operation_mode=pre_analysis_result.get('operation_mode'),
                                 hints=len(pre_analysis_result.get('planner_hints', [])))
                    
                except Exception as e:
                    # Pre-analysis failed - log and continue without it
                    logger.warning(f"Pre-analysis failed: {e}", exc_info=True)
                    self._log_flow('PRE_ANALYSIS_ERROR', f'Pre-analysis failed: {str(e)}')
                    metadata['pre_analysis'] = {
                        "feasibility": "supported",
                        "action": "proceed",
                        "confidence": 0.0,
                        "error": str(e),
                        "fallback": True
                    }
            else:
                # Pre-analysis disabled or not available
                if not PRE_ANALYSIS_AVAILABLE:
                    self._log_flow('PRE_ANALYSIS_SKIP', 'Pre-analysis module not available')
                else:
                    self._log_flow('PRE_ANALYSIS_SKIP', 'Pre-analysis disabled by config')
            # PHASE3: Attempt catalog prompt plan derivation before incident extraction & planner
            catalog_payload = self._catalog_prompt_short_circuit(question or "", metadata, prompt)
            catalog_plan_steps: Optional[List[Dict[str, Any]]] = None
            catalog_prompt_text: str = ""
            catalog_prompt_id: Optional[str] = None
            if catalog_payload:
                maybe_plan = catalog_payload.get('plan') if isinstance(catalog_payload, dict) else None
                if maybe_plan and isinstance(maybe_plan, list):
                    catalog_plan_steps = [step for step in maybe_plan if isinstance(step, dict)]
                if isinstance(catalog_payload, dict):
                    raw_prompt_text = catalog_payload.get('catalog_prompt_text')
                    catalog_prompt_text = raw_prompt_text if isinstance(raw_prompt_text, str) else ""
                    raw_prompt_id = catalog_payload.get('catalog_prompt_id')
                    catalog_prompt_id = raw_prompt_id if isinstance(raw_prompt_id, str) else None
                if catalog_plan_steps:
                    metadata['catalog_prompt_applied'] = True
                    
                    # Phase 1.6: STM override for catalog plans (ROLLBACK: remove this block)
                    # If user is referencing cached incidents, override catalog plan with direct fetch
                    if STM_ENABLED:
                        stm_data = metadata.get('short_term_memory')
                        if stm_data and stm_data.get('referenced_incidents'):
                            intent = metadata.get('intent', '')
                            # Check if this is a backlog query asking for "those incidents"
                            if intent == 'backlog_grooming' and len(catalog_plan_steps) == 1:
                                tool_name = catalog_plan_steps[0].get('function_name', '')
                                if tool_name == 'fetch_backlog_overview':
                                    # User wants the specific incidents, not another overview
                                    incidents = stm_data['referenced_incidents'][:5]  # Limit to 5
                                    catalog_plan_steps = [
                                        {'function_name': 'fetch_servicenow_incident', 
                                         'arguments': {'incident_number': inc}} 
                                        for inc in incidents
                                    ]
                                    self._log_flow('STM_OVERRIDE', 'Overrode catalog plan with STM direct fetch', 
                                                  incidents=len(incidents), original_tool=tool_name,
                                                  new_plan_steps=len(catalog_plan_steps),
                                                  plan_preview=[step.get('arguments', {}).get('incident_number') 
                                                               for step in catalog_plan_steps])
                else:
                    metadata.pop('catalog_prompt_applied', None)
                    self._log_flow('SHORTCUT', 'Catalog prompt produced no plan; falling back to planner', prompt_id=catalog_prompt_id)
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
            
            # OPTION B: Wiki Knowledge Enrichment Preprocessor
            # Execute wiki first if @wiki + multi-tool query detected
            wiki_preprocessed_result = None
            original_question = question
            if metadata.get("annotation") == "@wiki":
                enhanced_question, wiki_preprocessed_result = self._preprocess_wiki_enrichment(question or "", metadata)
                if enhanced_question != question:
                    question = enhanced_question
                    self._log_flow('WIKI_ENRICH_APPLIED', 'Question enhanced with wiki knowledge',
                                  original_len=len(original_question or ""),
                                  enhanced_len=len(question or ""))
            
            augmented_prompt = self._augment_prompt_with_incident_resolution(prompt, incidents)
            augmented_prompt = self._select_persona_and_augment_prompt(question or "", metadata, augmented_prompt)
            if catalog_plan_steps and catalog_prompt_text:
                prompt_id_suffix = catalog_prompt_id or metadata.get('catalog_prompt_id') or 'catalog'
                augmented_prompt = augmented_prompt + f"\nCATALOG_PROMPT[{prompt_id_suffix}]: {catalog_prompt_text}"
            used_recipe = False
            if catalog_plan_steps:
                plan: Any = catalog_plan_steps
                metadata['plan_source'] = metadata.get('plan_source', 'catalog')
            else:
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
            use_graph = os.getenv('ENABLE_LANGGRAPH', '1').lower() in ('1','true','yes','on')
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
            if metadata.get('plan_source') == 'catalog':
                result['catalog_prompt_applied'] = True
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
            
            # Phase 1.9: Store tool outputs in short-term memory for next turn (ROLLBACK: set ENABLE_SHORT_TERM_MEMORY=0)
            if STM_ENABLED and self.tool_outputs:
                try:
                    # Store the most relevant tool output (usually the first one executed)
                    primary_tool = None
                    primary_output = None
                    
                    # Priority order for caching: backlog > incident fetch > similar incidents
                    priority_tools = ['fetch_backlog_overview', 'fetch_servicenow_incident', 'get_similar_incidents']
                    for tool_name in priority_tools:
                        if tool_name in self.tool_outputs:
                            primary_tool = tool_name
                            primary_output = self.tool_outputs[tool_name]
                            break
                    
                    # Fallback to first tool if no priority match
                    if not primary_tool and self.tool_outputs:
                        primary_tool = next(iter(self.tool_outputs.keys()))
                        primary_output = self.tool_outputs[primary_tool]
                    
                    if primary_tool and primary_output:
                        store_tool_result(primary_tool, primary_output, metadata.get('intent'))
                        self._log_flow('STM_STORE', f'Stored tool output in short-term memory', tool=primary_tool)
                except Exception as stm_e:
                    logger.warning(f"Failed to store short-term memory: {stm_e}")
            
            # Phase 2: Save conversation turn to context retriever for entity tracking
            if CONTEXT_RETRIEVER_AVAILABLE and os.getenv("ENABLE_ENTITY_TRACKING", "1").lower() in ("1", "true", "yes", "on"):
                try:
                    retriever = get_retriever()
                    if retriever and question:
                        # Extract incidents from this turn
                        incident_refs = incidents if incidents else []
                        # Note: We don't have the final answer text here yet (synthesized in API layer)
                        # Store preliminary data - answer will be added later in API layer
                        retriever.add_turn(
                            question=question,
                            answer="",  # Placeholder - will be updated in API layer
                            incident_refs=incident_refs,
                            metadata={
                                "intent": metadata.get("intent"),
                                "persona": metadata.get("persona"),
                                "plan_source": metadata.get("plan_source")
                            }
                        )
                        self._log_flow('CONTEXT_SAVED', 'Conversation turn saved', incidents=len(incident_refs))
                except Exception as e:
                    logger.warning(f"Failed to save context turn: {e}")
            
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

