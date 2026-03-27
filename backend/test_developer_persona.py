from components.plan_recipes import build_recipe

def test_developer_incident_triage_recipe_includes_run_incident_query():
    q = "Investigate incident INC0099999 performance lag"
    meta = {'intent': 'incident_triage'}
    recipe = build_recipe('incident_triage', 'developer', q, meta)
    assert recipe is not None, "Expected a recipe for incident_triage"
    tools = [s['tool'] for s in recipe]
    assert 'run_incident_query' in tools
    assert 'fetch_change_records_related' in tools


def test_developer_log_analysis_recipe():
    q = "Analyze these logs for errors"  # triggers log_analysis intent externally
    meta = {'intent': 'log_analysis'}
    recipe = build_recipe('log_analysis', 'developer', q, meta)
    assert recipe is not None, "Expected a recipe for log_analysis"
    tools = [s['tool'] for s in recipe]
    assert tools[0] == 'generate_splunk_query'
    assert 'run_incident_query' in tools  # extension appended
