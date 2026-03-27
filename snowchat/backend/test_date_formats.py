import os
import requests
from components.servicenowgenaitool import servicenow_instance, _sn_auth

# Test different date formats
url = f"{servicenow_instance}/api/now/table/incident"

# Test 1: Using javascript:gs.dateGenerate
test_queries = [
    ("Plain dates", "opened_at>=2026-01-06^opened_at<=2026-01-27"),
    ("With javascript", "opened_atONLast 30 days@javascript:gs.daysAgoStart(30)@javascript:gs.daysAgoEnd(0)"),
    ("sys_created_on instead", "sys_created_on>=2026-01-19 00:00:00^sys_created_on<=2026-01-19 23:59:59"),
    ("opened_at with >=", "opened_at>=2026-01-19"),
]

for name, query in test_queries:
    print(f"\n=== {name} ===")
    print(f"Query: {query}")
    params = {
        "sysparm_query": query,
        "sysparm_limit": 10
    }
    response = requests.get(url, auth=_sn_auth(), headers={"Accept": "application/json"}, params=params, timeout=30)
    result = response.json()
    incidents = result.get("result", [])
    print(f"Found: {len(incidents)} incidents")
    if incidents:
        for inc in incidents[:3]:
            print(f"  {inc.get('number')}: {inc.get('opened_at') or inc.get('sys_created_on')}")
