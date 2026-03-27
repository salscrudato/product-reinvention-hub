"""User context and personalization tools.

Provides tools that interpret "my" / user-scoped queries so the orchestrator can
ground plans in the logged-in user's incident workload. Operates in stub mode
when ServiceNow not configured.
"""
from __future__ import annotations
from typing import Dict, Any, List, Tuple
import os, logging, datetime
from .shared_registry import FUNCTION_REGISTRY
try:  # optional import of internal SN helpers
    from .servicenow_extended_tools import _table_get, _sanitize_value, CLOSED_STATES  # type: ignore
except Exception:  # pragma: no cover
    _table_get = None  # type: ignore
    _sanitize_value = lambda x: x  # type: ignore
    CLOSED_STATES = ['7','8']  # default

logger = logging.getLogger("agentic_orchestrator_auto.user_context")

def _assigned_to_field() -> str:
    """Resolve the configured assigned-to field dynamically each call.

    Allows runtime changes (env reloaded) and prevents stale import-time capture.
    Defaults to 'assigned_to' if not set.
    """
    return os.getenv('SERVICENOW_ASSIGNED_TO_FIELD', 'assigned_to')

# Optional elevated logging (INFO level) for query construction when DEBUG not enabled
_UC_QUERY_LOG = os.getenv('USER_CONTEXT_QUERY_LOG', '').lower() in ('1','true','yes','on')

# Configurable fallback fields for display-name style lookup (dot‑walk). If not explicitly set, derive from
# the configured ASSIGNED_TO field so custom casing like 'Assigned_To' propagates automatically.
def _fallback_fields() -> List[str]:
    base = _assigned_to_field()
    env_val = os.getenv('SERVICENOW_USER_FALLBACK_FIELDS', f'{base}.user_name,{base}.name')
    return [f.strip() for f in env_val.split(',') if f.strip()]

# Negative lookup cache (username -> expiry timestamp) to avoid spamming ServiceNow when a user is absent
_NEG_LOOKUP_CACHE: Dict[str, float] = {}  # retained for backwards compatibility (now unused)
_NEG_TTL = 0  # effectively disabled

# Normalization cache mapping display name -> canonical user_name
_USER_NAME_NORMALIZATION_CACHE: Dict[str, Tuple[str, float]] = {}
_NORM_TTL = 300  # seconds

"""ServiceNow instance environment capture.

Previously this module captured SERVICENOW_INSTANCE at import time which made
tests that mutate os.environ (e.g. deleting SERVICENOW_INSTANCE to force stub
mode) unreliable because the cached value kept the module in "real" mode.

We now resolve the environment dynamically on each call so test isolation and
runtime changes are respected.
"""

def _current_instance() -> str | None:  # lightweight accessor
    return os.getenv('SERVICENOW_INSTANCE')

def _stub_mode() -> bool:
    """Stubbing disabled: always return False to enforce real API usage.

    If the instance is not configured, downstream calls will raise instead of silently stubbing.
    """
    return False

_SAMPLE_INCIDENTS: List[Dict[str, Any]] = []  # legacy placeholder removed (no stubbing)

def _normalize_assignee_field(incs: List[Dict[str, Any]]) -> None:
    """Ensure each incident dict exposes a lowercase 'assigned_to' key even if a custom / cased field is configured.

    We only mutate if custom field differs case-sensitively and 'assigned_to' absent. This keeps downstream tools
    (and existing tests) stable while allowing SERVICENOW_ASSIGNED_TO_FIELD like 'Assigned_To'.
    """
    at_field = _assigned_to_field()
    if at_field == 'assigned_to':
        return
    for inc in incs:
        if 'assigned_to' not in inc and at_field in inc:
            try:
                inc['assigned_to'] = inc.get(at_field)
            except Exception:  # pragma: no cover
                pass

def fetch_user_incidents(username: str, state: str = 'open', limit: int = 20) -> Dict[str, Any]:
    """Return incidents assigned to the given user using direct username-based queries (no sys_id lookup).

    Strategy:
      1. Try {Assigned_To_Field}.user_name=<username>
      2. If under limit, try direct {Assigned_To_Field}=<username> (some instances allow matching user_name directly)
      3. Optionally (if space present) try display name variants (first token) via .name=<first>

    Stubbing is disabled. If the ServiceNow instance is not configured or API errors occur, they surface.
    """
    if not username:
        inferred = os.getenv('CURRENT_USERNAME')
        if inferred:
            username = inferred
        else:
            return {'error': 'username required'}
    if not _table_get:
        return {'error': 'servicenow_not_configured'}
    at_field = _assigned_to_field()
    base_state_clause = 'stateNOT IN' + ','.join(CLOSED_STATES) if state == 'open' else ''
    # Build only direct field equality query (no dot-walk variants per updated requirement)
    queries: List[str] = ['^'.join([c for c in [f"{at_field}={_sanitize_value(username)}", base_state_clause] if c])]
    results: List[Dict[str, Any]] = []
    seen = set()
    fields = f'number,short_description,priority,state,assignment_group,{at_field}'
    for q in queries:
        if _UC_QUERY_LOG:
            logger.info(f"[user_context][query] direct_multi field={at_field} q={q}")
        try:
            incs = _table_get('incident', q, fields=fields, limit=limit)
        except Exception as e:  # pragma: no cover
            logger.warning(f"[user_context] incident query failed q='{q}': {e}")
            incs = []
        for inc in incs:
            num = inc.get('number')
            if num and num not in seen:
                results.append(inc); seen.add(num)
        if len(results) >= limit:
            break
    _normalize_assignee_field(results)
    return {'username': username, 'state': state, 'count': len(results), 'incidents': results[:limit], 'query_mode': 'direct_username'}


# Legacy fallback removed: direct multi-query strategy in fetch_user_incidents supersedes this.
def _fallback_incident_query(username: str, state: str, limit: int, note: str | None = None) -> Dict[str, Any]:  # pragma: no cover
    return {'username': username, 'state': state, 'count': 0, 'incidents': [], 'note': 'fallback_removed'}

def suggest_user_incident_closure_actions(username: str, limit: int = 5, include_pr_correlation: bool = True) -> Dict[str, Any]:
    """Generate heuristic closure suggestions for user's active incidents.

    Leverages fetch_user_incidents (stub or real) and produces per-incident action hints.
    """
    base = fetch_user_incidents(username=username, state='open', limit=limit)
    incidents = base.get('incidents') or []
    correlate_fn = FUNCTION_REGISTRY.get('correlate_incident_with_recent_prs') if include_pr_correlation else None
    suggestions: List[Dict[str, Any]] = []
    for inc in incidents:
        sd = (inc.get('short_description') or '').lower()
        actions = []
        if 'timeout' in sd:
            actions.append('Review recent PRs touching service timeouts and add instrumentation for latency segments.')
        if 'null pointer' in sd:
            actions.append('Add defensive None guards and create unit test reproducing the loader path.')
        if 'cache' in sd:
            actions.append('Validate cache key cardinality & add jitter to refresh to prevent stampede.')
        if not actions:
            actions.append('Retrieve similar incidents and compare applied workarounds.')
        suggestion: Dict[str, Any] = {
            'incident': inc.get('number'),
            'short_description': inc.get('short_description'),
            'priority': inc.get('priority'),
            'candidate_actions': actions[:3]
        }
        if correlate_fn and inc.get('number'):
            try:
                corr = correlate_fn(incident_number=inc.get('number'))
                ranked = (corr or {}).get('related_prs_ranked') or []
                suggestion['related_prs'] = ranked[:3]
            except Exception:
                pass
        suggestions.append(suggestion)
    return {'username': username, 'generated_at': datetime.datetime.utcnow().isoformat()+'Z', 'suggestions': suggestions}


def synthesize_user_incident_fix_plan(username: str, limit: int = 5) -> Dict[str, Any]:
    """Composite tool: gather user's incidents then enrich with resolution + PR correlation + fix hints.

    Returns a ranked list (priority asc, then presence of PR correlations).
    """
    base = fetch_user_incidents(username=username, limit=limit)
    is_stub = False
    incidents = base.get('incidents') or []
    hist_fn = FUNCTION_REGISTRY.get('fetch_incident_resolution_history')
    fix_fn = FUNCTION_REGISTRY.get('suggest_fix_from_history')
    corr_fn = FUNCTION_REGISTRY.get('correlate_incident_with_recent_prs')
    enriched: List[Dict[str, Any]] = []
    for inc in incidents:
        inc_no = inc.get('number')
        record: Dict[str, Any] = {'incident': inc_no, 'short_description': inc.get('short_description'), 'priority': inc.get('priority')}
        if hist_fn and inc_no:
            try:
                record['history'] = hist_fn(incident_number=inc_no)
            except Exception:
                pass
        if corr_fn and inc_no:
            try:
                corr = corr_fn(incident_number=inc_no)
                record['related_prs'] = corr.get('related_prs_ranked')[:5] if isinstance(corr, dict) else []
            except Exception:
                record['related_prs'] = []
        if fix_fn and inc_no:
            try:
                # Provide error_snippet None for now (future: feed from logs)
                record['fix_suggestion'] = fix_fn(incident_number=inc_no, error_snippet=None)
            except Exception:
                pass
        enriched.append(record)
    # Ranking: lower priority number first, then number of related PRs desc
    def _p(val):
        try:
            return int(val) if val not in (None, '') else 999
        except Exception:
            return 999
    enriched.sort(key=lambda r: (_p(r.get('priority')), -len(r.get('related_prs') or [])))
    return {'username': username, 'count': len(enriched), 'incidents': enriched, 'stub': is_stub}

FUNCTION_REGISTRY.update({
    'fetch_user_incidents': fetch_user_incidents,
    'suggest_user_incident_closure_actions': suggest_user_incident_closure_actions,
    'synthesize_user_incident_fix_plan': synthesize_user_incident_fix_plan
})

# ---------------- Additional User Incident Analytics & Enrichment Tools ----------------

def fetch_user_incidents_direct(username: str, limit: int = 50, state: str = 'open') -> Dict[str, Any]:
    """Direct dot-walk query for incidents assigned to a user (by user_name or name) without sys_user sys_id lookup.

        This implements a ServiceNow style query equivalent to:
            /api/now/table/incident?{_ASSIGNED_TO_FIELD}.user_name=<u>&sysparm_limit=...

    In real mode uses _table_get. In stub mode returns filtered _SAMPLE_INCIDENTS. Honors SERVICENOW_ASSIGNED_TO_FIELD.
    """
    if not username:
        return {'error': 'username required'}
    if not _table_get:
        return {'error': 'servicenow_not_configured'}
    at_field = _assigned_to_field()
    fields = f'number,short_description,priority,state,assignment_group,{at_field},opened_at'
    clauses = []
    # Prefer user_name then fallback to display name – gather union (two queries if needed)
    results: List[Dict[str, Any]] = []
    seen = set()
    def _do(q: str):
        try:
            incs = _table_get('incident', q, fields=fields, limit=limit) if _table_get else []
        except Exception as e:  # pragma: no cover
            logger.warning(f"[user_context] direct fetch query failed query='{q}': {e}")
            incs = []
        added = 0
        for inc in incs:
            num = inc.get('number')
            if num and num not in seen:
                results.append(inc); seen.add(num); added += 1
        return added
    base_state_clause = 'stateNOT IN' + ','.join(CLOSED_STATES) if state == 'open' else ''
    # Direct only (no .user_name dot-walk)
    q1 = '^'.join([c for c in [f"{at_field}={_sanitize_value(username)}", base_state_clause] if c])
    if _UC_QUERY_LOG:
        logger.info(f"[user_context][direct_query] q1={q1}")
    _do(q1)
    # No secondary name/dot-walk query per updated requirement
    _normalize_assignee_field(results)
    return {'username': username, 'state': state, 'count': len(results), 'incidents': results[:limit], 'query_mode': 'direct'}


def diagnose_user_incident_lookup(username: str) -> Dict[str, Any]:
    """Diagnostic tool to expose configuration & lookup attempts without performing full incident queries.

    Returns:
      - assigned_to_field
      - fallback_fields
      - stub_mode
      - negative_cache (hit / expires_in)
      - normalization_cache_entry
      - candidate_user_name_variants & sys_id lookup results (user_name then name)
    """
    now_ts = datetime.datetime.utcnow().timestamp()
    neg_expiry = _NEG_LOOKUP_CACHE.get(username)
    neg = None
    if neg_expiry:
        remaining = max(0, int(neg_expiry - now_ts))
        neg = {'active': neg_expiry > now_ts, 'expires_in_seconds': remaining}
    norm_entry = _USER_NAME_NORMALIZATION_CACHE.get(username)
    normalization = None
    if norm_entry:
        normalization = {'canonical_user_name': norm_entry[0], 'age_seconds': int(now_ts - norm_entry[1])}

    # Generate candidate variants from full name (simple heuristics) for debugging only
    parts = [p for p in username.strip().split() if p]
    variants = []
    if parts:
        first = parts[0]; last = parts[-1]
        variants.extend({username, username.lower(), f"{first}.{last}", f"{first}{last}", f"{first[0]}{last}"})
    variants = [v for v in dict.fromkeys([v for v in variants if v])]

    lookup_attempts: List[Dict[str, Any]] = []
    # sys_id lookup removed (direct strategy)
    lookup_attempts = []

    return {
        'username': username,
    'assigned_to_field': _assigned_to_field(),
    'fallback_fields': _fallback_fields(),
    'stub_mode': False,
        'negative_cache': neg,
        'normalization_cache': normalization,
        'candidate_variants': variants,
        'variant_sys_id_attempts': lookup_attempts,
        'query_logging_enabled': _UC_QUERY_LOG
    }


def user_incident_status_counts(username: str, state: str = 'open') -> Dict[str, Any]:
    """Return counts grouped by state for incidents assigned to user.

    In stub mode derives from _SAMPLE_INCIDENTS.
    """
    data = fetch_user_incidents_direct(username=username, limit=200, state=state)
    incidents = data.get('incidents', [])
    counts: Dict[str, int] = {}
    for inc in incidents:
        st = str(inc.get('state') or 'unknown')
        counts[st] = counts.get(st, 0) + 1
    return {'username': username, 'state_filter': state, 'by_state': counts, 'total': sum(counts.values())}


def user_incident_priority_counts(username: str, state: str = 'open') -> Dict[str, Any]:
    data = fetch_user_incidents_direct(username=username, limit=200, state=state)
    incidents = data.get('incidents', [])
    counts: Dict[str, int] = {}
    for inc in incidents:
        pr = str(inc.get('priority') or 'unknown')
        counts[pr] = counts.get(pr, 0) + 1
    # Map to severity labels (sig1/sig2/...) heuristically
    severity_map = {'1': 'sig1', '2': 'sig2', '3': 'sig3'}
    severity_counts: Dict[str, int] = {}
    for pr, c in counts.items():
        sev = severity_map.get(pr)
        if sev:
            severity_counts[sev] = severity_counts.get(sev, 0) + c
    return {'username': username, 'state_filter': state, 'by_priority': counts, 'by_severity': severity_counts}


def user_incident_trend(username: str, days: int = 14) -> Dict[str, Any]:
    """Simple opened_at daily bucket counts (only for incidents currently assigned)."""
    data = fetch_user_incidents_direct(username=username, limit=500, state='all')
    incidents = data.get('incidents', [])
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    buckets: Dict[str, int] = {}
    for inc in incidents:
        opened = inc.get('opened_at')
        try:
            if opened:
                dt = datetime.datetime.strptime(opened[:19], '%Y-%m-%d %H:%M:%S')
                if dt >= cutoff:
                    key = dt.strftime('%Y-%m-%d')
                    buckets[key] = buckets.get(key, 0) + 1
        except Exception:
            pass
    ordered = dict(sorted(buckets.items()))
    return {'username': username, 'days': days, 'daily_opened_counts': ordered}


def user_incident_similar_suggestions(username: str, per_incident: int = 2, incident_limit: int = 5) -> Dict[str, Any]:
    """For user's current incidents, fetch similar incidents (uses existing get_similar_incidents tool if registered)."""
    base = fetch_user_incidents_direct(username=username, limit=incident_limit, state='open')
    incidents = base.get('incidents', [])
    sim_fn = FUNCTION_REGISTRY.get('get_similar_incidents')
    suggestions: List[Dict[str, Any]] = []
    if not sim_fn:
        return {'username': username, 'incident_count': base.get('count'), 'similar': [], 'note': 'similar_tool_unavailable'}
    for inc in incidents:
        num = inc.get('number')
        if not num:
            continue
        try:
            sim = sim_fn(incident_number=num)  # type: ignore
            related = (sim or {}).get('similar_incidents') or []
            suggestions.append({'incident': num, 'similar_sample': related[:per_incident]})
        except Exception:  # pragma: no cover
            suggestions.append({'incident': num, 'similar_sample': [], 'error': 'similar_lookup_failed'})
    return {'username': username, 'incident_count': base.get('count'), 'similar': suggestions}


def user_incident_workaround_suggestions(username: str, per_incident: int = 1, incident_limit: int = 5) -> Dict[str, Any]:
    wa_fn = FUNCTION_REGISTRY.get('workaround_lookup')
    base = fetch_user_incidents_direct(username=username, limit=incident_limit, state='open')
    incidents = base.get('incidents', [])
    if not wa_fn:
        return {'username': username, 'incident_count': base.get('count'), 'workarounds': [], 'note': 'workaround_tool_unavailable'}
    out: List[Dict[str, Any]] = []
    for inc in incidents:
        num = inc.get('number')
        try:
            wa = wa_fn(incident_number=num)  # type: ignore
            sample = (wa or {}).get('workarounds') or []
            out.append({'incident': num, 'workaround_sample': sample[:per_incident]})
        except Exception:  # pragma: no cover
            out.append({'incident': num, 'workaround_sample': [], 'error': 'workaround_lookup_failed'})
    return {'username': username, 'incident_count': base.get('count'), 'workarounds': out}


FUNCTION_REGISTRY.update({
    'fetch_user_incidents_direct': fetch_user_incidents_direct,
    'user_incident_status_counts': user_incident_status_counts,
    'user_incident_priority_counts': user_incident_priority_counts,
    'user_incident_trend': user_incident_trend,
    'user_incident_similar_suggestions': user_incident_similar_suggestions,
    'user_incident_workaround_suggestions': user_incident_workaround_suggestions,
    'diagnose_user_incident_lookup': diagnose_user_incident_lookup
})

try:
    __all__  # type: ignore  # noqa: F821
except NameError:  # pragma: no cover
    __all__ = []  # type: ignore

__all__.extend([
    'fetch_user_incidents_direct','user_incident_status_counts','user_incident_priority_counts',
    'user_incident_trend','user_incident_similar_suggestions','user_incident_workaround_suggestions'
])

__all__ = ['fetch_user_incidents', 'suggest_user_incident_closure_actions', 'synthesize_user_incident_fix_plan']