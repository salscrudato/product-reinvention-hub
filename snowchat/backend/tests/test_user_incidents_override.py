from backend.components.persona_resolution import determine_persona
from backend.components.user_context_tools import fetch_user_incidents
import os


def test_session_persona_override_for_ownership_phrase():
    persona, source = determine_persona(metadata=None, token=None, question='What are the incidents assigned to me?', stored_session_persona='product_owner')
    assert persona == 'developer', f"Expected developer persona override, got {persona} from {source}"


def test_fetch_user_incidents_infers_username_from_env(monkeypatch):
    monkeypatch.setenv('CURRENT_USERNAME', 'dev1')
    resp = fetch_user_incidents(username='', limit=2)
    assert resp.get('username') == 'dev1'
    cnt = resp.get('count')
    assert isinstance(cnt, int) and cnt >= 0