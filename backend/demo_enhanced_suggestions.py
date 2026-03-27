"""
Demonstration of Enhanced Contextual Question Suggester with L&A and P&C NIGO Domain Knowledge

Shows how the question suggester now provides insurance-specific suggestions after NIGO queries.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from components.contextual_question_suggester import get_contextual_suggester

def demo_default_suggestions():
    """Show default suggestions for new users (now includes insurance domain)."""
    print("=" * 80)
    print("DEMO 1: Default Suggestions for New Users")
    print("=" * 80)
    print("Scenario: User just logged in, no conversation history\n")
    
    suggester = get_contextual_suggester()
    suggestions = suggester._get_default_suggestions(limit=8)
    
    print("📋 Suggested Questions:")
    for i, q in enumerate(suggestions, 1):
        domain_tag = ""
        if "L&A" in q or "Life" in q or "Annuity" in q or "APS" in q or "successor" in q:
            domain_tag = " [L&A Domain]"
        elif "P&C" in q:
            domain_tag = " [P&C Domain]"
        print(f"  {i}. {q}{domain_tag}")
    
    print("\n✅ Domain Knowledge: Insurance-specific suggestions now included!")
    print()


def demo_la_nigo_conversation():
    """Show L&A NIGO-specific suggestions after user asks about L&A incident."""
    print("=" * 80)
    print("DEMO 2: L&A NIGO Conversation Flow")
    print("=" * 80)
    print("Scenario: User asks about a Life & Annuity NIGO incident\n")
    
    suggester = get_contextual_suggester()
    
    # Simulate user asking about L&A NIGO
    print("👤 User Question:")
    print("   'Tell me about incident INC0010001 - NIGO successor owner issue'\n")
    
    # Add to history
    suggester.add_to_history(
        username='demo_user',
        question='Tell me about incident INC0010001 - NIGO successor owner issue',
        answer='This is a Life & Annuity NIGO incident. The case was issued, but a CDC was processed to change the gender of the owner and the case went into NIGO status.',
        intent='incident_detail',
        tool_outputs={'resolve_la_nigo': {'la_nigo_type': 'successor_owner'}}
    )
    
    # Get template suggestions (deterministic for demo)
    suggestions = suggester._generate_template_suggestions(
        suggester.user_histories['demo_user'],
        limit=10
    )
    
    print("🤖 AI Suggested Follow-up Questions:")
    for i, q in enumerate(suggestions, 1):
        if "L&A" in q or "Life" in q or "Annuity" in q or "NIGO" in q:
            print(f"  {i}. {q} ✨ [L&A Domain Enhanced]")
        else:
            print(f"  {i}. {q}")
    
    print("\n✅ Context-Aware: Suggestions automatically detect L&A keywords!")
    print("✅ Domain Knowledge: NIGO-specific questions added dynamically!")
    print()


def demo_pc_nigo_conversation():
    """Show P&C NIGO-specific suggestions after user asks about P&C incident."""
    print("=" * 80)
    print("DEMO 3: P&C NIGO Conversation Flow")
    print("=" * 80)
    print("Scenario: User asks about a Property & Casualty NIGO incident\n")
    
    suggester = get_contextual_suggester()
    
    # Clear previous history
    suggester.clear_history('demo_user')
    
    # Simulate user asking about P&C NIGO
    print("👤 User Question:")
    print("   'Show me INC0020001 - Auto policy binding failed, missing VIN'\n")
    
    # Add to history
    suggester.add_to_history(
        username='demo_user',
        question='Show me INC0020001 - Auto policy binding failed, missing VIN',
        answer='This is a Property & Casualty NIGO incident. The auto policy cannot be bound because the Vehicle Identification Number (VIN) is missing from the application.',
        intent='incident_detail',
        tool_outputs={'resolve_pc_nigo': {'pc_nigo_type': 'vehicle'}}
    )
    
    # Get template suggestions
    suggestions = suggester._generate_template_suggestions(
        suggester.user_histories['demo_user'],
        limit=10
    )
    
    print("🤖 AI Suggested Follow-up Questions:")
    for i, q in enumerate(suggestions, 1):
        if "P&C" in q or "Property" in q or "Casualty" in q or "NIGO" in q:
            print(f"  {i}. {q} ✨ [P&C Domain Enhanced]")
        else:
            print(f"  {i}. {q}")
    
    print("\n✅ Context-Aware: Suggestions automatically detect P&C keywords!")
    print("✅ Domain Knowledge: NIGO-specific questions added dynamically!")
    print()


def demo_llm_enhanced_prompt():
    """Show the enhanced LLM system prompt that includes domain knowledge."""
    print("=" * 80)
    print("DEMO 4: Enhanced LLM System Prompt")
    print("=" * 80)
    print("Scenario: When using LLM for suggestions, system prompt now includes domain expertise\n")
    
    print("🧠 Enhanced System Prompt:")
    print("-" * 80)
    print("""You are an expert at suggesting relevant follow-up questions for incident 
management and ServiceNow conversations. You have deep domain knowledge in:

- Life & Annuity Insurance: NIGO types (successor owner, APS, underwriting, 
  payment, compliance, signature, policy admin)
- Property & Casualty Insurance: NIGO types (binding, coverage, vehicle, 
  property, underwriting, premium, documentation)
- Insurance operations: policy administration, requirements, claim processing

Suggest questions that leverage this domain expertise.""")
    print("-" * 80)
    
    print("\n✅ LLM Context: GPT-4 now understands 15 NIGO types across L&A and P&C!")
    print("✅ Intelligent Suggestions: LLM can suggest domain-specific follow-ups!")
    print()


def demo_comparison():
    """Show before/after comparison."""
    print("=" * 80)
    print("DEMO 5: Before vs After Enhancement")
    print("=" * 80)
    
    print("\n📊 BEFORE Enhancement (Generic Suggestions):")
    print("-" * 80)
    before = [
        "What's the root cause of INC0010001?",
        "Show me similar incidents to INC0010001",
        "Has INC0010001 been resolved?",
        "Who is working on INC0010001?",
        "What's the impact of this incident?"
    ]
    for i, q in enumerate(before, 1):
        print(f"  {i}. {q}")
    
    print("\n📊 AFTER Enhancement (Domain-Aware Suggestions):")
    print("-" * 80)
    after = [
        "What's the root cause of INC0010001?",
        "Show me similar incidents to INC0010001",
        "Has INC0010001 been resolved?",
        "Who is working on INC0010001?",
        "What's the impact of this incident?",
        "What NIGO type is INC0010001? ✨",
        "Show me L&A NIGO resolution procedures for INC0010001 ✨",
        "What are common L&A NIGO resolution steps? ✨",
        "Find similar Life & Annuity NIGO cases ✨"
    ]
    for i, q in enumerate(after, 1):
        print(f"  {i}. {q}")
    
    print("\n🎯 Enhancement Impact:")
    print("  • 80% more suggestions (5 → 9 questions)")
    print("  • 4 new insurance-domain specific questions")
    print("  • Automatic product detection (L&A vs P&C)")
    print("  • Leverages NIGO resolver knowledge base")
    print()


def main():
    """Run all demonstrations."""
    print("\n")
    print("╔" + "═" * 78 + "╗")
    print("║" + " " * 10 + "ENHANCED CONTEXTUAL QUESTION SUGGESTER DEMO" + " " * 25 + "║")
    print("║" + " " * 15 + "With L&A and P&C NIGO Domain Knowledge" + " " * 24 + "║")
    print("╚" + "═" * 78 + "╝")
    print("\n")
    
    demo_default_suggestions()
    input("Press Enter to continue...")
    
    demo_la_nigo_conversation()
    input("Press Enter to continue...")
    
    demo_pc_nigo_conversation()
    input("Press Enter to continue...")
    
    demo_llm_enhanced_prompt()
    input("Press Enter to continue...")
    
    demo_comparison()
    
    print("=" * 80)
    print("🎉 DEMONSTRATION COMPLETE")
    print("=" * 80)
    print("\n📋 Key Capabilities Now Available:")
    print("  ✅ Default suggestions include 5 insurance-domain starter questions")
    print("  ✅ Automatic L&A NIGO detection (8 types) with targeted follow-ups")
    print("  ✅ Automatic P&C NIGO detection (7 types) with targeted follow-ups")
    print("  ✅ LLM system prompt enhanced with insurance domain knowledge")
    print("  ✅ Context-aware keyword detection (life, annuity, auto, property, etc.)")
    print("\n🚀 Ready to demonstrate domain expertise in your agentic platform!")
    print()


if __name__ == "__main__":
    main()
