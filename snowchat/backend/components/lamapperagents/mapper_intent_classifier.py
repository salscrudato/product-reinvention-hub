"""
Intent Classification Module for Data Mapper
============================================

This module provides intent classification specifically for data mapping questions.
Classifies user questions into categories like entity_extraction, definition_lookup, etc.

Intent Types:
- entity_extraction: Complex questions requiring multi-agent collaboration
- definition_lookup: Simple "What is X?" questions
- test_data_lookup: Questions about test data
- table_lookup: Questions about which table contains a field
- column_lookup: Questions about table structure
- logic_lookup: Questions about population logic/formulas
- refinement: Questions refining previous entity mappings

Author: AI Development Team
Date: 2025-01-13
"""

import re
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("mapper_intent_classifier")

# Intent categories
INTENT_ENTITY_EXTRACTION = "entity_extraction"
INTENT_DEFINITION_LOOKUP = "definition_lookup"
INTENT_TEST_DATA_LOOKUP = "test_data_lookup"
INTENT_TABLE_LOOKUP = "table_lookup"
INTENT_COLUMN_LOOKUP = "column_lookup"
INTENT_LOGIC_LOOKUP = "logic_lookup"
INTENT_REFINEMENT = "refinement"
INTENT_UNKNOWN = "unknown"

# Annotation markers
ANNOTATIONS = {
    "@entity": INTENT_ENTITY_EXTRACTION,
    "@definition": INTENT_DEFINITION_LOOKUP,
    "@testdata": INTENT_TEST_DATA_LOOKUP,
    "@table": INTENT_TABLE_LOOKUP,
    "@column": INTENT_COLUMN_LOOKUP,
    "@logic": INTENT_LOGIC_LOOKUP,
    "@refine": INTENT_REFINEMENT
}

# Intent patterns (regex patterns for heuristic classification)
INTENT_PATTERNS = {
    INTENT_DEFINITION_LOOKUP: [
        r"what\s+(?:is|are|does)\s+(\w+(?:\s+\w+)*)\s+mean",
        r"(?:define|definition\s+of)\s+(\w+(?:\s+\w+)*)",
        r"what\s+(?:is|are)\s+the\s+(?:definition|meaning)\s+of\s+(\w+(?:\s+\w+)*)",
        r"explain\s+(\w+(?:\s+\w+)*)",
    ],
    INTENT_TEST_DATA_LOOKUP: [
        r"(?:show|get|give)\s+(?:me\s+)?test\s+(?:data|values|samples)\s+for\s+(\w+(?:\s+\w+)*)",
        r"what\s+test\s+data\s+(?:do\s+we\s+have|exists)\s+for\s+(\w+(?:\s+\w+)*)",
        r"test\s+(?:values|examples|samples)\s+for\s+(\w+(?:\s+\w+)*)",
    ],
    INTENT_TABLE_LOOKUP: [
        r"(?:which|what)\s+table\s+(?:has|contains|holds)\s+(\w+(?:\s+\w+)*)",
        r"where\s+(?:is|can\s+I\s+find)\s+(\w+(?:\s+\w+)*)\s+(?:stored|located)",
        r"what\s+table\s+(?:stores|holds)\s+(\w+(?:\s+\w+)*)",
    ],
    INTENT_COLUMN_LOOKUP: [
        r"(?:what|which)\s+columns\s+(?:are\s+in|does)\s+(\w+)\s+(?:have|contain|table)",
        r"(?:show|list)\s+(?:me\s+)?(?:the\s+)?columns\s+(?:in|of|for)\s+(\w+)",
        r"describe\s+(?:the\s+)?(\w+)\s+table",
    ],
    INTENT_LOGIC_LOOKUP: [
        r"(?:how|what)\s+(?:is|are)\s+(\w+(?:\s+\w+)*)\s+(?:calculated|computed|populated|derived)",
        r"(?:show|give)\s+(?:me\s+)?(?:the\s+)?(?:logic|formula|calculation)\s+for\s+(\w+(?:\s+\w+)*)",
        r"what\s+(?:is|are)\s+the\s+(?:population\s+)?logic\s+(?:for|of)\s+(\w+(?:\s+\w+)*)",
    ],
    INTENT_REFINEMENT: [
        r"(?:refine|update|change|modify|fix)\s+(\w+(?:\s+\w+)*)",
        r"(?:can|could)\s+you\s+(?:refine|update|change|improve)\s+(\w+(?:\s+\w+)*)",
        r"the\s+(\w+(?:\s+\w+)*)\s+(?:is\s+)?(?:wrong|incorrect|needs\s+(?:work|refinement))",
    ]
}


class MapperIntentClassifier:
    """
    Intent classifier for data mapping questions.
    
    Classification Strategy:
    1. Check for explicit annotations (@entity, @definition, etc.)
    2. Apply regex pattern matching
    3. Use heuristics (question complexity, length, keywords)
    4. Fall back to entity_extraction for complex multi-part questions
    
    Example Usage:
    ```python
    classifier = MapperIntentClassifier()
    result = classifier.classify("I need customer name and address")
    # Returns: {
    #   "intent": "entity_extraction",
    #   "confidence": 0.9,
    #   "entities": ["customer name", "address"],
    #   "annotation": None
    # }
    ```
    """
    
    def __init__(self, config: Optional[Dict] = None):
        """
        Initialize intent classifier.
        
        Args:
            config: Optional configuration dict (for future ML-based classification)
        """
        self.config = config or {}
        logger.info("[MAPPER][INIT] Intent classifier initialized")
    
    def classify(self, question: str, context: Optional[Dict] = None) -> Dict:
        """
        Classify user question into intent category.
        
        Args:
            question: User's natural language question
            context: Optional context (previous entities, conversation history)
        
        Returns:
            Dict with keys:
            - intent: Intent category (entity_extraction, definition_lookup, etc.)
            - confidence: Confidence score (0.0-1.0)
            - entities: List of extracted entity names (if applicable)
            - annotation: Detected annotation marker (if any)
            - reasoning: Explanation of classification decision
        """
        logger.info(f"[MAPPER][CLASSIFY] Question: {question[:100]}")
        
        context = context or {}
        question_lower = question.lower().strip()
        
        # Step 1: Check for explicit annotation
        annotation = self._detect_annotation(question_lower)
        if annotation:
            intent = ANNOTATIONS[annotation]
            entities = self._extract_entity_names(question)
            logger.info(f"[MAPPER][CLASSIFY] Annotation detected: {annotation} → {intent}")
            return {
                "intent": intent,
                "confidence": 1.0,
                "entities": entities,
                "annotation": annotation,
                "reasoning": f"Explicit annotation '{annotation}' detected"
            }
        
        # Step 2: Pattern matching
        for intent, patterns in INTENT_PATTERNS.items():
            for pattern in patterns:
                match = re.search(pattern, question_lower, re.IGNORECASE)
                if match:
                    entities = [match.group(1)] if match.groups() else []
                    logger.info(f"[MAPPER][CLASSIFY] Pattern match: {intent}")
                    return {
                        "intent": intent,
                        "confidence": 0.85,
                        "entities": entities,
                        "annotation": None,
                        "reasoning": f"Matched pattern: {pattern[:50]}"
                    }
        
        # Step 3: Heuristic-based classification
        heuristic_result = self._heuristic_classification(question, question_lower, context)
        if heuristic_result:
            logger.info(f"[MAPPER][CLASSIFY] Heuristic: {heuristic_result['intent']}")
            return heuristic_result
        
        # Step 4: Default to entity_extraction for complex questions
        entities = self._extract_entity_names(question)
        logger.info(f"[MAPPER][CLASSIFY] Defaulting to entity_extraction")
        return {
            "intent": INTENT_ENTITY_EXTRACTION,
            "confidence": 0.5,
            "entities": entities,
            "annotation": None,
            "reasoning": "Complex multi-part question requiring agent collaboration"
        }
    
    def _detect_annotation(self, question: str) -> Optional[str]:
        """Detect explicit annotation markers like @entity, @definition, etc."""
        for annotation in ANNOTATIONS.keys():
            if annotation in question:
                return annotation
        return None
    
    def _extract_entity_names(self, question: str) -> List[str]:
        """
        Extract entity names from question using regex patterns.
        
        Patterns:
        - "I need X and Y" → ["X", "Y"]
        - "map customer name and address" → ["customer name", "address"]
        - "what is X" → ["X"]
        """
        entities = []
        
        # Pattern 1: "I need X and Y"
        match = re.search(r"(?:I\s+need|map|extract|get)\s+([\w\s,]+?)(?:\s+(?:and|,)\s+)?(?:from|in|$)", question, re.IGNORECASE)
        if match:
            entity_str = match.group(1)
            # Split by "and" or ","
            parts = re.split(r"\s+and\s+|,\s*", entity_str)
            entities.extend([p.strip() for p in parts if p.strip()])
        
        # Pattern 2: "what is X"
        match = re.search(r"what\s+(?:is|are)\s+([\w\s]+?)(?:\?|$)", question, re.IGNORECASE)
        if match and not entities:
            entity_name = match.group(1).strip()
            if entity_name not in ["the definition", "test data"]:
                entities.append(entity_name)
        
        # Pattern 3: "for X" or "of X"
        match = re.search(r"(?:for|of)\s+([\w\s]+?)(?:\?|$)", question, re.IGNORECASE)
        if match and not entities:
            entities.append(match.group(1).strip())
        
        # Deduplicate and clean
        entities = list(set(entities))
        entities = [e for e in entities if len(e) > 2 and e.lower() not in ["me", "the", "a", "an"]]
        
        logger.debug(f"[MAPPER][EXTRACT] Extracted entities: {entities}")
        return entities
    
    def _heuristic_classification(self, question: str, question_lower: str, context: Dict) -> Optional[Dict]:
        """
        Heuristic-based classification using question characteristics.
        
        Heuristics:
        - Short question (< 10 words) + "what is" → definition_lookup
        - Multiple entities + "need" → entity_extraction
        - Single entity + previous entities in context → refinement
        - Contains "test" + entity → test_data_lookup
        """
        words = question_lower.split()
        word_count = len(words)
        
        # Heuristic 1: Short "what is" questions
        if word_count < 10 and any(phrase in question_lower for phrase in ["what is", "what are", "define"]):
            entities = self._extract_entity_names(question)
            return {
                "intent": INTENT_DEFINITION_LOOKUP,
                "confidence": 0.75,
                "entities": entities,
                "annotation": None,
                "reasoning": "Short question with 'what is' pattern"
            }
        
        # Heuristic 2: Questions with "need" and multiple entities
        if "need" in question_lower:
            entities = self._extract_entity_names(question)
            if len(entities) >= 2:
                return {
                    "intent": INTENT_ENTITY_EXTRACTION,
                    "confidence": 0.8,
                    "entities": entities,
                    "annotation": None,
                    "reasoning": f"Multiple entities ({len(entities)}) with 'need' keyword"
                }
        
        # Heuristic 3: Refinement based on context
        previous_entities = context.get("entities", [])
        if previous_entities:
            entities = self._extract_entity_names(question)
            # If question mentions a previously mapped entity
            for entity in entities:
                if any(entity.lower() in prev.lower() for prev in previous_entities):
                    return {
                        "intent": INTENT_REFINEMENT,
                        "confidence": 0.7,
                        "entities": entities,
                        "annotation": None,
                        "reasoning": f"Entity '{entity}' previously mapped, likely refinement"
                    }
        
        # Heuristic 4: Test data questions
        if "test" in question_lower and ("data" in question_lower or "value" in question_lower):
            entities = self._extract_entity_names(question)
            return {
                "intent": INTENT_TEST_DATA_LOOKUP,
                "confidence": 0.75,
                "entities": entities,
                "annotation": None,
                "reasoning": "Contains 'test' and 'data/value' keywords"
            }
        
        # Heuristic 5: Table/column questions
        if "table" in question_lower:
            if "column" in question_lower or "field" in question_lower:
                entities = self._extract_entity_names(question)
                return {
                    "intent": INTENT_COLUMN_LOOKUP,
                    "confidence": 0.8,
                    "entities": entities,
                    "annotation": None,
                    "reasoning": "Contains 'table' and 'column/field' keywords"
                }
            else:
                entities = self._extract_entity_names(question)
                return {
                    "intent": INTENT_TABLE_LOOKUP,
                    "confidence": 0.75,
                    "entities": entities,
                    "annotation": None,
                    "reasoning": "Contains 'table' keyword"
                }
        
        # Heuristic 6: Logic/calculation questions
        if any(kw in question_lower for kw in ["calculated", "computed", "formula", "logic", "population"]):
            entities = self._extract_entity_names(question)
            return {
                "intent": INTENT_LOGIC_LOOKUP,
                "confidence": 0.75,
                "entities": entities,
                "annotation": None,
                "reasoning": "Contains calculation/logic keywords"
            }
        
        return None
    
    def get_routing_decision(self, classification: Dict) -> str:
        """
        Determine routing decision (recipe, crewai, langgraph) based on classification.
        
        Args:
            classification: Result from classify()
        
        Returns:
            "recipe" | "crewai" | "langgraph"
        """
        intent = classification["intent"]
        confidence = classification["confidence"]
        
        # High-confidence simple intents → Recipe
        if intent in [INTENT_DEFINITION_LOOKUP, INTENT_TEST_DATA_LOOKUP, INTENT_TABLE_LOOKUP, INTENT_COLUMN_LOOKUP]:
            if confidence >= 0.75:
                return "recipe"
        
        # Complex entity extraction → CrewAI
        if intent == INTENT_ENTITY_EXTRACTION:
            return "crewai"
        
        # Refinement (future) → LangGraph
        if intent == INTENT_REFINEMENT:
            return "langgraph"  # For now, still route to CrewAI
        
        # Default to CrewAI for ambiguous cases
        return "crewai"


# Convenience function for quick classification
def classify_intent(question: str, context: Optional[Dict] = None) -> Dict:
    """
    Quick classification function.
    
    Args:
        question: User question
        context: Optional context dict
    
    Returns:
        Classification result dict
    
    Example:
    ```python
    result = classify_intent("I need customer name and address")
    print(result["intent"])  # "entity_extraction"
    print(result["entities"])  # ["customer name", "address"]
    ```
    """
    classifier = MapperIntentClassifier()
    return classifier.classify(question, context)


if __name__ == "__main__":
    # Test cases
    logging.basicConfig(level=logging.INFO)
    
    test_cases = [
        "I need customer name and address",
        "What is customer name?",
        "Show me test data for email address",
        "Which table has phone number?",
        "What columns are in customer_master?",
        "How is total_amount calculated?",
        "@entity customer name",
        "@definition account number",
        "Refine the customer name mapping",
    ]
    
    classifier = MapperIntentClassifier()
    print("Intent Classification Test Suite")
    print("=" * 60)
    
    for question in test_cases:
        result = classifier.classify(question)
        print(f"\nQuestion: {question}")
        print(f"Intent: {result['intent']}")
        print(f"Confidence: {result['confidence']:.2f}")
        print(f"Entities: {result['entities']}")
        print(f"Routing: {classifier.get_routing_decision(result)}")
        print(f"Reasoning: {result['reasoning']}")
