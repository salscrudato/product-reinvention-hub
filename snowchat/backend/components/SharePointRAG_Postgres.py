"""SharePoint RAG with PostgreSQL Cache and Fine-Tuned Model Support

Enhanced version of SharePointRAG that uses:
1. PostgreSQL + pgvector for intelligent caching and vector search
2. Fine-tuned GPT models for better insurance domain understanding
3. Multi-layer cache: Query cache → PG vector cache → Graph API

Architecture:
------------
Query → Check PG Query Cache → Check PG Vector Cache → Fetch from SharePoint → Update PG

Benefits over file-based approach:
- Shared cache across multiple backend instances
- Native vector similarity search with pgvector
- Transactional consistency (ACID)
- Easy analytics and monitoring via SQL
- Better scalability (millions of chunks)
- Automatic backup/replication

Prerequisites:
-------------
1. PostgreSQL 14+ with pgvector extension
2. Azure OpenAI (optionally with fine-tuned models)
3. Microsoft Graph API credentials

Setup:
------
```sql
CREATE EXTENSION vector;
-- Run schema from postgres_sharepoint_schema.sql
```

```bash
pip install psycopg2-binary pgvector
```

Usage:
------
```python
from SharePointRAG_Postgres import SharePointRAGPostgres

sp_rag = SharePointRAGPostgres(
    pg_conn_string="postgresql://user:pass@localhost:5432/snowchat",
    fine_tuned_model="ft:gpt-3.5-turbo-0613:insurance:xyz123"  # Optional
)

# Query with multi-layer cache
result = sp_rag.query("What are ACORD application requirements?")
```
"""

import os
import logging
import json
import hashlib
import time
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from pathlib import Path
import requests
import numpy as np
from dotenv import load_dotenv

# PostgreSQL imports
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, execute_values
    from pgvector.psycopg2 import register_vector
    POSTGRES_AVAILABLE = True
except Exception as e:
    logging.warning(f"PostgreSQL libraries not available: {e}")
    POSTGRES_AVAILABLE = False
    psycopg2 = None
    RealDictCursor = None
    execute_values = None
    register_vector = None

# OpenAI import
try:
    import openai
    _HAS_OPENAI = True
except Exception:
    openai = None
    _HAS_OPENAI = False

# Logging setup
logger = logging.getLogger("sharepoint_rag_postgres")
logger.setLevel(logging.INFO)

load_dotenv()

# Configuration
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
OPENAI_API_VERSION = os.getenv("OPENAI_API_VERSION", "2024-05-01-preview")
GPT_MODEL_NAME = os.getenv("GPT_MODEL_NAME", "gpt-4")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-ada-002")

# Fine-tuned model (optional)
FINE_TUNED_ROUTING_MODEL = os.getenv("FINE_TUNED_ROUTING_MODEL", "")
FINE_TUNED_ANSWER_MODEL = os.getenv("FINE_TUNED_ANSWER_MODEL", "")

# PostgreSQL Configuration
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
POSTGRES_DB = os.getenv("POSTGRES_DB", "snowchat")
POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")

# SharePoint Configuration
SP_TENANT_ID = os.getenv("SHAREPOINT_TENANT_ID", "")
SP_CLIENT_ID = os.getenv("SHAREPOINT_CLIENT_ID", "")
SP_CLIENT_SECRET = os.getenv("SHAREPOINT_CLIENT_SECRET", "")
SP_SITE_ID = os.getenv("SHAREPOINT_SITE_ID", "")
SP_DRIVE_ID = os.getenv("SHAREPOINT_DRIVE_ID", "")

# Cache TTL settings
QUERY_CACHE_TTL_MINUTES = int(os.getenv("QUERY_CACHE_TTL_MINUTES", "30"))
DOCUMENT_CACHE_TTL_MINUTES = int(os.getenv("DOCUMENT_CACHE_TTL_MINUTES", "15"))

# Domain Configuration
INSURANCE_DOMAINS = {
    "new_application": {
        "name": "New Application",
        "folder_path": "01_New_Application",
        "description": "ACORD forms, application requirements, new business processing"
    },
    "underwriting": {
        "name": "Underwriting",
        "folder_path": "02_Underwriting",
        "description": "Risk assessment, underwriting rules, medical underwriting"
    },
    "policy_issue": {
        "name": "Policy Issue",
        "folder_path": "03_Policy_Issue",
        "description": "Policy document generation, issuance procedures"
    },
    "policy_transactions": {
        "name": "Policy Transactions",
        "folder_path": "04_Policy_Transactions",
        "description": "Policy changes, transaction processing, transaction types"
    },
    "product_configuration": {
        "name": "Product Configuration",
        "folder_path": "05_Product_Configuration",
        "description": "Product catalog, product specifications, product rules"
    },
    "product_coverages": {
        "name": "Product Coverages",
        "folder_path": "06_Product_Coverages",
        "description": "Coverage definitions, base coverages, optional coverages"
    },
    "product_riders": {
        "name": "Product Riders",
        "folder_path": "07_Product_Riders",
        "description": "Rider catalog, rider definitions, rider rules"
    },
    "funds": {
        "name": "Funds",
        "folder_path": "08_Funds",
        "description": "Investment funds, fund allocation, fund performance"
    },
    "clients": {
        "name": "Clients",
        "folder_path": "09_Clients",
        "description": "Client data model, validation rules, KYC/AML requirements"
    },
    "calculations": {
        "name": "Calculations",
        "folder_path": "10_Calculations",
        "description": "Premium formulas, cash value calculations, transaction math"
    }
}


class SharePointRAGPostgres:
    """PostgreSQL-cached SharePoint RAG with fine-tuned model support"""
    
    def __init__(
        self,
        pg_conn_string: Optional[str] = None,
        tenant_id: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        site_id: Optional[str] = None,
        drive_id: Optional[str] = None,
        fine_tuned_routing_model: Optional[str] = None,
        fine_tuned_answer_model: Optional[str] = None
    ):
        """Initialize SharePoint RAG with PostgreSQL cache
        
        Args:
            pg_conn_string: PostgreSQL connection string (optional, uses env vars if not provided)
            tenant_id: Microsoft 365 tenant ID
            client_id: Azure AD app client ID
            client_secret: Azure AD app client secret
            site_id: SharePoint site ID
            drive_id: SharePoint drive ID
            fine_tuned_routing_model: Fine-tuned model for domain routing (optional)
            fine_tuned_answer_model: Fine-tuned model for answer generation (optional)
        """
        # SharePoint credentials
        self.tenant_id = tenant_id or SP_TENANT_ID
        self.client_id = client_id or SP_CLIENT_ID
        self.client_secret = client_secret or SP_CLIENT_SECRET
        self.site_id = site_id or SP_SITE_ID
        self.drive_id = drive_id or SP_DRIVE_ID
        
        # Authentication
        self.access_token = None
        self.token_expires_at = None
        
        # PostgreSQL connection
        if pg_conn_string:
            self.pg_conn_string = pg_conn_string
        else:
            self.pg_conn_string = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
        
        self.pg_conn = None
        self._connect_postgres()
        
        # OpenAI client
        self.openai_client = self._get_openai_client()
        
        # Fine-tuned models
        self.fine_tuned_routing_model = fine_tuned_routing_model or FINE_TUNED_ROUTING_MODEL
        self.fine_tuned_answer_model = fine_tuned_answer_model or FINE_TUNED_ANSWER_MODEL
        
        if self.fine_tuned_routing_model:
            logger.info(f"Using fine-tuned routing model: {self.fine_tuned_routing_model}")
        if self.fine_tuned_answer_model:
            logger.info(f"Using fine-tuned answer model: {self.fine_tuned_answer_model}")
        
        # Statistics
        self.stats = {
            'query_cache_hits': 0,
            'vector_cache_hits': 0,
            'graph_api_calls': 0,
            'queries_processed': 0
        }
        
        logger.info("SharePointRAGPostgres initialized with PostgreSQL cache")
    
    def _connect_postgres(self):
        """Connect to PostgreSQL and register pgvector"""
        if not POSTGRES_AVAILABLE:
            logger.error("PostgreSQL libraries not available")
            return
        
        try:
            self.pg_conn = psycopg2.connect(self.pg_conn_string)  # type: ignore[misc]
            if register_vector:
                register_vector(self.pg_conn)
            logger.info("Connected to PostgreSQL")
        except Exception as e:
            logger.error(f"Failed to connect to PostgreSQL: {e}")
            self.pg_conn = None
    
    def _get_openai_client(self):
        """Get Azure OpenAI or public OpenAI client"""
        if not _HAS_OPENAI:
            logger.warning("OpenAI library not available")
            return None
        
        AzureClient = getattr(openai, "AzureOpenAI", None)
        if AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT and AzureClient:
            try:
                client = AzureClient(
                    api_key=AZURE_OPENAI_API_KEY,
                    azure_endpoint=AZURE_OPENAI_ENDPOINT,
                    api_version=OPENAI_API_VERSION
                )
                logger.info("Using Azure OpenAI client")
                return client
            except Exception as e:
                logger.error(f"Failed to init Azure OpenAI client: {e}")
                return None
        
        logger.warning("Azure OpenAI not configured")
        return None
    
    def _hash_text(self, text: str) -> str:
        """Generate SHA256 hash of text"""
        return hashlib.sha256(text.encode()).hexdigest()
    
    def _normalize_question(self, question: str) -> str:
        """Normalize question for caching"""
        return question.lower().strip()
    
    def _check_query_cache(self, question: str, domain: Optional[str] = None) -> Optional[Dict]:
        """Check PostgreSQL query cache for exact question match"""
        if not self.pg_conn:
            return None
        
        question_hash = self._hash_text(self._normalize_question(question))
        
        try:
            with self.pg_conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT answer, sources, model_used, created_at
                    FROM query_cache
                    WHERE question_hash = %s
                      AND (domain = %s OR domain IS NULL)
                      AND (expires_at IS NULL OR expires_at > NOW())
                    ORDER BY created_at DESC
                    LIMIT 1
                """, (question_hash, domain))
                
                result = cur.fetchone()
                
                if result:
                    # Update hit count
                    cur.execute("""
                        UPDATE query_cache
                        SET hit_count = hit_count + 1
                        WHERE question_hash = %s AND (domain = %s OR domain IS NULL)
                    """, (question_hash, domain))
                    self.pg_conn.commit()
                    
                    self.stats['query_cache_hits'] += 1
                    logger.info(f"Query cache HIT for question hash: {question_hash[:8]}...")
                    
                    # Cast result to dict for type safety
                    result_dict = dict(result) if result else {}
                    return {
                        'answer': result_dict.get('answer', ''),
                        'sources': json.loads(result_dict['sources']) if isinstance(result_dict.get('sources'), str) else result_dict.get('sources', []),
                        'cached': True,
                        'cache_type': 'query_cache',
                        'cached_at': result_dict['created_at'].isoformat() if result_dict.get('created_at') else None
                    }
                
                logger.debug(f"Query cache MISS for question hash: {question_hash[:8]}...")
                return None
                
        except Exception as e:
            logger.error(f"Error checking query cache: {e}")
            return None
    
    def _generate_embedding(self, text: str) -> Optional[np.ndarray]:
        """Generate embedding using Azure OpenAI"""
        if not self.openai_client:
            return None
        
        try:
            response = self.openai_client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=text
            )
            
            embedding = response.data[0].embedding
            return np.array(embedding, dtype=np.float32)
            
        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            return None
    
    def _vector_search_postgres(self, query_embedding: np.ndarray, domain: Optional[str] = None, top_k: int = 5) -> List[Dict]:
        """Search PostgreSQL for similar chunks using pgvector"""
        if not self.pg_conn:
            return []
        
        try:
            with self.pg_conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Check freshness: only use chunks synced in last N minutes
                freshness_cutoff = datetime.now() - timedelta(minutes=DOCUMENT_CACHE_TTL_MINUTES)
                
                if domain:
                    cur.execute("""
                        SELECT 
                            chunk_text,
                            filename,
                            domain,
                            last_modified,
                            sp_item_id,
                            1 - (embedding <=> %s::vector) as similarity
                        FROM document_chunks
                        WHERE domain = %s
                          AND last_modified > %s
                        ORDER BY embedding <=> %s::vector
                        LIMIT %s
                    """, (query_embedding.tolist(), domain, freshness_cutoff, query_embedding.tolist(), top_k))
                else:
                    cur.execute("""
                        SELECT 
                            chunk_text,
                            filename,
                            domain,
                            last_modified,
                            sp_item_id,
                            1 - (embedding <=> %s::vector) as similarity
                        FROM document_chunks
                        WHERE last_modified > %s
                        ORDER BY embedding <=> %s::vector
                        LIMIT %s
                    """, (query_embedding.tolist(), freshness_cutoff, query_embedding.tolist(), top_k))
                
                results = cur.fetchall()
                
                if results:
                    self.stats['vector_cache_hits'] += 1
                    logger.info(f"Vector cache HIT: Found {len(results)} chunks")
                else:
                    logger.info("Vector cache MISS: No fresh chunks found")
                
                return [dict(r) for r in results]
                
        except Exception as e:
            logger.error(f"Error in vector search: {e}")
            return []
    
    def _route_question_to_domains(self, question: str) -> List[str]:
        """Route question to domains using fine-tuned model or keyword fallback"""
        
        # Try fine-tuned routing model first
        if self.fine_tuned_routing_model and self.openai_client:
            try:
                response = self.openai_client.chat.completions.create(
                    model=self.fine_tuned_routing_model,
                    messages=[
                        {"role": "system", "content": "You are an insurance domain classifier. Return only the domain key(s)."},
                        {"role": "user", "content": question}
                    ],
                    temperature=0.1,
                    max_tokens=50
                )
                
                domains_text = response.choices[0].message.content.strip()
                matched_domains = [d.strip() for d in domains_text.split(',') if d.strip() in INSURANCE_DOMAINS]
                
                if matched_domains:
                    logger.info(f"Fine-tuned model routed to: {matched_domains}")
                    return matched_domains
                    
            except Exception as e:
                logger.warning(f"Fine-tuned routing failed, falling back to keywords: {e}")
        
        # Fallback to keyword-based routing
        question_lower = question.lower()
        
        domain_keywords = {
            "new_application": ["application", "acord", "new business", "apply"],
            "underwriting": ["underwriting", "risk", "medical", "approval"],
            "policy_issue": ["issue policy", "policy document", "issuance"],
            "policy_transactions": ["transaction", "policy change", "endorsement"],
            "product_configuration": ["product", "product specs", "product catalog"],
            "product_coverages": ["coverage", "benefit", "protection"],
            "product_riders": ["rider", "add-on", "optional benefit"],
            "funds": ["fund", "investment", "allocation"],
            "clients": ["client", "customer", "kyc", "aml"],
            "calculations": ["calculate", "formula", "premium", "cash value"]
        }
        
        matched_domains = []
        for domain, keywords in domain_keywords.items():
            if any(kw in question_lower for kw in keywords):
                matched_domains.append(domain)
        
        if not matched_domains:
            logger.info("No domain matched, searching all domains")
            matched_domains = list(INSURANCE_DOMAINS.keys())
        
        logger.info(f"Keyword routing routed to: {matched_domains}")
        return matched_domains
    
    def _generate_answer(self, question: str, context: str) -> str:
        """Generate answer using fine-tuned model or base model fallback"""
        if not self.openai_client:
            return "LLM not available for answer generation"
        
        # Choose model: fine-tuned or base
        model = self.fine_tuned_answer_model if self.fine_tuned_answer_model else GPT_MODEL_NAME
        
        try:
            prompt = f"""You are an insurance domain expert assistant. Answer the user's question based on the provided document context.

Context from SharePoint documents:
{context}

User Question: {question}

Instructions:
- Provide a clear, accurate answer based on the context
- If the context doesn't contain enough information, say so
- Cite specific documents when possible
- Use insurance domain terminology appropriately

Answer:"""
            
            response = self.openai_client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are an insurance domain expert assistant."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=1000
            )
            
            answer = response.choices[0].message.content
            logger.info(f"Generated answer using model: {model}")
            return answer
            
        except Exception as e:
            logger.error(f"Failed to generate answer: {e}")
            return f"Error generating answer: {str(e)}"
    
    def query(
        self,
        question: str,
        domain: Optional[str] = None,
        domains: Optional[List[str]] = None,
        top_k: int = 5,
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """Query SharePoint RAG with PostgreSQL cache and fine-tuned models"""
        self.stats['queries_processed'] += 1
        start_time = time.time()
        
        # Step 1: Check query cache
        if use_cache:
            cached_result = self._check_query_cache(question, domain)
            if cached_result:
                cached_result['query_time_ms'] = (time.time() - start_time) * 1000
                return cached_result
        
        # Step 2: Route to domains
        search_domains = []
        if domain:
            search_domains = [domain]
        elif domains:
            search_domains = domains
        else:
            search_domains = self._route_question_to_domains(question)
        
        # Step 3: Generate query embedding
        query_embedding = self._generate_embedding(question)
        if query_embedding is None:
            return {
                "answer": "Failed to generate query embedding",
                "sources": [],
                "error": "Embedding generation failed"
            }
        
        # Step 4: Search PostgreSQL vector cache
        all_results = []
        for search_domain in search_domains:
            domain_results = self._vector_search_postgres(query_embedding, search_domain, top_k)
            all_results.extend(domain_results)
        
        # Sort by similarity and take top results
        all_results.sort(key=lambda x: x.get('similarity', 0), reverse=True)
        top_results = all_results[:top_k * 2]
        
        if not top_results:
            return {
                "answer": "No cached documents found. Please trigger a sync first.",
                "sources": [],
                "domains_searched": search_domains,
                "cache_status": "miss"
            }
        
        # Step 5: Build context from cached chunks
        context = "\n\n---\n\n".join([
            f"Source: {r['filename']} ({INSURANCE_DOMAINS[r['domain']]['name']})\nSimilarity: {r['similarity']:.2f}\n{r['chunk_text']}"
            for r in top_results
        ])
        
        # Step 6: Generate answer
        model_used = self.fine_tuned_answer_model if self.fine_tuned_answer_model else GPT_MODEL_NAME
        answer = self._generate_answer(question, context)
        
        # Step 7: Build sources list
        sources = [
            {
                "filename": r["filename"],
                "domain": INSURANCE_DOMAINS[r["domain"]]["name"],
                "last_modified": r["last_modified"].isoformat() if hasattr(r["last_modified"], "isoformat") else str(r["last_modified"]),
                "sp_item_id": r["sp_item_id"],
                "similarity": float(r["similarity"])
            }
            for r in top_results
        ]
        
        query_time_ms = (time.time() - start_time) * 1000
        
        return {
            "answer": answer,
            "sources": sources,
            "domains_searched": search_domains,
            "chunks_retrieved": len(top_results),
            "model_used": model_used,
            "cache_status": "hit_vector" if top_results else "miss",
            "query_time_ms": query_time_ms
        }
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        return {
            **self.stats,
            'cache_hit_rate': (self.stats['query_cache_hits'] + self.stats['vector_cache_hits']) / max(self.stats['queries_processed'], 1)
        }
    
    def close(self):
        """Close PostgreSQL connection"""
        if self.pg_conn:
            self.pg_conn.close()
            logger.info("PostgreSQL connection closed")


if __name__ == "__main__":
    sp_rag = SharePointRAGPostgres()
    result = sp_rag.query("What are the ACORD application requirements?")
    print(f"Answer: {result['answer']}\n")
    print(f"Cache status: {result.get('cache_status', 'N/A')}")
    print(f"Query time: {result.get('query_time_ms', 0):.0f}ms")
    sp_rag.close()
