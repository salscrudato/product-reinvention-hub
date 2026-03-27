"""
Test: Explicit Intent Keywords Override Context Boost

Problem: Query "Can you provide the detailed root cause analysis for THE INCIDENT 
related to the MIB requirement?" was incorrectly classified as 'similar_incidents' 
instead of 'resolution_progress' because the context boost (entity tracking) 
overrode the explicit "root cause" keyword.

Solution: Check for explicit intent keywords BEFORE applying context boost logic.
Explicit keywords like "root cause", "workaround", "who should assign" should ALWAYS
take precedence over context-aware shortcuts.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'components'))

from components.intent_classifier import classify_intent


def test_root_cause_overrides_context_boost():
    """Root cause query with entity reference should NOT trigger similar_incidents"""
    question = "Can you provide the detailed root cause analysis for the incident related to the MIB requirement?"
    
    # Simulate context where "MIB requirement" was mentioned before
    metadata = {
        'entities': {
            'topics': ['MIB requirement']
        }
    }
    
    result = classify_intent(question, metadata)
    
    print(f"Query: {question}")
    print(f"Metadata entities: {metadata['entities']}")
    print(f"Classified intent: {result}")
    
    assert result == 'resolution_progress', \
        f"Expected 'resolution_progress' for root cause query, got '{result}'"
    print("✓ Root cause intent correctly prioritized over context boost\n")


def test_workaround_overrides_context_boost():
    """Workaround query with entity reference should NOT trigger similar_incidents"""
    question = "What workaround exists for the issue related to MIB requirement?"
    
    metadata = {
        'entities': {
            'topics': ['MIB requirement']
        }
    }
    
    result = classify_intent(question, metadata)
    
    print(f"Query: {question}")
    print(f"Metadata entities: {metadata['entities']}")
    print(f"Classified intent: {result}")
    
    assert result == 'resolution_progress', \
        f"Expected 'resolution_progress' for workaround query, got '{result}'"
    print("✓ Workaround intent correctly prioritized over context boost\n")


def test_assignment_overrides_context_boost():
    """Assignment query with entity reference should NOT trigger similar_incidents"""
    question = "Who should be assigned to the incident related to MIB requirement?"
    
    metadata = {
        'entities': {
            'topics': ['MIB requirement']
        }
    }
    
    result = classify_intent(question, metadata)
    
    print(f"Query: {question}")
    print(f"Metadata entities: {metadata['entities']}")
    print(f"Classified intent: {result}")
    
    assert result == 'assignment_prediction', \
        f"Expected 'assignment_prediction' for assignment query, got '{result}'"
    print("✓ Assignment intent correctly prioritized over context boost\n")


def test_context_boost_still_works_without_explicit_intent():
    """Context boost should STILL work when no explicit intent keywords present"""
    question = "Show me incidents related to MIB requirement"
    
    metadata = {
        'entities': {
            'topics': ['MIB requirement']
        }
    }
    
    result = classify_intent(question, metadata)
    
    print(f"Query: {question}")
    print(f"Metadata entities: {metadata['entities']}")
    print(f"Classified intent: {result}")
    
    # This SHOULD trigger similar_incidents via context boost (no explicit intent)
    assert result == 'similar_incidents', \
        f"Expected 'similar_incidents' for generic search query, got '{result}'"
    print("✓ Context boost still works when no explicit intent keywords\n")


def test_no_context_boost_without_metadata():
    """Without metadata, "related to" should trigger pattern-based similar_incidents"""
    question = "Show me incidents related to MIB requirement"
    
    result = classify_intent(question, metadata=None)
    
    print(f"Query: {question}")
    print(f"Metadata: None")
    print(f"Classified intent: {result}")
    
    # Should match the pattern: "incidents? (?:related to|about|...)"
    assert result == 'similar_incidents', \
        f"Expected 'similar_incidents' from pattern match, got '{result}'"
    print("✓ Pattern matching works without metadata\n")


def test_single_incident_context():
    """Queries about 'THE incident' (singular) should prioritize work notes over similar incidents"""
    
    test_cases = [
        ("What is the root cause of THE incident related to MIB?", 'resolution_progress'),
        ("Provide root cause analysis for THE incident about MIB requirement", 'resolution_progress'),
        ("What workaround is available for THE incident related to MIB?", 'resolution_progress'),
        ("How is THE incident related to MIB being resolved?", 'resolution_progress'),
    ]
    
    metadata = {
        'entities': {
            'topics': ['MIB requirement']
        }
    }
    
    for question, expected_intent in test_cases:
        result = classify_intent(question, metadata)
        
        print(f"Query: {question}")
        print(f"Expected: {expected_intent}, Got: {result}")
        
        assert result == expected_intent, \
            f"Query '{question}' should be '{expected_intent}', got '{result}'"
        print("✓ Pass\n")


def test_multiple_incidents_context():
    """Queries about 'incidents' (plural) without explicit intent should use similar_incidents"""
    
    test_cases = [
        ("Show me incidents related to MIB requirement", 'similar_incidents'),
        ("Find incidents concerning MIB issues", 'similar_incidents'),
        ("Get incidents about MIB requirement problems", 'similar_incidents'),
    ]
    
    metadata = {
        'entities': {
            'topics': ['MIB requirement']
        }
    }
    
    for question, expected_intent in test_cases:
        result = classify_intent(question, metadata)
        
        print(f"Query: {question}")
        print(f"Expected: {expected_intent}, Got: {result}")
        
        assert result == expected_intent, \
            f"Query '{question}' should be '{expected_intent}', got '{result}'"
        print("✓ Pass\n")


if __name__ == '__main__':
    print("=" * 80)
    print("Testing: Explicit Intent Priority Over Context Boost")
    print("=" * 80 + "\n")
    
    try:
        test_root_cause_overrides_context_boost()
        test_workaround_overrides_context_boost()
        test_assignment_overrides_context_boost()
        test_context_boost_still_works_without_explicit_intent()
        test_no_context_boost_without_metadata()
        test_single_incident_context()
        test_multiple_incidents_context()
        
        print("=" * 80)
        print("✅ ALL TESTS PASSED")
        print("=" * 80)
        print("\nSummary:")
        print("- Explicit intents (root cause, workaround, assignment) override context boost ✓")
        print("- Context boost still works for generic search queries ✓")
        print("- Single incident queries prioritize work notes over similar incidents ✓")
        print("- Multiple incident queries use similar incidents appropriately ✓")
        
    except AssertionError as e:
        print("=" * 80)
        print(f"❌ TEST FAILED: {e}")
        print("=" * 80)
        sys.exit(1)
