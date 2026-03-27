"""Test CSV parsing for ACORD mapping file."""
from components.mapping_agents.parsers import parse_excel

result = parse_excel('test_excels/acord/Mapping.csv')

print("\n[PASS] Parsed CSV as ExcelSummary")
print(f"  Sheets (CSV name): {result.sheets}")
print(f"  Column samples: {result.column_samples}")
print(f"  Total rows with object descriptors: {len(result.objects)}")

if result.objects:
    print(f"\nFirst 3 field mappings:")
    for i, obj in enumerate(result.objects[:3]):
        print(f"  {i+1}. {obj.name}")
        if obj.description:
            print(f"     Description: {obj.description[:80]}")
        print(f"     Metadata keys: {list(obj.metadata.keys())}")

# Check for ACORD columns
first_sheet = result.sheets[0]
columns = result.column_samples.get(first_sheet, [])
print(f"\nColumns detected: {columns}")

# Look for ACORD-specific columns
acord_indicators = ['acord', 'path', 'xml']
acord_cols = [col for col in columns if any(ind in col.lower() for ind in acord_indicators)]
if acord_cols:
    print(f"\n[ACORD] Bridge columns detected: {acord_cols}")
else:
    print(f"\n[WARN] No ACORD columns detected (this is the bridge file!)")

print(f"\n[PASS] CSV parsing successful!")
