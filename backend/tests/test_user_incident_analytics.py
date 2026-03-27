import os
from backend.components import user_context_tools as uct


def ensure_stub():
    if 'SERVICENOW_INSTANCE' in os.environ:
        del os.environ['SERVICENOW_INSTANCE']


def test_fetch_user_incidents_direct_stub():
    ensure_stub()
    resp = uct.fetch_user_incidents_direct('dev1', limit=10)
    assert resp['count'] > 0
    assert resp.get('stub')


def test_user_incident_status_counts_stub():
    ensure_stub()
    resp = uct.user_incident_status_counts('dev1')
    assert resp['total'] >= resp['by_state'].get('2', 0)


def test_user_incident_priority_counts_stub():
    ensure_stub()
    resp = uct.user_incident_priority_counts('dev1')
    assert 'by_priority' in resp
    # severity mapping for sample priorities 2/3
    assert 'sig2' in resp['by_severity'] or 'sig3' in resp['by_severity']


def test_user_incident_trend_stub():
    ensure_stub()
    resp = uct.user_incident_trend('dev1', days=30)
    assert 'daily_opened_counts' in resp


def test_user_incident_similar_suggestions_graceful_without_tool():
    ensure_stub()
    # ensure similar tool not registered
    if 'get_similar_incidents' in uct.FUNCTION_REGISTRY:
        del uct.FUNCTION_REGISTRY['get_similar_incidents']
    resp = uct.user_incident_similar_suggestions('dev1')
    assert resp.get('note') == 'similar_tool_unavailable'


def test_user_incident_workaround_suggestions_graceful_without_tool():
    ensure_stub()
    if 'workaround_lookup' in uct.FUNCTION_REGISTRY:
        del uct.FUNCTION_REGISTRY['workaround_lookup']
    resp = uct.user_incident_workaround_suggestions('dev1')
    assert resp.get('note') == 'workaround_tool_unavailable'
