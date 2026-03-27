"""Test WikiRAG end-to-end with Azure OpenAI fix"""
import sys
sys.path.insert(0, r'C:\dev\snowchat\backend')

import os
from dotenv import load_dotenv
load_dotenv(r'C:\dev\snowchat\backend\.env')

from components.CustomWikiRAG import perform_wiki_rag

print("Testing WikiRAG with Azure OpenAI...")
print("=" * 60)

# Test query
test_question = "@wiki What are the NIGO rules?"

print(f"\nQuery: {test_question}")
print("-" * 60)

try:
    result = perform_wiki_rag(test_question)
    
    print(f"\n✅ WikiRAG executed successfully!")
    print(f"\nResult keys: {list(result.keys())}")
    print(f"\nAnswer preview (first 300 chars):")
    print(result.get('answer', 'No answer')[:300])
    print("...")
    
    if result.get('sources'):
        print(f"\nSources found: {len(result.get('sources', []))}")
        for i, source in enumerate(result.get('sources', [])[:3], 1):
            print(f"  {i}. {source.get('title', 'Unknown')[:50]}")
    
    print(f"\nFull result:")
    import json
    print(json.dumps(result, indent=2, default=str)[:1000])
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    import traceback
    traceback.print_exc()
