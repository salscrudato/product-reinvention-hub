import os
import requests
from components.servicenowgenaitool import servicenow_instance, _sn_auth

# Test the exact query that should work
start_date = "2026-01-06"
end_date = "2026-01-27"
date_field = "opened_at"

# Build query string
start_datetime = f"{start_date} 00:00:00"
end_datetime = f"{end_date} 23:59:59"
query_parts = [
    f"{date_field}GREATERTHANOREQUALTO{start_datetime}",
    f"{date_field}LESSTHANOREQUALTO{end_datetime}"
]
query_string = "^".join(query_parts)

url = f"{servicenow_instance}/api/now/table/incident"
params = {
    "sysparm_query": query_string,
    "sysparm_limit": 100,
    "sysparm_display_value": "true"
}

print(f"URL: {url}")
print(f"Query String: {query_string}")
print(f"Full params: {params}")
print()

response = requests.get(url, auth=_sn_auth(), headers={"Accept": "application/json"}, params=params, timeout=30)
print(f"Status: {response.status_code}")
print(f"Response length: {len(response.text)} bytes")

result = response.json()
incidents = result.get("result", [])
print(f"Incidents found: {len(incidents)}")

if incidents:
    print("\nFirst 3 incidents:")
    for inc in incidents[:3]:
        print(f"  {inc.get('number')}: opened_at={inc.get('opened_at')}")
else:
    print("\nNO INCIDENTS FOUND!")
    print(f"Full response: {result}")
    
# Now try WITHOUT sysparm_display_value
print("\n\n=== Testing WITHOUT sysparm_display_value ===")
params3 = {
    "sysparm_query": query_string,
    "sysparm_limit": 100
}
print(f"Query String: {query_string}")
print(f"Params (no display_value): {params3}")
response3 = requests.get(url, auth=_sn_auth(), headers={"Accept": "application/json"}, params=params3, timeout=30)
result3 = response3.json()
incidents3 = result3.get("result", [])
print(f"Incidents found: {len(incidents3)}")
if incidents3:
    print("First 3:")
    for inc in incidents3[:3]:
        print(f"  {inc.get('number')}: opened_at={inc.get('opened_at')}, assigned_to={inc.get('assigned_to')}")
