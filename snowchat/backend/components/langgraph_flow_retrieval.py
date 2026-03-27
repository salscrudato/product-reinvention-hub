"""langgraph_flow_retrieval

Alternative planner flow that narrows tool set via lightweight retrieval before
LLM planning. Activated when PLANNER_VERSION=retrieval (env).

Strategies:
 1. Build compressed descriptors for all FUNCTION_REGISTRY tools once (name + short doc).
 2. Embed descriptors lazily (simulate if OPENAI key absent or DATADOG_SIMULATE active).
 3. For each incoming question, compute embedding -> cosine similarity -> select top K tools.
 4. Provide only those tool descriptions in planner prompt (plus annotation hints if any).

Falls back to full list if embedding fails.
"""
from __future__ import annotations
import os, json, logging, sys, math, time, re
from typing import List, Dict, Any, Optional, Callable
import numpy as np
from dotenv import load_dotenv
from .shared_registry import FUNCTION_REGISTRY
from .embedding_utils import generate_embeddings as shared_generate_embeddings
import openai
OPENAI_VERSION = getattr(openai, '__version__', 'unknown')
try:  # Prefer explicit client classes if available (openai>=1.x)
    from openai import AzureOpenAI, OpenAI  # type: ignore
except Exception:  # pragma: no cover
    AzureOpenAI = None  # type: ignore
    OpenAI = None  # type: ignore
TOOL_BINDING_MODE = os.getenv('TOOL_BINDING_MODE', 'prompt').lower()  # 'prompt' | 'langchain'

if TOOL_BINDING_MODE == 'langchain':
    try:  # Prefer new provider package if installed
        from langchain_openai import ChatOpenAI  # type: ignore  # langchain>=0.3.x separate provider packages
    except Exception:  # pragma: no cover
        try:
            from langchain.chat_models import ChatOpenAI  # type: ignore
        except Exception:  # pragma: no cover
            ChatOpenAI = None  # type: ignore
    try:
        from langchain.tools import StructuredTool  # type: ignore
    except Exception:  # pragma: no cover
        StructuredTool = None  # type: ignore

load_dotenv()
logger = logging.getLogger(__name__)
if not logger.hasHandlers():
    fmt = logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s')
    fh = logging.FileHandler('snowchat_backend.log', mode='a', encoding='utf-8')
    fh.setFormatter(fmt)
    fh.setLevel(logging.INFO)
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    ch.setLevel(logging.WARNING)
    logger.addHandler(fh)
    logger.addHandler(ch)
logger.setLevel(logging.INFO)

GPT_MODEL_NAME = os.getenv('GPT_MODEL_NAME', 'gpt-4o-mini')
EMBED_MODEL = os.getenv('EMBED_MODEL', 'text-embedding-ada-002')
MAX_TOOL_SCHEMAS = int(os.getenv('MAX_TOOL_SCHEMAS', '8'))
RETRIEVAL_MIN_SIM = float(os.getenv('TOOL_RETRIEVAL_MIN_SIM', '0.0'))
SIMULATE = os.getenv('DATADOG_SIMULATE', '0') in ('1','true','True')  # Only affects DataDog tool simulation
# New explicit flag to disable embeddings without tying to DataDog simulation
DISABLE_EMBEDDINGS = os.getenv('DISABLE_EMBEDDINGS', '0').lower() in ('1','true','yes','on')

# ---------------- Data Structures -----------------
class Command:
    def __init__(self, question: str | None = None, prompt: str | None = None, metadata: dict | None = None):
        self.question = question or ''
        self.prompt = prompt or ''
        self.metadata = metadata or {}
        self.function_sequence: List[dict] = []
        self.results: Dict[str, Any] = {}
        self.context: Dict[str, Any] = {}
        self.errors: List[str] = []
        self.username: Optional[str] = None
    def update_result(self, fn, result):
        self.results[fn] = result

# --------------- Tool Descriptor Compression ---------------
_tool_descriptors: List[str] = []
_tool_names: List[str] = []
_tool_embeddings: Optional[np.ndarray] = None
_embedded = False


def _generate_embeddings_with_override(texts: List[str]) -> List[List[float]]:
    """Use shared embedding helper, optionally overriding model with EMBED_MODEL."""
    if not EMBED_MODEL:
        return shared_generate_embeddings(texts)
    previous = os.getenv("EMBEDDING_MODEL_NAME")
    os.environ["EMBEDDING_MODEL_NAME"] = EMBED_MODEL
    try:
        return shared_generate_embeddings(texts)
    finally:
        if previous is None:
            os.environ.pop("EMBEDDING_MODEL_NAME", None)
        else:
            os.environ["EMBEDDING_MODEL_NAME"] = previous

def _compress_doc(name: str, obj: Any) -> str:
    doc = (getattr(obj, '__doc__', '') or '').strip().split('\n')[0][:220]
    # Provide argument schema hint if available
    fields = []
    args_schema = getattr(obj, 'args_schema', None)
    if args_schema and getattr(args_schema, '__fields__', None):
        fields = list(args_schema.__fields__.keys())[:5]
    field_part = f" args={fields}" if fields else ''
    return f"{name}: {doc or 'no doc'}{field_part}".strip()


def _ensure_embeddings():
    global _tool_descriptors, _tool_names, _tool_embeddings, _embedded
    if _embedded:
        return
    _tool_names = list(FUNCTION_REGISTRY.keys())
    _tool_descriptors = [_compress_doc(n, FUNCTION_REGISTRY[n]) for n in _tool_names]
    # Attempt embedding unless explicitly disabled
    if DISABLE_EMBEDDINGS:
        logger.info("[retrieval_planner] DISABLE_EMBEDDINGS flag active; skipping embedding and using heuristic ordering.")
        _tool_embeddings = None
    else:
        try:
            vecs = _generate_embeddings_with_override(_tool_descriptors)
            _tool_embeddings = np.array(vecs, dtype=float)
            logger.info(f"[retrieval_planner] Embedded {_tool_embeddings.shape[0]} tool descriptors")
        except Exception as e:
            logger.warning(f"[retrieval_planner] Embedding failed, falling back to no-embed mode: {e}")
            _tool_embeddings = None
    _embedded = True


def _select_tools(question: str) -> List[int]:
    _ensure_embeddings()
    if not question.strip():
        return list(range(0, min(MAX_TOOL_SCHEMAS, len(_tool_descriptors))))
    if _tool_embeddings is None:
        # simple heuristic: return first K stable ordering
        return list(range(0, min(MAX_TOOL_SCHEMAS, len(_tool_descriptors))))
    # Embed question
    if DISABLE_EMBEDDINGS:
        logger.info("[retrieval_planner] DISABLE_EMBEDDINGS active; skipping question embedding and using heuristic ordering.")
        return list(range(0, min(MAX_TOOL_SCHEMAS, len(_tool_descriptors))))
    try:
        q_vec = np.array(_generate_embeddings_with_override([question])[0], dtype=float)
    except Exception as e:
        logger.warning(f"[retrieval_planner] Question embedding failed; fallback heuristic subset. err={e}")
        return list(range(0, min(MAX_TOOL_SCHEMAS, len(_tool_descriptors))))
    # Cosine similarities
    tv = _tool_embeddings
    sims = (tv @ q_vec) / (np.linalg.norm(tv, axis=1) * (np.linalg.norm(q_vec) + 1e-9))
    idx = np.argsort(sims)[::-1]
    selected = [i for i in idx if sims[i] >= RETRIEVAL_MIN_SIM][:MAX_TOOL_SCHEMAS]
    if not selected:
        selected = list(idx[:MAX_TOOL_SCHEMAS])
    logger.info(f"[retrieval_planner] Selected tools: {[ _tool_names[i] for i in selected ]}")
    return selected

# --------------- Annotation Hints (reuse minimal) ---------------
ANNOTATION_COMMAND_SET = {'@wiki','@code','@log'}

def _extract_annotation(q: str) -> Optional[str]:
    for a in ANNOTATION_COMMAND_SET:
        if a in q:
            return a
    return None

# --------------- Planning ---------------

def determine_function_sequence(command: Command):
    question = command.question
    annotation = _extract_annotation(question.lower())

    # Build candidate tool subset
    selected_idx = _select_tools(question)
    subset_names = [_tool_names[i] for i in selected_idx]
    subset_desc = [_tool_descriptors[i] for i in selected_idx]

    hints = []
    if annotation == '@wiki':
        hints.append('Annotation @wiki present: wiki_rag_tool likely relevant.')
    if annotation == '@code':
        hints.append('Annotation @code present: code_annotation_tool may help annotate or summarize code.')
    if annotation == '@log':
        hints.append('Annotation @log present: consider datadog_* tools for observability analysis.')

    hints_block = '' if not hints else ('\nHINTS:\n' + '\n'.join(hints))

    tool_list_block = '\n'.join(subset_desc)
    prompt = f"""
    You are an agentic planner. Decide which tools (subset below) to call and in what order.
    Only use tool names exactly as provided.

    TOOL CANDIDATES:
    {tool_list_block}
    {hints_block}

    User Question: {question}

    Return JSON: {{"function_calls": [ {{"function_name": <name>, "arguments": {{...}}}} ] }}
    If no tool is helpful return {{"function_calls": []}}.
    """

    # Branch: LangChain bind_tools mode (independent of DataDog simulation)
    if TOOL_BINDING_MODE == 'langchain' and not (os.getenv('DISABLE_LANGCHAIN_BINDING', '0').lower() in ('1','true','yes','on')):
        # Original guard was too strict and allowed a None StructuredTool when langchain already imported.
        # We now explicitly require both ChatOpenAI and StructuredTool objects to be present.
        if (ChatOpenAI is None) or (StructuredTool is None):
            logger.warning('[retrieval_planner] LangChain bindings unavailable (ChatOpenAI or StructuredTool missing); falling back to prompt mode.')
        else:
            try:
                # Build StructuredTool objects for subset
                lc_tools = []
                for name in subset_names:
                    fn = FUNCTION_REGISTRY.get(name)
                    if not callable(fn):
                        continue
                    doc = (getattr(fn, '__doc__', '') or '').strip().split('\n')[0][:200] or 'No description.'
                    # Attempt to derive args schema via signature => kwargs handled by StructuredTool automatically if we pass schema via args
                    # For simplicity rely on auto schema; if fn has attribute args_schema use that for description augmentation
                    try:
                        lc_tool = StructuredTool.from_function(fn, name=name, description=doc)  # type: ignore[union-attr]
                        lc_tools.append(lc_tool)
                    except AttributeError:
                        # Defensive: StructuredTool unexpectedly None or missing from_function on this version
                        logger.warning(f"[retrieval_planner] StructuredTool.from_function unavailable for '{name}'; skipping tool in langchain mode.")
                    except Exception as tool_build_err:  # pragma: no cover
                        logger.warning(f"[retrieval_planner] Failed constructing StructuredTool for '{name}': {tool_build_err}; skipping.")
                if not lc_tools:
                    raise RuntimeError('No tools constructed for LangChain binding')
                # Unified ChatOpenAI initialization mirroring function_call_planner style, honoring existing env vars.
                def _init_chat_openai(alternate: bool = False) -> Optional[object]:
                    """Robust ChatOpenAI initialization supporting Azure & public paths.

                    For Azure we try multiple patterns because provider packages / versions differ
                    in accepted kwargs. If alternate=True we expand attempts further (used on retry
                    after a 404 which likely indicates incorrect base URL pattern).
                    """
                    if not ChatOpenAI:
                        return None
                    model = GPT_MODEL_NAME
                    temperature = 0.0
                    azure_key = (os.getenv('AZURE_OPENAI_API_KEY') or '').strip()
                    azure_endpoint = (os.getenv('AZURE_OPENAI_ENDPOINT') or '').strip().rstrip('/')
                    azure_deployment = (os.getenv('AZURE_OPENAI_DEPLOYMENT') or GPT_MODEL_NAME).strip()
                    azure_api_version = (os.getenv('OPENAI_API_VERSION') or '2024-05-01-preview').strip()
                    public_key = (os.getenv('OPENAI_API_KEY') or '').strip()
                    # Build attempt list (each a dict of kwargs); we will introspect ChatOpenAI signature lightly.
                    attempts: List[Dict[str, Any]] = []
                    if azure_key and azure_endpoint:
                        # Official Azure pattern for langchain-openai: model=<deployment>, azure_endpoint, api_key, api_version
                        # Provide both api_key and openai_api_key naming variants to handle differing provider expectations.
                        for key_param_name in ('api_key','openai_api_key'):
                            attempts.append({
                                'model': azure_deployment,  # deployment alias used as model
                                'azure_endpoint': azure_endpoint,
                                key_param_name: azure_key,
                                'api_version': azure_api_version,
                            })
                        # Base URL forms (older variants) without azure_endpoint kwargs
                        base_url = f"{azure_endpoint}/openai/deployments/{azure_deployment}"
                        for key_param_name in ('api_key','openai_api_key'):
                            attempts.append({
                                'model': model,
                                key_param_name: azure_key,
                                'base_url': base_url,
                            })
                            attempts.append({
                                'model': model,
                                key_param_name: azure_key,
                                'openai_api_base': base_url,
                            })
                        if alternate:
                            for key_param_name in ('api_key','openai_api_key'):
                                attempts.append({
                                    'model': azure_deployment,
                                    key_param_name: azure_key,
                                    'openai_api_base': base_url,
                                })
                    elif public_key:
                        attempts.append({'model': model, 'api_key': public_key})
                        attempts.append({'model': model, 'openai_api_key': public_key})
                    else:
                        attempts.append({'model': model})  # rely on ambient env
                    last_err: Optional[Exception] = None
                    # Light signature filtering to avoid "unexpected keyword" propagation downstream
                    from inspect import signature, Parameter
                    try:
                        sig = signature(ChatOpenAI.__init__)
                        accepted = set(p.name for p in sig.parameters.values() if p.kind in (Parameter.POSITIONAL_OR_KEYWORD, Parameter.KEYWORD_ONLY))
                    except Exception:
                        accepted = None  # fall back to raw
                    for i, kw in enumerate(attempts):
                        filtered_kw = {k: v for k, v in kw.items() if (accepted is None or k in accepted)}
                        dropped = set(kw.keys()) - set(filtered_kw.keys())
                        try:
                            inst = ChatOpenAI(temperature=temperature, **filtered_kw)  # type: ignore[arg-type]
                            logger.info(f"[retrieval_planner] ChatOpenAI init attempt {i+1}/{len(attempts)} success kw={list(filtered_kw.keys())} dropped={list(dropped)}")
                            return inst
                        except Exception as e:  # pragma: no cover
                            last_err = e
                            err_txt = str(e)
                            if '401' in err_txt or 'invalid_api_key' in err_txt:
                                logger.warning(f"[retrieval_planner] ChatOpenAI init attempt {i+1} failed 401/invalid key. Verify key matches endpoint & deployment. kw={list(filtered_kw.keys())} dropped={list(dropped)}")
                            else:
                                logger.warning(f"[retrieval_planner] ChatOpenAI init attempt {i+1} failed: {e} kw={list(filtered_kw.keys())} dropped={list(dropped)}")
                    if last_err:
                        logger.error(f"[retrieval_planner] ChatOpenAI init failed after {len(attempts)} attempts: {last_err}")
                    return None

                llm = _init_chat_openai()
                if not llm:
                    raise RuntimeError('ChatOpenAI unavailable')
                # Some older / variant ChatOpenAI classes may not implement bind_tools yet.
                bound = None
                try:
                    if hasattr(llm, 'bind_tools'):
                        bound = llm.bind_tools(lc_tools)  # type: ignore[attr-defined]
                    elif hasattr(llm, 'bind'):
                        # Fallback: newer core uses bind(tool_choice=...) with tool schemas
                        try:
                            from langchain_core.utils.function_calling import convert_to_openai_tool
                            tool_schemas = [convert_to_openai_tool(t) for t in lc_tools]
                            bound = llm.bind(tools=tool_schemas)  # type: ignore[arg-type]
                        except Exception as conv_e:  # pragma: no cover
                            logger.warning(f"[retrieval_planner] Tool schema conversion fallback failed: {conv_e}")
                    else:
                        logger.warning('[retrieval_planner] ChatOpenAI instance lacks bind_tools/bind; falling back to prompt mode.')
                except NotImplementedError as nie:  # pragma: no cover
                    logger.warning(f"[retrieval_planner] bind_tools not implemented in this ChatOpenAI variant: {nie}; falling back to prompt mode.")
                    bound = None
                except Exception as bind_err:
                    logger.error(f"[retrieval_planner] bind_tools unexpected error: {bind_err}; falling back to prompt mode.")
                    bound = None
                if bound is None:
                    raise RuntimeError('bind_tools unavailable')
                system_msg = 'You are an agentic planner. Decide an ordered subset of the provided tools to solve the user question. If none, respond with no tool calls.'
                # We encourage the model to call each needed tool once; planning only. We then extract tool_calls from AIMessage
                # Message class imports: adapt across langchain versions
                try:
                    from langchain.schema import HumanMessage, SystemMessage  # type: ignore
                except Exception:  # pragma: no cover
                    try:
                        from langchain_core.messages import HumanMessage, SystemMessage  # type: ignore
                    except Exception:
                        HumanMessage = None  # type: ignore
                        SystemMessage = None  # type: ignore
                if HumanMessage is None or SystemMessage is None:
                    raise RuntimeError('HumanMessage/SystemMessage classes unavailable for bind_tools path')
                azure_key = (os.getenv('AZURE_OPENAI_API_KEY') or '').strip()
                azure_endpoint = (os.getenv('AZURE_OPENAI_ENDPOINT') or '').strip()
                tried_retry = False
                try:
                    ai_msg = bound.invoke([
                        SystemMessage(content=system_msg),
                        HumanMessage(content=f"User Question: {question}\n{hints_block}\nIf tools are needed call them in order; keep arguments minimal.")
                    ])
                except TypeError as te:
                    logger.error(f"[retrieval_planner] bound.invoke TypeError (likely signature mismatch): {te}; falling back to prompt JSON mode.")
                    raise RuntimeError('bind_tools invoke failed') from te
                except Exception as inv_e:
                    # Detect Azure 404 mismatch and attempt alternate construction once
                    inv_str = str(inv_e)
                    if (not tried_retry) and azure_key and azure_endpoint and '404' in inv_str:
                        tried_retry = True
                        logger.warning("[retrieval_planner] bound.invoke returned 404; retrying with alternate Azure ChatOpenAI patterns")
                        alt_llm = _init_chat_openai(alternate=True)
                        if alt_llm:
                            try:
                                if hasattr(alt_llm, 'bind_tools'):
                                    bound = alt_llm.bind_tools(lc_tools)  # type: ignore[attr-defined]
                                elif hasattr(alt_llm, 'bind'):
                                    from langchain_core.utils.function_calling import convert_to_openai_tool
                                    tool_schemas = [convert_to_openai_tool(t) for t in lc_tools]
                                    bound = alt_llm.bind(tools=tool_schemas)  # type: ignore[arg-type]
                                ai_msg = bound.invoke([
                                    SystemMessage(content=system_msg),
                                    HumanMessage(content=f"User Question: {question}\n{hints_block}\nIf tools are needed call them in order; keep arguments minimal.")
                                ])
                            except Exception as retry_err:
                                logger.error(f"[retrieval_planner] Retry after 404 failed: {retry_err}; falling back to prompt JSON mode.")
                                raise RuntimeError('bind_tools invoke failed') from retry_err
                        else:
                            logger.error("[retrieval_planner] Alternate Azure ChatOpenAI init failed after 404; falling back to prompt JSON mode.")
                            raise RuntimeError('bind_tools invoke failed') from inv_e
                    elif 'invalid_api_key' in inv_str or '401' in inv_str:
                        logger.error(
                            f"[retrieval_planner] bound.invoke authentication failed (401/invalid_api_key). Guidance: \n"
                            " 1. Confirm AZURE_OPENAI_API_KEY matches the Azure resource (not public OpenAI key).\n"
                            " 2. Ensure AZURE_OPENAI_ENDPOINT is in form https://<resource>.openai.azure.com (no trailing slash).\n"
                            " 3. Verify the deployment name in AZURE_OPENAI_DEPLOYMENT exactly matches portal.\n"
                            " 4. If using public OpenAI key, unset AZURE_* vars and set TOOL_BINDING_MODE=prompt or rely on public attempts.\n"
                            " 5. Regenerate key if recently rotated."
                        )
                        raise RuntimeError('bind_tools invoke failed') from inv_e
                    else:
                        logger.error(f"[retrieval_planner] bound.invoke error: {inv_e}; falling back to prompt JSON mode.")
                        raise RuntimeError('bind_tools invoke failed') from inv_e
                tool_calls = getattr(ai_msg, 'tool_calls', []) or []
                valid = []
                for tc in tool_calls:
                    tname = getattr(tc, 'name', None) or tc.get('name') if isinstance(tc, dict) else None
                    targs = getattr(tc, 'args', None) or tc.get('args') if isinstance(tc, dict) else {}
                    if tname in subset_names and tname in FUNCTION_REGISTRY:
                        if not isinstance(targs, dict):
                            try:
                                targs = json.loads(targs) if isinstance(targs, str) else {}
                            except Exception:
                                targs = {}
                        valid.append({"function_name": tname, "arguments": targs})
                command.function_sequence = valid
                return command
            except Exception as e:
                logger.error(f"[retrieval_planner] LangChain bind_tools planning failed: {e}\nFalling back to prompt JSON mode.")
    # Default prompt JSON mode
    messages = [
        {"role": "system", "content": "You plan tool sequences."},
        {"role": "user", "content": prompt}
    ]
    # --- Azure / OpenAI client initialization (prompt JSON mode) ---
    raw = '{"function_calls": []}'
    client = None
    client_mode = 'legacy-openai-module'
    azure_key = (os.getenv('AZURE_OPENAI_API_KEY') or '').strip()
    azure_endpoint = (os.getenv('AZURE_OPENAI_ENDPOINT') or '').strip().rstrip('/')
    azure_api_version = (os.getenv('OPENAI_API_VERSION') or '2024-05-01-preview').strip()
    public_key = (os.getenv('OPENAI_API_KEY') or '').strip()

    try:
        if azure_key and azure_endpoint and AzureOpenAI:
            client = AzureOpenAI(api_key=azure_key, azure_endpoint=azure_endpoint, api_version=azure_api_version)  # type: ignore[arg-type]
            client_mode = 'azure-openai-client'
        elif public_key and OpenAI:
            client = OpenAI(api_key=public_key)  # type: ignore[arg-type]
            client_mode = 'openai-client'
        else:
            # Fallback: attempt to set api_key on legacy module if available
            if azure_key and azure_endpoint:
                # Legacy Azure (deprecated) pattern support
                os.environ['OPENAI_API_KEY'] = azure_key
                os.environ['OPENAI_API_BASE'] = azure_endpoint
                os.environ['OPENAI_API_VERSION'] = azure_api_version
                client_mode = 'legacy-azure-env'
            elif public_key:
                openai.api_key = public_key  # type: ignore
                client_mode = 'legacy-openai-env'
    except Exception as e:  # pragma: no cover
        logger.error(f"[retrieval_planner] Failed initializing OpenAI/Azure client: {e}")
        client = None

    # Diagnostic log (no key material logged)
    logger.info(
        f"[retrieval_planner] Using client_mode={client_mode} azure_endpoint={'set' if azure_endpoint else 'none'} azure_key={'present' if azure_key else 'absent'} public_key={'present' if public_key else 'absent'}"
    )

    try:
        if client_mode in ('azure-openai-client','openai-client') and client is not None:
            try:
                chat_completion = client.chat.completions.create(  # type: ignore[attr-defined]
                    model=GPT_MODEL_NAME,
                    messages=messages,  # type: ignore[arg-type]
                    max_tokens=500,
                    temperature=0.0
                )
                raw = chat_completion.choices[0].message.content  # type: ignore
            except Exception as primary_err:
                # Fallback attempt: legacy global openai client (maybe user has configured)
                try:
                    chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
                        model=GPT_MODEL_NAME,
                        messages=messages,  # type: ignore[arg-type]
                        max_tokens=500,
                        temperature=0.0
                    )
                    raw = chat_completion.choices[0].message.content  # type: ignore
                    logger.warning(f"[retrieval_planner] Primary client mode {client_mode} failed; legacy module call succeeded.")
                except Exception as secondary_err:
                    logger.error(
                        "[retrieval_planner] LLM planning failed after both primary and fallback attempts: "
                        f"primary={primary_err.__class__.__name__}:{primary_err} | "
                        f"fallback={secondary_err.__class__.__name__}:{secondary_err} | "
                        f"client_mode={client_mode} openai_version={OPENAI_VERSION}"
                    )
        else:
            # Legacy direct module call
            chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
                model=GPT_MODEL_NAME,
                messages=messages,  # type: ignore[arg-type]
                max_tokens=500,
                temperature=0.0
            )
            raw = chat_completion.choices[0].message.content  # type: ignore
    except Exception as e:  # Final catch-all (raw stays default)
        logger.error(
            f"[retrieval_planner] LLM planning failed (final) mode={client_mode} err={e.__class__.__name__}:{e} openai_version={OPENAI_VERSION}"
        )
    try:
        parsed = json.loads(raw or '{}')
    except Exception:
        # Fallback: raw is often a natural language enumeration of tools (e.g. '1. wiki_rag_tool')
        # Attempt to extract tool names from lines and build minimal function_calls.
        tool_calls = []
        if isinstance(raw, str) and raw.strip():
            # Strip markdown fences if present
            cleaned = raw.strip()
            if cleaned.startswith('```'):
                # remove first fence line and any closing fence
                cleaned = '\n'.join([ln for ln in cleaned.splitlines() if not ln.strip().startswith('```')])
            for line in cleaned.splitlines():
                line = line.strip()
                if not line:
                    continue
                # Look for numbered list '1. tool_name' or bullet '- tool_name' or '* tool_name'
                m = re.match(r'^(?:\d+\.|[-*])\s*([a-zA-Z0-9_]+)', line)
                if m:
                    tname = m.group(1)
                    if tname in subset_names and tname in FUNCTION_REGISTRY:
                        tool_calls.append({"function_name": tname, "arguments": {}})
                else:
                    # Also allow bare tool_name on its own line
                    if line in subset_names and line in FUNCTION_REGISTRY:
                        tool_calls.append({"function_name": line, "arguments": {}})
        parsed = {"function_calls": tool_calls}
    calls = parsed.get('function_calls') or []
    valid = []
    for c in calls:
        name = c.get('function_name') if isinstance(c, dict) else None
        if name in subset_names and name in FUNCTION_REGISTRY:
            valid.append(c)
    command.function_sequence = valid
    return command

__all__ = ['determine_function_sequence', 'Command']
