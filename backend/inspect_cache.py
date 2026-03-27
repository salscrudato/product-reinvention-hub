"""Quick script to inspect embedding_cache.json structure"""
import json

with open('embedding_cache.json', encoding='utf-8') as f:
    cache = json.load(f)

print(f"Total cached entries: {len(cache)}")
print(f"Cache type: {type(cache)}")
print()

# Get first entry
first_key = list(cache.keys())[0]
first_entry = cache[first_key]

print(f"Sample key: {first_key}")
print(f"Sample value type: {type(first_entry)}")
print()

if isinstance(first_entry, dict):
    print("Available fields in cached entry:")
    for key, value in first_entry.items():
        if key == 'embedding':
            print(f"  - embedding: list[float] (dim: {len(value)})")
        else:
            val_preview = str(value)[:80] if value else 'None'
            print(f"  - {key}: {val_preview}")
    
    print()
    print("Checking for work_notes, close_notes, description:")
    print(f"  Has work_notes: {'work_notes' in first_entry}")
    print(f"  Has close_notes: {'close_notes' in first_entry}")
    print(f"  Has description: {'description' in first_entry}")
    print(f"  Has short_description: {'short_description' in first_entry}")
    print(f"  Has state: {'state' in first_entry}")
    print(f"  Has number: {'number' in first_entry}")

elif isinstance(first_entry, list):
    print(f"Entry is a list with {len(first_entry)} items")
    if len(first_entry) > 0:
        print(f"  First item type: {type(first_entry[0])}")
        if len(first_entry) > 1500:
            print("  (Looks like an embedding vector)")

print("\n" + "="*60)
print("Sample of entries (first 3):")
for i, (key, value) in enumerate(list(cache.items())[:3]):
    print(f"\n{i+1}. Key: {key}")
    if isinstance(value, dict):
        print(f"   Fields: {list(value.keys())}")
    elif isinstance(value, list):
        print(f"   List length: {len(value)}")
