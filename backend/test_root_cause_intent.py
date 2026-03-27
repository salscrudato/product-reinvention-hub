"""Test that root cause, resolution steps, and workaround queries trigger work notes."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from components.intent_classifier import classify_intent
from components.plan_recipes import build_recipe

# Test cases for queries that should fetch work notes
test_cases = [
    {
        'question': 'What is the root cause identified for the incorrect MIB Requirement generation in incident INC0010014?',
        'expected_intent': 'resolution_progress',
        'should_have_work_notes': True,
        'reason': 'Root cause query'
    },
    {
        'question': 'What caused the incident INC0010014?',
        'expected_intent': 'resolution_progress',
        'should_have_work_notes': True,
        'reason': 'Root cause query (what caused)'
    },
    {
        'question': 'Why did this incident occur?',
        'expected_intent': 'resolution_progress',
        'should_have_work_notes': True,
        'reason': 'Root cause query (why did)'
    },
    {
        'question': 'What are the resolution steps for INC0010014?',
        'expected_intent': 'resolution_progress',
        'should_have_work_notes': True,
        'reason': 'Resolution steps query'
    },
    {
        'question': 'What steps are being taken to resolve INC0010014?',
        'expected_intent': 'resolution_progress',
        'should_have_work_notes': True,
        'reason': 'Resolution progress query'
    },
    {
        'question': 'Is there a workaround for INC0010014?',
        'expected_intent': 'resolution_progress',
        'should_have_work_notes': True,
        'reason': 'Workaround query'
    },
    {
        'question': 'What is a temporary fix for this issue?',
        'expected_intent': 'resolution_progress',
        'should_have_work_notes': True,
        'reason': 'Temporary fix query'
    },
    {
        'question': 'How can we work around this problem?',
        'expected_intent': 'resolution_progress',
        'should_have_work_notes': True,
        'reason': 'Work around query'
    }
]

print("=" * 80)
print("TESTING ROOT CAUSE / RESOLUTION / WORKAROUND INTENT & WORK NOTES")
print("=" * 80)

passed = 0
failed = 0

for i, test in enumerate(test_cases, 1):
    print(f"\nTest {i}: {test['question'][:70]}...")
    print(f"  Expected Intent: {test['expected_intent']}")
    print(f"  Reason: {test['reason']}")
    
    # Test 1: Intent classification
    intent = classify_intent(test['question'], {})
    print(f"  Actual Intent: {intent}")
    
    intent_correct = (intent == test['expected_intent'])
    
    # Test 2: Recipe includes work notes
    plan = build_recipe(
        intent=intent or 'incident_triage',
        persona='product_owner',
        question=test['question'],
        metadata={'persona': 'product_owner', 'intent': intent}
    )
    
    if plan:
        tools = [step.get('tool') for step in plan]
        has_work_notes = any('work_notes' in str(tool).lower() for tool in tools)
        print(f"  Tools: {', '.join(str(t) for t in tools if t)}")
        print(f"  Has Work Notes: {has_work_notes}")
        
        work_notes_correct = (has_work_notes == test['should_have_work_notes'])
        
        if intent_correct and work_notes_correct:
            print(f"  ✅ PASSED")
            passed += 1
        else:
            print(f"  ❌ FAILED:")
            if not intent_correct:
                print(f"     - Intent: expected {test['expected_intent']}, got {intent}")
            if not work_notes_correct:
                print(f"     - Work notes: expected {test['should_have_work_notes']}, got {has_work_notes}")
            failed += 1
    else:
        print(f"  ❌ FAILED: No plan returned")
        failed += 1

print("\n" + "=" * 80)
print(f"RESULTS: {passed} passed, {failed} failed out of {len(test_cases)} tests")
print("=" * 80)

if failed == 0:
    print("✅ All tests passed! Root cause/resolution/workaround queries now fetch work notes.")
else:
    print(f"❌ {failed} test(s) failed.")
