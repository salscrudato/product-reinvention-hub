"""Analyze extracted training data for quality and patterns.

Usage:
    python scripts/analyze_training_data.py
"""

import json
import sys
from pathlib import Path
from collections import Counter, defaultdict
import re

sys.path.insert(0, str(Path(__file__).parent.parent))


def load_data(path: Path):
    """Load training data JSON."""
    if not path.exists():
        print(f"ERROR: File not found: {path}")
        print("Run extract_training_data_from_logs.py first")
        sys.exit(1)
    
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def analyze_intent_classification(data):
    """Analyze intent classification quality."""
    print("\n" + "="*80)
    print("INTENT CLASSIFICATION ANALYSIS")
    print("="*80)
    
    intent_counts = Counter(ex['intent'] for ex in data)
    
    print(f"\nIntent Distribution ({len(data)} total examples):")
    for intent, count in intent_counts.most_common():
        pct = count / len(data) * 100
        bar = "█" * int(pct)
        print(f"  {intent:30s}: {count:4d} ({pct:5.1f}%) {bar}")
    
    # Check for class imbalance
    max_count = max(intent_counts.values())
    min_count = min(intent_counts.values())
    imbalance_ratio = max_count / min_count if min_count > 0 else float('inf')
    
    print(f"\nClass Imbalance:")
    print(f"  Max examples: {max_count}")
    print(f"  Min examples: {min_count}")
    print(f"  Imbalance ratio: {imbalance_ratio:.2f}x")
    
    if imbalance_ratio > 10:
        print("  ⚠️  WARNING: Severe class imbalance detected!")
        print("     Consider: Data augmentation, SMOTE, or class weights")
    elif imbalance_ratio > 5:
        print("  ⚠️  Moderate class imbalance")
    else:
        print("  ✅ Balanced dataset")
    
    # Unknown intents
    unknown = sum(1 for ex in data if ex['intent'] == 'unknown')
    if unknown > 0:
        print(f"\n  ⚠️  {unknown} examples with unknown intent ({unknown/len(data)*100:.1f}%)")


def analyze_query_patterns(data):
    """Analyze common query patterns."""
    print("\n" + "="*80)
    print("QUERY PATTERN ANALYSIS")
    print("="*80)
    
    # Feature statistics
    features = {
        'has_incident': 0,
        'has_timeframe': 0,
        'has_annotation': 0,
        'has_aggregation': 0,
        'has_vague_reference': 0
    }
    
    for ex in data:
        for key in features:
            if ex['features'].get(key):
                features[key] += 1
    
    print("\nQuery Features:")
    for feature, count in features.items():
        pct = count / len(data) * 100
        print(f"  {feature:25s}: {count:4d} ({pct:5.1f}%)")
    
    # Query length distribution
    lengths = [ex['features']['query_length'] for ex in data]
    avg_length = sum(lengths) / len(lengths)
    print(f"\nQuery Length:")
    print(f"  Average: {avg_length:.1f} words")
    print(f"  Min: {min(lengths)}")
    print(f"  Max: {max(lengths)}")
    
    # Common first words
    first_words = Counter()
    for ex in data:
        words = ex['query'].lower().split()
        if words:
            first_words[words[0]] += 1
    
    print(f"\nMost Common First Words:")
    for word, count in first_words.most_common(10):
        print(f"  {word:20s}: {count:4d}")


def analyze_tool_usage(data):
    """Analyze tool execution patterns."""
    print("\n" + "="*80)
    print("TOOL USAGE ANALYSIS")
    print("="*80)
    
    tool_counts = Counter()
    tool_success_rate = defaultdict(lambda: {'success': 0, 'total': 0})
    
    for ex in data:
        for tool in ex.get('tools_executed', []):
            tool_counts[tool] += 1
            
            # Track success rate
            if ex.get('plan_quality_score') is not None:
                tool_success_rate[tool]['total'] += 1
                if ex['plan_quality_score'] == 1.0:
                    tool_success_rate[tool]['success'] += 1
    
    print(f"\nMost Used Tools:")
    for tool, count in tool_counts.most_common(15):
        success_data = tool_success_rate[tool]
        if success_data['total'] > 0:
            success_pct = success_data['success'] / success_data['total'] * 100
            print(f"  {tool:40s}: {count:4d} uses, {success_pct:5.1f}% success")
        else:
            print(f"  {tool:40s}: {count:4d} uses")
    
    # Plan size distribution
    plan_sizes = [ex['num_tools'] for ex in data if ex['num_tools']]
    if plan_sizes:
        avg_size = sum(plan_sizes) / len(plan_sizes)
        print(f"\nPlan Size:")
        print(f"  Average tools: {avg_size:.1f}")
        print(f"  Min: {min(plan_sizes)}")
        print(f"  Max: {max(plan_sizes)}")
        
        size_dist = Counter(plan_sizes)
        print(f"\nPlan Size Distribution:")
        for size, count in sorted(size_dist.items()):
            pct = count / len(plan_sizes) * 100
            bar = "█" * int(pct / 2)
            print(f"  {size} tools: {count:4d} ({pct:5.1f}%) {bar}")


def analyze_plan_quality(data):
    """Analyze plan execution quality."""
    print("\n" + "="*80)
    print("PLAN QUALITY ANALYSIS")
    print("="*80)
    
    quality_scores = [ex['plan_quality_score'] for ex in data if ex['plan_quality_score'] is not None]
    
    if not quality_scores:
        print("  No quality scores available")
        return
    
    avg_quality = sum(quality_scores) / len(quality_scores)
    perfect_plans = sum(1 for s in quality_scores if s == 1.0)
    failed_plans = sum(1 for s in quality_scores if s == 0.0)
    
    print(f"\nExecution Quality:")
    print(f"  Average success rate: {avg_quality*100:.1f}%")
    print(f"  Perfect plans (100%): {perfect_plans} ({perfect_plans/len(quality_scores)*100:.1f}%)")
    print(f"  Failed plans (0%): {failed_plans} ({failed_plans/len(quality_scores)*100:.1f}%)")
    
    # Quality by intent
    intent_quality = defaultdict(list)
    for ex in data:
        if ex['plan_quality_score'] is not None:
            intent_quality[ex['intent']].append(ex['plan_quality_score'])
    
    print(f"\nQuality by Intent:")
    for intent, scores in sorted(intent_quality.items(), key=lambda x: -sum(x[1])/len(x[1])):
        avg = sum(scores) / len(scores) * 100
        print(f"  {intent:30s}: {avg:5.1f}% ({len(scores)} plans)")


def analyze_temporal_patterns(data):
    """Analyze time-based patterns."""
    print("\n" + "="*80)
    print("TEMPORAL PATTERN ANALYSIS")
    print("="*80)
    
    # Hour distribution
    hour_counts = Counter(ex['hour'] for ex in data)
    
    print(f"\nQueries by Hour of Day:")
    for hour in range(24):
        count = hour_counts.get(hour, 0)
        if count > 0:
            pct = count / len(data) * 100
            bar = "█" * int(pct)
            print(f"  {hour:02d}:00 - {count:4d} ({pct:5.1f}%) {bar}")
    
    # Day of week
    day_counts = Counter(ex['day_of_week'] for ex in data)
    day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    
    print(f"\nQueries by Day of Week:")
    for day in day_order:
        count = day_counts.get(day, 0)
        if count > 0:
            pct = count / len(data) * 100
            bar = "█" * int(pct / 2)
            print(f"  {day:10s}: {count:4d} ({pct:5.1f}%) {bar}")


def analyze_data_quality(data):
    """Check for data quality issues."""
    print("\n" + "="*80)
    print("DATA QUALITY CHECKS")
    print("="*80)
    
    issues = []
    
    # Check for missing intents
    unknown_intents = sum(1 for ex in data if ex['intent'] == 'unknown')
    if unknown_intents > 0:
        issues.append(f"⚠️  {unknown_intents} examples with unknown intent")
    
    # Check for empty queries
    empty_queries = sum(1 for ex in data if not ex['query'].strip())
    if empty_queries > 0:
        issues.append(f"⚠️  {empty_queries} examples with empty queries")
    
    # Check for duplicate queries
    query_counts = Counter(ex['query'] for ex in data)
    duplicates = sum(1 for count in query_counts.values() if count > 1)
    if duplicates > 0:
        issues.append(f"ℹ️  {duplicates} duplicate queries (might be legitimate)")
    
    # Check for missing execution data
    missing_execution = sum(1 for ex in data if ex['execution_successes'] is None)
    if missing_execution > 0:
        issues.append(f"ℹ️  {missing_execution} examples without execution results")
    
    if issues:
        print("\nIssues Found:")
        for issue in issues:
            print(f"  {issue}")
    else:
        print("\n✅ No data quality issues detected")
    
    # Sample queries for manual review
    print(f"\nSample Queries (first 5):")
    for i, ex in enumerate(data[:5], 1):
        print(f"\n  {i}. {ex['query']}")
        print(f"     Intent: {ex['intent']}, Persona: {ex['persona']}")
        if ex['tools_executed']:
            print(f"     Tools: {', '.join(ex['tools_executed'])}")


def main():
    """Main execution."""
    data_path = Path(__file__).parent.parent / 'training_data_extracted.json'
    
    print("Loading training data...")
    data = load_data(data_path)
    
    print(f"\nLoaded {len(data)} training examples")
    
    # Run all analyses
    analyze_intent_classification(data)
    analyze_query_patterns(data)
    analyze_tool_usage(data)
    analyze_plan_quality(data)
    analyze_temporal_patterns(data)
    analyze_data_quality(data)
    
    # Summary and recommendations
    print("\n" + "="*80)
    print("RECOMMENDATIONS")
    print("="*80)
    
    if len(data) < 100:
        print("\n⚠️  Dataset is small (<100 examples)")
        print("   → Collect more data before training ML model")
        print("   → Consider using current regex system as baseline")
    elif len(data) < 500:
        print("\n✅ Dataset size is adequate for initial training")
        print("   → Use RandomForest or simple neural network")
        print("   → Implement k-fold cross-validation")
        print("   → Monitor for overfitting")
    else:
        print("\n✅ Dataset size is good for ML training")
        print("   → Can experiment with more complex models")
        print("   → Consider ensemble methods")
    
    intent_counts = Counter(ex['intent'] for ex in data)
    if len(intent_counts) > 20:
        print("\n⚠️  Many intent classes detected")
        print("   → Consider grouping similar intents")
        print("   → Use hierarchical classification")


if __name__ == '__main__':
    main()
