# Mapping Knowledge Base - Historical Learning System

## Overview
The Mapping Knowledge Base enables learning from past product implementations (e.g., your 10,000+ Group Life fields) to accelerate future mapping projects. It stores historical mappings, vectorizes them with FAISS, and provides AI-powered suggestions based on similarity search.

## Architecture

### Components

#### Backend (Python/Flask)
- **`mapping_knowledge_base.py`** - TinyDB storage for products and field mappings
- **`mapping_vectorizer.py`** - FAISS-based similarity search with Azure OpenAI embeddings
- **`mapping_api.py`** - REST endpoints for CRUD operations and vectorization

#### Frontend (React/TypeScript)
- **`MappingKnowledgeBase.tsx`** - Main UI component with 3 tabs:
  - **Import Product** - Upload Swagger, create/manage mappings
  - **Browse Mappings** - Search/filter historical mappings
  - **Vectorization** - Index status and statistics

### Data Storage

#### TinyDB (`mapping_knowledge_base.json`)
Three tables:

**1. products**
```json
{
  "id": "uuid",
  "productName": "Group Life Insurance",
  "productType": "Group Life",
  "swaggerFile": "group_life_api.yaml",
  "createdAt": "2026-01-18T12:00:00Z",
  "updatedAt": "2026-01-18T12:00:00Z",
  "totalFields": 10234,
  "mappedFields": 10234,
  "vectorized": true,
  "metadata": {
    "version": "1.0",
    "author": "John Doe",
    "description": "Complete Group Life product mapping"
  }
}
```

**2. field_mappings**
```json
{
  "id": "uuid",
  "productId": "product-uuid",
  "wordPlaceholder": "[ELIGIBLE_LIVES]",
  "jsonPath": "eligibleLives",
  "swaggerOperation": "getQuote",
  "dataType": "number",
  "sampleValue": "100",
  "confidence": 0.95,
  "notes": "Number of eligible employees",
  "createdAt": "2026-01-18T12:00:00Z"
}
```

**3. patterns** (Learned mapping patterns)
```json
{
  "id": "uuid",
  "patternName": "Date Fields MDY",
  "patternRegex": ".*_DATE_MDY$",
  "targetFieldPattern": "{prefix}Date",
  "dataType": "date",
  "confidence": 0.9,
  "examples": [
    {"placeholder": "[EFFECTIVE_DATE_MDY]", "jsonPath": "effectiveDate"},
    {"placeholder": "[PREPARED_ON_MDY]", "jsonPath": "preparedDate"}
  ]
}
```

#### FAISS Index (`mapping_embeddings.index`)
- Vector store for word placeholders + JSON paths
- Dimension: 1536 (Azure OpenAI text-embedding-ada-002)
- Index type: IndexFlatL2 (exact search)
- Metadata: `mapping_embeddings.index.metadata.json` maps index positions to mapping IDs

#### Embedding Cache (`mapping_embedding_cache.json`)
- MD5-keyed cache of embeddings to reduce API calls
- Format: `{"<md5_hash>": [1536-dim vector]}`

## API Endpoints

### Product Management

**GET /mapping/knowledge-base/products**
```bash
# Get all products
curl http://localhost:5001/mapping/knowledge-base/products

# Filter by type
curl http://localhost:5001/mapping/knowledge-base/products?type=Group%20Life

# Only vectorized products
curl http://localhost:5001/mapping/knowledge-base/products?vectorized=true
```

**POST /mapping/knowledge-base/products**
```bash
# Import new product with Swagger file
curl -X POST http://localhost:5001/mapping/knowledge-base/products \
  -F "productName=Group Life Insurance" \
  -F "productType=Group Life" \
  -F "version=1.0" \
  -F "description=Complete mapping" \
  -F "swaggerFile=@group_life_api.yaml"
```

**GET /mapping/knowledge-base/products/{product_id}**
```bash
curl http://localhost:5001/mapping/knowledge-base/products/abc-123
```

**DELETE /mapping/knowledge-base/products/{product_id}**
```bash
curl -X DELETE http://localhost:5001/mapping/knowledge-base/products/abc-123
```

### Field Mapping Management

**GET /mapping/knowledge-base/products/{product_id}/mappings**
```bash
# Get all mappings for a product
curl http://localhost:5001/mapping/knowledge-base/products/abc-123/mappings
```

**POST /mapping/knowledge-base/mappings**
```bash
# Create new mapping
curl -X POST http://localhost:5001/mapping/knowledge-base/mappings \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "abc-123",
    "wordPlaceholder": "[PLAN_NAME]",
    "jsonPath": "planName",
    "swaggerOperation": "getQuote",
    "dataType": "string",
    "sampleValue": "Group Term Life"
  }'
```

**PUT /mapping/knowledge-base/mappings/{mapping_id}**
```bash
# Update mapping
curl -X PUT http://localhost:5001/mapping/knowledge-base/mappings/def-456 \
  -H "Content-Type: application/json" \
  -d '{"notes": "Updated description"}'
```

**DELETE /mapping/knowledge-base/mappings/{mapping_id}**
```bash
curl -X DELETE http://localhost:5001/mapping/knowledge-base/mappings/def-456
```

**GET /mapping/knowledge-base/mappings/search**
```bash
# Search for similar placeholders
curl "http://localhost:5001/mapping/knowledge-base/mappings/search?placeholder=PLAN_NAME&productType=Group%20Life&limit=10"
```

### Vectorization

**POST /mapping/knowledge-base/products/{product_id}/vectorize**
```bash
# Vectorize all mappings for a product
curl -X POST http://localhost:5001/mapping/knowledge-base/products/abc-123/vectorize
```

**GET /mapping/knowledge-base/vectorization/status**
```bash
# Get vectorization statistics
curl http://localhost:5001/mapping/knowledge-base/vectorization/status
```

**POST /mapping/knowledge-base/vectorization/rebuild**
```bash
# Rebuild entire FAISS index (use after bulk imports)
curl -X POST http://localhost:5001/mapping/knowledge-base/vectorization/rebuild
```

### AI Suggestions

**POST /mapping/knowledge-base/suggestions**
```bash
# Get mapping suggestions for new placeholders
curl -X POST http://localhost:5001/mapping/knowledge-base/suggestions \
  -H "Content-Type: application/json" \
  -d '{
    "placeholders": ["[EMPLOYEE_COUNT]", "[COVERAGE_AMOUNT]"],
    "productType": "Group Life",
    "confidenceThreshold": 0.7
  }'
```

Response:
```json
{
  "status": "success",
  "suggestions": [
    {
      "wordPlaceholder": "[EMPLOYEE_COUNT]",
      "suggestedJsonPath": "eligibleLives",
      "suggestedOperation": "getQuote",
      "suggestedDataType": "number",
      "confidenceScore": 0.85,
      "sourceProduct": "Group Life Insurance v1",
      "sourceMapping": "[ELIGIBLE_LIVES]",
      "alternativeMatches": [
        {"jsonPath": "employeeCount", "score": 0.78, "sourceProduct": "Group Benefits v2"}
      ]
    }
  ]
}
```

## Usage Workflows

### Workflow 1: Import Historical Product

**Scenario:** You've completed a Group Life product with 10,000+ mapped fields.

1. **Navigate to Knowledge Base** from Dashboard
2. **Go to "Import Product" tab**
3. **Fill in details:**
   - Product Name: "Group Life Insurance"
   - Product Type: "Group Life"
   - Version: "1.0"
   - Description: "Complete Group Life implementation with 10,234 fields"
4. **Upload Swagger/OpenAPI spec** (YAML or JSON)
5. **Click "Import Product"**
   - System parses Swagger
   - Extracts all API operations and attributes
   - Auto-creates field mappings from JSON paths
   - Generates placeholders like `[ELIGIBLE_LIVES]`, `[SIC_CODE]`

**Result:** Product stored in TinyDB with 10,234 mappings ready for vectorization.

### Workflow 2: Vectorize for Similarity Search

**Scenario:** Enable AI-powered suggestions by indexing your mappings.

1. **Browse Mappings tab** → Click product row
2. **Click "Vectorize" button** (Memory icon)
3. **System processes:**
   - Generates embeddings for each placeholder + JSON path combination
   - Adds vectors to FAISS index (IndexFlatL2)
   - Caches embeddings to reduce API costs
   - Marks product as `vectorized: true`

**Performance:**
- ~550ms per embedding (Azure OpenAI)
- Batch processing in background
- Cache hits eliminate duplicate API calls

### Workflow 3: Get Suggestions for New Product

**Scenario:** Starting a new Voluntary Benefits product, want suggestions.

**Option A: Via UI (Future Phase)**
1. Upload new Swagger spec
2. Click "Get Suggestions" button
3. Review confidence scores
4. Accept/reject/modify suggestions

**Option B: Via API**
```bash
curl -X POST http://localhost:5001/mapping/knowledge-base/suggestions \
  -H "Content-Type: application/json" \
  -d '{
    "placeholders": [
      "[POLICY_NUMBER]",
      "[COVERAGE_AMOUNT]",
      "[EFFECTIVE_DATE]"
    ],
    "productType": "Voluntary Benefits",
    "confidenceThreshold": 0.7
  }'
```

**Returns:** Top matches from historical data with confidence scores.

### Workflow 4: Manual Mapping Management

**Scenario:** Create/edit mappings directly in UI.

1. **Browse Mappings tab** → Select product → Click "Add Mapping"
2. **Fill in form:**
   - Word Placeholder: `[PLAN_NAME]`
   - JSON Path: `planName`
   - Swagger Operation: `getQuote`
   - Data Type: `string`
   - Sample Value: "Group Term Life"
3. **Click "Create"**
4. **Edit existing mappings** via Edit icon
5. **Delete obsolete mappings** via Delete icon

## Integration with Existing Mapping Flow

### Phase 1: Standalone Knowledge Base ✅ (Current)
- Separate UI accessible from Dashboard
- Manual import of historical products
- Standalone vectorization and search

### Phase 2: Wizard Integration (Next)
Enhance Mapping Wizard to use Knowledge Base:

**Step 3 Enhancement: Auto-Suggestions**
```typescript
// In MappingWizard after Word template upload
const placeholders = extractedFields.map(f => f.placeholder);

const response = await fetch('/mapping/knowledge-base/suggestions', {
  method: 'POST',
  body: JSON.stringify({
    placeholders,
    productType: selectedProductType,
    confidenceThreshold: 0.7
  })
});

const { suggestions } = await response.json();

// Display suggestions with confidence indicators
// User can accept, reject, or modify
```

### Phase 3: Real-time Learning
- Auto-save approved mappings to Knowledge Base
- Continuous vectorization
- Pattern extraction and reuse

## Performance & Scalability

### Current Limits
- **TinyDB:** Single-file, single-threaded (fine for <100K records)
- **FAISS IndexFlatL2:** Exact search, linear time O(n)
- **Embedding API:** 550ms per field, cache-dependent

### Optimizations
1. **Embedding Cache:** Reduces API calls by 80-90% on repeated runs
2. **Batch Processing:** Vectorize 25 mappings at a time
3. **Lazy Loading:** FAISS index loaded on first request

### Future Scalability (>100K mappings)
- Migrate TinyDB → PostgreSQL or MongoDB
- Use FAISS IVF (Inverted File) index for sub-linear search
- Distributed vectorization with Celery/Redis

## Configuration

### Environment Variables
```bash
# Knowledge Base DB path
MAPPING_KB_DB_PATH=mapping_knowledge_base.json

# FAISS index path
MAPPING_FAISS_INDEX_PATH=mapping_embeddings.index

# Embedding cache path
MAPPING_CACHE_PATH=mapping_embedding_cache.json

# Azure OpenAI (inherited from main app)
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key
GPT_MODEL_NAME=gpt-4
OPENAI_API_VERSION=2023-05-15
```

### File Locations
```
backend/
├── mapping_knowledge_base.json          # TinyDB database
├── mapping_embeddings.index             # FAISS vectors
├── mapping_embeddings.index.metadata.json  # Index metadata
├── mapping_embedding_cache.json         # Embedding cache
└── components/
    ├── mapping_knowledge_base.py        # Storage layer
    ├── mapping_vectorizer.py            # FAISS + embeddings
    └── mapping_api.py                   # REST endpoints
```

## Testing

### Manual Testing
```bash
# 1. Start backend
cd backend
python app.py

# 2. Import test product
curl -X POST http://localhost:5001/mapping/knowledge-base/products \
  -F "productName=Test Product" \
  -F "productType=Group Life" \
  -F "swaggerFile=@test_swagger.yaml"

# 3. Verify storage
cat mapping_knowledge_base.json | jq '.products'

# 4. Vectorize
curl -X POST http://localhost:5001/mapping/knowledge-base/products/<id>/vectorize

# 5. Check index
ls -lh mapping_embeddings.index

# 6. Test suggestions
curl -X POST http://localhost:5001/mapping/knowledge-base/suggestions \
  -H "Content-Type: application/json" \
  -d '{"placeholders": ["[PLAN_NAME]"], "confidenceThreshold": 0.7}'
```

### Integration Testing
```python
# tests/test_knowledge_base.py
def test_product_import(client):
    response = client.post('/mapping/knowledge-base/products', data={
        'productName': 'Test',
        'productType': 'Group Life',
        'swaggerFile': (io.BytesIO(b'swagger: "2.0"'), 'test.yaml')
    })
    assert response.status_code == 200
    assert response.json['status'] == 'success'

def test_vectorization(client, sample_product_id):
    response = client.post(f'/mapping/knowledge-base/products/{sample_product_id}/vectorize')
    assert response.json['vectorizedCount'] > 0

def test_suggestions(client, vectorized_product_id):
    response = client.post('/mapping/knowledge-base/suggestions', json={
        'placeholders': ['[PLAN_NAME]'],
        'confidenceThreshold': 0.7
    })
    assert len(response.json['suggestions']) > 0
```

## Roadmap

### ✅ Phase 1: Foundation (Current)
- [x] TinyDB storage for products/mappings
- [x] FAISS vectorization
- [x] REST API endpoints
- [x] React UI with 3 tabs
- [x] Manual import workflow
- [x] Suggestion API

### 🚧 Phase 2: Wizard Integration (Next 2 weeks)
- [ ] Auto-suggestion in Mapping Wizard Step 3
- [ ] Confidence indicator UI
- [ ] Bulk accept/reject suggestions
- [ ] Pattern learning from approved mappings

### 📅 Phase 3: Advanced Features (Month 2)
- [ ] Pattern templates (e.g., `*_DATE_MDY` → date field)
- [ ] Product inheritance ("Start from Group Life template")
- [ ] Fuzzy matching for field name variations
- [ ] Conflict resolution UI

### 🔮 Phase 4: Enterprise (Future)
- [ ] Multi-tenant support
- [ ] PostgreSQL migration for >100K mappings
- [ ] Role-based access control
- [ ] Audit trail and versioning
- [ ] API rate limiting

## Troubleshooting

### Issue: FAISS import error
```
ImportError: cannot import name 'faiss' from 'faiss'
```
**Solution:** Install FAISS
```bash
pip install faiss-cpu  # or faiss-gpu for CUDA support
```

### Issue: TinyDB concurrency errors
```
JSONDecodeError: Expecting value: line 1 column 1 (char 0)
```
**Solution:** TinyDB is single-threaded; avoid parallel writes
- Use file locking for multi-process access
- Or migrate to PostgreSQL

### Issue: Slow vectorization
```
Vectorizing 10,000 mappings takes 90+ minutes
```
**Solution:** Check embedding cache hit rate
```bash
# View cache size
du -h mapping_embedding_cache.json

# Rebuild cache if corrupted
rm mapping_embedding_cache.json
curl -X POST http://localhost:5001/mapping/knowledge-base/vectorization/rebuild
```

### Issue: Low confidence suggestions
```
All suggestions have confidence < 0.5
```
**Root Cause:** Insufficient historical data or very different field naming
**Solution:**
- Import more similar products
- Lower confidence threshold (e.g., 0.5 instead of 0.7)
- Use pattern templates for common field types

## Examples

### Example 1: Import Your 10,000-Field Product
```bash
# Prepare Swagger spec from your existing product
# (convert your JSON schema to OpenAPI format)

# Import via API
curl -X POST http://localhost:5001/mapping/knowledge-base/products \
  -F "productName=Group Life Insurance v1" \
  -F "productType=Group Life" \
  -F "version=1.0" \
  -F "description=Complete implementation with 10,234 fields" \
  -F "author=Your Team" \
  -F "swaggerFile=@group_life_openapi.yaml"

# Response
{
  "status": "success",
  "product": {
    "id": "abc-123-def-456",
    "totalFields": 10234,
    "mappedFields": 10234
  }
}

# Vectorize
curl -X POST http://localhost:5001/mapping/knowledge-base/products/abc-123-def-456/vectorize

# Check status
curl http://localhost:5001/mapping/knowledge-base/vectorization/status
```

### Example 2: Get Suggestions for New Product
```bash
# You're starting Voluntary Benefits product
# Extract placeholders from Word template: [EMPLOYEE_COUNT], [BENEFIT_AMOUNT], [PLAN_TYPE]

curl -X POST http://localhost:5001/mapping/knowledge-base/suggestions \
  -H "Content-Type: application/json" \
  -d '{
    "placeholders": [
      "[EMPLOYEE_COUNT]",
      "[BENEFIT_AMOUNT]",
      "[PLAN_TYPE]"
    ],
    "productType": "Voluntary Benefits",
    "confidenceThreshold": 0.7
  }'

# Response
{
  "suggestions": [
    {
      "wordPlaceholder": "[EMPLOYEE_COUNT]",
      "suggestedJsonPath": "eligibleLives",
      "confidenceScore": 0.85,
      "sourceProduct": "Group Life Insurance v1"
    },
    {
      "wordPlaceholder": "[BENEFIT_AMOUNT]",
      "suggestedJsonPath": "coverageAmount",
      "confidenceScore": 0.92,
      "sourceProduct": "Group Life Insurance v1"
    }
  ]
}
```

## Support & Contribution

### Getting Help
- Check logs: `backend/agentic_orchestrator_auto.log`
- Increase logging: Set `LOG_LEVEL=DEBUG` in environment
- Review TinyDB: `cat mapping_knowledge_base.json | jq`

### Contributing
1. Add new endpoints in `mapping_api.py`
2. Update storage logic in `mapping_knowledge_base.py`
3. Enhance vectorization in `mapping_vectorizer.py`
4. Extend UI in `MappingKnowledgeBase.tsx`

---

**Last Updated:** January 18, 2026  
**Version:** 1.0.0  
**Status:** Phase 1 Complete ✅
