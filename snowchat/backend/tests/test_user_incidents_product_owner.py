from backend.components.plan_recipes import build_recipe

def test_product_owner_can_run_user_incidents_recipe():
    steps = build_recipe('user_incidents', 'product_owner', 'What are the incidents assigned to me?', {'username':'po1'})
    assert steps, 'Recipe expected for user_incidents intent'
    tool_names = [s['tool'] for s in steps]
    assert 'fetch_user_incidents' in tool_names, tool_names
    assert 'suggest_user_incident_closure_actions' in tool_names, tool_names
