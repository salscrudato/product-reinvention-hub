"""
NIGO Resolvers - Product-Specific Context Augmentation

Two NIGO resolvers that query existing Wiki FAISS with product-specific context:

1. Life & Annuity NIGO Resolver
   - resolve_la_nigo: Query Wiki with L&A context
   - get_la_nigo_types: L&A NIGO type definitions
   
2. Property & Casualty NIGO Resolver  
   - resolve_pc_nigo: Query Wiki with P&C/Auto/Property context
   - get_pc_nigo_types: P&C NIGO type definitions

Both resolvers:
- Query existing Embeddings_Lookup_cache.index (no new FAISS needed)
- Augment queries with product-specific keywords
- Detect NIGO type from incident text
- Return Wiki knowledge + similar resolved cases
- Feed into orchestrator's planning logic

Usage:
    from components.domain.life_annuity_knowledge import resolve_la_nigo_tool
    from components.domain.pc_nigo_resolver import resolve_pc_nigo_tool
    
    # Orchestrator calls appropriate resolver based on product detection
    la_result = resolve_la_nigo_tool("INC0010001")
    pc_result = resolve_pc_nigo_tool("INC0020001")
"""

__all__ = [
    'resolve_la_nigo_tool',
    'get_la_nigo_types_tool',
    'resolve_pc_nigo_tool',
    'get_pc_nigo_types_tool'
]
