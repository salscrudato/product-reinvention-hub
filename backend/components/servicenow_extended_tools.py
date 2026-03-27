import os
import requests
from typing import Dict, Any, List, Optional, Tuple
import logging
from datetime import datetime, timedelta, timezone
import time, uuid

"""All ServiceNow extended tool logs are routed through the orchestrator logger namespace
so they land in agentic_orchestrator_auto.log for unified tracing."""
logger = logging.getLogger("agentic_orchestrator_auto.servicenow")
from os import getenv as _getenv
# Ensure propagation so handlers attached to parent 'agentic_orchestrator_auto' write these entries
logger.propagate = True
if _getenv('SERVICENOW_VERBOSE_LOG', '').lower() in ('1','true','yes','on'):
    # Elevate this logger's own level so DEBUG emits; parent handler level managed in orchestrator file
    logger.setLevel(logging.DEBUG)

# Provide an alias logger pointing to the same reference in case other code looks up exact root name
_alias_logger = logging.getLogger("agentic_orchestrator_auto")

# Optional verbose wire-level style logging (no secrets). Enable with SERVICENOW_VERBOSE_LOG=1|true
def _verbose_enabled():
    return os.getenv('SERVICENOW_VERBOSE_LOG', '').lower() in ('1','true','yes','on')

# One-time banner to confirm wiring (avoid duplicate on module reload attempts)
if not getattr(logger, '_sn_banner_logged', False):
    logger.info(f"[ServiceNowTools] init logger={logger.name} verbose_at_import={_verbose_enabled()}")
    setattr(logger, '_sn_banner_logged', True)

# NOTE: We intentionally DO NOT cache ServiceNow credentials/instance at import time.
# Some parts of the app load the .env AFTER modules import, which previously left
# SERVICENOW_INSTANCE as None and forced stub behavior. We now resolve env values
# dynamically on each call so late loading or runtime changes are picked up.

def _env_instance():
    return os.getenv('SERVICENOW_INSTANCE')

def _env_user():
    return os.getenv('SERVICENOW_USER')

def _env_pass():
    return os.getenv('SERVICENOW_PASSWORD')

def _env_token():
    return os.getenv('SERVICENOW_BEARER_TOKEN')

# Simple in-process cache (short‑lived) to reduce duplicate lookups
_CACHE: Dict[str, Tuple[datetime, Any]] = {}
_CACHE_TTL_SECONDS = 60

# Configurable states & buckets
_CLOSED_STATES_ENV = os.getenv('SERVICENOW_CLOSED_STATES', '7,8')  # default common Closed/Resolved
CLOSED_STATES = [s.strip() for s in _CLOSED_STATES_ENV.split(',') if s.strip()]

_AGING_BUCKETS_ENV = os.getenv('SERVICENOW_AGING_BUCKETS', '0-3,4-7,8+')
AGING_BUCKETS_SPEC = [b.strip() for b in _AGING_BUCKETS_ENV.split(',') if b.strip()]

def _bucketize_age(days: int) -> str:
    for spec in AGING_BUCKETS_SPEC:
        if '-' in spec:
            lo, hi = spec.split('-', 1)
            try:
                lo_i = int(lo)
                hi_i = int(hi.replace('+','')) if '+' not in hi else None
            except ValueError:
                continue
            if hi_i is None:  # open upper bound
                if days >= lo_i:
                    return spec
            else:
                if lo_i <= days <= hi_i:
                    return spec
        elif spec.endswith('+'):
            try:
                base = int(spec[:-1])
                if days >= base:
                    return spec
            except ValueError:
                pass
    return 'unbucketed'


def _cache_get(key: str):
    ent = _CACHE.get(key)
    if not ent:
        return None
    ts, val = ent
    if (datetime.now(timezone.utc) - ts).total_seconds() > _CACHE_TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return val


def _cache_set(key: str, val: Any):
    _CACHE[key] = (datetime.now(timezone.utc), val)


def _sn_headers() -> Dict[str, str]:
    h = {'Accept': 'application/json'}
    token = _env_token()
    if token:
        h['Authorization'] = f'Bearer {token}'
    return h


def _auth_tuple():
    # If bearer token present we don't use basic auth
    if _env_token():
        return None
    user = _env_user(); pw = _env_pass()
    if user and pw:
        return (user, pw)
    return None

def _sn_get(path: str, params: Dict[str, Any] | None = None) -> Any:
    instance = _env_instance()
    if not instance:
        raise RuntimeError('SERVICENOW_INSTANCE not configured')
    url = f"{instance}{path}"
    started = time.time()
    corr = uuid.uuid4().hex[:8]
    if _verbose_enabled():
        safe_params = dict(params or {})
        logger.debug(f"[ServiceNowAPI][{corr}] GET {path} params={safe_params}")
    try:
        resp = requests.get(url, auth=_auth_tuple(), params=params, headers=_sn_headers(), timeout=30)
        status = resp.status_code
        resp.raise_for_status()
        js = resp.json()
        if _verbose_enabled():
            result_count = len((js.get('result') or [])) if isinstance(js, dict) else 'n/a'
            elapsed = round((time.time() - started)*1000,2)
            logger.debug(f"[ServiceNowAPI][{corr}] OK {status} {path} result_count={result_count} elapsed_ms={elapsed}")
        return js
    except Exception as e:
        elapsed = round((time.time() - started)*1000,2)
        logger.error(f"[ServiceNowAPI][{corr}] ERROR GET {path} elapsed_ms={elapsed} err={e}")
        raise

def _sn_post(path: str, payload: Dict[str, Any]) -> Any:
    instance = _env_instance()
    if not instance:
        raise RuntimeError('SERVICENOW_INSTANCE not configured')
    url = f"{instance}{path}"
    headers = _sn_headers()
    headers['Content-Type'] = 'application/json'
    started = time.time(); corr = uuid.uuid4().hex[:8]
    if _verbose_enabled():
        logger.debug(f"[ServiceNowAPI][{corr}] POST {path} payload_keys={list(payload.keys())}")
    try:
        resp = requests.post(url, auth=_auth_tuple(), json=payload, headers=headers, timeout=30)
        status = resp.status_code
        resp.raise_for_status()
        js = resp.json()
        if _verbose_enabled():
            elapsed = round((time.time() - started)*1000,2)
            logger.debug(f"[ServiceNowAPI][{corr}] OK {status} POST {path} elapsed_ms={elapsed}")
        return js
    except Exception as e:
        elapsed = round((time.time() - started)*1000,2)
        logger.error(f"[ServiceNowAPI][{corr}] ERROR POST {path} elapsed_ms={elapsed} err={e}")
        raise


def _sanitize_value(v: str) -> str:
    # Allow alphanum, punctuation common to names/numbers/underscores/dash
    return ''.join(ch for ch in v if ch.isalnum() or ch in ('_', '-', '.', ' ', ':'))[:120]


def _lookup_sys_id(table: str, field: str, value: str) -> Optional[str]:
    value = _sanitize_value(value)
    cache_key = f"lookup:{table}:{field}:{value}"
    cached = _cache_get(cache_key)
    if cached:
        if _verbose_enabled():
            logger.debug(f"[ServiceNowAPI] cache_hit sys_id table={table} field={field} value={value}")
        return cached
    params = {
        'sysparm_query': f"{field}={value}",
        'sysparm_fields': 'sys_id',
        'sysparm_limit': 1
    }
    started = time.time(); corr = uuid.uuid4().hex[:8]
    if _verbose_enabled():
        logger.debug(f"[ServiceNowAPI][{corr}] lookup_sys_id table={table} field={field} value={value}")
    try:
        data = _sn_get(f"/api/now/table/{table}", params)
        result = (data.get('result') or [])
        if result:
            sys_id = result[0].get('sys_id')
            if sys_id:
                _cache_set(cache_key, sys_id)
                if _verbose_enabled():
                    elapsed = round((time.time()-started)*1000,2)
                    logger.debug(f"[ServiceNowAPI][{corr}] lookup_sys_id HIT table={table} field={field} elapsed_ms={elapsed}")
                return sys_id
        if _verbose_enabled():
            elapsed = round((time.time()-started)*1000,2)
            logger.debug(f"[ServiceNowAPI][{corr}] lookup_sys_id MISS table={table} field={field} elapsed_ms={elapsed}")
    except Exception as e:
        elapsed = round((time.time()-started)*1000,2)
        logger.warning(f"[ServiceNowAPI][{corr}] lookup_sys_id ERROR table={table} field={field} value={value} elapsed_ms={elapsed} err={e}")
    return None


def _table_get(table: str, query: str, fields: Optional[str] = None, limit: int = 10, order: Optional[str] = None) -> List[Dict[str, Any]]:
    params = {
        'sysparm_query': query,
        'sysparm_limit': limit
    }
    if fields:
        params['sysparm_fields'] = fields
    if order:
        params['sysparm_query'] = f"{query}^{order}"
    started = time.time(); corr = uuid.uuid4().hex[:8]
    if _verbose_enabled():
        logger.debug(f"[ServiceNowAPI][{corr}] table_get table={table} limit={limit} fields={fields} query={query}")
    data = _sn_get(f"/api/now/table/{table}", params)
    result = data.get('result') or []
    if _verbose_enabled():
        elapsed = round((time.time()-started)*1000,2)
        logger.debug(f"[ServiceNowAPI][{corr}] table_get table={table} count={len(result)} elapsed_ms={elapsed}")
    return result


def fetch_backlog_overview(project: Optional[str] = None, days: int = 14, sample_limit: int = 400):
    """Repurposed: Provide incident backlog overview (JIRA used for Agile stories).

    - Filters out closed states (configurable via SERVICENOW_CLOSED_STATES)
    - Buckets incident age using SERVICENOW_AGING_BUCKETS spec (e.g. "0-3,4-7,8+")
    - Returns priority distribution, aging distribution, and sample size (capped)
    """
    try:
        window_start = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
        state_clause = 'stateNOT IN' + ','.join(CLOSED_STATES) if CLOSED_STATES else ''
        query = f"{state_clause}^{'opened_at>=' + window_start if window_start else ''}".strip('^')
        fields = 'number,priority,opened_at'
        # Basic pagination if sample_limit > 200 (ServiceNow default limit); we loop in 200-chunks
        all_incidents: List[Dict[str, Any]] = []
        remaining = sample_limit
        offset = 0
        while remaining > 0:
            batch_limit = min(200, remaining)
            incidents = _table_get('incident', query, fields=fields, limit=batch_limit)
            if not incidents:
                break
            all_incidents.extend(incidents)
            if len(incidents) < batch_limit:
                break
            # If we need deeper pagination, add sysparm_offset support (not implemented in _table_get), break for now
            if batch_limit == 200 and remaining > 200:
                # Enhancement placeholder: implement sysparm_offset if necessary
                break
            remaining -= batch_limit
            offset += batch_limit
        aging_counts: Dict[str, int] = {spec: 0 for spec in AGING_BUCKETS_SPEC}
        aging_counts.setdefault('unbucketed', 0)
        by_priority: Dict[str, int] = {}
        now = datetime.utcnow()
        for inc in all_incidents:
            pr = (inc.get('priority') or 'unknown')
            by_priority[pr] = by_priority.get(pr, 0) + 1
            opened_at = inc.get('opened_at')
            try:
                if opened_at:
                    dt = datetime.strptime(opened_at[:19], '%Y-%m-%d %H:%M:%S')
                    age_days = (now - dt).days
                    bucket = _bucketize_age(age_days)
                    aging_counts[bucket] = aging_counts.get(bucket, 0) + 1
            except Exception:
                pass
        return {
            'scope': 'incident_backlog',
            'days_window': days,
            'total_sampled': len(all_incidents),
            'by_priority': by_priority,
            'aging': aging_counts,
            'closed_states_excluded': CLOSED_STATES,
            'aging_buckets_spec': AGING_BUCKETS_SPEC,
            # NEW: Include incident list for short-term memory context
            'sample': all_incidents  # Full list for STM pronoun resolution
        }
    except Exception as e:
        logger.error(f"[ServiceNowTools] fetch_backlog_overview error: {e}")
        return {'error': str(e), 'scope': 'incident_backlog'}

def fetch_change_records_related(ci: Optional[str] = None, incident_number: Optional[str] = None, limit: int = 10):
    try:
        ci_sys_id = None
        if incident_number:
            inc = _table_get('incident', f"number={_sanitize_value(incident_number)}", fields='sys_id,cmdb_ci', limit=1)
            if inc:
                ci_sys_id = inc[0].get('cmdb_ci') or inc[0].get('cmdb_ci', {}).get('value')
        if ci and not ci_sys_id:
            ci_sys_id = _lookup_sys_id('cmdb_ci', 'name', ci)
        if not ci_sys_id:
            return {'criteria': {'ci': ci, 'incident_number': incident_number}, 'changes': []}
        query = f"cmdb_ci={ci_sys_id}"
        changes = _table_get('change_request', query, fields='number,sys_id,type,risk,priority,start_date,state,short_description', limit=limit, order='ORDERBYDESC start_date')
        return {'criteria': {'ci_sys_id': ci_sys_id, 'incident_number': incident_number}, 'changes': changes}
    except Exception as e:
        logger.error(f"[ServiceNowTools] fetch_change_records_related error: {e}")
        return {'error': str(e)}


def risk_assess_change(change_id: str):
    """Heuristic risk assessment.
    Factors:
      - Priority weight
      - Change risk field (high)
      - Related incident volume (last 30d)
      - Imminent window (<24h)
      - Emergency type/state acceleration
    Returns explanation factors to justify score.
    """
    try:
        fields = 'number,sys_id,risk,priority,start_date,type,state,short_description,cmdb_ci'
        chg_list = _table_get('change_request', f"number={_sanitize_value(change_id)}", fields=fields, limit=1)
        if not chg_list:
            return {'error': 'change_not_found', 'change_id': change_id}
        chg = chg_list[0]
        ci_sys = chg.get('cmdb_ci') or (chg.get('cmdb_ci', {}).get('value') if isinstance(chg.get('cmdb_ci'), dict) else None)
        since = (datetime.utcnow() - timedelta(days=30)).strftime('%Y-%m-%d')
        related_incidents = []
        if ci_sys:
            related_incidents = _table_get('incident', f"cmdb_ci={ci_sys}^opened_at>={since}", fields='number,priority,state,opened_at', limit=100)
        priority = str(chg.get('priority') or '')
        priority_weights = {'1': 35, '2': 25, '3': 15, '4': 10, '5': 5}
        score = 10 + priority_weights.get(priority, 12)
        factors = []
        factors.append(f"Base + priority({priority}) -> {score}")
        risk_field = (str(chg.get('risk') or '').lower())
        if risk_field in ('high', '3'):
            score += 20
            factors.append("High risk field +20")
        rel_count = len(related_incidents)
        rel_incr = min(rel_count, 20)  # cap
        score += rel_incr
        factors.append(f"Related incidents {rel_count} +{rel_incr}")
        # Imminent window
        try:
            start = chg.get('start_date')
            if start:
                dt = datetime.strptime(start[:19], '%Y-%m-%d %H:%M:%S')
                secs = (dt - datetime.utcnow()).total_seconds()
                if 0 < secs < 86400:
                    score += 10
                    factors.append('Starts <24h +10')
        except Exception:
            pass
        change_type = str(chg.get('type') or '').lower()
        if 'emergency' in change_type:
            score += 10
            factors.append('Emergency change +10')
        if str(chg.get('state') or '').lower() in ('implement', 'implementing'):
            score += 5
            factors.append('In implement state +5')
        score = min(score, 100)
        return {
            'change': chg,
            'related_incidents': related_incidents,
            'risk_score': score,
            'factors_explained': factors
        }
    except Exception as e:
        logger.error(f"[ServiceNowTools] risk_assess_change error: {e}")
        return {'error': str(e), 'change_id': change_id}


def fetch_assignment_group_load(group: str):
    try:
        group_sys = _lookup_sys_id('sys_user_group', 'name', group) or _lookup_sys_id('sys_user_group', 'sys_id', group)
        if not group_sys:
            return {'error': 'group_not_found', 'group': group}
        query = f"assignment_group={group_sys}^stateNOT IN7,8"
        fields = 'number,priority,opened_at,category'
        incidents = _table_get('incident', query, fields=fields, limit=200)
        now = datetime.utcnow()
        total = len(incidents)
        if total == 0:
            return {'group': group, 'open_incidents': 0}
        age_hours = []
        category_freq: Dict[str, int] = {}
        for inc in incidents:
            opened = inc.get('opened_at')
            try:
                if opened:
                    dt = datetime.strptime(opened[:19], '%Y-%m-%d %H:%M:%S')
                    age_hours.append((now - dt).total_seconds() / 3600.0)
            except Exception:
                pass
            cat = inc.get('category') or 'uncategorized'
            category_freq[cat] = category_freq.get(cat, 0) + 1
        avg_age = round(sum(age_hours) / len(age_hours), 2) if age_hours else 0
        top_categories = sorted(category_freq.items(), key=lambda x: x[1], reverse=True)[:5]
        return {
            'group': group,
            'group_sys_id': group_sys,
            'open_incidents': total,
            'avg_age_hours': avg_age,
            'top_categories': [{'category': c, 'count': n} for c, n in top_categories]
        }
    except Exception as e:
        logger.error(f"[ServiceNowTools] fetch_assignment_group_load error: {e}")
        return {'error': str(e), 'group': group}


def fetch_cmdb_ci_context(ci: str):
    try:
        ci_sys = _lookup_sys_id('cmdb_ci', 'name', ci) or _lookup_sys_id('cmdb_ci', 'sys_id', ci)
        if not ci_sys:
            return {'error': 'ci_not_found', 'ci': ci}
        ci_record = _table_get('cmdb_ci', f"sys_id={ci_sys}", fields='sys_id,name,sys_class_name,install_status,operational_status', limit=1)
        since = (datetime.utcnow() - timedelta(days=30)).strftime('%Y-%m-%d')
        incidents = _table_get('incident', f"cmdb_ci={ci_sys}^opened_at>={since}", fields='number,priority,state,opened_at', limit=100)
        changes = _table_get('change_request', f"cmdb_ci={ci_sys}^start_date>={since}", fields='number,state,start_date,type,risk', limit=50)
        return {
            'ci': ci_record[0] if ci_record else {'sys_id': ci_sys},
            'incident_30d_count': len(incidents),
            'recent_incidents': incidents,
            'recent_changes': changes,
            'recent_change_count': len(changes)
        }
    except Exception as e:
        logger.error(f"[ServiceNowTools] fetch_cmdb_ci_context error: {e}")
        return {'error': str(e), 'ci': ci}


def fetch_kb_articles(query: str, limit: int = 5):
    try:
        q = _sanitize_value(query)
        # Basic LIKE search; could expand to OR across short_description & text
        sysparm_query = f"active=true^short_descriptionLIKEL{q}"
        fields = 'number,short_description,sys_id,workflow_state,sys_updated_on'
        results = _table_get('kb_knowledge', sysparm_query, fields=fields, limit=limit * 2)
        # Scoring heuristic: term frequency + recency boost (decay over 30d)
        scored = []
        now = datetime.utcnow()
        q_terms = [t for t in q.lower().split() if t]
        for r in results:
            text = (r.get('short_description') or '').lower()
            tf = sum(text.count(t) for t in q_terms)
            updated = r.get('sys_updated_on')
            recency = 0.0
            try:
                if updated:
                    dt = datetime.strptime(updated[:19], '%Y-%m-%d %H:%M:%S')
                    days_old = (now - dt).days
                    recency = max(0.0, 1.0 - (days_old / 30.0))  # linear decay 0..1
            except Exception:
                pass
            score = tf * 2 + recency
            r['score'] = round(score, 4)
            scored.append(r)
        scored.sort(key=lambda x: x['score'], reverse=True)
        return {'query': query, 'results': scored[:limit]}
    except Exception as e:
        logger.error(f"[ServiceNowTools] fetch_kb_articles error: {e}")
        return {'error': str(e), 'query': query}


def run_incident_query(sysparm_query: str, fields: str = 'number,short_description,priority,state,opened_at', limit: int = 50, count_only: bool = False):
    """Execute an arbitrary (but sanitized) incident table query via sysparm_query.

    Guards / Constraints:
      - Strips potentially dangerous characters (no newlines, semicolons)
      - Enforces max length (300 chars)
      - Caps limit (<= 200)
    
    Args:
        sysparm_query: ServiceNow query string or dict with query parameters
        fields: Comma-separated field list to return
        limit: Maximum number of results
        count_only: If True, return only count without full incident data
    """
    try:
        # Handle case where sysparm_query is passed as a dict (from planner with extra args)
        if isinstance(sysparm_query, dict):
            logger.info(f"[ServiceNowTools] run_incident_query received dict: {sysparm_query}")
            # Extract parameters from dict
            count_only = sysparm_query.get('count_only', count_only)
            limit = sysparm_query.get('limit', limit)
            sysparm_query = sysparm_query.get('sysparm_query', '')
        
        if not sysparm_query:
            return {'error': 'empty_query'}
        
        # Sanitize query string
        cleaned = sysparm_query.replace('\n', ' ').replace(';', ' ').strip()
        if len(cleaned) > 300:
            cleaned = cleaned[:300]
        limit = min(max(limit, 1), 200)
        
        # Execute query
        results = _table_get('incident', cleaned, fields=fields, limit=limit)
        
        # Return count-only or full results
        if count_only:
            return {
                'query': cleaned,
                'count': len(results),
                'count_only': True
            }
        else:
            return {
                'query': cleaned,
                'count': len(results),
                'results': results
            }
    except Exception as e:
        logger.error(f"[ServiceNowTools] run_incident_query error: {e}")
        return {'error': str(e), 'query': sysparm_query}

EXTENDED_SERVICE_NOW_TOOLS = {
    'fetch_backlog_overview': fetch_backlog_overview,
    'fetch_change_records_related': fetch_change_records_related,
    'risk_assess_change': risk_assess_change,
    'fetch_assignment_group_load': fetch_assignment_group_load,
    'fetch_cmdb_ci_context': fetch_cmdb_ci_context,
    'fetch_kb_articles': fetch_kb_articles
    ,'run_incident_query': run_incident_query
}

# ---------- Additional Role-Focused Incident Management Tools (stub-friendly) ----------

def _stub_mode() -> bool:
    """Stubbing disabled; always False to enforce real API usage."""
    return False

def fetch_incident_counts_by_priority(days: int = 14):
    """Summarize open incident counts by priority in the last N days (stub if no instance)."""
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    window_start = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
    incs = _table_get('incident', f"opened_at>={window_start}^stateNOT IN" + ','.join(CLOSED_STATES), fields='number,priority,state', limit=500)
    counts: Dict[str,int] = {}
    for inc in incs:
        pr = str(inc.get('priority') or 'unknown')
        counts[pr] = counts.get(pr,0)+1
    return {'days': days, 'by_priority': counts, 'total_open_sample': sum(counts.values())}

def fetch_trending_incidents(days: int = 14, top: int = 10):
    """Return top short_description token clusters (naive frequency) for recent incidents."""
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    window_start = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
    incs = _table_get('incident', f"opened_at>={window_start}", fields='short_description', limit=800)
    freq: Dict[str,int] = {}
    for inc in incs:
        sd = (inc.get('short_description') or '').lower()
        for tok in [t for t in sd.replace('.', ' ').split() if len(t) > 3][:8]:
            freq[tok] = freq.get(tok,0)+1
    top_terms = sorted(freq.items(), key=lambda x:x[1], reverse=True)[:top]
    return {'days': days, 'top_terms': [{'term': t, 'count': c} for t,c in top_terms]}

def fetch_mean_time_to_resolution_stats(days: int = 30):
    """Compute naive MTTR (closed only) for incidents resolved in window."""
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    window_start = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
    closed_states_clause = 'stateIN' + ','.join(CLOSED_STATES) if CLOSED_STATES else ''
    incs = _table_get('incident', f"resolved_at>={window_start}^{closed_states_clause}", fields='opened_at,resolved_at', limit=500)
    total_secs = 0
    count = 0
    for inc in incs:
        o = inc.get('opened_at'); r = inc.get('resolved_at') or inc.get('resolved_at')
        try:
            if o and r:
                odt = datetime.strptime(o[:19], '%Y-%m-%d %H:%M:%S')
                rdt = datetime.strptime(r[:19], '%Y-%m-%d %H:%M:%S')
                total_secs += max(0,(rdt-odt).total_seconds()); count += 1
        except Exception:
            pass
    mttr_hours = round(total_secs/3600.0/count,2) if count else 0
    return {'days': days, 'mttr_hours': mttr_hours, 'sample': count}

def fetch_open_vs_closed_counts(days: int = 14):
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    window_start = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
    open_list = _table_get('incident', f"opened_at>={window_start}^stateNOT IN" + ','.join(CLOSED_STATES), fields='number', limit=500)
    closed_list = _table_get('incident', f"resolved_at>={window_start}^stateIN" + ','.join(CLOSED_STATES), fields='number', limit=500)
    return {'days': days, 'open': len(open_list), 'closed': len(closed_list)}

def fetch_unassigned_incidents(limit: int = 50):
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    incs = _table_get('incident', "assignment_groupISEMPTY^stateNOT IN" + ','.join(CLOSED_STATES), fields='number,short_description,priority', limit=limit)
    return {'unassigned_sample': incs, 'count': len(incs)}

def fetch_top_assignment_groups(days: int = 14, top: int = 5):
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    window_start = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
    incs = _table_get('incident', f"opened_at>={window_start}", fields='assignment_group', limit=800)
    freq: Dict[str,int] = {}
    for inc in incs:
        g = inc.get('assignment_group') or 'unknown'
        freq[g] = freq.get(g,0)+1
    ordered = sorted(freq.items(), key=lambda x:x[1], reverse=True)[:top]
    return {'days': days, 'groups': [{'group': g, 'count': c} for g,c in ordered]}

def fetch_incident_state_timeline(incident_number: str):
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    # Simplistic: just return current state & priority plus placeholder sequence; deep audit requires sys_audit table
    inc = _table_get('incident', f"number={_sanitize_value(incident_number)}", fields='number,state,priority,opened_at,sys_updated_on', limit=1)
    if not inc:
        return {'error':'not_found', 'incident': incident_number}
    return {'incident': inc[0], 'states': [{'state': inc[0].get('state'), 'ts': inc[0].get('sys_updated_on')}]}

def fetch_incident_work_notes_summary(incident_number: str):
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    notes = _table_get('sys_journal_field', f"element_idLIKE{_sanitize_value(incident_number)}^element=work_notes", fields='value,sys_created_on', limit=20)
    # naive summary: latest 3 concatenated
    excerpt = ' '.join((n.get('value') or '') for n in notes[:3])[:500]
    return {'incident': incident_number, 'latest_count': len(notes), 'work_notes_excerpt': excerpt}

def fetch_incident_attachment_list(incident_number: str):
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    # Need sys_id lookup
    inc = _table_get('incident', f"number={_sanitize_value(incident_number)}", fields='sys_id,number', limit=1)
    if not inc:
        return {'error':'not_found','incident':incident_number}
    sys_id = inc[0].get('sys_id')
    atts = _table_get('sys_attachment', f"table_sys_id={sys_id}", fields='file_name,content_type,size_bytes', limit=50)
    return {'incident': incident_number, 'attachments': atts}

def fetch_incident_assignment_history(incident_number: str):
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    # Placeholder: Would query sys_audit for assignment_group changes
    return {'incident': incident_number, 'assignments': []}

def fetch_ci_incident_density(days: int = 30, top: int = 10):
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    window_start = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
    incs = _table_get('incident', f"opened_at>={window_start}", fields='cmdb_ci', limit=1000)
    freq: Dict[str,int] = {}
    for inc in incs:
        ci = inc.get('cmdb_ci') or 'unknown'
        freq[ci] = freq.get(ci,0)+1
    ordered = sorted(freq.items(), key=lambda x:x[1], reverse=True)[:top]
    return {'days': days, 'top_ci': [{'ci': c, 'count': n} for c,n in ordered]}

def fetch_recent_failed_changes(days: int = 30, limit: int = 20):
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    window_start = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
    chgs = _table_get('change_request', f"start_date>={window_start}^state=failed", fields='number,risk,type,state,start_date', limit=limit)
    return {'days': days, 'failed_changes': chgs}

def fetch_related_commits_stub(incident_number: str, limit: int = 5):
    """Stub bridging function that simulates code commits referencing an incident number.
    Real implementation would query a code index or VCS API.
    """
    # Remove stub; until real implementation provided, return empty commit list.
    return {'incident': incident_number, 'commits': []}

def create_draft_problem_record(incident_number: str, short_description: Optional[str] = None):
    """Stub or real POST to create a draft problem linked to the incident."""
    if not _env_instance():
        raise RuntimeError('ServiceNow instance not configured')
    payload = {
        'short_description': short_description or f'Draft problem for {incident_number}',
        'u_linked_incident': incident_number
    }
    try:
        res = _sn_post('/api/now/table/problem', payload)
        return {'result': res}
    except Exception as e:
        return {'error': str(e), 'payload': payload}

# Register the new tools
NEW_TOOLS = {
    'fetch_incident_counts_by_priority': fetch_incident_counts_by_priority,
    'fetch_trending_incidents': fetch_trending_incidents,
    'fetch_mean_time_to_resolution_stats': fetch_mean_time_to_resolution_stats,
    'fetch_open_vs_closed_counts': fetch_open_vs_closed_counts,
    'fetch_unassigned_incidents': fetch_unassigned_incidents,
    'fetch_top_assignment_groups': fetch_top_assignment_groups,
    'fetch_incident_state_timeline': fetch_incident_state_timeline,
    'fetch_incident_work_notes_summary': fetch_incident_work_notes_summary,
    'fetch_incident_attachment_list': fetch_incident_attachment_list,
    'fetch_incident_assignment_history': fetch_incident_assignment_history,
    'fetch_ci_incident_density': fetch_ci_incident_density,
    'fetch_recent_failed_changes': fetch_recent_failed_changes,
    'fetch_related_commits_stub': fetch_related_commits_stub,
    'create_draft_problem_record': create_draft_problem_record
}

EXTENDED_SERVICE_NOW_TOOLS.update(NEW_TOOLS)

# Register all tools in FUNCTION_REGISTRY
from .shared_registry import FUNCTION_REGISTRY
FUNCTION_REGISTRY.update(EXTENDED_SERVICE_NOW_TOOLS)

__all__ = [
    'fetch_backlog_overview','fetch_change_records_related','risk_assess_change',
    'fetch_assignment_group_load','fetch_cmdb_ci_context','fetch_kb_articles','EXTENDED_SERVICE_NOW_TOOLS'
    ,'run_incident_query'
    ,'fetch_incident_counts_by_priority','fetch_trending_incidents','fetch_mean_time_to_resolution_stats',
    'fetch_open_vs_closed_counts','fetch_unassigned_incidents','fetch_top_assignment_groups',
    'fetch_incident_state_timeline','fetch_incident_work_notes_summary','fetch_incident_attachment_list',
    'fetch_incident_assignment_history','fetch_ci_incident_density','fetch_recent_failed_changes',
    'fetch_related_commits_stub','create_draft_problem_record'
]