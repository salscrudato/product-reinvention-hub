from flask import Blueprint, request, jsonify, Response
from flask_cors import cross_origin
from .agentic_orchestrator import AgenticOrchestrator
from .agentic_orchestrator_auto import AgenticOrchestratorAuto
import traceback
import sys
import logging
import uuid, re, os, time

def _normalize_username_with_token(possible_username: str | None, bearer_token: str | None) -> str | None:
    """Return preferred_username/sub from token if the provided username looks like a display name.

    Heuristic: if username contains a space (e.g. 'First Last') treat it as display name.
    Safe: if decode fails or token absent, return original.
    """
    if not possible_username:
        return possible_username
    if ' ' in possible_username and not bearer_token:
        first = possible_username.split(' ',1)[0]
        if first.lower().startswith('dev') or first.lower().startswith('po') or first.lower().startswith('eng'):
            logging.getLogger("agentic_orchestrator_auto_api").info(
                "[API] Heuristic trimmed display name '%s' -> '%s' (no token)", possible_username, first
            )
            return first
        logging.getLogger("agentic_orchestrator_auto_api").info(
            "[API] Username '%s' looks like a display name but no Bearer token provided; left unchanged.",
            possible_username
        )
    if not bearer_token or ' ' not in possible_username:
        return possible_username
    try:
        from .keycloak_persona import decode_keycloak_token as _dk
        payload = _dk(bearer_token)
        if not payload:
            return possible_username
        pref = payload.get('preferred_username') or payload.get('sub')
        return pref or possible_username
    except Exception:
        return possible_username

import openai
from os import getenv
from typing import Optional
import json
from .keycloak_persona import resolve_persona_from_token
from .intent_config import intent_diagnostics, load_intent_config
from .persona_resolution import determine_persona
from .conversation_session import get_session, set_session_persona
from .persona_registry import PERSONA_DEFS
from .contextual_question_suggester import get_contextual_suggester
try:
    from events.emitter import emit_event  # type: ignore
except Exception:  # pragma: no cover
    def emit_event(*a, **k):  # fallback
        return None

def _format_backlog_fast(tool_outputs: dict, intent: str) -> Optional[str]:
    try:
        if intent != 'backlog_grooming':
            return None
        backlog = tool_outputs.get('fetch_backlog_overview')
        if not isinstance(backlog, dict):
            return None
        by_pri = backlog.get('by_priority') or {}
        aging = backlog.get('aging') or {}
        total = backlog.get('total_sampled', 0)
        if total == 0 and not by_pri:
            return "No open incidents found in the selected window (last {} days).".format(backlog.get('days_window', '?'))
        pri_lines = [f"P{p}:{c}" for p, c in sorted(by_pri.items(), key=lambda x: x[0])]
        aging_lines = [f"{k}:{v}" for k, v in aging.items() if v]
        return (
            f"Incident Backlog (last {backlog.get('days_window')} days)\n"+
            f"Total Sampled: {total}\n"+
            ("Priority Distribution: " + (', '.join(pri_lines) if pri_lines else 'none') + "\n") +
            ("Aging Distribution: " + (', '.join(aging_lines) if aging_lines else 'none') + "\n") +
            "Next Action: Consider focusing on highest priority items and oldest aging bucket first."
        )
    except Exception:
        return None

agentic_blueprint = Blueprint("agentic_orchestrator", __name__)

# Configure logging to file and console
log_formatter = logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s')
file_handler = logging.FileHandler('snowchat_backend.log', mode='a', encoding='utf-8')
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
console_handler.setLevel(logging.WARNING)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.hasHandlers():
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

# Add a dedicated logger for agentic_orchestrator_auto
agentic_auto_log_formatter = logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s')
agentic_auto_file_handler = logging.FileHandler('agentic_orchestrator_auto.log', mode='a', encoding='utf-8')
agentic_auto_file_handler.setFormatter(agentic_auto_log_formatter)
agentic_auto_file_handler.setLevel(logging.DEBUG)
agentic_auto_logger = logging.getLogger("agentic_orchestrator_auto_api")
agentic_auto_logger.setLevel(logging.DEBUG)
base_auto_logger = logging.getLogger("agentic_orchestrator_auto")
base_auto_logger.setLevel(logging.DEBUG)
if not agentic_auto_logger.hasHandlers():
    agentic_auto_logger.addHandler(agentic_auto_file_handler)
if not base_auto_logger.hasHandlers():
    base_auto_logger.addHandler(agentic_auto_file_handler)

@agentic_blueprint.route('/intents', methods=['GET'])
@cross_origin()
def intents_diagnostics():
    """Diagnostics endpoint returning summary of configured heuristic intents and optional force reload."""
    force = request.args.get('reload') in ('1','true','yes','on')
    if force:
        load_intent_config(force=True)
    diag = intent_diagnostics()
    return jsonify(diag)

@agentic_blueprint.route("/session/init", methods=["POST"])
@cross_origin()
def session_init():
    data = request.json or {}
    user_id = data.get('user_id') or data.get('username') or ''
    question = data.get('question') or ''
    metadata = data.get('metadata') or {}
    auth_header = request.headers.get('Authorization', '')
    token = auth_header.split(' ',1)[1].strip() if auth_header.lower().startswith('bearer ') else None
    # Normalize potential display name to login username via token
    user_id = _normalize_username_with_token(user_id, token)
    session_row = get_session(user_id) if user_id else None
    stored_persona = session_row.get('persona') if session_row else None
    persona, source = determine_persona(metadata, token, question, stored_session_persona=stored_persona, allow_heuristic_override=True)
    # Persist new persona each login (recompute per call)
    if user_id:
        set_session_persona(user_id, persona, source)
    pdef = PERSONA_DEFS.get(persona, {})
    payload = {
        "user_id": user_id,
        "persona": persona,
        "source": source,
        "greeting": pdef.get('greeting'),
        "preamble": pdef.get('preamble'),
        "style": pdef.get('style'),
        "output_format": pdef.get('output_format')
    }
    
    # ═══════════════════════════════════════════════════════════════════════
    # LOAD USER SESSION CONTEXT: Restore persistent context from previous sessions
    # ═══════════════════════════════════════════════════════════════════════
    # When user logs in, load their saved context (recent incidents, topics, etc.)
    # and return it for UI display + inject into first orchestrator call
    # Feature flag: ENABLE_USER_CONTEXT_PERSISTENCE (default: enabled)
    # ═══════════════════════════════════════════════════════════════════════
    try:
        from components.user_context_manager import (
            load_user_context, 
            format_context_for_llm, 
            get_recent_chat_messages,
            ENABLED as USER_CONTEXT_ENABLED
        )
        if USER_CONTEXT_ENABLED and user_id:
            user_context = load_user_context(user_id)
            if user_context:
                # Add formatted context to payload for frontend display
                payload['session_context'] = {
                    "summary": format_context_for_llm(user_context),
                    "incident_count": len(user_context.get("last_discussed_incidents", [])),
                    "topic_count": len(user_context.get("active_topics", [])),
                    "turn_count": user_context.get("turn_count", 0),
                    "last_activity": user_context.get("last_activity", ""),
                    "has_context": True
                }
                agentic_auto_logger.info(f"[SessionInit] Loaded context for {user_id} | "
                                        f"incidents={payload['session_context']['incident_count']} "
                                        f"topics={payload['session_context']['topic_count']}")
            else:
                payload['session_context'] = {"has_context": False, "summary": "No prior session context"}
    except Exception as ctx_e:
        agentic_auto_logger.warning(f"[SessionInit] Failed to load user context: {ctx_e}")
        payload['session_context'] = {"has_context": False, "summary": "Context unavailable"}
    
    # ═══════════════════════════════════════════════════════════════════════
    # LOAD RECENT CHAT MESSAGES: Return previous Q&A history for chat display
    # ═══════════════════════════════════════════════════════════════════════
    # Retrieve last 20 chat messages (Q&A pairs) from TinyDB chat_history table
    # Frontend can display these in chat interface for conversation continuity
    # ═══════════════════════════════════════════════════════════════════════
    try:
        from components.user_context_manager import get_recent_chat_messages
        if user_id:
            # Get last 20 messages (configurable via query param if needed)
            limit = int(data.get('chat_history_limit', 20))
            recent_messages = get_recent_chat_messages(user_id, limit=limit)
            
            # Parse messages for frontend consumption
            parsed_messages = []
            for msg in recent_messages:
                # Handle server messages that might have object text
                if msg.get('sender') == 'server' and isinstance(msg.get('text'), dict):
                    text_obj = msg['text']
                    text = text_obj.get('final_answer') or text_obj.get('response') or str(text_obj)
                    parsed_messages.append({
                        "sender": msg.get('sender'),
                        "text": text,
                        "timestamp": msg.get('timestamp'),
                        "function_sequence": text_obj.get('function_sequence'),
                        "feedback_payload": text_obj.get('feedback_payload')
                    })
                else:
                    parsed_messages.append({
                        "sender": msg.get('sender'),
                        "text": msg.get('text', ''),
                        "timestamp": msg.get('timestamp')
                    })
            
            payload['chat_history'] = parsed_messages
            agentic_auto_logger.info(f"[SessionInit] Loaded {len(parsed_messages)} chat messages for {user_id}")
    except Exception as chat_e:
        agentic_auto_logger.warning(f"[SessionInit] Failed to load chat history: {chat_e}")
        payload['chat_history'] = []
    
    emit_event('session.persona.assigned', user_id=user_id, persona=persona, source=source)
    return jsonify(payload)

@agentic_blueprint.route("/agentic_orchestrate", methods=["POST"])
@cross_origin()  # Enable CORS for this endpoint
def agentic_orchestrate():
    data = request.json
    logger.info(f"Received /agentic_orchestrate request: {data}")
    messages = data.get("messages", [])
    prompt = data.get("prompt", "")
    metadata = data.get("metadata", {})
    username = data.get("username", None)
    auth_header = request.headers.get('Authorization', '')
    token = auth_header.split(' ', 1)[1].strip() if auth_header.lower().startswith('bearer ') else None
    # Provide username to environment so tools can infer when planner drops args
    if username:
        import os as _os
        _os.environ['CURRENT_USERNAME'] = str(username)
    # Normalize username if it appears to be a display name and token provides preferred login
    username = _normalize_username_with_token(username, token)
    session_row = get_session(username) if username else None
    stored_persona = session_row.get('persona') if session_row else None
    # Propagate username for downstream user_incidents recipe arg resolution
    if username and 'username' not in metadata:
        metadata['username'] = username
    persona, source = determine_persona(metadata, token, prompt or '', stored_session_persona=stored_persona, allow_heuristic_override=True)
    metadata['persona'] = persona
    set_session_persona(username or 'anonymous', persona, source)
    emit_event('session.persona.assigned', user_id=username, persona=persona, source=source)
    logger.info(f"[API] Persona applied: {persona} (source={source})")
    logger.info(f"Parsed parameters - messages: {messages}, prompt: {prompt}, metadata: {metadata}, username: {username}")
    orchestrator = AgenticOrchestrator()
    try:
        result = orchestrator.solve(messages, prompt, metadata, username)
        logger.info(f"Orchestrator result: {result}")
        logger.info(f"[AgenticOrchestratorAPI] FULL RESULT: {result}")
        # Synthesize final answer here using last tool output
        tool_outputs = result.get("tool_outputs", {})
        question = result.get("question", "")
        last_tool = None
        last_output = None
        if tool_outputs:
            if hasattr(tool_outputs, 'keys'):
                last_tool = list(tool_outputs.keys())[-1]
                last_output = tool_outputs[last_tool]
        final_answer = None
        if last_tool is not None and last_output is not None:
            try:
                model = getenv("GPT_MODEL_NAME", "gpt-3.5-turbo")
                synth_prompt = (
                    "You are an expert ServiceNow assistant.\n"
                    f"The user question is: {question}\n"
                    f"Here is the output from the tool '{last_tool}':\n{json.dumps(last_output, default=str)}\n"
                    "Based on the above, generate a clear, concise, and helpful answer for the user."
                )
                response = openai.chat.completions.create(
                    model=model,
                    messages=[{"role": "system", "content": "You are a helpful AI assistant."},
                              {"role": "user", "content": synth_prompt}],
                    max_tokens=500
                )
                final_answer = response.choices[0].message.content.strip()
                logger.info(f"[AgenticOrchestratorAPI] Final synthesized answer: {final_answer}")
            except Exception as e:
                logger.error(f"[AgenticOrchestratorAPI] Exception during answer synthesis: {e}\n{traceback.format_exc()}")
                final_answer = "[Error synthesizing answer]"
        # Always include function_sequence and feedback_payload for frontend feedback
        if "plan" not in result or not isinstance(result["plan"], list):
            result["plan"] = []
        if "tool_outputs" not in result or not isinstance(result["tool_outputs"], dict):
            result["tool_outputs"] = {}
        result["function_sequence"] = result.get("plan", [])
        result["feedback_payload"] = result.get("tool_outputs", {})
        result["final_answer"] = final_answer if final_answer is not None else "[No answer generated]"
        
        # Generate contextual follow-up suggestions
        try:
            suggester = get_contextual_suggester()
            # Add current Q&A to history
            suggester.add_to_history(
                username=username or 'anonymous',
                question=question,
                answer=final_answer if final_answer else "[No answer]",
                intent=metadata.get('intent'),
                tool_outputs=tool_outputs
            )
            # Get suggestions for next questions
            suggestions = suggester.get_contextual_suggestions(
                username=username or 'anonymous',
                limit=5,
                use_llm=True  # Use LLM for intelligent suggestions
            )
            result["suggested_questions"] = suggestions
            logger.info(f"[API] Generated {len(suggestions)} contextual suggestions for {username}")
        except Exception as e:
            logger.error(f"[API] Failed to generate suggestions: {e}", exc_info=True)
            result["suggested_questions"] = []
        
        # Token finalize (standard endpoint)
        try:
            from .token_instrumentation import GLOBAL_TOKEN_INSTRUMENTATION
            token_entry_id = result.get('metadata', {}).get('token_entry_id') if isinstance(result.get('metadata'), dict) else None
            if token_entry_id and final_answer:
                GLOBAL_TOKEN_INSTRUMENTATION.finalize(token_entry_id, final_answer, result.get('metadata', {}))
        except Exception:
            pass
        if not result["function_sequence"]:
            result["function_sequence"] = [{"error": "No function sequence generated or tool planning failed."}]
        if not result["feedback_payload"]:
            result["feedback_payload"] = {"error": "No tool outputs available or tool execution failed."}
        print(f"[AgenticOrchestratorAPI] final_answer: {final_answer}", file=sys.stderr)
        logger.info(f"[AgenticOrchestratorAPI] RESPONSE JSON: {json.dumps(result, default=str)}")
        return jsonify(result)
    except Exception as e:
        logger.error(f"Exception: {e}\n{traceback.format_exc()}", exc_info=True)
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500

@agentic_blueprint.route("/agentic_orchestrate_auto", methods=["POST"])
@cross_origin()  # Enable CORS for this endpoint
def agentic_orchestrate_auto():
    correlation_id = uuid.uuid4().hex[:12]
    started = time.time()
    data = request.json
    agentic_auto_logger.info(f"[API][cid={correlation_id}] ═══════════ INCOMING REQUEST ═══════════")
    agentic_auto_logger.info(f"[API][cid={correlation_id}] Received /agentic_orchestrate_auto request from {request.remote_addr}")
    agentic_auto_logger.info(f"[API][cid={correlation_id}] Request data keys: {list(data.keys()) if data else 'None'}")
    messages = data.get("messages", [])
    prompt = data.get("prompt", "")
    metadata = data.get("metadata", {})
    username = data.get("username", None)
    agentic_auto_logger.info(f"[API][cid={correlation_id}] Extracted - username={username}, messages_count={len(messages)}, metadata_keys={list(metadata.keys())}")
    # Attempt persona resolution from Bearer token if not already specified
    auth_header = request.headers.get('Authorization', '')
    token = auth_header.split(' ', 1)[1].strip() if auth_header.lower().startswith('bearer ') else None
    # Normalize username (login) from token when provided value looks like full display name
    username = _normalize_username_with_token(username, token)
    session_row = get_session(username) if username else None
    stored_persona = session_row.get('persona') if session_row else None
    # Provide username to environment so tools can infer when planner omits explicit arg
    if username:
        import os as _os
        _os.environ['CURRENT_USERNAME'] = str(username)
    # Propagate username to metadata if absent for recipes needing it (e.g. user_incidents)
    if username and 'username' not in metadata:
        metadata['username'] = username
    persona, source = determine_persona(metadata, token, prompt or '', stored_session_persona=stored_persona, allow_heuristic_override=True)
    metadata['persona'] = persona
    set_session_persona(username or 'anonymous', persona, source)
    emit_event('session.persona.assigned', user_id=username, persona=persona, source=source)
    agentic_auto_logger.info(f"[API] Persona applied: {persona} (source={source})")
    agentic_auto_logger.info(f"[API] Parsed parameters - messages: {messages}, prompt: {prompt}, metadata: {metadata}, username: {username}")
    orchestrator = AgenticOrchestratorAuto()

    def _redact(obj):
        """Best-effort redaction of obvious secrets in strings / nested structures."""
        secret_patterns = [
            re.compile(r"(?i)(api[_-]?key)[:=\s]+([A-Za-z0-9\-._]{8,})"),
            re.compile(r"(?i)(password)[:=\s]+([^\s\"']{4,})"),
            re.compile(r"(?i)(token)[:=\s]+([A-Za-z0-9\-._]{8,})"),
        ]
        redact_token = '***REDACTED***'
        def _redact_str(s: str) -> str:
            out = s
            for pat in secret_patterns:
                out = pat.sub(lambda m: f"{m.group(1)}={redact_token}", out)
            # direct azure key patterns (32+ hex)
            out = re.sub(r'([A-Fa-f0-9]{32,})', lambda m: redact_token if len(m.group(1)) >= 32 else m.group(1), out)
            return out
        if isinstance(obj, str):
            return _redact_str(obj)
        if isinstance(obj, dict):
            return {k: _redact(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_redact(v) for v in obj]
        return obj

    detailed_errors = os.getenv('DETAILED_ERRORS', '0').lower() in ('1','true','yes','on')
    azure_mode = bool(os.getenv('AZURE_OPENAI_API_KEY') and os.getenv('AZURE_OPENAI_ENDPOINT'))
    openai_version = getattr(openai, '__version__', 'unknown')

    # ═══════════════════════════════════════════════════════════════════════
    # INJECT USER SESSION CONTEXT: Load persistent context and add to messages
    # ═══════════════════════════════════════════════════════════════════════
    # Load user's saved context (recent incidents, topics, entities, analysis)
    # and inject as system message for better conversation continuity
    # Example: User asks "What's the status?" → System knows they mean INC0012345
    # Feature flag: ENABLE_USER_CONTEXT_PERSISTENCE (default: enabled)
    # ═══════════════════════════════════════════════════════════════════════
    try:
        from components.user_context_manager import load_user_context, format_context_for_llm, ENABLED as USER_CONTEXT_ENABLED
        if USER_CONTEXT_ENABLED and username:
            user_context = load_user_context(username)
            if user_context:
                # Format context for LLM injection
                context_summary = format_context_for_llm(user_context)
                
                # Inject as system message at the beginning
                context_msg = {
                    "role": "system",
                    "content": f"<user_session_context>{context_summary}</user_session_context>"
                }
                
                # Prepend to messages (after any existing system messages)
                if messages and isinstance(messages, list):
                    # Find insertion point (after system messages)
                    insert_idx = 0
                    for idx, msg in enumerate(messages):
                        if isinstance(msg, dict) and msg.get('role') == 'system':
                            insert_idx = idx + 1
                        else:
                            break
                    messages.insert(insert_idx, context_msg)
                else:
                    messages = [context_msg] + (messages or [])
                
                # Also store in metadata for planner access
                metadata['user_session_context'] = user_context
                
                agentic_auto_logger.info(f"[API][cid={correlation_id}] Injected session context for {username} | "
                                        f"incidents={len(user_context.get('last_discussed_incidents', []))} "
                                        f"topics={len(user_context.get('active_topics', []))}")
    except Exception as ctx_e:
        agentic_auto_logger.warning(f"[API][cid={correlation_id}] Failed to inject user context: {ctx_e}")

    try:
        result = orchestrator.solve(messages, prompt, metadata, username)
        agentic_auto_logger.info(f"[API][cid={correlation_id}] OrchestratorAuto result head: {{'keys': {list(result.keys()) if isinstance(result, dict) else type(result).__name__}}}")
        # Synthesize final answer here using last tool output
        tool_outputs = result.get("tool_outputs", {})
        question = result.get("question", "")
        last_tool = None
        last_output = None
        if tool_outputs:
            if hasattr(tool_outputs, 'keys'):
                last_tool = list(tool_outputs.keys())[-1]
                last_output = tool_outputs[last_tool]
        final_answer = None
        if last_tool is not None and last_output is not None:
            try:
                model = getenv("GPT_MODEL_NAME", "gpt-3.5-turbo")
                # If multiple tools were run, build an aggregate context instead of only the last tool
                tool_outputs = result.get('tool_outputs', {}) or {}
                # Fast path for backlog grooming: directly format without LLM if possible
                fast_backlog = _format_backlog_fast(tool_outputs, result.get('metadata', {}).get('intent'))
                if fast_backlog:
                    final_answer = fast_backlog
                    agentic_auto_logger.info("[API] Used fast backlog formatter (no LLM call).")
                elif len(tool_outputs) > 1:
                    # Prioritize summarizing specific known structures (e.g., backlog overview)
                    backlog = tool_outputs.get('fetch_backlog_overview')
                    assignment = tool_outputs.get('fetch_assignment_group_load')
                    intent = result.get('metadata', {}).get('intent')
                    
                    # Build a structured summary string
                    aggregate_parts = []
                    if backlog and isinstance(backlog, dict):
                        aggregate_parts.append("BACKLOG_OVERVIEW=" + json.dumps(backlog, default=str))
                    
                    # Include other non-empty outputs, handling dict and list payloads explicitly
                    for k, v in tool_outputs.items():
                        if k == 'fetch_backlog_overview':
                            continue
                        if isinstance(v, dict):
                            # Omit raw incident detail dicts when we have backlog intent to keep prompt small
                            if intent == 'backlog_grooming' and 'short_description' in v and k.startswith('fetch_servicenow_incident'):
                                continue
                            aggregate_parts.append(f"{k}=" + json.dumps(v, default=str))
                        elif isinstance(v, list) and v:
                            # For pattern analysis with multiple calls to same tool (e.g., summarize_incident_work_notes x6)
                            # Include ALL results, not just first 5
                            if intent == 'pattern_analysis':
                                aggregate_parts.append(f"{k} (all {len(v)} results)=" + json.dumps(v, default=str))
                            else:
                                # Capture representative slice so LLM can see list-based evidence (e.g., similar incidents)
                                preview = v[:5]
                                aggregate_parts.append(f"{k}=" + json.dumps(preview, default=str))
                        elif v:
                            aggregate_parts.append(f"{k}=" + json.dumps(v, default=str))
                    
                    aggregate_context = "\n".join(aggregate_parts) if aggregate_parts else json.dumps(tool_outputs, default=str)
                    
                    # Enhanced prompt for pattern analysis
                    if intent == 'pattern_analysis':
                        synth_prompt = (
                            "You are an expert ServiceNow assistant analyzing incident patterns.\n"
                            f"The user question is: {question}\n"
                            f"Here are the collected tool outputs for ALL incidents analyzed:\n{aggregate_context}\n"
                            "Analyze ALL incidents and identify:\n"
                            "1. Common root causes or patterns (group incidents with similar causes)\n"
                            "2. Unique issues that don't fit patterns\n"
                            "3. Recommendations to prevent recurrence\n"
                            "Be comprehensive - cover ALL incidents, not just the last one."
                        )
                    else:
                        synth_prompt = (
                            "You are an expert ServiceNow assistant.\n"
                            f"The user question is: {question}\n"
                            f"Here are the collected tool outputs (summarize them focusing on the user's question):\n{aggregate_context}\n"
                            "If backlog overview is present, produce concise sections: Priority Distribution, Aging Distribution, Sample Size, Next Action."
                        )
                    agentic_auto_logger.debug(f"[API] Synthesizing aggregate answer: {synth_prompt[:500]}...")
                    response = openai.chat.completions.create(
                        model=model,
                        messages=[{"role": "system", "content": "You are a helpful AI assistant."},
                                  {"role": "user", "content": synth_prompt}],
                        max_tokens=800 if intent == 'pattern_analysis' else 600
                    )
                    final_answer = response.choices[0].message.content.strip()
                    agentic_auto_logger.info(f"[API] Final synthesized aggregate answer: {final_answer}")
                # If output is chunked, synthesize in parts
                elif isinstance(last_output, list):
                    agentic_auto_logger.info(f"[API] Tool output is chunked into {len(last_output)} parts. Synthesizing answer in chunks.")
                    chunk_answers = []
                    for idx, chunk in enumerate(last_output):
                        synth_prompt = (
                            "You are an expert ServiceNow assistant.\n"
                            f"The user question is: {question}\n"
                            f"Here is the output from the tool '{last_tool}' (chunk {idx+1}/{len(last_output)}):\n{chunk}\n"
                            "Based on the above, generate a clear, concise, and helpful answer for the user."
                        )
                        agentic_auto_logger.debug(f"[API] Synthesizing chunk {idx+1}: {synth_prompt[:500]}...")
                        response = openai.chat.completions.create(
                            model=model,
                            messages=[{"role": "system", "content": "You are a helpful AI assistant."},
                                      {"role": "user", "content": synth_prompt}],
                            max_tokens=500
                        )
                        chunk_answer = response.choices[0].message.content.strip()
                        agentic_auto_logger.info(f"[API] Synthesized answer for chunk {idx+1}: {chunk_answer}")
                        chunk_answers.append(chunk_answer)
                    # Optionally, summarize all chunk answers into a final answer
                    summary_prompt = (
                        "You are an expert ServiceNow assistant.\n"
                        f"The user question is: {question}\n"
                        f"Here are the synthesized answers from all chunks:\n{chr(10).join(chunk_answers)}\n"
                        "Based on the above, generate a single, clear, concise, and helpful answer for the user."
                    )
                    agentic_auto_logger.debug(f"[API] Synthesizing summary answer: {summary_prompt[:500]}...")
                    response = openai.chat.completions.create(
                        model=model,
                        messages=[{"role": "system", "content": "You are a helpful AI assistant."},
                                  {"role": "user", "content": summary_prompt}],
                        max_tokens=500
                    )
                    final_answer = response.choices[0].message.content.strip()
                    agentic_auto_logger.info(f"[API] Final synthesized summary answer: {final_answer}")
                else:
                    # Field-focused guard: if orchestrator metadata has target_field, extract that field directly
                    target_field = result.get('metadata', {}).get('target_field')
                    if target_field and isinstance(last_output, dict):
                        val = last_output.get(target_field)
                        if isinstance(val, dict) and 'value' in val:
                            val = val.get('value')
                        field_label = target_field.replace('_',' ').title()
                        final_answer = f"{field_label}: {val if val is not None else 'Not found'}"
                        agentic_auto_logger.info(f"[API] Final synthesized field answer (target_field={target_field}): {final_answer}")
                    else:
                        synth_prompt = (
                            "You are an expert ServiceNow assistant.\n"
                            f"The user question is: {question}\n"
                            f"Here is the output from the tool '{last_tool}':\n{json.dumps(last_output, default=str)}\n"
                            "Based on the above, generate a clear, concise, and helpful answer for the user."
                        )
                    agentic_auto_logger.debug(f"[API] Synthesizing single answer: {synth_prompt[:500]}...")
                    if not result.get('metadata', {}).get('target_field'):
                        response = openai.chat.completions.create(
                            model=model,
                            messages=[{"role": "system", "content": "You are a helpful AI assistant."},
                                      {"role": "user", "content": synth_prompt}],
                            max_tokens=500
                        )
                        final_answer = response.choices[0].message.content.strip()
                        agentic_auto_logger.info(f"[API] Final synthesized answer: {final_answer}")
            except Exception as e:
                agentic_auto_logger.error(f"[API][cid={correlation_id}] Exception during answer synthesis: {e}\n{traceback.format_exc()}")
                synthesis_error_trace = traceback.format_exc()
                final_answer = "[Error synthesizing answer]"
        result["function_sequence"] = result.get("plan", [])
        result["feedback_payload"] = result.get("tool_outputs", {})
        result["final_answer"] = final_answer
        
        # Generate contextual follow-up suggestions for auto endpoint
        try:
            suggester = get_contextual_suggester()
            final_answer_text = final_answer or result.get('answer', '') or ''
            # Add current Q&A to history
            suggester.add_to_history(
                username=username or 'anonymous',
                question=question,
                answer=final_answer_text,
                intent=result.get('metadata', {}).get('intent') if isinstance(result.get('metadata'), dict) else None,
                tool_outputs=result.get('tool_outputs', {})
            )
            # Get suggestions for next questions
            suggestions = suggester.get_contextual_suggestions(
                username=username or 'anonymous',
                limit=5,
                use_llm=True  # Use LLM for intelligent suggestions
            )
            result["suggested_questions"] = suggestions
            agentic_auto_logger.info(f"[API][cid={correlation_id}] Generated {len(suggestions)} contextual suggestions")
        except Exception as e:
            agentic_auto_logger.error(f"[API][cid={correlation_id}] Failed to generate suggestions: {e}", exc_info=True)
            result["suggested_questions"] = []
        
        # Generic formatter (non-hardcoded) applied last if flag enabled
        try:
            if os.getenv('ENABLE_GENERIC_FORMATTER','').lower() in ('1','true','yes','on'):
                from .answer_formatter import format_answer
                result['final_answer_formatted'] = format_answer(question, final_answer or '', result.get('metadata'), result.get('tool_outputs'))
        except Exception:
            pass
        # Token finalize (auto endpoint)
        try:
            from .token_instrumentation import GLOBAL_TOKEN_INSTRUMENTATION
            token_entry_id = result.get('metadata', {}).get('token_entry_id') if isinstance(result.get('metadata'), dict) else None
            if token_entry_id and final_answer:
                GLOBAL_TOKEN_INSTRUMENTATION.finalize(token_entry_id, final_answer, result.get('metadata', {}))
        except Exception:
            pass
        # Surface incident context card, micro-intent classification, and cache indicator if present in metadata
        if isinstance(result.get('metadata'), dict):
            md = result['metadata']
            card = md.get('incident_context_card')
            if card:
                result['incident_context_card'] = card
                # If we have a card and no final_answer (e.g. early fast-path) build a terse field-focused answer
                if not final_answer:
                    # Prefer key fields when present
                    key_fields = [f for f in ['number','short_description','priority','state','assigned_to'] if f in card]
                    summary_parts = []
                    for k in key_fields:
                        v = card.get(k)
                        if isinstance(v, dict) and 'value' in v:
                            v = v.get('value')
                        summary_parts.append(f"{k}:{v}")
                    if summary_parts:
                        result['final_answer'] = ' | '.join(summary_parts)
            if md.get('cache_hit'):
                result['cache_hit'] = True
            if md.get('micro_intent'):
                result['micro_intent'] = md.get('micro_intent')
        print(f"[AgenticOrchestratorAutoAPI] final_answer: {final_answer}", file=sys.stderr)
        
        # ═══════════════════════════════════════════════════════════════════════
        # SAVE CHAT MESSAGE TO TINYDB: Persist Q&A pair for history restoration
        # ═══════════════════════════════════════════════════════════════════════
        # Save both user question and server response to chat_history table
        # so they appear when user logs back in
        # ═══════════════════════════════════════════════════════════════════════
        try:
            from components.generic_tool_orchestrator import store_chat_message
            if username:
                # Save user message
                agentic_auto_logger.info(f"[API][cid={correlation_id}] Saving user message to TinyDB: username={username}, question={question[:100]}...")
                store_chat_message(
                    sender="user",
                    text={"text": question, "username": username},
                    username=username
                )
                
                # Save server response
                agentic_auto_logger.info(f"[API][cid={correlation_id}] Saving server response to TinyDB: username={username}, answer_length={len(final_answer or '')}")
                store_chat_message(
                    sender="server",
                    text={
                        "final_answer": final_answer,
                        "response": final_answer,
                        "function_sequence": result.get("function_sequence"),
                        "feedback_payload": result.get("feedback_payload")
                    },
                    username=username,
                    answer=final_answer,
                    function_sequence=result.get("function_sequence"),
                    tool_outputs=tool_outputs,
                    feedback_payload=result.get("feedback_payload")
                )
                agentic_auto_logger.info(f"[API][cid={correlation_id}] ✅ Chat messages saved successfully to TinyDB")
        except Exception as chat_e:
            agentic_auto_logger.error(f"[API][cid={correlation_id}] ❌ Failed to save chat messages: {chat_e}", exc_info=True)
        
        # ═══════════════════════════════════════════════════════════════════════
        # SAVE USER SESSION CONTEXT: Persist meaningful context for session resumption
        # ═══════════════════════════════════════════════════════════════════════
        # After each Q&A turn, extract and save context (incidents, topics, entities)
        # so when user logs back in, we can restore their session state
        # Feature flag: ENABLE_USER_CONTEXT_PERSISTENCE (default: enabled)
        # ═══════════════════════════════════════════════════════════════════════
        try:
            from components.user_context_manager import save_turn_context, ENABLED as USER_CONTEXT_ENABLED
            if USER_CONTEXT_ENABLED and username:
                save_turn_context(
                    username=username,
                    question=question,
                    tool_outputs=tool_outputs,
                    metadata=metadata,
                    final_answer=final_answer
                )
                agentic_auto_logger.info(f"[API][cid={correlation_id}] Saved user context for {username}")
        except Exception as ctx_e:
            agentic_auto_logger.warning(f"[API][cid={correlation_id}] Failed to save user context: {ctx_e}")
        
        # Build diagnostics block
        diag = {
            "correlation_id": correlation_id,
            "duration_ms": round((time.time() - started) * 1000, 2),
            "planner_errors": orchestrator.errors if hasattr(orchestrator, 'errors') else [],
            "plan_empty": not bool(result.get('plan')),
            "azure_mode": azure_mode,
            "openai_version": openai_version,
            "tool_count": len(result.get('plan') or []),
        }
        # Detect common root causes heuristically
        root_causes = []
        joined_errs = ' '.join(diag.get('planner_errors') or [])
        if 'Connection error' in joined_errs:
            root_causes.append('llm_connection')
        if 'rate limit' in joined_errs.lower():
            root_causes.append('rate_limit')
        if 'invalid api key' in joined_errs.lower():
            root_causes.append('auth')
        if diag['plan_empty']:
            root_causes.append('empty_plan')
        diag['root_cause_tags'] = list(dict.fromkeys(root_causes))
        if detailed_errors:
            # Attach redacted plan + tool outputs preview
            try:
                diag['plan_preview'] = _redact(result.get('plan'))
            except Exception:
                pass
            try:
                # Only include keys and type info to avoid huge payloads
                if isinstance(tool_outputs, dict):
                    diag['tool_outputs_preview'] = {k: (type(v).__name__) for k, v in list(tool_outputs.items())[:5]}
            except Exception:
                pass
            if 'synthesis_error_trace' in locals():
                diag['synthesis_traceback'] = _redact(synthesis_error_trace)
        result['diagnostics'] = diag
        agentic_auto_logger.info(f"[API][cid={correlation_id}] ═══════════ SENDING RESPONSE ═══════════")
        agentic_auto_logger.info(f"[API][cid={correlation_id}] Response keys: {list(result.keys())}")
        agentic_auto_logger.info(f"[API][cid={correlation_id}] Final answer length: {len(final_answer or '')} chars")
        agentic_auto_logger.info(f"[API][cid={correlation_id}] RESPONSE JSON: {json.dumps({k: v for k, v in result.items() if k != 'tool_outputs'}, default=str)}")
        return jsonify(result)
    except Exception as e:
        tb = traceback.format_exc()
        agentic_auto_logger.error(f"[API][cid={correlation_id}] Exception: {e}\n{tb}", exc_info=True)
        err_payload = {
            "error": str(e),
            "correlation_id": correlation_id,
            "openai_version": openai_version,
            "azure_mode": azure_mode,
            "traceback": tb if detailed_errors else None
        }
        return jsonify(err_payload), 500

# ---------------- Token Metrics API & SSE Stream -----------------
try:
    from tinydb import TinyDB, Query  # type: ignore
except Exception:  # pragma: no cover
    TinyDB = None
    Query = None

# ═══════════════════════════════════════════════════════════════════════════════
# UNIVERSAL ORCHESTRATOR V2 ENDPOINT (Configuration-Driven Multi-Stage Workflows)
# ═══════════════════════════════════════════════════════════════════════════════
@agentic_blueprint.route("/agentic_orchestrate_v2", methods=["POST"])
@cross_origin()
def agentic_orchestrate_v2():
    """Universal orchestrator endpoint using configuration-driven multi-stage workflows.
    
    Feature Flag: ENABLE_UNIVERSAL_ORCHESTRATOR (default: 0)
    Fallback: Falls back to /agentic_orchestrate_auto if disabled or on error
    
    New Capabilities:
    - Domain-agnostic orchestration (ServiceNow, JIRA, Insurance, etc.)
    - Multi-stage workflows defined in YAML configs
    - Virtual File System (VFS) for context management
    - Stage-specific specialized prompts
    """
    correlation_id = uuid.uuid4().hex[:12]
    started = time.time()
    data = request.json
    
    agentic_auto_logger.info(f"[API_V2][cid={correlation_id}] ═══════════ INCOMING V2 REQUEST ═══════════")
    agentic_auto_logger.info(f"[API_V2][cid={correlation_id}] Received /agentic_orchestrate_v2 request from {request.remote_addr}")
    
    # Check feature flag
    UNIVERSAL_ENABLED = os.getenv("ENABLE_UNIVERSAL_ORCHESTRATOR", "0").lower() in ("1", "true", "yes", "on")
    
    if not UNIVERSAL_ENABLED:
        agentic_auto_logger.info(f"[API_V2][cid={correlation_id}] Universal orchestrator disabled - falling back to v1")
        # Fallback to existing orchestrator
        return agentic_orchestrate_auto()
    
    try:
        # Import with error handling
        try:
            from components.universal_orchestrator import UniversalOrchestrator
            from components import vfs_tools  # Ensure VFS tools registered
        except ImportError as e:
            agentic_auto_logger.error(f"[API_V2][cid={correlation_id}] Import failed: {e} - falling back to v1")
            return agentic_orchestrate_auto()
        
        # Extract parameters (same as v1)
        messages = data.get("messages", [])
        prompt = data.get("prompt", "")
        metadata = data.get("metadata", {})
        username = data.get("username", None)
        
        agentic_auto_logger.info(
            f"[API_V2][cid={correlation_id}] Parameters - username={username}, messages_count={len(messages)}"
        )
        
        # Persona resolution (same as v1)
        auth_header = request.headers.get('Authorization', '')
        token = auth_header.split(' ', 1)[1].strip() if auth_header.lower().startswith('bearer ') else None
        username = _normalize_username_with_token(username, token)
        
        session_row = get_session(username) if username else None
        stored_persona = session_row.get('persona') if session_row else None
        
        if username:
            os.environ['CURRENT_USERNAME'] = str(username)
            if 'username' not in metadata:
                metadata['username'] = username
        
        persona, source = determine_persona(
            metadata, token, prompt or '',
            stored_session_persona=stored_persona,
            allow_heuristic_override=True
        )
        
        metadata['persona'] = persona
        set_session_persona(username or 'anonymous', persona, source)
        emit_event('session.persona.assigned', user_id=username, persona=persona, source=source)
        
        agentic_auto_logger.info(f"[API_V2][cid={correlation_id}] Persona: {persona} (source={source})")
        
        # User context injection (same as v1)
        try:
            from components.user_context_manager import (
                load_user_context,
                format_context_for_llm,
                ENABLED as USER_CONTEXT_ENABLED
            )
            
            if USER_CONTEXT_ENABLED and username:
                user_context = load_user_context(username)
                if user_context:
                    context_summary = format_context_for_llm(user_context)
                    context_msg = {
                        "role": "system",
                        "content": f"<user_session_context>{context_summary}</user_session_context>"
                    }
                    
                    if messages and isinstance(messages, list):
                        insert_idx = 0
                        for idx, msg in enumerate(messages):
                            if isinstance(msg, dict) and msg.get('role') == 'system':
                                insert_idx = idx + 1
                            else:
                                break
                        messages.insert(insert_idx, context_msg)
                    else:
                        messages = [context_msg] + (messages or [])
                    
                    metadata['user_session_context'] = user_context
                    
                    agentic_auto_logger.info(
                        f"[API_V2][cid={correlation_id}] Session context injected"
                    )
        
        except Exception as ctx_e:
            agentic_auto_logger.warning(
                f"[API_V2][cid={correlation_id}] Failed to inject user context: {ctx_e}"
            )
        
        # ═══════════════════════════════════════════════════════════════════
        # EXECUTE UNIVERSAL ORCHESTRATOR
        # ═══════════════════════════════════════════════════════════════════
        agentic_auto_logger.info(f"[API_V2][cid={correlation_id}] Starting universal orchestration")
        
        orchestrator = UniversalOrchestrator()
        result = orchestrator.solve(messages, prompt, metadata, username)
        
        agentic_auto_logger.info(
            f"[API_V2][cid={correlation_id}] Orchestration complete | "
            f"stages={len(result.get('stage_results', {}))}, "
            f"errors={len(result.get('errors', []))}"
        )
        
        # Build response (similar to v1 but with stage_results)
        elapsed = time.time() - started
        
        response_data = {
            "plan": result.get("plan", []),
            "outputs": result.get("tool_outputs", {}),
            "errors": result.get("errors", []),
            "traces": result.get("traces", []),
            "answer": result.get("answer", ""),
            "metadata": {
                **result.get("metadata", {}),
                "elapsed_seconds": round(elapsed, 2),
                "correlation_id": correlation_id,
                "orchestrator_version": "v2_universal"
            },
            "stage_results": result.get("stage_results", {}),  # NEW: Multi-stage results
            "vfs_stats": result.get("metadata", {}).get("vfs_stats", {})  # NEW: VFS statistics
        }
        
        agentic_auto_logger.info(
            f"[API_V2][cid={correlation_id}] ═══════════ REQUEST COMPLETE ({elapsed:.2f}s) ═══════════"
        )
        
        return jsonify(response_data), 200
    
    except Exception as e:
        agentic_auto_logger.error(
            f"[API_V2][cid={correlation_id}] Unexpected error: {e}",
            exc_info=True
        )
        
        # Fallback to v1 on any error
        agentic_auto_logger.info(f"[API_V2][cid={correlation_id}] Falling back to v1 due to error")
        return agentic_orchestrate_auto()


# Optional WebSocket streaming using flask-sock (lightweight)
_sock = None
try:  # pragma: no cover - runtime optional
    from flask_sock import Sock  # type: ignore
    _sock = Sock(agentic_blueprint)
except Exception:
    _sock = None

@agentic_blueprint.route('/token_metrics', methods=['GET', 'OPTIONS'])
def token_metrics_get():
    """Return recent token usage entries with aggregate stats.
        Params:
            username (optional)
            limit (deprecated; still supported for backward compatibility)
            page (1-based, default 1)
            page_size (default 50, max 500)
        Returns window slice + aggregate over returned slice + paging metadata.
    Feature flag: ENABLE_TOKEN_METRICS must be truthy.
    """
    # Handle CORS preflight request
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    flag_raw = os.getenv('ENABLE_TOKEN_METRICS', '')
    flag_enabled = flag_raw.lower() in ('1','true','yes','on')
    if not flag_enabled:
        return jsonify({'enabled': False, 'entries': [], 'reason': 'feature_flag_disabled', 'flag_value': flag_raw})
    if TinyDB is None:
        return jsonify({'enabled': True, 'error': 'TinyDB unavailable', 'reason': 'tinydb_import_failed'}), 500
    username = request.args.get('username')
    # Backward compatibility: limit parameter
    limit_s = request.args.get('limit')
    page_s = request.args.get('page', '1')
    page_size_s = request.args.get('page_size', '50')
    try:
        page = int(page_s)
        if page < 1:
            page = 1
    except ValueError:
        page = 1
    try:
        page_size = int(page_size_s)
        if page_size < 1:
            page_size = 1
        if page_size > 500:
            page_size = 500
    except ValueError:
        page_size = 50
    # If legacy limit provided, override page_size for page=1 scenario
    if limit_s is not None:
        try:
            legacy_limit = int(limit_s)
            if legacy_limit > 0:
                page_size = legacy_limit
                page = 1
        except ValueError:
            pass
    from components.db_singleton import get_state_db
    db = get_state_db()
    table = db.table('token_usage')
    if Query is not None and username:
        q = Query()
        rows = table.search(q.username == username)
    else:
        rows = table.all()
    all_sorted = sorted(rows, key=lambda r: r.get('timestamp', 0), reverse=True)
    total_rows = len(all_sorted)
    # Compute slice indices
    start_index = (page - 1) * page_size
    end_index = start_index + page_size
    # Bounds check
    if start_index >= total_rows:
        slice_rows = []
    else:
        slice_rows = all_sorted[start_index:end_index]
    total_tokens = sum(r.get('total_tokens', 0) for r in slice_rows)
    baseline = sum(r.get('baseline_estimate', 0) for r in slice_rows)
    savings = sum(r.get('savings_tokens', 0) for r in slice_rows)
    cost = sum(r.get('cost_usd', 0) for r in slice_rows)
    agg = {
        'count': len(slice_rows),
        'total_tokens': total_tokens,
        'baseline_tokens': baseline,
        'savings_tokens': savings,
        'savings_percent': round((savings / baseline)*100,2) if baseline else 0.0,
        'total_cost_usd': round(cost, 6)
    }
    paging = {
        'page': page,
        'page_size': page_size,
        'total_rows': total_rows,
        'total_pages': (total_rows // page_size) + (1 if total_rows % page_size else 0),
        'has_next': end_index < total_rows,
        'has_prev': page > 1,
        'start_index': start_index,
        'end_index_exclusive': min(end_index, total_rows)
    }
    response = jsonify({
        'enabled': True,
        'entries': slice_rows,
        'aggregate': agg,
        'paging': paging,
        'flag_value': flag_raw,
        'row_count': len(slice_rows)
    })
    # Add CORS headers explicitly to ensure they're present
    response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
    response.headers.add('Access-Control-Allow-Credentials', 'true')
    return response

@agentic_blueprint.route('/token_metrics/stream')
def token_metrics_stream():
    """Simple SSE stream of new token usage entries. Polls TinyDB every 2s.
    Not production-hardened (blocking loop). Feature flag controlled.
    """
    if not os.getenv('ENABLE_TOKEN_METRICS', '').lower() in ('1','true','yes','on'):
        return jsonify({'enabled': False}), 400
    if TinyDB is None:
        return jsonify({'enabled': True, 'error': 'TinyDB unavailable'}), 500
    username = request.args.get('username')
    def _gen():
        last_ts = 0
        if TinyDB is None:
            yield "event: error\ndata: {\"error\": \"TinyDB unavailable\"}\n\n"
            return
        from components.db_singleton import get_state_db
        db_local = get_state_db()
        table_local = db_local.table('token_usage')
        q_local = Query() if Query is not None else None
        while True:
            if username and q_local is not None:
                rows = table_local.search(q_local.username == username)
            else:
                rows = table_local.all()
            new_rows = [r for r in rows if r.get('timestamp',0) > last_ts]
            new_rows_sorted = sorted(new_rows, key=lambda r: r.get('timestamp',0))
            for r in new_rows_sorted:
                last_ts = max(last_ts, r.get('timestamp',0))
                yield f"data: {json.dumps(r)}\n\n"
            time.sleep(2)
    return Response(_gen(), mimetype='text/event-stream')

# WebSocket alternative (push new rows) controlled by ENABLE_TOKEN_METRICS_WS flag
if _sock:
    @_sock.route('/token_metrics/ws')  # type: ignore[misc]
    def token_metrics_ws(ws):  # pragma: no cover (manual runtime)
        if not os.getenv('ENABLE_TOKEN_METRICS_WS','').lower() in ('1','true','yes','on'):
            ws.send(json.dumps({'error':'websocket_disabled'}))
            return
        if not os.getenv('ENABLE_TOKEN_METRICS', '').lower() in ('1','true','yes','on'):
            ws.send(json.dumps({'error':'metrics_disabled'}))
            return
        if TinyDB is None:
            ws.send(json.dumps({'error':'tinydb_unavailable'}))
            return
        username = request.args.get('username') if hasattr(request, 'args') else None
        last_ts = 0
        from components.db_singleton import get_state_db
        db_local = get_state_db()
        table_local = db_local.table('token_usage')
        q_local = Query() if Query is not None else None
        # Initial snapshot
        try:
            rows = table_local.search(q_local.username == username) if username and q_local is not None else table_local.all()
            rows_sorted = sorted(rows, key=lambda r: r.get('timestamp',0), reverse=True)[:50]
            ws.send(json.dumps({'snapshot': rows_sorted}))
            for r in rows_sorted:
                last_ts = max(last_ts, r.get('timestamp',0))
        except Exception as e:
            ws.send(json.dumps({'error':'initial_snapshot_failed','detail':str(e)}))
        # Streaming loop
        while True:
            try:
                if ws.closed:
                    break
                rows_all = table_local.search(q_local.username == username) if username and q_local is not None else table_local.all()
                new_rows = [r for r in rows_all if r.get('timestamp',0) > last_ts]
                new_rows_sorted = sorted(new_rows, key=lambda r: r.get('timestamp',0))
                for r in new_rows_sorted:
                    last_ts = max(last_ts, r.get('timestamp',0))
                    ws.send(json.dumps({'row': r}))
                time.sleep(2)
            except Exception as loop_e:
                try:
                    ws.send(json.dumps({'error':'stream_loop_failed','detail':str(loop_e)}))
                except Exception:
                    break
                time.sleep(5)

@agentic_blueprint.route('/suggestions', methods=['GET'])
@cross_origin()
def get_suggestions():
    """Get contextual question suggestions for a user based on their recent conversation history."""
    try:
        username = request.args.get('username', 'anonymous')
        limit = int(request.args.get('limit', 5))
        use_llm = request.args.get('use_llm', 'true').lower() in ('1', 'true', 'yes', 'on')
        
        suggester = get_contextual_suggester()
        suggestions = suggester.get_contextual_suggestions(
            username=username,
            limit=limit,
            use_llm=use_llm
        )
        
        logger.info(f"[API] Retrieved {len(suggestions)} suggestions for {username}")
        return jsonify({
            'username': username,
            'suggestions': suggestions,
            'count': len(suggestions)
        })
    except Exception as e:
        logger.error(f"[API] Error retrieving suggestions: {e}", exc_info=True)
        return jsonify({
            'error': str(e),
            'suggestions': []
        }), 500
