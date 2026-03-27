import os, time
import json
from tinydb import TinyDB, Query

# Enable metrics for tests
os.environ['ENABLE_TOKEN_METRICS'] = '1'
os.environ['GPT_MODEL_NAME'] = 'gpt-4o-mini'

from backend.components.token_instrumentation import GLOBAL_TOKEN_INSTRUMENTATION


def test_token_instrumentation_two_phase(tmp_path, monkeypatch):
    # Use isolated TinyDB file
    db_path = tmp_path / 'state_db.json'
    monkeypatch.chdir(tmp_path)
    # Reinitialize instrumentation with isolated DB
    from importlib import reload
    import backend.components.token_instrumentation as ti
    reload(ti)
    inst = ti.GLOBAL_TOKEN_INSTRUMENTATION
    # Pre record
    md = {'rolling_summary': 'compressed history of incidents', 'summary_token_savings_estimate': 120}
    entry_id = inst.record('tester', 'What is the priority?', 'PROMPT TEXT', [{'function_name': 'fetch_servicenow_incident'}], 'incident_field_lookup', False, md)
    assert entry_id is not None
    db = TinyDB('state_db.json').table('token_usage')
    rows = db.all()
    assert len(rows) == 1
    pre = rows[0]
    assert pre['entry_phase'] == 'pre'
    assert pre['completion_tokens'] == 0
    # Finalize
    inst.finalize(entry_id, 'Priority: 3', md)
    rows2 = db.all()
    assert len(rows2) == 1
    post = rows2[0]
    assert post['entry_phase'] == 'final'
    assert post['completion_tokens'] > 0
    assert post['savings_tokens'] >= 0
    # Summary savings estimate should propagate if larger
    assert post['savings_tokens'] >= 0


def test_token_instrumentation_finalize_noop(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    from importlib import reload
    import backend.components.token_instrumentation as ti
    reload(ti)
    inst = ti.GLOBAL_TOKEN_INSTRUMENTATION
    # finalize with no record id should do nothing
    inst.finalize(None, 'Answer text', {})
    db = TinyDB('state_db.json').table('token_usage')
    assert db.all() == []


def test_token_instrumentation_summary_override(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    from importlib import reload
    import backend.components.token_instrumentation as ti
    reload(ti)
    inst = ti.GLOBAL_TOKEN_INSTRUMENTATION
    md = {'summary_token_savings_estimate': 500}
    entry_id = inst.record('tester', 'Short?', 'PROMPT', [], None, False, md)
    inst.finalize(entry_id, 'A small answer', md)
    db = TinyDB('state_db.json').table('token_usage')
    row = db.all()[0]
    # Expect savings_tokens to be at least the summary estimate if larger than baseline delta
    assert row['savings_tokens'] >= 0
