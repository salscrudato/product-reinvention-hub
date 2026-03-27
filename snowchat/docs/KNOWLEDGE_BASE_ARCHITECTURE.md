# Mapping Knowledge Base - Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + TypeScript)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   Dashboard  │  │    Wizard    │  │   Mapping    │  │   Knowledge  │   │
│  │              │  │              │  │   Workspace  │  │     Base     │   │
│  │  - Projects  │  │  - Step 1-5  │  │              │  │              │   │
│  │  - Stats     │  │  - Upload    │  │  - Edit      │  │  - Import    │   │
│  │  - Navigate  │  │  - Generate  │  │  - Validate  │  │  - Browse    │   │
│  │              │  │              │  │              │  │  - Vectorize │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                  │                 │            │
│         └─────────────────┴──────────────────┴─────────────────┘            │
│                                  │                                           │
│                          REST API Calls                                      │
│                                  │                                           │
└──────────────────────────────────┼───────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Python + Flask)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                        mapping_api.py                               │    │
│  │  ┌─────────────────────────────────────────────────────────────┐   │    │
│  │  │  Endpoints (20+)                                             │   │    │
│  │  │  - GET/POST/DELETE /products                                 │   │    │
│  │  │  - GET/POST/PUT/DELETE /mappings                             │   │    │
│  │  │  - POST /vectorize                                            │   │    │
│  │  │  - POST /suggestions                                          │   │    │
│  │  │  - GET /search                                                │   │    │
│  │  └─────────────────────────────────────────────────────────────┘   │    │
│  └─────────────┬────────────────────────────────┬───────────────────┘    │
│                │                                 │                          │
│                ▼                                 ▼                          │
│  ┌──────────────────────────┐     ┌──────────────────────────────┐        │
│  │ mapping_knowledge_base.py│     │   mapping_vectorizer.py       │        │
│  ├──────────────────────────┤     ├──────────────────────────────┤        │
│  │ TinyDB Storage Layer     │     │ FAISS + Embeddings           │        │
│  │                          │     │                               │        │
│  │ • create_product()       │     │ • vectorize_product()         │        │
│  │ • get_all_products()     │     │ • find_similar_mappings()     │        │
│  │ • create_mapping()       │     │ • suggest_mappings()          │        │
│  │ • search_mappings()      │     │ • rebuild_index()             │        │
│  │ • save_pattern()         │     │ • _get_embedding()            │        │
│  │ • get_statistics()       │     │ • _load_faiss_index()         │        │
│  └───────────┬──────────────┘     └────────────┬──────────────────┘        │
│              │                                  │                            │
│              │                                  │                            │
└──────────────┼──────────────────────────────────┼────────────────────────────┘
               │                                  │
               ▼                                  ▼
┌─────────────────────────────┐    ┌─────────────────────────────────┐
│   STORAGE (File System)     │    │   AI SERVICES (Azure OpenAI)    │
├─────────────────────────────┤    ├─────────────────────────────────┤
│                             │    │                                  │
│  mapping_knowledge_base.json│    │  text-embedding-ada-002          │
│  ┌──────────────────────┐   │    │  ┌───────────────────────┐      │
│  │ Table: products      │   │    │  │ Embeddings API        │      │
│  │ - id, name, type     │   │    │  │ - Input: text         │      │
│  │ - totalFields        │   │    │  │ - Output: 1536-dim    │      │
│  │ - vectorized         │   │    │  │ - Cost: ~$0.0001/1K   │      │
│  └──────────────────────┘   │    │  └───────────────────────┘      │
│  ┌──────────────────────┐   │    │                                  │
│  │ Table: field_mappings│   │    │  Cache Hit: 80-90% reduction    │
│  │ - wordPlaceholder    │   │    │  ────────────────────────►      │
│  │ - jsonPath           │   │    │  Embedding Cache (JSON)          │
│  │ - swaggerOperation   │   │    │  • MD5-keyed vectors            │
│  │ - confidence         │   │    │  • ~1.5MB per 1K texts          │
│  └──────────────────────┘   │    │                                  │
│  ┌──────────────────────┐   │    └─────────────────────────────────┘
│  │ Table: patterns      │   │
│  │ - patternName        │   │    ┌─────────────────────────────────┐
│  │ - patternRegex       │   │    │   VECTOR INDEX (FAISS)          │
│  │ - confidence         │   │    ├─────────────────────────────────┤
│  └──────────────────────┘   │    │                                  │
│                             │    │  mapping_embeddings.index        │
│  Size: ~2MB per 10K records │    │  ┌───────────────────────┐      │
│                             │    │  │ IndexFlatL2           │      │
└─────────────────────────────┘    │  │ - Dimension: 1536     │      │
                                   │  │ - Metric: L2          │      │
                                   │  │ - Algorithm: Exact    │      │
                                   │  └───────────────────────┘      │
                                   │                                  │
                                   │  + metadata.json                 │
                                   │  • Index → Mapping ID map       │
                                   │                                  │
                                   │  Size: ~6.3KB per 1K vectors    │
                                   │                                  │
                                   └─────────────────────────────────┘


DATA FLOW - Import Product
────────────────────────────

User → UI: Upload Swagger File
         │
         ▼
     POST /products (multipart/form-data)
         │
         ▼
     parse_swagger() → Extract operations & attributes
         │
         ▼
     kb.create_product() → Store in TinyDB
         │
         ▼
     For each attribute:
         kb.create_mapping() → Store field mapping
         │
         ▼
     Return: {id, totalFields, mappedFields}


DATA FLOW - Vectorization
──────────────────────────

User → UI: Click "Vectorize" button
         │
         ▼
     POST /products/{id}/vectorize
         │
         ▼
     vectorizer.vectorize_product(id)
         │
         ├─► Get all mappings from TinyDB
         │
         ├─► For each mapping:
         │   │
         │   ├─► combined_text = f"{placeholder} {jsonPath}"
         │   │
         │   ├─► Check embedding_cache (MD5 key)
         │   │   │
         │   │   ├─► Cache hit? Return cached embedding
         │   │   │
         │   │   └─► Cache miss? Call Azure OpenAI API
         │   │       │
         │   │       └─► Save to cache
         │   │
         │   └─► Add embedding to FAISS index
         │
         ├─► Save FAISS index to disk
         │
         ├─► Save metadata (index → mapping ID map)
         │
         └─► Update product.vectorized = true


DATA FLOW - Get Suggestions
────────────────────────────

User → UI: Request suggestions for new placeholders
         │
         ▼
     POST /suggestions
     {
       "placeholders": ["[EMPLOYEE_COUNT]"],
       "confidenceThreshold": 0.7
     }
         │
         ▼
     vectorizer.suggest_mappings_for_placeholders()
         │
         ├─► For each placeholder:
         │   │
         │   ├─► Generate embedding (with cache)
         │   │
         │   ├─► FAISS.search(embedding, top_k=3)
         │   │   │
         │   │   └─► Returns: (distances[], indices[])
         │   │
         │   ├─► Get mapping metadata from indices
         │   │
         │   ├─► Convert distance → similarity score
         │   │   score = 1.0 / (1.0 + distance)
         │   │
         │   └─► Filter by confidence threshold
         │
         └─► Return: List[{placeholder, suggestedPath, confidence}]


PERFORMANCE CHARACTERISTICS
────────────────────────────

Vectorization (First Run):
  10,000 fields × 550ms = ~90 minutes
  ↓
  With 90% cache hit rate:
  1,000 new fields × 550ms = ~9 minutes

Suggestion Query:
  Embedding generation: ~200ms (cached) or ~550ms (uncached)
  FAISS search: <50ms (exact search)
  Total: ~250-600ms per query

Storage Requirements:
  TinyDB: ~200 bytes per mapping → 2MB for 10K
  FAISS: ~6.3 bytes per vector → 63KB for 10K
  Cache: ~150 bytes per embedding → 1.5MB for 10K
  Total: ~3.5MB for 10K mappings


SCALABILITY LIMITS
───────────────────

Current (TinyDB + IndexFlatL2):
  Products: Thousands
  Mappings per Product: 10,000-100,000
  Total Mappings: <1 Million
  Query Time: <100ms

At Scale (Future):
  Products: Unlimited
  Mappings: 10+ Million
  Upgrade Path:
    • TinyDB → PostgreSQL/MongoDB
    • IndexFlatL2 → IndexIVFFlat (sub-linear search)
    • Single-node → Distributed (Celery + Redis)


KEY INSIGHTS
────────────

1. Embedding Cache = 80-90% cost reduction
   → Always cache, never regenerate

2. FAISS IndexFlatL2 = Exact search
   → Perfect for <1M vectors, then upgrade to IVF

3. TinyDB = Single-threaded
   → No parallel writes, but fine for single-user

4. Confidence Threshold = Quality filter
   → 0.7 = High precision, 0.5 = High recall

5. Combined Text Embedding
   → "[ELIGIBLE_LIVES] eligibleLives" captures both sides

6. Pattern Learning (Future)
   → Extract regex patterns from high-confidence mappings
   → Reuse without API calls
```
