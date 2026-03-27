"""Custom exceptions for the mapping workflow."""
from __future__ import annotations

class MappingError(Exception):
    """Base exception for mapping plan failures."""

class MappingDataError(MappingError):
    """Raised when required data (files, wiki responses) is unavailable."""

class MappingValidationError(MappingError):
    """Raised when the generated mapping output fails validation checks."""

class MappingKnowledgeError(MappingError):
    """Raised when the knowledge-mining step encounters blocking issues."""
