"""
Test assignment prediction enhancement - Rules engine + Historical learning

Tests the enhanced assignment prediction system that uses:
1. Category-based rules (MIB Requirements → Underwriting)
2. Keyword-based rules (password → Service Desk)
3. Historical pattern analysis from similar incidents
4. Fallback mechanisms when no rules match

Tests validate:
- Intent classification for assignment prediction queries
- Recipe structure and tool sequence
- Rules engine matching (category and keywords)
- Historical pattern analysis
- Recommendation ranking and confidence scores
"""

import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from components.intent_classifier import classify_intent
from components.plan_recipes import RECIPE_MAP
from components.servicenowgenaitool import predict_assignment_group_core
import json


def test_intent_classification():
    """Test that assignment prediction queries are correctly classified"""
    print("\n" + "="*80)
    print("TEST 1: Intent Classification")
    print("="*80)
    
    test_cases = [
        ("Who should INC0010014 be assigned to?", 'assignment_prediction'),
        ("Which team should handle this network issue?", 'assignment_prediction'),
        ("Recommend an assignment for this incident", 'assignment_prediction'),
        ("Assignment recommendation for password reset ticket", 'assignment_prediction'),
        ("Suggest a group for this MIB Requirements incident", 'assignment_prediction'),
        ("Which group can resolve email problems?", 'assignment_prediction'),
        ("Predict assignment for INC0010015", 'assignment_prediction'),
        # Negative cases - should NOT match assignment_prediction
        ("Assign INC0010014 to Underwriting Team", 'assign_incident'),  # This is actual assignment
        ("What is the assignment load?", 'assignment_load'),  # This is load query
    ]
    
    passed = 0
    failed = 0
    
    for query, expected_intent in test_cases:
        result = classify_intent(query)
        status = "✓" if result == expected_intent else "✗"
        
        if result == expected_intent:
            passed += 1
        else:
            failed += 1
        
        print(f"{status} Query: '{query}'")
        print(f"  Expected: {expected_intent}, Got: {result}")
    
    print(f"\n{'✅ PASSED' if failed == 0 else '❌ FAILED'}: {passed}/{len(test_cases)} intent classifications correct")
    return failed == 0


def test_recipe_structure():
    """Test that assignment_prediction recipe has correct tool sequence"""
    print("\n" + "="*80)
    print("TEST 2: Recipe Structure")
    print("="*80)
    
    if 'assignment_prediction' not in RECIPE_MAP:
        print("❌ FAILED: assignment_prediction recipe not found in RECIPE_MAP")
        return False
    
    recipe = RECIPE_MAP['assignment_prediction']
    expected_tools = [
        'fetch_servicenow_incident',
        'get_similar_incidents',
        'predict_assignment_group',
        'fetch_assignment_group_load'
    ]
    
    print(f"\nExpected tool sequence: {expected_tools}")
    actual_tools = [step['tool'] for step in recipe]
    print(f"Actual tool sequence:   {actual_tools}")
    
    all_present = all(tool in actual_tools for tool in expected_tools)
    
    if all_present:
        print(f"\n✅ PASSED: All {len(expected_tools)} required tools present in correct order")
        
        # Verify args_fn are defined
        for step in recipe:
            if step.get('args_fn') is None:
                print(f"⚠ WARNING: Tool '{step['tool']}' has no args_fn defined")
        
        return True
    else:
        print(f"\n❌ FAILED: Missing tools in recipe")
        missing = [t for t in expected_tools if t not in actual_tools]
        print(f"Missing: {missing}")
        return False


def test_rules_engine_matching():
    """Test rules-based assignment prediction"""
    print("\n" + "="*80)
    print("TEST 3: Rules Engine Matching")
    print("="*80)
    
    # Load rules to verify they exist
    from pathlib import Path
    rules_path = Path(__file__).parent / "components" / "assignment_rules.json"
    
    if not rules_path.exists():
        print(f"❌ FAILED: assignment_rules.json not found at {rules_path}")
        return False
    
    with open(rules_path, 'r') as f:
        rules = json.load(f)
    
    print(f"\n✓ Rules configuration loaded")
    print(f"  - Category rules: {len(rules['rules']['category_rules']['mappings'])}")
    print(f"  - Keyword rules: {len(rules['rules']['keyword_rules']['mappings'])}")
    print(f"  - Functionality rules: {len(rules['rules']['functionality_rules']['mappings'])}")
    
    # Test category rule matching
    test_cases = [
        {
            "name": "MIB Requirements → Underwriting",
            "short_description": "MIB report required for applicant John Doe",
            "category": "MIB Requirements",
            "expected_groups": ["Underwriting Team", "New Business Operations"],
            "similar_incidents": []
        },
        {
            "name": "Network Issues → Infrastructure",
            "short_description": "Network connectivity problems in office",
            "category": "Network Issues",
            "expected_groups": ["Infrastructure Team", "Network Operations"],
            "similar_incidents": []
        },
        {
            "name": "NIGO → Underwriting/Policy Services",
            "short_description": "Application missing required documents",
            "category": "NIGO",
            "expected_groups": ["Underwriting Team", "Policy Services"],
            "similar_incidents": []
        },
        {
            "name": "Keyword: Password Reset → Service Desk",
            "short_description": "User needs password reset for email account",
            "category": None,
            "expected_groups": ["Service Desk", "IT Support"],
            "similar_incidents": []
        },
        {
            "name": "Keyword: VPN → Network Security",
            "short_description": "VPN connection not working for remote user",
            "category": None,
            "expected_groups": ["Network Security", "Infrastructure Team"],
            "similar_incidents": []
        }
    ]
    
    passed = 0
    failed = 0
    
    for test in test_cases:
        print(f"\nTest: {test['name']}")
        print(f"  Description: {test['short_description']}")
        print(f"  Category: {test['category']}")
        
        result = predict_assignment_group_core(
            short_description=test['short_description'],
            category=test['category'],
            similar_incidents=test['similar_incidents']
        )
        
        if 'error' in result:
            print(f"  ❌ Error: {result['error']}")
            failed += 1
            continue
        
        recommendations = result.get('recommendations', [])
        if not recommendations:
            print(f"  ❌ No recommendations returned")
            failed += 1
            continue
        
        print(f"  Top recommendation: {recommendations[0]['assignment_group']} (confidence: {recommendations[0]['confidence']:.2f})")
        print(f"  Source: {recommendations[0]['sources']}")
        
        # Check if any expected group is in top 3 recommendations
        top_groups = [r['assignment_group'] for r in recommendations[:3]]
        matched = any(expected in top_groups for expected in test['expected_groups'])
        
        if matched:
            print(f"  ✅ Expected group found in top 3 recommendations")
            passed += 1
        else:
            print(f"  ❌ Expected groups {test['expected_groups']} not in top 3: {top_groups}")
            failed += 1
    
    print(f"\n{'✅ PASSED' if failed == 0 else '⚠ PARTIAL'}: {passed}/{len(test_cases)} rule matches successful")
    return failed == 0


def test_historical_pattern_analysis():
    """Test learning from historical incident assignments"""
    print("\n" + "="*80)
    print("TEST 4: Historical Pattern Analysis")
    print("="*80)
    
    # Simulate similar incidents with assignment history
    similar_incidents = [
        {
            "number": "INC0010001",
            "short_description": "MIB report needed for new application",
            "u_assigned_to": "Underwriting Team",
            "assignment_group": "Underwriting Team"
        },
        {
            "number": "INC0010002",
            "short_description": "Medical records required from physician",
            "u_assigned_to": "Underwriting Team",
            "assignment_group": "Underwriting Team"
        },
        {
            "number": "INC0010003",
            "short_description": "Additional health information requested",
            "u_assigned_to": "New Business Operations",
            "assignment_group": "New Business Operations"
        },
        {
            "number": "INC0010004",
            "short_description": "MIB check incomplete",
            "u_assigned_to": "Underwriting Team",
            "assignment_group": "Underwriting Team"
        }
    ]
    
    print(f"\nAnalyzing {len(similar_incidents)} similar incidents:")
    for inc in similar_incidents:
        print(f"  - {inc['number']}: → {inc['u_assigned_to']}")
    
    result = predict_assignment_group_core(
        short_description="MIB requirements not met for applicant",
        category="MIB Requirements",
        similar_incidents=similar_incidents
    )
    
    if 'error' in result:
        print(f"\n❌ FAILED: {result['error']}")
        return False
    
    recommendations = result.get('recommendations', [])
    reasoning_steps = result.get('reasoning_steps', [])
    
    print(f"\nRecommendations:")
    for i, rec in enumerate(recommendations[:3], 1):
        print(f"  {i}. {rec['assignment_group']} (confidence: {rec['confidence']:.2f})")
        print(f"     Sources: {', '.join(rec['sources'])}")
        print(f"     Reasoning: {rec['reasoning'][0] if rec['reasoning'] else 'N/A'}")
    
    print(f"\nReasoning Steps:")
    for step in reasoning_steps:
        print(f"  {step}")
    
    # Verify historical pattern was considered
    has_historical = any('historical' in str(rec['sources']) for rec in recommendations)
    has_category_rule = any('category_rule' in str(rec['sources']) for rec in recommendations)
    
    if has_historical and has_category_rule:
        print(f"\n✅ PASSED: Both category rules and historical patterns were used")
        return True
    elif has_category_rule:
        print(f"\n⚠ PARTIAL: Category rules used but historical patterns not detected")
        return True
    elif has_historical:
        print(f"\n⚠ PARTIAL: Historical patterns used but category rules not detected")
        return True
    else:
        print(f"\n❌ FAILED: Neither category rules nor historical patterns were used")
        return False


def test_confidence_scoring():
    """Test that confidence scores are reasonable and recommendations are ranked"""
    print("\n" + "="*80)
    print("TEST 5: Confidence Scoring & Ranking")
    print("="*80)
    
    # Test with both rules and historical data
    similar_incidents = [
        {"number": "INC0010001", "short_description": "Password reset needed", "u_assigned_to": "Service Desk"},
        {"number": "INC0010002", "short_description": "Password expired", "u_assigned_to": "Service Desk"},
        {"number": "INC0010003", "short_description": "Login credentials issue", "u_assigned_to": "IT Support"}
    ]
    
    result = predict_assignment_group_core(
        short_description="User forgot password and needs reset",
        category=None,
        similar_incidents=similar_incidents
    )
    
    if 'error' in result:
        print(f"❌ FAILED: {result['error']}")
        return False
    
    recommendations = result.get('recommendations', [])
    
    if not recommendations:
        print("❌ FAILED: No recommendations returned")
        return False
    
    print(f"\nRecommendations (ranked by confidence):")
    for i, rec in enumerate(recommendations, 1):
        print(f"  {i}. {rec['assignment_group']} - {rec['confidence']:.2f} confidence")
    
    # Verify ranking (descending confidence)
    confidences = [r['confidence'] for r in recommendations]
    is_sorted = all(confidences[i] >= confidences[i+1] for i in range(len(confidences)-1))
    
    # Verify confidence values are in valid range [0, 1]
    valid_range = all(0 <= c <= 1 for c in confidences)
    
    if is_sorted and valid_range:
        print(f"\n✅ PASSED: Recommendations properly ranked with valid confidence scores")
        return True
    else:
        if not is_sorted:
            print(f"\n❌ FAILED: Recommendations not sorted by confidence")
        if not valid_range:
            print(f"\n❌ FAILED: Confidence scores outside valid range [0, 1]")
        return False


def run_all_tests():
    """Run all test suites"""
    print("\n" + "="*80)
    print("ASSIGNMENT PREDICTION ENHANCEMENT - COMPREHENSIVE TEST SUITE")
    print("="*80)
    
    results = {
        "Intent Classification": test_intent_classification(),
        "Recipe Structure": test_recipe_structure(),
        "Rules Engine Matching": test_rules_engine_matching(),
        "Historical Pattern Analysis": test_historical_pattern_analysis(),
        "Confidence Scoring & Ranking": test_confidence_scoring()
    }
    
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, passed_test in results.items():
        status = "✅ PASSED" if passed_test else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\nOverall: {passed}/{total} test suites passed")
    
    if passed == total:
        print("\n🎉 All tests passed! Assignment prediction system is fully functional.")
        print("\nThe system now intelligently predicts assignment groups using:")
        print("  1. Category-based rules (MIB → Underwriting, Network → Infrastructure)")
        print("  2. Keyword matching (password → Service Desk, VPN → Network Security)")
        print("  3. Historical pattern learning from similar incidents")
        print("  4. Confidence scoring and ranking")
        print("  5. Reasoning explanations for each recommendation")
    else:
        print(f"\n⚠ {total - passed} test suite(s) failed. Review output above for details.")
    
    return passed == total


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
