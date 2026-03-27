"""Quick planner test harness.

Usage:
  Set env vars (PLANNER_VERSION=retrieval, TOOL_BINDING_MODE=langchain, etc.) then run:
    python backend/test_planner_harness.py "Investigate errors @log in checkout service"

What it does:
  * Imports retrieval planner if PLANNER_VERSION=retrieval else legacy planner.
  * Builds a Command and runs determine_function_sequence.
  * Prints selected tools, function_sequence, and raw env flags.
  * Does NOT call or execute tools; just plans.

Safe to run with DATADOG_SIMULATE=1.
"""
from __future__ import annotations
import os, json, sys, importlib
from typing import Any

# Ensure backend components are importable when run from repo root.
BASE_DIR = os.path.dirname(__file__)
PARENT = os.path.dirname(BASE_DIR)
if PARENT not in sys.path:
    sys.path.append(PARENT)

# Load backend .env so existing variable settings are used (without needing manual export)
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(os.path.join(BASE_DIR, '.env'))
except Exception:
    pass  # Non-fatal if python-dotenv not installed; env vars can still come from process

# Decide planner module
planner_version = os.getenv('PLANNER_VERSION', 'default').lower()
module_name = 'components.langgraph_flow_retrieval' if planner_version == 'retrieval' else 'components.langgraph_flow'
try:
    planner_mod = importlib.import_module(f'backend.{module_name}')
except ModuleNotFoundError:
    # Fallback if executed from backend directory
    planner_mod = importlib.import_module(module_name)

# Acquire determine_function_sequence + Command symbol
Command = getattr(planner_mod, 'Command', None)
determine_function_sequence = getattr(planner_mod, 'determine_function_sequence', None)
if Command is None or determine_function_sequence is None:
    print(f"[ERROR] Planner module '{module_name}' missing required symbols.")
    sys.exit(1)

question = ' '.join(sys.argv[1:]) or 'Investigate recent login failures @log for user alice in last 15 minutes'

cmd = Command(question=question, metadata={})  # type: ignore

print('=== Planner Harness ===')
print(f"Question: {question}")
print(f"PLANNER_VERSION={planner_version}")
print(f"TOOL_BINDING_MODE={os.getenv('TOOL_BINDING_MODE','<unset>')}")
print(f"DATADOG_SIMULATE={os.getenv('DATADOG_SIMULATE','<unset>')}")
print(f"MAX_TOOL_SCHEMAS={os.getenv('MAX_TOOL_SCHEMAS','<unset>')}")
print(f"TOOL_RETRIEVAL_MIN_SIM={os.getenv('TOOL_RETRIEVAL_MIN_SIM','<unset>')}")
print('-----------------------')

cmd = determine_function_sequence(cmd)  # type: ignore

# Try to introspect retrieval subset (only available in retrieval module internals)
subset_info = {}
if planner_version == 'retrieval':
    for name in ('_tool_names','_tool_descriptors'):
        if hasattr(planner_mod, name):
            subset_info[name] = getattr(planner_mod, name)

print('Function Sequence:')
print(json.dumps(cmd.function_sequence, indent=2))
print('\nTool Count in Registry Subset (if retrieval):')
if subset_info:
    selected = [fc.get('function_name') for fc in cmd.function_sequence]
    print(f"Selected tools in sequence: {selected}")
else:
    print('N/A (default planner)')

print('\nNOTE: This harness does not execute tools, only plans.\n')
