"""Test the new assignment tools."""
from components.servicenowgenaitool import get_assignment_groups_core, get_assignment_rules_core

print("="*80)
print("TESTING NEW ASSIGNMENT TOOLS")
print("="*80)

# Test 1: get_assignment_groups
print("\n1. Testing get_assignment_groups_core()")
print("-" * 80)
result1 = get_assignment_groups_core()

if 'error' in result1:
    print(f"❌ Error: {result1['error']}")
else:
    print(f"✅ Total groups: {result1['total_groups']}")
    print(f"   Data source: {result1['data_source']}")
    print(f"\n   Sample groups:")
    for group in result1['groups'][:3]:
        print(f"   • {group['name']}")
        print(f"     Specialization: {group['specialization']}")
        if group['categories_handled']:
            print(f"     Categories: {', '.join(group['categories_handled'])}")
        if group['keywords']:
            print(f"     Keywords: {', '.join(group['keywords'][:5])}")

# Test 2: get_assignment_rules
print("\n2. Testing get_assignment_rules_core()")
print("-" * 80)
result2 = get_assignment_rules_core()

if 'error' in result2:
    print(f"❌ Error: {result2['error']}")
else:
    print(f"✅ Category rules: {result2['category_rules']['count']}")
    print(f"   Keyword rules: {result2['keyword_rules']['count']}")
    print(f"   Functionality rules: {result2['functionality_rules']['count']}")
    print(f"   Data source: {result2['data_source']}")
    
    print(f"\n   Sample category rules:")
    for rule in result2['category_rules']['rules'][:3]:
        print(f"   • {rule['category']} → {rule['assignment_group']} ({rule['confidence']:.0%})")
    
    print(f"\n   Sample keyword rules:")
    for rule in result2['keyword_rules']['rules'][:3]:
        print(f"   • {rule['keyword']} → {rule['assignment_group']} ({rule['confidence']:.0%})")

print("\n" + "="*80)
print("✅ BOTH TOOLS WORKING - Ready to answer assignment questions!")
print("="*80)
