"""
Learn assignment rules from actual ServiceNow incident data.

This script:
1. Fetches all incidents with assignment_group populated
2. Analyzes patterns between incident descriptions/categories and assignment groups
3. Updates assignment_rules.json with actual group names and learned patterns
"""

import os
import sys
import json
import requests
from requests.auth import HTTPBasicAuth
from collections import defaultdict, Counter
from pathlib import Path

# ServiceNow credentials
SNOW_INSTANCE = os.getenv('SNOW_INSTANCE', 'dev192699.service-now.com')
SNOW_USER = os.getenv('SNOW_USER', 'admin')
SNOW_PASSWORD = os.getenv('SNOW_PASSWORD', 'admin')

def fetch_incidents_with_assignment():
    """Fetch all incidents with assignment_group populated"""
    print("Fetching incidents from ServiceNow...")
    
    url = f'https://{SNOW_INSTANCE}/api/now/table/incident'
    params = {
        'sysparm_limit': 1000,
        'sysparm_fields': 'number,short_description,description,category,assignment_group,u_assigned_to,state',
        'sysparm_query': 'assignment_groupISNOTEMPTY'
    }
    
    try:
        resp = requests.get(url, auth=HTTPBasicAuth(SNOW_USER, SNOW_PASSWORD), params=params, timeout=30)
        resp.raise_for_status()
        incidents = resp.json().get('result', [])
        print(f"✓ Fetched {len(incidents)} incidents with assignment groups")
        return incidents
    except Exception as e:
        print(f"✗ Error fetching incidents: {e}")
        return []

def resolve_assignment_group_names(incidents):
    """Resolve assignment_group sys_ids to actual group names"""
    print("\nResolving assignment group names...")
    
    # Collect unique sys_ids
    group_sys_ids = set()
    for inc in incidents:
        if inc.get('assignment_group') and isinstance(inc['assignment_group'], dict):
            sys_id = inc['assignment_group'].get('value')
            if sys_id:
                group_sys_ids.add(sys_id)
    
    print(f"Found {len(group_sys_ids)} unique assignment groups")
    
    # Query sys_user_group table to get names
    group_name_map = {}
    for sys_id in group_sys_ids:
        url = f'https://{SNOW_INSTANCE}/api/now/table/sys_user_group/{sys_id}'
        try:
            resp = requests.get(url, auth=HTTPBasicAuth(SNOW_USER, SNOW_PASSWORD), timeout=10)
            if resp.status_code == 200:
                group = resp.json().get('result', {})
                name = group.get('name', 'Unknown')
                group_name_map[sys_id] = name
                print(f"  ✓ {name}")
        except Exception as e:
            print(f"  ✗ Error fetching {sys_id}: {e}")
    
    return group_name_map

def analyze_patterns(incidents, group_name_map):
    """Analyze patterns between incident descriptions/categories and assignment groups"""
    print("\nAnalyzing assignment patterns...")
    
    # Category-based patterns
    category_to_groups = defaultdict(list)
    
    # Keyword-based patterns (extract common words from descriptions)
    keyword_to_groups = defaultdict(list)
    
    # All assignment group names
    all_groups = set()
    
    for inc in incidents:
        # Get assignment group name
        group_sys_id = None
        if inc.get('assignment_group') and isinstance(inc['assignment_group'], dict):
            group_sys_id = inc['assignment_group'].get('value')
        
        if not group_sys_id or group_sys_id not in group_name_map:
            continue
        
        group_name = group_name_map[group_sys_id]
        all_groups.add(group_name)
        
        # Analyze category
        category = inc.get('category', '')
        if category:
            category_to_groups[category].append(group_name)
        
        # Analyze keywords in short_description
        short_desc = (inc.get('short_description', '') or '').lower()
        description = (inc.get('description', '') or '').lower()
        combined_text = f"{short_desc} {description}"
        
        # Extract significant keywords (simple word extraction)
        words = combined_text.split()
        significant_words = [
            word.strip('.,!?;:()[]{}') for word in words 
            if len(word) > 3 and word.isalpha()
        ]
        
        for word in significant_words[:20]:  # Limit to first 20 words
            keyword_to_groups[word].append(group_name)
    
    return {
        'category_to_groups': category_to_groups,
        'keyword_to_groups': keyword_to_groups,
        'all_groups': sorted(all_groups)
    }

def generate_learned_rules(patterns):
    """Generate assignment rules based on learned patterns"""
    print("\nGenerating learned rules...")
    
    category_to_groups = patterns['category_to_groups']
    keyword_to_groups = patterns['keyword_to_groups']
    all_groups = patterns['all_groups']
    
    # Generate category rules (categories with >3 incidents)
    category_rules = []
    for category, groups in category_to_groups.items():
        if len(groups) >= 3:  # Minimum threshold
            group_counter = Counter(groups)
            top_groups = [g for g, count in group_counter.most_common(3)]
            confidence = group_counter.most_common(1)[0][1] / len(groups)
            
            category_rules.append({
                "category": category,
                "assignment_groups": top_groups,
                "priority": 1,
                "confidence": round(confidence, 2),
                "sample_count": len(groups)
            })
    
    # Generate keyword rules (keywords appearing >5 times with same group)
    keyword_rules = []
    for keyword, groups in keyword_to_groups.items():
        if len(groups) >= 5:  # Minimum threshold
            group_counter = Counter(groups)
            # Only create rule if one group is dominant (>60% of occurrences)
            if group_counter.most_common(1)[0][1] / len(groups) > 0.6:
                top_groups = [g for g, count in group_counter.most_common(2)]
                confidence = group_counter.most_common(1)[0][1] / len(groups)
                
                keyword_rules.append({
                    "keyword": keyword,
                    "assignment_groups": top_groups,
                    "confidence": round(confidence, 2),
                    "sample_count": len(groups)
                })
    
    # Sort by sample count (most frequent first)
    category_rules.sort(key=lambda x: x['sample_count'], reverse=True)
    keyword_rules.sort(key=lambda x: x['sample_count'], reverse=True)
    
    return {
        'category_rules': category_rules[:15],  # Top 15 categories
        'keyword_rules': keyword_rules[:20],     # Top 20 keywords
        'all_groups': all_groups
    }

def update_assignment_rules_file(learned_rules):
    """Update assignment_rules.json with learned rules"""
    rules_path = Path(__file__).parent / "components" / "assignment_rules.json"
    
    print(f"\nUpdating {rules_path}...")
    
    # Load existing rules
    with open(rules_path, 'r') as f:
        existing_config = json.load(f)
    
    # Build new category rules
    new_category_mappings = []
    for rule in learned_rules['category_rules']:
        new_category_mappings.append({
            "category": rule['category'],
            "assignment_groups": rule['assignment_groups'],
            "priority": 1,
            "confidence": rule['confidence']
        })
    
    # Build new keyword rules (group similar keywords)
    new_keyword_mappings = []
    keyword_groups = {}
    
    for rule in learned_rules['keyword_rules']:
        keyword = rule['keyword']
        groups = rule['assignment_groups']
        
        # Group keywords by assignment group
        key = tuple(groups)
        if key not in keyword_groups:
            keyword_groups[key] = []
        keyword_groups[key].append(keyword)
    
    # Create consolidated keyword rules
    for groups, keywords in keyword_groups.items():
        if len(keywords) >= 2:  # At least 2 related keywords
            new_keyword_mappings.append({
                "keywords": keywords[:5],  # Top 5 keywords
                "assignment_groups": list(groups),
                "priority": 2,
                "confidence": 0.85
            })
    
    # Update the configuration
    existing_config['rules']['category_rules']['mappings'] = new_category_mappings
    existing_config['rules']['keyword_rules']['mappings'] = new_keyword_mappings
    existing_config['rules']['fallback']['assignment_groups'] = learned_rules['all_groups'][:2]
    
    # Add metadata about learning
    existing_config['metadata'] = {
        "last_learned": "2026-01-23",
        "total_incidents_analyzed": sum(r['sample_count'] for r in learned_rules['category_rules']),
        "unique_assignment_groups": len(learned_rules['all_groups']),
        "category_rules_count": len(new_category_mappings),
        "keyword_rules_count": len(new_keyword_mappings)
    }
    
    # Save updated rules
    with open(rules_path, 'w') as f:
        json.dump(existing_config, f, indent=2)
    
    print(f"✓ Updated {rules_path}")
    
    return existing_config

def print_summary(learned_rules, updated_config):
    """Print summary of learned rules"""
    print("\n" + "="*80)
    print("LEARNING SUMMARY")
    print("="*80)
    
    print(f"\nTotal Unique Assignment Groups: {len(learned_rules['all_groups'])}")
    print("\nAssignment Groups Found:")
    for i, group in enumerate(learned_rules['all_groups'], 1):
        print(f"  {i}. {group}")
    
    print(f"\nCategory Rules Generated: {len(learned_rules['category_rules'])}")
    print("\nTop Category Rules:")
    for rule in learned_rules['category_rules'][:10]:
        print(f"  • {rule['category']} → {rule['assignment_groups'][0]}")
        print(f"    (confidence: {rule['confidence']:.0%}, samples: {rule['sample_count']})")
    
    print(f"\nKeyword Rules Generated: {len(learned_rules['keyword_rules'])}")
    print("\nTop Keyword Rules:")
    for rule in learned_rules['keyword_rules'][:10]:
        print(f"  • '{rule['keyword']}' → {rule['assignment_groups'][0]}")
        print(f"    (confidence: {rule['confidence']:.0%}, samples: {rule['sample_count']})")
    
    print("\n" + "="*80)
    print("assignment_rules.json has been updated with actual ServiceNow data!")
    print("="*80)

def main():
    print("="*80)
    print("ASSIGNMENT RULES LEARNING FROM SERVICENOW DATA")
    print("="*80)
    
    # Step 1: Fetch incidents
    incidents = fetch_incidents_with_assignment()
    if not incidents:
        print("\n✗ No incidents found. Check ServiceNow connection.")
        return
    
    # Step 2: Resolve group names
    group_name_map = resolve_assignment_group_names(incidents)
    if not group_name_map:
        print("\n✗ Could not resolve any assignment group names.")
        return
    
    # Step 3: Analyze patterns
    patterns = analyze_patterns(incidents, group_name_map)
    
    # Step 4: Generate learned rules
    learned_rules = generate_learned_rules(patterns)
    
    # Step 5: Update assignment_rules.json
    updated_config = update_assignment_rules_file(learned_rules)
    
    # Step 6: Print summary
    print_summary(learned_rules, updated_config)

if __name__ == "__main__":
    main()
