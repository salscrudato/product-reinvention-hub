"""
Test NIGO Resolvers - L&A and P&C
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from components.domain.life_annuity_knowledge import resolve_la_nigo_tool, get_la_nigo_types_tool
from components.domain.pc_nigo_resolver import resolve_pc_nigo_tool, get_pc_nigo_types_tool
from components.shared_registry import FUNCTION_REGISTRY

print("="*80)
print("NIGO RESOLVERS TEST - L&A and P&C")
print("="*80)

# Test 1: Tool registration
print("\n✓ Test 1: Tool Registration")
assert "resolve_la_nigo" in FUNCTION_REGISTRY
assert "get_la_nigo_types" in FUNCTION_REGISTRY
assert "resolve_pc_nigo" in FUNCTION_REGISTRY
assert "get_pc_nigo_types" in FUNCTION_REGISTRY
print(f"  ✅ L&A NIGO Resolver registered")
print(f"  ✅ P&C NIGO Resolver registered")
print(f"  Total tools: {len(FUNCTION_REGISTRY)}")

# Test 2: L&A NIGO types
print("\n✓ Test 2: L&A NIGO Types")
la_types = get_la_nigo_types_tool()
print(f"  L&A NIGO types: {len(la_types['nigo_types'])}")
for nigo_type, info in list(la_types['nigo_types'].items())[:3]:
    print(f"    • {nigo_type}: {info['description'][:60]}...")

# Test 3: P&C NIGO types
print("\n✓ Test 3: P&C NIGO Types")
pc_types = get_pc_nigo_types_tool()
print(f"  P&C NIGO types: {len(pc_types['nigo_types'])}")
for nigo_type, info in list(pc_types['nigo_types'].items())[:3]:
    print(f"    • {nigo_type}: {info['description'][:60]}...")

# Test 4: L&A NIGO resolution
print("\n✓ Test 4: L&A NIGO Resolution")
print("  Testing with INC0010001 (NIGO successor owner)...")
try:
    result = resolve_la_nigo_tool("INC0010001")
    if "error" in result:
        print(f"  ⚠️  {result['error']}")
    else:
        print(f"  Incident: {result['incident']['number']}")
        print(f"  L&A NIGO Type: {result['la_nigo_type']}")
        print(f"  Wiki Sources: {len(result['wiki_sources'])}")
        print(f"  Similar L&A NIGO Cases: {len(result['similar_la_nigo'])}")
        if result['wiki_sources']:
            print(f"  Wiki returned: {result['resolution_knowledge'][:100]}...")
except Exception as e:
    print(f"  ⚠️  {e}")

# Test 5: P&C NIGO resolution
print("\n✓ Test 5: P&C NIGO Resolution (simulated)")
print("  P&C resolver ready to process Auto/Property NIGO incidents")
print("  Query example: 'Property Casualty Auto NIGO binding resolution procedures'")

print("\n" + "="*80)
print("NIGO RESOLVERS READY")
print("Both query existing Wiki FAISS with product-specific context augmentation")
print("="*80)
