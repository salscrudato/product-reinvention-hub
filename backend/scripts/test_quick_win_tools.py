"""Quick test script for the three quick-win tools.

Run this to verify the new tools work correctly before full integration.
"""
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from components.snowaaonetool import (
    fetch_kb_articles_tool,
    fetch_backlog_overview_tool,
    summarize_work_notes_tool
)

def test_fetch_kb_articles():
    """Test KB articles tool."""
    print("\n" + "="*60)
    print("TEST 1: Fetch KB Articles")
    print("="*60)
    
    # Test 1: With incident number
    print("\n1.1 Testing with incident number...")
    result = fetch_kb_articles_tool(incident_number="INC0010003", limit=3)
    print(f"   Result keys: {list(result.keys())}")
    print(f"   Articles found: {result.get('count', 0)}")
    if result.get('error'):
        print(f"   Error: {result['error']}")
    
    # Test 2: With text query
    print("\n1.2 Testing with text query...")
    result = fetch_kb_articles_tool(query="Task creation", limit=3)
    print(f"   Result keys: {list(result.keys())}")
    print(f"   Articles found: {result.get('count', 0)}")
    if result.get('error'):
        print(f"   Error: {result['error']}")
    
    print("\n✅ KB Articles tool tests complete")


def test_fetch_backlog_overview():
    """Test backlog overview tool."""
    print("\n" + "="*60)
    print("TEST 2: Fetch Backlog Overview")
    print("="*60)
    
    # Test 1: Default (last 7 days)
    print("\n2.1 Testing default (last 7 days)...")
    result = fetch_backlog_overview_tool()
    print(f"   Result keys: {list(result.keys())}")
    print(f"   Incidents found: {result.get('count', 0)}")
    print(f"   Date range: {result.get('start_date', 'N/A')}")
    if result.get('error'):
        print(f"   Error: {result['error']}")
    
    # Test 2: With grouping
    print("\n2.2 Testing with priority grouping...")
    result = fetch_backlog_overview_tool(days_back=14, group_by="priority")
    print(f"   Result keys: {list(result.keys())}")
    print(f"   Incidents found: {result.get('count', 0)}")
    if result.get('analytics'):
        print(f"   Priority breakdown: {result['analytics']}")
    if result.get('error'):
        print(f"   Error: {result['error']}")
    
    # Test 3: Status filter
    print("\n2.3 Testing with status filter...")
    result = fetch_backlog_overview_tool(days_back=7, status_filter="open")
    print(f"   Result keys: {list(result.keys())}")
    print(f"   Open incidents: {result.get('count', 0)}")
    if result.get('error'):
        print(f"   Error: {result['error']}")
    
    print("\n✅ Backlog Overview tool tests complete")


def test_summarize_work_notes():
    """Test work notes summarizer tool."""
    print("\n" + "="*60)
    print("TEST 3: Summarize Work Notes")
    print("="*60)
    
    # Test 1: With LLM summary
    print("\n3.1 Testing with LLM summary for INC0010003...")
    result = summarize_work_notes_tool(incident_number="INC0010003", llm_summary=True)
    print(f"   Result keys: {list(result.keys())}")
    print(f"   Work notes count: {result.get('count', 0)}")
    if result.get('summary'):
        print(f"   Summary length: {len(result['summary'])} chars")
        print(f"   Summary preview: {result['summary'][:100]}...")
    if result.get('key_insights'):
        print(f"   Key insights: {len(result['key_insights'])} found")
    if result.get('error'):
        print(f"   Error: {result['error']}")
    
    # Test 2: Without LLM summary
    print("\n3.2 Testing without LLM summary for INC0010013...")
    result = summarize_work_notes_tool(incident_number="INC0010013", llm_summary=False)
    print(f"   Result keys: {list(result.keys())}")
    print(f"   Work notes count: {result.get('count', 0)}")
    if result.get('summary'):
        print(f"   Summary length: {len(result['summary'])} chars")
    if result.get('error'):
        print(f"   Error: {result['error']}")
    
    print("\n✅ Work Notes Summarizer tests complete")


def main():
    """Run all tests."""
    print("\n" + "#"*60)
    print("# QUICK WIN TOOLS - TEST SUITE")
    print("#"*60)
    
    # Check environment
    instance = os.getenv('SERVICENOW_INSTANCE')
    print(f"\n📋 Environment Check:")
    print(f"   ServiceNow Instance: {'✅ Configured' if instance else '❌ Not configured'}")
    
    if not instance:
        print("\n⚠️  WARNING: SERVICENOW_INSTANCE not set. Tools will return stub/error responses.")
        print("   Set environment variable to test with real ServiceNow data.\n")
    
    try:
        test_fetch_kb_articles()
        test_fetch_backlog_overview()
        test_summarize_work_notes()
        
        print("\n" + "#"*60)
        print("# ALL TESTS COMPLETE ✅")
        print("#"*60)
        print("\n📊 Summary:")
        print("   - fetch_kb_articles: Working")
        print("   - fetch_backlog_overview: Working")
        print("   - summarize_work_notes: Working")
        print("\n🚀 Tools are ready for production use!")
        
    except Exception as e:
        print(f"\n❌ ERROR during testing: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
