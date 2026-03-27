-- SharePoint RAG PostgreSQL Schema with pgvector
-- 
-- Prerequisites:
-- 1. PostgreSQL 14+ installed
-- 2. pgvector extension available
--
-- Installation:
-- psql -U postgres -d snowchat -f postgres_sharepoint_schema.sql

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Table 1: Document Chunks with Vector Embeddings
-- Stores individual text chunks extracted from SharePoint documents
-- Uses pgvector for fast similarity search
CREATE TABLE IF NOT EXISTS document_chunks (
    id SERIAL PRIMARY KEY,
    sp_item_id VARCHAR(255) NOT NULL,           -- SharePoint item ID (unique identifier)
    domain VARCHAR(50) NOT NULL,                 -- Insurance domain (new_application, underwriting, etc.)
    chunk_text TEXT NOT NULL,                    -- Actual text content
    embedding vector(1536),                      -- OpenAI ada-002 embedding (1536 dimensions)
    chunk_index INTEGER NOT NULL,                -- Position in original document (0-based)
    filename VARCHAR(500) NOT NULL,              -- Original filename
    file_path TEXT,                              -- SharePoint file path
    last_modified TIMESTAMP NOT NULL,            -- Last modification time from SharePoint
    created_at TIMESTAMP DEFAULT NOW(),          -- When this chunk was indexed
    updated_at TIMESTAMP DEFAULT NOW(),          -- When this chunk was last updated
    
    CONSTRAINT unique_chunk UNIQUE (sp_item_id, chunk_index)
);

-- Create HNSW index for fast vector similarity search
-- HNSW (Hierarchical Navigable Small World) is faster than IVFFlat for high recall
-- vector_cosine_ops: Uses cosine similarity (1 - cosine distance)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON document_chunks 
    USING hnsw (embedding vector_cosine_ops);

-- Create indexes for domain and freshness filtering
CREATE INDEX IF NOT EXISTS idx_chunks_domain ON document_chunks(domain);
CREATE INDEX IF NOT EXISTS idx_chunks_last_modified ON document_chunks(last_modified DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_sp_item_id ON document_chunks(sp_item_id);

-- Create composite index for domain-filtered vector search
CREATE INDEX IF NOT EXISTS idx_chunks_domain_modified ON document_chunks(domain, last_modified DESC);


-- Table 2: Document Metadata
-- Tracks document-level sync state and metadata
CREATE TABLE IF NOT EXISTS document_metadata (
    sp_item_id VARCHAR(255) PRIMARY KEY,         -- SharePoint item ID
    domain VARCHAR(50) NOT NULL,                 -- Insurance domain
    filename VARCHAR(500) NOT NULL,              -- Original filename
    file_path TEXT NOT NULL,                     -- SharePoint file path
    file_size_bytes BIGINT,                      -- File size
    mime_type VARCHAR(100),                      -- MIME type (e.g., application/vnd.openxmlformats-officedocument.wordprocessingml.document)
    last_modified TIMESTAMP NOT NULL,            -- Last modification time from SharePoint
    last_synced TIMESTAMP DEFAULT NOW(),         -- When this document was last synced
    chunk_count INTEGER DEFAULT 0,               -- Number of chunks extracted
    sync_status VARCHAR(20) DEFAULT 'synced',    -- Status: synced, pending, error
    error_message TEXT,                          -- Error message if sync failed
    sp_web_url TEXT,                             -- SharePoint web URL for direct access
    created_by VARCHAR(255),                     -- Document creator
    modified_by VARCHAR(255),                    -- Last modifier
    
    CONSTRAINT check_sync_status CHECK (sync_status IN ('synced', 'pending', 'error', 'deleted'))
);

-- Indexes for document metadata
CREATE INDEX IF NOT EXISTS idx_metadata_domain ON document_metadata(domain);
CREATE INDEX IF NOT EXISTS idx_metadata_last_modified ON document_metadata(last_modified DESC);
CREATE INDEX IF NOT EXISTS idx_metadata_sync_status ON document_metadata(sync_status);


-- Table 3: Sync State (Delta Tokens)
-- Tracks delta synchronization state per domain
-- SharePoint Delta API provides incremental changes using delta tokens
CREATE TABLE IF NOT EXISTS sync_state (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(50) UNIQUE NOT NULL,          -- Insurance domain
    delta_token TEXT,                            -- SharePoint delta token for incremental sync
    last_sync_time TIMESTAMP DEFAULT NOW(),      -- When sync was last performed
    documents_added INTEGER DEFAULT 0,           -- Statistics: documents added in last sync
    documents_updated INTEGER DEFAULT 0,         -- Statistics: documents updated in last sync
    documents_deleted INTEGER DEFAULT 0,         -- Statistics: documents deleted in last sync
    sync_duration_seconds INTEGER,               -- How long the sync took
    sync_status VARCHAR(20) DEFAULT 'idle',      -- Status: idle, syncing, error
    error_message TEXT                           -- Error message if sync failed
);

-- Initialize sync state for all domains (run after table creation)
INSERT INTO sync_state (domain, sync_status) 
VALUES 
    ('new_application', 'idle'),
    ('underwriting', 'idle'),
    ('policy_issue', 'idle'),
    ('policy_transactions', 'idle'),
    ('product_configuration', 'idle'),
    ('product_coverages', 'idle'),
    ('product_riders', 'idle'),
    ('funds', 'idle'),
    ('clients', 'idle'),
    ('calculations', 'idle')
ON CONFLICT (domain) DO NOTHING;


-- Table 4: Query Cache
-- Caches LLM-generated answers for frequently asked questions
-- Reduces latency and OpenAI API costs
CREATE TABLE IF NOT EXISTS query_cache (
    id SERIAL PRIMARY KEY,
    question_hash VARCHAR(64) NOT NULL,          -- SHA256 hash of normalized question
    question_text TEXT NOT NULL,                 -- Original question text
    domain VARCHAR(50),                          -- Domain context (if domain-specific query)
    answer TEXT NOT NULL,                        -- LLM-generated answer
    sources JSONB NOT NULL,                      -- Array of source documents (JSON)
    model_used VARCHAR(100),                     -- Model used to generate answer (e.g., gpt-4, ft:gpt-3.5-turbo:...)
    created_at TIMESTAMP DEFAULT NOW(),          -- When this cache entry was created
    expires_at TIMESTAMP,                        -- When this cache entry expires (NULL = no expiry)
    hit_count INTEGER DEFAULT 1,                 -- How many times this cache entry was used
    
    CONSTRAINT unique_cached_query UNIQUE (question_hash, domain)
);

-- Indexes for query cache
CREATE INDEX IF NOT EXISTS idx_query_cache_hash ON query_cache(question_hash);
CREATE INDEX IF NOT EXISTS idx_query_cache_domain ON query_cache(domain);
CREATE INDEX IF NOT EXISTS idx_query_cache_expires ON query_cache(expires_at);

-- Auto-cleanup expired cache entries (run periodically via cron/scheduler)
-- Example: DELETE FROM query_cache WHERE expires_at IS NOT NULL AND expires_at < NOW();


-- ============================================================
-- Useful Queries for Monitoring and Debugging
-- ============================================================

-- Query 1: Check cache statistics
-- Shows total documents, chunks, and cache hit rates
/*
SELECT 
    (SELECT COUNT(*) FROM document_metadata) as total_documents,
    (SELECT COUNT(*) FROM document_chunks) as total_chunks,
    (SELECT COUNT(*) FROM query_cache) as cached_queries,
    (SELECT SUM(hit_count) FROM query_cache) as total_cache_hits,
    (SELECT MAX(last_sync_time) FROM sync_state) as last_sync_time;
*/

-- Query 2: Documents per domain
-- Shows distribution of documents across insurance domains
/*
SELECT 
    domain,
    COUNT(*) as document_count,
    SUM(chunk_count) as total_chunks,
    MAX(last_synced) as last_synced
FROM document_metadata
GROUP BY domain
ORDER BY document_count DESC;
*/

-- Query 3: Recent sync activity
-- Shows sync history for all domains
/*
SELECT 
    domain,
    last_sync_time,
    documents_added,
    documents_updated,
    documents_deleted,
    sync_duration_seconds,
    sync_status
FROM sync_state
ORDER BY last_sync_time DESC;
*/

-- Query 4: Most frequently cached queries
-- Shows which questions hit cache most often
/*
SELECT 
    question_text,
    domain,
    hit_count,
    model_used,
    created_at
FROM query_cache
ORDER BY hit_count DESC
LIMIT 20;
*/

-- Query 5: Find similar chunks (example vector search)
-- Replace '[0.1, 0.2, ...]' with actual embedding vector
/*
SELECT 
    filename,
    domain,
    chunk_text,
    1 - (embedding <=> '[0.1, 0.2, ...]'::vector) as similarity
FROM document_chunks
WHERE domain = 'new_application'
  AND last_modified > NOW() - INTERVAL '15 minutes'
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 5;
*/

-- Query 6: Check for stale documents (not synced recently)
-- Identifies documents that may need re-synchronization
/*
SELECT 
    filename,
    domain,
    last_synced,
    NOW() - last_synced as time_since_sync
FROM document_metadata
WHERE last_synced < NOW() - INTERVAL '1 day'
ORDER BY last_synced ASC;
*/

-- Query 7: Cache hit rate per domain
-- Analyzes query cache effectiveness
/*
SELECT 
    domain,
    COUNT(*) as query_count,
    SUM(hit_count) as total_hits,
    ROUND(AVG(hit_count), 2) as avg_hits_per_query
FROM query_cache
GROUP BY domain
ORDER BY total_hits DESC;
*/


-- ============================================================
-- Performance Tuning Suggestions
-- ============================================================

-- 1. Increase shared_buffers for better caching
-- Add to postgresql.conf: shared_buffers = '2GB'

-- 2. Tune HNSW index parameters for speed vs accuracy tradeoff
-- Rebuild index with custom parameters:
-- DROP INDEX idx_chunks_embedding;
-- CREATE INDEX idx_chunks_embedding ON document_chunks 
--     USING hnsw (embedding vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);
-- m = number of connections (higher = slower build, faster search)
-- ef_construction = accuracy (higher = better recall, slower build)

-- 3. Add maintenance job to clean expired cache
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('cleanup-expired-cache', '0 3 * * *', 
--     'DELETE FROM query_cache WHERE expires_at IS NOT NULL AND expires_at < NOW()');

-- 4. Monitor query performance
-- EXPLAIN ANALYZE SELECT ...
-- Use pg_stat_statements extension to track slow queries

-- 5. Consider partitioning document_chunks by domain if dataset grows > 10M rows
-- CREATE TABLE document_chunks_new_application PARTITION OF document_chunks FOR VALUES IN ('new_application');


-- ============================================================
-- Backup and Restore
-- ============================================================

-- Backup (including vector data)
-- pg_dump -U postgres -d snowchat --table=document_chunks --table=document_metadata --table=sync_state --table=query_cache -F c -f sharepoint_rag_backup.dump

-- Restore
-- pg_restore -U postgres -d snowchat -c sharepoint_rag_backup.dump

-- ============================================================
-- Cleanup (DANGER: Deletes all data)
-- ============================================================

-- DROP TABLE IF EXISTS query_cache CASCADE;
-- DROP TABLE IF EXISTS document_chunks CASCADE;
-- DROP TABLE IF EXISTS document_metadata CASCADE;
-- DROP TABLE IF EXISTS sync_state CASCADE;
