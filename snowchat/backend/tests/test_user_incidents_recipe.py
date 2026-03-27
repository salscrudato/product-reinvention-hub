from components.plan_recipes import build_recipe
from components.persona_registry import PERSONA_DEFS


def test_user_incidents_recipe_basic():
    metadata = {"persona": "developer", "username": "dev_user"}
    recipe = build_recipe('user_incidents', 'developer', 'Show my incidents', metadata)
    assert recipe, 'Recipe should be built'
    tools = [s['tool'] for s in recipe]
    assert tools[0] == 'fetch_user_incidents'
    assert 'suggest_user_incident_closure_actions' in tools

