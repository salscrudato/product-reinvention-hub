import os, json, time
import pytest
from components.agentic_orchestrator_auto import AgenticOrchestratorAuto


def _set_flags():
    os.environ['ENABLE_MICRO_INTENTS'] = 'true'
    os.environ['ENABLE_CONTEXT_CACHE'] = 'true'
    os.environ['ENABLE_TOKEN_METRICS'] = 'false'


def test_micro_intent_short_circuit_assignee(monkeypatch):
    _set_flags()
    orch = AgenticOrchestratorAuto()
    # Monkeypatch the fetch tool to return a deterministic incident dict
    orch.tools['fetch_servicenow_incident'] = lambda incident_number: {
        'incident_number': incident_number,
        'number': incident_number,
        'short_description': 'Test incident for assignee lookup',
        'assigned_to': 'Dev User',
        'priority': '3 - Moderate',
        'state': 'In Progress'
    }
    question = "Who is this assigned to INC0012345?"
    res1 = orch.solve([{"role":"user","content":question}], question, {}, username="tester")
    # First run builds card (cache miss expected)
    assert res1.get('cache_hit') in (False, None)
    # Second run should hit cache and short-circuit (plan empty)
    res2 = orch.solve([{"role":"user","content":question}], question, {}, username="tester")
    assert res2.get('cache_hit') is True
    assert res2.get('plan') == []
    # Card should be present either surfaced as cached_card (early return) or metadata
    assert ('cached_card' in res2) or ('incident_context_card' in res2.get('metadata', {}))


def test_cache_hit_path_priority(monkeypatch):
    _set_flags()
    orch = AgenticOrchestratorAuto()
    orch.tools['fetch_servicenow_incident'] = lambda incident_number: {
        'incident_number': incident_number,
        'number': incident_number,
        'short_description': 'Priority test incident',
        'assigned_to': 'Ops User',
        'priority': '2 - High',
        'state': 'New'
    }
    question = "What is the priority for INC0099999?"
    res1 = orch.solve([{"role":"user","content":question}], question, {}, username="tester2")
    assert res1.get('cache_hit') in (False, None)
    res2 = orch.solve([{"role":"user","content":question}], question, {}, username="tester2")
    assert res2.get('cache_hit') is True
    assert res2.get('plan') == []


def test_token_metrics_endpoint_basic(client, monkeypatch):
    # Dynamically register agentic blueprint (token_metrics) on the existing test app
    from components import agentic_orchestrator_api as aoa
    try:
        client.application.register_blueprint(aoa.agentic_blueprint)
    except Exception:
        pass  # ignore if already registered
    os.environ['ENABLE_TOKEN_METRICS'] = 'true'
    from tinydb import TinyDB
    db = TinyDB('state_db.json')
    tu = db.table('token_usage')
    tu.insert({'username':'tester','timestamp': time.time(), 'total_tokens': 123, 'baseline_estimate': 200, 'savings_tokens': 77, 'cost_usd': 0.00123})
    rv = client.get('/token_metrics?limit=5')
    assert rv.status_code == 200
    payload = rv.get_json()
    assert payload['enabled'] is True
    assert 'aggregate' in payload
    assert payload['aggregate']['total_tokens'] >= 123
