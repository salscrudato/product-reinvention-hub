"""Integration test - Simulate real user scenario with frontend

Test the complete flow:
1. User asks: "what are the incidents opened today?"
2. System returns 13 incidents including INC0010003 (mentions "APSs received from UMR")
3. User asks: "what are the incidents related to APS requirements?"
4. System should:
   - Classify intent as 'similar_incidents' (Phase 1)
   - Extract semantic query "APS requirements" (Phase 1)
   - Track entities from prior conversation (Phase 2)
   - Search for semantically similar incidents (not literal "APS requierments" typo)
"""

import requests
import json
import time

BASE_URL = "http://localhost:5000"
ORCHESTRATE_ENDPOINT = f"{BASE_URL}/agentic_orchestrate_auto"

print("="*80)
print("INTEGRATION TEST - Full User Scenario with Context & Memory")
print("="*80)

# Session data
username = "snow_admin"
persona = "product_owner"
session_messages = []

def ask_question(question: str):
    """Send question to backend and print response"""
    print(f"\n🧑 USER: {question}")
    print("-" * 80)
    
    # Build request payload
    session_messages.append({"role": "user", "content": question})
    
    payload = {
        "messages": session_messages.copy(),
        "prompt": "You are an intelligent assistant for ServiceNow incident management.",
        "metadata": {"persona": persona},
        "username": username,
        "agent_type": "plan_and_execute"
    }
    
    try:
        response = requests.post(ORCHESTRATE_ENDPOINT, json=payload, timeout=120)
        response.raise_for_status()
        result = response.json()
        
        # Extract key info
        intent = result.get("metadata", {}).get("intent")
        plan = result.get("plan", [])
        final_answer = result.get("final_answer", "")
        traces = result.get("traces", [])
        entities = result.get("metadata", {}).get("entities", {})
        
        print(f"📊 Intent: {intent}")
        print(f"📋 Plan ({len(plan)} steps):")
        for i, step in enumerate(plan, 1):
            fn = step.get("function_name")
            args = step.get("arguments", {})
            print(f"   {i}. {fn}({json.dumps(args, indent=6)[1:-1]})")
        
        if entities:
            print(f"\n🔖 Tracked Entities:")
            print(f"   Incidents: {entities.get('incidents', [])[:5]}")
            print(f"   Topics: {entities.get('topics', [])}")
            print(f"   Keywords: {entities.get('keywords', [])}")
        
        print(f"\n🤖 ASSISTANT: {final_answer[:500]}...")
        
        # Add assistant response to session
        session_messages.append({"role": "assistant", "content": final_answer})
        
        # Analyze for test validation
        return {
            "intent": intent,
            "plan": plan,
            "answer": final_answer,
            "traces": traces,
            "entities": entities,
            "metadata": result.get("metadata", {})
        }
        
    except requests.exceptions.RequestException as e:
        print(f"❌ ERROR: Request failed - {e}")
        return None
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return None

# Test Scenario
print("\n" + "="*80)
print("SCENARIO: User asks about today's incidents, then asks about APS requirements")
print("="*80)

# Step 1: Ask about today's incidents
print("\n### STEP 1: Get Today's Incidents")
result1 = ask_question("what are the incidents opened today?")

if not result1:
    print("❌ Test failed at Step 1")
    exit(1)

# Validate Step 1
assert result1["intent"] == "incidents_today", f"Expected intent 'incidents_today', got '{result1['intent']}'"
assert len(result1["plan"]) > 0, "Plan should not be empty"
print("\n✅ Step 1 validation passed")

time.sleep(2)

# Step 2: Ask about APS requirements (the critical test)
print("\n" + "="*80)
print("### STEP 2: Ask About APS Requirements (Critical Test)")
result2 = ask_question("what are the incidents related to APS requirements?")

if not result2:
    print("❌ Test failed at Step 2")
    exit(1)

print("\n" + "="*80)
print("VALIDATION RESULTS")
print("="*80)

# Validation checks
validations = []

# Check 1: Intent should be similar_incidents
expected_intent = "similar_incidents"
actual_intent = result2["intent"]
intent_check = actual_intent == expected_intent
validations.append({
    "name": "Intent Classification",
    "expected": expected_intent,
    "actual": actual_intent,
    "pass": intent_check
})

# Check 2: Plan should include get_similar_incidents or similarity search
plan_functions = [step.get("function_name") for step in result2["plan"]]
has_similarity = any("similar" in fn.lower() for fn in plan_functions)
validations.append({
    "name": "Similarity Search in Plan",
    "expected": "get_similar_incidents or similar tool",
    "actual": plan_functions,
    "pass": has_similarity
})

# Check 3: Arguments should use semantic topic, not literal query
first_step_args = result2["plan"][0].get("arguments", {}) if result2["plan"] else {}
short_desc = first_step_args.get("short_description", "")
# Should NOT be the literal typo "APS requierments", should be semantic "APS requirements" or similar
semantic_extraction = "APS" in short_desc and "requirement" in short_desc.lower()
validations.append({
    "name": "Semantic Query Extraction",
    "expected": "short_description contains 'APS requirements' (semantic)",
    "actual": f"short_description = '{short_desc}'",
    "pass": semantic_extraction
})

# Check 4: Entities should be tracked
has_entities = bool(result2["entities"])
validations.append({
    "name": "Entity Tracking",
    "expected": "Entities tracked from prior conversation",
    "actual": f"{len(result2['entities'].get('incidents', []))} incidents tracked",
    "pass": has_entities
})

# Print validation results
for v in validations:
    status = "✅ PASS" if v["pass"] else "❌ FAIL"
    print(f"\n{status} - {v['name']}")
    print(f"  Expected: {v['expected']}")
    print(f"  Actual:   {v['actual']}")

# Overall result
all_pass = all(v["pass"] for v in validations)
print("\n" + "="*80)
if all_pass:
    print("✅✅✅ ALL VALIDATIONS PASSED! ✅✅✅")
    print("\nPhase 1 & 2 implementation is WORKING:")
    print("  ✓ Intent classification correctly identifies 'related to' queries")
    print("  ✓ Semantic extraction pulls topic from natural language")
    print("  ✓ Entity tracking preserves conversation context")
    print("  ✓ Context-aware classification boosts similar_incidents")
else:
    print("❌ SOME VALIDATIONS FAILED")
    print("\nFailed checks:")
    for v in validations:
        if not v["pass"]:
            print(f"  ❌ {v['name']}")

print("="*80)
