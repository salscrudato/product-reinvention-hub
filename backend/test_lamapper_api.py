"""
Data Mapper API Test Script
============================

Quick test to verify Data Mapper API endpoints are working.

Prerequisites:
- SnowChat backend running on http://localhost:5001
- Flask app loaded with lamapper_bp blueprint

Usage:
    python test_lamapper_api.py
"""

import requests
import json

BASE_URL = "http://localhost:5001/api/lamapper"

def test_health():
    """Test health check endpoint."""
    print("🔍 Testing health check...")
    try:
        response = requests.get(f"{BASE_URL}/health")
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
        return response.status_code == 200
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


def test_create_project():
    """Test project creation."""
    print("\n🔍 Testing project creation...")
    try:
        payload = {
            "project_name": "Test Insurance Mapping",
            "description": "Test project for Data Mapper Wizard",
            "tags": ["test", "insurance", "acord"]
        }
        response = requests.post(f"{BASE_URL}/projects", json=payload)
        print(f"   Status: {response.status_code}")
        data = response.json()
        print(f"   Project ID: {data.get('project', {}).get('id')}")
        
        if response.status_code == 201:
            return data['project']['id']
        return None
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return None


def test_get_status(project_id):
    """Test getting processing status."""
    print(f"\n🔍 Testing status retrieval for project {project_id}...")
    try:
        response = requests.get(f"{BASE_URL}/projects/{project_id}/documents/status")
        print(f"   Status: {response.status_code}")
        print(f"   Response: {json.dumps(response.json(), indent=2)}")
        return response.status_code == 200
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


def test_knowledge_base(project_id):
    """Test knowledge base endpoint."""
    print(f"\n🔍 Testing knowledge base for project {project_id}...")
    try:
        response = requests.get(f"{BASE_URL}/projects/{project_id}/knowledge-base")
        print(f"   Status: {response.status_code}")
        data = response.json()
        print(f"   Total chunks: {data.get('knowledge_base', {}).get('total_chunks', 0)}")
        return response.status_code == 200
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


def test_chat(project_id):
    """Test agentic chat endpoint."""
    print(f"\n🔍 Testing agentic chat for project {project_id}...")
    try:
        payload = {
            "message": "What documents are in this project?",
            "annotations": ["@datamapper"],
            "settings": {
                "enable_planning": True,
                "show_citations": True
            }
        }
        response = requests.post(f"{BASE_URL}/projects/{project_id}/chat", json=payload)
        print(f"   Status: {response.status_code}")
        data = response.json()
        print(f"   Response message: {data.get('response', {}).get('message', '')[:100]}...")
        return response.status_code == 200
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


def main():
    """Run all tests."""
    print("=" * 60)
    print("Data Mapper API Test Suite")
    print("=" * 60)
    
    results = {}
    
    # Test 1: Health check
    results['health'] = test_health()
    
    # Test 2: Create project
    project_id = test_create_project()
    results['create_project'] = project_id is not None
    
    if project_id:
        # Test 3: Get status
        results['get_status'] = test_get_status(project_id)
        
        # Test 4: Knowledge base
        results['knowledge_base'] = test_knowledge_base(project_id)
        
        # Test 5: Chat
        results['chat'] = test_chat(project_id)
    else:
        print("\n⚠️ Skipping remaining tests - project creation failed")
        results['get_status'] = False
        results['knowledge_base'] = False
        results['chat'] = False
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    total = len(results)
    passed = sum(results.values())
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print("\n⚠️ Some tests failed - check backend logs")
        return 1


if __name__ == "__main__":
    exit(main())
