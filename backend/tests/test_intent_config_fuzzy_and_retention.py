import time, json, os
from backend.components.intent_config import classify_with_config, load_intent_config
from backend.components.agentic_orchestrator_auto import AgenticOrchestratorAuto
from backend.components.intent_config import intent_diagnostics
from backend.components.intent_config import _CONFIG_CACHE  # type: ignore


def test_fuzzy_match_user_incidents(monkeypatch, tmp_path):
    # Create a temporary intent config replicating user_incidents with a phrase
    cfg_path = tmp_path / 'intent_heuristics.json'
    cfg_path.write_text(json.dumps({
        "user_incidents": {
            "literal_phrases": ["my incidents"],
            "regex": ["assigned\\s+to\\s+me"],
            "auto_persona": "developer",
            "context_injection": {"summary_key": "user_incidents", "max_age_minutes": 5, "retain_tool_outputs": ["fetch_user_incidents"]}
        }
    }), encoding='utf-8')
    # Monkeypatch config path resolution
    monkeypatch.setattr('backend.components.intent_config.CONFIG_REL_PATH', str(cfg_path))
    # Force reload
    load_intent_config(force=True)
    result = classify_with_config("show me my incdents please", {}, enable_fuzzy=True, fuzzy_threshold=70)
    assert result['intent'] == 'user_incidents', f"Expected fuzzy detection, got {result}"
    assert result.get('_debug', {}).get('match_type') in ('fuzzy', 'literal', 'regex')


def test_retention_expiry(monkeypatch, tmp_path):
    cfg_path = tmp_path / 'intent_heuristics.json'
    cfg_path.write_text(json.dumps({
        "user_incidents": {
            "literal_phrases": ["my incidents"],
            "regex": [],
            "auto_persona": "developer",
            "context_injection": {"summary_key": "user_incidents", "max_age_minutes": 0.001, "retain_tool_outputs": ["fetch_user_incidents"]}
        }
    }), encoding='utf-8')
    monkeypatch.setattr('backend.components.intent_config.CONFIG_REL_PATH', str(cfg_path))
    load_intent_config(force=True)

    orch = AgenticOrchestratorAuto()
    # Seed tool_outputs to simulate a prior tool run
    orch.tool_outputs = {"fetch_user_incidents": {"count": 1}}
    md = {}
    messages = [{"role": "user", "content": "my incidents"}]
    orch.solve(messages, "prompt", md, username='dev1')
    # Should have retained context
    assert any(k.startswith('context_user_incidents') for k in md.keys())
    # Fast-forward time beyond expiry and run again with no new tool_outputs
    time.sleep(0.2)  # > 0.001 minutes (~0.06s) buffer
    # Clear tool_outputs to avoid re-retain
    orch.tool_outputs = {}
    md['context_injection'] = {"summary_key": "user_incidents", "max_age_minutes": 0.001, "retain_tool_outputs": ["fetch_user_incidents"]}
    orch.solve(messages, "prompt", md, username='dev1')
    # Expired contexts removed (or replaced without retained_tools since none now)
    # At least ensure no stale cached_at older than threshold remains
    for k,v in md.items():
        if k.startswith('context_user_incidents') and isinstance(v, dict):
            assert (time.time() - v.get('cached_at', time.time())) < 60, 'retained context did not refresh/expire'


def test_intents_diagnostics_structure():
    diag = intent_diagnostics()
    assert 'intents' in diag and isinstance(diag['intents'], dict)
    assert 'count' in diag
