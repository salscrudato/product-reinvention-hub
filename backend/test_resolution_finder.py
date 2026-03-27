"""
Test script for find_resolutions_from_similar_incidents functionality.

This demonstrates the similarity-based resolution discovery workflow:
1. Takes incident(s) from context
2. Finds similar RESOLVED incidents using embedding search (with cache!)
3. Extracts workarounds/resolutions from those similar incidents
4. Returns recommended actions based on what worked

Run: python test_resolution_finder.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from components.servicenowgenaitool import find_resolutions_from_similar_incidents_core

def test_resolution_finder():
    """Test finding resolutions from similar incidents."""
    
    print("\n" + "="*80)
    print("RESOLUTION FINDER FROM SIMILAR INCIDENTS TEST")
    print("="*80)
    
    # Test with a sample incident (replace with real incident number)
    test_incidents = ["INC0010001"]  # Replace with actual incident number from your ServiceNow
    
    print(f"\n🔍 Context Incidents: {', '.join(test_incidents)}")
    print(f"   Looking for similar RESOLVED incidents and their resolutions...")
    
    try:
        result = find_resolutions_from_similar_incidents_core(
            incident_numbers=test_incidents,
            max_similar_per_incident=5,
            include_active_incidents=False
        )
        
        if result.get('error'):
            print(f"\n❌ Error: {result['error']}")
            return
        
        print(f"\n📊 Results:")
        print(f"   Context incidents analyzed: {len(result['context_incidents'])}")
        print(f"   Similar incidents found: {result['similar_incidents_found']}")
        print(f"   Resolved incidents analyzed: {result['resolved_incidents_analyzed']}")
        
        summary = result.get('summary', '')
        if summary:
            print(f"\n📝 Executive Summary:")
            print(f"   {summary}")
        
        # Resolution Patterns
        patterns = result.get('resolution_patterns', [])
        if patterns:
            print(f"\n✅ Resolution Patterns Found: {len(patterns)}")
            for i, pattern in enumerate(patterns[:5], 1):
                print(f"\n   {i}. {pattern.get('solution', 'N/A')}")
                print(f"      Type: {pattern.get('type', 'unknown')}")
                print(f"      Used in: {len(pattern.get('incidents', []))} incident(s)")
                print(f"      Frequency: {pattern.get('frequency', 0)}")
                success = pattern.get('success_indicators', '')
                if success:
                    print(f"      Success: {success[:100]}...")
        
        # Recommended Actions
        recommendations = result.get('recommended_actions', [])
        if recommendations:
            print(f"\n🎯 Recommended Actions (Top {len(recommendations[:3])}):")
            for i, rec in enumerate(recommendations[:3], 1):
                print(f"\n   {rec.get('rank', i)}. {rec.get('action', 'N/A')}")
                print(f"      Type: {rec.get('type', 'unknown')}")
                rationale = rec.get('rationale', '')
                if rationale:
                    print(f"      Why: {rationale}")
                time_est = rec.get('estimated_time', '')
                if time_est:
                    print(f"      ETA: {time_est}")
        
        # Solution Categories
        categories = result.get('solution_categories', [])
        if categories:
            print(f"\n📋 Solution Categories:")
            for cat in categories:
                print(f"   - {cat.get('category', 'Unknown')}: {cat.get('count', 0)} solutions")
                examples = cat.get('examples', [])
                if examples:
                    for ex in examples[:2]:
                        print(f"     • {ex}")
        
        # Key Insights
        insights = result.get('key_insights', [])
        if insights:
            print(f"\n💡 Key Insights:")
            for insight in insights[:5]:
                print(f"   • {insight}")
        
        # Similar Incident Details (per context incident)
        details = result.get('similar_incident_details', [])
        if details:
            print(f"\n📑 Similar Incident Breakdown:")
            for ctx in details[:3]:
                print(f"\n   Context: {ctx['incident_number']}")
                print(f"   Description: {ctx.get('short_description', 'N/A')[:60]}...")
                print(f"   Similar resolved incidents found: {ctx.get('resolved_count', 0)}")
                
                for sim in ctx.get('similar_incidents', [])[:3]:
                    print(f"      → {sim['number']} (similarity: {sim['similarity_score']:.2f})")
                    if sim.get('has_workaround'):
                        print(f"         ✓ Has documented workaround")
        
    except Exception as e:
        print(f"\n❌ Error during test: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "="*80)
    print("USAGE IN QUERIES:")
    print("="*80)
    print("""
When user asks these questions, use find_resolutions_from_similar_incidents:

1. "What are the workarounds for incidents like INC0010001?"
   → Finds similar resolved incidents and extracts their workarounds

2. "How were similar authentication issues resolved?"
   → Searches for similar "authentication" incidents, shows resolutions

3. "What worked for incidents similar to mine?"
   → Uses context incidents, finds similar resolved cases

4. "Show me solutions from similar server outage incidents"
   → Finds similar "server outage" incidents, extracts solutions

5. "I have INC001,INC002,INC003 - what resolutions worked for similar cases?"
   → Analyzes all 3 context incidents, finds similar resolved incidents for each
    """)
    print("="*80 + "\n")

if __name__ == "__main__":
    test_resolution_finder()
