# Testing Swagger Upload via UI

## Quick Start

### Option 1: Web UI Test (Recommended)

1. **Start the backend server:**
   ```powershell
   cd c:\dev\snowchat\backend
   python app.py
   ```

2. **Open the test page in your browser:**
   ```
   http://localhost:5001/static/test_swagger_upload.html
   ```

3. **Upload your YAML file:**
   - Drag & drop `group_accident_insurance_api.yaml`
   - Or click "Choose File" and browse to:
     ```
     c:\dev\snowchat\backend\test_excels\enriched\group_accident_insurance_api.yaml
     ```

4. **Click "Upload & Parse"**

5. **View results:**
   - API title, version, description
   - Total operations (should show 8)
   - All operations with input/output counts
   - Total attributes extracted

---

### Option 2: Python Script Test

1. **Install requests library (if needed):**
   ```powershell
   pip install requests
   ```

2. **Run the test script:**
   ```powershell
   cd c:\dev\snowchat\backend
   python test_swagger_upload.py
   ```

3. **Expected output:**
   ```
   ✅ SUCCESS! Swagger parsed successfully

   API SUMMARY
   API Title: Group Accident Insurance API
   Version: 2.1.0
   Total Operations: 8

   OPERATIONS EXTRACTED
   1. createProposal
      Method: POST /proposals
      Input attrs: 17
      Output attrs: 4
   ...
   ```

---

### Option 3: cURL Test

**Upload YAML:**
```bash
curl -X POST http://localhost:5001/mapping/parse/swagger \
  -F "file=@test_excels/enriched/group_accident_insurance_api.yaml"
```

**Upload JSON (if converted):**
```bash
curl -X POST http://localhost:5001/mapping/parse/swagger \
  -F "file=@test_excels/enriched/group_accident_insurance_api.json"
```

---

### Option 4: Postman Test

1. **Create new POST request:**
   ```
   POST http://localhost:5001/mapping/parse/swagger
   ```

2. **Set Body type to "form-data"**

3. **Add file field:**
   - Key: `file` (type: File)
   - Value: Browse to `group_accident_insurance_api.yaml`

4. **Send request**

---

## Expected Response

```json
{
  "status": "success",
  "swagger_id": "550e8400-e29b-41d4-a716-446655440000",
  "summary": {
    "api_title": "Group Accident Insurance API",
    "api_version": "2.1.0",
    "api_description": "Comprehensive API for managing...",
    "total_endpoints": 7,
    "total_operations": 8,
    "metrics": {
      "total_input_attributes": 85,
      "total_output_attributes": 42
    }
  },
  "operations": [
    {
      "operation_id": "createProposal",
      "endpoint": "/proposals",
      "method": "POST",
      "summary": "Create new group accident insurance proposal",
      "input_attributes_count": 17,
      "output_attributes_count": 4
    },
    {
      "operation_id": "addCoverageOption",
      "endpoint": "/proposals/{proposal_id}/coverage-options",
      "method": "POST",
      "summary": "Add coverage option to proposal",
      "input_attributes_count": 15,
      "output_attributes_count": 3
    }
    // ... 6 more operations
  ],
  "context": {
    "total_attributes": 127,
    "has_descriptions": true
  }
}
```

---

## Troubleshooting

### Error: "Could not connect to http://localhost:5001"

**Solution:** Backend server not running. Start it:
```powershell
cd c:\dev\snowchat\backend
python app.py
```

### Error: "Invalid file type"

**Solution:** Only `.json`, `.yaml`, `.yml` files are accepted. Check file extension.

### Error: "Swagger parsing failed"

**Solution:** File may have syntax errors. Validate at https://editor.swagger.io

### Error: "No file uploaded"

**Solution:** Form field must be named `file`, not `swagger_file` or other names.

---

## File Formats Accepted

✅ **YAML (.yaml, .yml)** - Preferred format
```yaml
openapi: 3.0.3
info:
  title: My API
paths:
  /example:
    get: ...
```

✅ **JSON (.json)** - Also supported
```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "My API"
  },
  "paths": { ... }
}
```

❌ **XML** - Not supported (convert to YAML/JSON first)

---

## Integration with Main Application

To integrate Swagger upload into your main SnowChat UI:

1. **Add file upload component** in your React/frontend
2. **POST to endpoint:**
   ```javascript
   const formData = new FormData();
   formData.append('file', swaggerFile);
   
   fetch('http://localhost:5001/mapping/parse/swagger', {
     method: 'POST',
     body: formData
   });
   ```

3. **Handle response:**
   ```javascript
   const data = await response.json();
   if (data.status === 'success') {
     // Show operations, proceed to mapping
   }
   ```

---

## Next Steps After Upload

1. **Parse Word template** (separate endpoint):
   ```
   POST /mapping/parse/word
   ```

2. **Rank APIs by relevance:**
   ```
   POST /mapping/rank-apis
   Body: { swagger_summary, word_summary, top_k: 15 }
   ```

3. **Map progressively:**
   ```
   POST /mapping/map-progressive
   Body: { session_id, swagger_summary, word_summary, ranked_apis }
   ```

---

## Summary

✅ **YES** - You can upload `group_accident_insurance_api.yaml` via UI  
✅ **Both YAML and JSON** formats are supported  
✅ **Endpoint is ready:** `POST /mapping/parse/swagger`  
✅ **Test page provided:** `test_swagger_upload.html`  
✅ **Test script provided:** `test_swagger_upload.py`  

**Start testing now:** Open http://localhost:5001/static/test_swagger_upload.html (after starting backend)
