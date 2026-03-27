from components.user_context_tools import synthesize_user_incident_fix_plan
from components.persona_registry import PERSONA_DEFS


def test_synthesize_user_incident_fix_plan_stub():
    res = synthesize_user_incident_fix_plan(username='dev_user', limit=3)
    # Should always return structure
    assert 'incidents' in res
    # In stub mode we expect at least one incident (fallback samples). If zero, that's a failure.
    assert len(res['incidents']) > 0, 'Expected synthetic incidents in stub mode'
    for inc in res['incidents']:
        assert 'incident' in inc
        # fix_suggestion may appear when dev tools registered; allow history only path too
        assert any(k in inc for k in ('fix_suggestion','history'))

