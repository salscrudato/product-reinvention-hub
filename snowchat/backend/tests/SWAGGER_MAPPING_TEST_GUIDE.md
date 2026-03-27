# Swagger Mapping Test Suite

## Overview
Comprehensive test suite for the cost-optimized Swagger/OpenAPI-based mapping system. Tests all components from parsing to API endpoints.

## Test Files

### 1. Test Data
- **Swagger Spec:** `backend/test_excels/enriched/group_accident_insurance_api.yaml`
  - 8 operations (createProposal, addCoverageOption, calculatePremium, etc.)
  - 100+ API attributes across request/response schemas
  - Realistic group accident insurance domain

- **Word Template:** `backend/test_excels/enriched/Group Accident PAS Proposal_Generalized Template.docx`
  - 561 dynamic fields
  - Insurance proposal template with broker, employer, coverage details

### 2. Test Suite (`tests/test_swagger_mapping.py`)
- **TestSwaggerParser** - 6 tests
  - Valid Swagger parsing
  - Attribute extraction
  - Nested schema flattening
  - Error handling

- **TestEmbeddingCache** - 7 tests
  - SHA256 hashing consistency
  - Cache hit/miss tracking
  - Batch operations
  - Persistence
  - Statistics

- **TestHybridMappingEngine** - 6 tests
  - Tier 1: Exact/fuzzy matching
  - Tier 2: Embedding similarity
  - Tier 3: LLM synthesis
  - Statistics tracking

- **TestSwaggerRelevanceEngine** - 2 tests
  - API ranking by relevance
  - Confidence threshold filtering

- **TestProgressiveMappingOrchestrator** - 4 tests
  - Batch processing
  - Checkpoint persistence
  - Session resumption
  - Mapping aggregation

- **TestEndToEndIntegration** - 2 tests
  - Full workflow (Swagger → Word → mappings)
  - Field extraction validation

- **TestMappingAPIEndpoints** - 2 tests
  - POST /mapping/parse/swagger
  - Error handling for invalid files

**Total:** 29 test cases

## Running Tests

### Prerequisites
```bash
cd c:\dev\snowchat\backend
pip install pytest pytest-cov pytest-mock
```

### Run All Tests
```bash
# From backend directory
pytest tests/test_swagger_mapping.py -v

# With coverage
pytest tests/test_swagger_mapping.py -v --cov=components.mapping_agents --cov-report=html

# Run specific test class
pytest tests/test_swagger_mapping.py::TestSwaggerParser -v

# Run single test
pytest tests/test_swagger_mapping.py::TestSwaggerParser::test_parse_valid_swagger_yaml -v
```

### PowerShell Command
```powershell
cd c:\dev\snowchat\backend
python -m pytest tests/test_swagger_mapping.py -v --tb=short
```

## Expected Results

### Test Counts by Component
```
TestSwaggerParser ...................... 6 tests
TestEmbeddingCache ..................... 7 tests
TestHybridMappingEngine ................ 6 tests
TestSwaggerRelevanceEngine ............. 2 tests
TestProgressiveMappingOrchestrator ..... 4 tests
TestEndToEndIntegration ................ 2 tests
TestMappingAPIEndpoints ................ 2 tests
────────────────────────────────────────────────
TOTAL ................................... 29 tests
```

### Coverage Goals
| Component | Target Coverage | Critical Paths |
|-----------|----------------|----------------|
| parsers.py | 85%+ | parse_swagger(), _flatten_json_schema() |
| embedding_cache.py | 90%+ | batch_get_or_generate(), _hash_text() |
| hybrid_engine.py | 80%+ | map_targets_hybrid(), all 3 tiers |
| swagger_relevance.py | 85%+ | rank_apis_by_relevance() |
| progressive_mapper.py | 80%+ | map_next_batch(), checkpoint I/O |

## Test Execution Examples

### Example 1: Swagger Parser Test
```python
def test_parse_valid_swagger_yaml(self):
    """Parse group_accident_insurance_api.yaml"""
    summary = parse_swagger(str(SWAGGER_FILE))
    
    # Assertions:
    assert summary.api_title == "Group Accident Insurance API"
    assert len(summary.operations) == 8
    assert "createProposal" in [op.operation_id for op in summary.operations]
```

**Expected Output:**
```
✓ Parsed 8 operations
✓ Extracted 100+ attributes
✓ Flattened nested schemas
```

### Example 2: Embedding Cache Test
```python
def test_cache_hit_and_miss(self):
    """Test SHA256-based caching"""
    cache = EmbeddingCacheManager()
    
    # First call - miss
    result1 = cache.get_or_generate("employer_name", mock_gen)
    assert cache.miss_count == 1
    
    # Second call - hit
    result2 = cache.get_or_generate("employer_name", mock_gen)
    assert cache.hit_count == 1
    assert mock_gen.call_count == 1  # Only called once!
```

**Expected Output:**
```
✓ SHA256 hash consistent
✓ Cache hit rate: 50%
✓ Generator called only once
```

### Example 3: Hybrid Engine Test
```python
def test_three_tier_mapping(self):
    """Test exact → embedding → LLM fallback"""
    engine = HybridMappingEngine()
    
    mappings = engine.map_targets_hybrid(targets, candidates, gen, llm)
    stats = engine.get_stats()
    
    assert stats['tier1_total'] >= 40  # 40%+ exact/fuzzy
    assert stats['tier2_embedding_match'] >= 20  # 20%+ embedding
    assert stats['tier3_llm_count'] <= 20  # ≤20% LLM
```

**Expected Output:**
```
✓ Tier 1 (exact/fuzzy): 45%
✓ Tier 2 (embedding): 35%
✓ Tier 3 (LLM): 15%
✓ Cost savings: 85%
```

### Example 4: End-to-End Test
```python
def test_full_workflow(self):
    """Test Swagger + Word → Mappings"""
    swagger = parse_swagger('group_accident_insurance_api.yaml')
    word = parse_word_document('Group Accident PAS Proposal.docx')
    
    # Rank APIs
    engine = SwaggerRelevanceEngine(swagger, word, mock_gen)
    ranked = engine.rank_apis_by_relevance(top_k=5)
    
    # Map progressively
    orchestrator = ProgressiveMappingOrchestrator(session_id='test')
    result = orchestrator.map_next_batch(ranked, map_func, batch_size=3)
    
    assert len(result['mappings']) > 0
```

**Expected Output:**
```
✓ Parsed 8 Swagger operations
✓ Parsed 561 Word fields
✓ Ranked top 5 relevant APIs
✓ Mapped 150+ fields in 3 batches
✓ Cache hit rate: 92%
```

## Troubleshooting

### Issue: "Test file not found"
**Solution:** Run from `backend/` directory, ensure test_excels/enriched/ exists

### Issue: "Import error: No module named 'components'"
**Solution:** 
```bash
cd c:\dev\snowchat\backend
python -m pytest tests/test_swagger_mapping.py -v
```

### Issue: "Mock not working for embeddings"
**Solution:** Use `@patch` decorator with full module path:
```python
@patch('components.mapping_agents.hybrid_engine.cosine_similarity')
def test_embedding_similarity(self, mock_cosine):
    mock_cosine.return_value = [[0.85]]
    # ... test code
```

### Issue: "Checkpoint file permission error"
**Solution:** Test creates temp directories, check write permissions

## Continuous Integration

### GitHub Actions Example
```yaml
name: Test Swagger Mapping
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
        with:
          python-version: '3.9'
      - run: |
          cd backend
          pip install -r requirements.txt
          pip install pytest pytest-cov
          pytest tests/test_swagger_mapping.py -v --cov
```

## Test Data Generation

### Regenerate Swagger Spec
The provided YAML spec is realistic but can be customized:

1. **Modify operations:** Add/remove endpoints in `group_accident_insurance_api.yaml`
2. **Add attributes:** Expand request/response schemas
3. **Change descriptions:** Update for different semantic similarity scores

### Use Different Word Template
Replace `Group Accident PAS Proposal_Generalized Template.docx` with any Word file containing merge fields in `[FIELD_NAME]` format.

## Performance Benchmarks

### Test Execution Time (Expected)
- **Parser tests:** ~2 seconds (includes file I/O)
- **Cache tests:** ~0.5 seconds (in-memory operations)
- **Hybrid engine tests:** ~1 second (mocked embeddings)
- **Orchestrator tests:** ~1 second (temp file I/O)
- **End-to-end tests:** ~3 seconds (full workflow)
- **API endpoint tests:** ~2 seconds (Flask test client)

**Total:** ~10 seconds for all 29 tests

### Coverage Report Example
```
Name                              Stmts   Miss  Cover
─────────────────────────────────────────────────────
parsers.py                         465     45    90%
embedding_cache.py                 265     25    91%
hybrid_engine.py                   433     70    84%
swagger_relevance.py               205     30    85%
progressive_mapper.py              293     50    83%
swagger_integration.py             220     40    82%
─────────────────────────────────────────────────────
TOTAL                             1881    260    86%
```

## Manual Testing Checklist

After automated tests pass, manually verify:

- [ ] Parse Swagger spec via REST API: `POST /mapping/parse/swagger`
- [ ] Verify 8 operations extracted with correct attributes
- [ ] Rank APIs by relevance: `POST /mapping/rank-apis`
- [ ] Verify `createProposal` ranks high for insurance template
- [ ] Map progressively: `POST /mapping/map-progressive`
- [ ] Verify checkpoint file created in `cache/mapping_checkpoints/`
- [ ] Check logs for tier breakdown (exact/embedding/LLM percentages)
- [ ] Verify embedding cache hit rate increases on second run
- [ ] Test resume from checkpoint after interruption
- [ ] Validate final mappings include `employer_name`, `broker_name`, `effective_date`

## Next Steps

1. **Run initial test suite:** `pytest tests/test_swagger_mapping.py -v`
2. **Review coverage report:** `pytest ... --cov-report=html` → open `htmlcov/index.html`
3. **Fix any failures:** Check logs in `backend/logs/agentic_orchestrator_auto.log`
4. **Add custom tests:** Extend test classes for domain-specific validation
5. **Integrate with CI/CD:** Add to GitHub Actions or Jenkins pipeline

---

**Documentation Version:** 1.0  
**Last Updated:** January 2026  
**Test Suite Status:** ✅ Complete and ready for execution
