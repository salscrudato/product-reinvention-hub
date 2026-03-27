import types
from components import servicenow_extended_tools as ext

class DummyResp:
    def __init__(self, json_data):
        self._json = json_data
    def json(self):
        return self._json
    def raise_for_status(self):
        return

# Monkeypatch helper

def patch_table(monkeypatch, table_results_map):
    def fake_table_get(table, query, fields=None, limit=10, order=None):
        key = (table, query)
        return table_results_map.get(key, [])
    monkeypatch.setattr(ext, '_table_get', fake_table_get)


def test_fetch_backlog_overview(monkeypatch):
    incidents = [
        {'number': 'INC1', 'priority': '1', 'opened_at': '2025-09-20 10:00:00'},
        {'number': 'INC2', 'priority': '2', 'opened_at': '2025-09-10 09:00:00'},
        {'number': 'INC3', 'priority': '2', 'opened_at': '2025-09-01 09:00:00'}
    ]
    patch_table(monkeypatch, {('incident', 'stateNOT IN7,8^opened_at>=2025-09-09'): incidents})
    res = ext.fetch_backlog_overview(days=14)
    assert res['by_priority']['1'] == 1
    assert res['by_priority']['2'] == 2
    assert res['total_sampled'] == 3


def test_risk_assess_change(monkeypatch):
    change = [{'number': 'CHG1', 'priority': '2', 'risk': 'high', 'start_date': '2025-09-24 10:00:00', 'type': 'emergency', 'cmdb_ci': 'CI123'}]
    related_incidents = [
        {'number': 'INC10', 'priority': '3', 'state': 'In Progress', 'opened_at': '2025-09-15 10:00:00'}
    ]
    table_map = {
        ('change_request', 'number=CHG1'): change,
        ('incident', 'cmdb_ci=CI123^opened_at>=2025-08-25'): related_incidents
    }
    patch_table(monkeypatch, table_map)
    res = ext.risk_assess_change('CHG1')
    assert res['risk_score'] > 0
    assert res['related_incidents']


def test_fetch_kb_articles(monkeypatch):
    kb_results = [
        {'number': 'KB001', 'short_description': 'Email outage workaround', 'sys_id': '1', 'workflow_state': 'published', 'sys_updated_on': '2025-09-22 12:00:00'},
        {'number': 'KB002', 'short_description': 'General email info', 'sys_id': '2', 'workflow_state': 'published', 'sys_updated_on': '2025-08-01 12:00:00'}
    ]
    def fake_table_get(table, query, fields=None, limit=10, order=None):
        if table == 'kb_knowledge':
            return kb_results
        return []
    monkeypatch.setattr(ext, '_table_get', fake_table_get)
    res = ext.fetch_kb_articles('email outage', limit=1)
    assert res['results'][0]['number'] == 'KB001'


def test_run_incident_query(monkeypatch):
    sample = [
        {'number': 'INC100', 'short_description': 'Email outage', 'priority': '2', 'state': 'In Progress', 'opened_at': '2025-09-20 10:00:00'}
    ]
    def fake_table_get(table, query, fields=None, limit=10, order=None):
        assert table == 'incident'
        assert 'priority=2' in query
        return sample
    monkeypatch.setattr(ext, '_table_get', fake_table_get)
    res = ext.run_incident_query('priority=2^state!=7', limit=5)
    assert res['count'] == 1
    assert res['results'][0]['number'] == 'INC100'


def test_run_incident_query_count_only(monkeypatch):
    sample = [
        {'number': 'INC100', 'short_description': 'Email outage'},
        {'number': 'INC101', 'short_description': 'Network down'}
    ]
    def fake_table_get(table, query, fields=None, limit=10, order=None):
        assert table == 'incident'
        return sample
    monkeypatch.setattr(ext, '_table_get', fake_table_get)
    res = ext.run_incident_query('priority=1', limit=10, count_only=True)
    assert res['count'] == 2
    assert res['count_only'] is True
    assert 'results' not in res


def test_run_incident_query_dict_parameter(monkeypatch):
    """Test when planner passes dict as first argument (e.g., from _args_incident_count)"""
    sample = [
        {'number': 'INC100', 'short_description': 'Test incident'}
    ]
    def fake_table_get(table, query, fields=None, limit=10, order=None):
        assert table == 'incident'
        assert 'stateIN1,2,3,4,5' in query
        return sample
    monkeypatch.setattr(ext, '_table_get', fake_table_get)
    
    # Simulate what the planner does when passing dict with extra parameters
    res = ext.run_incident_query({'sysparm_query': 'stateIN1,2,3,4,5', 'limit': 1, 'count_only': True})
    assert res['count'] == 1
    assert res['count_only'] is True
    assert 'results' not in res
