from components.servicenowgenaitool import query_incidents_by_date_core

result = query_incidents_by_date_core(start_date='2026-01-06', end_date='2026-01-27', limit=100)
incidents = result.get('incidents', [])

print('All 13 incidents with assignment info:\n')
for i in incidents:
    assigned = i.get('assigned_to') or '(unassigned)'
    group = i.get('assignment_group') or '(no group)'
    print(f"{i.get('number')}: {i.get('short_description')[:50]}")
    print(f"  → Assigned to: {assigned}, Group: {group}\n")
