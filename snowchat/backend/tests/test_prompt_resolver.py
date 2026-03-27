from components.prompt_resolver import resolve_prompt


def test_prompt_resolver_match_developer():
    metadata = {}
    res = resolve_prompt("Please triage this incident and find similar kb articles", "developer", metadata)
    # Should either match or fall back; if match expect fields
    if res.get('matched'):
        assert 'prompt_id' in res
        conf = res.get('confidence')
        assert conf is not None
        assert isinstance(conf, (int, float))
        assert conf >= 0
        assert isinstance(res.get('tool_hints'), list)
    else:
        assert 'reason' in res


def test_prompt_resolver_below_threshold_behavior():
    metadata = {}
    # Question intentionally minimal to reduce keyword hits
    res = resolve_prompt("incident", "developer", metadata)
    if not res.get('matched'):
        assert res.get('reason') in ('below_threshold','no_active_entries','no_score','feature_disabled')
