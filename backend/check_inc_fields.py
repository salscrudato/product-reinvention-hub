#!/usr/bin/env python3
"""Check actual fields returned by ServiceNow for INC0010007."""

import sys
import os
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from components.servicenowgenaitool import servicenow_instance, _sn_auth

def check_incident_fields():
    """Get INC0010007 and see all its fields."""
    print("\n=== Checking INC0010007 fields ===\n")
    
    url = f"{servicenow_instance}/api/now/table/incident"
    params = {
        "sysparm_query": "number=INC0010007",
        "sysparm_display_value": "false",
        "sysparm_limit": 1
    }
    
    response = requests.get(url, auth=_sn_auth(), params=params, timeout=30)
    response.raise_for_status()
    result = response.json()
    
    if result.get('result'):
        incident = result['result'][0]
        print(f"Incident Number: {incident.get('number')}")
        print(f"Short Description: {incident.get('short_description')}")
        print(f"Description field: {incident.get('description', 'FIELD DOES NOT EXIST')}")
        print(f"Work Notes field: {incident.get('work_notes', 'FIELD DOES NOT EXIST')}")
        print(f"\nAll fields available:")
        for key in sorted(incident.keys()):
            value = str(incident.get(key, ''))
            if len(value) > 100:
                value = value[:100] + "..."
            print(f"  {key}: {value}")
        
        # Check if "Banking" is in any field
        print(f"\nFields containing 'Banking':")
        for key, value in incident.items():
            if isinstance(value, str) and 'Banking' in value:
                print(f"  {key}: {value[:200]}")
        
        # Check if "NIGO" is in any field
        print(f"\nFields containing 'NIGO':")
        for key, value in incident.items():
            if isinstance(value, str) and 'NIGO' in value:
                print(f"  {key}: {value[:200]}")
    else:
        print("INC0010007 not found!")

if __name__ == "__main__":
    check_incident_fields()
