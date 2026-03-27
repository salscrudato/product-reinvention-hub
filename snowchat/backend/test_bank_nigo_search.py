#!/usr/bin/env python3
"""Test the search_incidents_by_keywords with bank+NIGO query."""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from components.servicenowgenaitool import search_incidents_by_keywords_core

def test_bank_nigo_search():
    """Test searching for bank + NIGO keywords."""
    print("\n=== Testing search_incidents_by_keywords_core ===")
    print("Keywords: ['bank', 'NIGO']")
    print("Expected: Should find INC0010007 ('Banking Information NIGO')\n")
    
    result = search_incidents_by_keywords_core(
        keywords=["bank", "NIGO"],
        search_fields=["short_description", "description", "work_notes"],
        limit=50
    )
    
    print(f"Query generated: {result.get('query_string', 'N/A')}")
    print(f"Incidents found: {result.get('match_count', 0)}")
    print()
    
    if result.get('incidents'):
        print("Found incidents:")
        for inc in result['incidents']:
            inc_number = inc.get('number')
            short_desc = inc.get('short_description', 'N/A')
            match_score = inc.get('_match_score', 0)
            print(f"  - {inc_number}: {short_desc} (score: {match_score})")
            
        # Check if INC0010007 is in results
        inc_numbers = [i.get('number') for i in result['incidents']]
        if 'INC0010007' in inc_numbers:
            print("\n✅ SUCCESS! INC0010007 was found!")
            return True
        else:
            print("\n❌ FAIL! INC0010007 not found in results")
            return False
    else:
        print("❌ FAIL! No incidents returned")
        print(f"Error: {result.get('error', 'Unknown error')}")
        return False

if __name__ == "__main__":
    success = test_bank_nigo_search()
    sys.exit(0 if success else 1)
