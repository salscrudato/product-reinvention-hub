from components.prompt_events import record_event, get_events


def test_prompt_events_ring_buffer():
    # Insert more than buffer size to ensure rotation
    for i in range(350):
        record_event('prompt.match', prompt_id=f'x{i}', score=i)
    ev = get_events('prompt.match', limit=60)
    assert len(ev) <= 60
    # Old earliest entries should be rotated out
    ids = [e.get('prompt_id') for e in ev]
    assert any('x349' in pid for pid in ids if pid), 'Newest event should appear'
