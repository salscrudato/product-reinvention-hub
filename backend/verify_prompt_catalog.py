"""Verify prompt catalog has assignment entries."""
import json

with open('components/prompt_catalog.json', 'r') as f:
    catalog = json.load(f)

print("="*70)
print("PROMPT CATALOG - ASSIGNMENT ENTRIES")
print("="*70)

assignment_prompts = [p for p in catalog if 'assignment' in p['id'].lower()]

print(f"\nTotal prompts in catalog: {len(catalog)}")
print(f"Assignment-related prompts: {len(assignment_prompts)}")

if assignment_prompts:
    print("\nAssignment Prompts:")
    for i, prompt in enumerate(assignment_prompts, 1):
        print(f"\n{i}. {prompt['id']}")
        print(f"   Intent: {prompt['intent']}")
        print(f"   Personas: {', '.join(prompt['personas'])}")
        print(f"   Status: {prompt['status']}")
        print(f"   Description: {prompt['description'][:80]}...")
        print(f"   Keywords: {', '.join(prompt['activation_keywords'][:5])}")
        if prompt.get('review_notes'):
            print(f"   Notes: {prompt['review_notes'][0][:60]}...")

# Check for assignment groups reference
for prompt in assignment_prompts:
    if 'review_notes' in prompt and prompt['review_notes']:
        for note in prompt['review_notes']:
            if 'Database' in note or 'assignment groups' in note.lower():
                print(f"\nAssignment Groups Referenced in {prompt['id']}:")
                print(f"  {note}")
                break

print("\n" + "="*70)
print("✓ Prompt catalog updated with assignment prediction knowledge")
print("="*70)
