"""Test conditional backlog overview inclusion."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from components.plan_recipes import build_recipe

# Test cases
test_cases = [
    {
        'question': 'Can you provide the detailed description and current status of the INC0010014 incident?',
        'intent': 'incident_triage',
        'persona': 'product_owner',
        'should_include_backlog': False,
        'reason': 'Specific incident query'
    },
    {
        'question': 'Who should INC0010014 be assigned to?',
        'intent': 'assignment_prediction',
        'persona': 'product_owner',
        'should_include_backlog': False,
        'reason': 'Assignment-focused query'
    },
    {
        'question': 'Which teams or users are currently assigned to handle these recent incidents?',
        'intent': 'incident_triage',
        'persona': 'product_owner',
        'should_include_backlog': False,
        'reason': 'Assignment-focused query'
    },
    {
        'question': 'Show me the incidents opened in last 10 days',
        'intent': 'incident_triage',
        'persona': 'product_owner',
        'should_include_backlog': True,
        'reason': 'Explicit backlog query - "last 10 days"'
    },
    {
        'question': 'What are the incidents opened in last 10 days?',
        'intent': 'incident_triage',
        'persona': 'product_owner',
        'should_include_backlog': True,
        'reason': 'Explicit backlog query - "incidents opened"'
    },
    {
        'question': 'Give me a priority distribution of recent incidents',
        'intent': 'backlog_grooming',
        'persona': 'product_owner',
        'should_include_backlog': True,
        'reason': 'Explicit backlog query - "priority distribution"'
    }
]

print("=" * 80)
print("TESTING CONDITIONAL BACKLOG OVERVIEW")
print("=" * 80)

passed = 0
failed = 0

for i, test in enumerate(test_cases, 1):
    print(f"\nTest {i}: {test['question'][:60]}...")
    print(f"  Intent: {test['intent']}, Persona: {test['persona']}")
    print(f"  Expected: {'INCLUDE' if test['should_include_backlog'] else 'EXCLUDE'} backlog")
    print(f"  Reason: {test['reason']}")
    
    plan = build_recipe(
        intent=test['intent'],
        persona=test['persona'],
        question=test['question'],
        metadata={'persona': test['persona'], 'intent': test['intent']}
    )
    
    if not plan:
        print(f"  ❌ FAILED: No plan returned")
        failed += 1
        continue
    
    tools = [step.get('tool') for step in plan]
    has_backlog = 'fetch_backlog_overview' in tools
    
    print(f"  Tools: {', '.join(str(t) for t in tools if t)}")
    print(f"  Actual: {'INCLUDE' if has_backlog else 'EXCLUDE'} backlog")
    
    if has_backlog == test['should_include_backlog']:
        print(f"  ✅ PASSED")
        passed += 1
    else:
        print(f"  ❌ FAILED: Expected {'INCLUDE' if test['should_include_backlog'] else 'EXCLUDE'}, got {'INCLUDE' if has_backlog else 'EXCLUDE'}")
        failed += 1

print("\n" + "=" * 80)
print(f"RESULTS: {passed} passed, {failed} failed out of {len(test_cases)} tests")
print("=" * 80)

if failed == 0:
    print("✅ All tests passed! Backlog overview is now conditionally included.")
else:
    print(f"❌ {failed} test(s) failed.")
