"""
Quick Start Script for Mapping Knowledge Base
Demonstrates importing a product and getting AI suggestions.
"""

import requests
import json
from pathlib import Path

BASE_URL = "http://localhost:5001/mapping"

def test_knowledge_base():
    print("=" * 80)
    print("Mapping Knowledge Base - Quick Start")
    print("=" * 80)
    
    # 1. Create sample product
    print("\n[1] Creating sample product...")
    
    product_data = {
        "productName": "Sample Group Life",
        "productType": "Group Life",
        "version": "1.0",
        "description": "Sample product for testing knowledge base"
    }
    
    # Note: In real usage, you'd upload actual Swagger file
    # For demo, we'll create mappings manually
    
    response = requests.post(
        f"{BASE_URL}/knowledge-base/products",
        data=product_data,
        files={
            "swaggerFile": ("sample_swagger.yaml", b'swagger: "2.0"\ninfo:\n  title: Sample\n  version: 1.0\npaths: {}', "application/yaml")
        }
    )
    
    if response.status_code == 200:
        product = response.json().get("product", {})
        product_id = product.get("id")
        print(f"✓ Product created | ID: {product_id}")
    else:
        print(f"✗ Failed to create product: {response.text}")
        return
    
    # 2. Add sample mappings
    print("\n[2] Adding sample field mappings...")
    
    sample_mappings = [
        {
            "productId": product_id,
            "wordPlaceholder": "[ELIGIBLE_LIVES]",
            "jsonPath": "eligibleLives",
            "swaggerOperation": "getQuote",
            "dataType": "number",
            "sampleValue": "100",
            "notes": "Number of eligible employees"
        },
        {
            "productId": product_id,
            "wordPlaceholder": "[SIC_CODE]",
            "jsonPath": "sicCode",
            "swaggerOperation": "getQuote",
            "dataType": "string",
            "sampleValue": "8742",
            "notes": "Standard Industrial Classification code"
        },
        {
            "productId": product_id,
            "wordPlaceholder": "[PLAN_NAME]",
            "jsonPath": "planName",
            "swaggerOperation": "getQuote",
            "dataType": "string",
            "sampleValue": "Group Term Life",
            "notes": "Name of the insurance plan"
        },
        {
            "productId": product_id,
            "wordPlaceholder": "[EFFECTIVE_DATE_MDY]",
            "jsonPath": "effectiveDate",
            "swaggerOperation": "getQuote",
            "dataType": "date",
            "sampleValue": "01/01/2026",
            "notes": "Policy effective date in MM/DD/YYYY format"
        },
    ]
    
    for mapping in sample_mappings:
        response = requests.post(
            f"{BASE_URL}/knowledge-base/mappings",
            json=mapping
        )
        if response.status_code == 200:
            placeholder = mapping["wordPlaceholder"]
            json_path = mapping["jsonPath"]
            print(f"  ✓ Created mapping: {placeholder} → {json_path}")
        else:
            print(f"  ✗ Failed: {response.text}")
    
    # 3. Vectorize product
    print("\n[3] Vectorizing product for AI search...")
    
    response = requests.post(f"{BASE_URL}/knowledge-base/products/{product_id}/vectorize")
    
    if response.status_code == 200:
        result = response.json()
        vectorized = result.get("vectorizedCount", 0)
        print(f"✓ Vectorized {vectorized} mappings")
    else:
        print(f"✗ Vectorization failed: {response.text}")
    
    # 4. Get vectorization status
    print("\n[4] Checking vectorization status...")
    
    response = requests.get(f"{BASE_URL}/knowledge-base/vectorization/status")
    
    if response.status_code == 200:
        status = response.json()
        print(f"  Total Products: {status.get('totalProducts')}")
        print(f"  Vectorized: {status.get('vectorizedProducts')}")
        print(f"  Total Mappings: {status.get('totalMappings')}")
        print(f"  Indexed Vectors: {status.get('indexedVectors')}")
        print(f"  Cache Size: {status.get('cacheSizeBytes')} bytes")
    
    # 5. Test AI suggestions
    print("\n[5] Testing AI suggestions for new placeholders...")
    
    test_placeholders = [
        "[EMPLOYEE_COUNT]",     # Should match [ELIGIBLE_LIVES]
        "[COVERAGE_AMOUNT]",    # New field
        "[PLAN_TYPE]",          # Should partially match [PLAN_NAME]
        "[START_DATE]",         # Should match [EFFECTIVE_DATE_MDY]
    ]
    
    response = requests.post(
        f"{BASE_URL}/knowledge-base/suggestions",
        json={
            "placeholders": test_placeholders,
            "productType": "Group Life",
            "confidenceThreshold": 0.6  # Lower threshold for demo
        }
    )
    
    if response.status_code == 200:
        result = response.json()
        suggestions = result.get("suggestions", [])
        
        print(f"\n  Received {len(suggestions)} suggestions:")
        for suggestion in suggestions:
            placeholder = suggestion.get("wordPlaceholder")
            suggested_path = suggestion.get("suggestedJsonPath")
            confidence = suggestion.get("confidenceScore", 0)
            source_mapping = suggestion.get("sourceMapping")
            
            print(f"\n  {placeholder}")
            print(f"    → Suggested: {suggested_path}")
            print(f"    → Confidence: {confidence:.2%}")
            print(f"    → Source: {source_mapping}")
            
            alternatives = suggestion.get("alternativeMatches", [])
            if alternatives:
                print(f"    → Alternatives:")
                for alt in alternatives:
                    print(f"        • {alt.get('jsonPath')} (score: {alt.get('score', 0):.2%})")
    else:
        print(f"✗ Suggestions failed: {response.text}")
    
    # 6. Search for similar mappings
    print("\n[6] Searching for mappings similar to 'PLAN'...")
    
    response = requests.get(
        f"{BASE_URL}/knowledge-base/mappings/search",
        params={
            "placeholder": "PLAN",
            "productType": "Group Life",
            "limit": 5
        }
    )
    
    if response.status_code == 200:
        result = response.json()
        mappings = result.get("mappings", [])
        print(f"  Found {len(mappings)} similar mappings:")
        for mapping in mappings:
            print(f"    • {mapping.get('wordPlaceholder')} → {mapping.get('jsonPath')}")
    
    print("\n" + "=" * 80)
    print("✓ Quick start complete!")
    print("=" * 80)
    print("\nNext steps:")
    print("1. Open UI: http://localhost:3000 → Dashboard → 'Open Knowledge Base'")
    print("2. Import your actual 10,000-field product via UI")
    print("3. Vectorize for AI-powered suggestions")
    print("4. Use suggestions in Mapping Wizard (coming in Phase 2)")
    print("\nDocumentation: backend/MAPPING_KNOWLEDGE_BASE_GUIDE.md")
    print("=" * 80)

if __name__ == "__main__":
    print("\nNOTE: Make sure backend is running (python backend/app.py)\n")
    
    try:
        test_knowledge_base()
    except requests.exceptions.ConnectionError:
        print("\n✗ ERROR: Cannot connect to backend at http://localhost:5001")
        print("  Please start the backend first: cd backend && python app.py")
    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
