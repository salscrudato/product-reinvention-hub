"""
Data Mapper Agents Package
--------------------------
Backend components for the Data Mapper Wizard functionality.

This package provides:
- Document processing (Excel, Word, Swagger/OpenAPI)
- Knowledge base management
- Agentic chat interface
- FAISS vector search integration

Architecture: Reuses proven parsers from mapping_agents with a thin adapter layer.
"""

__version__ = "1.0.0"

from .document_processor import DocumentProcessor

__all__ = ['DocumentProcessor']
