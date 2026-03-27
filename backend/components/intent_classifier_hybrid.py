"""Hybrid intent classifier combining ML model with regex fallback.

Provides production-ready intent classification with graceful degradation.
"""

import os
import logging
from typing import Dict, Tuple, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# Try to import ML classifier
try:
    from .intent_classifier_ml import MLIntentClassifier, SKLEARN_AVAILABLE
except ImportError:
    MLIntentClassifier = None
    SKLEARN_AVAILABLE = False

# Import existing regex classifier
try:
    from .intent_classifier import classify_intent as classify_intent_regex
except ImportError:
    classify_intent_regex = None


class HybridIntentClassifier:
    """Hybrid classifier using ML when confident, regex as fallback."""
    
    def __init__(self, model_path: Optional[str] = None, confidence_threshold: float = 0.6):
        """Initialize hybrid classifier.
        
        Args:
            model_path: Path to ML model (defaults to models/intent_classifier)
            confidence_threshold: Minimum confidence to use ML prediction (default: 0.6)
        """
        self.ml_classifier = None
        self.confidence_threshold = confidence_threshold
        self.ml_enabled = False
        
        # Try to load ML model
        if SKLEARN_AVAILABLE and MLIntentClassifier:
            if model_path is None:
                model_path = str(Path(__file__).parent.parent / 'models' / 'intent_classifier')
            
            try:
                if Path(f"{model_path}_model.pkl").exists():
                    self.ml_classifier = MLIntentClassifier(model_path)
                    self.ml_enabled = True
                    logger.info(f"[HybridClassifier] ML model loaded: {model_path}")
                else:
                    logger.warning(f"[HybridClassifier] ML model not found: {model_path}")
            except Exception as e:
                logger.error(f"[HybridClassifier] Failed to load ML model: {e}")
        else:
            logger.info("[HybridClassifier] ML classifier not available (sklearn not installed)")
        
        # Check if regex classifier available
        if classify_intent_regex is None:
            logger.error("[HybridClassifier] Regex classifier not available!")
    
    def classify(self, query: str, metadata: Dict) -> Tuple[str, Dict]:
        """Classify intent using hybrid approach.
        
        Strategy:
        1. Try ML classifier if available and enabled
        2. If ML confidence >= threshold, use ML prediction
        3. Otherwise, fallback to regex classifier
        4. If regex returns unknown, use ML prediction even if low confidence
        
        Args:
            query: User query text
            metadata: Context metadata (persona, etc.)
        
        Returns:
            (intent, classification_metadata) where metadata includes:
            - method: 'ml', 'regex', 'ml_low_confidence'
            - confidence: ML confidence score (if ML used)
        """
        classification_meta = {}
        
        # Try ML first
        if self.ml_enabled and self.ml_classifier:
            try:
                ml_intent, ml_confidence = self.ml_classifier.predict(query, metadata)
                classification_meta['ml_intent'] = ml_intent
                classification_meta['ml_confidence'] = ml_confidence
                
                # Use ML if confidence is high
                if ml_confidence >= self.confidence_threshold:
                    classification_meta['method'] = 'ml'
                    classification_meta['confidence'] = ml_confidence
                    logger.info(f"[HybridClassifier] ML: {ml_intent} (conf={ml_confidence:.2f})")
                    return ml_intent, classification_meta
                
                # ML not confident, try regex
                logger.debug(f"[HybridClassifier] ML confidence low ({ml_confidence:.2f}), trying regex")
            
            except Exception as e:
                logger.error(f"[HybridClassifier] ML prediction failed: {e}")
        
        # Fallback to regex
        if classify_intent_regex:
            try:
                regex_intent = classify_intent_regex(query, metadata)
                classification_meta['regex_intent'] = regex_intent
                
                # If regex found something, use it
                if regex_intent and regex_intent != 'unknown':
                    classification_meta['method'] = 'regex_fallback'
                    logger.info(f"[HybridClassifier] Regex: {regex_intent}")
                    return regex_intent, classification_meta
                
                # Regex returned unknown, use ML prediction even if low confidence
                if 'ml_intent' in classification_meta and classification_meta['ml_intent'] != 'unknown':
                    ml_intent = classification_meta['ml_intent']
                    ml_confidence = classification_meta['ml_confidence']
                    classification_meta['method'] = 'ml_low_confidence'
                    classification_meta['confidence'] = ml_confidence
                    logger.info(f"[HybridClassifier] ML low-conf: {ml_intent} (conf={ml_confidence:.2f})")
                    return ml_intent, classification_meta
                
                # Both failed, return unknown
                classification_meta['method'] = 'unknown'
                return 'unknown', classification_meta
            
            except Exception as e:
                logger.error(f"[HybridClassifier] Regex classification failed: {e}")
        
        # No classifier available
        logger.error("[HybridClassifier] No classifier available!")
        classification_meta['method'] = 'error'
        return 'unknown', classification_meta
    
    def get_stats(self) -> Dict:
        """Get classifier statistics."""
        stats = {
            'ml_enabled': self.ml_enabled,
            'regex_enabled': classify_intent_regex is not None,
            'confidence_threshold': self.confidence_threshold
        }
        
        if self.ml_classifier and hasattr(self.ml_classifier, 'metadata'):
            stats['ml_metadata'] = self.ml_classifier.metadata
        
        return stats


# Global instance (lazy initialization)
_global_classifier = None


def get_hybrid_classifier() -> HybridIntentClassifier:
    """Get or create global hybrid classifier instance."""
    global _global_classifier
    
    if _global_classifier is None:
        # Get confidence threshold from env
        confidence_threshold = float(os.getenv('ML_INTENT_CONFIDENCE_THRESHOLD', '0.6'))
        _global_classifier = HybridIntentClassifier(confidence_threshold=confidence_threshold)
    
    return _global_classifier


def classify_intent_hybrid(query: str, metadata: Dict) -> str:
    """Convenience function for hybrid classification.
    
    Args:
        query: User query
        metadata: Context metadata
    
    Returns:
        Predicted intent (updates metadata with classification info)
    """
    classifier = get_hybrid_classifier()
    intent, classification_meta = classifier.classify(query, metadata)
    
    # Merge classification metadata into provided metadata
    metadata.update({
        'classification_method': classification_meta.get('method'),
        'classification_confidence': classification_meta.get('confidence'),
        'ml_intent': classification_meta.get('ml_intent'),
        'regex_intent': classification_meta.get('regex_intent')
    })
    
    return intent
