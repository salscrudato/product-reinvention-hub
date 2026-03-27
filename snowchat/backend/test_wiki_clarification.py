"""
Test script for Wiki Clarification Engine

Tests the enhanced Wiki RAG workflow with clarification.
Run: python test_wiki_clarification.py
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from components.wiki_clarification_engine import (
    WikiClarificationEngine,
    should_clarify_wiki_request,
    generate_wiki_clarification,
    get_wiki_clarification_engine
)

def test_clarity_analysis_generic():
    """Test that generic requests need clarification."""
    print("\n" + "="*60)
    print("TEST 1: Generic Request Analysis")
    print("="*60)
    
    engine = WikiClarificationEngine()
    question = "Can you check the wiki?"
    context = []
    
    result = engine.analyze_wiki_request_clarity(question, context)
    
    print(f"Question: {question}")
    print(f"Needs Clarification: {result['needs_clarification']}")
    print(f"Clarity Score: {result['clarity_score']:.2f}")
    print(f"Detected Topics: {result['detected_topics']}")
    print(f"Detected Keywords: {result['detected_keywords']}")
    print(f"Reason: {result['reason']}")
    
    assert result['needs_clarification'] == True, "Generic request should need clarification"
    assert result['clarity_score'] < 0.3, f"Score {result['clarity_score']} too high for generic request"
    print("\n✓ PASSED")


def test_clarity_analysis_specific():
    """Test that specific requests don't need clarification."""
    print("\n" + "="*60)
    print("TEST 2: Specific Request Analysis")
    print("="*60)
    
    engine = WikiClarificationEngine()
    question = "How to configure APS settings for production deployment?"
    context = []
    
    result = engine.analyze_wiki_request_clarity(question, context)
    
    print(f"Question: {question}")
    print(f"Needs Clarification: {result['needs_clarification']}")
    print(f"Clarity Score: {result['clarity_score']:.2f}")
    print(f"Detected Topics: {result['detected_topics']}")
    print(f"Detected Keywords: {result['detected_keywords']}")
    print(f"Reason: {result['reason']}")
    
    assert result['needs_clarification'] == False, "Specific request should NOT need clarification"
    assert result['clarity_score'] >= 0.5, f"Score {result['clarity_score']} too low for specific request"
    assert 'configuration' in result['detected_topics'], "Should detect 'configuration' topic"
    assert 'aps' in result['detected_keywords'], "Should detect 'aps' keyword"
    print("\n✓ PASSED")


def test_context_extraction():
    """Test extraction of incidents and keywords from context."""
    print("\n" + "="*60)
    print("TEST 3: Context Entity Extraction")
    print("="*60)
    
    engine = WikiClarificationEngine()
    question = "What documentation do we have about this?"
    context = [
        {"content": "I'm working on incident INC0010003"},
        {"content": "The work notes mention APS requirement and DHD order"},
        {"content": "We need to do MRIO manual update"}
    ]
    
    result = engine.analyze_wiki_request_clarity(question, context)
    
    print(f"Question: {question}")
    print(f"Context Messages: {len(context)}")
    print(f"Extracted Incidents: {result['context_entities']['incidents']}")
    print(f"Extracted Terms: {result['context_entities']['mentioned_terms']}")
    print(f"Clarity Score: {result['clarity_score']:.2f}")
    
    assert 'INC0010003' in result['context_entities']['incidents'], "Should extract incident number"
    assert 'aps' in result['context_entities']['mentioned_terms'], "Should extract 'aps' term"
    assert 'dhd' in result['context_entities']['mentioned_terms'], "Should extract 'dhd' term"
    assert 'mrio' in result['context_entities']['mentioned_terms'], "Should extract 'mrio' term"
    print("\n✓ PASSED")


def test_clarification_generation():
    """Test generation of clarification questions."""
    print("\n" + "="*60)
    print("TEST 4: Clarification Question Generation")
    print("="*60)
    
    engine = WikiClarificationEngine()
    question = "Search the wiki"
    context = []
    
    analysis = engine.analyze_wiki_request_clarity(question, context)
    clarification = engine.generate_clarification_questions(question, analysis)
    
    print(f"Question: {question}")
    print(f"Clarification Text:\n{clarification['clarification_text']}")
    print(f"\nNumber of Options: {len(clarification['suggested_options'])}")
    print(f"State ID: {clarification['state_id']}")
    
    for i, opt in enumerate(clarification['suggested_options'][:3], 1):
        print(f"  {i}. {opt['label']}")
    
    assert clarification['clarification_text'] is not None, "Should generate clarification text"
    assert len(clarification['suggested_options']) >= 5, "Should have at least 5 options"
    assert clarification['state_id'].startswith('wiki_clarify_'), "State ID should have correct prefix"
    print("\n✓ PASSED")


def test_clarification_response_processing():
    """Test processing of user's clarification response."""
    print("\n" + "="*60)
    print("TEST 5: Clarification Response Processing")
    print("="*60)
    
    engine = WikiClarificationEngine()
    question = "Check wiki for info"
    context = [{"content": "Working on INC0010003 with APS requirements"}]
    
    # Generate clarification
    analysis = engine.analyze_wiki_request_clarity(question, context)
    clarification = engine.generate_clarification_questions(question, analysis)
    state_id = clarification['state_id']
    
    print(f"Original Question: {question}")
    print(f"State ID: {state_id}")
    
    # Simulate user selecting option 1 (or providing custom text)
    user_response = "1"
    print(f"User Response: {user_response}")
    
    refined = engine.process_clarification_response(state_id, user_response)
    
    print(f"\nRefined Question: {refined['refined_question'][:100]}...")
    print(f"Search Keywords: {refined['search_keywords']}")
    print(f"Search Filters: {refined['search_filters']}")
    print(f"Has Correlation Context: {len(refined['correlation_context']) > 0}")
    
    assert len(refined['refined_question']) > len(question), "Refined question should be longer"
    assert refined['correlation_context'] is not None, "Should have correlation context"
    print("\n✓ PASSED")


def test_convenience_functions():
    """Test convenience functions for orchestrator integration."""
    print("\n" + "="*60)
    print("TEST 6: Convenience Functions")
    print("="*60)
    
    question1 = "search wiki"
    question2 = "How to configure APS with step-by-step procedure for production environment?"
    context = []
    
    result1 = should_clarify_wiki_request(question1, context)
    result2 = should_clarify_wiki_request(question2, context)
    
    print(f"Generic question '{question1[:30]}...'")
    print(f"  Should clarify: {result1}")
    
    print(f"\nSpecific question '{question2[:40]}...'")
    print(f"  Should clarify: {result2}")
    
    assert result1 == True, "Generic question should need clarification"
    assert result2 == False, "Highly specific question should NOT need clarification"
    
    # Test clarification generation
    clarification = generate_wiki_clarification(question1, context)
    print(f"\nGenerated clarification has {len(clarification['suggested_options'])} options")
    
    assert 'clarification_text' in clarification, "Should return clarification structure"
    print("\n✓ PASSED")


def run_all_tests():
    """Run all tests."""
    print("\n" + "#"*60)
    print("# Wiki Clarification Engine - Test Suite")
    print("#"*60)
    
    tests = [
        test_clarity_analysis_generic,
        test_clarity_analysis_specific,
        test_context_extraction,
        test_clarification_generation,
        test_clarification_response_processing,
        test_convenience_functions
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"\n✗ FAILED: {str(e)}")
            failed += 1
        except Exception as e:
            print(f"\n✗ ERROR: {str(e)}")
            import traceback
            traceback.print_exc()
            failed += 1
    
    print("\n" + "#"*60)
    print(f"# Test Results: {passed} passed, {failed} failed")
    print("#"*60 + "\n")
    
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
