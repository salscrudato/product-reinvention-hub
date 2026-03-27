"""DataDogAPIs

Low-level wrapper functions for DataDog Logs, APM Traces/Spans, and (optionally) RUM Sessions.
Designed to be consumed by higher-level tool functions (see DataDogTools.py) and the
agentic orchestrator planning/execution pipeline.

Key goals:
- Centralize authentication (API + APP key) & base URL.
- Provide focused query helpers (logs between time range, traces for service, span search).
- Uniform structured logging with correlation ids for agentic planner.
- Resilient HTTP (retry with backoff, timeout, partial failure handling).
- Return normalized Python dicts (no raw Response objects) ready for LLM summarization.

Environment Variables Expected:
  DATADOG_API_KEY           (Required)
  DATADOG_APP_KEY           (Required for most read APIs)
  DATADOG_SITE              (Optional; e.g. 'datadoghq.com', 'us3.datadoghq.com'; default 'datadoghq.com')
  DATADOG_DEFAULT_TIME_WINDOW_MINUTES (Optional fallback when no times given, default 60)
  DATADOG_LOG_INDEX         (Optional; if you want to restrict a specific log index)
  DATADOG_TRACE_SPAN_INDEX  (Optional; specific APM index if needed)
  DATADOG_MAX_RESULTS       (Optional; cap results returned to protect token budgets, default 100)

Time Parameters:
  All public query helpers accept either:
    - start_ts / end_ts epoch milliseconds
    - or relative_minutes (int) for a backwards-looking window
  If neither given, default window minutes is used.

NOTE: Actual DataDog APIs:
  Logs Search v2:   POST https://api.<site>/api/v2/logs/events/search
  Traces (APM) v2:  POST https://api.<site>/api/v2/apm/events/search
  Spans search:     POST https://api.<site>/api/v2/apm/events/search (spans filter)
  RUM sessions:     (If needed) https://api.<site>/api/v2/rum/sessions/search  (not always enabled)
We implement flexible generic _post_json and pass body filters.

IMPORTANT: The user may not yet have DataDog keys; we degrade gracefully with clear error messages.
"""
from __future__ import annotations
import os, time, logging, json, math
from typing import Optional, Dict, Any, List, Tuple
import requests

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

DEFAULT_TIMEOUT = 20  # seconds
MAX_RETRIES = 3
BACKOFF_BASE = 0.75
SIMULATE = os.getenv('DATADOG_SIMULATE', '0') in ('1','true','True','yes','Y')

# ------------- Utility & Auth -------------

def _get_datadog_config() -> Dict[str, Any]:
    cfg = {
        'api_key': os.getenv('DATADOG_API_KEY', '').strip(),
        'app_key': os.getenv('DATADOG_APP_KEY', '').strip(),
        'site': os.getenv('DATADOG_SITE', 'datadoghq.com').strip(),
        'default_window_min': int(os.getenv('DATADOG_DEFAULT_TIME_WINDOW_MINUTES', '60')),
        'max_results': int(os.getenv('DATADOG_MAX_RESULTS', '100')),
        'log_index': os.getenv('DATADOG_LOG_INDEX'),
        'trace_index': os.getenv('DATADOG_TRACE_SPAN_INDEX')
    }
    return cfg


def _base_url(site: str) -> str:
    # DataDog docs: api.<site>
    return f"https://api.{site}".rstrip('/')


def _headers(cfg: Dict[str, Any], extra: Optional[Dict[str,str]] = None) -> Dict[str, str]:
    h = {
        'DD-API-KEY': cfg['api_key'],
        'DD-APPLICATION-KEY': cfg['app_key'],
        'Content-Type': 'application/json'
    }
    if extra:
        h.update(extra)
    return h


def _validate_auth(cfg: Dict[str, Any]) -> Optional[str]:
    # Allow simulation mode to bypass real auth.
    if SIMULATE:
        return None
    if not cfg['api_key']:
        return 'Missing DATADOG_API_KEY'
    if not cfg['app_key']:
        return 'Missing DATADOG_APP_KEY'
    return None


def _compute_time_range(start_ts: Optional[int], end_ts: Optional[int], relative_minutes: Optional[int], default_window_min: int) -> Tuple[int,int]:
    now_ms = int(time.time()*1000)
    if start_ts and end_ts:
        return start_ts, end_ts
    if relative_minutes:
        end = now_ms
        start = end - relative_minutes*60*1000
        return start, end
    # fallback
    end = now_ms
    start = end - default_window_min*60*1000
    return start, end


def _post_json(url: str, headers: Dict[str,str], body: Dict[str,Any], timeout: int = DEFAULT_TIMEOUT) -> Dict[str,Any]:
    if SIMULATE:
        # Return a deterministic dummy structure that looks like DataDog events API.
        now = int(time.time()*1000)
        dummy = {
            'meta': {'page': {'total_filtered_events': 3}},
            'data': [
                {'attributes': {'timestamp': now-30000, 'service': 'simulated-service', 'status': 'info', 'duration': 1200000, 'resource': 'GET /api/ping', 'env': 'dev'}},
                {'attributes': {'timestamp': now-20000, 'service': 'simulated-service', 'status': 'error', 'duration': 2500000, 'resource': 'POST /api/order', 'env': 'dev'}},
                {'attributes': {'timestamp': now-10000, 'service': 'simulated-service', 'status': 'warn', 'duration': 800000, 'resource': 'PUT /api/user', 'env': 'dev'}}
            ],
            '_simulated': True
        }
        logger.info(f"[DataDogAPIs][simulate] Returning simulated payload for url={url}")
        return dummy
    last_exc = None
    for attempt in range(1, MAX_RETRIES+1):
        try:
            resp = requests.post(url, headers=headers, data=json.dumps(body), timeout=timeout)
            if resp.status_code >= 500:
                raise RuntimeError(f"Server {resp.status_code}: {resp.text[:200]}")
            if resp.status_code == 401:
                return {'error': 'Unauthorized (401) - verify DataDog API and APP keys'}
            if resp.status_code == 403:
                return {'error': 'Forbidden (403) - key lacks required permissions for this query'}
            if not resp.ok:
                return {'error': f"HTTP {resp.status_code}: {resp.text[:300]}"}
            return resp.json()
        except Exception as e:  # network or server raised
            last_exc = e
            sleep_s = BACKOFF_BASE * (2 ** (attempt-1))
            logger.warning(f"[DataDogAPIs] POST attempt {attempt} failed: {e}; backing off {sleep_s:.2f}s")
            time.sleep(sleep_s)
    return {'error': f"Request failed after retries: {last_exc}"}

# ------------- Logs Search -------------

def search_logs(query: str, start_ts: Optional[int] = None, end_ts: Optional[int] = None, relative_minutes: Optional[int] = None, limit: Optional[int] = None, correlation_id: Optional[str] = None) -> Dict[str,Any]:
    """Search DataDog logs using v2 events search.

    query example fragments:
      service:my-service @user.id:u123 status:error
    """
    cfg = _get_datadog_config()
    auth_err = _validate_auth(cfg)
    if auth_err:
        return {'error': auth_err}
    start, end = _compute_time_range(start_ts, end_ts, relative_minutes, cfg['default_window_min'])
    limit = min(limit or cfg['max_results'], cfg['max_results'])
    body = {
        'filter': {
            'from': f"{start}",
            'to': f"{end}",
            'query': query
        },
        'page': { 'limit': limit }
    }
    if cfg['log_index']:
        body['filter']['indexes'] = [cfg['log_index']]
    url = _base_url(cfg['site']) + '/api/v2/logs/events/search'
    logger.info(f"[DataDogAPIs][logs] correlation_id={correlation_id} query='{query}' from={start} to={end} limit={limit}")
    return _post_json(url, _headers(cfg), body)

# ------------- Traces / Spans Search -------------

def search_traces_for_service(service_name: str, start_ts: Optional[int] = None, end_ts: Optional[int] = None, relative_minutes: Optional[int] = None, env: Optional[str] = None, limit: Optional[int] = None, correlation_id: Optional[str] = None) -> Dict[str,Any]:
    """Search APM events (traces) for a given service name.

    DataDog's unified APM events search uses the same endpoint; we build a query.
    Example query: service:newapplicationsystem env:prod @http.status_code:500
    """
    cfg = _get_datadog_config()
    auth_err = _validate_auth(cfg)
    if auth_err:
        return {'error': auth_err}
    start, end = _compute_time_range(start_ts, end_ts, relative_minutes, cfg['default_window_min'])
    limit = min(limit or cfg['max_results'], cfg['max_results'])
    q_parts = [f"service:{service_name}"]
    if env:
        q_parts.append(f"env:{env}")
    query = ' '.join(q_parts)
    body = {
        'filter': {
            'from': f"{start}",
            'to': f"{end}",
            'query': query
        },
        'page': { 'limit': limit }
    }
    if cfg['trace_index']:
        body['filter']['indexes'] = [cfg['trace_index']]
    url = _base_url(cfg['site']) + '/api/v2/apm/events/search'
    logger.info(f"[DataDogAPIs][traces] correlation_id={correlation_id} service={service_name} env={env} from={start} to={end} limit={limit}")
    return _post_json(url, _headers(cfg), body)


def search_spans(query: str, start_ts: Optional[int] = None, end_ts: Optional[int] = None, relative_minutes: Optional[int] = None, limit: Optional[int] = None, correlation_id: Optional[str] = None) -> Dict[str,Any]:
    """Low-level span search.
    Provide raw query: e.g. 'service:orders error:true duration:>500ms'
    """
    cfg = _get_datadog_config()
    auth_err = _validate_auth(cfg)
    if auth_err:
        return {'error': auth_err}
    start, end = _compute_time_range(start_ts, end_ts, relative_minutes, cfg['default_window_min'])
    limit = min(limit or cfg['max_results'], cfg['max_results'])
    body = {
        'filter': {
            'from': f"{start}",
            'to': f"{end}",
            'query': query
        },
        'page': { 'limit': limit }
    }
    if cfg['trace_index']:
        body['filter']['indexes'] = [cfg['trace_index']]
    url = _base_url(cfg['site']) + '/api/v2/apm/events/search'
    logger.info(f"[DataDogAPIs][spans] correlation_id={correlation_id} query='{query}' from={start} to={end} limit={limit}")
    return _post_json(url, _headers(cfg), body)

# ------------- RUM Sessions (Optional) -------------

def search_rum_sessions(user: Optional[str] = None, start_ts: Optional[int] = None, end_ts: Optional[int] = None, relative_minutes: Optional[int] = None, limit: Optional[int] = None, correlation_id: Optional[str] = None) -> Dict[str,Any]:
    """Search RUM sessions if RUM is enabled for the account.
    Query example: '@session.user.email:alice@company.com' or '@usr.id:u123'
    """
    cfg = _get_datadog_config()
    auth_err = _validate_auth(cfg)
    if auth_err:
        return {'error': auth_err}
    start, end = _compute_time_range(start_ts, end_ts, relative_minutes, cfg['default_window_min'])
    limit = min(limit or cfg['max_results'], cfg['max_results'])
    q_parts = []
    if user:
        # DataDog common tags for user identification can vary; allow raw user string
        q_parts.append(user)
    query = ' '.join(q_parts) or '*'
    body = {
        'filter': {
            'from': f"{start}",
            'to': f"{end}",
            'query': query
        },
        'page': { 'limit': limit }
    }
    url = _base_url(cfg['site']) + '/api/v2/rum/sessions/search'
    logger.info(f"[DataDogAPIs][rum] correlation_id={correlation_id} query='{query}' from={start} to={end} limit={limit}")
    return _post_json(url, _headers(cfg), body)

# ------------- Normalization Helpers -------------

def _summarize_events(payload: Dict[str,Any], kind: str, limit: int) -> Dict[str,Any]:
    if 'error' in payload:
        return payload
    data = payload.get('data', [])
    summaries = []
    for item in data[:limit]:
        attr = item.get('attributes', {})
        summary = {
            'timestamp': attr.get('timestamp'),
            'service': attr.get('service'),
            'status': attr.get('status') or attr.get('status_code'),
            'duration': attr.get('duration'),
            'resource': attr.get('resource'),
            'env': attr.get('env'),
        }
        summaries.append(summary)
    return {'kind': kind, 'count': len(data), 'summaries': summaries}


def summarize_logs(raw: Dict[str,Any], limit: int = 10) -> Dict[str,Any]:
    return _summarize_events(raw, 'logs', limit)

def summarize_traces(raw: Dict[str,Any], limit: int = 10) -> Dict[str,Any]:
    return _summarize_events(raw, 'traces', limit)

def summarize_spans(raw: Dict[str,Any], limit: int = 10) -> Dict[str,Any]:
    return _summarize_events(raw, 'spans', limit)

def summarize_rum(raw: Dict[str,Any], limit: int = 10) -> Dict[str,Any]:
    return _summarize_events(raw, 'rum_sessions', limit)

__all__ = [
    'search_logs', 'search_traces_for_service', 'search_spans', 'search_rum_sessions',
    'summarize_logs', 'summarize_traces', 'summarize_spans', 'summarize_rum'
]
