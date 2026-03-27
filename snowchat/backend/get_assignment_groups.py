import os
import requests
from requests.auth import HTTPBasicAuth

SNOW_INSTANCE = os.getenv('SNOW_INSTANCE', 'dev192699.service-now.com')
SNOW_USER = os.getenv('SNOW_USER', 'admin')
SNOW_PASSWORD = os.getenv('SNOW_PASSWORD', 'admin')

# Get incidents with assignment groups
url = f'https://{SNOW_INSTANCE}/api/now/table/incident'
params = {'sysparm_limit': 50, 'sysparm_fields': 'number,assignment_group,short_description'}
resp = requests.get(url, auth=HTTPBasicAuth(SNOW_USER, SNOW_PASSWORD), params=params)
incidents = resp.json().get('result', [])

# Collect unique group sys_ids
group_ids = set()
for inc in incidents:
    if inc.get('assignment_group') and isinstance(inc['assignment_group'], dict):
        gid = inc['assignment_group'].get('value')
        if gid:
            group_ids.add(gid)

print(f'Found {len(group_ids)} unique assignment groups in {len(incidents)} incidents\n')
print('='*80)

# Query each group to get name
group_names = []
for gid in group_ids:
    group_url = f'https://{SNOW_INSTANCE}/api/now/table/sys_user_group/{gid}'
    gresp = requests.get(group_url, auth=HTTPBasicAuth(SNOW_USER, SNOW_PASSWORD))
    if gresp.status_code == 200:
        group = gresp.json().get('result', {})
        name = group.get('name', 'Unknown')
        group_names.append(name)
        print(f'✓ {name}')
    else:
        print(f'✗ Error fetching {gid}')

print('\n' + '='*80)
print('\nAll Assignment Group Names (for assignment_rules.json):')
print('='*80)
for name in sorted(group_names):
    print(f'  "{name}",')
