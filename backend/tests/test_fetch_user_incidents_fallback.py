import os
import types
from backend.components import user_context_tools as uct


def test_fallback_attempts_when_user_not_found(monkeypatch):
    """Ensure fallback path populates attempts metadata when sys_id lookup fails.
    We monkeypatch _lookup_sys_id to always return None and _table_get to return empty
    so we exercise the zero-result fallback with attempts recorded.
    """
    # Force real path (pretend instance configured) but neutralize network.
    monkeypatch.setenv('SERVICENOW_INSTANCE', 'https://example.service-now.com')

    # Patch lookup to always miss
    monkeypatch.setattr(uct, '_lookup_sys_id', lambda *a, **k: None, raising=True)
    # Patch table get to record queries but return no incidents
    calls = []
    def fake_table_get(table, query, fields=None, limit=10, order=None):  # noqa: D401
        calls.append((table, query))
        return []
    monkeypatch.setattr(uct, '_table_get', fake_table_get, raising=True)

    resp = uct.fetch_user_incidents('Display Name Only', limit=3)
    assert resp['count'] == 0
    assert resp.get('warning') in ('user_not_found', 'user_sys_id_not_found_fallback_used')
    # Fallback attempts should be present
    attempts = resp.get('fallback_attempts') or resp.get('attempted')
    assert attempts, resp
    # Ensure queries used configured fallback fields
    # At least one query should contain assigned_to.name or assigned_to.user_name
    assert any('assigned_to.name' in c[1] or 'assigned_to.user_name' in c[1] for c in calls)


def test_negative_cache_short_circuits(monkeypatch):
    monkeypatch.setenv('SERVICENOW_INSTANCE', 'https://example.service-now.com')
    monkeypatch.setattr(uct, '_lookup_sys_id', lambda *a, **k: None, raising=True)
    calls = {'table_get': 0}
    def fake_table_get(table, query, fields=None, limit=10, order=None):
        calls['table_get'] += 1
        return []
    monkeypatch.setattr(uct, '_table_get', fake_table_get, raising=True)

    # First call populates negative cache
    uct.fetch_user_incidents('Ghost User', limit=2)
    first_calls = calls['table_get']
    assert first_calls > 0
    # Second call should hit neg cache and not invoke table_get again
    resp2 = uct.fetch_user_incidents('Ghost User', limit=2)
    assert calls['table_get'] == first_calls  # no increment
    assert resp2.get('note') == 'neg_cache'
