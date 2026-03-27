"""
Test: Date Range Query with Weeks Pattern

Problem: User query "Give me the incidents opened in last 3 weeks" failed with:
  "Date query failed: Expecting value: line 1 column 1 (char 0)"

Root Cause Analysis:
1. Query matched intent 'incidents_date_range'
2. Recipe used tool 'query_incidents_by_date' with args function '_args_date_range_explicit'
3. Args function returned {'days_back': 7} (didn't extract "3 weeks")
4. query_incidents_by_date_tool DOES NOT ACCEPT 'days_back' parameter!
5. Tool signature: query_incidents_by_date_tool(start_date, end_date, ...)
6. Passed wrong args → JSON parsing error

Solution:
1. Change recipe to use 'get_incidents_by_date_range' tool (accepts days_back)
2. Update _args_date_range to extract "N weeks" pattern → days_back=N*7
3. Tool now gets correct arguments and works properly

Expected Result:
- "last 3 weeks" → {'days_back': 21}
- "last 7 days" → {'days_back': 7}
- "past 2 weeks" → {'days_back': 14}
"""

import sys
import os
import re

# Add backend directory to path
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_dir)

from components.plan_recipes import _args_date_range


def test_date_range_pattern_extraction():
    """Test that date range patterns are correctly extracted from natural language."""
    
    print("=" * 80)
    print("Testing: Date Range Pattern Extraction")
    print("=" * 80 + "\n")
    
    test_cases = [
        # Weeks patterns
        ("Give me the incidents opened in last 3 weeks related to MIB Incident", 21),
        ("Show me incidents from past 2 weeks", 14),
        ("Get incidents created in last 1 week", 7),
        ("Find incidents opened last 4 weeks", 28),
        
        # Days patterns
        ("Show me incidents from last 7 days", 7),
        ("Get incidents from past 14 days", 14),
        ("Find incidents opened in last 30 days", 30),
        ("Show incidents created last 1 day", 1),
        
        # Default fallback
        ("Show me recent incidents", 7),  # No pattern → default 7 days
    ]
    
    all_passed = True
    
    for question, expected_days in test_cases:
        result = _args_date_range(question, {})
        actual_days = result.get('days_back', 0)
        
        status = "✓" if actual_days == expected_days else "✗"
        print(f"{status} Query: {question}")
        print(f"  Expected: days_back={expected_days}")
        print(f"  Actual:   days_back={actual_days}")
        
        if actual_days != expected_days:
            print(f"  ❌ FAILED: Expected {expected_days}, got {actual_days}")
            all_passed = False
        print()
    
    print("=" * 80)
    print("Recipe Configuration Validation")
    print("=" * 80 + "\n")
    
    # Import and check recipe
    from components.plan_recipes import RECIPE_MAP
    
    recipe = RECIPE_MAP.get('incidents_date_range', [])
    if recipe:
        tool_name = recipe[0].get('tool')
        print(f"Recipe 'incidents_date_range' uses tool: {tool_name}")
        
        if tool_name == 'get_incidents_by_date_range':
            print("✓ CORRECT: Tool accepts 'days_back' parameter")
        elif tool_name == 'query_incidents_by_date':
            print("✗ WRONG: Tool only accepts 'start_date'/'end_date', not 'days_back'")
            print("  This will cause JSON parsing errors!")
            all_passed = False
        else:
            print(f"⚠️  UNKNOWN TOOL: {tool_name}")
    else:
        print("✗ Recipe 'incidents_date_range' not found!")
        all_passed = False
    
    print("\n" + "=" * 80)
    if all_passed:
        print("✅ ALL TESTS PASSED")
        print("=" * 80)
        print("\nPattern Extraction Summary:")
        print("- Weeks patterns: 'last N weeks' → days_back = N * 7")
        print("- Days patterns:  'last N days'  → days_back = N")
        print("- Default:        No pattern     → days_back = 7")
        print("\nRecipe Configuration:")
        print("- Tool: get_incidents_by_date_range (accepts days_back) ✓")
        print("- Args function: _args_date_range (extracts weeks/days) ✓")
    else:
        print("❌ TESTS FAILED")
        print("=" * 80)
        sys.exit(1)


if __name__ == '__main__':
    test_date_range_pattern_extraction()
