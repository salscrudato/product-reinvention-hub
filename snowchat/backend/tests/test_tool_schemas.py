import importlib
from typing import List


def test_tool_registry_exposes_function_registry():
    mod = importlib.import_module('components.shared_registry')
    assert hasattr(mod, 'FUNCTION_REGISTRY'), 'FUNCTION_REGISTRY missing'
    assert isinstance(mod.FUNCTION_REGISTRY, dict)
    assert 'code_annotation_tool' in mod.FUNCTION_REGISTRY, 'code_annotation_tool not registered'


def test_get_tool_specs_returns_expected_structure():
    ts_mod = importlib.import_module('components.tool_schemas')
    specs = ts_mod.get_tool_specs()
    assert isinstance(specs, list) and specs, 'Specs list empty'
    names = [s['name'] for s in specs]
    assert 'code_annotation_tool' in names
    cat_spec = next(s for s in specs if s['name'] == 'code_annotation_tool')
    assert 'schema' in cat_spec and 'doc' in cat_spec
    schema = cat_spec['schema']
    assert schema['type'] == 'object'
    assert 'question' in schema.get('properties', {})


def test_get_tool_json_schema_map_consistency():
    ts_mod = importlib.import_module('components.tool_schemas')
    mapping = ts_mod.get_tool_json_schema_map()
    assert 'code_annotation_tool' in mapping
    assert mapping['code_annotation_tool']['type'] == 'object'

