"""Quick test of JSON parsing fix."""
from components.mapping_agents.parsers import parse_excel

result = parse_excel('test_excels/acord/cbinsurance-data-dictionary-2026-02-05.json')

print(f"\n✓ Parsed {len(result.objects)} fields across {len(result.sheets)} categories")
print(f"\nCategories: {result.sheets}")
print(f"\nFirst 3 fields:")
for i, obj in enumerate(result.objects[:3]):
    print(f"  {i+1}. {obj.name}")
    print(f"     Description: {obj.description[:80]}...")
    print(f"     Metadata: {list(obj.metadata.keys())}")
print(f"\n✓ JSON parsing successful!")
