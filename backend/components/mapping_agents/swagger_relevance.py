"""Swagger API relevance ranking engine for intelligent pre-filtering.

Ranks API operations by semantic relevance to Word template fields,
enabling automatic filtering of irrelevant APIs before mapping.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from .embedding_cache import get_global_cache
from .logging_utils import log_method_end, log_method_start
from .parsers import SwaggerOperationDescriptor, SwaggerSummary, WordSummary

logger = logging.getLogger("agentic_orchestrator_auto.mapping.swagger_relevance")


class SwaggerRelevanceEngine:
    """
    Pre-filter and rank APIs by semantic relevance to Word template.
    
    Reduces manual API selection burden by automatically identifying
    which APIs are most likely to contain mappable fields.
    """
    
    def __init__(
        self,
        swagger_summary: SwaggerSummary,
        word_summary: WordSummary,
        embedding_generator: Optional[Callable[[List[str]], List[List[float]]]] = None
    ):
        """Initialize relevance engine.
        
        Args:
            swagger_summary: Parsed Swagger specification
            word_summary: Parsed Word template
            embedding_generator: Function to generate embeddings (uses cache internally)
        """
        self.swagger_summary = swagger_summary
        self.word_summary = word_summary
        self.embedding_generator = embedding_generator
        
        # Extract target fields from Word template
        self.target_fields = [
            f.placeholder for f in word_summary.fields if f.placeholder
        ]
        self.target_descriptions = [
            self._build_target_context(f)
            for f in word_summary.fields if f.placeholder
        ]
    
    def _build_target_context(self, field) -> str:
        """Build rich context string for Word template field."""
        parts = [field.placeholder]
        
        if hasattr(field, 'label') and field.label:
            parts.append(field.label)
        
        if hasattr(field, 'description') and field.description:
            parts.append(field.description)
        
        if hasattr(field, 'classification') and field.classification:
            parts.append(field.classification)
        
        return ' '.join(parts)
    
    def rank_apis_by_relevance(
        self,
        top_k: int = 15,
        confidence_threshold: float = 0.3
    ) -> List[Dict[str, Any]]:
        """
        Rank all API operations by semantic relevance to Word template.
        
        Returns only top-K relevant APIs above confidence threshold,
        drastically reducing the number of APIs users need to review.
        
        Args:
            top_k: Maximum number of APIs to return
            confidence_threshold: Minimum relevance score (0-1)
            
        Returns:
            List of dicts with operation, relevance_score, best_match_field, etc.
        """
        log_method_start(
            logger,
            "SwaggerRelevanceEngine.rank_apis_by_relevance",
            "Ranking APIs by semantic similarity to Word template",
            total_apis=len(self.swagger_summary.operations),
            word_fields=len(self.target_fields),
            top_k=top_k
        )
        
        if not self.target_fields:
            logger.warning("[SwaggerRelevance] No target fields in Word template")
            return []
        
        if not self.swagger_summary.operations:
            logger.warning("[SwaggerRelevance] No operations in Swagger spec")
            return []
        
        if self.embedding_generator is None:
            logger.error("[SwaggerRelevance] No embedding generator provided")
            raise ValueError("Embedding generator required for relevance ranking")
        
        # Generate embeddings for Word template fields (with caching)
        cache = get_global_cache()
        target_embeddings = cache.batch_get_or_generate(
            self.target_descriptions,
            self.embedding_generator
        )
        
        # Build rich context for each API operation
        api_contexts = []
        for op in self.swagger_summary.operations:
            context = self._build_api_context(op)
            api_contexts.append({
                'operation': op,
                'context_text': context
            })
        
        # Generate embeddings for API contexts (with caching)
        api_texts = [ctx['context_text'] for ctx in api_contexts]
        api_embeddings = cache.batch_get_or_generate(
            api_texts,
            self.embedding_generator
        )
        
        # Calculate relevance: max similarity across all Word fields
        api_scores = []
        for idx, api_ctx in enumerate(api_contexts):
            # Get max similarity between this API and ANY Word field
            similarities = cosine_similarity(
                [api_embeddings[idx]],
                target_embeddings
            )[0]
            
            max_score = float(np.max(similarities))
            matched_field_idx = int(np.argmax(similarities))
            
            # Calculate coverage: how many Word fields could this API map to?
            relevant_fields = np.where(similarities > confidence_threshold)[0]
            
            api_scores.append({
                'operation': api_ctx['operation'],
                'relevance_score': max_score,
                'best_match_field': self.target_fields[matched_field_idx],
                'potential_mappings': len(relevant_fields),
                'relevant_field_indices': relevant_fields.tolist(),
                'context': api_ctx['context_text']
            })
        
        # Sort by relevance score (descending)
        api_scores.sort(key=lambda x: x['relevance_score'], reverse=True)
        
        # Filter by threshold
        filtered = [
            api for api in api_scores
            if api['relevance_score'] >= confidence_threshold
        ]
        
        # Return top-K
        result = filtered[:top_k]
        
        logger.info(
            "[SwaggerRelevance] Ranking complete | total_apis=%s relevant=%s returned=%s "
            "threshold=%.2f top_score=%.2f",
            len(self.swagger_summary.operations),
            len(filtered),
            len(result),
            confidence_threshold,
            result[0]['relevance_score'] if result else 0.0
        )
        
        log_method_end(
            logger,
            "SwaggerRelevanceEngine.rank_apis_by_relevance",
            "success",
            ranked_apis=len(result),
            filtered_out=len(self.swagger_summary.operations) - len(filtered)
        )
        
        return result
    
    def _build_api_context(self, operation: SwaggerOperationDescriptor) -> str:
        """Build semantic context string for an API operation.
        
        Includes endpoint, method, summary, description, tags, and sample field names.
        """
        parts = [
            f"API: {operation.method} {operation.endpoint}",
        ]
        
        if operation.summary:
            parts.append(f"Purpose: {operation.summary}")
        
        if operation.description:
            parts.append(f"Description: {operation.description}")
        
        if operation.tags:
            parts.append(f"Tags: {', '.join(operation.tags)}")
        
        # Include input field names and descriptions (top 10 for brevity)
        if operation.input_attributes:
            input_samples = []
            for attr in operation.input_attributes[:10]:
                if attr.description:
                    input_samples.append(f"{attr.name} ({attr.description})")
                else:
                    input_samples.append(attr.name)
            parts.append(f"Input fields: {', '.join(input_samples)}")
        
        # Include output field names (top 10)
        if operation.output_attributes:
            output_samples = []
            for attr in operation.output_attributes[:10]:
                if attr.description:
                    output_samples.append(f"{attr.name} ({attr.description})")
                else:
                    output_samples.append(attr.name)
            parts.append(f"Output fields: {', '.join(output_samples)}")
        
        return " | ".join(parts)
    
    def get_unmapped_fields(
        self,
        existing_mappings: List[Dict[str, Any]]
    ) -> List[str]:
        """Return Word fields that haven't been mapped yet.
        
        Args:
            existing_mappings: List of mapping dicts with 'target_field' keys
            
        Returns:
            List of unmapped target field names
        """
        mapped_targets = {m['target_field'] for m in existing_mappings}
        return [f for f in self.target_fields if f not in mapped_targets]


__all__ = ['SwaggerRelevanceEngine']
