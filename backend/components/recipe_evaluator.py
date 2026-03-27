from typing import Dict, Any, List, Tuple


def _has_nonempty(val: Any) -> bool:
    if val is None:
        return False
    if isinstance(val, (list, tuple, set, dict)):
        return len(val) > 0
    if isinstance(val, str):
        return val.strip() != ''
    return True


def evaluate_recipe(intent: str, tool_outputs: Dict[str, Any]) -> Dict[str, Any]:
    """Return evaluation dict: {passed: bool, gaps: [..], reasons: [..]}.
    Gaps are semantic requirement labels; reasons are explanatory strings.
    """
    gaps: List[str] = []
    reasons: List[str] = []

    def need(label: str, reason: str):
        gaps.append(label)
        reasons.append(reason)

    # Convenience fetchers
    g = tool_outputs.get

    if intent == 'incident_triage':
        if not _has_nonempty(g('fetch_servicenow_incident')):
            need('fetch_servicenow_incident', 'Incident details missing or empty')
        sim_ok = _has_nonempty(g('get_similar_incidents'))
        kb_ok = _has_nonempty(g('fetch_kb_articles'))
        wiki_ok = _has_nonempty(g('wiki_rag_tool'))
        # If wiki_only_context flag is set, require wiki instead of KB
        # Otherwise require either similar incidents or KB context
        if not (sim_ok or kb_ok or wiki_ok):
            need('context_similarity_or_kb', 'Need similar incidents, KB context, or wiki context')
    elif intent == 'similar_incidents':
        if not _has_nonempty(g('get_similar_incidents')):
            need('get_similar_incidents', 'Similarity results empty')
    elif intent == 'workaround_lookup':
        if not _has_nonempty(g('workaround_lookup')) and not _has_nonempty(g('get_similar_incidents')):
            need('workaround_or_similar', 'No workaround or similarity context obtained')
    elif intent == 'knowledge_lookup':
        if not _has_nonempty(g('fetch_kb_articles')):
            need('fetch_kb_articles', 'KB search returned nothing')
    elif intent == 'change_risk':
        chg = g('risk_assess_change') or {}
        if not isinstance(chg, dict) or 'risk_score' not in chg:
            need('risk_assess_change', 'Risk score missing')
    elif intent == 'assignment_load':
        if 'open_incidents' not in (g('fetch_assignment_group_load') or {}):
            need('fetch_assignment_group_load', 'Assignment group load missing')
    elif intent == 'cmdb_context':
        ci = g('fetch_cmdb_ci_context') or {}
        if 'ci' not in ci:
            need('fetch_cmdb_ci_context', 'CI context missing')
    elif intent == 'release_notes':
        if 'by_priority' not in (g('fetch_backlog_overview') or {}):
            need('fetch_backlog_overview', 'Backlog overview incomplete')
    elif intent == 'backlog_grooming':
        if 'by_priority' not in (g('fetch_backlog_overview') or {}):
            need('fetch_backlog_overview', 'Backlog overview missing')
    elif intent == 'log_analysis':
        if not _has_nonempty(g('splunk_query')) and not _has_nonempty(g('run_incident_query')):
            need('splunk_or_incident_query', 'No log or incident query results')
    elif intent == 'documentation_gap':
        wiki_ok = _has_nonempty(g('wiki_rag_tool'))
        kb_ok = _has_nonempty(g('fetch_kb_articles'))
        # If wiki_only_context is set, only require wiki
        # Otherwise require either wiki or KB
        if not (wiki_ok or kb_ok):
            need('kb_or_wiki', 'No KB or wiki context to assess gaps')
    elif intent == 'story_quality':
        if 'by_priority' not in (g('fetch_backlog_overview') or {}):
            need('fetch_backlog_overview', 'Backlog data missing')
        if not _has_nonempty(g('fetch_kb_articles')):
            need('fetch_kb_articles', 'KB reference absent')

    passed = len(gaps) == 0
    return {
        'passed': passed,
        'gaps': gaps,
        'reasons': reasons
    }

__all__ = ['evaluate_recipe']