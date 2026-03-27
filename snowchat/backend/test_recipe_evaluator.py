from components.recipe_evaluator import evaluate_recipe


def test_incident_triage_pass():
    outputs = {
        'fetch_servicenow_incident': {'number': 'INC001'},
        'get_similar_incidents': [{'number': 'INC0002'}]
    }
    res = evaluate_recipe('incident_triage', outputs)
    assert res['passed'] is True


def test_incident_triage_fail_needs_similarity_or_kb():
    outputs = { 'fetch_servicenow_incident': {'number': 'INC001'} }
    res = evaluate_recipe('incident_triage', outputs)
    assert res['passed'] is False
    assert 'context_similarity_or_kb' in res['gaps']


def test_change_risk_missing_score():
    outputs = { 'risk_assess_change': {'foo': 'bar'} }
    res = evaluate_recipe('change_risk', outputs)
    assert res['passed'] is False
    assert 'risk_assess_change' in res['gaps']
