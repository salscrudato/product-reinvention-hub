import pytest

from components.persona_registry import PERSONA_DEFS

def test_developer_persona_includes_advanced_tools():
    dev = PERSONA_DEFS.get('developer')
    assert dev, 'developer persona missing'
    tools = dev['tools']
    expected = {
        'fetch_incident_resolution_history','fetch_related_pull_requests','map_error_signature_to_ci_density',
        'search_design_docs','fetch_recent_commits_for_ci','suggest_fix_from_history',
        'fetch_pull_request_diff','analyze_pr_change_risk','correlate_incident_with_recent_prs','propose_code_patch_stub'
    }
    missing = expected - tools
    assert not missing, f"developer persona missing tools: {missing}"
