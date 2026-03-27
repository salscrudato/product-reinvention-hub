"""Test script for the new search_incidents_by_keywords function."""

import sys
import os

# Add the parent directory to path to import components
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_import():
    """Test that the function can be imported."""
    try:
        from components.servicenowgenaitool import search_incidents_by_keywords_core
        print("✓ search_incidents_by_keywords_core imported successfully")
        return True
    except Exception as e:
        print(f"✗ Import failed: {e}")
        return False

def test_registration():
    """Test that the function is registered in the tool registry."""
    try:
        from components.snowaaonetool import FUNCTION_REGISTRY
        
        if 'search_incidents_by_keywords' in FUNCTION_REGISTRY:
            print("✓ search_incidents_by_keywords registered in FUNCTION_REGISTRY")
            return True
        else:
            print("✗ search_incidents_by_keywords NOT found in FUNCTION_REGISTRY")
            return False
    except Exception as e:
        print(f"✗ Registration check failed: {e}")
        return False

def test_function_signature():
    """Test the function signature."""
    try:
        from components.servicenowgenaitool import search_incidents_by_keywords_core
        import inspect
        
        sig = inspect.signature(search_incidents_by_keywords_core)
        params = list(sig.parameters.keys())
        
        expected_params = ['keywords', 'search_fields', 'state_filter', 'priority_filter', 'limit']
        
        if params == expected_params:
            print(f"✓ Function signature correct: {params}")
            return True
        else:
            print(f"✗ Function signature mismatch. Expected: {expected_params}, Got: {params}")
            return False
    except Exception as e:
        print(f"✗ Signature check failed: {e}")
        return False

def main():
    """Run all tests."""
    print("=" * 60)
    print("Testing Keyword Search Implementation")
    print("=" * 60)
    
    results = []
    
    print("\n[1/3] Testing import...")
    results.append(test_import())
    
    print("\n[2/3] Testing registration...")
    results.append(test_registration())
    
    print("\n[3/3] Testing function signature...")
    results.append(test_function_signature())
    
    print("\n" + "=" * 60)
    if all(results):
        print("✓ ALL TESTS PASSED")
        print("\nThe new search_incidents_by_keywords tool is ready to use!")
        print("\nExample usage:")
        print('  search_incidents_by_keywords(keywords=["bank", "NIGO"])')
        print('  Result: Finds all incidents containing both "bank" AND "NIGO"')
    else:
        print("✗ SOME TESTS FAILED")
        print(f"  Passed: {sum(results)}/{len(results)}")
    print("=" * 60)
    
    return all(results)

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
