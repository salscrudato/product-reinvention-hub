"""
Integration test for Swagger YAML upload and parsing through mapper UI.
Tests the full flow: Frontend upload -> Backend parse -> Response transformation.
"""
import pytest
import json
from pathlib import Path
from components.mapping_api import mapping_bp
from components.mapping_agents.parsers import parse_swagger
from flask import Flask
import tempfile
import shutil


# Test data path
SWAGGER_FILE = Path(__file__).parent.parent / "test_excels" / "enriched" / "group_accident_insurance_api.yaml"


@pytest.fixture
def flask_app():
    """Create Flask app with mapping blueprint."""
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.register_blueprint(mapping_bp, url_prefix='/mapping')
    return app


@pytest.fixture
def client(flask_app):
    """Create test client."""
    return flask_app.test_client()


class TestSwaggerUploadIntegration:
    """Test Swagger YAML file upload and parsing end-to-end."""
    
    def test_swagger_parser_returns_correct_structure(self):
        """Verify parse_swagger returns ExcelObjectDescriptor with correct fields."""
        if not SWAGGER_FILE.exists():
            pytest.skip(f"Swagger file not found: {SWAGGER_FILE}")
        
        summary = parse_swagger(str(SWAGGER_FILE))
        
        # Verify summary structure
        assert summary.api_title == "Group Accident Insurance API"
        assert summary.api_version == "2.1.0"
        assert summary.total_operations >= 7
        assert len(summary.operations) >= 7
        
        # Verify operations have attributes
        total_input_attrs = sum(len(op.input_attributes) for op in summary.operations)
        total_output_attrs = sum(len(op.output_attributes) for op in summary.operations)
        
        assert total_input_attrs > 0, "Should have input attributes"
        assert total_output_attrs > 0, "Should have output attributes"
        
        # Check first operation's attributes are ExcelObjectDescriptor
        first_op = summary.operations[0]
        if first_op.input_attributes:
            attr = first_op.input_attributes[0]
            assert hasattr(attr, 'name'), "Attribute should have 'name' field"
            assert hasattr(attr, 'description'), "Attribute should have 'description' field"
            assert hasattr(attr, 'path'), "Attribute should have 'path' field"
            assert hasattr(attr, 'sample'), "Attribute should have 'sample' field"
            # Should NOT have 'type' or 'required' - those are not in ExcelObjectDescriptor
            assert not hasattr(attr, 'type'), "ExcelObjectDescriptor doesn't have 'type' field"
            assert not hasattr(attr, 'required'), "ExcelObjectDescriptor doesn't have 'required' field"
        
        print(f"✓ Parser returned {total_input_attrs} input + {total_output_attrs} output attributes")
    
    def test_swagger_upload_endpoint_accepts_yaml(self, client):
        """Test POST /mapping/parse/swagger accepts .yaml files."""
        if not SWAGGER_FILE.exists():
            pytest.skip(f"Swagger file not found: {SWAGGER_FILE}")
        
        with open(SWAGGER_FILE, 'rb') as f:
            response = client.post(
                '/mapping/parse/swagger?includeVectors=false',
                data={'file': (f, 'test_api.yaml')},
                content_type='multipart/form-data'
            )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.data}"
        
        data = response.get_json()
        assert data['status'] == 'success', f"Expected success, got: {data}"
        
        print(f"✓ Endpoint accepted YAML file")
    
    def test_swagger_response_matches_excel_format(self, client):
        """Test response structure matches what frontend expects (Excel-like)."""
        if not SWAGGER_FILE.exists():
            pytest.skip(f"Swagger file not found: {SWAGGER_FILE}")
        
        with open(SWAGGER_FILE, 'rb') as f:
            response = client.post(
                '/mapping/parse/swagger?includeVectors=false',
                data={'file': (f, 'test_api.yaml')},
                content_type='multipart/form-data'
            )
        
        data = response.get_json()
        
        # Verify Excel-compatible structure
        assert 'summary' in data, "Response should have 'summary' key"
        assert 'fileName' in data['summary'], "Summary should have 'fileName'"
        assert 'sheetsAnalyzed' in data['summary'], "Summary should have 'sheetsAnalyzed'"
        
        assert 'context' in data, "Response should have 'context' key"
        assert 'sheet_summary' in data['context'], "Context should have 'sheet_summary'"
        assert 'total_source_columns' in data['context'], "Context should have 'total_source_columns'"
        
        # Verify sheet structure
        sheets = data['context']['sheet_summary']
        assert len(sheets) > 0, "Should have at least one sheet (operation)"
        
        first_sheet = sheets[0]
        assert 'sheetName' in first_sheet, "Sheet should have 'sheetName'"
        assert 'identifier_candidates' in first_sheet, "Sheet should have 'identifier_candidates'"
        assert 'date_columns' in first_sheet, "Sheet should have 'date_columns'"
        assert 'amount_columns' in first_sheet, "Sheet should have 'amount_columns'"
        
        # Verify we have data
        total_columns = data['context']['total_source_columns']
        assert total_columns > 0, f"Should have columns, got {total_columns}"
        
        print(f"✓ Response has Excel-compatible structure with {len(sheets)} operations and {total_columns} columns")
    
    def test_swagger_operations_become_sheets(self, client):
        """Test each Swagger operation becomes a 'sheet' in the response."""
        if not SWAGGER_FILE.exists():
            pytest.skip(f"Swagger file not found: {SWAGGER_FILE}")
        
        with open(SWAGGER_FILE, 'rb') as f:
            response = client.post(
                '/mapping/parse/swagger?includeVectors=false',
                data={'file': (f, 'test_api.yaml')},
                content_type='multipart/form-data'
            )
        
        data = response.get_json()
        sheets = data['context']['sheet_summary']
        
        # Expected operations from group_accident_insurance_api.yaml
        expected_ops = [
            'createProposal',
            'addCoverageOption',
            'calculatePremium',
            'createPolicy',
            'getPolicyDetails',
            'addBeneficiary',
            'submitClaim'
        ]
        
        sheet_names = [sheet['sheetName'] for sheet in sheets]
        
        for expected in expected_ops:
            assert expected in sheet_names, f"Operation '{expected}' should be in sheets"
        
        print(f"✓ All {len(expected_ops)} operations present as sheets")
    
    def test_swagger_attributes_have_proper_naming(self, client):
        """Test attribute names follow operation::direction.field pattern."""
        if not SWAGGER_FILE.exists():
            pytest.skip(f"Swagger file not found: {SWAGGER_FILE}")
        
        with open(SWAGGER_FILE, 'rb') as f:
            response = client.post(
                '/mapping/parse/swagger?includeVectors=false',
                data={'file': (f, 'test_api.yaml')},
                content_type='multipart/form-data'
            )
        
        data = response.get_json()
        sheets = data['context']['sheet_summary']
        
        # Check naming pattern in first sheet
        first_sheet = sheets[0]
        candidates = first_sheet['identifier_candidates']
        
        assert len(candidates) > 0, "Should have identifier candidates"
        
        # Pattern: operationId::input.fieldName or operationId::output.fieldName
        first_candidate = candidates[0]
        assert '::' in first_candidate, f"Attribute should have '::' separator: {first_candidate}"
        assert 'input.' in first_candidate or 'output.' in first_candidate, \
            f"Attribute should have 'input.' or 'output.' prefix: {first_candidate}"
        
        print(f"✓ Attributes follow correct naming pattern: {first_candidate}")
    
    def test_swagger_frontend_can_parse_response(self, client):
        """Simulate frontend parsing to ensure compatibility."""
        if not SWAGGER_FILE.exists():
            pytest.skip(f"Swagger file not found: {SWAGGER_FILE}")
        
        with open(SWAGGER_FILE, 'rb') as f:
            response = client.post(
                '/mapping/parse/swagger?includeVectors=false',
                data={'file': (f, 'test_api.yaml')},
                content_type='multipart/form-data'
            )
        
        data = response.get_json()
        
        # Simulate frontend parsing logic from templateAnalysisApi.ts
        sheet_summary_raw = data['context']['sheet_summary']
        
        # Frontend expects either array or object
        if isinstance(sheet_summary_raw, list):
            sheet_summary_list = sheet_summary_raw
        else:
            sheet_summary_list = [
                {"sheetName": name, **details}
                for name, details in sheet_summary_raw.items()
            ]
        
        # Frontend builds sheetSummaries
        sheet_summaries = [
            {
                "sheetName": sheet.get('sheetName', 'Operation'),
                "identifierCandidates": sheet.get('identifier_candidates', []),
                "dateColumns": sheet.get('date_columns', []),
                "amountColumns": sheet.get('amount_columns', [])
            }
            for sheet in sheet_summary_list
        ]
        
        # Frontend calculates totalFields
        total_fields = sum(
            len(sheet['identifierCandidates']) +
            len(sheet['dateColumns']) +
            len(sheet['amountColumns'])
            for sheet in sheet_summaries
        )
        
        # Assertions
        assert len(sheet_summaries) > 0, "Frontend should parse at least one sheet"
        assert total_fields > 0, f"Frontend should calculate totalFields > 0, got {total_fields}"
        
        print(f"✓ Frontend logic parses {len(sheet_summaries)} sheets with {total_fields} total fields")
    
    def test_swagger_rejects_invalid_extensions(self, client):
        """Test endpoint rejects non-Swagger file extensions."""
        # Create a fake file with wrong extension
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write("invalid content")
            temp_path = f.name
        
        try:
            with open(temp_path, 'rb') as f:
                response = client.post(
                    '/mapping/parse/swagger',
                    data={'file': (f, 'test.txt')},
                    content_type='multipart/form-data'
                )
            
            assert response.status_code == 400, "Should reject .txt files"
            data = response.get_json()
            assert 'error' in data['status'].lower(), "Should return error status"
            
            print("✓ Correctly rejects invalid file extensions")
        finally:
            Path(temp_path).unlink()
    
    def test_swagger_parse_logs_verbose_details(self, client, caplog):
        """Test that verbose logging is present during parsing."""
        if not SWAGGER_FILE.exists():
            pytest.skip(f"Swagger file not found: {SWAGGER_FILE}")
        
        import logging
        caplog.set_level(logging.INFO)
        
        with open(SWAGGER_FILE, 'rb') as f:
            response = client.post(
                '/mapping/parse/swagger?includeVectors=false',
                data={'file': (f, 'test_api.yaml')},
                content_type='multipart/form-data'
            )
        
        # Check for expected log messages
        log_messages = [record.message for record in caplog.records]
        
        assert any('Starting Swagger parse' in msg for msg in log_messages), \
            "Should log 'Starting Swagger parse'"
        assert any('Swagger parse complete' in msg for msg in log_messages), \
            "Should log 'Swagger parse complete'"
        assert any('Built sheet structure' in msg for msg in log_messages), \
            "Should log 'Built sheet structure'"
        assert any('Response prepared' in msg for msg in log_messages), \
            "Should log 'Response prepared'"
        
        print(f"✓ Verbose logging present ({len(log_messages)} log entries)")


def run_manual_test():
    """Manual test for debugging."""
    print("\n" + "="*80)
    print("MANUAL SWAGGER UPLOAD TEST")
    print("="*80)
    
    if not SWAGGER_FILE.exists():
        print(f"❌ Swagger file not found: {SWAGGER_FILE}")
        return
    
    # Test 1: Parser
    print("\n[1] Testing parse_swagger()...")
    summary = parse_swagger(str(SWAGGER_FILE))
    print(f"  ✓ API: {summary.api_title} v{summary.api_version}")
    print(f"  ✓ Operations: {summary.total_operations}")
    print(f"  ✓ Endpoints: {summary.total_endpoints}")
    
    total_in = sum(len(op.input_attributes) for op in summary.operations)
    total_out = sum(len(op.output_attributes) for op in summary.operations)
    print(f"  ✓ Attributes: {total_in} input + {total_out} output = {total_in + total_out} total")
    
    # Test 2: Attribute structure
    print("\n[2] Testing ExcelObjectDescriptor structure...")
    first_op = summary.operations[0]
    if first_op.input_attributes:
        attr = first_op.input_attributes[0]
        print(f"  ✓ First attribute: name={attr.name}, desc={attr.description[:50] if attr.description else 'None'}")
        print(f"  ✓ Has 'name': {hasattr(attr, 'name')}")
        print(f"  ✓ Has 'description': {hasattr(attr, 'description')}")
        print(f"  ✓ Has 'path': {hasattr(attr, 'path')}")
        print(f"  ✓ Has 'type': {hasattr(attr, 'type')} (should be False)")
        print(f"  ✓ Has 'required': {hasattr(attr, 'required')} (should be False)")
    
    # Test 3: Endpoint
    print("\n[3] Testing Flask endpoint...")
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.register_blueprint(mapping_bp, url_prefix='/mapping')
    client = app.test_client()
    
    with open(SWAGGER_FILE, 'rb') as f:
        response = client.post(
            '/mapping/parse/swagger?includeVectors=false',
            data={'file': (f, 'test_api.yaml')},
            content_type='multipart/form-data'
        )
    
    print(f"  ✓ Status: {response.status_code}")
    
    if response.status_code == 200:
        data = response.get_json()
        print(f"  ✓ Response status: {data.get('status')}")
        print(f"  ✓ Sheets: {len(data.get('context', {}).get('sheet_summary', []))}")
        print(f"  ✓ Columns: {data.get('context', {}).get('total_source_columns', 0)}")
        
        # Show first sheet detail
        sheets = data['context']['sheet_summary']
        if sheets:
            first_sheet = sheets[0]
            print(f"\n  First sheet details:")
            print(f"    - Name: {first_sheet.get('sheetName')}")
            print(f"    - Candidates: {len(first_sheet.get('identifier_candidates', []))}")
            print(f"    - Sample: {first_sheet.get('identifier_candidates', [])[:2]}")
    else:
        print(f"  ❌ Error: {response.data}")
    
    print("\n" + "="*80)
    print("TESTS COMPLETE")
    print("="*80 + "\n")


if __name__ == '__main__':
    run_manual_test()
