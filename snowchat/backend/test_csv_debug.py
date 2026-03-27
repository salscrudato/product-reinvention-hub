"""Debug CSV parsing to see why no descriptors are extracted."""
import pandas as pd
from components.mapping_agents.parsers import parse_excel, _extract_value, _FIELD_NAME_HINTS, _FIELD_PATH_HINTS, _FIELD_DESCRIPTION_HINTS, _FIELD_SAMPLE_HINTS

# Read CSV directly
csv_path = 'test_excels/acord/Mapping.csv'
df = pd.read_csv(csv_path)

print(f"\nCSV has {len(df)} rows and {len(df.columns)} columns")
print(f"Columns: {list(df.columns)}")
print(f"\nFirst 3 rows:")
for i in range(min(3, len(df))):
    print(f"\nRow {i}:")
    row = df.iloc[i]
    for col in df.columns:
        print(f"  {col}: '{row[col]}'")

# Test extraction logic on first row
print("\n" + "="*60)
print("Testing extraction on first row...")
first_row = df.iloc[0]
row_mapping = {str(col): first_row[col] for col in df.columns}
normalized = {str(key): row_mapping[key] for key in row_mapping}

print(f"\nNormalized dict: {normalized}")

# Test each extraction
name = _extract_value(normalized, _FIELD_NAME_HINTS)
description = _extract_value(normalized, _FIELD_DESCRIPTION_HINTS)
path = _extract_value(normalized, _FIELD_PATH_HINTS)
sample = _extract_value(normalized, _FIELD_SAMPLE_HINTS)

print(f"\nExtracted values:")
print(f"  name: '{name}'")
print(f"  description: '{description}'")
print(f"  path: '{path}'")
print(f"  sample: '{sample}'")

# Test fallback logic
if path and (not description or len(description) < 4):
    print(f"\nApplying fallback: description = 'Path: {path}'")
    description = f"Path: {path}"
    print(f"  new description: '{description}' (length: {len(description)})")

# Now test full parsing
print("\n" + "="*60)
print("Testing full parse_excel()...")
result = parse_excel(csv_path)
print(f"Total object descriptors: {len(result.objects)}")

if result.objects:
    print(f"\nFirst 3 descriptors:")
    for i, obj in enumerate(result.objects[:3]):
        print(f"\n{i+1}. {obj.name}")
        print(f"   Description: {obj.description[:80] if obj.description else 'None'}")
        print(f"   Path: {obj.path}")
        print(f"   Sample: {obj.sample}")
