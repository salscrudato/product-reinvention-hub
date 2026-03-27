from components.plan_recipes import build_recipe


def test_incident_triage_recipe_engineering_lead():
    question = "Please investigate incident INC0012345 and give me context"
    meta = {'intent': 'incident_triage'}
    recipe = build_recipe('incident_triage', 'engineering_lead', question, meta)
    assert recipe is not None, "Expected a recipe for incident_triage"
    tools = [s['tool'] for s in recipe]
    assert tools[0] == 'fetch_servicenow_incident'
    assert 'fetch_assignment_group_load' in tools  # engineering_lead extension


def test_change_risk_recipe_product_owner():
    question = "What is risk for change CHG0010002?"
    recipe = build_recipe('change_risk', 'product_owner', question, {'intent':'change_risk'})
    assert recipe is not None, "Expected a recipe for change_risk"
    tools = [s['tool'] for s in recipe]
    assert tools[0] == 'fetch_change_records_related'
    assert tools[1] == 'risk_assess_change'
