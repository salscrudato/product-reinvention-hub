"""Check if TinyDB has incident details"""
from tinydb import TinyDB

db = TinyDB('state_db.json')
tables = db.tables()

print(f"Available tables: {tables}")
print()

if 'incidents' in tables:
    incidents_table = db.table('incidents')
    all_incidents = incidents_table.all()
    print(f"Incidents in TinyDB: {len(all_incidents)}")
    
    if all_incidents:
        sample = all_incidents[0]
        print(f"\nSample incident fields:")
        for key in sample.keys():
            print(f"  - {key}")
        
        # Check for rich fields
        has_work_notes = 'work_notes' in sample
        has_close_notes = 'close_notes' in sample
        has_description = 'description' in sample
        
        print(f"\nHas work_notes: {has_work_notes}")
        print(f"Has close_notes: {has_close_notes}")
        print(f"Has description: {has_description}")
else:
    print("No 'incidents' table found in TinyDB")
