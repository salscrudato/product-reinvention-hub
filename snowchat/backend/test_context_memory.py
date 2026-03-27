"""Test script for Phase 1 & 2 enhancements - Context & Memory Management

Tests:
1. Intent classification for "incidents related to X"
2. Semantic query extraction from "incidents related to APS requirements"
3. Entity tracking across conversation turns
4. Context-aware intent boosting
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from components.intent_classifier import classify_intent
from components.plan_recipes import _extract_semantic_query, _args_incident
from components.context_retriever import ConversationContextRetriever
import json

print("="*80)
print("PHASE 1 & 2 TESTING - Context & Memory Management")
print("="*80)

# Test 1: Enhanced Intent Classification
print("\n### TEST 1: Intent Classification for 'Related To' Queries")
print("-" * 80)

test_queries = [
    "what are the incidents related to APS requirements?",
    "show me incidents about database issues",
    "incidents regarding network connectivity",
    "find incidents for authentication problems",
    "incidents concerning security vulnerabilities"
]

for query in test_queries:
    intent = classify_intent(query, metadata={})
    print(f"Query: {query}")
    print(f"  → Intent: {intent}")
    expected = "similar_incidents"
    status = "✅ PASS" if intent == expected else f"❌ FAIL (expected {expected})"
    print(f"  → {status}\n")

# Test 2: Semantic Query Extraction
print("\n### TEST 2: Semantic Query Extraction")
print("-" * 80)

test_cases = [
    ("what are the incidents related to APS requirements?", "APS requirements"),
    ("show incidents about email server", "email server"),
    ("incidents concerning database timeout", "database timeout"),
    ("find incidents for login failures", "login failures"),
]

for query, expected_topic in test_cases:
    extracted = _extract_semantic_query(query)
    print(f"Query: {query}")
    print(f"  → Extracted: '{extracted}'")
    print(f"  → Expected: '{expected_topic}'")
    status = "✅ PASS" if extracted and expected_topic.lower() in extracted.lower() else "❌ FAIL"
    print(f"  → {status}\n")

# Test 3: _args_incident with Semantic Understanding
print("\n### TEST 3: _args_incident Function - Semantic Mode")
print("-" * 80)

test_args = [
    ("what are the incidents related to APS requirements?", {"short_description": "APS requirements"}),
    ("show me INC0010007", {"incident_number": "INC0010007"}),
    ("incidents about network outage", {"short_description": "network outage"}),
]

for query, expected_args in test_args:
    result = _args_incident(query, metadata={})
    print(f"Query: {query}")
    print(f"  → Result: {json.dumps(result, indent=4)}")
    print(f"  → Expected: {json.dumps(expected_args, indent=4)}")
    
    # Check if result matches expected
    match = all(result.get(k) == v for k, v in expected_args.items())
    status = "✅ PASS" if match else "❌ FAIL"
    print(f"  → {status}\n")

# Test 4: Entity Tracking with Context Retriever
print("\n### TEST 4: Entity Tracking - Context Retriever")
print("-" * 80)

retriever = ConversationContextRetriever()

# Simulate conversation history
conversation_turns = [
    {
        "question": "what are the incidents opened today?",
        "answer": "There are 13 incidents opened today including INC0010001, INC0010002, INC0010003 (APSs received from UMR)...",
        "incidents": ["INC0010001", "INC0010002", "INC0010003"]
    },
    {
        "question": "What is the Summary of INC0000001?",
        "answer": "Short Description: Can't read email. Category: Network...",
        "incidents": ["INC0000001"]
    },
    {
        "question": "what are the incidents opened in last 7 days including today?",
        "answer": "Incidents opened in the last 7 days: INC0000601, INC0010001, INC0010007...",
        "incidents": ["INC0000601", "INC0010001", "INC0010007"]
    }
]

for turn in conversation_turns:
    retriever.add_turn(
        question=turn["question"],
        answer=turn["answer"],
        incident_refs=turn["incidents"],
        metadata={"intent": "incidents_today" if "today" in turn["question"] else "incident_triage"}
    )

print(f"Added {len(conversation_turns)} conversation turns to retriever")

# Extract entities
entities = retriever.extract_entities(window=5)
print(f"\nExtracted Entities:")
print(json.dumps(entities, indent=2))

# Check if APS is captured as a keyword
has_aps = any("aps" in kw.lower() for kw in entities.get("keywords", []))
print(f"\nAPS topic captured: {'✅ YES' if has_aps else '❌ NO'}")

# Get recent incidents
recent = retriever.get_recent_incidents(n=5)
print(f"\nRecent incidents: {recent}")

# Test 5: Context-Aware Intent Classification with Entities
print("\n### TEST 5: Context-Aware Intent Classification")
print("-" * 80)

# Metadata with tracked entities from previous conversation
metadata_with_entities = {
    "entities": entities
}

query = "what are the incidents related to APS requirements?"
intent = classify_intent(query, metadata=metadata_with_entities)

print(f"Query: {query}")
print(f"Entities in context: {json.dumps(entities, indent=2)}")
print(f"  → Intent: {intent}")
print(f"  → Expected: similar_incidents")
status = "✅ PASS" if intent == "similar_incidents" else "❌ FAIL"
print(f"  → {status}")

# Test 6: Retriever Summary
print("\n### TEST 6: Context Retriever Summary")
print("-" * 80)

summary = retriever.get_summary()
print(json.dumps(summary, indent=2))

print("\n" + "="*80)
print("ALL TESTS COMPLETED")
print("="*80)
print("\n✅ Phase 1 & 2 implementation complete!")
print("🔧 Backend must be restarted with ENABLE_ENTITY_TRACKING=1")
print("🧪 Test in frontend: Ask 'incidents opened today' then 'incidents related to APS requirements'")
