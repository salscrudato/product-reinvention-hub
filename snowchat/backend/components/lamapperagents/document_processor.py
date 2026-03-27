"""
DocumentProcessor - Unified interface for Data Mapper document processing
==========================================================================

This module provides a thin adapter layer that reuses the battle-tested parsers
from mapping_agents while allowing future customization for Data Mapper needs.

Architecture:
- Delegates to mapping_agents.parsers for core parsing logic (LAZY IMPORT to avoid circular dependencies)
- Provides consistent interface for Data Mapper Wizard
- Allows extension points for Data Mapper-specific enhancements
- Maintains DRY principle (no code duplication)

Usage:
    processor = DocumentProcessor()
    excel_result = processor.process_excel("data_dictionary.xlsx")
    word_result = processor.process_word("template.docx")
    auto_result = processor.process_document("unknown.xlsx")  # Auto-detect
"""

import os
import logging
from typing import Dict, List, Any, Optional, Callable
from pathlib import Path

logger = logging.getLogger(__name__)

# Lazy import globals to avoid circular dependencies
_parsers_imported = False
_parse_excel: Optional[Callable] = None
_parse_word_document: Optional[Callable] = None
_parse_swagger: Optional[Callable] = None


def _ensure_parsers_imported():
    """Lazy import of mapping_agents parsers to avoid circular import issues."""
    global _parsers_imported, _parse_excel, _parse_word_document, _parse_swagger
    
    if _parsers_imported:
        return
    
    try:
        from ..mapping_agents.parsers import (
            parse_excel,
            parse_word_document,
            parse_swagger
        )
        
        _parse_excel = parse_excel
        _parse_word_document = parse_word_document
        _parse_swagger = parse_swagger
        
        _parsers_imported = True
        logger.info("Successfully imported mapping_agents parsers (lazy import)")
        
    except ImportError as e:
        logger.error(f"Failed to import mapping_agents modules: {e}")
        raise ImportError(
            "DocumentProcessor requires mapping_agents package. "
            "Ensure mapping_agents folder exists in components/"
        )


class DocumentProcessor:
    """
    Unified document processor for Data Mapper Wizard.
    
    Reuses mapping_agents parsers with optional Data Mapper enhancements.
    """
    
    def __init__(self, project_id: Optional[str] = None):
        """
        Initialize DocumentProcessor.
        
        Args:
            project_id: Optional project identifier for context
        """
        self.project_id = project_id
        logger.info(f"DocumentProcessor initialized for project: {project_id}")
    
    def process_excel(self, file_path: str, enhance_for_data_mapper: bool = True):
        """
        Process Excel file (.xlsx, .xls, .csv).
        
        Args:
            file_path: Path to Excel file
            enhance_for_data_mapper: Apply Data Mapper specific enhancements
            
        Returns:
            ExcelSummary object with parsed data
            
        Raises:
            Exception: If file cannot be parsed
        """
        _ensure_parsers_imported()
        logger.info(f"Processing Excel file: {file_path}")
        
        try:
            # Delegate to proven mapping_agents parser
            if _parse_excel is None:
                raise RuntimeError("Parsers not loaded - import failed")
            result = _parse_excel(file_path)
            
            # Optional: Add Data Mapper specific enhancements
            if enhance_for_data_mapper:
                result = self._enhance_excel_for_data_mapper(result)
            
            logger.info(f"Excel processing complete: {len(result.sheets)} sheets, {len(result.objects)} objects found")
            return result
            
        except Exception as e:
            logger.error(f"Error processing Excel: {e}")
            raise
    
    def process_word(self, file_path: str, enhance_for_data_mapper: bool = True):
        """
        Process Word document (.docx, .doc).
        
        Args:
            file_path: Path to Word document
            enhance_for_data_mapper: Apply Data Mapper specific enhancements
            
        Returns:
            WordSummary object with parsed data
            
        Raises:
            Exception: If file cannot be parsed
        """
        _ensure_parsers_imported()
        logger.info(f"Processing Word document: {file_path}")
        
        try:
            # Delegate to proven mapping_agents parser
            if _parse_word_document is None:
                raise RuntimeError("Parsers not loaded - import failed")
            result = _parse_word_document(file_path)
            
            # Optional: Add Data Mapper specific enhancements
            if enhance_for_data_mapper:
                result = self._enhance_word_for_data_mapper(result)
            
            logger.info(f"Word processing complete: {len(result.fields)} fields, {len(result.paragraphs)} paragraphs found")
            return result
            
        except Exception as e:
            logger.error(f"Error processing Word: {e}")
            raise
    
    def process_swagger(self, file_path: str, enhance_for_data_mapper: bool = True):
        """
        Process Swagger/OpenAPI spec (.json, .yaml, .yml).
        
        Args:
            file_path: Path to Swagger/OpenAPI file
            enhance_for_data_mapper: Apply Data Mapper specific enhancements
            
        Returns:
            SwaggerSummary object with parsed data
            
        Raises:
            Exception: If file cannot be parsed
        """
        _ensure_parsers_imported()
        logger.info(f"Processing Swagger file: {file_path}")
        
        try:
            # Delegate to proven mapping_agents parser
            if _parse_swagger is None:
                raise RuntimeError("Parsers not loaded - import failed")
            result = _parse_swagger(file_path)
            
            # Optional: Add Data Mapper specific enhancements
            if enhance_for_data_mapper:
                result = self._enhance_swagger_for_data_mapper(result)
            
            logger.info(f"Swagger processing complete: {result.total_endpoints} endpoints, {result.total_operations} operations found")
            return result
            
        except Exception as e:
            logger.error(f"Error processing Swagger: {e}")
            raise
    
    def process_document(self, file_path: str, file_type: Optional[str] = None):
        """
        Auto-detect document type and process accordingly.
        
        Args:
            file_path: Path to document
            file_type: Optional file type hint ('excel', 'word', 'swagger')
            
        Returns:
            Appropriate Summary object based on document type
            
        Raises:
            ValueError: If file type cannot be determined or is unsupported
        """
        _ensure_parsers_imported()
        logger.info(f"Auto-processing document: {file_path}")
        
        if not os.path.exists(file_path):
            raise ValueError(f"File not found: {file_path}")
        
        # Determine file type from extension if not provided
        if file_type is None:
            ext = Path(file_path).suffix.lower()
            file_type = self._detect_file_type(ext)
        
        # Route to appropriate processor
        if file_type == 'excel':
            return self.process_excel(file_path)
        elif file_type == 'word':
            return self.process_word(file_path)
        elif file_type == 'swagger':
            return self.process_swagger(file_path)
        else:
            raise ValueError(f"Unsupported file type: {file_type}")
    
    def _detect_file_type(self, extension: str) -> str:
        """
        Detect file type from extension.
        
        Args:
            extension: File extension (with or without dot)
            
        Returns:
            File type string ('excel', 'word', 'swagger')
            
        Raises:
            ValueError: If extension is not supported
        """
        ext = extension.lower().lstrip('.')
        
        if ext in ['xlsx', 'xls', 'csv']:
            return 'excel'
        elif ext in ['docx', 'doc']:
            return 'word'
        elif ext in ['json', 'yaml', 'yml']:
            return 'swagger'
        else:
            raise ValueError(f"Unsupported file extension: {ext}")
    
    def _enhance_excel_for_data_mapper(self, result):
        """
        Apply Data Mapper specific enhancements to Excel parsing results.
        
        Future enhancements could include:
        - Business term detection in column headers
        - Data dictionary pattern recognition
        - ACORD field identification
        - Insurance domain-specific validation
        
        Args:
            result: Raw ExcelSummary from mapping_agents
            
        Returns:
            Enhanced ExcelSummary
        """
        # Placeholder for future Data Mapper specific logic
        # Currently returns unmodified result (pure delegation)
        return result
    
    def _enhance_word_for_data_mapper(self, result):
        """
        Apply Data Mapper specific enhancements to Word parsing results.
        
        Future enhancements could include:
        - Insurance form template detection
        - Policy document structure analysis
        - Regulatory compliance checking
        - Claims form field extraction
        
        Args:
            result: Raw WordSummary from mapping_agents
            
        Returns:
            Enhanced WordSummary
        """
        # Placeholder for future Data Mapper specific logic
        return result
    
    def _enhance_swagger_for_data_mapper(self, result):
        """
        Apply Data Mapper specific enhancements to Swagger parsing results.
        
        Future enhancements could include:
        - ACORD API structure mapping
        - Insurance API pattern recognition
        - Policy/Claims endpoint classification
        - Regulatory API validation
        
        Args:
            result: Raw SwaggerSummary from mapping_agents
            
        Returns:
            Enhanced SwaggerSummary
        """
        # Placeholder for future Data Mapper specific logic
        return result
    
    def get_document_stats(self, file_path: str) -> Dict[str, Any]:
        """
        Get quick statistics about a document without full parsing.
        
        Args:
            file_path: Path to document
            
        Returns:
            Dictionary with file stats (size, type, estimated processing time)
        """
        if not os.path.exists(file_path):
            raise ValueError(f"File not found: {file_path}")
        
        file_size = os.path.getsize(file_path)
        file_ext = Path(file_path).suffix.lower()
        file_type = self._detect_file_type(file_ext)
        
        # Estimate processing time based on file size
        # Rough estimate: 1MB = ~2 seconds
        estimated_seconds = max(1, file_size / (1024 * 1024) * 2)
        
        return {
            'file_path': file_path,
            'file_name': Path(file_path).name,
            'file_size_bytes': file_size,
            'file_size_mb': round(file_size / (1024 * 1024), 2),
            'file_type': file_type,
            'file_extension': file_ext,
            'estimated_processing_seconds': round(estimated_seconds, 1)
        }


# Convenience function for single-file processing
def process_document(file_path: str, project_id: Optional[str] = None):
    """
    Convenience function to process a single document.
    
    Args:
        file_path: Path to document
        project_id: Optional project identifier
        
    Returns:
        Appropriate Summary object based on document type
    """
    processor = DocumentProcessor(project_id=project_id)
    return processor.process_document(file_path)
