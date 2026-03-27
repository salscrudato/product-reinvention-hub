import pytest
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from components.generic_tool_orchestrator import app
import json

@pytest.fixture
def client():
    app.testing = True
    with app.test_client() as client:
        yield client


def test_feedback_post_valid(client):
    payload = {
        "user_id": "test-integration-1",
        "username": "Integration Test",
        "question": "Summary of INC0000001?",
        "liked": True,
        "function_sequence": [{"function_name": "fetch_servicenow_incident", "arguments": {"incident_number": "INC0000001"}}]
    }
    resp = client.post('/generic_tool_orchestrator/function_sequence_feedback', data=json.dumps(payload), content_type='application/json')
    assert resp.status_code == 200
    data = resp.get_json()
    assert "Feedback recorded" in (data.get('message') or data.get('error') or '')


def test_feedback_post_missing_fields(client):
    payload = {
        "username": "Missing Fields",
        "liked": True
    }
    resp = client.post('/generic_tool_orchestrator/function_sequence_feedback', data=json.dumps(payload), content_type='application/json')
    assert resp.status_code == 400
    data = resp.get_json()
    assert data.get('error') == 'user_id and question are required.'
