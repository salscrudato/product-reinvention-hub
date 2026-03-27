"""Developer-focused advanced incident tools.

These tools extend the developer persona capability for deep incident resolution
in a Property & Casualty insurance Quote & Buy platform context. They operate in
"stub mode" unless the relevant environment variables are configured:

  GITHUB_REPO (e.g. org/repo)
  GITHUB_TOKEN (optional; increases rate limit)
  SERVICENOW_INSTANCE + auth (for real ServiceNow ops)

They are designed to answer the top practical developer questions:
  1. What exactly happened (incident details / resolution history)?
  2. Has something like this happened before (similar + work notes)?
  3. What code changed recently that may relate (commits / PRs referencing incident or CI)?
  4. Which configuration items / services are most impacted (error signature -> CI mapping)?
  5. Are there relevant design / runbook docs (design doc search)?
  6. What past fixes worked (summarize patterns)?
  7. Provide a draft fix recommendation grounded in history.

All functions return JSON-serializable dictionaries and log at DEBUG/INFO levels.
"""
from __future__ import annotations
from typing import Dict, Any, List, Optional
import os, re, logging, datetime, requests
from .shared_registry import FUNCTION_REGISTRY
from .servicenow_extended_tools import (
    fetch_incident_work_notes_summary,
    fetch_related_commits_stub,
    fetch_ci_incident_density,
    run_incident_query,
)

logger = logging.getLogger("agentic_orchestrator_auto.dev_tools")

SERVICENOW_INSTANCE = os.getenv('SERVICENOW_INSTANCE')
GITHUB_REPO = os.getenv('GITHUB_REPO')
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN')

def _github_headers():
    h = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return h

def _stub_mode() -> bool:
    return not bool(SERVICENOW_INSTANCE)

def fetch_incident_resolution_history(incident_number: str) -> Dict[str, Any]:
    """Return (stub or real) close code / close notes & latest work notes summary."""
    if _stub_mode():
        logger.debug(f"[dev_tools] stub fetch_incident_resolution_history incident={incident_number}")
        return {
            'incident': incident_number,
            'close_code': 'Solved (Work Around)',
            'close_notes': 'Restarted underwriting rules engine. Root cause: stale cache.',
            'work_notes_summary': fetch_incident_work_notes_summary(incident_number)
        }
    # Real path would query incident table for close_code, close_notes
    try:
        # Reuse run_incident_query sanitized path
        q = f"number={incident_number}"
        res = run_incident_query(q, fields='number,close_code,close_notes', limit=1)
        first = None
        results_obj = res.get('results') if isinstance(res, dict) else None
        if isinstance(results_obj, list) and results_obj:
            candidate = results_obj[0]
            if isinstance(candidate, dict):
                first = candidate
        first = first or {}
        return {
            'incident': incident_number,
            'close_code': first.get('close_code'),
            'close_notes': first.get('close_notes'),
            'work_notes_summary': fetch_incident_work_notes_summary(incident_number)
        }
    except Exception as e:  # pragma: no cover (network)
        logger.error(f"[dev_tools] resolution_history error incident={incident_number} err={e}")
        return {'error': str(e), 'incident': incident_number}

def fetch_related_pull_requests(incident_number: str, limit: int = 10) -> Dict[str, Any]:
    """Search GitHub PRs whose title or body mention the incident number."""
    if not GITHUB_REPO:
        logger.debug(f"[dev_tools] stub fetch_related_pull_requests incident={incident_number}")
        return {
            'incident': incident_number,
            'stub': True,
            'prs': [
                {'number': 1234, 'title': f'Hotfix for {incident_number} cache issue', 'merged': True},
                {'number': 1250, 'title': f'Refactor service impacted by {incident_number}', 'merged': False}
            ][:limit]
        }
    try:
        # GitHub code/PR search rate-limited; use issues search endpoint (PRs are issues with pull_request key)
        url = 'https://api.github.com/search/issues'
        query = f"repo:{GITHUB_REPO} {incident_number} in:title,body type:pr"
        params = {'q': query, 'per_page': limit}
        resp = requests.get(url, headers=_github_headers(), params=params, timeout=25)
        resp.raise_for_status()
        data = resp.json()
        items = data.get('items', [])
        prs = []
        for it in items:
            prs.append({
                'number': it.get('number'),
                'title': it.get('title'),
                'state': it.get('state'),
                'merged': it.get('pull_request', {}).get('merged_at') is not None,
                'html_url': it.get('html_url')
            })
        return {'incident': incident_number, 'prs': prs}
    except Exception as e:  # pragma: no cover
        logger.error(f"[dev_tools] related_pull_requests error incident={incident_number} err={e}")
        return {'error': str(e), 'incident': incident_number}

def map_error_signature_to_ci_density(error_snippet: str, days: int = 14) -> Dict[str, Any]:
    """Find incidents containing the error snippet and return CI occurrence density (stub friendly)."""
    if _stub_mode():
        logger.debug("[dev_tools] stub map_error_signature_to_ci_density")
        return {'error_snippet': error_snippet, 'days': days, 'ci_density': [{'ci':'PolicySvc','count':4},{'ci':'RatingSvc','count':2}]}
    # Real: run incident LIKE query then feed to fetch_ci_incident_density or group counts manually.
    pattern = re.sub(r"[^A-Za-z0-9 ]", " ", error_snippet)[:40]
    query = f"short_descriptionLIKE{pattern}^ORdescriptionLIKE{pattern}"
    sample = run_incident_query(query, fields='number,cmdb_ci', limit=200)
    freq: Dict[str,int] = {}
    for row in sample.get('results', []) if isinstance(sample, dict) else []:
        if isinstance(row, dict):
            ci = row.get('cmdb_ci') or 'unknown'
            freq[ci] = freq.get(ci, 0) + 1
    ordered = sorted(freq.items(), key=lambda x:x[1], reverse=True)
    return {'error_snippet': error_snippet, 'days': days, 'ci_density': [{'ci': c, 'count': n} for c,n in ordered]}

def search_design_docs(query: str, limit: int = 5) -> Dict[str, Any]:
    """Wrap wiki_rag_tool (if registered) to emphasize design/runbook retrieval."""
    tool = FUNCTION_REGISTRY.get('wiki_rag_tool')
    if not tool:
        logger.debug("[dev_tools] wiki_rag_tool missing; returning stub")
        return {'query': query, 'results': [], 'stub': True}
    try:
        raw = tool(query=query)  # expect dict
        return {'query': query, 'design_docs': raw}
    except Exception as e:
        logger.error(f"[dev_tools] search_design_docs error {e}")
        return {'error': str(e), 'query': query}

def fetch_recent_commits_for_ci(ci: str, limit: int = 5) -> Dict[str, Any]:
    """Stub commits referencing a CI name (likely service identifier)."""
    if not GITHUB_REPO:
        logger.debug(f"[dev_tools] stub fetch_recent_commits_for_ci ci={ci}")
        return {'ci': ci, 'stub': True, 'commits': [
            {'sha':'a1b2c3d', 'message': f'Improve retry logic in {ci}'},
            {'sha':'d4e5f6g', 'message': f'Fix timeout issue in {ci} adapter'}
        ][:limit]}
    try:  # simple search across commits via issues search is limited; placeholder
        return {'ci': ci, 'commits': []}
    except Exception as e:  # pragma: no cover
        logger.error(f"[dev_tools] recent_commits_for_ci error ci={ci} err={e}")
        return {'error': str(e), 'ci': ci}

def suggest_fix_from_history(incident_number: str, error_snippet: Optional[str] = None) -> Dict[str, Any]:
    """Heuristic suggestion using resolution history + related commits (no LLM call here; summarization stub)."""
    hist = fetch_incident_resolution_history(incident_number)
    commits = fetch_related_commits_stub(incident_number)
    resolution = hist.get('close_notes') or ''
    patterns = []
    if 'cache' in resolution.lower():
        patterns.append('Consider validating distributed cache invalidation and TTL configuration.')
    if error_snippet and 'timeout' in error_snippet.lower():
        patterns.append('Investigate upstream dependency latency & circuit breaker thresholds.')
    if not patterns:
        patterns.append('Review recent related commits and compare configuration against prior resolved incidents.')
    return {
        'incident': incident_number,
        'error_context': error_snippet,
        'historical_close_code': hist.get('close_code'),
        'candidate_actions': patterns,
        'related_commits': commits.get('commits')
    }

# Register tools
NEW_DEV_TOOLS = {
    'fetch_incident_resolution_history': fetch_incident_resolution_history,
    'fetch_related_pull_requests': fetch_related_pull_requests,
    'map_error_signature_to_ci_density': map_error_signature_to_ci_density,
    'search_design_docs': search_design_docs,
    'fetch_recent_commits_for_ci': fetch_recent_commits_for_ci,
    'suggest_fix_from_history': suggest_fix_from_history
}

# --- Additional advanced PR + code level tools ---
def fetch_pull_request_diff(pr_number: int) -> Dict[str, Any]:
    """Return changed file list (stubbed unless GitHub repo configured)."""
    if not GITHUB_REPO:
        logger.debug(f"[dev_tools] stub fetch_pull_request_diff pr={pr_number}")
        return {'pr_number': pr_number, 'stub': True, 'files': [
            {'filename': 'services/rating/engine.py', 'additions': 22, 'deletions': 3},
            {'filename': 'libs/cache/client.py', 'additions': 5, 'deletions': 1}
        ]}
    try:  # pragma: no cover (network)
        url = f"https://api.github.com/repos/{GITHUB_REPO}/pulls/{pr_number}/files"
        resp = requests.get(url, headers=_github_headers(), timeout=25)
        resp.raise_for_status()
        files = []
        for f in resp.json():
            files.append({
                'filename': f.get('filename'),
                'status': f.get('status'),
                'additions': f.get('additions'),
                'deletions': f.get('deletions'),
                'changes': f.get('changes')
            })
        return {'pr_number': pr_number, 'files': files}
    except Exception as e:
        logger.error(f"[dev_tools] fetch_pull_request_diff error pr={pr_number} err={e}")
        return {'error': str(e), 'pr_number': pr_number}

def analyze_pr_change_risk(pr_number: int) -> Dict[str, Any]:
    diff = fetch_pull_request_diff(pr_number)
    files = diff.get('files', [])
    file_count = len(files)
    total_add = sum(f.get('additions', 0) for f in files)
    total_del = sum(f.get('deletions', 0) for f in files)
    heuristics = []
    if file_count > 15 or (total_add + total_del) > 800:
        heuristics.append('High surface area change')
    if any('config' in (f.get('filename') or '') for f in files):
        heuristics.append('Contains configuration modifications')
    if any('migration' in (f.get('filename') or '').lower() for f in files):
        heuristics.append('Schema / migration present')
    risk_level = 'low'
    if heuristics:
        risk_level = 'medium'
    if 'High surface area change' in heuristics:
        risk_level = 'high'
    return {'pr_number': pr_number, 'file_count': file_count, 'total_additions': total_add,
            'total_deletions': total_del, 'risk_level': risk_level, 'risk_factors': heuristics}

def correlate_incident_with_recent_prs(incident_number: str, limit: int = 5) -> Dict[str, Any]:
    prs = fetch_related_pull_requests(incident_number, limit=limit).get('prs', [])
    # simple scoring: merged PRs +1, title contains 'fix' +1
    scored = []
    for pr in prs:
        score = 0
        title = (pr.get('title') or '').lower()
        if pr.get('merged'):
            score += 1
        if 'fix' in title:
            score += 1
        scored.append({**pr, 'score': score})
    scored.sort(key=lambda x: x['score'], reverse=True)
    return {'incident': incident_number, 'related_prs_ranked': scored}

def propose_code_patch_stub(incident_number: str, file_path: str, error_snippet: str | None = None) -> Dict[str, Any]:
    """Return a hypothetical patch suggestion (no real analysis yet)."""
    rationale = []
    if error_snippet and 'timeout' in error_snippet.lower():
        rationale.append('Observed timeout pattern; increasing circuit breaker threshold and adding retry with jitter.')
    rationale.append('Derived from similar incident resolutions that modified cache invalidation logic.')
    patch = f"# Suggested fix for {incident_number} in {file_path}\n# TODO: validate logic paths and add unit tests.\n"
    return {'incident': incident_number, 'file': file_path, 'rationale': rationale, 'suggested_patch': patch, 'stub': True}

ADDITIONAL_DEV_TOOLS = {
    'fetch_pull_request_diff': fetch_pull_request_diff,
    'analyze_pr_change_risk': analyze_pr_change_risk,
    'correlate_incident_with_recent_prs': correlate_incident_with_recent_prs,
    'propose_code_patch_stub': propose_code_patch_stub
}

FUNCTION_REGISTRY.update(ADDITIONAL_DEV_TOOLS)

NEW_DEV_TOOLS.update(ADDITIONAL_DEV_TOOLS)

FUNCTION_REGISTRY.update(NEW_DEV_TOOLS)

__all__ = [
    'fetch_incident_resolution_history',
    'fetch_related_pull_requests',
    'map_error_signature_to_ci_density',
    'search_design_docs',
    'fetch_recent_commits_for_ci',
    'suggest_fix_from_history',
    'fetch_pull_request_diff',
    'analyze_pr_change_risk',
    'correlate_incident_with_recent_prs',
    'propose_code_patch_stub'
]