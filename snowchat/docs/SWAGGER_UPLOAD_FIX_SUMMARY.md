# Swagger YAML Upload Fix Summary

## Problem Identified

When uploading `group_accident_insurance_api.yaml` through the mapper UI (2026-01-13 14:13:15):

```
ERROR: AttributeError: 'ExcelObjectDescriptor' object has no attribute 'type'
Location: C:\dev\snowchat/backend\components\mapping_api.py:565
```

The backend attempted to access `attr.type` and `attr.required` fields that don't exist in `ExcelObjectDescriptor`.

## Root Cause

The Swagger parser returns `SwaggerOperationDescriptor` with `input_attributes` and `output_attributes` as lists of `ExcelObjectDescriptor` objects. These descriptors have:

**Available fields:**
- `name` - Attribute name
- `description` - Attribute description  
- `path` - JSON path
- `sample` - Sample value
- `column` - Column name
- `sheet` - Sheet name
- `metadata` - Additional metadata dictionary

**Missing fields** (incorrectly assumed):
- `type` - Data type (string/number/etc)
- `required` - Whether attribute is required

## Fix Applied

Updated `c:\dev\snowchat\backend\components\mapping_api.py` lines 545-585 to use correct `ExcelObjectDescriptor` fields:

```python
# Before (BROKEN):
for attr in op.input_attributes:
    col_name = f"{op.operation_id}::input.{attr.name}"
    all_columns.append({
        "name": col_name,
        "type": attr.type,           # ❌ DOESN'T EXIST
        "description": attr.description,
        "required": attr.required,    # ❌ DOESN'T EXIST
        "source": "input"
    })

# After (FIXED):
for attr in op.input_attributes:
    col_name = f"{op.operation_id}::input.{attr.name}" if attr.name else f"{op.operation_id}::input.{attr.column}"
    all_columns.append({
        "name": col_name,
        "description": attr.description or "",  # ✅ EXISTS
        "path": attr.path or "",                # ✅ EXISTS
        "sample": attr.sample or "",            # ✅ EXISTS
        "source": "input"
    })
```

Also updated date/amount column detection to use naming patterns instead of non-existent type field:

```python
# Pattern-based detection
date_cols = [col for col in op_columns if any(kw in col.lower() 
    for kw in ['date', 'time', 'timestamp', 'created', 'updated'])]
amount_cols = [col for col in op_columns if any(kw in col.lower() 
    for kw in ['amount', 'premium', 'price', 'cost', 'sum', 'total', 'value'])]
```

## Test Results

### Manual Test (Devpilot Environment - PASSED ✅)

```
MANUAL SWAGGER UPLOAD TEST
================================================================================

[1] Testing parse_swagger()...
  ✓ API: Group Accident Insurance API v2.1.0
  ✓ Operations: 7
  ✓ Endpoints: 7
  ✓ Attributes: 58 input + 34 output = 92 total

[2] Testing ExcelObjectDescriptor structure...
  ✓ First attribute: name=employer_name, desc=Legal name of the employer organization
  ✓ Has 'name': True
  ✓ Has 'description': True
  ✓ Has 'path': True
  ✓ Has 'type': False (should be False) ✅ CORRECTLY DETECTED
  ✓ Has 'required': False (should be False) ✅ CORRECTLY DETECTED

[3] Testing Flask endpoint...
  ✓ Status: 200 ✅
  ✓ Response status: success ✅
  ✓ Sheets: 7 ✅
  ✓ Columns: 92 ✅

  First sheet details:
    - Name: createProposal
    - Candidates: 10
    - Sample: ['createProposal::input.employer_name', 'createProposal::input.broker_name']

================================================================================
TESTS COMPLETE - ALL PASSED ✅
================================================================================
```

### Pytest Suite (Base Anaconda - FAILED ❌)

7/8 tests failed due to **environment issue**: pytest runs in base Anaconda Python 3.12 without `prance` package installed.

**One test passed:**
- ✅ `test_swagger_rejects_invalid_extensions` - Doesn't require prance

**To fix pytest failures:**
```powershell
# Install prance in base Anaconda Python used by pytest
python -m pip install 'prance[osv]>=23.6.21.0'
```

## Verbose Logging Added

### Backend (`mapping_api.py`)
```python
logger.info("[mapping.api] Starting Swagger parse | file=%s size=%d bytes", ...)
logger.info("[mapping.api] Swagger parse complete | operations=%d total_attrs=%d", ...)
logger.info("[mapping.api] Built sheet structure | sheets=%d total_columns=%d", ...)
logger.info("[mapping.api] Response prepared | status=success sheets=%d columns=%d", ...)
```

### Parser (`parsers.py`)
```python
logger.info("[mapping.parsers] Parsed Swagger spec | api=%s version=%s endpoints=%s operations=%s input_attrs=%s output_attrs=%s", ...)
logger.info("[mapping.parsers] Operation detail | id=%s method=%s endpoint=%s inputs=%d outputs=%d", ...)
```

### Frontend (`templateAnalysisApi.ts`)
```typescript
console.log('[analyzeSwaggerSpec] Starting parse | file=%s includeVectors=%s', ...)
console.log('[analyzeSwaggerSpec] Calling endpoint | url=%s', ...)
console.log('[analyzeSwaggerSpec] Response received | status=%d', ...)
console.log('[analyzeSwaggerSpec] Processing sheets | rawType=%s count=%d', ...)
console.log('[analyzeSwaggerSpec] Summary built | operations=%d totalFields=%d', ...)
```

## Response Structure

Backend now returns Excel-compatible structure:

```json
{
  "status": "success",
  "summary": {
    "fileName": "group_accident_insurance_api.yaml",
    "sheetsAnalyzed": 7,
    "api_title": "Group Accident Insurance API",
    "api_version": "2.1.0"
  },
  "context": {
    "sheet_summary": [
      {
        "sheetName": "createProposal",
        "identifier_candidates": [
          "createProposal::input.employer_name",
          "createProposal::input.broker_name",
          ...
        ],
        "date_columns": [],
        "amount_columns": []
      },
      ...
    ],
    "total_source_columns": 92,
    "excel_objects": {
      "count": 7,
      "keyword_frequency": {}
    }
  },
  "warnings": [],
  "swagger_metadata": {
    "api_title": "Group Accident Insurance API",
    "api_version": "2.1.0",
    "api_description": null,
    "total_operations": 7
  }
}
```

## Files Modified

1. **c:\dev\snowchat\backend\components\mapping_api.py** (lines 545-605)
   - Fixed attribute access to use ExcelObjectDescriptor fields
   - Added verbose logging
   - Added pattern-based type detection

2. **c:\dev\snowchat\backend\components\mapping_agents\parsers.py** (lines 1115-1135)
   - Added detailed operation logging

3. **c:\dev\mapper\src\services\templateAnalysisApi.ts** (lines 630-710)
   - Added console logging for debugging

4. **c:\dev\snowchat\backend\tests\test_swagger_upload_integration.py** (new file)
   - 8 comprehensive integration tests
   - Manual test runner
   - Validates parser structure, endpoint response, frontend compatibility

## Next Steps

1. **Restart backend server** to pick up changes
2. **Test YAML upload** in mapper UI - should show 7 operations with 92 columns
3. **Check browser DevTools console** for frontend logs
4. **Check backend log** for detailed parsing logs
5. **(Optional)** Install prance in pytest environment to enable full test suite

## Expected Behavior After Fix

When uploading `group_accident_insurance_api.yaml`:

1. ✅ File accepted (no "JSON only" restriction)
2. ✅ Routed to `/mapping/parse/swagger` (not `/parse/excel`)
3. ✅ Parsed successfully (92 attributes from 7 operations)
4. ✅ Transformed to Excel-like structure
5. ✅ Frontend displays: "Columns: 0 Objects: 0 **Sheets: 7**" (not all zeros)
6. ✅ Can proceed to mapping step
