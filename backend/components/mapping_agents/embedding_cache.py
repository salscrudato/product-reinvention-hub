"""Unified embedding cache manager with SHA256 hashing for cost optimization.

Reuses SnowChat's existing embedding_cache.json infrastructure with enhanced
features for aggressive caching and batch retrieval optimization.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Callable, Dict, List, Optional

logger = logging.getLogger("agentic_orchestrator_auto.mapping.embedding_cache")


class EmbeddingCacheManager:
    """
    Unified embedding cache with SHA256 key generation.
    Minimizes LLM embedding API calls by caching all generated embeddings.
    
    Compatible with SnowChat's existing embedding_cache.json format.
    """
    
    def __init__(self, cache_file: Optional[Path] = None):
        """Initialize cache manager.
        
        Args:
            cache_file: Path to cache JSON file. Defaults to embedding_cache.json
        """
        if cache_file is None:
            # Default to SnowChat's existing cache location
            cache_file = Path(__file__).parents[2] / "embedding_cache.json"
        
        self.cache_file = cache_file
        self.cache: Dict[str, List[float]] = self._load_cache()
        self.hit_count = 0
        self.miss_count = 0
    
    def _load_cache(self) -> Dict[str, List[float]]:
        """Load existing cache from disk."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                # Handle both flat and nested cache formats
                if isinstance(data, dict):
                    # Try to extract embeddings sub-dict if it exists
                    if 'embeddings' in data:
                        cache = data['embeddings']
                    else:
                        cache = data
                    
                    logger.info(
                        "[EmbeddingCache] Loaded cache | file=%s entries=%s",
                        self.cache_file.name,
                        len(cache)
                    )
                    return cache
            except Exception as exc:
                logger.warning(
                    "[EmbeddingCache] Failed to load cache | file=%s error=%s",
                    self.cache_file.name,
                    exc,
                    exc_info=True
                )
        
        logger.info("[EmbeddingCache] Initialized empty cache | file=%s", self.cache_file.name)
        return {}
    
    def _save_cache(self):
        """Persist cache to disk."""
        try:
            # Ensure parent directory exists
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(self.cache_file, 'w', encoding='utf-8') as f:
                json.dump(self.cache, f, indent=2)
            
            logger.debug(
                "[EmbeddingCache] Saved cache | file=%s entries=%s",
                self.cache_file.name,
                len(self.cache)
            )
        except Exception as exc:
            logger.error(
                "[EmbeddingCache] Failed to save cache | file=%s error=%s",
                self.cache_file.name,
                exc,
                exc_info=True
            )
    
    @staticmethod
    def _hash_text(text: str) -> str:
        """Generate cache key from text using SHA256.
        
        Args:
            text: Input text to hash
            
        Returns:
            First 16 characters of SHA256 hex digest
        """
        return hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]
    
    def get_embedding(self, text: str) -> Optional[List[float]]:
        """Retrieve cached embedding if exists.
        
        Args:
            text: Input text
            
        Returns:
            Embedding vector if cached, None otherwise
        """
        key = self._hash_text(text)
        embedding = self.cache.get(key)
        
        if embedding is not None:
            self.hit_count += 1
            logger.debug("[EmbeddingCache] Cache hit | key=%s", key)
        else:
            self.miss_count += 1
            logger.debug("[EmbeddingCache] Cache miss | key=%s", key)
        
        return embedding
    
    def cache_embedding(self, text: str, embedding: List[float]):
        """Store embedding in cache.
        
        Args:
            text: Input text (used to generate key)
            embedding: Embedding vector to cache
        """
        key = self._hash_text(text)
        self.cache[key] = embedding
        
        # Periodic save to avoid data loss
        if len(self.cache) % 100 == 0:
            self._save_cache()
    
    def batch_get_or_generate(
        self, 
        texts: List[str], 
        generator_func: Callable[[List[str]], List[List[float]]]
    ) -> List[List[float]]:
        """Efficient batch retrieval with cache fallback.
        
        Only calls LLM for texts not in cache, significantly reducing costs.
        
        Args:
            texts: List of input texts
            generator_func: Function to generate embeddings for uncached texts.
                           Should accept List[str] and return List[List[float]].
                           
        Returns:
            List of embedding vectors matching input texts order
        """
        results: List[Optional[List[float]]] = []
        uncached_texts: List[str] = []
        uncached_indices: List[int] = []
        
        # Check cache first
        for idx, text in enumerate(texts):
            cached = self.get_embedding(text)
            if cached is not None:
                results.append(cached)
            else:
                results.append(None)  # Placeholder
                uncached_texts.append(text)
                uncached_indices.append(idx)
        
        # Calculate cache hit rate
        hit_rate = (self.hit_count / (self.hit_count + self.miss_count) * 100) if (self.hit_count + self.miss_count) > 0 else 0
        
        # Generate missing embeddings in batch
        if uncached_texts:
            logger.info(
                "[EmbeddingCache] Batch retrieval | total=%s cached=%s generate=%s hit_rate=%.1f%%",
                len(texts),
                len(texts) - len(uncached_texts),
                len(uncached_texts),
                hit_rate
            )
            
            try:
                new_embeddings = generator_func(uncached_texts)
                
                # Validate response
                if len(new_embeddings) != len(uncached_texts):
                    raise ValueError(
                        f"Generator returned {len(new_embeddings)} embeddings "
                        f"but {len(uncached_texts)} were requested"
                    )
                
                # Insert into results and cache
                for i, embedding in enumerate(new_embeddings):
                    idx = uncached_indices[i]
                    results[idx] = embedding
                    self.cache_embedding(uncached_texts[i], embedding)
                
                # Save cache after batch generation
                self._save_cache()
                
            except Exception as exc:
                logger.error(
                    "[EmbeddingCache] Batch generation failed | uncached=%s error=%s",
                    len(uncached_texts),
                    exc,
                    exc_info=True
                )
                raise
        else:
            logger.info(
                "[EmbeddingCache] 100%% cache hit | total=%s",
                len(texts)
            )
        
        # Type check: ensure all results are populated
        final_results: List[List[float]] = []
        for i, result in enumerate(results):
            if result is None:
                raise RuntimeError(f"Failed to retrieve or generate embedding for text at index {i}")
            final_results.append(result)
        
        return final_results
    
    def get_stats(self) -> Dict[str, int]:
        """Get cache statistics.
        
        Returns:
            Dict with cache_size, hit_count, miss_count, hit_rate
        """
        total = self.hit_count + self.miss_count
        hit_rate = int((self.hit_count / total * 100)) if total > 0 else 0
        
        return {
            'cache_size': len(self.cache),
            'hit_count': self.hit_count,
            'miss_count': self.miss_count,
            'hit_rate_percent': hit_rate
        }
    
    def clear_stats(self):
        """Reset hit/miss counters."""
        self.hit_count = 0
        self.miss_count = 0
    
    def force_save(self):
        """Force immediate cache save to disk."""
        self._save_cache()


# Global cache instance for module-level access
_global_cache: Optional[EmbeddingCacheManager] = None


def get_global_cache() -> EmbeddingCacheManager:
    """Get or create global cache instance.
    
    Returns:
        Singleton EmbeddingCacheManager instance
    """
    global _global_cache
    if _global_cache is None:
        _global_cache = EmbeddingCacheManager()
    return _global_cache


__all__ = ['EmbeddingCacheManager', 'get_global_cache']
