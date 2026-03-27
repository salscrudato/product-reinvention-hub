"""
Test script for uploading Swagger YAML file via API.
Demonstrates how to use the mapping API with the group_accident_insurance_api.yaml file.
"""
import requests
import json
from pathlib import Path

# Configuration
API_BASE_URL = "http://localhost:5001"  # Adjust if your backend runs on different port
SWAGGER_FILE = Path(__file__).parent / "test_excels" / "enriched" / "group_accident_insurance_api.yaml"

def test_upload_swagger_yaml():
    """Test uploading Swagger YAML file."""
    
    print("=" * 70)
    print("🧪 TESTING SWAGGER YAML UPLOAD")
    print("=" * 70)
    
    # Check file exists
    if not SWAGGER_FILE.exists():
        print(f"❌ Error: Swagger file not found at {SWAGGER_FILE}")
        return False
    
    print(f"\n📁 Uploading file: {SWAGGER_FILE.name}")
    print(f"   File size: {SWAGGER_FILE.stat().st_size} bytes")
    
    # Upload Swagger file
    url = f"{API_BASE_URL}/mapping/parse/swagger"
    
    with open(SWAGGER_FILE, 'rb') as f:
        files = {'file': (SWAGGER_FILE.name, f, 'application/x-yaml')}
        
        try:
            print(f"\n🌐 Sending POST request to: {url}")
            response = requests.post(url, files=files, timeout=30)
            
            print(f"\n📊 Response Status: {response.status_code}")
            
            if response.status_code == 200 or response.status_code == 201:
                data = response.json()
                
                print("\n✅ SUCCESS! Swagger parsed successfully\n")
                print("=" * 70)
                print("📋 API SUMMARY")
                print("=" * 70)
                
                summary = data.get('summary', {})
                print(f"  API Title: {summary.get('api_title')}")
                print(f"  Version: {summary.get('api_version')}")
                print(f"  Description: {summary.get('api_description', 'N/A')[:80]}...")
                print(f"  Total Endpoints: {summary.get('total_endpoints')}")
                print(f"  Total Operations: {summary.get('total_operations')}")
                
                print("\n" + "=" * 70)
                print("🔌 OPERATIONS EXTRACTED")
                print("=" * 70)
                
                operations = data.get('operations', [])
                for i, op in enumerate(operations[:5], 1):  # Show first 5
                    print(f"\n  {i}. {op.get('operation_id')}")
                    print(f"     Method: {op.get('method')} {op.get('endpoint')}")
                    print(f"     Summary: {op.get('summary')}")
                    print(f"     Input attrs: {op.get('input_attributes_count')}")
                    print(f"     Output attrs: {op.get('output_attributes_count')}")
                
                if len(operations) > 5:
                    print(f"\n  ... and {len(operations) - 5} more operations")
                
                print("\n" + "=" * 70)
                print("📊 CONTEXT")
                print("=" * 70)
                
                context = data.get('context', {})
                print(f"  Total Attributes: {context.get('total_attributes')}")
                print(f"  Has Descriptions: {context.get('has_descriptions')}")
                
                print("\n" + "=" * 70)
                print("✅ TEST PASSED - YAML file accepted and parsed!")
                print("=" * 70)
                
                return True
                
            else:
                print(f"\n❌ ERROR: Request failed")
                print(f"   Status Code: {response.status_code}")
                print(f"   Response: {response.text}")
                return False
                
        except requests.exceptions.ConnectionError:
            print(f"\n❌ ERROR: Could not connect to {API_BASE_URL}")
            print("   Make sure the backend server is running:")
            print("   cd c:\\dev\\snowchat\\backend")
            print("   python app.py")
            return False
            
        except Exception as e:
            print(f"\n❌ ERROR: {type(e).__name__}: {e}")
            return False


def test_upload_swagger_json():
    """Test uploading Swagger as JSON (convert YAML first)."""
    
    print("\n" + "=" * 70)
    print("🧪 TESTING SWAGGER JSON UPLOAD (YAML → JSON)")
    print("=" * 70)
    
    try:
        import yaml
        
        # Load YAML and convert to JSON
        with open(SWAGGER_FILE, 'r') as f:
            swagger_dict = yaml.safe_load(f)
        
        # Save as temporary JSON
        json_file = SWAGGER_FILE.with_suffix('.json')
        with open(json_file, 'w') as f:
            json.dump(swagger_dict, f, indent=2)
        
        print(f"\n📁 Converted YAML → JSON: {json_file.name}")
        
        # Upload JSON file
        url = f"{API_BASE_URL}/mapping/parse/swagger"
        
        with open(json_file, 'rb') as f:
            files = {'file': (json_file.name, f, 'application/json')}
            
            response = requests.post(url, files=files, timeout=30)
            
            print(f"\n📊 Response Status: {response.status_code}")
            
            if response.status_code == 200 or response.status_code == 201:
                print("\n✅ SUCCESS! JSON file also accepted")
                return True
            else:
                print(f"\n❌ ERROR: {response.status_code} - {response.text}")
                return False
                
    except ImportError:
        print("\n⚠️  PyYAML not installed - skipping JSON test")
        print("   Install with: pip install PyYAML")
        return None
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        return False


def main():
    """Run all tests."""
    
    print("\n" + "╔" + "=" * 68 + "╗")
    print("║" + " " * 15 + "SWAGGER UPLOAD TEST SUITE" + " " * 28 + "║")
    print("╚" + "=" * 68 + "╝\n")
    
    # Test 1: Upload YAML
    yaml_result = test_upload_swagger_yaml()
    
    # Test 2: Upload JSON (optional)
    json_result = test_upload_swagger_json()
    
    # Summary
    print("\n" + "=" * 70)
    print("📊 TEST SUMMARY")
    print("=" * 70)
    print(f"  YAML Upload: {'✅ PASS' if yaml_result else '❌ FAIL'}")
    if json_result is not None:
        print(f"  JSON Upload: {'✅ PASS' if json_result else '❌ FAIL'}")
    print("=" * 70)
    
    if yaml_result:
        print("\n✨ Your Swagger YAML file is compatible with the UI upload!")
        print("   You can now upload it through the web interface.")
    else:
        print("\n⚠️  Issues detected - check error messages above")


if __name__ == "__main__":
    main()
