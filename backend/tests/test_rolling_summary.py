import os
import pytest
from components.rolling_summary import RollingConversationSummarizer


def test_rolling_summary_basic():
    rs = RollingConversationSummarizer(max_chars=200)
    history = [
        {'role':'user','content':'Need help with INC0012345 error on login.'},
        {'role':'assistant','content':'INC0012345 appears related to authentication.'},
        {'role':'user','content':'Any workaround for INC0012345? It blocks QA.'},
        {'role':'assistant','content':'Try resetting the SSO configuration for INC0012345.'},
    ]
    out = rs.update(history)
    assert 'INC0012345' in out['summary']
    assert out['token_savings_estimate'] >= 0
    assert out['turns_included'] == 4


def test_rolling_summary_compression():
    rs = RollingConversationSummarizer(max_chars=120)
    # Create verbose history
    history = []
    for i in range(15):
        inc_id = f'INC00{9990 + i}'  # deterministic sequential ids INC009990, INC009991, ...
        history.append({'role':'user','content':f'Loop {i} discussing {inc_id} with lots of extra details that should compress.'})
        history.append({'role':'assistant','content':f'Response {i} referencing {inc_id} and some analysis here.'})
    out = rs.update(history)
    assert out['turns_included'] == 12  # capped
    assert len(out['summary']) <= 120
    # Ensure incidents preserved
    assert 'INC009990' in out['summary'] or 'INC009991' in out['summary']
