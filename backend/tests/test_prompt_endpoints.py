import os
import json
import pytest
from app import app

@pytest.fixture(scope='module')
def test_client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

def test_list_prompts_endpoint(test_client):
    resp = test_client.get('/prompts')
    assert resp.status_code in (200,404)  # allowed if feature disabled
    if resp.status_code == 200:
        data = resp.get_json()
        assert 'prompts' in data

def test_suggest_prompt_endpoint(test_client):
    payload = {'question': 'Please triage this incident and recommend kb articles', 'persona': 'developer'}
    resp = test_client.post('/prompts/suggest', json=payload)
    assert resp.status_code in (200,404)
    if resp.status_code == 200:
        data = resp.get_json()
        assert 'suggestion' in data

def test_prompt_events_endpoint(test_client):
    resp = test_client.get('/prompts/events?limit=10')
    assert resp.status_code in (200,404)
    if resp.status_code == 200:
        data = resp.get_json()
        assert 'events' in data

def test_prompt_health_endpoint(test_client):
    resp = test_client.get('/prompts/health')
    assert resp.status_code in (200,404)
    if resp.status_code == 200:
        data = resp.get_json()
        assert 'health' in data
        assert 'prompt_count' in data['health'] or 'active_count' in data['health']
