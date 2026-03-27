"""Test hybrid intent classifier with sample queries."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from components.intent_classifier_hybrid import HybridIntentClassifier

def test_classifier():
    """Test hybrid classifier with various queries."""
    
    print("="*80)
    print("HYBRID INTENT CLASSIFIER TEST")
    print("="*80)
    
    # Initialize classifier
    classifier = HybridIntentClassifier()
    
    # Print stats
    stats = classifier.get_stats()
    print(f"\nClassifier Status:")
    print(f"  ML Enabled: {stats['ml_enabled']}")
    print(f"  Regex Enabled: {stats['regex_enabled']}")
    print(f"  Confidence Threshold: {stats['confidence_threshold']}")
    
    if 'ml_metadata' in stats:
        ml_meta = stats['ml_metadata']
        print(f"\nML Model Info:")
        print(f"  Training Accuracy: {ml_meta.get('train_accuracy', 0):.1%}")
        print(f"  Test Accuracy: {ml_meta.get('test_accuracy', 0):.1%}")
        print(f"  Intents Supported: {ml_meta.get('num_intents', 0)}")
        print(f"  Training Examples: {ml_meta.get('num_training_examples', 0)}")
    
    # Test queries
    test_queries = [
        ("What is the summary of INC0010001?", {"persona": "developer"}),
        ("How many incidents were created today?", {"persona": "product_owner"}),
        ("Show me all incidents for the last 7 days", {"persona": "product_owner"}),
        ("@wiki what are coverage limits?", {"persona": "developer"}),
        ("Get me similar incidents to INC0010003", {"persona": "developer"}),
        ("What are the work notes for this incident?", {"persona": "product_owner"}),
        ("Summarize user story IN-5", {"persona": "developer"}),
        ("This is a completely new type of query", {"persona": "unknown"}),
    ]
    
    print("\n" + "="*80)
    print("CLASSIFICATION RESULTS")
    print("="*80)
    
    for query, metadata in test_queries:
        intent, class_meta = classifier.classify(query, metadata)
        
        print(f"\nQuery: {query}")
        print(f"Persona: {metadata.get('persona', 'unknown')}")
        print(f"→ Intent: {intent}")
        print(f"  Method: {class_meta.get('method', 'unknown')}")
        
        if 'ml_confidence' in class_meta:
            print(f"  ML Confidence: {class_meta['ml_confidence']:.2%}")
        if 'ml_intent' in class_meta:
            print(f"  ML Predicted: {class_meta['ml_intent']}")
        if 'regex_intent' in class_meta:
            print(f"  Regex Predicted: {class_meta['regex_intent']}")


if __name__ == '__main__':
    test_classifier()
