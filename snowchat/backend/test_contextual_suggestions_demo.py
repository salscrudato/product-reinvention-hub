"""
Demo script showing contextual question suggester in action.
Simulates a multi-turn conversation with dynamic suggestions.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from components.contextual_question_suggester import get_contextual_suggester

def print_section(title):
    """Print formatted section header"""
    print("\n" + "="*80)
    print(f"  {title}")
    print("="*80 + "\n")

def print_suggestions(suggestions, mode):
    """Print suggestions in formatted list"""
    print(f"\n📋 Suggested Questions ({mode} mode):")
    for i, suggestion in enumerate(suggestions, 1):
        print(f"   {i}. {suggestion}")
    print()

def demo_conversation():
    """Demonstrate contextual suggestions across a conversation"""
    
    print_section("Contextual Question Suggester Demo")
    print("Simulating a 3-question conversation about incident backlog...")
    
    # Get suggester instance
    suggester = get_contextual_suggester()
    username = "demo@user.com"
    
    # =========================================================================
    # QUESTION 1: Backlog Overview
    # =========================================================================
    print_section("Q1: What are the top incidents in the backlog?")
    
    q1 = "What are the top incidents in the backlog?"
    a1 = """Found 13 high-priority incidents in the last 30 days:
    - 5 P1 incidents (Critical)
    - 6 P2 incidents (High)
    - 2 P3 incidents (Medium)
    
    Aging distribution:
    - 0-7 days: 4 incidents
    - 8-14 days: 5 incidents
    - 15-30 days: 4 incidents
    
    Oldest incident: INC0123456 (28 days old)
    Most affected component: Database
    """
    
    tool_outputs_q1 = {
        'fetch_backlog_overview': {
            'total_sampled': 13,
            'by_priority': {'P1': 5, 'P2': 6, 'P3': 2},
            'aging': {'0-7d': 4, '8-14d': 5, '15-30d': 4},
            'incidents': [f'INC012345{i}' for i in range(13)]
        }
    }
    
    # Add to history
    suggester.add_to_history(
        username=username,
        question=q1,
        answer=a1,
        intent='backlog_grooming',
        tool_outputs=tool_outputs_q1
    )
    
    print(f"User: {q1}")
    print(f"\nAI: {a1}")
    
    # Get suggestions (template mode for demo - no API key needed)
    suggestions_q1 = suggester.get_contextual_suggestions(
        username=username,
        limit=5,
        use_llm=False  # Template mode
    )
    print_suggestions(suggestions_q1, "template")
    
    # =========================================================================
    # QUESTION 2: List Those Incidents
    # =========================================================================
    print_section("Q2: List those incidents")
    
    q2 = "List those incidents"
    a2 = """Here are the 13 incidents from the backlog:

1. INC0123456 - Database connection timeout (P1) - 28 days old
2. INC0123457 - API rate limit exceeded (P1) - 25 days old
3. INC0123458 - Authentication failure (P2) - 22 days old
4. INC0123459 - Memory leak in processor (P1) - 20 days old
5. INC0123460 - Slow query performance (P2) - 18 days old
6. INC0123461 - Cache invalidation issue (P2) - 15 days old
7. INC0123462 - Service unavailable (P1) - 12 days old
8. INC0123463 - Data sync failure (P2) - 10 days old
9. INC0123464 - Configuration error (P3) - 8 days old
10. INC0123465 - Network connectivity (P2) - 6 days old
11. INC0123466 - Disk space alert (P3) - 5 days old
12. INC0123467 - Permission denied (P2) - 3 days old
13. INC0123468 - Backup failed (P1) - 1 day old

Note: Entity memory resolved "those incidents" to the 13 incidents from previous query.
"""
    
    tool_outputs_q2 = {
        'list_incidents': {
            'incidents': [
                {'number': f'INC012345{i}', 'priority': 'P1' if i < 5 else 'P2', 'age_days': 28 - i*2}
                for i in range(13)
            ]
        }
    }
    
    # Add to history
    suggester.add_to_history(
        username=username,
        question=q2,
        answer=a2,
        intent='incident_detail',
        tool_outputs=tool_outputs_q2
    )
    
    print(f"User: {q2}")
    print(f"\nAI: {a2}")
    
    # Get suggestions
    suggestions_q2 = suggester.get_contextual_suggestions(
        username=username,
        limit=5,
        use_llm=False  # Template mode
    )
    print_suggestions(suggestions_q2, "template")
    
    # =========================================================================
    # QUESTION 3: Root Cause Analysis
    # =========================================================================
    print_section("Q3: What's the root cause of the P1 incidents?")
    
    q3 = "What's the root cause of the P1 incidents?"
    a3 = """Root cause analysis of 5 P1 incidents:

Primary Root Cause: Database connection pool exhaustion
- 3 of 5 P1 incidents trace back to database connection issues
- Connection pool max size: 50 connections
- Peak usage observed: 48 connections (96% utilization)
- Recommendation: Increase pool size to 100 connections

Secondary Root Cause: Memory management
- 2 of 5 P1 incidents related to memory leaks
- Heap utilization reached 95% before crashes
- Identified leak in cache cleanup logic
- Fix deployed to test environment

Recommended Actions:
1. Scale database connection pool (ETA: 2 days)
2. Deploy memory fix to production (ETA: 5 days)
3. Add monitoring for connection pool utilization
4. Review cache eviction policies
"""
    
    tool_outputs_q3 = {
        'analyze_root_cause': {
            'primary_cause': 'database_connection_pool',
            'affected_incidents': ['INC0123456', 'INC0123457', 'INC0123459'],
            'secondary_cause': 'memory_leak',
            'recommendations': ['scale_pool', 'deploy_fix', 'add_monitoring']
        }
    }
    
    # Add to history
    suggester.add_to_history(
        username=username,
        question=q3,
        answer=a3,
        intent='root_cause_analysis',
        tool_outputs=tool_outputs_q3
    )
    
    print(f"User: {q3}")
    print(f"\nAI: {a3}")
    
    # Get suggestions
    suggestions_q3 = suggester.get_contextual_suggestions(
        username=username,
        limit=5,
        use_llm=False  # Template mode
    )
    print_suggestions(suggestions_q3, "template")
    
    # =========================================================================
    # Summary
    # =========================================================================
    print_section("Demo Summary")
    
    history = suggester.user_histories.get(username)
    if history:
        print(f"✅ Tracked {len(history)} questions in conversation history")
        print(f"✅ Generated contextual suggestions after each answer")
        print(f"✅ Suggestions evolved based on conversation flow:")
        print(f"   - Q1: Suggested exploring incidents and priorities")
        print(f"   - Q2: Suggested analyzing patterns and root causes")
        print(f"   - Q3: Suggested prevention and remediation actions")
        print()
        print(f"📊 Conversation Context:")
        for i, entry in enumerate(history, 1):
            print(f"   {i}. Intent: {entry['intent']} | Entities: {len(entry.get('entities', []))}")
    else:
        print("⚠️ No conversation history tracked")
    print()
    print("💡 With LLM mode enabled (use_llm=True), suggestions would be even more")
    print("   contextual and conversational, leveraging GPT-4 to generate intelligent")
    print("   follow-ups based on the full conversation context.")
    print()

if __name__ == '__main__':
    try:
        demo_conversation()
        print("\n✅ Demo completed successfully!\n")
    except Exception as e:
        print(f"\n❌ Demo failed: {e}\n")
        import traceback
        traceback.print_exc()
        sys.exit(1)
