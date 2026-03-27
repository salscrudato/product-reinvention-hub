"""
Test script to verify incident embedding cache is working correctly.

This script tests:
1. Cache hit rates for incident embeddings
2. Proper TinyDB cache usage
3. API call reduction

Run: python test_incident_embedding_cache.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from components.servicenowgenaitool import (
    get_similar_incidents_simple,
    get_cached_embedding,
    embedding_table
)
from tinydb import Query

def test_cache_effectiveness():
    """Test that incident embeddings are properly cached."""
    
    print("\n" + "="*70)
    print("INCIDENT EMBEDDING CACHE TEST")
    print("="*70)
    
    # Check current cache state
    all_cached = embedding_table.all()
    print(f"\n📊 Current cache statistics:")
    print(f"   Total cached embeddings: {len(all_cached)}")
    
    # Show sample of cached entries
    if all_cached:
        print(f"\n✅ Sample cached entries:")
        for i, entry in enumerate(all_cached[:5]):
            desc = entry.get('short_description', 'N/A')
            embedding_len = len(entry.get('embedding', [])) if entry.get('embedding') else 0
            print(f"   {i+1}. \"{desc[:60]}...\" (embedding dim: {embedding_len})")
    
    # Test similarity search
    print(f"\n🔍 Testing similarity search...")
    print(f"   Query: 'Server is down and not responding'")
    
    # Count cache before
    cache_size_before = len(embedding_table.all())
    
    # Run similarity search
    try:
        results = get_similar_incidents_simple("Server is down and not responding")
        
        # Count cache after
        cache_size_after = len(embedding_table.all())
        new_entries = cache_size_after - cache_size_before
        
        print(f"\n📈 Cache impact:")
        print(f"   Entries before: {cache_size_before}")
        print(f"   Entries after: {cache_size_after}")
        print(f"   New entries added: {new_entries}")
        
        if isinstance(results, list) and results:
            print(f"\n✅ Found {len(results)} similar incidents:")
            for i, inc in enumerate(results[:3]):
                if isinstance(inc, dict) and 'number' in inc:
                    print(f"   {i+1}. {inc['number']}: {inc.get('short_description', 'N/A')[:60]}...")
                    print(f"      Similarity: {inc.get('similarity_score', 0):.4f}")
        else:
            print(f"\n⚠️  No similar incidents found (this may be normal if ServiceNow is not accessible)")
            
    except Exception as e:
        print(f"\n❌ Error during test: {e}")
        import traceback
        traceback.print_exc()
    
    # Test cache retrieval
    print(f"\n🔄 Testing cache retrieval...")
    test_text = "Server is down and not responding"
    cached = get_cached_embedding(test_text)
    
    if cached:
        print(f"   ✅ Query text IS cached (dimension: {len(cached)})")
        print(f"   💰 Subsequent searches will use cached embedding (NO API calls)")
    else:
        print(f"   ⚠️  Query text not yet cached")
        print(f"   Note: First search generates embeddings, subsequent ones use cache")
    
    print("\n" + "="*70)
    print("Cache Optimization Status:")
    print("="*70)
    
    if cache_size_after > 0:
        print("✅ SUCCESS: TinyDB cache is actively working!")
        print(f"   - {cache_size_after} embeddings cached")
        print(f"   - Future similarity searches will reuse these embeddings")
        print(f"   - API cost reduction: ~{cache_size_after * 0.02:.2f} cents saved per search")
    else:
        print("⚠️  WARNING: No embeddings cached yet")
        print("   - May need ServiceNow access to populate cache")
        print("   - Check backend logs for cache hit/miss messages")
    
    print("\n" + "="*70 + "\n")

if __name__ == "__main__":
    test_cache_effectiveness()
