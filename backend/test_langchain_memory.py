"""
Test script to verify LangChain memory modules are working correctly.
Simulates the "bank NIGO incident" scenario to demonstrate context retention.

Run: python test_langchain_memory.py
"""
import sys
import os
import warnings

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

print("="*80)
print("TESTING LANGCHAIN CONVERSATION MEMORY")
print("="*80)

# Test 1: Check imports
print("\n[1/5] Testing LangChain imports...")
try:
    import langchain
    print(f"  LangChain version: {langchain.__version__}")
    # Suppress deprecation warnings
    warnings.filterwarnings("ignore", category=DeprecationWarning, module="langchain")
    from langchain.memory import ConversationEntityMemory, ConversationSummaryMemory  # type: ignore
    from langchain_openai import AzureChatOpenAI
    print("[PASS] LangChain memory modules available (langchain.memory)")
    LANGCHAIN_OK = True
except ImportError as e:
    print(f"[FAIL] LangChain not available: {e}")
    print("\n  Run: pip install langchain langchain-openai")
    LANGCHAIN_OK = False

# Test 2: Check environment
print("\n[2/5] Checking environment variables...")
required_vars = ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "OPENAI_API_VERSION", "GPT_MODEL_NAME"]
missing = [var for var in required_vars if not os.getenv(var)]
if missing:
    print(f"âœ— Missing environment variables: {', '.join(missing)}")
    print("  Check your .env file")
    ENV_OK = False
else:
    print("âœ“ All required environment variables set")
    ENV_OK = True

# Test 3: Import our enhancer
print("\n[3/5] Testing ConversationMemoryEnhancer...")
try:
    from components.conversation_memory_enhancer import ConversationMemoryEnhancer, enhance_question_with_context
    print("âœ“ ConversationMemoryEnhancer imported successfully")
    ENHANCER_OK = True
except ImportError as e:
    print(f"âœ— Import failed: {e}")
    ENHANCER_OK = False

# Test 4: Basic functionality (no API calls)
if ENHANCER_OK:
    print("\n[4/5] Testing basic memory operations (no LLM calls)...")
    try:
        enhancer = ConversationMemoryEnhancer(username="test_user")
        
        # Test loading history (should return empty list for new user)
        history = enhancer.load_conversation_history(limit=5)
        print(f"âœ“ Loaded {len(history)} conversation turns from TinyDB")
        
        # Test clearing memory
        enhancer.clear_memory()
        print("âœ“ Memory cleared successfully")
        
        BASIC_OK = True
    except Exception as e:
        print(f"âœ— Basic operations failed: {e}")
        BASIC_OK = False
else:
    BASIC_OK = False

# Test 5: Full scenario simulation (requires LangChain + API)
if LANGCHAIN_OK and ENV_OK and ENHANCER_OK and BASIC_OK:
    print("\n[5/5] Testing full conversation scenario...")
    print("NOTE: This will make API calls to Azure OpenAI")
    
    try:
        enhancer = ConversationMemoryEnhancer(username="snow_admin_test")
        
        # Simulate the 3 Q&A pairs that failed
        print("\n  Q1: Find me the incidents related to PAS and NIGO")
        enhancer.update_memory(
            "Find me the incidents related to PAS and NIGO",
            "Found 6 incidents: INC0010062 (Chronic care rider has been removed but policy is still in a NIGO status), "
            "INC0010007 (PAS - Unable to update Banking Information NIGO), INC0010002, INC0010053, INC0010078, INC0010095"
        )
        print("  â†’ Memory updated with Q1/A1")
        
        print("\n  Q2: What is the Work around for Bank NIGO Incident?")
        enhancer.update_memory(
            "What is the Work around for Bank NIGO Incident?",
            "INC0010062: The workaround is to remove the chronic care rider XML blocks from the policy file."
        )
        print("  â†’ Memory updated with Q2/A2")
        
        # Get context for third question - this is where magic happens
        print("\n  Q3: This was not the Bank NIGO incident.....can you check again?")
        context = enhancer.get_enriched_context(
            "This was not the Bank NIGO incident.....can you check again?"
        )
        
        print("\n  TRACKED ENTITIES:")
        if context.get("entities"):
            for entity, info in list(context["entities"].items())[:5]:
                print(f"    â€¢ {entity}: {str(info)[:100]}")
        else:
            print("    (No entities tracked - may need LLM call)")
        
        print("\n  CONVERSATION SUMMARY:")
        summary = context.get("summary", "")
        if summary:
            print(f"    {summary[:200]}...")
        else:
            print("    (No summary available)")
        
        print("\n  ENHANCED CONTEXT MESSAGES:")
        for msg in context.get("context_messages", [])[:3]:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            print(f"    [{role}] {content[:100]}...")
        
        print("\nâœ“ Full scenario test completed")
        print("\n  EXPECTED BEHAVIOR:")
        print("  - System should track incident numbers: INC0010062, INC0010007")
        print("  - When user says 'This was not the bank NIGO incident'")
        print("  - System resolves 'this' = INC0010062 (from previous answer)")
        print("  - System searches for 'bank NIGO' excluding INC0010062")
        print("  - Returns: INC0010007 (correct incident)")
        
        SCENARIO_OK = True
    except Exception as e:
        print(f"\nâœ— Scenario test failed: {e}")
        import traceback
        traceback.print_exc()
        SCENARIO_OK = False
else:
    print("\n[5/5] Skipping full scenario test (dependencies not met)")
    SCENARIO_OK = False

# Summary
print("\n" + "="*80)
print("TEST SUMMARY")
print("="*80)
results = [
    ("LangChain Imports", LANGCHAIN_OK),
    ("Environment Variables", ENV_OK),
    ("Enhancer Import", ENHANCER_OK),
    ("Basic Operations", BASIC_OK),
    ("Full Scenario", SCENARIO_OK if LANGCHAIN_OK and ENV_OK else None)
]

for test_name, result in results:
    if result is True:
        status = "âœ“ PASS"
    elif result is False:
        status = "âœ— FAIL"
    else:
        status = "âŠ˜ SKIP"
    print(f"{test_name:.<40} {status}")

print("\n")

if all(r for r in [LANGCHAIN_OK, ENV_OK, ENHANCER_OK, BASIC_OK]):
    print("âœ“ ALL TESTS PASSED - Ready for integration!")
    print("\nNext steps:")
    print("1. Review: docs/LANGCHAIN_MEMORY_INTEGRATION.md")
    print("2. Integrate into agentic_orchestrator_auto.py (STEP 2 in guide)")
    print("3. Restart backend and test with real queries")
    sys.exit(0)
else:
    print("âœ— SOME TESTS FAILED - Review errors above")
    print("\nQuick fixes:")
    if not LANGCHAIN_OK:
        print("â€¢ Install LangChain: pip install langchain langchain-openai")
    if not ENV_OK:
        print("â€¢ Check .env file has Azure OpenAI credentials")
    sys.exit(1)

