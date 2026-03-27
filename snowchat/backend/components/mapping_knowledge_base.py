"""
Mapping Knowledge Base - TinyDB Storage for Historical Product Mappings
Stores product definitions and field mappings for learning-based mapping suggestions.
"""

import logging
import os
import uuid
from datetime import datetime
from typing import List, Dict, Optional, Any
from pathlib import Path

from tinydb import TinyDB, Query

logger = logging.getLogger("mapping_knowledge_base")

# Database file path
KB_DB_PATH = os.getenv("MAPPING_KB_DB_PATH", "mapping_knowledge_base.json")

class MappingKnowledgeBase:
    """
    Manages historical product mappings in TinyDB for learning and suggestions.
    
    Tables:
    - products: Product metadata (name, type, swagger file, stats)
    - field_mappings: Individual field-to-JSON mappings
    - patterns: Learned mapping patterns (e.g., *_DATE_MDY → date fields)
    """
    
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or KB_DB_PATH
        self.db = TinyDB(self.db_path)
        self.products_table = self.db.table("products")
        self.mappings_table = self.db.table("field_mappings")
        self.patterns_table = self.db.table("patterns")
        logger.info("[KB] Initialized MappingKnowledgeBase | db_path=%s", self.db_path)
    
    # ===== Product Management =====
    
    def create_product(
        self,
        product_name: str,
        product_type: str,
        swagger_file: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Create a new product entry in the knowledge base.
        
        Args:
            product_name: Human-readable product name
            product_type: Product category (Group Life, Voluntary Benefits, etc.)
            swagger_file: Filename or path to Swagger spec
            metadata: Additional metadata (version, author, description, etc.)
        
        Returns:
            Product document with generated ID
        """
        product_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        
        product = {
            "id": product_id,
            "productName": product_name,
            "productType": product_type,
            "swaggerFile": swagger_file,
            "createdAt": now,
            "updatedAt": now,
            "totalFields": 0,
            "mappedFields": 0,
            "vectorized": False,
            "metadata": metadata or {},
        }
        
        self.products_table.insert(product)
        logger.info(
            "[KB] Created product | id=%s | name=%s | type=%s",
            product_id,
            product_name,
            product_type,
        )
        return product
    
    def get_product(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a product by ID."""
        Product = Query()
        result = self.products_table.search(Product.id == product_id)
        return result[0] if result else None
    
    def get_all_products(
        self,
        product_type: Optional[str] = None,
        vectorized_only: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Retrieve all products, optionally filtered by type or vectorization status.
        
        Args:
            product_type: Filter by product type (e.g., "Group Life")
            vectorized_only: Only return products that have been vectorized
        
        Returns:
            List of product documents
        """
        Product = Query()
        
        if product_type and vectorized_only:
            results = self.products_table.search(
                (Product.productType == product_type) & (Product.vectorized == True)
            )
        elif product_type:
            results = self.products_table.search(Product.productType == product_type)
        elif vectorized_only:
            results = self.products_table.search(Product.vectorized == True)
        else:
            results = self.products_table.all()
        
        # Sort by creation date descending
        results.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
        return results
    
    def update_product(self, product_id: str, updates: Dict[str, Any]) -> bool:
        """
        Update product fields.
        
        Args:
            product_id: Product ID
            updates: Dictionary of fields to update
        
        Returns:
            True if update succeeded
        """
        Product = Query()
        updates["updatedAt"] = datetime.utcnow().isoformat()
        
        result = self.products_table.update(updates, Product.id == product_id)
        if result:
            logger.info("[KB] Updated product | id=%s | fields=%s", product_id, list(updates.keys()))
        return len(result) > 0
    
    def delete_product(self, product_id: str) -> bool:
        """
        Delete a product and all its associated field mappings.
        
        Args:
            product_id: Product ID to delete
        
        Returns:
            True if deletion succeeded
        """
        Product = Query()
        Mapping = Query()
        
        # Delete all associated mappings first
        deleted_mappings = self.mappings_table.remove(Mapping.productId == product_id)
        
        # Delete the product
        deleted_products = self.products_table.remove(Product.id == product_id)
        
        if deleted_products:
            logger.info(
                "[KB] Deleted product | id=%s | deleted_mappings=%d",
                product_id,
                len(deleted_mappings) if deleted_mappings else 0,
            )
        return len(deleted_products) > 0
    
    # ===== Field Mapping Management =====
    
    def create_mapping(
        self,
        product_id: str,
        word_placeholder: str,
        json_path: str,
        swagger_operation: str,
        data_type: str = "string",
        sample_value: Optional[str] = None,
        confidence: Optional[float] = None,
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a new field mapping entry.
        
        Args:
            product_id: Associated product ID
            word_placeholder: Word template placeholder (e.g., [ELIGIBLE_LIVES])
            json_path: JSON path in Swagger spec (e.g., eligibleLives)
            swagger_operation: Operation ID from Swagger (e.g., getQuote)
            data_type: Data type (string, number, boolean, date, array, object)
            sample_value: Example value for this field
            confidence: Confidence score (0.0-1.0) if auto-generated
            notes: Additional notes or context
        
        Returns:
            Mapping document with generated ID
        """
        mapping_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        
        mapping = {
            "id": mapping_id,
            "productId": product_id,
            "wordPlaceholder": word_placeholder,
            "jsonPath": json_path,
            "swaggerOperation": swagger_operation,
            "dataType": data_type,
            "sampleValue": sample_value,
            "confidence": confidence,
            "notes": notes,
            "createdAt": now,
        }
        
        self.mappings_table.insert(mapping)
        
        # Update product's mappedFields count
        product = self.get_product(product_id)
        if product:
            self.update_product(product_id, {
                "mappedFields": product.get("mappedFields", 0) + 1,
                "totalFields": max(product.get("totalFields", 0), product.get("mappedFields", 0) + 1),
            })
        
        logger.info(
            "[KB] Created mapping | id=%s | product=%s | placeholder=%s | path=%s",
            mapping_id,
            product_id,
            word_placeholder,
            json_path,
        )
        return mapping
    
    def get_mapping(self, mapping_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a mapping by ID."""
        Mapping = Query()
        result = self.mappings_table.search(Mapping.id == mapping_id)
        return result[0] if result else None
    
    def get_product_mappings(self, product_id: str) -> List[Dict[str, Any]]:
        """Retrieve all mappings for a specific product."""
        Mapping = Query()
        results = self.mappings_table.search(Mapping.productId == product_id)
        # Sort by word placeholder
        results.sort(key=lambda x: x.get("wordPlaceholder", ""))
        return results
    
    def search_mappings_by_placeholder(
        self,
        placeholder: str,
        product_type: Optional[str] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """
        Search for mappings with similar placeholders across all products.
        Useful for finding historical precedents for a new field.
        
        Args:
            placeholder: Word placeholder to search for (supports partial match)
            product_type: Optional filter by product type
            limit: Maximum results to return
        
        Returns:
            List of matching mappings with product context
        """
        Mapping = Query()
        placeholder_lower = placeholder.lower()
        
        # Get all mappings with matching placeholders
        all_mappings = self.mappings_table.all()
        matches = [
            m for m in all_mappings
            if placeholder_lower in m.get("wordPlaceholder", "").lower()
        ]
        
        # Enrich with product information
        enriched_matches = []
        for mapping in matches[:limit]:
            product = self.get_product(mapping["productId"])
            if product_type and product and product.get("productType") != product_type:
                continue
            
            enriched_mapping = {**mapping}
            if product:
                enriched_mapping["product"] = {
                    "name": product.get("productName"),
                    "type": product.get("productType"),
                }
            enriched_matches.append(enriched_mapping)
        
        logger.info(
            "[KB] Searched mappings | placeholder=%s | matches=%d",
            placeholder,
            len(enriched_matches),
        )
        return enriched_matches
    
    def update_mapping(self, mapping_id: str, updates: Dict[str, Any]) -> bool:
        """Update mapping fields."""
        Mapping = Query()
        result = self.mappings_table.update(updates, Mapping.id == mapping_id)
        if result:
            logger.info("[KB] Updated mapping | id=%s | fields=%s", mapping_id, list(updates.keys()))
        return len(result) > 0
    
    def delete_mapping(self, mapping_id: str) -> bool:
        """Delete a field mapping."""
        Mapping = Query()
        
        # Get mapping to update product count
        mapping = self.get_mapping(mapping_id)
        
        deleted = self.mappings_table.remove(Mapping.id == mapping_id)
        
        if deleted and mapping:
            # Update product's mappedFields count
            product_id = mapping.get("productId")
            if product_id:
                product = self.get_product(product_id)
                if product:
                    self.update_product(product_id, {
                        "mappedFields": max(0, product.get("mappedFields", 1) - 1),
                    })
            
            logger.info("[KB] Deleted mapping | id=%s", mapping_id)
        
        return len(deleted) > 0
    
    # ===== Pattern Management =====
    
    def save_pattern(
        self,
        pattern_name: str,
        pattern_regex: str,
        target_field_pattern: str,
        data_type: str,
        confidence: float,
        examples: List[Dict[str, str]],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Save a learned mapping pattern for reuse.
        
        Example:
            pattern_name: "Date Fields MDY"
            pattern_regex: ".*_DATE_MDY$"
            target_field_pattern: "{prefix}Date"
            data_type: "date"
            examples: [
                {"placeholder": "[EFFECTIVE_DATE_MDY]", "jsonPath": "effectiveDate"},
                {"placeholder": "[PREPARED_ON_MDY]", "jsonPath": "preparedDate"}
            ]
        
        Args:
            pattern_name: Human-readable pattern name
            pattern_regex: Regex to match placeholders
            target_field_pattern: Template for generating JSON path
            data_type: Expected data type
            confidence: Pattern reliability (0.0-1.0)
            examples: List of example mappings
            metadata: Additional pattern metadata
        
        Returns:
            Pattern document
        """
        pattern_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        
        pattern = {
            "id": pattern_id,
            "patternName": pattern_name,
            "patternRegex": pattern_regex,
            "targetFieldPattern": target_field_pattern,
            "dataType": data_type,
            "confidence": confidence,
            "examples": examples,
            "metadata": metadata or {},
            "createdAt": now,
            "usageCount": 0,
        }
        
        self.patterns_table.insert(pattern)
        logger.info(
            "[KB] Saved pattern | id=%s | name=%s | regex=%s",
            pattern_id,
            pattern_name,
            pattern_regex,
        )
        return pattern
    
    def get_all_patterns(self) -> List[Dict[str, Any]]:
        """Retrieve all learned patterns."""
        patterns = self.patterns_table.all()
        # Sort by confidence descending
        patterns.sort(key=lambda x: x.get("confidence", 0.0), reverse=True)
        return patterns
    
    def increment_pattern_usage(self, pattern_id: str):
        """Increment usage count for a pattern."""
        Pattern = Query()
        pattern = self.patterns_table.search(Pattern.id == pattern_id)
        if pattern:
            current_count = pattern[0].get("usageCount", 0)
            self.patterns_table.update(
                {"usageCount": current_count + 1},
                Pattern.id == pattern_id
            )
    
    # ===== Statistics =====
    
    def get_statistics(self) -> Dict[str, Any]:
        """
        Get knowledge base statistics.
        
        Returns:
            Dictionary with counts and metrics
        """
        products = self.products_table.all()
        mappings = self.mappings_table.all()
        patterns = self.patterns_table.all()
        
        total_products = len(products)
        vectorized_products = len([p for p in products if p.get("vectorized")])
        total_mappings = len(mappings)
        
        product_types = {}
        for product in products:
            ptype = product.get("productType", "Unknown")
            product_types[ptype] = product_types.get(ptype, 0) + 1
        
        return {
            "totalProducts": total_products,
            "vectorizedProducts": vectorized_products,
            "totalMappings": total_mappings,
            "totalPatterns": len(patterns),
            "productTypes": product_types,
            "dbPath": self.db_path,
            "dbSize": os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0,
        }
    
    def close(self):
        """Close the database connection."""
        self.db.close()
        logger.info("[KB] Closed database connection")


# Singleton instance
_kb_instance: Optional[MappingKnowledgeBase] = None

def get_knowledge_base() -> MappingKnowledgeBase:
    """Get or create singleton knowledge base instance."""
    global _kb_instance
    if _kb_instance is None:
        _kb_instance = MappingKnowledgeBase()
    return _kb_instance
