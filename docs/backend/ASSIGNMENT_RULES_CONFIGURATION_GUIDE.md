# Assignment Rules Configuration Guide

## Current Status
The `assignment_rules.json` file contains **placeholder/template** assignment group names that need to be replaced with your actual ServiceNow assignment group values.

## How to Get Your Actual Assignment Group Names

### Option 1: ServiceNow UI (Recommended)
1. Log into your ServiceNow instance
2. Navigate to: **User Administration > Groups** (or search for "sys_user_group")
3. Filter by `Active = true`
4. Note the `Name` field values - these are your assignment group names
5. Common examples:
   - Service Desk
   - Network Operations
   - Database Team
   - Application Support
   - Infrastructure
   - Security Team

### Option 2: Query via API
If you have proper ServiceNow credentials configured:

```bash
cd backend
python discover_assignment_groups.py
```

This will query your ServiceNow instance and list all active groups.

### Option 3: Check Existing Incidents
1. Open any incident in ServiceNow
2. Look at the "Assignment Group" field
3. Note the exact display name (this is what goes in assignment_rules.json)

## How to Update assignment_rules.json

Once you have the actual group names, edit `backend/components/assignment_rules.json`:

### Find and Replace Pattern:

**Current (Template):**
```json
{
  "category": "Network Issues",
  "assignment_groups": ["Infrastructure Team", "Network Operations"],
  ...
}
```

**Update to (Your Actual Groups):**
```json
{
  "category": "Network Issues",
  "assignment_groups": ["Network Support", "IT Infrastructure"],
  ...
}
```

### Categories to Update:

1. **category_rules.mappings** - Line ~10-50
   - Update `assignment_groups` arrays with real group names

2. **keyword_rules.mappings** - Line ~60-140
   - Update `assignment_groups` arrays with real group names

3. **fallback** - Line ~155
   - Update default fallback groups

## Quick Validation

After updating, run the test to verify:

```bash
cd backend
python test_assignment_prediction.py
```

This will test the rules with sample incidents and show if predictions work correctly.

## Example Real-World Mappings

Common patterns you might have:

| Incident Type | Likely Assignment Groups |
|---------------|--------------------------|
| Email issues | Email Support, IT Help Desk |
| Password resets | Service Desk, IAM Team |
| Network outages | Network Operations, NOC |
| Server issues | Infrastructure, Systems |
| Database problems | Database Team, DBA |
| Application errors | Application Support, Dev Ops |

## Testing with Your Data

Once configured, test with actual incident numbers:

```python
from components.servicenowgenaitool import predict_assignment_group_core

result = predict_assignment_group_core(
    incident_number="INC0010014",
    category="Network Issues",
    similar_incidents=[]
)

print(result['recommendations'])
```

## Need Help?

If you provide a list of your actual ServiceNow assignment group names, I can update the file automatically.
