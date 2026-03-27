from components.plan_sanitizer import sanitize_plan
from components.shared_registry import FUNCTION_REGISTRY

RAW_PLAN_EXAMPLE = [
  {"function_name": "unknown_tool", "arguments": {"x": 1}},
  {"function_name": "code_annotation_tool", "arguments": {"QUESTION": "@code sample", "extra": 5}},
]


def test_sanitize_plan_drops_unknown_and_normalizes():
  clean, diag = sanitize_plan(RAW_PLAN_EXAMPLE, FUNCTION_REGISTRY)
  # Only one valid step remains
  assert len(clean) == 1
  assert clean[0]['function_name'] == 'code_annotation_tool'
  # Argument key normalized to 'question'
  assert 'question' in clean[0]['arguments']
  assert '@code sample' == clean[0]['arguments']['question']
  # Unknown arg 'extra' should be dropped
  assert 'extra' not in clean[0]['arguments']
  # Diagnostics
  drop_reasons = [d['reason'] for d in diag['dropped']]
  assert 'unknown_tool' in drop_reasons
  assert diag['modified'], 'Expected modifications recorded'


