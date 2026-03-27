"""
Update assignment_rules.json with actual assignment group names from ServiceNow incidents.

This script:
1. Fetches all incidents from ServiceNow that have assignment_group populated
2. Resolves the sys_id values to actual group names
3. Analyzes patterns (category -> group, keywords -> group)
4. Updates assignment_rules.json with real group names based on data
"""

import os
import sys
import json
import requests
from requests.auth import HTTPBasicAuth
from collections import defaultdict, Counter
import re
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ServiceNow credentials - using the same env vars as servicenowgenaitool.py
SERVICENOW_INSTANCE = os.getenv("SERVICENOW_INSTANCE")
SERVICENOW_USER = os.getenv("SERVICENOW_USER")
SERVICENOW_PASSWORD = os.getenv("SERVICENOW_PASSWORD")

# Extract just the hostname if URL provided
if SERVICENOW_INSTANCE:
    SNOW_INSTANCE = SERVICENOW_INSTANCE.replace('https://', '').replace('http://', '').rstrip('/')
else:
    SNOW_INSTANCE = None

def _sn_auth():
    """Return (user, password) only if both are set; else None."""
    if SERVICENOW_USER and SERVICENOW_PASSWORD:
        return (SERVICENOW_USER, SERVICENOW_PASSWORD)
    return None

def fetch_incidents_with_assignment():
    """Fetch all incidents that have assignment_group populated."""
    if not SNOW_INSTANCE:
        print("✗ SERVICENOW_INSTANCE not configured in .env")
        return []
    
    auth = _sn_auth()
    if not auth:
        print("✗ ServiceNow credentials not configured in .env")
        return []
    
    url = f'https://{SNOW_INSTANCE}/api/now/table/incident'
    
    params = {
        'sysparm_query': 'assignment_groupISNOTEMPTY',
        'sysparm_fields': 'number,short_description,category,assignment_group,description,state',
        'sysparm_limit': 500  # Get up to 500 incidents
    }
    
    print(f"Fetching incidents from {SNOW_INSTANCE}...")
    print(f"Using auth: {auth[0] if auth else 'None'}")
    try:
        response = requests.get(
            url,
            auth=auth,
            params=params,
            headers={"Accept": "application/json"},
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json().get('result', [])
            print(f"✓ Found {len(result)} incidents with assignment groups")
            return result
        else:
            print(f"✗ Error fetching incidents: {response.status_code}")
            print(f"  Response: {response.text[:200]}")
            return []
    except Exception as e:
        print(f"✗ Exception fetching incidents: {e}")
        return []

def resolve_assignment_group_name(sys_id):
    """Resolve assignment group sys_id to display name."""
    if not sys_id or not SNOW_INSTANCE:
        return None
    
    auth = _sn_auth()
    if not auth:
        return None
    
    url = f'https://{SNOW_INSTANCE}/api/now/table/sys_user_group/{sys_id}'
    
    try:
        response = requests.get(
            url,
            auth=auth,
            headers={"Accept": "application/json"},
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json().get('result', {})
            return result.get('name')
        else:
            return None
    except Exception as e:
        return None

def analyze_patterns(incidents):
    """Analyze category and keyword patterns from incidents."""
    
    # Resolve all assignment group sys_ids to names
    print("\nResolving assignment group names...")
    group_names = {}
    unique_sys_ids = set()
    
    for incident in incidents:
        ag = incident.get('assignment_group')
        if ag:
            if isinstance(ag, dict):
                sys_id = ag.get('value')
            else:
                sys_id = ag
            
            if sys_id:
                unique_sys_ids.add(sys_id)
    
    print(f"Found {len(unique_sys_ids)} unique assignment groups")
    
    for sys_id in unique_sys_ids:
        name = resolve_assignment_group_name(sys_id)
        if name:
            group_names[sys_id] = name
            print(f"  • {name}")
    
    # Analyze category patterns
    category_to_groups = defaultdict(list)
    keyword_to_groups = defaultdict(list)
    
    print("\nAnalyzing patterns...")
    
    for incident in incidents:
        category = incident.get('category', '')
        short_desc = incident.get('short_description', '')
        description = incident.get('description', '')
        
        ag = incident.get('assignment_group')
        sys_id = None
        if ag:
            if isinstance(ag, dict):
                sys_id = ag.get('value')
            else:
                sys_id = ag
        
        if sys_id and sys_id in group_names:
            group_name = group_names[sys_id]
            
            # Track category patterns
            if category:
                category_to_groups[category].append(group_name)
            
            # Track keyword patterns (extract significant words)
            text = f"{short_desc} {description}".lower()
            keywords = [
                'password', 'vpn', 'network', 'email', 'access', 'login',
                'server', 'database', 'application', 'hardware', 'software',
                'printer', 'phone', 'laptop', 'desktop', 'account',
                'mib', 'nigo', 'vin', 'underwriting', 'policy', 'claim',
                'premium', 'homeowners', 'auto', 'life', 'annuity'
            ]
            
            for keyword in keywords:
                if keyword in text:
                    keyword_to_groups[keyword].append(group_name)
    
    # Calculate most common group for each category/keyword
    category_rules = {}
    for category, groups in category_to_groups.items():
        if len(groups) >= 3:  # Require at least 3 samples
            counter = Counter(groups)
            most_common_group, count = counter.most_common(1)[0]
            confidence = count / len(groups)
            if confidence >= 0.5:  # Require at least 50% agreement
                category_rules[category] = {
                    'group': most_common_group,
                    'confidence': confidence,
                    'sample_size': len(groups)
                }
    
    keyword_rules = {}
    for keyword, groups in keyword_to_groups.items():
        if len(groups) >= 3:  # Require at least 3 samples
            counter = Counter(groups)
            most_common_group, count = counter.most_common(1)[0]
            confidence = count / len(groups)
            if confidence >= 0.5:  # Require at least 50% agreement
                keyword_rules[keyword] = {
                    'group': most_common_group,
                    'confidence': confidence,
                    'sample_size': len(groups)
                }
    
    return {
        'all_groups': list(set(group_names.values())),
        'category_rules': category_rules,
        'keyword_rules': keyword_rules
    }

def update_assignment_rules_file(patterns):
    """Update assignment_rules.json with learned patterns."""
    
    rules_file = os.path.join(os.path.dirname(__file__), 'components', 'assignment_rules.json')
    
    # Load existing rules
    try:
        with open(rules_file, 'r', encoding='utf-8') as f:
            rules_data = json.load(f)
    except Exception as e:
        print(f"Error loading existing rules: {e}")
        return
    
    print(f"\nUpdating {rules_file}...")
    
    # Update category rules
    category_mappings = []
    for category, info in patterns['category_rules'].items():
        category_mappings.append({
            "category": category,
            "assignment_group": info['group'],
            "confidence": round(info['confidence'], 2),
            "sample_size": info['sample_size']
        })
    
    # Update keyword rules
    keyword_mappings = []
    for keyword, info in patterns['keyword_rules'].items():
        keyword_mappings.append({
            "keyword": keyword,
            "assignment_group": info['group'],
            "confidence": round(info['confidence'], 2),
            "sample_size": info['sample_size']
        })
    
    # Update the rules data
    if category_mappings:
        rules_data['rules']['category_rules']['mappings'] = category_mappings
        print(f"  ✓ Updated {len(category_mappings)} category rules")
    
    if keyword_mappings:
        rules_data['rules']['keyword_rules']['mappings'] = keyword_mappings
        print(f"  ✓ Updated {len(keyword_mappings)} keyword rules")
    
    # Update metadata
    rules_data['metadata']['status'] = 'AUTO-GENERATED from production data'
    rules_data['metadata']['last_updated'] = '2026-01-23'
    rules_data['metadata']['data_source'] = f'ServiceNow instance: {SNOW_INSTANCE}'
    rules_data['metadata']['total_groups'] = len(patterns['all_groups'])
    rules_data['metadata']['all_assignment_groups'] = sorted(patterns['all_groups'])
    
    # Save updated rules
    try:
        with open(rules_file, 'w', encoding='utf-8') as f:
            json.dump(rules_data, f, indent=2, ensure_ascii=False)
        print(f"  ✓ Successfully updated assignment_rules.json")
        
        # Print summary
        print("\n" + "="*60)
        print("ASSIGNMENT RULES UPDATE SUMMARY")
        print("="*60)
        print(f"Total assignment groups found: {len(patterns['all_groups'])}")
        print(f"\nAll groups:")
        for group in sorted(patterns['all_groups']):
            print(f"  • {group}")
        
        print(f"\nCategory rules generated: {len(category_mappings)}")
        for rule in category_mappings:
            print(f"  • {rule['category']} → {rule['assignment_group']} "
                  f"(confidence: {rule['confidence']:.0%}, n={rule['sample_size']})")
        
        print(f"\nKeyword rules generated: {len(keyword_mappings)}")
        for rule in keyword_mappings:
            print(f"  • {rule['keyword']} → {rule['assignment_group']} "
                  f"(confidence: {rule['confidence']:.0%}, n={rule['sample_size']})")
        
    except Exception as e:
        print(f"  ✗ Error saving rules: {e}")

def main():
    print("="*60)
    print("UPDATE ASSIGNMENT RULES FROM SERVICENOW DATA")
    print("="*60)
    
    # Fetch incidents with assignment groups
    incidents = fetch_incidents_with_assignment()
    
    if not incidents:
        print("\n⚠ No incidents found with assignment groups.")
        print("Please check:")
        print("  1. ServiceNow credentials are correct")
        print("  2. ServiceNow instance has incidents with assignment_group populated")
        print("  3. Network connectivity to ServiceNow")
        return
    
    # Analyze patterns
    patterns = analyze_patterns(incidents)
    
    if not patterns['all_groups']:
        print("\n⚠ Could not resolve any assignment group names.")
        print("Please check ServiceNow API permissions.")
        return
    
    # Update assignment rules file
    update_assignment_rules_file(patterns)
    
    print("\n✓ Update complete!")

if __name__ == '__main__':
    main()
