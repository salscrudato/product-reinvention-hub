"""
Helper script to discover actual assignment group names from ServiceNow.

Run this to see what assignment groups exist in your ServiceNow instance,
then manually update assignment_rules.json with the correct names.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from components.servicenowgenaitool import fetch_servicenow_incident_core
import requests
from requests.auth import HTTPBasicAuth
import json

SNOW_INSTANCE = os.getenv('SNOW_INSTANCE', 'dev192699.service-now.com')
SNOW_USER = os.getenv('SNOW_USER', 'admin')
SNOW_PASSWORD = os.getenv('SNOW_PASSWORD', 'admin')

print("="*80)
print("SERVICENOW ASSIGNMENT GROUP DISCOVERY")
print("="*80)

print("\nMethod 1: Query sys_user_group table directly")
print("-"*80)

url = f'https://{SNOW_INSTANCE}/api/now/table/sys_user_group'
params = {'sysparm_limit': 100, 'sysparm_fields': 'name,sys_id,active'}

try:
    resp = requests.get(url, auth=HTTPBasicAuth(SNOW_USER, SNOW_PASSWORD), params=params, timeout=10)
    if resp.status_code == 200:
        groups = resp.json().get('result', [])
        active_groups = [g for g in groups if g.get('active') == 'true']
        
        print(f"\nFound {len(active_groups)} active assignment groups:\n")
        for i, group in enumerate(sorted(active_groups, key=lambda x: x['name']), 1):
            print(f"  {i:2}. {group['name']}")
        
        print("\n" + "="*80)
        print("NEXT STEPS:")
        print("="*80)
        print("\n1. Copy the group names above")
        print("2. Open: backend/components/assignment_rules.json")
        print("3. Replace placeholder names with actual group names from above")
        print("\nExample replacements:")
        print("  'Network Operations'  →  (use actual name from list)")
        print("  'Service Desk'        →  (use actual name from list)")
        print("  'Infrastructure Team' →  (use actual name from list)")
        
    else:
        print(f"✗ Error: HTTP {resp.status_code}")
        print("Response:", resp.text[:200])

except Exception as e:
    print(f"✗ Error connecting to ServiceNow: {e}")
    print("\nMethod 2: Check a sample incident")
    print("-"*80)
    
    try:
        # Try fetching a known incident
        incident = fetch_servicenow_incident_core('INC0010001')
        if incident and not incident.get('error'):
            print("\nSample incident data:")
            print(json.dumps({
                'number': incident.get('number'),
                'assignment_group': incident.get('assignment_group'),
                'u_assigned_to': incident.get('u_assigned_to')
            }, indent=2))
            
            # If assignment_group is a reference, try to resolve it
            assignment_group = incident.get('assignment_group')
            if isinstance(assignment_group, dict):
                sys_id = assignment_group.get('value')
                if sys_id:
                    group_url = f'https://{SNOW_INSTANCE}/api/now/table/sys_user_group/{sys_id}'
                    gresp = requests.get(group_url, auth=HTTPBasicAuth(SNOW_USER, SNOW_PASSWORD), timeout=10)
                    if gresp.status_code == 200:
                        group_name = gresp.json().get('result', {}).get('name')
                        print(f"\nResolved assignment group: {group_name}")
        else:
            print("\n✗ Could not fetch sample incident")
    except Exception as e2:
        print(f"\n✗ Error: {e2}")

print("\n" + "="*80)
print("ALTERNATIVE: Manual Discovery")
print("="*80)
print("\n1. Log into your ServiceNow instance UI")
print("2. Navigate to: System Definition > Groups")
print("3. Filter by 'Active = true'")
print("4. Export the list or copy group names")
print("5. Update assignment_rules.json with those names")
print("\n" + "="*80)
