"""
Analyze question patterns from logs and update question suggester cache.
This should run weekly via scheduled task to keep suggestions fresh.

Usage:
    python scripts/analyze_question_patterns.py
"""

import sys
from pathlib import Path

# Add parent directory for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from components.question_suggester import QuestionSuggester

def main():
    """Main entry point for scheduled question pattern analysis."""
    print("\n" + "="*80)
    print("  QUESTION PATTERN ANALYSIS - Weekly Training")
    print("="*80 + "\n")
    
    log_path = "agentic_orchestrator_auto.log"
    print(f"📖 Analyzing logs from: {log_path}\n")
    
    # Create suggester and analyze logs
    suggester = QuestionSuggester(log_path)
    stats = suggester.analyze_logs(max_lines=50000)  # Last 50k lines
    
    if 'error' in stats:
        print(f"❌ Error: {stats['error']}")
        return 1
    
    print("✅ Analysis complete!\n")
    print(f"📊 Statistics:")
    print(f"   - Lines analyzed: {stats.get('lines_analyzed', 0)}")
    print(f"   - Questions found: {stats.get('questions_found', 0)}")
    print(f"   - Successful queries: {stats.get('successful_queries', 0)}")
    print(f"   - Unique intents: {stats.get('unique_intents', 0)}")
    print(f"   - Unique personas: {stats.get('unique_personas', 0)}")
    print(f"   - Patterns extracted: {stats.get('patterns', 0)}")
    
    # Cache will be automatically saved and loaded by backend on next startup
    print(f"\n💾 Cache saved for backend to load on next startup")
    print("\n" + "="*80)
    print("  ✅ TRAINING COMPLETE - Suggestions will be updated on backend restart")
    print("="*80 + "\n")
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
