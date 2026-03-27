from components.intent_classifier import classify_intent


def test_intent_similar_incidents():
    assert classify_intent("Show me similar incidents to this one") == 'similar_incidents'


def test_intent_workaround():
    assert classify_intent("Need a workaround for email failure") == 'workaround_lookup'


def test_intent_incident_triage_default():
    # Contains 'incident' so should map to incident_triage
    assert classify_intent("Incident INC0012345 is slow when loading") == 'incident_triage'
