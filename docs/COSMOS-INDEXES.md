# Cosmos DB Recommended Composite Indexes

Cosmos DB automatically indexes all properties with a single-property index, but
range and ORDER BY queries on multiple fields require explicit composite indexes.
These recommendations cover the query patterns in `server/lib/data.js`.

## Primary recommended indexes

### 1. List queries with recency sort (highest priority)

Used by every `GET /api/db/list` call that sorts results by `data.updatedAt`.

```json
{
  "compositeIndexes": [
    [
      { "path": "/coll",          "order": "ascending" },
      { "path": "/tenantId",      "order": "ascending" },
      { "path": "/data/updatedAt","order": "descending" }
    ]
  ]
}
```

**Why:** The list query is `WHERE c.kind='entity' AND c.coll=@coll AND c.tenantId=@tid ORDER BY c.data.updatedAt DESC`. Without this index Cosmos falls back to a full-partition scan + in-memory sort, which is expensive on large product catalogues.

### 2. Kind + tenant range queries

Used by audit-event queries and version history lookups.

```json
[
  { "path": "/kind",      "order": "ascending" },
  { "path": "/tenantId",  "order": "ascending" },
  { "path": "/createdAt", "order": "descending" }
]
```

### 3. Grounding chunk retrieval

Used by `grounding()` and `grounding()` in `server/lib/ai/_shared.js` for full-text + vector search on `groundingChunks`.

```json
[
  { "path": "/coll",        "order": "ascending" },
  { "path": "/tenantId",    "order": "ascending" },
  { "path": "/data/productId", "order": "ascending" }
]
```

### 4. Search index queries

Used by `PROBE_MODE=1` queries and the search endpoint if implemented.

```json
[
  { "path": "/kind",       "order": "ascending" },
  { "path": "/tenantId",   "order": "ascending" },
  { "path": "/entityType", "order": "ascending" }
]
```

## How to apply

In the Azure Portal:

1. Navigate to **Cosmos DB account** -> **Data Explorer** -> your container
2. Open **Scale & Settings** -> **Indexing Policy**
3. Merge the `compositeIndexes` array entries above into the existing policy JSON
4. Click **Save**

Changes take effect immediately for new writes; existing documents are backfilled
asynchronously (no downtime required).

## Partition key reminder

The container uses `pk` as the partition key with format `${tenantId}|${productId}`.
All cross-partition queries (e.g., admin-level scans) are unavoidable without
this scheme but are minimized by always scoping queries to `c.tenantId=@tid`.

Keep queries within a single logical partition where possible by supplying both
`coll` and `tenantId` in the WHERE clause -- this is the pattern used throughout
`server/lib/data.js`.
