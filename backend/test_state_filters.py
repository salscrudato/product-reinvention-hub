"""Test different state filter syntaxes"""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

SNOW_INSTANCE = os.getenv("SERVICENOW_INSTANCE")
SNOW_USER = os.getenv("SERVICENOW_USER")
SNOW_PASSWORD = os.getenv("SERVICENOW_PASSWORD")

url = f"{SNOW_INSTANCE}/api/now/table/incident"

tests = [
    ("No state filter", "opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)"),
    ("state=1,2,3 (comma)", "opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^state=1,2,3"),
    ("stateIN1,2,3 (IN operator)", "opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^stateIN1,2,3"),
    ("state=1^NQstate=2^NQstate=3 (OR chains)", "opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^state=1^NQstate=2^NQstate=3"),
    ("state=1^ORstate=2^ORstate=3 (OR operator)", "opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^state=1^ORstate=2^ORstate=3"),
]

for name, query in tests:
    params = {
        "sysparm_query": query,
        "sysparm_fields": "number,state",
        "sysparm_limit": 20
    }
    response = requests.get(url, auth=(SNOW_USER, SNOW_PASSWORD), params=params)
    incidents = response.json().get("result", [])
    print(f"{name:40s} -> {len(incidents)} incidents")
    if incidents and len(incidents) > 0:
        print(f"  First: {incidents[0]['number']} state={incidents[0]['state']}")
