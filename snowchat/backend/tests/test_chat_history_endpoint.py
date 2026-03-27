import json
import pytest
import os
from tinydb import TinyDB

def test_chat_history_get_and_filter(client):
    # Prepare TinyDB with known entries
    db_path = os.path.join(os.path.dirname(__file__), '..', 'state_db.json')
    db = TinyDB(db_path)
    chat_table = db.table('chat_history')
    # Clear any existing for determinism
    chat_table.truncate()

    entries = [
        {"sender": "user", "text": "Hello", "username": "alice"},
        {"sender": "server", "text": "Response A", "username": "alice"},
        {"sender": "user", "text": "Question B", "username": "bob"}
    ]
    for e in entries:
        chat_table.insert(e)

    # Prefer the prefixed chat_history used by the test app, but accept either path
    resp = client.get('/generic_tool_orchestrator/chat_history')
    if resp.status_code == 404:
        resp = client.get('/chat_history')
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data.get('chat_history'), list)
    assert len(data['chat_history']) >= 3

    # Filter by username alice (use prefixed path under test app)
    resp2 = client.get('/generic_tool_orchestrator/chat_history?username=alice')
    assert resp2.status_code == 200
    data2 = resp2.get_json()
    assert all(item.get('username') == 'alice' for item in data2.get('chat_history', []))
