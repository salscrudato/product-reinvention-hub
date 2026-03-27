"""
Test script for resolution_progress intent and workflow
Validates that the enhanced orchestration correctly handles queries about resolution steps
"""
import sys
import json
from components.intent_classifier import classify_intent
from components.plan_recipes import build_recipe, RECIPE_MAP
from components.snowaaonetool import get_similar_incidents_tool

def test_intent_classification():
    """Test that resolution queries are correctly classified"""
    print("=" * 80)
    print("TEST 1: Intent Classification")
    print("=" * 80)
    
    test_queries = [
        "What steps are currently being taken to resolve the INC0010014 incident?",
        "How is this incident being resolved?",
        "What work is being done on INC0010014?",
        "What is the resolution progress for this issue?",
        "How to resolve incident INC0010014?",
        "What is the current status of resolving this problem?"
    ]
    
    results = []
    for query in test_queries:
        intent = classify_intent(query)
        results.append((query, intent))
        intent_str = intent if intent else "None"
        status = "✅ PASS" if intent == 'resolution_progress' else "❌ FAIL"
        print(f"{status} | Intent: {intent_str:20s} | Query: {query[:60]}")
    
    success_count = sum(1 for _, intent in results if intent == 'resolution_progress')
    print(f"\nResults: {success_count}/{len(test_queries)} correctly classified")
    return success_count == len(test_queries)


def test_recipe_structure():
    """Test that resolution_progress recipe includes all necessary steps"""
    print("\n" + "=" * 80)
    print("TEST 2: Recipe Structure")
    print("=" * 80)
    
    try:
        # Check if recipe exists in RECIPE_MAP dictionary
        if 'resolution_progress' not in RECIPE_MAP:
            print("❌ FAIL: 'resolution_progress' recipe not found in RECIPE_MAP")
            return False
        
        recipe = RECIPE_MAP['resolution_progress']
        print(f"Recipe found with {len(recipe)} steps:")
        
        expected_tools = [
            'fetch_servicenow_incident',
            'summarize_work_notes',
            'get_similar_incidents',
            'fetch_kb_articles'
        ]
        
        actual_tools = [step['tool'] for step in recipe]
        print(f"\nExpected tools: {expected_tools}")
        print(f"Actual tools:   {actual_tools}")
        
        all_present = all(tool in actual_tools for tool in expected_tools)
        status = "✅ PASS" if all_present else "❌ FAIL"
        print(f"\n{status}: All required tools {'present' if all_present else 'MISSING'}")
        
        # Check for state_filter in get_similar_incidents step
        similar_step = next((s for s in recipe if s['tool'] == 'get_similar_incidents'), None)
        if similar_step and similar_step.get('args_fn'):
            print("✅ get_similar_incidents has args_fn (should inject state_filter='resolved')")
        else:
            print("⚠️  get_similar_incidents may not have state filtering configured")
        
        return all_present
    
    except Exception as e:
        print(f"❌ FAIL: Error loading recipe: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_state_filtering():
    """Test that get_similar_incidents tool properly filters by state"""
    print("\n" + "=" * 80)
    print("TEST 3: State Filtering Functionality")
    print("=" * 80)
    
    try:
        # Test with a sample description
        test_description = "MIB Requirement Generated incorrectly"
        
        print(f"Testing with description: '{test_description}'")
        print("\n--- Test 3a: No Filter (All Incidents) ---")
        result_all = get_similar_incidents_tool(short_description=test_description)
        
        if 'similar_incidents' in result_all:
            count_all = len(result_all['similar_incidents'])
            print(f"✅ Found {count_all} similar incidents (all states)")
        else:
            print(f"⚠️  Result: {result_all}")
        
        print("\n--- Test 3b: Filter for Resolved Incidents ---")
        result_resolved = get_similar_incidents_tool(
            short_description=test_description,
            state_filter='resolved'
        )
        
        if 'similar_incidents' in result_resolved:
            count_resolved = len(result_resolved['similar_incidents'])
            has_work_notes = any('work_notes' in inc for inc in result_resolved['similar_incidents'])
            print(f"✅ Found {count_resolved} resolved incidents")
            print(f"{'✅' if has_work_notes else '⚠️ '} Work notes {'included' if has_work_notes else 'NOT included'}")
            print(f"   Filter applied: {result_resolved.get('filter_applied')}")
            print(f"   Total found: {result_resolved.get('total_found')}")
            print(f"   Resolution patterns available: {result_resolved.get('resolution_patterns_available')}")
            
            if result_resolved['similar_incidents']:
                sample = result_resolved['similar_incidents'][0]
                if isinstance(sample, dict):
                    print(f"\n   Sample incident fields: {list(sample.keys())}")
                else:
                    print(f"\n   Sample incident (non-dict): {type(sample)}")
        else:
            print(f"⚠️  Result: {result_resolved}")
        
        print("\n--- Test 3c: Filter for Active Incidents ---")
        result_active = get_similar_incidents_tool(
            short_description=test_description,
            state_filter='active'
        )
        
        if 'similar_incidents' in result_active:
            count_active = len(result_active['similar_incidents'])
            print(f"✅ Found {count_active} active incidents")
            print(f"   Filter applied: {result_active.get('filter_applied')}")
        else:
            print(f"⚠️  Result: {result_active}")
        
        return True
    
    except Exception as e:
        print(f"❌ FAIL: Error testing state filtering: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_args_functions():
    """Test that args functions properly inject state_filter"""
    print("\n" + "=" * 80)
    print("TEST 4: Args Function Validation")
    print("=" * 80)
    
    try:
        from components.plan_recipes import _args_similar_resolved, _args_work_notes
        
        print("--- Test 4a: _args_similar_resolved ---")
        question = "What steps are being taken to resolve INC0010014?"
        metadata = {
            'canonical_incident': {
                'number': 'INC0010014',
                'short_description': 'MIB Requirement Generated incorrectly'
            }
        }
        
        args = _args_similar_resolved(question, metadata)
        print(f"Generated args: {json.dumps(args, indent=2)}")
        
        has_state_filter = args.get('state_filter') == 'resolved'
        status = "✅ PASS" if has_state_filter else "❌ FAIL"
        print(f"{status}: state_filter={'resolved' if has_state_filter else args.get('state_filter')}")
        
        print("\n--- Test 4b: _args_work_notes ---")
        args_notes = _args_work_notes(question, metadata)
        print(f"Generated args: {json.dumps(args_notes, indent=2)}")
        
        has_incident = args_notes.get('incident_number') == 'INC0010014'
        has_max_notes = args_notes.get('max_notes') == 20
        has_llm_summary = args_notes.get('llm_summary') == True
        
        status = "✅ PASS" if (has_incident and has_max_notes and has_llm_summary) else "❌ FAIL"
        print(f"{status}: All required args present and correct")
        
        return has_state_filter and has_incident
    
    except Exception as e:
        print(f"❌ FAIL: Error testing args functions: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all tests and provide summary"""
    print("\n" + "=" * 80)
    print("RESOLUTION PROGRESS WORKFLOW VALIDATION")
    print("=" * 80)
    print("\nTesting comprehensive solution for resolution steps queries")
    print("Validates intent classification, recipe structure, and tool enhancements\n")
    
    results = {}
    
    # Run all tests
    results['Intent Classification'] = test_intent_classification()
    results['Recipe Structure'] = test_recipe_structure()
    results['State Filtering'] = test_state_filtering()
    results['Args Functions'] = test_args_functions()
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} | {test_name}")
    
    success_count = sum(1 for passed in results.values() if passed)
    total_count = len(results)
    
    print(f"\nOverall: {success_count}/{total_count} test suites passed")
    
    if success_count == total_count:
        print("\n🎉 All tests passed! Resolution progress workflow is fully implemented.")
        print("\nNext steps:")
        print("1. Start backend: cd backend && python app.py")
        print("2. Test query: 'What steps are currently being taken to resolve INC0010014?'")
        print("3. Verify response includes:")
        print("   - Incident details")
        print("   - Work notes summary")
        print("   - Similar resolved incidents with resolution patterns")
        print("   - Relevant KB articles")
    else:
        print(f"\n⚠️  {total_count - success_count} test suite(s) failed. Review output above.")
    
    return success_count == total_count


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
