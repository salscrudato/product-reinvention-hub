"""
Mapping Vectorizer - FAISS-based similarity search for historical mappings
Generates embeddings for word placeholders and JSON paths to enable intelligent suggestions.
"""

import logging
import os
import json
import hashlib
from typing import List, Dict, Optional, Tuple, Any
from pathlib import Path

import numpy as np

from .servicenowgenaitool import generate_embeddings
from .mapping_knowledge_base import get_knowledge_base

logger = logging.getLogger("mapping_vectorizer")

# FAISS index paths
MAPPING_FAISS_INDEX_PATH = os.getenv(
    "MAPPING_FAISS_INDEX_PATH",
    "mapping_embeddings.index"
)
MAPPING_CACHE_PATH = os.getenv(
    "MAPPING_CACHE_PATH",
    "mapping_embedding_cache.json"
)

class MappingVectorizer:
    """
    Vectorizes historical mappings for similarity search.
    Uses Azure OpenAI embeddings + FAISS for efficient retrieval.
    """
    
    def __init__(self):
        self.kb = get_knowledge_base()
        self.faiss_index = None
        self.embedding_cache = self._load_cache()
        self.index_metadata = []  # Maps FAISS index positions to mapping IDs
        
        # Try to load existing FAISS index
        self._load_faiss_index()
        
        logger.info("[Vectorizer] Initialized MappingVectorizer")
    
    def _load_cache(self) -> Dict[str, List[float]]:
        """Load embedding cache from disk."""
        if os.path.exists(MAPPING_CACHE_PATH):
            try:
                with open(MAPPING_CACHE_PATH, "r", encoding="utf-8") as f:
                    cache = json.load(f)
                    logger.info("[Vectorizer] Loaded cache | entries=%d", len(cache))
                    return cache
            except Exception as e:
                logger.warning("[Vectorizer] Failed to load cache: %s", e)
        return {}
    
    def _save_cache(self):
        """Save embedding cache to disk."""
        try:
            with open(MAPPING_CACHE_PATH, "w", encoding="utf-8") as f:
                json.dump(self.embedding_cache, f)
            logger.info("[Vectorizer] Saved cache | entries=%d", len(self.embedding_cache))
        except Exception as e:
            logger.error("[Vectorizer] Failed to save cache: %s", e)
    
    def _load_faiss_index(self):
        """Load FAISS index from disk."""
        if os.path.exists(MAPPING_FAISS_INDEX_PATH):
            try:
                import faiss
                self.faiss_index = faiss.read_index(MAPPING_FAISS_INDEX_PATH)
                
                # Load metadata
                metadata_path = MAPPING_FAISS_INDEX_PATH + ".metadata.json"
                if os.path.exists(metadata_path):
                    with open(metadata_path, "r", encoding="utf-8") as f:
                        self.index_metadata = json.load(f)
                
                logger.info(
                    "[Vectorizer] Loaded FAISS index | vectors=%d | metadata=%d",
                    self.faiss_index.ntotal,
                    len(self.index_metadata)
                )
            except Exception as e:
                logger.warning("[Vectorizer] Failed to load FAISS index: %s", e)
                self.faiss_index = None
                self.index_metadata = []
    
    def _save_faiss_index(self):
        """Save FAISS index to disk."""
        if self.faiss_index is None:
            return
        
        try:
            import faiss
            faiss.write_index(self.faiss_index, MAPPING_FAISS_INDEX_PATH)
            
            # Save metadata
            metadata_path = MAPPING_FAISS_INDEX_PATH + ".metadata.json"
            with open(metadata_path, "w", encoding="utf-8") as f:
                json.dump(self.index_metadata, f)
            
            logger.info(
                "[Vectorizer] Saved FAISS index | vectors=%d",
                self.faiss_index.ntotal
            )
        except Exception as e:
            logger.error("[Vectorizer] Failed to save FAISS index: %s", e)
    
    def _get_cache_key(self, text: str) -> str:
        """Generate cache key for text."""
        return hashlib.md5(text.encode("utf-8")).hexdigest()
    
    def _get_embedding(self, text: str) -> Optional[List[float]]:
        """
        Get embedding for text with caching.
        
        Args:
            text: Text to embed
        
        Returns:
            Embedding vector (1536 dimensions for text-embedding-ada-002)
        """
        cache_key = self._get_cache_key(text)
        
        # Check cache first
        if cache_key in self.embedding_cache:
            return self.embedding_cache[cache_key]
        
        # Generate new embedding
        try:
            embeddings = generate_embeddings([text])
            if embeddings and len(embeddings) > 0:
                embedding = embeddings[0]
                self.embedding_cache[cache_key] = embedding
                return embedding
        except Exception as e:
            logger.error("[Vectorizer] Failed to generate embedding: %s", e)
        
        return None
    
    def vectorize_product(self, product_id: str) -> Dict[str, Any]:
        """
        Vectorize all mappings for a product and add to FAISS index.
        
        Args:
            product_id: Product ID to vectorize
        
        Returns:
            Dictionary with vectorization stats
        """
        import faiss
        
        logger.info("[Vectorizer] Starting vectorization | product=%s", product_id)
        
        # Get product mappings
        mappings = self.kb.get_product_mappings(product_id)
        if not mappings:
            logger.warning("[Vectorizer] No mappings found | product=%s", product_id)
            return {
                "productId": product_id,
                "vectorizedCount": 0,
                "skippedCount": 0,
            }
        
        # Create FAISS index if needed
        if self.faiss_index is None:
            dimension = 1536  # text-embedding-ada-002 dimension
            self.faiss_index = faiss.IndexFlatL2(dimension)
            logger.info("[Vectorizer] Created new FAISS index | dimension=%d", dimension)
        
        vectorized_count = 0
        skipped_count = 0
        
        for mapping in mappings:
            mapping_id = mapping.get("id")
            placeholder = mapping.get("wordPlaceholder", "")
            json_path = mapping.get("jsonPath", "")
            
            # Skip if already in index
            if any(m.get("mappingId") == mapping_id for m in self.index_metadata):
                skipped_count += 1
                continue
            
            # Generate embedding for combined text (placeholder + JSON path)
            combined_text = f"{placeholder} {json_path}"
            embedding = self._get_embedding(combined_text)
            
            if embedding is None:
                logger.warning(
                    "[Vectorizer] Failed to embed | mapping=%s | text=%s",
                    mapping_id,
                    combined_text
                )
                skipped_count += 1
                continue
            
            # Add to FAISS index
            embedding_np = np.array([embedding], dtype=np.float32)
            self.faiss_index.add(embedding_np)
            
            # Store metadata
            self.index_metadata.append({
                "mappingId": mapping_id,
                "productId": product_id,
                "wordPlaceholder": placeholder,
                "jsonPath": json_path,
                "swaggerOperation": mapping.get("swaggerOperation", ""),
                "dataType": mapping.get("dataType", "string"),
            })
            
            vectorized_count += 1
        
        # Save updated index and cache
        self._save_faiss_index()
        self._save_cache()
        
        # Mark product as vectorized
        self.kb.update_product(product_id, {"vectorized": True})
        
        logger.info(
            "[Vectorizer] Completed vectorization | product=%s | vectorized=%d | skipped=%d",
            product_id,
            vectorized_count,
            skipped_count,
        )
        
        return {
            "productId": product_id,
            "vectorizedCount": vectorized_count,
            "skippedCount": skipped_count,
        }
    
    def find_similar_mappings(
        self,
        query_placeholder: str,
        top_k: int = 5,
        product_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Find similar historical mappings for a given placeholder.
        
        Args:
            query_placeholder: Word placeholder to search for
            top_k: Number of results to return
            product_type: Optional filter by product type
        
        Returns:
            List of similar mappings with similarity scores
        """
        if self.faiss_index is None or self.faiss_index.ntotal == 0:
            logger.warning("[Vectorizer] No FAISS index available")
            return []
        
        # Generate embedding for query
        embedding = self._get_embedding(query_placeholder)
        if embedding is None:
            logger.error("[Vectorizer] Failed to embed query | query=%s", query_placeholder)
            return []
        
        # Search FAISS index
        embedding_np = np.array([embedding], dtype=np.float32)
        distances, indices = self.faiss_index.search(embedding_np, top_k)
        
        # Build results with metadata
        results = []
        for distance, idx in zip(distances[0], indices[0]):
            if idx < 0 or idx >= len(self.index_metadata):
                continue
            
            metadata = self.index_metadata[idx]
            
            # Apply product type filter
            if product_type:
                product = self.kb.get_product(metadata["productId"])
                if not product or product.get("productType") != product_type:
                    continue
            
            # Get full mapping details
            mapping = self.kb.get_mapping(metadata["mappingId"])
            if mapping:
                product = self.kb.get_product(mapping["productId"])
                results.append({
                    **mapping,
                    "similarityScore": float(1.0 / (1.0 + distance)),  # Convert distance to similarity
                    "product": {
                        "name": product.get("productName") if product else "Unknown",
                        "type": product.get("productType") if product else "Unknown",
                    }
                })
        
        logger.info(
            "[Vectorizer] Found similar mappings | query=%s | results=%d",
            query_placeholder,
            len(results)
        )
        
        return results
    
    def suggest_mappings_for_placeholders(
        self,
        placeholders: List[str],
        product_type: Optional[str] = None,
        confidence_threshold: float = 0.7,
    ) -> List[Dict[str, Any]]:
        """
        Suggest mappings for multiple placeholders based on historical data.
        
        Args:
            placeholders: List of word placeholders
            product_type: Optional product type filter
            confidence_threshold: Minimum similarity score (0.0-1.0)
        
        Returns:
            List of suggestions with confidence scores
        """
        suggestions = []
        
        for placeholder in placeholders:
            similar = self.find_similar_mappings(
                query_placeholder=placeholder,
                top_k=3,
                product_type=product_type,
            )
            
            if similar:
                # Take the best match
                best_match = similar[0]
                similarity_score = best_match.get("similarityScore", 0.0)
                
                if similarity_score >= confidence_threshold:
                    suggestions.append({
                        "wordPlaceholder": placeholder,
                        "suggestedJsonPath": best_match.get("jsonPath"),
                        "suggestedOperation": best_match.get("swaggerOperation"),
                        "suggestedDataType": best_match.get("dataType"),
                        "confidenceScore": similarity_score,
                        "sourceProduct": best_match.get("product", {}).get("name"),
                        "sourceMapping": best_match.get("wordPlaceholder"),
                        "alternativeMatches": [
                            {
                                "jsonPath": m.get("jsonPath"),
                                "score": m.get("similarityScore"),
                                "sourceProduct": m.get("product", {}).get("name"),
                            }
                            for m in similar[1:3]
                        ]
                    })
        
        logger.info(
            "[Vectorizer] Generated suggestions | input=%d | suggestions=%d | threshold=%.2f",
            len(placeholders),
            len(suggestions),
            confidence_threshold,
        )
        
        return suggestions
    
    def rebuild_index(self) -> Dict[str, Any]:
        """
        Rebuild the entire FAISS index from all vectorized products.
        Useful after bulk imports or data corruption.
        
        Returns:
            Rebuild statistics
        """
        import faiss
        
        logger.info("[Vectorizer] Rebuilding FAISS index")
        
        # Clear existing index
        dimension = 1536
        self.faiss_index = faiss.IndexFlatL2(dimension)
        self.index_metadata = []
        
        # Get all products
        products = self.kb.get_all_products()
        
        total_vectorized = 0
        total_skipped = 0
        
        for product in products:
            # Reset vectorized flag
            self.kb.update_product(product["id"], {"vectorized": False})
            
            # Vectorize product
            result = self.vectorize_product(product["id"])
            total_vectorized += result["vectorizedCount"]
            total_skipped += result["skippedCount"]
        
        logger.info(
            "[Vectorizer] Rebuild complete | products=%d | vectorized=%d | skipped=%d",
            len(products),
            total_vectorized,
            total_skipped,
        )
        
        return {
            "totalProducts": len(products),
            "totalVectorized": total_vectorized,
            "totalSkipped": total_skipped,
            "indexSize": self.faiss_index.ntotal if self.faiss_index else 0,
        }
    
    def get_status(self) -> Dict[str, Any]:
        """
        Get vectorization status.
        
        Returns:
            Status information
        """
        kb_stats = self.kb.get_statistics()
        
        return {
            "totalProducts": kb_stats["totalProducts"],
            "vectorizedProducts": kb_stats["vectorizedProducts"],
            "totalMappings": kb_stats["totalMappings"],
            "indexedVectors": self.faiss_index.ntotal if self.faiss_index else 0,
            "cacheSize": len(self.embedding_cache),
            "cacheSizeBytes": os.path.getsize(MAPPING_CACHE_PATH) if os.path.exists(MAPPING_CACHE_PATH) else 0,
            "indexSizeBytes": os.path.getsize(MAPPING_FAISS_INDEX_PATH) if os.path.exists(MAPPING_FAISS_INDEX_PATH) else 0,
        }


# Singleton instance
_vectorizer_instance: Optional[MappingVectorizer] = None

def get_vectorizer() -> MappingVectorizer:
    """Get or create singleton vectorizer instance."""
    global _vectorizer_instance
    if _vectorizer_instance is None:
        _vectorizer_instance = MappingVectorizer()
    return _vectorizer_instance
