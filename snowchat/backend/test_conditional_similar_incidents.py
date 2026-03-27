"""
Test: Conditional Similar Incidents Inclusion

Problem: The incident_triage recipe ALWAYS included get_similar_incidents, even when
the user was asking for details about ONE specific incident. This wasted time 
(60+ seconds) and provided no value.

Example waste:
Query: "Can you show me the detailed description and status of incident INC0010014?"
- Should fetch: INC0010014 details
- Should NOT search for similar incidents (user didn't ask for comparison)
- Old behavior: Wasted 63 seconds searching, returned same incident with 100% similarity

Solution: Make get_similar_incidents conditional based on query intent.
- Include when: "similar incidents", "like this", "happened before", "compare"
- Exclude when: "show me the details of INC0010014", "status of INC0010014"
"""

import sys
import os

# Add backend directory to path
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_dir)

# Import using components module
from components.plan_recipes import _should_include_similar_incidents, _args_similar_incidents_conditional


def test_exclude_single_incident_details():
    """Queries for specific incident details should NOT trigger similar incidents search"""
    
    test_cases = [
        "Can you show me the detailed description and status of the MIB Requirement incident INC0010014?",
        "Show me the details of INC0010014",
        "Get me information about incident INC0010014",
        "What is the status of INC0010014?",
        "Provide details for INC0010014",
        "Give me the description of incident INC0010014",
    ]
    
    for question in test_cases:
        result = _should_include_similar_incidents(question, {})
        print(f"Query: {question}")
        print(f"  Include similar incidents? {result}")
        assert result == False, \
            f"Should NOT include similar incidents for single incident query: {question}"
        print("  ✓ Correctly excluded\n")


def test_include_comparison_queries():
    """Queries asking for comparison/patterns SHOULD trigger similar incidents search"""
    
    test_cases = [
        "Show me similar incidents to INC0010014",
        "Have any related incidents occurred before?",
        "Find incidents like this one",
        "Are there other cases with this issue?",
        "Has this happened before?",
        "Show me the pattern of MIB requirement errors",
        "Compare this incident with other MIB issues",
        "How many similar incidents have we had?",
    ]
    
    for question in test_cases:
        result = _should_include_similar_incidents(question, {})
        print(f"Query: {question}")
        print(f"  Include similar incidents? {result}")
        assert result == True, \
            f"Should include similar incidents for comparison query: {question}"
        print("  ✓ Correctly included\n")


def test_conditional_args_function():
    """Test that conditional args function returns None for excluded queries"""
    
    # Should return None (skip tool)
    question1 = "Show me the details of INC0010014"
    result1 = _args_similar_incidents_conditional(question1, {})
    print(f"Query: {question1}")
    print(f"  Args returned: {result1}")
    assert result1 is None, "Should return None to skip tool for single incident query"
    print("  ✓ Returns None to skip tool\n")
    
    # Should return args dict (include tool)
    question2 = "Show me similar incidents to INC0010014"
    metadata2 = {'canonical_incident': {'number': 'INC0010014'}}
    result2 = _args_similar_incidents_conditional(question2, metadata2)
    print(f"Query: {question2}")
    print(f"  Args returned: {result2}")
    assert result2 is not None, "Should return args dict for comparison query"
    assert isinstance(result2, dict), "Should return dict"
    print("  ✓ Returns args dict to include tool\n")


def test_backward_compatible_generic_queries():
    """Generic queries without specific exclusion keywords should include similar incidents (backward compatible)"""
    
    test_cases = [
        "Tell me about MIB requirement incidents",
        "What incidents are open?",
        "INC0010014",
    ]
    
    for question in test_cases:
        result = _should_include_similar_incidents(question, {})
        print(f"Query: {question}")
        print(f"  Include similar incidents? {result}")
        assert result == True, \
            f"Should include similar incidents for generic query (backward compatible): {question}"
        print("  ✓ Correctly included (backward compatible)\n")


if __name__ == '__main__':
    print("=" * 80)
    print("Testing: Conditional Similar Incidents Inclusion")
    print("=" * 80 + "\n")
    
    try:
        test_exclude_single_incident_details()
        test_include_comparison_queries()
        test_conditional_args_function()
        test_backward_compatible_generic_queries()
        
        print("=" * 80)
        print("✅ ALL TESTS PASSED")
        print("=" * 80)
        print("\nSummary:")
        print("- Single incident detail queries skip similar incidents search ✓")
        print("- Comparison/pattern queries include similar incidents search ✓")
        print("- Conditional args function returns None to skip when appropriate ✓")
        print("- Generic queries remain backward compatible ✓")
        print("\nExpected Performance Impact:")
        print("- Queries like 'Show me details of INC0010014' will save 60+ seconds")
        print("- No unnecessary API calls for single incident queries")
        print("- Comparison queries still get full similar incidents analysis")
        
    except AssertionError as e:
        print("=" * 80)
        print(f"❌ TEST FAILED: {e}")
        print("=" * 80)
        sys.exit(1)
