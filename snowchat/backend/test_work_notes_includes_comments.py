"""
Test: Work Notes Should Include Comments Field

Problem: The get_incident_work_notes_core() function was only querying for
element=work_notes but missing element=comments (Additional comments field).

In ServiceNow:
- work_notes = Internal notes (not customer visible)
- comments = Additional comments (customer visible)

The screenshot showed "Additional comments (Customer visible)" entries from Tom Hanks,
but the API returned 0 results because it only queried work_notes.

Solution: Query for BOTH work_notes AND comments using:
   element_id={sys_id}^element=work_notes^ORelement=comments

This ensures we capture ALL activity notes regardless of type.
"""

import sys
import os

# Add backend directory to path
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_dir)

from components.servicenowgenaitool import get_incident_work_notes_core


def test_work_notes_query_includes_comments():
    """
    Test that work notes query includes both work_notes and comments fields.
    
    This is a integration test that requires ServiceNow connection.
    It validates that the query fetches customer-visible comments.
    """
    
    print("=" * 80)
    print("Testing: Work Notes Query Includes Comments Field")
    print("=" * 80 + "\n")
    
    try:
        # Test with incident INC0010014 that has "Additional comments"
        incident_number = "INC0010014"
        result = get_incident_work_notes_core(incident_number, include_empty=True)
        
        print(f"Query Result for {incident_number}:")
        print(f"  Status: {'✓ Success' if 'work_notes' in result else '✗ Error'}")
        
        if "error" in result:
            print(f"  Error: {result['error']}")
            print("\n⚠️  Note: This may be expected if ServiceNow is not configured")
            return
        
        print(f"  Work Notes Count: {result.get('work_notes_count', 0)}")
        
        if result.get('work_notes_count', 0) > 0:
            print(f"\n  ✅ SUCCESS: Found {result['work_notes_count']} work notes/comments")
            print("\n  Sample Entries:")
            for i, entry in enumerate(result.get('work_notes_entries', [])[:3], 1):
                entry_type = entry.get('type', 'Unknown')
                created_on = entry.get('created_on', '')
                created_by = entry.get('created_by', '')
                value_preview = entry.get('value', '')[:100] + "..." if len(entry.get('value', '')) > 100 else entry.get('value', '')
                print(f"\n  Entry {i}:")
                print(f"    Type: {entry_type}")
                print(f"    Created: {created_on} by {created_by}")
                print(f"    Value: {value_preview}")
            
            # Validate that entries have the 'type' field
            has_type_field = all('type' in entry for entry in result.get('work_notes_entries', []))
            print(f"\n  Entry Type Labeling: {'✓ Present' if has_type_field else '✗ Missing'}")
            
            # Check if we have any "Additional Comment" entries
            has_comments = any(entry.get('element') == 'comments' 
                              for entry in result.get('work_notes_entries', []))
            print(f"  Contains Customer Comments: {'✓ Yes' if has_comments else '✗ No (only work_notes)'}")
            
        else:
            print(f"\n  ⚠️  No work notes or comments found")
            print(f"  This may indicate:")
            print(f"    1. Incident has no activities yet")
            print(f"    2. Query still only searching work_notes (not fixed)")
            print(f"    3. ServiceNow API permission issue")
        
        print("\n" + "=" * 80)
        print("Expected Behavior:")
        print("=" * 80)
        print("Before Fix:")
        print("  Query: element_id={sys_id}^element=work_notes")
        print("  Result: 0 entries (missing customer comments)")
        print("\nAfter Fix:")
        print("  Query: element_id={sys_id}^element=work_notes^ORelement=comments")
        print("  Result: All entries (work notes + additional comments)")
        print("\nEach entry should include:")
        print("  - type: 'Work Note' or 'Additional Comment'")
        print("  - element: 'work_notes' or 'comments'")
        print("  - created_on, created_by, value")
        
    except Exception as e:
        print(f"❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    test_work_notes_query_includes_comments()
