from components.servicenowgenaitool import query_incidents_by_date_core

result = query_incidents_by_date_core(start_date='2026-01-06', end_date='2026-01-27', limit=100)
print('Total incidents:', result.get('total_count'))
incidents = result.get('incidents', [])
print('\nFirst 10 incidents:')
for i in incidents[:10]:
    print(f"  {i.get('number')}: {i.get('opened_at')} - {i.get('short_description')}")

print(f"\nQuery params: {result.get('query_params')}")
print(f"Status: {result.get('status')}")
