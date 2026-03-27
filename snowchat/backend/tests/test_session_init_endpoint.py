import json
from components.agentic_orchestrator_api import agentic_blueprint
from app import app as flask_app

def test_session_init_basic(monkeypatch):
    client = flask_app.test_client()
    # No token, no metadata -> default product_owner
    resp = client.post('/session/init', json={'user_id': 'u1'})
    data = json.loads(resp.data.decode())
    assert data['persona'] in ('product_owner','engineering_lead','developer')  # default order may pick product_owner
    assert 'greeting' in data


def test_session_init_token_override(monkeypatch):
    # Craft a simple HS256 token recognized as engineering_lead
    import jwt, os
    secret = 'devsecret'
    monkeypatch.setenv('KEYCLOAK_PUBLIC_KEY', secret)
    payload = {
        'iss': os.getenv('KEYCLOAK_EXPECTED_ISS','http://localhost:8080/realms/demo'),
        'aud': os.getenv('KEYCLOAK_AUDIENCE','snowchat'),
        'realm_access': {'roles': ['eng_lead']}
    }
    token = jwt.encode(payload, secret, algorithm='HS256')
    client = flask_app.test_client()
    resp = client.post('/session/init', headers={'Authorization': f'Bearer {token}'}, json={'user_id':'u2'})
    data = json.loads(resp.data.decode())
    assert data['persona'] == 'engineering_lead'
    assert data['source'] == 'token'


def test_session_init_explicit_metadata(monkeypatch):
    client = flask_app.test_client()
    resp = client.post('/session/init', json={'user_id': 'u3', 'metadata': {'persona':'developer'}})
    data = json.loads(resp.data.decode())
    assert data['persona'] == 'developer'
    assert data['source'] == 'explicit'
