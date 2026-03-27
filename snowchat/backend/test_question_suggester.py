"""Test updated question suggester with assignment questions."""
from components.question_suggester import QuestionSuggester

print("="*70)
print("TESTING QUESTION SUGGESTER - ASSIGNMENT QUESTIONS")
print("="*70)

suggester = QuestionSuggester()

# Test for different personas
personas = ['developer', 'product_owner', 'business_analyst', 'service_desk']

for persona in personas:
    print(f"\n{'='*70}")
    print(f"PERSONA: {persona.upper()}")
    print('='*70)
    
    suggestions = suggester.get_suggestions(persona=persona, limit=8)
    
    if suggestions:
        print(f"\nFound {len(suggestions)} suggestions:")
        for i, suggestion in enumerate(suggestions, 1):
            print(f"\n  {i}. {suggestion['question']}")
            print(f"     Source: {suggestion.get('source', 'N/A')}")
            print(f"     Intent: {suggestion.get('intent', 'N/A')}")
            print(f"     Confidence: {suggestion.get('confidence', 'N/A'):.0%}" if suggestion.get('confidence') else "")
    else:
        print("  No suggestions available")

# Test with incident context
print(f"\n{'='*70}")
print("WITH INCIDENT CONTEXT")
print('='*70)

context = {'incidents': ['INC0010001', 'INC0010002']}
suggestions = suggester.get_suggestions(persona='developer', context=context, limit=8)

print(f"\nFound {len(suggestions)} context-aware suggestions:")
for i, suggestion in enumerate(suggestions, 1):
    print(f"\n  {i}. {suggestion['question']}")
    print(f"     Source: {suggestion.get('source', 'N/A')}")
    print(f"     Confidence: {suggestion.get('confidence', 'N/A'):.0%}" if suggestion.get('confidence') else "")

# Count assignment-related questions
print(f"\n{'='*70}")
print("ASSIGNMENT QUESTION ANALYSIS")
print('='*70)

all_suggestions = []
for persona in personas:
    all_suggestions.extend(suggester.get_suggestions(persona=persona, limit=10))

assignment_keywords = ['assign', 'assignment', 'who should', 'which team', 'which group', 'handles']
assignment_questions = [s for s in all_suggestions if any(keyword in s['question'].lower() for keyword in assignment_keywords)]

print(f"\nTotal suggestions across all personas: {len(all_suggestions)}")
print(f"Assignment-related questions: {len(assignment_questions)}")
print(f"Percentage: {len(assignment_questions)/len(all_suggestions)*100:.1f}%")

if assignment_questions:
    print("\nExample assignment questions:")
    for i, q in enumerate(assignment_questions[:5], 1):
        print(f"  {i}. {q['question']}")

print("\n" + "="*70)
print("✓ Question suggester updated with assignment predictions")
print("="*70)
