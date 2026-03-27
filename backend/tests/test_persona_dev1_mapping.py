import os
from backend.components.persona_resolution import determine_persona
from backend.components.keycloak_persona import map_roles_to_persona
from backend.components.user_context_tools import fetch_user_incidents


def test_map_roles_developer():
    persona = map_roles_to_persona(['developer'])
    assert persona == 'developer'


def test_fetch_user_incidents_stub_dev1():
    # Ensure stub mode (no instance configured)
    if 'SERVICENOW_INSTANCE' in os.environ:
        del os.environ['SERVICENOW_INSTANCE']
    resp = fetch_user_incidents(username='dev1', limit=3)
    assert resp['username'] == 'dev1'
    assert resp['count'] > 0
    assert all(inc['assigned_to'] == 'dev1' for inc in resp['incidents'])


def test_heuristic_persona_for_dev1_incidents_phrase():
    persona, source = determine_persona(metadata=None, token=None, question='show dev1 incidents', stored_session_persona=None)
    assert persona == 'developer', f"expected developer got {persona} from {source}"