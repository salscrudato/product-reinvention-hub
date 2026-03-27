"""DataDogTools

Higher-level tool functions that wrap DataDogAPIs low-level queries and provide
LLM/planner-friendly outputs. Each tool:
 - Accepts simple, planner-parsable arguments (e.g., user_id, service_name, relative_minutes)
 - Adds a correlation_id (passed through from orchestrator if available)
 - Performs the raw query via DataDogAPIs
 - Optionally summarizes payload to avoid token explosion
 - Logs richly to agentic_orchestrator_auto.log (same formatter) for demo transparency

Tools implemented:
  datadog_get_user_logs
  datadog_get_service_traces
  datadog_search_spans
  datadog_get_user_rum_sessions (optional / may return permission error)

Return shape (success):
  {
    'query': <string>,
    'window': {'start': <ms>, 'end': <ms>},
    'raw_count': <int or None>,
    'summary': {...},
    'note': <string optional>
  }
On error: {'error': '...'}

Planned extension points: pivot trace->spans, expand fields, LLM summary of summaries.
"""
from __future__ import annotations
import os, time, logging
from typing import Optional, Dict, Any
from pydantic import BaseModel
"""Modernized Tool import fallbacks (LangChain 1.x compatible).

Order of preference:
1. langchain_core.tools.Tool
2. langchain_community.tools.Tool
3. langchain.tools.Tool
4. langchain.agents.Tool (older)
5. Minimal stub to keep runtime resilient
"""
try:
    from langchain_core.tools import Tool  # type: ignore
except Exception:  # pragma: no cover
    try:
        from langchain_community.tools import Tool  # type: ignore
    except Exception:
        try:
            from langchain.tools import Tool  # type: ignore
        except Exception:
            try:
                from langchain.agents import Tool  # type: ignore
            except Exception:
                class Tool:  # type: ignore
                    def __init__(self, *a, **k): pass
from .shared_registry import FUNCTION_REGISTRY
from .DataDogAPIs import (
    search_logs, search_traces_for_service, search_spans, search_rum_sessions,
    summarize_logs, summarize_traces, summarize_spans, summarize_rum
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Ensure logging also flows to the agentic orchestrator log if configured elsewhere

# --- Registration Decorator (reuse existing pattern if any) ---

def register_tool_function(name):
    def decorator(func):
        if name in FUNCTION_REGISTRY:
            logger.warning(f"[DataDogTools] Overwriting existing tool name '{name}'")
        FUNCTION_REGISTRY[name] = func
        return func
    return decorator

# --- Utility ---

def _resolve_time_args(relative_minutes: Optional[int], start_ts: Optional[int], end_ts: Optional[int]) -> Dict[str,int]:
    # Only for response envelope; actual DataDogAPIs computes again.
    now_ms = int(time.time()*1000)
    if start_ts and end_ts:
        return {'start': start_ts, 'end': end_ts}
    window = (relative_minutes or int(os.getenv('DATADOG_DEFAULT_TIME_WINDOW_MINUTES', '60')))
    end = now_ms
    start = end - window*60*1000
    return {'start': start, 'end': end}

#############################################
# Pydantic Schemas for LangChain Tool Inputs #
#############################################

class UserLogsInput(BaseModel):
    user_id: str
    relative_minutes: int = 60
    limit: int = 50
    correlation_id: Optional[str] = None

class ServiceTracesInput(BaseModel):
    service_name: str
    env: Optional[str] = None
    relative_minutes: int = 60
    limit: int = 50
    correlation_id: Optional[str] = None

class SpansSearchInput(BaseModel):
    query: str
    relative_minutes: int = 60
    limit: int = 50
    correlation_id: Optional[str] = None

class RumSessionsInput(BaseModel):
    user: str
    relative_minutes: int = 60
    limit: int = 50
    correlation_id: Optional[str] = None

#############################################
# Functional Implementations (already tools) #
#############################################

@register_tool_function('datadog_get_user_logs')
def datadog_get_user_logs(user_id: str, relative_minutes: int = 60, limit: int = 50, correlation_id: Optional[str] = None) -> Dict[str,Any]:
    """Fetch logs associated with a user identifier (flexible raw token).
    Attempts multiple common tag forms.
    """
    if not user_id:
        return {'error': 'user_id is required'}
    # Build query variants; DataDog query OR via parentheses
    variants = [f"@usr.id:{user_id}", f"@user.id:{user_id}", f"@session.user_id:{user_id}"]
    query = '(' + ' OR '.join(variants) + ')'
    logger.info(f"[DataDogTools][user_logs] correlation_id={correlation_id} user_id={user_id} rel_min={relative_minutes} limit={limit}")
    # Demo mode: inject synthetic payload without calling backend APIs
    if os.getenv('DEMO_DATADOG', '').lower() in ('1','true','yes','on'):
        synthetic_events = [
            {
                'timestamp': int(time.time()*1000) - i*12000,
                'message': f"User {user_id} experienced 500 error on /api/orders (attempt {i})",
                'status': 'error',
                'service': 'orders-api',
                'trace_id': f"trace-{correlation_id or 'demo'}-{i}",
                'span_id': f"span-{i}",
                'env': 'prod'
            } for i in range(min(10, limit))
        ]
        raw = {
            'events': synthetic_events,
            'meta': {'page': {'total_filtered_events': len(synthetic_events)}},
            'note': 'synthetic demo payload'
        }
    else:
        raw = search_logs(query=query, relative_minutes=relative_minutes, limit=limit, correlation_id=correlation_id)
    if 'error' in raw:
        return raw
    summary = summarize_logs(raw, limit=min(10, limit))
    window = _resolve_time_args(relative_minutes, None, None)
    return {
        'query': query,
        'window': window,
        'raw_count': raw.get('meta', {}).get('page', {}).get('total_filtered_events'),
        'summary': summary
    }

@register_tool_function('datadog_get_service_traces')
def datadog_get_service_traces(service_name: str, env: Optional[str] = None, relative_minutes: int = 60, limit: int = 50, correlation_id: Optional[str] = None) -> Dict[str,Any]:
    if not service_name:
        return {'error': 'service_name is required'}
    logger.info(f"[DataDogTools][service_traces] correlation_id={correlation_id} service={service_name} env={env} rel_min={relative_minutes} limit={limit}")
    if os.getenv('DEMO_DATADOG', '').lower() in ('1','true','yes','on'):
        synthetic_traces = []
        base_ts = int(time.time()*1000)
        for i in range(min(8, limit)):
            duration_ms = 50 + i*37
            synthetic_traces.append({
                'trace_id': f"trace-{correlation_id or 'demo'}-{i}",
                'root_service': service_name,
                'duration_ms': duration_ms,
                'error': i % 3 == 0,
                'start_ts': base_ts - i*15000,
                'operation': 'GET /api/cart',
                'env': env or 'prod'
            })
        raw = {
            'traces': synthetic_traces,
            'meta': {'page': {'total_filtered_events': len(synthetic_traces)}},
            'note': 'synthetic demo payload'
        }
    else:
        raw = search_traces_for_service(service_name=service_name, env=env, relative_minutes=relative_minutes, limit=limit, correlation_id=correlation_id)
    if 'error' in raw:
        return raw
    summary = summarize_traces(raw, limit=min(10, limit))
    window = _resolve_time_args(relative_minutes, None, None)
    return {
        'query': f"service:{service_name} env:{env}" if env else f"service:{service_name}",
        'window': window,
        'raw_count': raw.get('meta', {}).get('page', {}).get('total_filtered_events'),
        'summary': summary
    }

@register_tool_function('datadog_search_spans')
def datadog_search_spans(query: str, relative_minutes: int = 60, limit: int = 50, correlation_id: Optional[str] = None) -> Dict[str,Any]:
    if not query:
        return {'error': 'query is required'}
    logger.info(f"[DataDogTools][spans] correlation_id={correlation_id} query={query} rel_min={relative_minutes} limit={limit}")
    if os.getenv('DEMO_DATADOG', '').lower() in ('1','true','yes','on'):
        synthetic_spans = []
        base = int(time.time()*1000)
        for i in range(min(12, limit)):
            synthetic_spans.append({
                'span_id': f"span-{correlation_id or 'demo'}-{i}",
                'trace_id': f"trace-{correlation_id or 'demo'}-{i//3}",
                'service': 'orders-api',
                'resource': '/api/cart',
                'operation': 'sql.query',
                'duration_ms': 20 + i*11,
                'error': i % 5 == 0,
                'start_ts': base - i*5000,
                'env': 'prod'
            })
        raw = {
            'spans': synthetic_spans,
            'meta': {'page': {'total_filtered_events': len(synthetic_spans)}},
            'note': 'synthetic demo payload'
        }
    else:
        raw = search_spans(query=query, relative_minutes=relative_minutes, limit=limit, correlation_id=correlation_id)
    if 'error' in raw:
        return raw
    summary = summarize_spans(raw, limit=min(10, limit))
    window = _resolve_time_args(relative_minutes, None, None)
    return {
        'query': query,
        'window': window,
        'raw_count': raw.get('meta', {}).get('page', {}).get('total_filtered_events'),
        'summary': summary
    }

@register_tool_function('datadog_get_user_rum_sessions')
def datadog_get_user_rum_sessions(user: str, relative_minutes: int = 60, limit: int = 50, correlation_id: Optional[str] = None) -> Dict[str,Any]:
    if not user:
        return {'error': 'user is required'}
    logger.info(f"[DataDogTools][rum] correlation_id={correlation_id} user={user} rel_min={relative_minutes} limit={limit}")
    if os.getenv('DEMO_DATADOG', '').lower() in ('1','true','yes','on'):
        synthetic_sessions = []
        base = int(time.time()*1000)
        for i in range(min(6, limit)):
            synthetic_sessions.append({
                'session_id': f"rum-{correlation_id or 'demo'}-{i}",
                'user': user,
                'slow_pages': i % 2 == 0,
                'error_events': i % 3,
                'long_tasks': 2 + i,
                'start_ts': base - i*30000,
                'duration_ms': 120000 + i*10000
            })
        raw = {
            'sessions': synthetic_sessions,
            'meta': {'page': {'total_filtered_events': len(synthetic_sessions)}},
            'note': 'synthetic demo payload'
        }
    else:
        raw = search_rum_sessions(user=user, relative_minutes=relative_minutes, limit=limit, correlation_id=correlation_id)
    if 'error' in raw:
        return raw
    summary = summarize_rum(raw, limit=min(10, limit))
    window = _resolve_time_args(relative_minutes, None, None)
    return {
        'query': user,
        'window': window,
        'raw_count': raw.get('meta', {}).get('page', {}).get('total_filtered_events'),
        'summary': summary
    }

__all__ = [
    'datadog_get_user_logs', 'datadog_get_service_traces', 'datadog_search_spans', 'datadog_get_user_rum_sessions',
    'datadog_get_user_logs_tool', 'datadog_get_service_traces_tool', 'datadog_search_spans_tool', 'datadog_get_user_rum_sessions_tool',
    'datadog_auto_investigate', 'datadog_auto_investigate_tool'
]

#############################################
# LangChain Tool object wrappers             #
#############################################

def _wrap_user_logs(args: UserLogsInput):
    return datadog_get_user_logs(
        user_id=args.user_id,
        relative_minutes=args.relative_minutes,
        limit=args.limit,
        correlation_id=args.correlation_id
    )

datadog_get_user_logs_tool = Tool(
    name='datadog_get_user_logs',
    func=lambda a: _wrap_user_logs(a),
    description='Fetch DataDog logs for a given user id (tries common user tag variants) over a relative time window.',
    args_schema=UserLogsInput,
    return_direct=False
)

def _wrap_service_traces(args: ServiceTracesInput):
    return datadog_get_service_traces(
        service_name=args.service_name,
        env=args.env,
        relative_minutes=args.relative_minutes,
        limit=args.limit,
        correlation_id=args.correlation_id
    )

datadog_get_service_traces_tool = Tool(
    name='datadog_get_service_traces',
    func=lambda a: _wrap_service_traces(a),
    description='Search APM traces/events for a given service (and optional env) within a relative time window.',
    args_schema=ServiceTracesInput,
    return_direct=False
)

def _wrap_spans(args: SpansSearchInput):
    return datadog_search_spans(
        query=args.query,
        relative_minutes=args.relative_minutes,
        limit=args.limit,
        correlation_id=args.correlation_id
    )

datadog_search_spans_tool = Tool(
    name='datadog_search_spans',
    func=lambda a: _wrap_spans(a),
    description='Generic span search using a raw DataDog span query string (service:foo error:true etc.).',
    args_schema=SpansSearchInput,
    return_direct=False
)

def _wrap_rum(args: RumSessionsInput):
    return datadog_get_user_rum_sessions(
        user=args.user,
        relative_minutes=args.relative_minutes,
        limit=args.limit,
        correlation_id=args.correlation_id
    )

datadog_get_user_rum_sessions_tool = Tool(
    name='datadog_get_user_rum_sessions',
    func=lambda a: _wrap_rum(a),
    description='Search RUM sessions for a given user token (requires RUM enabled).',
    args_schema=RumSessionsInput,
    return_direct=False
)

#############################################
# Composite Investigation Tool               #
#############################################

class AutoInvestigateInput(BaseModel):
    question: str
    service_name: str = 'simulated-service'
    env: Optional[str] = None
    user_id: Optional[str] = None
    relative_minutes: int = 60
    correlation_id: Optional[str] = None

def datadog_auto_investigate(question: str, service_name: str = 'simulated-service', env: Optional[str] = None, user_id: Optional[str] = None, relative_minutes: int = 60, correlation_id: Optional[str] = None):
    """Heuristic multi-step investigation:
    1. Always pull service traces
    2. Pull spans focusing on errors or latency
    3. If user_id provided or question references 'user', pull user logs
    Returns ordered steps with their summaries.
    """
    logger.info(f"[DataDogTools][auto_investigate] correlation_id={correlation_id} question='{question}' service={service_name} env={env} user={user_id}")
    steps = []
    traces = datadog_get_service_traces(service_name=service_name, env=env, relative_minutes=relative_minutes, correlation_id=correlation_id)
    steps.append({'step': 'traces', 'result': traces})
    span_query = f"service:{service_name} error:true"  # simple heuristic
    spans = datadog_search_spans(query=span_query, relative_minutes=relative_minutes, correlation_id=correlation_id)
    steps.append({'step': 'spans', 'result': spans})
    need_user = user_id or ('user' in question.lower())
    if need_user and user_id:
        user_logs = datadog_get_user_logs(user_id=user_id, relative_minutes=relative_minutes, correlation_id=correlation_id)
        steps.append({'step': 'user_logs', 'result': user_logs})
    if os.getenv('DEMO_DATADOG', '').lower() in ('1','true','yes','on'):
        synthesis = (
            "Demo Investigation Summary: Synthetic traces show intermittent 500 errors every 3rd request, spans reveal slow SQL queries > 120ms, "
            "and user logs confirm cart endpoint failures correlating with spike. Recommend: investigate DB index on 'cart_items', deploy fix, monitor for error rate drop."
        )
    else:
        synthesis = "High-level simulated investigation summary. Traces, spans, and optional user logs collected for reasoning."  # placeholder; could call LLM
    return {'steps': steps, 'synthesis': synthesis, 'correlation_id': correlation_id}

def _wrap_auto(args: AutoInvestigateInput):
    return datadog_auto_investigate(
        question=args.question,
        service_name=args.service_name,
        env=args.env,
        user_id=args.user_id,
        relative_minutes=args.relative_minutes,
        correlation_id=args.correlation_id
    )

datadog_auto_investigate_tool = Tool(
    name='datadog_auto_investigate',
    func=lambda a: _wrap_auto(a),
    description='Composite multi-step DataDog investigation (traces -> spans -> optional user logs) with simulated synthesis.',
    args_schema=AutoInvestigateInput,
    return_direct=False
)
