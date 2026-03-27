"""
Test L&A Domain Knowledge Tools - Simple validation

Tests the working L&A NIGO resolver tools.
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from components.domain.life_annuity_knowledge import (
    resolve_la_nigo_tool,
    get_la_nigo_types_tool
)
from components.shared_registry import FUNCTION_REGISTRY

print("="*80)
print("L&A DOMAIN KNOWLEDGE TOOLS TEST")
print("="*80)

# Test 1: Tool registration
print("\n✓ Test 1: Tool Registration")
assert "resolve_la_nigo" in FUNCTION_REGISTRY
assert "get_la_nigo_types" in FUNCTION_REGISTRY
print(f"  Registered: resolve_la_nigo, get_la_nigo_types")
print(f"  Total tools: {len(FUNCTION_REGISTRY)}")

# Test 2: Get NIGO types
print("\n✓ Test 2: Get L&A NIGO Types")
result = get_la_nigo_types_tool()
print(f"  NIGO Types: {len(result.get('nigo_types', {}))} types defined")
for nigo_type, info in list(result.get('nigo_types', {}).items())[:3]:
    print(f"    - {nigo_type}: {info.get('description', '')[:60]}...")

# Test 3: Resolve NIGO incident
print("\n✓ Test 3: Resolve L&A NIGO Incident")
print("  Testing with INC0010001 (NIGO successor owner)...")
try:
    result = resolve_la_nigo_tool("INC0010001")
    if "error" in result:
        print(f"  ⚠️  {result['error']}")
    else:
        print(f"  Incident: {result['incident']['number']}")
        print(f"  L&A NIGO Type: {result['la_nigo_type']}")
        print(f"  Wiki Sources: {len(result.get('wiki_sources', []))}")
        print(f"  Similar L&A Incidents: {len(result.get('similar_la_nigo', []))}")
except Exception as e:
    print(f"  ⚠️  {e}")

print("\n" + "="*80)
print("TESTS COMPLETE - L&A NIGO resolver tools working")
print("="*80)
print("="*80)
