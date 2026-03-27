"""Quick script to demo intent fuzzy classification & diagnostics.
Run: python backend/scripts/intent_diagnostics_demo.py "show my incdents"
"""
import sys, json
from backend.components.intent_config import classify_with_config, intent_diagnostics

if __name__ == '__main__':
    q = ' '.join(sys.argv[1:]) or 'my incidents'
    md = {}
    res = classify_with_config(q, md, enable_fuzzy=True)
    print('Question:', q)
    print('Classification:', json.dumps(res, indent=2, default=str))
    print('\nDiagnostics Summary:')
    print(json.dumps(intent_diagnostics(), indent=2, default=str))
