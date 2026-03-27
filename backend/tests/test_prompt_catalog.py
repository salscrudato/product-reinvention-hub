import os, json, time
from components.prompt_catalog import get_all, get_active, catalog_health, normalize_persona


def test_prompt_catalog_basic_load():
    entries = get_all()
    assert isinstance(entries, list)
    assert any('id' in e for e in entries), 'Catalog should have entries with id'


def test_prompt_catalog_active_filter():
    all_entries = get_all()
    dev_active = get_active('developer')
    assert all(isinstance(e, dict) for e in dev_active)
    for e in dev_active:
        assert e.get('enabled') and e.get('status') == 'active'
    # wildcard persona should include * entries
    wildcard = get_active(None)
    assert len(wildcard) >= len(dev_active)


def test_prompt_catalog_health_snapshot():
    health = catalog_health()
    assert 'prompt_count' in health and health['prompt_count'] >= 1
    assert 'active_count' in health
    assert 'path' in health


def test_normalize_persona_alias():
    assert normalize_persona('product_owner') == 'business_owner'


def test_business_owner_login_prompt_available():
    business_prompts = get_active('business_owner')
    intents = {entry.get('intent') for entry in business_prompts}
    assert 'login_governance' in intents
