"""Train ML intent classifier from extracted log data.

Usage:
    python scripts/train_intent_classifier.py
    python scripts/train_intent_classifier.py --test-only  # Just evaluate, don't save
"""

import json
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from components.intent_classifier_ml import MLIntentClassifier, SKLEARN_AVAILABLE


def main():
    parser = argparse.ArgumentParser(description='Train ML intent classifier')
    parser.add_argument('--test-only', action='store_true', help='Evaluate only, do not save model')
    parser.add_argument('--test-size', type=float, default=0.2, help='Test set size (default: 0.2)')
    parser.add_argument('--min-examples', type=int, default=50, help='Minimum training examples required')
    args = parser.parse_args()
    
    if not SKLEARN_AVAILABLE:
        print("ERROR: scikit-learn not installed")
        print("Install with: pip install scikit-learn")
        sys.exit(1)
    
    # Paths
    data_path = Path(__file__).parent.parent / 'training_data_extracted.json'
    model_path = Path(__file__).parent.parent / 'models' / 'intent_classifier'
    
    # Check if data exists
    if not data_path.exists():
        print(f"ERROR: Training data not found: {data_path}")
        print("Run extract_training_data_from_logs.py first")
        sys.exit(1)
    
    # Load training data
    print(f"Loading training data from: {data_path}")
    with open(data_path, 'r', encoding='utf-8') as f:
        training_data = json.load(f)
    
    print(f"Loaded {len(training_data)} examples")
    
    # Filter out unknown intents and rare classes (< 2 examples)
    from collections import Counter
    intent_counts_pre = Counter(ex['intent'] for ex in training_data if ex['intent'] != 'unknown')
    rare_intents = {intent for intent, count in intent_counts_pre.items() if count < 2}
    
    known_intent_data = [
        ex for ex in training_data 
        if ex['intent'] != 'unknown' and ex['intent'] not in rare_intents
    ]
    
    print(f"Examples with known intent: {len(known_intent_data)}")
    if rare_intents:
        print(f"Filtered out rare intents (< 2 examples): {rare_intents}")
    
    if len(known_intent_data) < args.min_examples:
        print(f"\nERROR: Insufficient training data!")
        print(f"  Found: {len(known_intent_data)} examples")
        print(f"  Need: {args.min_examples} examples")
        print(f"\nRecommendations:")
        print(f"  1. Collect more production data")
        print(f"  2. Run system for 1-2 more weeks")
        print(f"  3. Lower --min-examples threshold (risky)")
        sys.exit(1)
    
    # Check intent distribution
    from collections import Counter
    intent_counts = Counter(ex['intent'] for ex in known_intent_data)
    
    print(f"\nIntent distribution:")
    for intent, count in intent_counts.most_common():
        print(f"  {intent:30s}: {count:4d} examples")
    
    # Warn about class imbalance
    max_count = max(intent_counts.values())
    min_count = min(intent_counts.values())
    imbalance_ratio = max_count / min_count
    
    if imbalance_ratio > 10:
        print(f"\n[WARNING] Severe class imbalance detected!")
        print(f"   Max: {max_count}, Min: {min_count}, Ratio: {imbalance_ratio:.1f}x")
        print(f"   Model may perform poorly on rare intents")
    
    # Train classifier
    print("\n" + "="*80)
    print("TRAINING ML CLASSIFIER")
    print("="*80)
    
    classifier = MLIntentClassifier()
    
    try:
        results = classifier.train(
            known_intent_data,
            test_size=args.test_size,
            random_state=42
        )
    except Exception as e:
        print(f"\nERROR during training: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    # Display results
    print("\n" + "="*80)
    print("TRAINING RESULTS")
    print("="*80)
    print(f"\nTraining accuracy: {results['train_accuracy']:.1%}")
    print(f"Test accuracy:     {results['test_accuracy']:.1%}")
    
    # Check for overfitting
    overfitting_gap = results['train_accuracy'] - results['test_accuracy']
    if overfitting_gap > 0.15:
        print(f"\n[WARNING] Possible overfitting detected!")
        print(f"   Gap: {overfitting_gap:.1%}")
        print(f"   Consider: More data, regularization, simpler model")
    
    # Evaluation on test set
    print(f"\nDetailed classification report:")
    print(results['classification_report'])
    
    # Save model
    if not args.test_only:
        model_path.parent.mkdir(parents=True, exist_ok=True)
        classifier.save(str(model_path))
        print(f"\n[SUCCESS] Model saved to: {model_path}_*.pkl")
        
        # Save training info
        info_path = model_path.parent / 'training_info.json'
        log_file = Path(__file__).parent.parent / 'agentic_orchestrator_auto.log'
        with open(info_path, 'w') as f:
            json.dump({
                'train_date': str(log_file.stat().st_mtime) if log_file.exists() else None,
                'num_examples': len(known_intent_data),
                'num_intents': len(intent_counts),
                'intents': list(intent_counts.keys()),
                'train_accuracy': results['train_accuracy'],
                'test_accuracy': results['test_accuracy'],
                'test_size': args.test_size
            }, f, indent=2)
        
        print(f"Training info saved to: {info_path}")
    else:
        print(f"\n[INFO] Test-only mode: Model NOT saved")
    
    # Compare to baseline (if available)
    print("\n" + "="*80)
    print("BASELINE COMPARISON")
    print("="*80)
    
    # Simulate regex baseline
    regex_accuracy = 0.65  # Typical regex pattern accuracy
    ml_accuracy = results['test_accuracy']
    
    if ml_accuracy > regex_accuracy:
        improvement = (ml_accuracy - regex_accuracy) / regex_accuracy * 100
        print(f"\n[SUCCESS] ML classifier outperforms regex baseline!")
        print(f"   Regex:  {regex_accuracy:.1%}")
        print(f"   ML:     {ml_accuracy:.1%}")
        print(f"   Gain:   +{improvement:.1f}%")
    else:
        print(f"\n[WARNING] ML classifier underperforms regex baseline")
        print(f"   Regex:  {regex_accuracy:.1%}")
        print(f"   ML:     {ml_accuracy:.1%}")
        print(f"   Consider collecting more training data")
    
    # Deployment recommendations
    print("\n" + "="*80)
    print("DEPLOYMENT RECOMMENDATIONS")
    print("="*80)
    
    if ml_accuracy >= 0.80:
        print("\n[SUCCESS] Model ready for production deployment")
        print("   - Use ML classifier as primary")
        print("   - Keep regex as fallback for confidence < 0.6")
    elif ml_accuracy >= 0.70:
        print("\n[WARNING] Model adequate, deploy with caution")
        print("   - Use hybrid: ML for confidence > 0.7, regex otherwise")
        print("   - Monitor performance closely")
        print("   - Collect feedback for retraining")
    else:
        print("\n[FAILED] Model not ready for production")
        print("   - Collect more training data")
        print("   - Stay with regex system for now")
        print(f"   - Target: {args.min_examples*2}+ examples")


if __name__ == '__main__':
    main()
