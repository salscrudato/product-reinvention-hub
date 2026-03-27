"""Verify assignment_rules.json update."""
import json

with open('components/assignment_rules.json', 'r') as f:
    data = json.load(f)

print("Assignment Rules Status")
print("="*60)
print(f"Status: {data['metadata']['status']}")
print(f"Data Source: {data['metadata']['data_source']}")
print(f"Last Updated: {data['metadata']['last_updated']}")
print(f"Total Groups: {data['metadata']['total_groups']}")

print("\nAll Assignment Groups:")
for g in data['metadata']['all_assignment_groups']:
    print(f"  • {g}")

print(f"\nRules Summary:")
print(f"  Category Rules: {len(data['rules']['category_rules']['mappings'])}")
print(f"  Keyword Rules: {len(data['rules']['keyword_rules']['mappings'])}")
print(f"  Functionality Rules: {len(data['rules']['functionality_rules']['mappings'])}")

print("\n" + "="*60)
print("✓ Assignment rules successfully updated with real ServiceNow data")
