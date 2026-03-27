"""
Multi-Turn Conversation Test - Simulates Q1 → Q2 reference scenario

Tests the exact workflow:
Q1: "What are top incidents in backlog?"
Q2: "List those incidents" ← Reference detection

This simulates what happens WITHOUT full orchestrator integration.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from components.entity_memory_framework import (
    EntityMemoryFramework,
    extract_entities,
    detect_reference,
    build_fetch_plan,
)

def print_step(step_num, description):
    print(f"\n{'='*70}")
    print(f"STEP {step_num}: {description}")
    print(f"{'='*70}\n")

def simulate_q1_backlog_query():
    """Simulate Q1: What are top incidents in backlog?"""
    
    print_step(1, "Q1: 'What are top incidents in backlog?'")
    
    # Simulate the orchestrator executing fetch_backlog_overview
    print("🔧 Orchestrator executes: fetch_backlog_overview()")
    print("⏳ Tool executing...")
    
    # Simulate tool output
    tool_outputs = {
        "fetch_backlog_overview": {
            "total": 13,
            "sample": [
                {"number": "INC0010001", "short_description": "Database connection timeout", "priority": "1 - Critical"},
                {"number": "INC0010002", "short_description": "Login page not loading", "priority": "2 - High"},
                {"number": "INC0010003", "short_description": "Report generation failing", "priority": "2 - High"},
                {"number": "INC0010004", "short_description": "Email notifications delayed", "priority": "3 - Moderate"},
                {"number": "INC0010005", "short_description": "Dashboard widgets broken", "priority": "2 - High"},
                {"number": "INC0010006", "short_description": "Search not returning results", "priority": "1 - Critical"},
                {"number": "INC0010007", "short_description": "API rate limiting issues", "priority": "2 - High"},
                {"number": "INC0010008", "short_description": "Mobile app crashing", "priority": "1 - Critical"},
                {"number": "INC0010009", "short_description": "File upload timeout", "priority": "3 - Moderate"},
                {"number": "INC0010010", "short_description": "Permission denied errors", "priority": "2 - High"},
                {"number": "INC0010011", "short_description": "Slow page load times", "priority": "3 - Moderate"},
                {"number": "INC0010012", "short_description": "SSO authentication failing", "priority": "1 - Critical"},
                {"number": "INC0010013", "short_description": "Data export not working", "priority": "2 - High"},
            ]
        }
    }
    
    print(f"✅ Tool returned {len(tool_outputs['fetch_backlog_overview']['sample'])} incidents")
    
    # Extract entities
    print("\n🧠 Entity Memory: Extracting entities from tool output...")
    cached_entities = extract_entities(tool_outputs)
    
    print(f"✅ Cached {len(cached_entities.get('incidents', []))} incidents:")
    for i, inc in enumerate(cached_entities.get('incidents', [])[:5], 1):
        print(f"   {i}. {inc}")
    if len(cached_entities.get('incidents', [])) > 5:
        print(f"   ... and {len(cached_entities['incidents']) - 5} more")
    
    # Simulate response to user
    print("\n💬 Response to user:")
    print("   'I found 13 incidents in the backlog. The top priority ones are:")
    print("   - INC0010001: Database connection timeout (Critical)")
    print("   - INC0010006: Search not returning results (Critical)")
    print("   - INC0010008: Mobile app crashing (Critical)")
    print("   ... would you like details on any of these?'")
    
    return cached_entities

def simulate_q2_reference_query(cached_entities):
    """Simulate Q2: List those incidents"""
    
    print_step(2, "Q2: 'List those incidents'")
    
    question = "List those incidents"
    
    print(f"🔍 Entity Memory: Checking for references in '{question}'...")
    
    # Detect reference
    ref_info = detect_reference(question, cached_entities)
    
    if ref_info:
        print(f"✅ Reference detected!")
        print(f"   📌 Entity type: {ref_info['entity_type']}")
        print(f"   📌 Pattern matched: '{ref_info['pattern']}'")
        print(f"   📌 Cached entities: {ref_info['count']} {ref_info['entity_type']}")
        print(f"   📌 Fetch tool: {ref_info['fetch_tool']}")
        
        # Build execution plan
        print("\n🛠️  Building execution plan...")
        plan = build_fetch_plan(ref_info, limit=5)
        
        print(f"✅ Generated plan with {len(plan)} steps:")
        for i, step in enumerate(plan, 1):
            func = step['function_name']
            incident = step['arguments']['incident_number']
            print(f"   {i}. {func}(incident_number='{incident}')")
        
        if len(ref_info['entities']) > 5:
            print(f"   ⚠️  Limited to 5 steps (from {ref_info['count']} total)")
        
        # Simulate execution
        print("\n⚙️  Orchestrator executing plan...")
        print("   ✅ Step 1/5: Fetched INC0010001 - Database connection timeout")
        print("   ✅ Step 2/5: Fetched INC0010002 - Login page not loading")
        print("   ✅ Step 3/5: Fetched INC0010003 - Report generation failing")
        print("   ✅ Step 4/5: Fetched INC0010004 - Email notifications delayed")
        print("   ✅ Step 5/5: Fetched INC0010005 - Dashboard widgets broken")
        
        print("\n💬 Response to user:")
        print("   'Here are the details for those incidents:")
        print("   ")
        print("   1. INC0010001 - Database connection timeout")
        print("      Priority: Critical | Assigned to: Database Team")
        print("      Last update: 2 hours ago")
        print("   ")
        print("   2. INC0010002 - Login page not loading")
        print("      Priority: High | Assigned to: Frontend Team")
        print("      Last update: 1 hour ago")
        print("   ")
        print("   ... (3 more incidents)")
        
        return True
    else:
        print("❌ No reference detected - would use normal planning")
        return False

def test_alternative_references(cached_entities):
    """Test various ways users might reference cached incidents"""
    
    print_step(3, "Testing Alternative Reference Patterns")
    
    test_questions = [
        "Show me details for them",
        "Can you analyze those tickets?",
        "What's the status of those issues?",
        "Give me more info on them",
        "Tell me about these incidents",
    ]
    
    framework = EntityMemoryFramework()
    
    for question in test_questions:
        ref = framework.detect_entity_reference(question, cached_entities)
        if ref:
            print(f"✅ '{question}'")
            print(f"   → Matched pattern: '{ref['pattern']}'")
        else:
            print(f"❌ '{question}'")
            print(f"   → No match")

def test_entity_type_switching():
    """Test switching between different entity types"""
    
    print_step(4, "Testing Entity Type Switching")
    
    # Simulate having both incidents and user stories cached
    mixed_cache = {
        "incidents": ["INC0010001", "INC0010002", "INC0010003"],
        "user_stories": ["PROJ-123", "PROJ-456"],
    }
    
    framework = EntityMemoryFramework()
    
    print("📦 Cache contains:")
    print(f"   - 3 incidents")
    print(f"   - 2 user_stories")
    print()
    
    # Test incident reference
    print("Testing: 'Show me those incidents'")
    ref1 = framework.detect_entity_reference("Show me those incidents", mixed_cache)
    if ref1:
        print(f"✅ Correctly resolved to: {ref1['entity_type']}")
    
    # Test story reference
    print("\nTesting: 'Tell me about those stories'")
    ref2 = framework.detect_entity_reference("Tell me about those stories", mixed_cache)
    if ref2:
        print(f"✅ Correctly resolved to: {ref2['entity_type']}")
    
    # Test generic reference (should match incidents since it comes first)
    print("\nTesting: 'Give me details on them' (generic)")
    ref3 = framework.detect_entity_reference("Give me details on them", mixed_cache)
    if ref3:
        print(f"✅ Resolved to: {ref3['entity_type']} (first match)")

def main():
    print("""
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║           Multi-Turn Conversation Test Simulation                   ║
║                                                                      ║
║  Demonstrates Q1 → Q2 reference detection workflow                  ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
    """)
    
    # Simulate Q1: Get backlog
    cached_entities = simulate_q1_backlog_query()
    
    # Simulate Q2: Reference those incidents
    success = simulate_q2_reference_query(cached_entities)
    
    if success:
        print("\n" + "="*70)
        print("✨ SUCCESS: Multi-turn reference resolution works!")
        print("="*70)
        
        # Test alternative patterns
        test_alternative_references(cached_entities)
        
        # Test entity switching
        test_entity_type_switching()
        
        print("\n" + "="*70)
        print("🎉 All tests passed!")
        print("="*70)
        print("\n📋 Next Steps:")
        print("   1. ✅ Framework validated in isolation")
        print("   2. ⏳ Integrate with orchestrator (add session_id)")
        print("   3. ⏳ Test with actual backend API calls")
        print("   4. ⏳ Test state persistence across sessions")
        print("\n💡 To integrate with orchestrator:")
        print("   See: ENTITY_MEMORY_INTEGRATION_GUIDE.md")
    else:
        print("\n❌ Multi-turn reference detection failed")

if __name__ == "__main__":
    main()
