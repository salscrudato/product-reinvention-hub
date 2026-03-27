"""Test work notes retrieval with journal field API"""
import sys
sys.path.insert(0, r'C:\dev\snowchat\backend')

from components.servicenowgenaitool import get_incident_work_notes_core

# Test with INC0010003
incident_number = "INC0010003"
print(f"\nTesting work notes retrieval for {incident_number}...")
print("=" * 60)

result = get_incident_work_notes_core(incident_number, include_empty=False)

print(f"\nResult keys: {list(result.keys())}")
print(f"\nFull result:")
import json
print(json.dumps(result, indent=2, default=str))

if result.get("status") == "success":
    print(f"\n✅ SUCCESS! Retrieved {result.get('work_notes_count')} work note entries")
    print(f"\nWork notes preview (first 500 chars):")
    print(result.get('work_notes', '')[:500])
elif "error" in result:
    print(f"\n❌ ERROR: {result['error']}")
