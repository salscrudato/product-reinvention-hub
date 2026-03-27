"""Test assignment predictions with real ServiceNow group names."""
from components.servicenowgenaitool import predict_assignment_group_core

print("="*60)
print("TESTING ASSIGNMENT PREDICTIONS WITH REAL GROUP NAMES")
print("="*60)
print()

# Test 1: Network issue
result1 = predict_assignment_group_core(
    incident_number='INC0010001',
    short_description='Network connectivity problems',
    category='',
    similar_incidents=[]
)

print('Test 1: Network Issue')
print('  Description: "Network connectivity problems"')
print('  Top recommendations:')
for i, rec in enumerate(result1['recommendations'][:3], 1):
    print(f'    {i}. {rec["assignment_group"]} (confidence: {rec["confidence"]:.0%})')
if result1['reasoning_steps']:
    print(f'  Reasoning: {result1["reasoning_steps"][0]}')
print()

# Test 2: Password reset
result2 = predict_assignment_group_core(
    incident_number='INC0010002',
    short_description='Cannot login, need password reset',
    category='',
    similar_incidents=[]
)

print('Test 2: Password Reset')
print('  Description: "Cannot login, need password reset"')
print('  Top recommendations:')
for i, rec in enumerate(result2['recommendations'][:3], 1):
    print(f'    {i}. {rec["assignment_group"]} (confidence: {rec["confidence"]:.0%})')
if result2['reasoning_steps']:
    print(f'  Reasoning: {result2["reasoning_steps"][0]}')
print()

# Test 3: Policy issue
result3 = predict_assignment_group_core(
    incident_number='INC0010003',
    short_description='Policy application issue',
    category='',
    similar_incidents=[]
)

print('Test 3: Policy Issue')
print('  Description: "Policy application issue"')
print('  Top recommendations:')
for i, rec in enumerate(result3['recommendations'][:3], 1):
    print(f'    {i}. {rec["assignment_group"]} (confidence: {rec["confidence"]:.0%})')
if result3['reasoning_steps']:
    print(f'  Reasoning: {result3["reasoning_steps"][0]}')
print()

# Test 4: Hardware category
result4 = predict_assignment_group_core(
    incident_number='INC0010004',
    short_description='Printer not working',
    category='hardware',
    similar_incidents=[]
)

print('Test 4: Hardware Category')
print('  Description: "Printer not working"')
print('  Category: "hardware"')
print('  Top recommendations:')
for i, rec in enumerate(result4['recommendations'][:3], 1):
    print(f'    {i}. {rec["assignment_group"]} (confidence: {rec["confidence"]:.0%})')
if result4['reasoning_steps']:
    print(f'  Reasoning: {result4["reasoning_steps"][0]}')
print()

# Test 5: Software category with application keyword
result5 = predict_assignment_group_core(
    incident_number='INC0010005',
    short_description='Application crashes when opening',
    category='software',
    similar_incidents=[]
)

print('Test 5: Software + Application')
print('  Description: "Application crashes when opening"')
print('  Category: "software"')
print('  Top recommendations:')
for i, rec in enumerate(result5['recommendations'][:3], 1):
    print(f'    {i}. {rec["assignment_group"]} (confidence: {rec["confidence"]:.0%})')
if result5['reasoning_steps']:
    print(f'  Reasoning: {result5["reasoning_steps"][0]}')
print()

print("="*60)
print("TESTS COMPLETE")
print("="*60)
