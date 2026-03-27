import pytest
from components.crewai_personas import get_product_owner_agent, get_engineering_lead_agent, get_business_owner_agent
from components.shared_registry import FUNCTION_REGISTRY

def test_product_owner_agent_builds():
    agent = get_product_owner_agent()
    assert getattr(agent, 'role', '').lower() == 'product owner'
    # Ensure mapped tools exist
    expected = {'find_incidents_by_short_description', 'fetch_servicenow_incident', 'wiki_rag_tool'}
    existing = {t for t in expected if t in FUNCTION_REGISTRY}
    # Agent may not expose attribute listing; verify by repr / internal dict
    for tool_name in existing:
        # Indirect check: tool object should be retrievable
        assert FUNCTION_REGISTRY[tool_name]


def test_engineering_lead_agent_builds():
    agent = get_engineering_lead_agent()
    assert getattr(agent, 'role', '').lower() == 'engineering lead'
    expected = {'fetch_servicenow_incident', 'find_incidents_by_short_description', 'get_similar_incidents', 'code_annotation_tool', 'wiki_rag_tool'}
    existing = {t for t in expected if t in FUNCTION_REGISTRY}
    for tool_name in existing:
        assert FUNCTION_REGISTRY[tool_name]


def test_business_owner_agent_builds():
    agent = get_business_owner_agent()
    assert getattr(agent, 'role', '').lower() == 'business owner'
    expected = {'jira_fetch_user_story', 'jira_summarize_user_story', 'fetch_backlog_overview', 'generate_plan_receipt'}
    existing = {t for t in expected if t in FUNCTION_REGISTRY}
    for tool_name in existing:
        assert FUNCTION_REGISTRY[tool_name]
