from components.servicenowgenaitool import query_incidents_by_date_core
import json

result = query_incidents_by_date_core(start_date='2026-01-06', end_date='2026-01-27', limit=100)
print('Total incidents:', result.get('total_count'))
incidents = result.get('incidents', [])

if incidents:
    print('\nFirst incident with assignment details:')
    first = incidents[0]
    print(json.dumps({
        'number': first.get('number'),
        'short_description': first.get('short_description'),
        'assigned_to': first.get('assigned_to'),
        'assignment_group': first.get('assignment_group'),
        'opened_at': first.get('opened_at')
    }, indent=2))
    
    # Check if we get display values or sys_ids
    assigned_to = first.get('assigned_to')
    if isinstance(assigned_to, dict):
        print('\n✓ assigned_to is a dict with display_value:', assigned_to.get('display_value'))
    elif assigned_to and len(str(assigned_to)) == 32:
        print('\n✗ assigned_to is still a sys_id:', assigned_to)
    else:
        print('\n? assigned_to format:', type(assigned_to), assigned_to)

print(f"\nStatus: {result.get('status')}")
