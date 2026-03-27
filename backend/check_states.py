"""Check state values of incidents opened today"""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

SNOW_INSTANCE = os.getenv("SERVICENOW_INSTANCE")
SNOW_USER = os.getenv("SERVICENOW_USER")
SNOW_PASSWORD = os.getenv("SERVICENOW_PASSWORD")

# Query without state filter
url = f"{SNOW_INSTANCE}/api/now/table/incident"
params = {
    "sysparm_query": "opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)",
    "sysparm_fields": "number,state,opened_at,short_description",
    "sysparm_limit": 20
}

response = requests.get(url, auth=(SNOW_USER, SNOW_PASSWORD), params=params)
incidents = response.json().get("result", [])

print(f"Total incidents: {len(incidents)}\n")
print("State breakdown:")
for inc in incidents:
    print(f"  {inc['number']}: state={inc['state']} opened_at={inc['opened_at']}")

# Now test with state filter
print("\n" + "="*80)
print("Testing with state filter (1,2,3)")
print("="*80)

params["sysparm_query"] = "opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^state=1,2,3"
response2 = requests.get(url, auth=(SNOW_USER, SNOW_PASSWORD), params=params)
incidents2 = response2.json().get("result", [])

print(f"Total incidents with state filter: {len(incidents2)}")
