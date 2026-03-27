"""Test script to diagnose ServiceNow date query issue"""
import os
import requests
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ServiceNow credentials from environment
SNOW_INSTANCE = os.getenv("SERVICENOW_INSTANCE", "https://dev192699.service-now.com")
SNOW_USER = os.getenv("SERVICENOW_USER", "admin")
SNOW_PASSWORD = os.getenv("SERVICENOW_PASSWORD", "your_password")

def test_date_queries():
    """Test different date field queries"""
    
    today_str = "2026-01-19"
    
    tests = [
        {
            "name": "Query 1: opened_at field",
            "query": f"opened_atGREATERTHANOREQUALTO{today_str} 00:00:00^opened_atLESSTHANOREQUALTO{today_str} 23:59:59"
        },
        {
            "name": "Query 2: sys_created_on field",
            "query": f"sys_created_onGREATERTHANOREQUALTO{today_str} 00:00:00^sys_created_onLESSTHANOREQUALTO{today_str} 23:59:59"
        },
        {
            "name": "Query 3: opened_at with state filter (1,2,3)",
            "query": f"opened_atGREATERTHANOREQUALTO{today_str} 00:00:00^opened_atLESSTHANOREQUALTO{today_str} 23:59:59^state=1,2,3"
        },
        {
            "name": "Query 4: opened_atON{today_str}",
            "query": f"opened_atON{today_str}"
        },
        {
            "name": "Query 5: opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)",
            "query": "opened_atONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)"
        },
        {
            "name": "Query 6: opened_at>=18:00:00",
            "query": f"opened_atGREATERTHANOREQUALTO{today_str} 18:00:00^opened_atLESSTHANOREQUALTO{today_str} 23:59:59"
        },
        {
            "name": "Query 7: opened_atBETWEEN with @",
            "query": f"opened_atBETWEEN{today_str}@{today_str}"
        }
    ]
    
    for test in tests:
        print(f"\n{'='*80}")
        print(f"{test['name']}")
        print(f"Query: {test['query']}")
        print(f"{'='*80}")
        
        url = f"{SNOW_INSTANCE}/api/now/table/incident"
        params = {
            "sysparm_query": test['query'],
            "sysparm_limit": 20,
            "sysparm_fields": "number,short_description,opened_at,sys_created_on,state"
        }
        
        try:
            response = requests.get(
                url,
                auth=(SNOW_USER, SNOW_PASSWORD),
                headers={"Accept": "application/json"},
                params=params,
                timeout=30
            )
            
            print(f"HTTP Status: {response.status_code}")
            print(f"Full URL: {response.url}")
            
            if response.status_code == 200:
                result = response.json()
                incidents = result.get("result", [])
                print(f"Incidents returned: {len(incidents)}")
                
                if incidents:
                    print("\nFirst 3 incidents:")
                    for inc in incidents[:3]:
                        print(f"  - {inc.get('number')}: opened_at={inc.get('opened_at')}, sys_created_on={inc.get('sys_created_on')}, state={inc.get('state')}")
                else:
                    print("  NO INCIDENTS FOUND")
            else:
                print(f"ERROR: {response.text}")
                
        except Exception as e:
            print(f"EXCEPTION: {e}")

if __name__ == "__main__":
    print(f"Testing ServiceNow date queries for {datetime.now().strftime('%Y-%m-%d')}")
    print(f"Instance: {SNOW_INSTANCE}")
    print(f"User: {SNOW_USER}")
    
    # First, get a few recent incidents to see what dates they have
    print("\n" + "="*80)
    print("STEP 1: Fetching recent incidents to see actual dates")
    print("="*80)
    
    url = f"{SNOW_INSTANCE}/api/now/table/incident"
    params = {
        "sysparm_query": "ORDERBYDESCsys_created_on",
        "sysparm_limit": 20,
        "sysparm_fields": "number,short_description,opened_at,sys_created_on,state"
    }
    
    try:
        response = requests.get(
            url,
            auth=(SNOW_USER, SNOW_PASSWORD),
            headers={"Accept": "application/json"},
            params=params,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            incidents = result.get("result", [])
            print(f"Most recent {len(incidents)} incidents:")
            for inc in incidents:
                print(f"  {inc.get('number')}: opened_at={inc.get('opened_at')}, sys_created_on={inc.get('sys_created_on')}")
        else:
            print(f"ERROR: {response.text}")
    except Exception as e:
        print(f"EXCEPTION: {e}")
    
    print("\n")
    test_date_queries()
