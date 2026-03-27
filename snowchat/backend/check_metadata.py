from tinydb import TinyDB

db = TinyDB('incidents_metadata.json')
records = db.table('incidents').all()
print(f'Total records in metadata: {len(records)}')

if records:
    print(f'\nSample records (first 3):')
    for r in records[:3]:
        print(f"  - {r.get('number')}: {r.get('short_description', '')[:60]}")
    
    # Check for incident_number vs number field
    has_incident_number = any('incident_number' in r for r in records)
    has_number = any('number' in r for r in records)
    print(f'\nField check: has_incident_number={has_incident_number}, has_number={has_number}')

db.close()
