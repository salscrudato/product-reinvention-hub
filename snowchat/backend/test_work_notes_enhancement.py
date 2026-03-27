"""
Test script to verify the enhanced work notes summarization.

This script tests that:
1. Individual work notes summaries extract problem/solution/learning
2. Bulk analysis extracts solutions even when "workaround" isn't explicitly mentioned
3. Problem patterns are identified from work notes
4. Key learnings are extracted
"""

from components.servicenowgenaitool import summarize_work_notes_core, analyze_bulk_work_notes_core
import json

print("="*80)
print("TESTING ENHANCED WORK NOTES SUMMARIZATION")
print("="*80)

# Test 1: Individual incident work notes summary
print("\n1. Testing individual incident work notes summary...")
print("-"*80)

# Use a real incident number from the chat history
test_incident = "INC0012373"
print(f"Fetching work notes summary for {test_incident}...")

try:
    summary = summarize_work_notes_core(test_incident, max_notes=10, llm_summary=True)
    
    if summary.get("error"):
        print(f"❌ Error: {summary['error']}")
    else:
        print(f"✅ Successfully retrieved {summary.get('count', 0)} work notes")
        print("\nSummary:")
        print(summary.get('summary', 'No summary'))
        print("\nKey Insights:")
        for insight in summary.get('key_insights', []):
            print(f"  - {insight}")
except Exception as e:
    print(f"❌ Exception: {e}")

# Test 2: Bulk analysis with workaround_focus
print("\n\n2. Testing bulk analysis with workaround_focus...")
print("-"*80)

# Use a small set of incidents from chat history
test_incidents = [
    "INC0012373", "INC0012050", "INC0012047", "INC0011995", "INC0012282"
]
print(f"Analyzing {len(test_incidents)} incidents...")

try:
    bulk_result = analyze_bulk_work_notes_core(
        incident_numbers=test_incidents,
        max_concurrent=5,
        aggregation_level="workaround_focus",
        persona="product_owner",
        sample_size=None
    )
    
    if bulk_result.get("error"):
        print(f"❌ Error: {bulk_result['error']}")
    else:
        print(f"✅ Successfully analyzed {bulk_result.get('incidents_analyzed', 0)} incidents")
        print(f"\nExecutive Summary:")
        print(bulk_result.get('executive_summary', 'No summary'))
        
        print(f"\n📊 Statistics:")
        print(f"  - Total incidents: {bulk_result.get('incident_count', 0)}")
        print(f"  - Analyzed: {bulk_result.get('incidents_analyzed', 0)}")
        print(f"  - Failed: {bulk_result.get('incidents_failed', 0)}")
        
        doc_gaps = bulk_result.get('documentation_gaps', {})
        print(f"\n📝 Documentation Gaps:")
        print(f"  - Missing workarounds: {doc_gaps.get('missing_workaround_pct', 0)}%")
        print(f"  - Missing root cause: {doc_gaps.get('missing_root_cause_pct', 0)}%")
        print(f"  - Missing resolution: {doc_gaps.get('missing_resolution_pct', 0)}%")
        
        # Check for new fields
        if bulk_result.get('solutions_summary'):
            print(f"\n✅ Solutions Summary (NEW): {len(bulk_result['solutions_summary'])} solutions found")
            for sol in bulk_result['solutions_summary'][:3]:
                print(f"  - {sol.get('solution', 'N/A')[:100]}...")
        else:
            print(f"\n⚠️  No solutions_summary in result")
        
        if bulk_result.get('problem_patterns'):
            print(f"\n✅ Problem Patterns (NEW): {len(bulk_result['problem_patterns'])} patterns found")
            for pattern in bulk_result['problem_patterns'][:3]:
                print(f"  - Problem: {pattern.get('problem', 'N/A')[:80]}...")
        else:
            print(f"\n⚠️  No problem_patterns in result")
        
        if bulk_result.get('key_learnings'):
            print(f"\n✅ Key Learnings (NEW): {len(bulk_result['key_learnings'])} learnings")
            for learning in bulk_result['key_learnings'][:3]:
                print(f"  - {learning[:100]}...")
        else:
            print(f"\n⚠️  No key_learnings in result")
        
        print(f"\n📌 Actionable Insights:")
        for insight in bulk_result.get('actionable_insights', [])[:3]:
            priority = insight.get('priority', 'unknown')
            text = insight.get('insight', 'N/A')
            print(f"  [{priority.upper()}] {text}")

except Exception as e:
    print(f"❌ Exception: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "="*80)
print("TEST COMPLETE")
print("="*80)
