"""Test Azure OpenAI client initialization for WikiRAG"""
import sys
sys.path.insert(0, r'C:\dev\snowchat\backend')

import os
from dotenv import load_dotenv
load_dotenv(r'C:\dev\snowchat\backend\.env')

print("Environment Variables:")
print(f"  AZURE_OPENAI_ENDPOINT: {os.getenv('AZURE_OPENAI_ENDPOINT')}")
print(f"  AZURE_OPENAI_API_KEY: {'*' * 20 if os.getenv('AZURE_OPENAI_API_KEY') else 'NOT SET'}")
print(f"  OPENAI_API_VERSION: {os.getenv('OPENAI_API_VERSION')}")
print(f"  GPT_MODEL_NAME: {os.getenv('GPT_MODEL_NAME')}")
print()

# Import after env loaded
from components.CustomWikiRAG import _get_openai_client

print("Testing client initialization...")
client = _get_openai_client()

if client:
    print(f"✅ Client initialized successfully!")
    print(f"   Type: {type(client).__name__}")
    print(f"   Client attributes: {dir(client)[:10]}...")
    
    # Test a simple completion
    print("\nTesting completion...")
    try:
        response = client.chat.completions.create(
            model=os.getenv('GPT_MODEL_NAME'),
            messages=[{"role": "user", "content": "Say 'hello' in one word"}],
            max_tokens=10
        )
        print(f"✅ Completion successful!")
        print(f"   Response: {response.choices[0].message.content}")
    except Exception as e:
        print(f"❌ Completion failed: {e}")
else:
    print("❌ Client initialization returned None")
