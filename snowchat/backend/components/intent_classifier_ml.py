"""ML-based intent classifier using scikit-learn.

Replaces regex patterns with learned model trained on production data.
Falls back to regex when confidence is low.
"""

import json
import pickle
import logging
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import numpy as np

logger = logging.getLogger(__name__)

# Lazy imports for optional dependencies
try:
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.preprocessing import LabelEncoder
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import classification_report, confusion_matrix
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn not installed. ML classifier disabled.")


class MLIntentClassifier:
    """ML-based intent classifier with fallback to regex."""
    
    def __init__(self, model_path: Optional[str] = None):
        """Initialize classifier.
        
        Args:
            model_path: Path to saved model files (without extension)
        """
        self.model = None
        self.vectorizer = None
        self.label_encoder = None
        self.feature_names = []
        self.model_path = model_path
        self.metadata = {}
        
        if model_path and Path(f"{model_path}_model.pkl").exists():
            self.load(model_path)
    
    def extract_features(self, query: str, metadata: Dict) -> np.ndarray:
        """Extract features from query and metadata.
        
        Args:
            query: User query text
            metadata: Context metadata (persona, etc.)
        
        Returns:
            Feature vector
        """
        # Text features via TF-IDF
        if self.vectorizer is None:
            raise ValueError("Vectorizer not fitted. Train model first.")
        
        tfidf_features = self.vectorizer.transform([query]).toarray()[0]  # type: ignore[attr-defined]
        
        # Metadata features
        import re
        
        has_incident = 1 if re.search(r'\bINC\d+', query, re.IGNORECASE) else 0
        has_timeframe = 1 if re.search(r'\b(today|yesterday|last\s+\d+\s+days?|this\s+week)', query, re.IGNORECASE) else 0
        has_annotation = 1 if re.search(r'@(wiki|code|checkpref)', query) else 0
        has_aggregation = 1 if re.search(r'\b(how many|count|total|sum|average)', query, re.IGNORECASE) else 0
        has_vague_reference = 1 if re.search(r'\b(this|that|these|those|it)\s+(incident|ticket)', query, re.IGNORECASE) else 0
        query_length = len(query.split())
        
        # Persona encoding (one-hot)
        persona = metadata.get('persona', 'unknown')
        persona_developer = 1 if persona == 'developer' else 0
        persona_product_owner = 1 if persona == 'product_owner' else 0
        persona_business_analyst = 1 if persona == 'business_analyst' else 0
        
        metadata_features = np.array([
            has_incident,
            has_timeframe,
            has_annotation,
            has_aggregation,
            has_vague_reference,
            query_length,
            persona_developer,
            persona_product_owner,
            persona_business_analyst
        ])
        
        # Concatenate all features
        return np.concatenate([tfidf_features, metadata_features])
    
    def train(self, training_data: List[Dict], test_size: float = 0.2, random_state: int = 42):
        """Train the classifier.
        
        Args:
            training_data: List of training examples
            test_size: Fraction of data for testing
            random_state: Random seed
        
        Returns:
            Training metrics
        """
        if not SKLEARN_AVAILABLE:
            raise ImportError("scikit-learn required for ML classifier. Install: pip install scikit-learn")
        
        logger.info(f"Training ML intent classifier with {len(training_data)} examples")
        
        # Filter out unknown intents
        training_data = [ex for ex in training_data if ex['intent'] != 'unknown']
        
        if len(training_data) < 20:
            raise ValueError(f"Insufficient training data: {len(training_data)} examples (need at least 20)")
        
        # Extract queries and labels
        queries = [ex['query'] for ex in training_data]
        intents = [ex['intent'] for ex in training_data]
        
        # Encode labels
        self.label_encoder = LabelEncoder()
        y = self.label_encoder.fit_transform(intents)
        
        # Fit TF-IDF vectorizer
        self.vectorizer = TfidfVectorizer(
            max_features=1000,
            ngram_range=(1, 2),
            min_df=2,
            stop_words='english'
        )
        self.vectorizer.fit(queries)
        
        # Extract all features
        X = np.array([self.extract_features(ex['query'], ex) for ex in training_data])
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=random_state, stratify=y
        )
        
        # Train Random Forest
        self.model = RandomForestClassifier(
            n_estimators=100,
            max_depth=20,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=random_state,
            class_weight='balanced',  # Handle class imbalance
            n_jobs=-1
        )
        
        logger.info("Training Random Forest classifier...")
        self.model.fit(X_train, y_train)
        
        # Evaluate
        train_score = self.model.score(X_train, y_train)
        test_score = self.model.score(X_test, y_test)
        
        y_pred = self.model.predict(X_test)
        
        logger.info(f"Training accuracy: {train_score:.3f}")
        logger.info(f"Test accuracy: {test_score:.3f}")
        
        # Store metadata
        self.metadata = {
            'train_accuracy': float(train_score),
            'test_accuracy': float(test_score),
            'num_training_examples': len(training_data),
            'num_intents': len(self.label_encoder.classes_),
            'intents': self.label_encoder.classes_.tolist(),
            'random_state': random_state
        }
        
        # Classification report (only for classes in test set)
        unique_test_labels = np.unique(y_test)
        test_label_names = self.label_encoder.inverse_transform(unique_test_labels)
        
        report = classification_report(
            y_test, 
            y_pred, 
            labels=unique_test_labels,
            target_names=test_label_names,
            zero_division=0
        )
        logger.info(f"\nClassification Report:\n{report}")
        
        return {
            'train_accuracy': train_score,
            'test_accuracy': test_score,
            'classification_report': report,
            'metadata': self.metadata
        }
    
    def predict(self, query: str, metadata: Dict) -> Tuple[str, float]:
        """Predict intent with confidence score.
        
        Args:
            query: User query
            metadata: Context metadata
        
        Returns:
            (intent, confidence_score)
        """
        if self.model is None:
            raise ValueError("Model not trained. Call train() first or load() a trained model.")
        
        features = self.extract_features(query, metadata).reshape(1, -1)
        
        # Get probabilities for all classes
        probabilities = self.model.predict_proba(features)[0]
        
        # Get top prediction
        predicted_idx = np.argmax(probabilities)
        confidence = probabilities[predicted_idx]
        intent = self.label_encoder.inverse_transform([predicted_idx])[0]
        
        return intent, float(confidence)
    
    def predict_top_k(self, query: str, metadata: Dict, k: int = 3) -> List[Tuple[str, float]]:
        """Predict top-k intents with confidence scores.
        
        Args:
            query: User query
            metadata: Context metadata
            k: Number of top predictions
        
        Returns:
            List of (intent, confidence) tuples
        """
        if self.model is None:
            raise ValueError("Model not trained.")
        
        features = self.extract_features(query, metadata).reshape(1, -1)
        probabilities = self.model.predict_proba(features)[0]
        
        # Get top k indices
        top_k_indices = np.argsort(probabilities)[-k:][::-1]
        
        results = []
        for idx in top_k_indices:
            intent = self.label_encoder.inverse_transform([idx])[0]
            confidence = probabilities[idx]
            results.append((intent, float(confidence)))
        
        return results
    
    def save(self, path: str):
        """Save model to disk.
        
        Args:
            path: Base path (without extension)
        """
        if self.model is None:
            raise ValueError("No model to save")
        
        # Save model
        with open(f"{path}_model.pkl", 'wb') as f:
            pickle.dump(self.model, f)
        
        # Save vectorizer
        with open(f"{path}_vectorizer.pkl", 'wb') as f:
            pickle.dump(self.vectorizer, f)
        
        # Save label encoder
        with open(f"{path}_labels.pkl", 'wb') as f:
            pickle.dump(self.label_encoder, f)
        
        # Save metadata
        with open(f"{path}_metadata.json", 'w') as f:
            json.dump(self.metadata, f, indent=2)
        
        logger.info(f"Model saved to {path}_*.pkl")
    
    def load(self, path: str):
        """Load model from disk.
        
        Args:
            path: Base path (without extension)
        """
        # Load model
        with open(f"{path}_model.pkl", 'rb') as f:
            self.model = pickle.load(f)
        
        # Load vectorizer
        with open(f"{path}_vectorizer.pkl", 'rb') as f:
            self.vectorizer = pickle.load(f)
        
        # Load label encoder
        with open(f"{path}_labels.pkl", 'rb') as f:
            self.label_encoder = pickle.load(f)
        
        # Load metadata
        metadata_path = f"{path}_metadata.json"
        if Path(metadata_path).exists():
            with open(metadata_path, 'r') as f:
                self.metadata = json.load(f)
        
        logger.info(f"Model loaded from {path}")
        logger.info(f"Supports {len(self.label_encoder.classes_)} intents: {self.label_encoder.classes_.tolist()}")
