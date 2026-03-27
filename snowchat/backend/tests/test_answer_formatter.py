import os
from backend.components.answer_formatter import format_answer

def test_format_answer_basic():
    md = {
        'rolling_summary': 'User asked about incident INC0000001 and then workaround.',
        'conversation_context': {'summary': 'Condensed', 'incident_number': 'INC0000001', 'token_savings_estimate': 120},
        'incident_context_card': {'number': 'INC0000001', 'short_description': 'Email outage', 'state': 'Open', 'priority': '1'}
    }
    tool_outputs = {
        'fetch_servicenow_incident': {'number': 'INC0000001', 'short_description': 'Email outage', 'priority': '1', 'state': 'Open'},
        'get_similar_incidents': [
            {'number': 'INC0000002', 'short_description': 'Email delay'},
            {'number': 'INC0000003', 'short_description': 'VPN issue'}
        ]
    }
    out = format_answer('What is status?', 'Status is Open', md, tool_outputs)
    assert '## Question' in out
    assert '## Answer' in out
    assert 'INC0000001' in out
    assert 'fetch_servicenow_incident' in out


def test_format_answer_empty():
    out = format_answer('', '', {}, {})
    assert out.strip() == ''

