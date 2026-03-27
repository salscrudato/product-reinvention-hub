"""
Test structured work notes summarization for DevCopilot resolution guidance.
"""

import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from components.servicenowgenaitool import summarize_incident_work_notes_core

def test_structured_work_notes():
    """Test that work notes summarization uses structured_resolution by default"""
    
    # Test with a known incident that has work notes
    incident_number = "INC0010014"
    
    print(f"Testing structured work notes summarization for {incident_number}...")
    print("=" * 70)
    
    result = summarize_incident_work_notes_core(incident_number)
    
    if "error" in result:
        print(f"❌ Error: {result['error']}")
        return
    
    print(f"✅ Summary method: {result.get('summary_method', 'unknown')}")
    print(f"✅ Incident: {result.get('incident_number', 'unknown')}")
    print()
    
    # Check for structured fields
    if "problem_statement" in result:
        print("🔍 **Problem Statement:**")
        print(f"   {result['problem_statement']}")
        print()
    
    if "root_cause" in result:
        print("🎯 **Root Cause:**")
        print(f"   {result['root_cause']}")
        print()
    
    if "workaround" in result:
        print("⚡ **Workaround:**")
        print(f"   {result['workaround']}")
        print()
    
    if "resolution_steps" in result:
        print("✅ **Resolution Steps:**")
        print(f"   {result['resolution_steps']}")
        print()
    
    print("=" * 70)
    print("\n📝 **Full Summary:**")
    print(result.get('summary', 'No summary generated'))
    print()
    
    # Verify structured output is being used
    assert result.get('summary_method') == 'structured_resolution', \
        f"Expected 'structured_resolution', got '{result.get('summary_method')}'"
    
    assert 'problem_statement' in result, "Missing problem_statement field"
    assert 'root_cause' in result, "Missing root_cause field"
    assert 'workaround' in result, "Missing workaround field"
    assert 'resolution_steps' in result, "Missing resolution_steps field"
    
    print("✅ All structured fields present!")
    print("\n🎯 DevCopilot structured work notes extraction is working correctly!")

if __name__ == "__main__":
    test_structured_work_notes()
