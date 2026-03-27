"""Progressive mapping orchestrator with checkpoint-based resumable workflows.

Manages iterative mapping across multiple APIs with context carryover,
enabling efficient batch processing and resume-after-failure capabilities.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .logging_utils import log_method_end, log_method_start
from .parsers import SwaggerOperationDescriptor
from .state import MappingState

logger = logging.getLogger("agentic_orchestrator_auto.mapping.progressive")


class ProgressiveMappingOrchestrator:
    """
    Manage iterative mapping across multiple APIs with context carryover.
    
    Features:
    - Checkpoint-based state persistence (resume after interruptions)
    - Progressive context building (each batch learns from previous)
    - Skip already-processed APIs
    - Track cost metrics across batches
    """
    
    def __init__(
        self,
        session_id: str,
        state: MappingState,
        checkpoint_dir: Optional[Path] = None
    ):
        """Initialize progressive orchestrator.
        
        Args:
            session_id: Unique identifier for this mapping session
            state: MappingState with source/target summaries
            checkpoint_dir: Directory for checkpoint files (defaults to cache/mapping_checkpoints)
        """
        self.session_id = session_id
        self.state = state
        
        if checkpoint_dir is None:
            checkpoint_dir = Path(__file__).parents[2] / "cache" / "mapping_checkpoints"
        
        self.checkpoint_dir = checkpoint_dir
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        self.checkpoint_file = self.checkpoint_dir / f"{session_id}.json"
        
        # Load or initialize checkpoint
        self.checkpoint = self._load_checkpoint()
        
        # Runtime state
        self.completed_mappings: List[Dict[str, Any]] = self.checkpoint['completed_mappings']
        self.processed_apis: List[str] = self.checkpoint['processed_apis']
    
    def _load_checkpoint(self) -> Dict[str, Any]:
        """Load checkpoint from disk or initialize new."""
        if self.checkpoint_file.exists():
            try:
                with open(self.checkpoint_file, 'r', encoding='utf-8') as f:
                    checkpoint = json.load(f)
                
                logger.info(
                    "[ProgressiveMapping] Loaded checkpoint | session=%s "
                    "completed_mappings=%s processed_apis=%s",
                    self.session_id,
                    len(checkpoint.get('completed_mappings', [])),
                    len(checkpoint.get('processed_apis', []))
                )
                
                return checkpoint
            except Exception as exc:
                logger.warning(
                    "[ProgressiveMapping] Failed to load checkpoint | session=%s error=%s",
                    self.session_id,
                    exc,
                    exc_info=True
                )
        
        # Initialize new checkpoint
        logger.info("[ProgressiveMapping] Initialized new checkpoint | session=%s", self.session_id)
        return {
            'session_id': self.session_id,
            'created_at': time.time(),
            'completed_mappings': [],
            'processed_apis': [],
            'embedding_cache_hits': 0,
            'llm_calls_made': 0,
            'cost_metrics': {
                'tier1_matches': 0,
                'tier2_matches': 0,
                'tier3_matches': 0
            }
        }
    
    def _save_checkpoint(self):
        """Persist checkpoint to disk."""
        try:
            self.checkpoint['completed_mappings'] = self.completed_mappings
            self.checkpoint['processed_apis'] = self.processed_apis
            self.checkpoint['updated_at'] = time.time()
            
            with open(self.checkpoint_file, 'w', encoding='utf-8') as f:
                json.dump(self.checkpoint, f, indent=2)
            
            logger.debug(
                "[ProgressiveMapping] Saved checkpoint | session=%s mappings=%s apis=%s",
                self.session_id,
                len(self.completed_mappings),
                len(self.processed_apis)
            )
        except Exception as exc:
            logger.error(
                "[ProgressiveMapping] Failed to save checkpoint | session=%s error=%s",
                self.session_id,
                exc,
                exc_info=True
            )
    
    def map_next_batch(
        self,
        ranked_apis: List[Dict[str, Any]],
        mapping_function: Callable[[SwaggerOperationDescriptor, List[str], List[Dict]], List[Dict]],
        batch_size: int = 3
    ) -> Dict[str, Any]:
        """
        Map next batch of APIs progressively.
        
        Args:
            ranked_apis: List of dicts with 'operation' and relevance scores
            mapping_function: Function to map operation to targets
                             Signature: (operation, unmapped_targets, history) -> mappings
            batch_size: Number of APIs to process in this batch
            
        Returns:
            Dict with status, batch_mappings, progress, next_apis
        """
        log_method_start(
            logger,
            "ProgressiveMappingOrchestrator.map_next_batch",
            "Processing next batch of APIs",
            batch_size=batch_size,
            processed_so_far=len(self.processed_apis)
        )
        
        # Get unmapped targets
        unmapped_targets = self._get_unmapped_targets()
        
        if not unmapped_targets:
            logger.info("[ProgressiveMapping] All targets mapped, session complete")
            return {
                'status': 'complete',
                'message': 'All Word template fields mapped',
                'total_mappings': len(self.completed_mappings),
                'progress': self._build_progress_summary(ranked_apis)
            }
        
        # Select next batch of APIs to process (skip already processed)
        remaining_apis = [
            api for api in ranked_apis
            if api['operation'].operation_id not in self.processed_apis
        ]
        
        if not remaining_apis:
            unmapped_count = len(unmapped_targets)
            logger.info(
                "[ProgressiveMapping] No more APIs to process | unmapped_fields=%s",
                unmapped_count
            )
            return {
                'status': 'complete',
                'message': f'{unmapped_count} fields remain unmapped (no more relevant APIs)',
                'unmapped_fields': unmapped_targets,
                'total_mappings': len(self.completed_mappings),
                'progress': self._build_progress_summary(ranked_apis)
            }
        
        # Process current batch
        current_batch = remaining_apis[:batch_size]
        new_mappings = []
        
        for api_rank in current_batch:
            operation = api_rank['operation']
            
            logger.info(
                "[ProgressiveMapping] Processing API | operation=%s endpoint=%s relevance=%.2f",
                operation.operation_id,
                operation.endpoint,
                api_rank['relevance_score']
            )
            
            # Map operation to unmapped targets with historical context
            batch_mappings = mapping_function(
                operation,
                self._get_unmapped_targets(),  # Refresh unmapped list
                self.completed_mappings  # Pass history as context
            )
            
            # Add operation metadata to mappings
            for mapping in batch_mappings:
                mapping['api_endpoint'] = operation.endpoint
                mapping['api_method'] = operation.method
                mapping['api_operation_id'] = operation.operation_id
            
            new_mappings.extend(batch_mappings)
            self.completed_mappings.extend(batch_mappings)
            self.processed_apis.append(operation.operation_id)
            
            # Update cost metrics if available
            if 'tier' in batch_mappings[0] if batch_mappings else {}:
                for mapping in batch_mappings:
                    tier = mapping.get('tier', 3)
                    if tier == 1:
                        self.checkpoint['cost_metrics']['tier1_matches'] += 1
                    elif tier == 2:
                        self.checkpoint['cost_metrics']['tier2_matches'] += 1
                    else:
                        self.checkpoint['cost_metrics']['tier3_matches'] += 1
            
            # Save checkpoint after each API
            self._save_checkpoint()
        
        # Build response
        progress = self._build_progress_summary(ranked_apis)
        
        # Preview next APIs
        next_batch_preview = remaining_apis[batch_size:batch_size+3]
        next_apis = [
            {
                'operation_id': api['operation'].operation_id,
                'endpoint': api['operation'].endpoint,
                'method': api['operation'].method,
                'relevance_score': api['relevance_score'],
                'potential_mappings': api['potential_mappings']
            }
            for api in next_batch_preview
        ]
        
        log_method_end(
            logger,
            "ProgressiveMappingOrchestrator.map_next_batch",
            "success",
            new_mappings=len(new_mappings),
            total_mappings=len(self.completed_mappings),
            remaining_targets=progress['remaining_fields']
        )
        
        return {
            'status': 'in_progress',
            'batch_mappings': new_mappings,
            'progress': progress,
            'next_apis': next_apis,
            'cost_metrics': self.checkpoint['cost_metrics']
        }
    
    def _get_unmapped_targets(self) -> List[str]:
        """Get Word fields not yet mapped."""
        mapped = {m['target_field'] for m in self.completed_mappings if m.get('source_field')}
        
        all_targets = []
        if hasattr(self.state, 'word_summary') and self.state.word_summary:
            all_targets = [
                f.placeholder
                for f in self.state.word_summary.fields
                if f.placeholder
            ]
        elif hasattr(self.state, 'target_fields'):
            all_targets = [
                t.get('heading', '')
                for t in self.state.target_fields
                if t.get('heading')
            ]
        
        return [t for t in all_targets if t not in mapped]
    
    def _build_progress_summary(self, ranked_apis: List[Dict[str, Any]]) -> Dict[str, int]:
        """Build progress summary dict."""
        unmapped = self._get_unmapped_targets()
        
        return {
            'total_apis': len(ranked_apis),
            'processed_apis': len(self.processed_apis),
            'remaining_apis': len(ranked_apis) - len(self.processed_apis),
            'mapped_fields': len(self.completed_mappings),
            'remaining_fields': len(unmapped),
            'completion_percent': int(
                (len(self.processed_apis) / len(ranked_apis) * 100)
                if ranked_apis else 100
            )
        }
    
    def get_all_mappings(self) -> List[Dict[str, Any]]:
        """Get all completed mappings."""
        return self.completed_mappings
    
    def get_progress(self, ranked_apis: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Get current progress summary."""
        return self._build_progress_summary(ranked_apis)
    
    def clear_checkpoint(self):
        """Delete checkpoint file (for cleanup after completion)."""
        try:
            if self.checkpoint_file.exists():
                self.checkpoint_file.unlink()
                logger.info(
                    "[ProgressiveMapping] Deleted checkpoint | session=%s",
                    self.session_id
                )
        except Exception as exc:
            logger.warning(
                "[ProgressiveMapping] Failed to delete checkpoint | session=%s error=%s",
                self.session_id,
                exc
            )


__all__ = ['ProgressiveMappingOrchestrator']
