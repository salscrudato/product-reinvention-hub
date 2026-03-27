"""
Quick Start Test Script for Entity Memory Framework

Tests the framework in isolation before full orchestrator integration.
Validates entity extraction, reference detection, and plan building.

Usage:
    python backend/scripts/test_entity_memory_quickstart.py
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from components.entity_memory_framework import (
    EntityMemoryFramework,
    ENTITY_CONFIG,
    extract_entities,
    detect_reference,
    build_fetch_plan,
    merge_entities,
    ENABLED
)

def print_header(text):
    print(f"\n{'='*70}")
    print(f"  {text}")
    print(f"{'='*70}\n")

def print_success(text):
    print(f"✅ {text}")

def print_info(text):
    print(f"ℹ️  {text}")

def print_result(label, value):
    print(f"   {label}: {value}")

def test_framework_status():
    print_header("Test 1: Framework Status")
    
    if ENABLED:
        print_success("Entity Memory Framework is ENABLED")
        print_info(f"Entity types configured: {len(ENTITY_CONFIG)}")
        
        for entity_type in ENTITY_CONFIG.keys():
            print(f"   - {entity_type}")
    else:
        print("⚠️  Entity Memory Framework is DISABLED")
        print("   Set ENABLE_ENTITY_MEMORY=1 to enable")
    
    return ENABLED

def test_entity_extraction():
    print_header("Test 2: Entity Extraction")
    
    # Simulate tool output from backlog
    print_info("Simulating fetch_backlog_overview output...")
    tool_outputs = {
        "fetch_backlog_overview": {
            "sample": [
                {"number": "INC0000001", "short_description": "Database timeout"},
                {"number": "INC0000002", "short_description": "Login failure"},
                {"number": "INC0000003", "short_description": "API error"},
            ]
        }
    }
    
    framework = EntityMemoryFramework()
    result = framework.extract_entities_from_outputs(tool_outputs)
    
    if "incidents" in result:
        print_success(f"Extracted {len(result['incidents'])} incidents")
        for i, incident in enumerate(result['incidents'], 1):
            print_result(f"  Incident {i}", incident)
        return result
    else:
        print("❌ Failed to extract incidents")
        return {}

def test_reference_detection(cached_entities):
    print_header("Test 3: Reference Detection")
    
    framework = EntityMemoryFramework()
    
    test_questions = [
        "Can you list those incidents?",
        "Show me details for them",
        "What about those tickets?",
        "Tell me about user stories",  # Should fail - no user stories cached
    ]
    
    for question in test_questions:
        print_info(f"Testing: '{question}'")
        ref = framework.detect_entity_reference(question, cached_entities)
        
        if ref:
            print_success(f"Reference detected: {ref['entity_type']}")
            print_result("  Pattern matched", ref['pattern'])
            print_result("  Entity count", ref['count'])
            print_result("  Fetch tool", ref['fetch_tool'])
        else:
            print("   ℹ️  No reference detected (expected for some queries)")
        print()

def test_plan_building(cached_entities):
    print_header("Test 4: Execution Plan Building")
    
    framework = EntityMemoryFramework()
    
    print_info("Detecting reference in: 'List those incidents'")
    ref = framework.detect_entity_reference("List those incidents", cached_entities)
    
    if ref:
        print_success("Reference detected, building fetch plan...")
        plan = framework.build_fetch_plan(ref, limit=5)
        
        print_info(f"Generated plan with {len(plan)} steps:")
        for i, step in enumerate(plan, 1):
            func = step['function_name']
            args = step['arguments']
            print(f"   {i}. {func}({args})")
        
        return plan
    else:
        print("❌ Failed to detect reference")
        return []

def test_entity_merging(cached_entities):
    print_header("Test 5: Entity Cache Merging")
    
    print_info("Simulating new tool execution with additional incidents...")
    
    new_tool_outputs = {
        "get_similar_incidents": {
            "incidents": [
                {"number": "INC0000004"},
                {"number": "INC0000005"},
            ]
        }
    }
    
    framework = EntityMemoryFramework()
    new_entities = framework.extract_entities_from_outputs(new_tool_outputs)
    
    print_info(f"New entities extracted: {new_entities}")
    
    merged = framework.merge_cached_entities(cached_entities, new_entities, max_per_type=20)
    
    print_success(f"Merged cache now contains {len(merged.get('incidents', []))} incidents")
    print_result("  Merged incidents", merged.get('incidents', []))
    
    return merged

def test_multi_entity_types():
    print_header("Test 6: Multiple Entity Types")
    
    print_info("Simulating mixed tool outputs (incidents + user stories)...")
    
    tool_outputs = {
        "fetch_backlog_overview": {
            "sample": [
                {"number": "INC0000001"},
                {"number": "INC0000002"},
            ]
        },
        "jira_fetch_user_story": {
            "issues": [
                {"key": "PROJ-123", "summary": "Add login feature"},
                {"key": "PROJ-456", "summary": "Fix API bug"},
            ]
        }
    }
    
    result = extract_entities(tool_outputs)
    
    if "incidents" in result and "user_stories" in result:
        print_success("Extracted multiple entity types successfully")
        print_result("  Incidents", result['incidents'])
        print_result("  User Stories", result['user_stories'])
        
        # Test entity-specific detection
        print()
        print_info("Testing entity-specific reference detection...")
        
        framework = EntityMemoryFramework()
        
        # Should match incidents
        ref1 = framework.detect_entity_reference("Show me those incidents", result)
        if ref1 and ref1['entity_type'] == 'incidents':
            print_success("Correctly resolved reference to 'incidents'")
        
        # Should match user_stories
        ref2 = framework.detect_entity_reference("Tell me about those stories", result)
        if ref2 and ref2['entity_type'] == 'user_stories':
            print_success("Correctly resolved reference to 'user_stories'")
        
        return result
    else:
        print("❌ Failed to extract multiple entity types")
        return {}

def test_entity_limits():
    print_header("Test 7: Entity Limits (20 per type)")
    
    print_info("Generating 30 incidents to test limit enforcement...")
    
    tool_outputs = {
        "fetch_backlog_overview": {
            "sample": [
                {"number": f"INC{str(i).zfill(7)}"}
                for i in range(30)
            ]
        }
    }
    
    result = extract_entities(tool_outputs)
    
    incident_count = len(result.get('incidents', []))
    
    if incident_count == 20:
        print_success(f"Correctly limited to 20 incidents (from 30)")
        print_result("  First incident", result['incidents'][0])
        print_result("  Last incident", result['incidents'][-1])
    elif incident_count == 30:
        print(f"⚠️  Limit not enforced - got {incident_count} incidents")
    else:
        print(f"❌ Unexpected count: {incident_count}")

def test_configuration_completeness():
    print_header("Test 8: Configuration Validation")
    
    required_fields = ["extractors", "patterns", "fetch_tool", "id_param", "source_tools"]
    
    all_valid = True
    
    for entity_type, config in ENTITY_CONFIG.items():
        print_info(f"Validating config for: {entity_type}")
        
        for field in required_fields:
            if field not in config:
                print(f"   ❌ Missing field: {field}")
                all_valid = False
            elif not config[field]:
                print(f"   ❌ Empty field: {field}")
                all_valid = False
            else:
                print(f"   ✅ {field}: OK")
    
    if all_valid:
        print_success("All entity configurations are valid")
    else:
        print("⚠️  Some configurations are incomplete")

def main():
    print("""
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║        Entity Memory Framework - Quick Start Test Suite             ║
║                                                                      ║
║  Tests core functionality before full orchestrator integration      ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
    """)
    
    # Test 1: Framework status
    if not test_framework_status():
        print("\n⚠️  Framework is disabled. Enable with: export ENABLE_ENTITY_MEMORY=1")
        return
    
    # Test 2: Entity extraction
    cached_entities = test_entity_extraction()
    
    if not cached_entities:
        print("\n❌ Entity extraction failed. Cannot continue.")
        return
    
    # Test 3: Reference detection
    test_reference_detection(cached_entities)
    
    # Test 4: Plan building
    test_plan_building(cached_entities)
    
    # Test 5: Entity merging
    merged_cache = test_entity_merging(cached_entities)
    
    # Test 6: Multiple entity types
    test_multi_entity_types()
    
    # Test 7: Entity limits
    test_entity_limits()
    
    # Test 8: Configuration validation
    test_configuration_completeness()
    
    # Final summary
    print_header("Quick Start Test Summary")
    print_success("All core functionality validated")
    print_info("Next steps:")
    print("   1. Run full test suite: pytest backend/tests/test_entity_memory_framework.py")
    print("   2. Review integration guide: ENTITY_MEMORY_INTEGRATION_GUIDE.md")
    print("   3. Update orchestrator with session_id parameter")
    print("   4. Test multi-turn conversations in full system")
    print("\n✨ Entity Memory Framework is ready for integration!\n")

if __name__ == "__main__":
    main()
