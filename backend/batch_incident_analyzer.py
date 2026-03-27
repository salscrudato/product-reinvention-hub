"""
Batch Incident Analyzer

This script analyzes existing incidents using the FAISS index without re-embedding:
1. Loads existing FAISS index and embeddings
2. Performs categorization on all incidents
3. Finds similar incidents for pattern detection
4. Identifies workaround opportunities
5. Suggests root cause patterns
6. Generates comprehensive analysis report

Run Modes:
- Full Analysis:  python batch_incident_analyzer.py --mode full
- Categories:     python batch_incident_analyzer.py --mode categorize
- Similarity:     python batch_incident_analyzer.py --mode similarity
- Workarounds:    python batch_incident_analyzer.py --mode workarounds
- Root Causes:    python batch_incident_analyzer.py --mode rootcause

Output:
- Analysis report: incident_analysis_report.json
- Categories DB:   incident_categories.json
- Patterns:        incident_patterns.json
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
from collections import defaultdict, Counter
import numpy as np
import faiss

# Add components to path
sys.path.insert(0, os.path.dirname(__file__))

from components.servicenowgenaitool import (
    fetch_all_incidents_core,
    get_cached_embedding,
    cache_embedding,
    generate_embeddings,
    load_or_create_faiss_index,
    GPT_MODEL_NAME
)
import openai
from components.intelligent_agents import (
    intelligent_workaround_search_core,
    identify_root_cause_core
)
from tinydb import TinyDB, Query

# Configuration
# Get script directory for absolute path resolution
SCRIPT_DIR = Path(__file__).parent.resolve()

# Try multiple locations for FAISS index (all relative to script directory)
FAISS_INDEX_PATHS = [
    SCRIPT_DIR / "incidents_production.index",      # Batch indexer output
    SCRIPT_DIR / "incident_similarity.index",       # Legacy similarity index
    SCRIPT_DIR / "code_embeddings.index"            # Fallback (might exist from old runs)
]
EMBEDDING_CACHE_PATH = SCRIPT_DIR / "embedding_cache.json"

# Output paths - will be set in main() to timestamped directory
OUTPUT_BASE_DIR: Path = SCRIPT_DIR  # type: ignore  # Will be set in main()
CATEGORIES_DB_PATH: Path = SCRIPT_DIR / "incident_categories.json"  # type: ignore  # Will be set in main()
PATTERNS_DB_PATH: Path = SCRIPT_DIR / "incident_patterns.json"  # type: ignore  # Will be set in main()
ANALYSIS_REPORT_PATH: Path = SCRIPT_DIR / "incident_analysis_report.json"  # type: ignore  # Will be set in main()
EMBEDDING_DIM = 1536

# Configure logging - will be reconfigured in main() to write to output directory
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
# Force stdout to use UTF-8 encoding on Windows
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
logger = logging.getLogger(__name__)

# Feature Flags
FULL_INCIDENT_EMBEDDED_SIMILARITY = os.getenv("FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS", "0").lower() in ("1", "true", "yes", "on")
VECTORED_INCIDENTS_ANALYSIS_ONLY = os.getenv("VECTORED_INCIDENTS_ANALYSIS_ONLY", "0").lower() in ("1", "true", "yes", "on")


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    vec1_np = np.array(vec1)
    vec2_np = np.array(vec2)
    
    dot_product = np.dot(vec1_np, vec2_np)
    norm1 = np.linalg.norm(vec1_np)
    norm2 = np.linalg.norm(vec2_np)
    
    if norm1 == 0 or norm2 == 0:
        return 0.0
    
    return float(dot_product / (norm1 * norm2))


class IncidentAnalyzer:
    """Analyzes incidents using existing FAISS embeddings."""
    
    # Pricing for GPT-3.5-Turbo (Azure OpenAI - confirmed from .env)
    COST_PER_1K_INPUT_TOKENS = 0.0005  # $0.50 per 1M input tokens
    COST_PER_1K_OUTPUT_TOKENS = 0.0015  # $1.50 per 1M output tokens
    
    def __init__(self):
        self.faiss_index: Optional[faiss.Index] = None
        self.embedding_cache: Dict[str, List[float]] = {}
        self.categories_db = TinyDB(str(CATEGORIES_DB_PATH))
        self.patterns_db = TinyDB(str(PATTERNS_DB_PATH))
        self.incidents: List[Dict[str, Any]] = []
        self.incident_map: Dict[str, Dict[str, Any]] = {}  # number -> incident
        self.filter_prefix: Optional[str] = None  # Incident number prefix filter
        
        # Cost tracking (uses actual Azure API usage data)
        self.cost_limit: float = 50.0  # Default $50 limit
        self.total_cost: float = 0.0
        self.total_input_tokens: int = 0
        self.total_output_tokens: int = 0
        self.api_call_count: int = 0
        
    def load_existing_index(self) -> bool:
        """Load existing FAISS index from multiple possible locations."""
        logger.info(f"🔍 Searching for FAISS index...")
        
        # Show feature flag status
        logger.info("")
        logger.info("🔧 FEATURE FLAGS:")
        logger.info(f"   FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS: {'ENABLED ✓' if FULL_INCIDENT_EMBEDDED_SIMILARITY else 'DISABLED'}")
        if FULL_INCIDENT_EMBEDDED_SIMILARITY:
            logger.info("   → Similarity search uses: short_description + work_notes (up to 2000 chars)")
            logger.info("   → Cache keys use 'FULL:' prefix")
        else:
            logger.info("   → Similarity search uses: short_description only (standard)")
        
        logger.info(f"   VECTORED_INCIDENTS_ANALYSIS_ONLY: {'ENABLED ✓' if VECTORED_INCIDENTS_ANALYSIS_ONLY else 'DISABLED'}")
        if VECTORED_INCIDENTS_ANALYSIS_ONLY:
            logger.info("   → Only analyzes incidents already in FAISS vector index")
            logger.info("   → Reduces cost by focusing on indexed incidents")
        else:
            logger.info("   → Analyzes ALL incidents from ServiceNow")
        logger.info("")
        
        # Try all known index locations
        for idx_path in FAISS_INDEX_PATHS:
            logger.info(f"   Checking: {idx_path}")
            if idx_path.exists():
                logger.info(f"   ✓ Found! Attempting to load...")
                try:
                    self.faiss_index = faiss.read_index(str(idx_path))
                    logger.info(f"✅ Loaded FAISS index from {idx_path.name} | vectors={self.faiss_index.ntotal}")
                    return True
                except Exception as e:
                    logger.warning(f"⚠️  Failed to load {idx_path}: {e}")
                    continue
            else:
                logger.info(f"   ✗ Not found")
        
        # No pre-built index found - try to build from embedding cache
        logger.warning(f"⚠️  No pre-built FAISS index found")
        logger.info(f"   Attempting to build index from embedding cache...")
        
        if not EMBEDDING_CACHE_PATH.exists():
            logger.error(f"❌ Embedding cache not found at {EMBEDDING_CACHE_PATH}")
            logger.error(f"   Please run batch_incident_indexer.py first to create embeddings.")
            return False
        
        try:
            # Load embedding cache
            with open(EMBEDDING_CACHE_PATH, 'r') as f:
                cache = json.load(f)
            
            # Handle nested structure: cache might have "embeddings" key or be flat
            if isinstance(cache, dict) and "embeddings" in cache:
                embeddings_dict = cache["embeddings"]
                logger.info(f"   Found nested cache structure with 'embeddings' key")
            else:
                embeddings_dict = cache
            
            if not embeddings_dict or len(embeddings_dict) == 0:
                logger.error(f"❌ Embedding cache is empty")
                return False
            
            logger.info(f"   Found {len(embeddings_dict)} cached embeddings")
            logger.info(f"   Building FAISS index from cache...")
            
            # Create new FAISS index
            self.faiss_index = faiss.IndexFlatL2(EMBEDDING_DIM)
            
            # Add all embeddings to index
            embeddings_added = 0
            for desc, embedding_data in embeddings_dict.items():
                # Handle multiple cache formats:
                # 1. Direct list: [0.1, 0.2, ...]
                # 2. Dict with "embedding" key: {"short_description": "...", "embedding": [...]}
                # 3. Dict with numeric keys: {"0": 0.1, "1": 0.2, ...}
                
                if isinstance(embedding_data, list) and len(embedding_data) == EMBEDDING_DIM:
                    embedding_array = embedding_data
                elif isinstance(embedding_data, dict) and "embedding" in embedding_data:
                    # Format: {"short_description": "...", "embedding": [...]}
                    embedding_array = embedding_data["embedding"]
                    if not isinstance(embedding_array, list) or len(embedding_array) != EMBEDDING_DIM:
                        logger.debug(f"Skipping invalid nested embedding for '{desc}'")
                        continue
                elif isinstance(embedding_data, dict):
                    # Format: {"0": val, "1": val, ...}
                    try:
                        embedding_array = [float(embedding_data[str(i)]) for i in range(EMBEDDING_DIM)]
                    except (KeyError, ValueError) as e:
                        logger.debug(f"Skipping invalid dict embedding for '{desc}': {e}")
                        continue
                else:
                    continue
                
                embedding_np = np.array(embedding_array, dtype='float32').reshape(1, -1)
                self.faiss_index.add(embedding_np)  # type: ignore[call-arg]
                embeddings_added += 1
            
            if embeddings_added == 0:
                logger.error(f"❌ No valid embeddings found in cache")
                return False
            
            logger.info(f"✅ Built FAISS index from cache | vectors={embeddings_added}")
            
            # Save for future use
            save_path = FAISS_INDEX_PATHS[0]  # Save to primary location
            try:
                faiss.write_index(self.faiss_index, str(save_path))
                logger.info(f"💾 Saved index to {save_path} for future use")
            except Exception as e:
                logger.warning(f"⚠️  Could not save index: {e}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to build index from cache: {e}")
            return False
    
    def load_embedding_cache(self):
        """Load embedding cache to map descriptions to embeddings."""
        if EMBEDDING_CACHE_PATH.exists():
            try:
                with open(EMBEDDING_CACHE_PATH, 'r') as f:
                    self.embedding_cache = json.load(f)
                logger.info(f"✅ Loaded {len(self.embedding_cache)} cached embeddings")
            except Exception as e:
                logger.error(f"❌ Failed to load embedding cache: {e}")
                self.embedding_cache = {}
        else:
            logger.warning(f"⚠️  Embedding cache not found at {EMBEDDING_CACHE_PATH}")
            self.embedding_cache = {}
    
    def fetch_incidents(self, limit: int = 10000) -> List[Dict[str, Any]]:
        """Fetch incidents from ServiceNow."""
        try:
            logger.info("📥 Fetching incidents from ServiceNow...")
            incidents = fetch_all_incidents_core()
            
            if isinstance(incidents, dict) and incidents.get('error'):
                logger.error(f"ServiceNow API error: {incidents.get('error')}")
                return []
            
            if incidents and len(incidents) > 0:
                logger.info(f"✅ Fetched {len(incidents)} incidents")
                
                # FEATURE: Filter to only vectorized incidents if flag is enabled
                if VECTORED_INCIDENTS_ANALYSIS_ONLY:
                    metadata_db_path = SCRIPT_DIR / "incidents_metadata.json"
                    if metadata_db_path.exists():
                        try:
                            from tinydb import TinyDB
                            metadata_db = TinyDB(str(metadata_db_path))
                            incidents_table = metadata_db.table('incidents')
                            vectorized_numbers = {inc.get('number') for inc in incidents_table.all() if inc.get('number')}
                            metadata_db.close()
                            
                            original_count = len(incidents)
                            incidents = [inc for inc in incidents if inc.get('number') in vectorized_numbers]  # type: ignore[union-attr]
                            
                            logger.info("")
                            logger.info("🔧 VECTORED_INCIDENTS_ANALYSIS_ONLY: ENABLED")
                            logger.info(f"   Total incidents from ServiceNow: {original_count}")
                            logger.info(f"   Vectorized incidents in index:   {len(vectorized_numbers)}")
                            logger.info(f"   Matching for analysis:           {len(incidents)}")
                            logger.info(f"   💡 Analyzing only indexed incidents for cost efficiency")
                            logger.info("")
                        except Exception as e:
                            logger.warning(f"⚠️  Could not load vectorized incident list: {e}")
                            logger.warning(f"   Continuing with all incidents...")
                    else:
                        logger.warning(f"⚠️  Metadata file not found: {metadata_db_path}")
                        logger.warning(f"   Run batch_incident_indexer.py first to create vector index")
                        logger.warning(f"   Continuing with all incidents...")
                
                # Apply incident number filter if specified
                if hasattr(self, 'filter_prefix') and self.filter_prefix:
                    original_count = len(incidents)
                    incidents = [inc for inc in incidents if inc.get('number', '').startswith(self.filter_prefix)]  # type: ignore[union-attr]
                    logger.info(f"🔍 FILTER APPLIED: Incident numbers starting with '{self.filter_prefix}'")
                    logger.info(f"   Before filter: {original_count} incidents")
                    logger.info(f"   After filter:  {len(incidents)} incidents")
                    logger.info("")
                    
                    if not incidents:
                        logger.warning(f"⚠️  No incidents match filter '{self.filter_prefix}'")
                        return []
                
                # Build incident map for quick lookup
                for inc in incidents:
                    inc_num = inc.get('number')  # type: ignore[union-attr]
                    if inc_num:
                        self.incident_map[inc_num] = inc  # type: ignore[assignment]
                return incidents  # type: ignore[return-value]
            else:
                logger.warning("⚠️  No incidents returned from ServiceNow")
                return []
                
        except Exception as e:
            logger.error(f"❌ Failed to fetch incidents: {e}")
            return []
    
    def categorize_incident(self, incident: Dict[str, Any]) -> str:
        """Categorize incident based on insurance business patterns."""
        desc = incident.get("short_description", "").lower()
        description = incident.get("description", "").lower()
        work_notes = incident.get("work_notes", "").lower() if incident.get("work_notes") else ""
        combined = f"{desc} {description} {work_notes}"
        
        # INSURANCE BUSINESS CATEGORIZATION
        # Policy Management & Administration
        if any(kw in combined for kw in ["policy", "policyholder", "renewal", "nonrenewal", "lapse", "reinstate", 
                                          "policy number", "policy holder", "policy owner", "certificate"]):
            return "policy_management"
        
        # Claims Processing
        elif any(kw in combined for kw in ["claim", "claimant", "loss", "settlement", "adjudication", "adjuster",
                                            "claim number", "claim status", "payout", "benefit payment"]):
            return "claims_processing"
        
        # Underwriting
        elif any(kw in combined for kw in ["underwriting", "underwriter", "uw ", "risk assessment", "rating", 
                                            "quote", "quotation", "approval", "declination", "application review"]):
            return "underwriting"
        
        # Billing & Payments  
        elif any(kw in combined for kw in ["billing", "premium", "payment", "invoice", "commission", "refund",
                                            "billing cycle", "direct bill", "premium notice", "payment failed"]):
            return "billing_payments"
        
        # Documents & Forms
        elif any(kw in combined for kw in ["document", "form", "letter", "notice", "template", "pdf", "generate",
                                            "print", "mail", "correspondence", "smartcomm", "docgen"]):
            return "documents_forms"
        
        # Agent/Broker Systems
        elif any(kw in combined for kw in ["agent", "broker", "producer", "agency", "commission statement",
                                            "agent portal", "licensing", "appointment"]):
            return "agent_broker"
        
        # System Integration Issues
        elif any(kw in combined for kw in ["integration", "interface", "data feed", "file transfer", "api",
                                            "sync", "replication", "import", "export", "batch job"]):
            return "system_integration"
        
        # Database & Data Issues
        elif any(kw in combined for kw in ["database", "query", "sql", "data", "table", "db", "repository",
                                            "data integrity", "duplicate", "missing data"]):
            return "database_data"
        
        # Application/System Performance
        elif any(kw in combined for kw in ["performance", "slow", "timeout", "response time", "lag", "hanging",
                                            "crashed", "down", "unavailable", "outage"]):
            return "performance_availability"
        
        # Authentication & Access
        elif any(kw in combined for kw in ["login", "auth", "password", "access denied", "permission", "unauthorized",
                                            "user account", "locked out"]):
            return "authentication_access"
        
        # Reporting & Analytics
        elif any(kw in combined for kw in ["report", "dashboard", "analytics", "metrics", "export", "query builder",
                                            "report generation", "business intelligence"]):
            return "reporting_analytics"
        
        else:
            return "other"
    
    def categorize_business_phase(self, incident: Dict[str, Any]) -> str:
        """Categorize by insurance business lifecycle phase."""
        desc = incident.get("short_description", "").lower()
        description = incident.get("description", "").lower()
        work_notes = incident.get("work_notes", "").lower() if incident.get("work_notes") else ""
        combined = f"{desc} {description} {work_notes}"
        
        # New Business / Application
        if any(kw in combined for kw in ["new business", "application", "new policy", "quote", "quotation", 
                                          "issue policy", "bind", "issuance"]):
            return "new_business"
        
        # Renewal Processing
        elif any(kw in combined for kw in ["renewal", "renew", "expiration", "expire", "renewal notice",
                                            "auto renew", "renewal processing"]):
            return "renewal"
        
        # Policy Changes / Endorsements
        elif any(kw in combined for kw in ["endorsement", "change", "modification", "update", "add", "remove",
                                            "policy change", "mid-term", "effective date change"]):
            return "endorsement"
        
        # Cancellation / Termination
        elif any(kw in combined for kw in ["cancel", "cancellation", "terminate", "non-renew", "lapse",
                                            "flat cancel", "pro-rata"]):
            return "cancellation"
        
        # Billing & Payment Cycle
        elif any(kw in combined for kw in ["billing", "payment", "premium", "invoice", "installment",
                                            "direct bill", "agency bill", "payment plan"]):
            return "billing_cycle"
        
        # Document Generation & Distribution
        elif any(kw in combined for kw in ["letter", "notice", "document", "generate", "print", "mail",
                                            "smartcomm", "correspondence", "declaration"]):
            return "document_generation"
        
        # Data Management / Interface
        elif any(kw in combined for kw in ["interface", "file", "import", "export", "data load", "batch",
                                            "integration", "feed"]):
            return "data_interface"
        
        # Inquiry / Servicing
        elif any(kw in combined for kw in ["inquiry", "lookup", "search", "view", "display", "report",
                                            "status", "information"]):
            return "inquiry_servicing"
        
        else:
            return "other_phase"
    
    def extract_solution_from_notes(self, incident: Dict[str, Any]) -> Dict[str, Any]:
        """Extract root cause and solution from work notes and close notes."""
        work_notes = incident.get("work_notes", "") or ""
        close_notes = incident.get("close_notes", "") or ""
        resolution_notes = incident.get("resolution_notes", "") or ""
        combined_notes = f"{work_notes}\n{close_notes}\n{resolution_notes}"
        
        # Extract key information
        solution_info = {
            "incident_number": incident.get("number"),
            "short_description": incident.get("short_description", ""),
            "state": incident.get("state"),
            "close_notes": close_notes[:500] if close_notes else "",
            "work_notes_summary": work_notes[:500] if work_notes else "",
            "has_root_cause": False,
            "root_cause": "",
            "has_solution": False,
            "solution": "",
            "solution_type": "",
            "involved_components": []
        }
        
        notes_lower = combined_notes.lower()
        
        # Detect root cause mentions
        root_cause_indicators = ["root cause", "caused by", "due to", "because", "reason", "issue was",
                                 "problem was", "found that", "discovered", "identified"]
        for indicator in root_cause_indicators:
            if indicator in notes_lower:
                solution_info["has_root_cause"] = True
                # Extract sentence containing root cause
                sentences = combined_notes.split('.')
                for sent in sentences:
                    if indicator in sent.lower():
                        solution_info["root_cause"] = sent.strip()[:200]
                        break
                break
        
        # Detect solution type
        if any(kw in notes_lower for kw in ["configured", "configuration change", "setting", "parameter"]):
            solution_info["solution_type"] = "configuration_change"
        elif any(kw in notes_lower for kw in ["code change", "fix deployed", "patch", "hotfix", "release"]):
            solution_info["solution_type"] = "code_fix"
        elif any(kw in notes_lower for kw in ["restarted", "restart", "reboot", "recycled"]):
            solution_info["solution_type"] = "service_restart"
        elif any(kw in notes_lower for kw in ["data fix", "corrected data", "updated record", "manual update"]):
            solution_info["solution_type"] = "data_correction"
        elif any(kw in notes_lower for kw in ["workflow", "process change", "procedure", "business rule"]):
            solution_info["solution_type"] = "process_change"
        elif any(kw in notes_lower for kw in ["user error", "training", "instructed", "guidance"]):
            solution_info["solution_type"] = "user_training"
        elif any(kw in notes_lower for kw in ["workaround", "temporary fix", "bypass"]):
            solution_info["solution_type"] = "workaround"
        
        # Detect involved components
        components = ["smartcomm", "policy admin", "billing", "underwriting", "document", "database",
                      "interface", "api", "portal", "web service"]
        for comp in components:
            if comp in notes_lower:
                solution_info["involved_components"].append(comp)
        
        # Extract solution description
        solution_indicators = ["resolved by", "fixed by", "solution", "corrected", "resolved", "fixed"]
        for indicator in solution_indicators:
            if indicator in notes_lower:
                solution_info["has_solution"] = True
                sentences = combined_notes.split('.')
                for sent in sentences:
                    if indicator in sent.lower():
                        solution_info["solution"] = sent.strip()[:200]
                        break
                break
        
        return solution_info
    
    def find_similar_incidents(self, incident: Dict[str, Any], top_k: int = 5) -> List[Dict[str, Any]]:
        """Find similar incidents using FAISS."""
        short_desc = incident.get("short_description", "")
        
        # Determine embedding lookup based on feature flag
        if FULL_INCIDENT_EMBEDDED_SIMILARITY:
            # Use combined embedding (short_description + work_notes)
            work_notes = incident.get("work_notes", "") or ""
            work_notes_truncated = work_notes[:2000] if work_notes else ""
            embedding_text = f"{short_desc}\n\n{work_notes_truncated}".strip()
            cache_key = f"FULL:{short_desc}"  # Match indexer's cache key
            
            # Get or generate embedding
            embedding = get_cached_embedding(cache_key)
            if embedding is None:
                # Not in cache - generate on-the-fly
                logger.debug(f"Generating FULL embedding for {incident.get('number')}")
                embedding = generate_embeddings([embedding_text])[0]
                cache_embedding(cache_key, embedding)
        else:
            # Standard mode: only short_description
            cache_key = short_desc
            embedding = get_cached_embedding(cache_key)
        
        if embedding is None:
            logger.debug(f"No embedding found for {incident.get('number')} (key: {cache_key[:50]}...)")
            return []
        
        try:
            # Search in FAISS
            query_vector = np.array(embedding, dtype='float32').reshape(1, -1)
            distances, indices = self.faiss_index.search(query_vector, top_k + 1)  # type: ignore[call-arg]
            
            similar = []
            for idx, dist in zip(indices[0], distances[0]):
                if idx < 0 or idx >= len(self.incidents):
                    continue
                
                similar_inc = self.incidents[idx]
                if similar_inc.get('number') == incident.get('number'):
                    continue  # Skip self
                
                # Convert L2 distance to similarity score
                similarity_score = 1 / (1 + float(dist))
                
                similar.append({
                    "number": similar_inc.get("number"),
                    "short_description": similar_inc.get("short_description"),
                    "state": similar_inc.get("state"),
                    "priority": similar_inc.get("priority"),
                    "similarity_score": similarity_score
                })
            
            return similar[:top_k]
            
        except Exception as e:
            logger.error(f"Error finding similar incidents for {incident.get('number')}: {e}")
            return []
    
    def analyze_categories(self):
        """Phase 1: Categorize all incidents."""
        logger.info("")
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 25 + "INCIDENT CATEGORIZATION" + " " * 30 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        
        start_time = datetime.now()
        
        if not self.incidents:
            self.incidents = self.fetch_incidents()
        
        if not self.incidents:
            logger.error("❌ No incidents to analyze")
            return
        
        logger.info(f"📊 Categorizing {len(self.incidents)} incidents...")
        logger.info("")
        
        category_stats = defaultdict(int)
        categorized_incidents = []
        
        for idx, incident in enumerate(self.incidents):
            category = self.categorize_incident(incident)
            category_stats[category] += 1
            
            categorized_incidents.append({
                "number": incident.get("number"),
                "short_description": incident.get("short_description"),
                "category": category,
                "state": incident.get("state"),
                "priority": incident.get("priority"),
                "created_at": incident.get("sys_created_on")
            })
            
            if (idx + 1) % 50 == 0 or (idx + 1) == len(self.incidents):
                progress_pct = ((idx + 1) / len(self.incidents)) * 100
                bar_length = 40
                filled = int(bar_length * (idx + 1) / len(self.incidents))
                bar = '█' * filled + '░' * (bar_length - filled)
                logger.info(f"   {bar} {progress_pct:5.1f}% | {idx + 1}/{len(self.incidents)}")
        
        # Save to database
        self.categories_db.truncate()
        self.categories_db.insert_multiple(categorized_incidents)
        
        duration = (datetime.now() - start_time).total_seconds()
        
        logger.info("")
        logger.info("✅ Categorization complete!")
        logger.info("")
        logger.info("📈 CATEGORY DISTRIBUTION:")
        
        total = sum(category_stats.values())
        for category, count in sorted(category_stats.items(), key=lambda x: x[1], reverse=True):
            pct = (count / total * 100) if total > 0 else 0
            bar = "█" * int(pct / 2)
            logger.info(f"   {category:20s}: {count:4d} ({pct:5.1f}%) {bar}")
        
        logger.info("")
        logger.info(f"⏱️  Time: {duration:.1f}s")
        logger.info(f"📁 Saved to: {CATEGORIES_DB_PATH}")
        logger.info("")
        logger.info("#" * 80)
        logger.info("")
    
    def analyze_similarity_patterns(self, similarity_threshold: float = 0.75):
        """Phase 2: Find incident clusters and patterns."""
        logger.info("")
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 22 + "SIMILARITY PATTERN ANALYSIS" + " " * 27 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        
        start_time = datetime.now()
        
        if not self.faiss_index:
            logger.error("❌ FAISS index not loaded")
            return
        
        if not self.incidents:
            self.incidents = self.fetch_incidents()
        
        logger.info(f"🔍 Analyzing similarity patterns for {len(self.incidents)} incidents...")
        logger.info(f"   Similarity threshold: {similarity_threshold}")
        logger.info("")
        
        patterns = []
        clusters = defaultdict(list)
        processed = 0
        
        for idx, incident in enumerate(self.incidents):
            inc_num = incident.get("number")
            
            similar = self.find_similar_incidents(incident, top_k=10)
            
            # Filter by threshold
            high_similarity = [s for s in similar if s['similarity_score'] >= similarity_threshold]
            
            if high_similarity:
                patterns.append({
                    "incident_number": inc_num,
                    "short_description": incident.get("short_description"),
                    "similar_count": len(high_similarity),
                    "similar_incidents": high_similarity,
                    "category": self.categorize_incident(incident),
                    "analyzed_at": datetime.now().isoformat()
                })
                
                # Group into clusters
                category = self.categorize_incident(incident)
                clusters[category].append({
                    "number": inc_num,
                    "similar_count": len(high_similarity)
                })
            
            processed += 1
            
            if processed % 25 == 0 or processed == len(self.incidents):
                progress_pct = (processed / len(self.incidents)) * 100
                bar_length = 40
                filled = int(bar_length * processed / len(self.incidents))
                bar = '█' * filled + '░' * (bar_length - filled)
                logger.info(f"   {bar} {progress_pct:5.1f}% | {processed}/{len(self.incidents)} | Patterns: {len(patterns)}")
        
        # Save patterns
        self.patterns_db.truncate()
        self.patterns_db.insert_multiple(patterns)
        
        duration = (datetime.now() - start_time).total_seconds()
        
        logger.info("")
        logger.info("✅ Similarity analysis complete!")
        logger.info("")
        logger.info("📊 PATTERN STATISTICS:")
        logger.info(f"   Incidents analyzed:        {len(self.incidents)}")
        logger.info(f"   Patterns found:            {len(patterns)}")
        logger.info(f"   Incidents with similars:   {len(patterns)} ({len(patterns)/len(self.incidents)*100:.1f}%)")
        logger.info("")
        logger.info("📈 CLUSTERS BY CATEGORY:")
        for category, incidents_list in sorted(clusters.items(), key=lambda x: len(x[1]), reverse=True):
            avg_similar = sum(i['similar_count'] for i in incidents_list) / len(incidents_list) if incidents_list else 0
            logger.info(f"   {category:20s}: {len(incidents_list):3d} incidents | Avg similar: {avg_similar:.1f}")
        
        logger.info("")
        logger.info(f"⏱️  Time: {duration:.1f}s ({len(self.incidents)/duration:.1f} inc/s)")
        logger.info(f"📁 Saved to: {PATTERNS_DB_PATH}")
        logger.info("")
        logger.info("#" * 80)
        logger.info("")
    
    def analyze_workarounds(self):
        """Phase 3: Identify workaround opportunities."""
        logger.info("")
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 25 + "WORKAROUND ANALYSIS" + " " * 32 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        
        start_time = datetime.now()
        
        if not self.incidents:
            self.incidents = self.fetch_incidents()
        
        logger.info(f"🔧 Analyzing workaround opportunities for {len(self.incidents)} incidents...")
        logger.info("")
        
        workaround_candidates = []
        
        # Focus on unresolved incidents
        unresolved = [inc for inc in self.incidents if inc.get('state') not in ['6', '7', '8']]
        logger.info(f"   Found {len(unresolved)} unresolved incidents")
        logger.info("")
        
        if len(unresolved) == 0:
            logger.info("   ℹ️  All incidents in the dataset are resolved (state 6/7/8)")
            logger.info("   No workaround opportunities to analyze.")
            logger.info("")
            duration = (datetime.now() - start_time).total_seconds()
            logger.info("✅ Workaround analysis complete!")
            logger.info("")
            logger.info("📊 ANALYSIS RESULTS:")
            logger.info(f"   Unresolved incidents:      0")
            logger.info(f"   With resolved similar:     0 (N/A - all incidents resolved)")
            logger.info("")
            logger.info(f"⏱️  Time: {duration:.1f}s")
            logger.info("")
            logger.info("#" * 80)
            logger.info("")
            return []
        
        for idx, incident in enumerate(unresolved):
            inc_num = incident.get("number")
            short_desc = incident.get("short_description", "")
            
            # Find similar resolved incidents
            similar = self.find_similar_incidents(incident, top_k=10)
            resolved_similar = [s for s in similar if s.get('state') in ['6', '7', '8']]
            
            if resolved_similar:
                workaround_candidates.append({
                    "incident_number": inc_num,
                    "short_description": short_desc,
                    "state": incident.get("state"),
                    "resolved_similar_count": len(resolved_similar),
                    "resolved_similar": resolved_similar,
                    "category": self.categorize_incident(incident),
                    "recommendation": "Review work notes from similar resolved incidents",
                    "analyzed_at": datetime.now().isoformat()
                })
            
            if len(unresolved) > 0 and ((idx + 1) % 10 == 0 or (idx + 1) == len(unresolved)):
                progress_pct = ((idx + 1) / len(unresolved)) * 100
                bar_length = 40
                filled = int(bar_length * (idx + 1) / len(unresolved))
                bar = '█' * filled + '░' * (bar_length - filled)
                logger.info(f"   {bar} {progress_pct:5.1f}% | {idx + 1}/{len(unresolved)} | Candidates: {len(workaround_candidates)}")
        
        duration = (datetime.now() - start_time).total_seconds()
        
        logger.info("")
        logger.info("✅ Workaround analysis complete!")
        logger.info("")
        logger.info("📊 ANALYSIS RESULTS:")
        logger.info(f"   Unresolved incidents:      {len(unresolved)}")
        if len(unresolved) > 0:
            logger.info(f"   With resolved similar:     {len(workaround_candidates)} ({len(workaround_candidates)/len(unresolved)*100:.1f}%)")
        else:
            logger.info(f"   With resolved similar:     {len(workaround_candidates)} (N/A - all incidents resolved)")
        logger.info("")
        logger.info("🔝 TOP WORKAROUND OPPORTUNITIES:")
        
        # Show top 10 by number of resolved similar
        top_candidates = sorted(workaround_candidates, key=lambda x: x['resolved_similar_count'], reverse=True)[:10]
        for i, candidate in enumerate(top_candidates, 1):
            logger.info(f"   {i:2d}. {candidate['incident_number']}: {candidate['resolved_similar_count']} resolved similar")
            logger.info(f"       {candidate['short_description'][:70]}")
        
        logger.info("")
        logger.info(f"⏱️  Time: {duration:.1f}s")
        logger.info("")
        logger.info("#" * 80)
        logger.info("")
        
        return workaround_candidates
    
    def analyze_root_causes(self):
        """Phase 4: Identify root cause patterns."""
        logger.info("")
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 23 + "ROOT CAUSE PATTERN ANALYSIS" + " " * 26 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        
        start_time = datetime.now()
        
        logger.info(f"🔍 Analyzing root cause patterns...")
        logger.info("")
        
        # Load patterns from database
        patterns = self.patterns_db.all()
        
        if not patterns:
            logger.warning("⚠️  No patterns found. Run similarity analysis first.")
            return
        
        logger.info(f"   Loaded {len(patterns)} patterns")
        logger.info("")
        
        # Group by category and analyze
        category_patterns = defaultdict(list)
        for pattern in patterns:
            category = pattern.get('category', 'other')
            category_patterns[category].append(pattern)
        
        logger.info("📈 ROOT CAUSE INSIGHTS BY CATEGORY:")
        logger.info("")
        
        root_cause_report = []
        
        for category, cat_patterns in sorted(category_patterns.items(), key=lambda x: len(x[1]), reverse=True):
            total_patterns = len(cat_patterns)
            avg_similar = sum(p['similar_count'] for p in cat_patterns) / total_patterns if total_patterns else 0
            
            logger.info(f"🔸 {category.upper()}:")
            logger.info(f"   Patterns: {total_patterns}")
            logger.info(f"   Avg similar per incident: {avg_similar:.1f}")
            
            # Find most common similar incidents (potential root cause indicators)
            similar_counter = Counter()
            for pattern in cat_patterns:
                for similar in pattern.get('similar_incidents', []):
                    similar_counter[similar['number']] += 1
            
            category_insights = {
                "category": category,
                "total_patterns": total_patterns,
                "avg_similar": avg_similar,
                "root_cause_candidates": []
            }
            
            if similar_counter:
                logger.info(f"   Most referenced incidents (possible root causes):")
                for inc_num, count in similar_counter.most_common(5):
                    if inc_num in self.incident_map:
                        inc = self.incident_map[inc_num]
                        short_desc = inc.get('short_description', '')
                        logger.info(f"      • {inc_num}: Referenced {count} times")
                        logger.info(f"        Description: {short_desc[:80]}")
                        logger.info(f"        Impact: {count} incidents show similar pattern - investigate for systemic issue")
                        
                        category_insights["root_cause_candidates"].append({
                            "incident_number": inc_num,
                            "reference_count": count,
                            "short_description": short_desc,
                            "recommendation": f"Review this incident - it appears in {count} similarity clusters, indicating potential systemic issue"
                        })
                else:
                    logger.info(f"   No highly-referenced incidents found")
            
            root_cause_report.append(category_insights)
            logger.info("")
        
        # Save detailed root cause report
        try:
            with open(ANALYSIS_REPORT_PATH, 'w') as f:
                json.dump({
                    "generated_at": datetime.now().isoformat(),
                    "total_patterns_analyzed": len(patterns),
                    "categories": len(category_patterns),
                    "root_cause_insights": root_cause_report
                }, f, indent=2)
            logger.info(f"📁 Detailed root cause report saved to: {ANALYSIS_REPORT_PATH}")
            logger.info("")
        except Exception as e:
            logger.error(f"Failed to save root cause report: {e}")
        
        duration = (datetime.now() - start_time).total_seconds()
        
        logger.info(f"⏱️  Time: {duration:.1f}s")
        logger.info("")
        logger.info("#" * 80)
        logger.info("")
    
    def analyze_business_phase_solutions(self) -> Dict[str, Any]:
        """Phase 5: Analyze incidents by business phase and extract solutions."""
        logger.info("=" * 80)
        logger.info("PHASE 5: BUSINESS PHASE & SOLUTION ANALYSIS")
        logger.info("=" * 80)
        logger.info("")
        
        start_time = datetime.now()
        
        # Group incidents by business phase
        phase_data: Dict[str, Dict[str, Any]] = defaultdict(lambda: {  # type: ignore
            "incidents": [],
            "categories": defaultdict(int),
            "solution_types": defaultdict(int),
            "components": defaultdict(int),
            "problems": []
        })
        
        logger.info("🔍 Analyzing business phases and extracting solutions...")
        logger.info("")
        
        for idx, incident in enumerate(self.incidents):
            # Categorize by phase
            phase = self.categorize_business_phase(incident)
            category = self.categorize_incident(incident)
            
            # Extract solution information
            solution_info = self.extract_solution_from_notes(incident)
            
            # Add to phase data
            phase_data[phase]["incidents"].append(incident.get("number"))
            phase_data[phase]["categories"][category] += 1
            
            if solution_info["solution_type"]:
                phase_data[phase]["solution_types"][solution_info["solution_type"]] += 1
            
            for component in solution_info["involved_components"]:
                phase_data[phase]["components"][component] += 1
            
            # Store problem details
            phase_data[phase]["problems"].append({
                "incident": incident.get("number"),
                "description": incident.get("short_description", "")[:80],
                "category": category,
                "has_root_cause": solution_info["has_root_cause"],
                "root_cause": solution_info["root_cause"],
                "has_solution": solution_info["has_solution"],
                "solution": solution_info["solution"],
                "solution_type": solution_info["solution_type"]
            })
            
            # Progress update
            if (idx + 1) % 20 == 0 or (idx + 1) == len(self.incidents):
                progress = (idx + 1) / len(self.incidents) * 100
                logger.info(f"   Progress: {progress:.1f}% | {idx + 1}/{len(self.incidents)}")
        
        logger.info("")
        logger.info("✅ Business phase analysis complete!")
        logger.info("")
        
        # Display results by phase
        logger.info("=" * 80)
        logger.info("BUSINESS PHASE BREAKDOWN")
        logger.info("=" * 80)
        logger.info("")
        
        phase_names = {
            "new_business": "🆕 New Business / Application",
            "renewal": "🔄 Renewal Processing",
            "endorsement": "📝 Policy Changes / Endorsements",
            "cancellation": "❌ Cancellation / Termination",
            "billing_cycle": "💰 Billing & Payment Cycle",
            "document_generation": "📄 Document Generation & Distribution",
            "data_interface": "🔗 Data Management / Interface",
            "inquiry_servicing": "🔍 Inquiry / Servicing",
            "other_phase": "📦 Other Operations"
        }
        
        for phase, data in sorted(phase_data.items(), key=lambda x: len(x[1]["incidents"]), reverse=True):
            phase_name = phase_names.get(phase, phase)
            incident_count = len(data["incidents"])
            percentage = (incident_count / len(self.incidents)) * 100
            
            logger.info(f"{phase_name}")
            logger.info(f"   Incidents: {incident_count} ({percentage:.1f}%)")
            
            # Top categories in this phase
            if data["categories"]:
                logger.info(f"   Top Categories:")
                for cat, count in sorted(data["categories"].items(), key=lambda x: x[1], reverse=True)[:3]:
                    cat_pct = (count / incident_count) * 100
                    logger.info(f"      • {cat}: {count} ({cat_pct:.0f}%)")
            
            # Solution types used
            if data["solution_types"]:
                logger.info(f"   Solution Types:")
                for sol_type, count in sorted(data["solution_types"].items(), key=lambda x: x[1], reverse=True)[:3]:
                    sol_pct = (count / incident_count) * 100
                    logger.info(f"      • {sol_type.replace('_', ' ').title()}: {count} ({sol_pct:.0f}%)")
            
            # Components involved
            if data["components"]:
                top_components = sorted(data["components"].items(), key=lambda x: x[1], reverse=True)[:3]
                comp_list = ", ".join([f"{comp} ({count})" for comp, count in top_components])
                logger.info(f"   Common Components: {comp_list}")
            
            # Sample problems with solutions
            problems_with_solutions = [p for p in data["problems"] if p["has_solution"]]
            if problems_with_solutions:
                logger.info(f"   Sample Solutions:")
                for problem in problems_with_solutions[:2]:
                    logger.info(f"      • {problem['incident']}: {problem['description']}")
                    if problem["solution"]:
                        logger.info(f"        Solution: {problem['solution'][:100]}...")
            
            logger.info("")
        
        # Summary statistics
        logger.info("=" * 80)
        logger.info("SOLUTION EXTRACTION SUMMARY")
        logger.info("=" * 80)
        logger.info("")
        
        total_with_root_cause = sum(1 for phase_data_item in phase_data.values() 
                                     for problem in phase_data_item["problems"] 
                                     if problem["has_root_cause"])
        total_with_solution = sum(1 for phase_data_item in phase_data.values() 
                                   for problem in phase_data_item["problems"] 
                                   if problem["has_solution"])
        
        logger.info(f"   Total Incidents Analyzed: {len(self.incidents)}")
        logger.info(f"   With Root Cause Info:    {total_with_root_cause} ({total_with_root_cause/len(self.incidents)*100:.1f}%)")
        logger.info(f"   With Solution Info:      {total_with_solution} ({total_with_solution/len(self.incidents)*100:.1f}%)")
        logger.info("")
        
        # All solution types across all phases
        all_solution_types = defaultdict(int)
        for data in phase_data.values():
            for sol_type, count in data["solution_types"].items():
                all_solution_types[sol_type] += count
        
        if all_solution_types:
            logger.info("   Solution Types Across All Phases:")
            for sol_type, count in sorted(all_solution_types.items(), key=lambda x: x[1], reverse=True):
                pct = (count / len(self.incidents)) * 100
                logger.info(f"      • {sol_type.replace('_', ' ').title()}: {count} ({pct:.1f}%)")
        
        duration = (datetime.now() - start_time).total_seconds()
        logger.info("")
        logger.info(f"⏱️  Time: {duration:.1f}s")
        logger.info("")
        
        # Save detailed report
        report_data = {
            "generated_at": datetime.now().isoformat(),
            "total_incidents": len(self.incidents),
            "phases": {}
        }
        
        for phase, data in phase_data.items():
            report_data["phases"][phase] = {
                "incident_count": len(data["incidents"]),
                "percentage": (len(data["incidents"]) / len(self.incidents)) * 100,
                "incidents": data["incidents"],
                "categories": dict(data["categories"]),
                "solution_types": dict(data["solution_types"]),
                "components": dict(data["components"]),
                "problems": data["problems"]
            }
        
        output_file = "incident_phase_solutions.json"
        with open(output_file, 'w') as f:
            json.dump(report_data, f, indent=2)
        
        logger.info(f"💾 Detailed phase & solution report saved to: {output_file}")
        logger.info("")
        logger.info("#" * 80)
        logger.info("")
        
        return report_data
    
    def generate_full_report(self):
        """Generate comprehensive analysis report."""
        logger.info("")
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 20 + "COMPREHENSIVE ANALYSIS REPORT" + " " * 27 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        
        report_start = datetime.now()
        
        # Run all analyses
        logger.info("🚀 Running full analysis pipeline...")
        logger.info("")
        
        self.analyze_categories()
        self.analyze_similarity_patterns()
        workarounds = self.analyze_workarounds()
        self.analyze_root_causes()
        self.analyze_business_phase_solutions()  # NEW: Phase 5
        
        # Compile report
        report = {
            "generated_at": datetime.now().isoformat(),
            "total_incidents": len(self.incidents),
            "faiss_vectors": self.faiss_index.ntotal if self.faiss_index else 0,
            "categories": len(self.categories_db.all()),
            "patterns": len(self.patterns_db.all()),
            "workaround_opportunities": len(workarounds) if workarounds else 0,
            "summary": {
                "incidents_analyzed": len(self.incidents),
                "patterns_identified": len(self.patterns_db.all()),
                "workaround_candidates": len(workarounds) if workarounds else 0
            }
        }
        
        with open(ANALYSIS_REPORT_PATH, 'w') as f:
            json.dump(report, f, indent=2)
        
        total_duration = (datetime.now() - report_start).total_seconds()
        
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 25 + "ANALYSIS COMPLETE!" + " " * 31 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        logger.info("📊 FINAL SUMMARY:")
        logger.info(f"   Total incidents:         {report['total_incidents']}")
        logger.info(f"   FAISS vectors used:      {report['faiss_vectors']}")
        logger.info(f"   Categories assigned:     {report['categories']}")
        logger.info(f"   Patterns identified:     {report['patterns']}")
        logger.info(f"   Workaround opportunities: {report['workaround_opportunities']}")
        logger.info("")
        logger.info("📁 OUTPUT FILES:")
        logger.info(f"   Categories:  {CATEGORIES_DB_PATH}")
        logger.info(f"   Patterns:    {PATTERNS_DB_PATH}")
        logger.info(f"   Report:      {ANALYSIS_REPORT_PATH}")
        logger.info("")
        logger.info(f"⏱️  Total analysis time: {total_duration:.1f}s ({total_duration/60:.1f} minutes)")
        logger.info("")
        logger.info("✅ All analyses complete! Check the output files for detailed results.")
        logger.info("")
        logger.info("#" * 80)
        logger.info("")
        
        # NOW CONSOLIDATE INTO ONE FILE
        self.consolidate_all_results()
    
    def consolidate_all_results(self):
        """Consolidate all analysis results into ONE comprehensive file."""
        logger.info("")
        logger.info("=" * 80)
        logger.info("CONSOLIDATING ALL RESULTS INTO ONE FILE")
        logger.info("=" * 80)
        logger.info("")
        
        # Load all the analysis results
        categories_data = self.categories_db.all() if hasattr(self, 'categories_db') else []
        patterns_data = self.patterns_db.all() if hasattr(self, 'patterns_db') else []
        
        # Load phase solutions if exists
        phase_solutions_path = OUTPUT_BASE_DIR / "incident_phase_solutions.json"
        phase_solutions = {}
        if phase_solutions_path.exists():
            with open(phase_solutions_path, 'r') as f:
                phase_solutions = json.load(f)
        
        # Load root cause report if exists
        root_cause_path = OUTPUT_BASE_DIR / "incident_analysis_report.json"
        root_causes = {}
        if root_cause_path.exists():
            with open(root_cause_path, 'r') as f:
                root_causes = json.load(f)
        
        # Build comprehensive consolidated data
        consolidated = {
            "generated_at": datetime.now().isoformat(),
            "analysis_type": "FAISS-Based Comprehensive Analysis",
            "total_incidents": len(self.incidents),
            "faiss_index_vectors": self.faiss_index.ntotal if self.faiss_index else 0,
            "summary": {
                "categories": len(set(c.get('category') for c in categories_data)),
                "patterns_identified": len(patterns_data),
                "business_phases": len(phase_solutions.get('phases', {})),
                "root_cause_candidates": len(root_causes.get('root_cause_insights', []))
            },
            "categories": self._group_by_category(categories_data),
            "similarity_patterns": patterns_data,
            "root_cause_analysis": root_causes,
            "business_phase_analysis": phase_solutions,
            "all_incidents_detailed": self._build_detailed_incident_list(
                categories_data, patterns_data, phase_solutions
            )
        }
        
        # Generate filename with timestamp
        output_filename = f"CONSOLIDATED_INCIDENT_ANALYSIS_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        output_path = OUTPUT_BASE_DIR / output_filename
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(consolidated, f, indent=2, ensure_ascii=False)
        
        logger.info(f"💾 CONSOLIDATED FILE CREATED:")
        logger.info(f"   {output_path}")
        logger.info("")
        logger.info("📋 Contents:")
        logger.info(f"   ✓ {len(categories_data)} incidents categorized")
        logger.info(f"   ✓ {len(patterns_data)} similarity patterns")
        logger.info(f"   ✓ {len(phase_solutions.get('phases', {}))} business phases")
        logger.info(f"   ✓ {len(root_causes.get('root_cause_insights', []))} root cause insights")
        logger.info("")
        logger.info("=" * 80)
        logger.info("")
        
        return str(output_path)
    
    def _group_by_category(self, categories_data):
        """Group incidents by category with stats."""
        category_groups = defaultdict(list)
        for item in categories_data:
            cat = item.get('category', 'other')
            category_groups[cat].append(item)
        
        result = {}
        for category, incidents in category_groups.items():
            result[category] = {
                "incident_count": len(incidents),
                "percentage": (len(incidents) / len(categories_data) * 100) if categories_data else 0,
                "incidents": incidents
            }
        return result
    
    def _build_detailed_incident_list(self, categories_data, patterns_data, phase_solutions):
        """Build detailed list with all info per incident."""
        incident_map = {}
        
        # Add category info
        for cat_item in categories_data:
            inc_num = cat_item.get('number')
            if inc_num:
                incident_map[inc_num] = {
                    "incident_number": inc_num,
                    "category": cat_item.get('category'),
                    "short_description": cat_item.get('short_description'),
                    "state": cat_item.get('state'),
                    "priority": cat_item.get('priority')
                }
        
        # Add pattern info (similar incidents)
        for pattern in patterns_data:
            inc_num = pattern.get('incident')
            if inc_num and inc_num in incident_map:
                incident_map[inc_num]['similar_incidents'] = pattern.get('similar_incidents', [])
                incident_map[inc_num]['similarity_score'] = pattern.get('category')
        
        # Add phase info
        if 'phases' in phase_solutions:
            for phase_name, phase_data in phase_solutions['phases'].items():
                for problem in phase_data.get('problems', []):
                    inc_num = problem.get('incident')
                    if inc_num and inc_num in incident_map:
                        incident_map[inc_num]['business_phase'] = phase_name
                        incident_map[inc_num]['root_cause'] = problem.get('root_cause', '')
                        incident_map[inc_num]['resolution'] = problem.get('solution', '')
                        incident_map[inc_num]['solution_type'] = problem.get('solution_type', '')
        
        return list(incident_map.values())
    
    def generate_comprehensive_llm_report(self):
        """Generate ONE consolidated report using LLM to learn from work notes."""
        logger.info("")
        logger.info("=" * 80)
        logger.info(" " * 15 + "COMPREHENSIVE AI-POWERED INCIDENT ANALYSIS")
        logger.info(" " * 10 + "(Learning Insurance Terminology from Work Notes)")
        logger.info("=" * 80)
        logger.info("")
        
        report_start = datetime.now()
        
        if not self.incidents:
            self.incidents = self.fetch_incidents()
        
        if not self.incidents:
            logger.error("❌ No incidents to analyze")
            return
        
        logger.info(f"📊 Analyzing {len(self.incidents)} incidents with AI...")
        logger.info(f"   Each incident categorized based on actual work notes content")
        logger.info("")
        
        # Pre-run cost estimation (rough estimate for warning)
        estimated_input_tokens = len(self.incidents) * 300
        estimated_output_tokens = len(self.incidents) * 500
        estimated_cost = (
            (estimated_input_tokens / 1000) * self.COST_PER_1K_INPUT_TOKENS +
            (estimated_output_tokens / 1000) * self.COST_PER_1K_OUTPUT_TOKENS
        )
        
        logger.info("💰 COST ESTIMATION (Pre-Run):")
        logger.info(f"   Incidents to analyze: {len(self.incidents):,}")
        logger.info(f"   Estimated input tokens: {estimated_input_tokens:,}")
        logger.info(f"   Estimated output tokens: {estimated_output_tokens:,}")
        logger.info(f"   Estimated cost: ${estimated_cost:.2f}")
        logger.info(f"   Cost limit: ${self.cost_limit:.2f}")
        
        if estimated_cost > self.cost_limit:
            logger.warning("")
            logger.warning("⚠️  COST LIMIT EXCEEDED (ESTIMATED)!")
            logger.warning(f"   Estimated cost (${estimated_cost:.2f}) > Limit (${self.cost_limit:.2f})")
            logger.warning(f"   This would analyze {len(self.incidents)} incidents with LLM calls")
            logger.warning("")
            logger.warning("💡 OPTIONS:")
            logger.warning("   1. Use --filter-prefix to reduce incidents (e.g., --filter-prefix INC9)")
            logger.warning("   2. Increase limit with --cost-limit (e.g., --cost-limit 100)")
            logger.warning("   3. Use 'unified' or 'similarity' mode instead (much cheaper)")
            logger.warning("")
            
            user_input = input("⚠️  Continue anyway? Actual costs will be tracked in real-time. (yes/no): ").strip().lower()
            if user_input not in ['yes', 'y']:
                logger.info("❌ Analysis cancelled by user")
                return
            logger.info("✅ User confirmed - continuing with real-time cost tracking...")
            logger.info("")
        else:
            logger.info(f"   ✅ Within budget (${estimated_cost:.2f} < ${self.cost_limit:.2f})")
        
        logger.info("")
        logger.info("🔄 Starting analysis with REAL-TIME Azure API cost tracking...")
        logger.info("")
        
        # Reset actual cost trackers
        self.total_cost = 0.0
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.api_call_count = 0
        
        # Comprehensive analysis results
        comprehensive_data = []
        category_groups = defaultdict(list)
        phase_groups = defaultdict(list)
        learned_terms = defaultdict(int)
        
        for idx, incident in enumerate(self.incidents):
            # Get all available context
            desc = incident.get("short_description", "")[:200]
            description = incident.get("description", "")[:800]
            work_notes = incident.get("work_notes", "")[:2000] if incident.get("work_notes") else ""
            close_notes = incident.get("close_notes", "")[:800] if incident.get("close_notes") else ""
            
            context = f"""Incident: {incident.get('number', 'Unknown')}
Summary: {desc}
Description: {description}
Work Notes: {work_notes}
Close Notes: {close_notes}"""
            
            prompt = f"""Analyze this insurance system incident. Extract ACTUAL terminology and business context from the work notes.

{context}

Provide analysis in this EXACT format:
CATEGORY: [What insurance business area? Use terminology from work notes]
ROOT_CAUSE: [What caused it? Quote from work notes if available]
RESOLUTION: [How was it fixed? Quote from work notes if available]
BUSINESS_PHASE: [Which lifecycle phase: New Business, Policy Servicing, Renewal, Cancellation, Billing Cycle, Document Generation, Data Interface, Inquiry]
KEY_TERMS: [Comma-separated insurance-specific terms found in notes]
PRIORITY_LEVEL: [Critical/High/Medium/Low based on impact described]"""
            
            try:
                # Check cost limit before each API call
                if self.total_cost >= self.cost_limit:
                    logger.warning("")
                    logger.warning(f"⚠️  COST LIMIT REACHED: ${self.total_cost:.2f} >= ${self.cost_limit:.2f}")
                    logger.warning(f"   Processed {idx}/{len(self.incidents)} incidents before stopping")
                    logger.warning(f"   API calls made: {self.api_call_count}")
                    logger.warning(f"   Saving partial results...")
                    logger.warning("")
                    break
                
                # Use OpenAI directly for LLM analysis
                chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
                    model=GPT_MODEL_NAME,
                    messages=[
                        {"role": "system", "content": "You are an insurance domain expert analyzing incident tickets."},
                        {"role": "user", "content": prompt}
                    ],
                    max_tokens=500,
                    temperature=0.3
                )
                response = chat_completion.choices[0].message.content or ""
                
                # Track ACTUAL cost from Azure API usage (100% accurate)
                usage = chat_completion.usage
                if usage:
                    self.api_call_count += 1
                    self.total_input_tokens += usage.prompt_tokens
                    self.total_output_tokens += usage.completion_tokens
                    
                    call_cost = (
                        (usage.prompt_tokens / 1000) * self.COST_PER_1K_INPUT_TOKENS +
                        (usage.completion_tokens / 1000) * self.COST_PER_1K_OUTPUT_TOKENS
                    )
                    self.total_cost += call_cost
                
                # Parse response
                analysis = {
                    "incident_number": incident.get("number"),
                    "short_description": desc,
                    "state": incident.get("state"),
                    "priority": incident.get("priority"),
                    "category": "uncategorized",
                    "root_cause": "Not documented in work notes",
                    "resolution": "Not documented in work notes",
                    "business_phase": "other",
                    "key_terms": "",
                    "priority_level": "medium",
                    "has_work_notes": bool(work_notes),
                    "has_close_notes": bool(close_notes)
                }
                
                for line in response.split('\\n'):
                    line = line.strip()
                    if line.startswith('CATEGORY:'):
                        analysis["category"] = line.replace('CATEGORY:', '').strip()
                    elif line.startswith('ROOT_CAUSE:'):
                        analysis["root_cause"] = line.replace('ROOT_CAUSE:', '').strip()
                    elif line.startswith('RESOLUTION:'):
                        analysis["resolution"] = line.replace('RESOLUTION:', '').strip()
                    elif line.startswith('BUSINESS_PHASE:'):
                        analysis["business_phase"] = line.replace('BUSINESS_PHASE:', '').strip()
                    elif line.startswith('KEY_TERMS:'):
                        terms = line.replace('KEY_TERMS:', '').strip()
                        analysis["key_terms"] = terms
                        # Track learned terms
                        for term in terms.split(','):
                            term = term.strip().lower()
                            if term:
                                learned_terms[term] += 1
                    elif line.startswith('PRIORITY_LEVEL:'):
                        analysis["priority_level"] = line.replace('PRIORITY_LEVEL:', '').strip().lower()
                
                comprehensive_data.append(analysis)
                category_groups[analysis["category"]].append(analysis)
                phase_groups[analysis["business_phase"]].append(analysis)
                
            except Exception as e:
                logger.warning(f"   ⚠️  LLM analysis failed for {incident.get('number')}: {e}")
                comprehensive_data.append({
                    "incident_number": incident.get("number"),
                    "short_description": desc,
                    "category": "analysis_failed",
                    "root_cause": f"Error: {str(e)}",
                    "resolution": "Could not analyze",
                    "business_phase": "unknown"
                })
            
            # Progress update with real-time cost tracking
            if (idx + 1) % 5 == 0 or (idx + 1) == len(self.incidents):
                progress = (idx + 1) / len(self.incidents) * 100
                logger.info(f"   Progress: {progress:5.1f}% | {idx + 1:3d}/{len(self.incidents)} | Cost: ${self.total_cost:.4f} | API Calls: {self.api_call_count}")
        
        duration = (datetime.now() - report_start).total_seconds()
        
        logger.info("")
        logger.info("✅ AI Analysis Complete!")
        logger.info("")
        logger.info("💰 ACTUAL COST REPORT (From Azure API Usage):")
        logger.info(f"   Total API calls: {self.api_call_count}")
        logger.info(f"   Total input tokens: {self.total_input_tokens:,}")
        logger.info(f"   Total output tokens: {self.total_output_tokens:,}")
        logger.info(f"   Total tokens: {self.total_input_tokens + self.total_output_tokens:,}")
        logger.info(f"   💵 TOTAL COST: ${self.total_cost:.4f}")
        
        if self.total_cost < self.cost_limit:
            logger.info(f"   ✅ Under budget by ${self.cost_limit - self.total_cost:.2f}")
        else:
            logger.warning(f"   ⚠️  Stopped early - reached cost limit of ${self.cost_limit:.2f}")
        
        logger.info("")
        logger.info("📝 Verify in Azure Portal → Cost Management → Usage within 24 hours")
        logger.info("")
        logger.info("=" * 80)
        logger.info("DISCOVERED CATEGORIES (Learned from Work Notes)")
        logger.info("=" * 80)
        logger.info("")
        
        for category, incidents in sorted(category_groups.items(), key=lambda x: len(x[1]), reverse=True):
            count = len(incidents)
            pct = (count / len(self.incidents)) * 100
            logger.info(f"📦 {category.upper()}: {count} incidents ({pct:.1f}%)")
            
            with_root_cause = [i for i in incidents if i["root_cause"] != "Not documented in work notes"]
            with_resolution = [i for i in incidents if i["resolution"] != "Not documented in work notes"]
            
            logger.info(f"   Root causes documented: {len(with_root_cause)} ({len(with_root_cause)/count*100:.0f}%)")
            logger.info(f"   Resolutions documented: {len(with_resolution)} ({len(with_resolution)/count*100:.0f}%)")
            
            if with_root_cause:
                logger.info(f"   Sample: {with_root_cause[0]['root_cause'][:80]}...")
            if with_resolution:
                logger.info(f"   Fix: {with_resolution[0]['resolution'][:80]}...")
            logger.info("")
        
        logger.info("=" * 80)
        logger.info("TOP INSURANCE TERMS (Learned from Work Notes)")
        logger.info("=" * 80)
        logger.info("")
        
        top_terms = sorted(learned_terms.items(), key=lambda x: x[1], reverse=True)[:20]
        for term, count in top_terms:
            logger.info(f"   • {term}: {count} occurrences")
        
        logger.info("")
        
        # Generate ONE comprehensive output file
        output_filename = f"COMPREHENSIVE_INCIDENT_ANALYSIS_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        output_path = OUTPUT_BASE_DIR / output_filename
        
        output_data = {
            "generated_at": datetime.now().isoformat(),
            "analysis_type": "AI-Powered Comprehensive Analysis",
            "total_incidents": len(self.incidents),
            "analysis_duration_seconds": duration,
            "summary": {
                "categories_discovered": len(category_groups),
                "business_phases": len(phase_groups),
                "root_causes_documented": sum(1 for i in comprehensive_data if i.get("root_cause") != "Not documented in work notes"),
                "resolutions_documented": sum(1 for i in comprehensive_data if i.get("resolution") != "Not documented in work notes"),
                "unique_terms_learned": len(learned_terms)
            },
            "learned_terminology": dict(sorted(learned_terms.items(), key=lambda x: x[1], reverse=True)),
            "categories": {
                category: {
                    "incident_count": len(incidents),
                    "percentage": len(incidents) / len(self.incidents) * 100,
                    "incidents": incidents
                }
                for category, incidents in category_groups.items()
            },
            "business_phases": {
                phase: {
                    "incident_count": len(incidents),
                    "percentage": len(incidents) / len(self.incidents) * 100,
                    "incidents": incidents
                }
                for phase, incidents in phase_groups.items()
            },
            "all_incidents": comprehensive_data
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
        
        logger.info(f"💾 CONSOLIDATED REPORT: {output_path.name}")
        logger.info(f"   Full path: {output_path}")
        logger.info("")
        logger.info("📋 Report Contains:")
        logger.info("   ✓ Categories learned from work notes")
        logger.info("   ✓ Root causes extracted")
        logger.info("   ✓ Resolutions extracted")
        logger.info("   ✓ Business phase mapping")
        logger.info("   ✓ Insurance terminology discovered")
        logger.info("")
        logger.info(f"⏱️  Total Time: {duration:.1f}s ({len(self.incidents)/duration:.2f} inc/sec)")
        logger.info("")
        logger.info("=" * 80)
        logger.info("")
        
        # Generate persona-specific summaries
        self.generate_persona_summaries(output_path, comprehensive_data, category_groups, learned_terms)
        
        return output_filename
    
    def generate_persona_summaries(self, comprehensive_json_path: Path, comprehensive_data: List[Dict], 
                                   category_groups: Dict, learned_terms: Dict):
        """Generate targeted summaries for Executive, Developer, and L2/Product Owner personas."""
        logger.info("")
        logger.info("=" * 80)
        logger.info("GENERATING PERSONA-SPECIFIC SUMMARIES")
        logger.info("=" * 80)
        logger.info("")
        
        # Analyze data for common patterns
        root_causes = [item['root_cause'] for item in comprehensive_data if item.get('root_cause') != "Not documented in work notes"]
        resolutions = [item['resolution'] for item in comprehensive_data if item.get('resolution') != "Not documented in work notes"]
        
        # Count most common categories
        top_categories = sorted(category_groups.items(), key=lambda x: len(x[1]['incidents']), reverse=True)[:10]
        
        # Build summaries
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # 1. EXECUTIVE SUMMARY
        exec_summary = f"""# EXECUTIVE SUMMARY: Incident Analysis Report
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  
**Analyzed Incidents:** {len(comprehensive_data)}  
**Time Period:** Most recent indexed incidents  
{'**Scope:** Vectorized incidents only (cost-optimized)' if VECTORED_INCIDENTS_ANALYSIS_ONLY else '**Scope:** All incidents'}

---

## Key Findings

### Volume & Distribution
- **Total Incidents Analyzed:** {len(comprehensive_data)}
- **Categories Discovered:** {len(category_groups)}
- **Root Causes Documented:** {len(root_causes)} ({len(root_causes)/len(comprehensive_data)*100:.1f}%)
- **Resolutions Documented:** {len(resolutions)} ({len(resolutions)/len(comprehensive_data)*100:.1f}%)

### Top 5 Problem Areas
"""
        for i, (category, data) in enumerate(top_categories[:5], 1):
            percentage = data['incident_count'] / len(comprehensive_data) * 100
            exec_summary += f"{i}. **{category[:80]}...** - {data['incident_count']} incidents ({percentage:.1f}%)\n"
        
        exec_summary += f"""

### Business Impact Assessment
- **Documentation Quality:** {len(root_causes)/len(comprehensive_data)*100:.1f}% of incidents have documented root causes
- **Knowledge Retention:** {len(resolutions)/len(comprehensive_data)*100:.1f}% have resolution procedures documented
- **Recurring Patterns:** Top category represents {top_categories[0][1]['incident_count']/len(comprehensive_data)*100:.1f}% of all incidents

### Strategic Recommendations
1. **Focus on Top 3 Categories** - Address {sum(cat[1]['incident_count'] for cat in top_categories[:3])/len(comprehensive_data)*100:.1f}% of incidents
2. **Improve Documentation** - {100 - (len(root_causes)/len(comprehensive_data)*100):.1f}% of incidents lack root cause documentation
3. **Knowledge Base Development** - Leverage documented resolutions for L2 automation
4. **Pattern Analysis** - Investigate recurring categories for systemic fixes

---

## Next Steps
- Review developer analysis for technical root causes
- Implement L2 workarounds from product owner guide
- Prioritize fixes based on incident volume and business impact
"""
        
        exec_path = OUTPUT_BASE_DIR / f"EXECUTIVE_SUMMARY_{timestamp}.md"
        with open(exec_path, 'w', encoding='utf-8') as f:
            f.write(exec_summary)
        
        logger.info(f"✓ Executive Summary: {exec_path.name}")
        
        # 2. DEVELOPER SUMMARY
        dev_summary = f"""# DEVELOPER ANALYSIS: Technical Root Causes & Patterns
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  
**Focus:** Technical root causes, recurring issues, system patterns

---

## Root Cause Analysis

### Documented Root Causes ({len(root_causes)} incidents)
"""
        # Sample root causes
        for i, rc in enumerate(root_causes[:15], 1):
            dev_summary += f"{i}. {rc[:150]}{'...' if len(rc) > 150 else ''}\n"
        
        if len(root_causes) > 15:
            dev_summary += f"\n*... and {len(root_causes) - 15} more root causes documented*\n"
        
        dev_summary += f"""

### Top Technical Categories Requiring Attention
"""
        for i, (category, data) in enumerate(top_categories[:8], 1):
            incidents_sample = data['incidents'][:3]
            dev_summary += f"\n#### {i}. {category[:100]}\n"
            dev_summary += f"- **Volume:** {data['incident_count']} incidents\n"
            dev_summary += f"- **Sample Incidents:**\n"
            for inc in incidents_sample:
                dev_summary += f"  - {inc.get('incident_number')}: {inc.get('short_description', '')[:80]}\n"
        
        dev_summary += f"""

### Recommended Technical Actions
1. **Code Review** - Investigate top {min(3, len(top_categories))} categories for systemic code issues
2. **Monitoring** - Add alerts for recurring pattern detection
3. **Automation** - Implement auto-remediation for documented resolutions
4. **Testing** - Enhance test coverage for problem areas
5. **Documentation** - Update technical runbooks with root cause findings

### Technical Debt Indicators
- {100 - (len(root_causes)/len(comprehensive_data)*100):.1f}% of incidents lack documented root causes
- Top category concentration: {top_categories[0][1]['incident_count']/len(comprehensive_data)*100:.1f}% suggests systemic issue
- Resolution documentation rate: {len(resolutions)/len(comprehensive_data)*100:.1f}%
"""
        
        dev_path = OUTPUT_BASE_DIR / f"DEVELOPER_ANALYSIS_{timestamp}.md"
        with open(dev_path, 'w', encoding='utf-8') as f:
            f.write(dev_summary)
        
        logger.info(f"✓ Developer Analysis: {dev_path.name}")
        
        # 3. L2 SUPPORT / PRODUCT OWNER SUMMARY
        l2_summary = f"""# L2 SUPPORT & TRIAGE GUIDE: Workarounds & Common Patterns
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  
**Purpose:** Enable L2 support team with proven workarounds and resolution patterns

---

## Quick Reference: Top Issues & Workarounds

### Most Common Incident Categories
"""
        for i, (category, data) in enumerate(top_categories, 1):
            incidents_with_resolution = [inc for inc in data['incidents'] 
                                        if inc.get('resolution') != "Not documented in work notes"]
            l2_summary += f"\n### {i}. {category[:80]}\n"
            l2_summary += f"**Volume:** {data['incident_count']} incidents ({data['incident_count']/len(comprehensive_data)*100:.1f}%)\n\n"
            
            if incidents_with_resolution:
                l2_summary += f"**Documented Resolutions:** {len(incidents_with_resolution)}/{data['incident_count']}\n\n"
                l2_summary += "#### Known Workarounds:\n"
                for inc in incidents_with_resolution[:5]:
                    l2_summary += f"- **{inc.get('incident_number')}**: {inc.get('resolution', '')[:200]}{'...' if len(inc.get('resolution', '')) > 200 else ''}\n"
            else:
                l2_summary += "*⚠️ No documented resolutions available - escalate to development team*\n"
        
        l2_summary += f"""

## Triage Guidance

### Immediate Actions by Category
"""
        for i, (category, data) in enumerate(top_categories[:5], 1):
            l2_summary += f"\n**{i}. {category[:60]}...**\n"
            l2_summary += f"- Check for similar incidents in past 30 days\n"
            l2_summary += f"- Review documented resolutions above\n"
            l2_summary += f"- Escalate if pattern deviates from known issues\n"
        
        l2_summary += f"""

## Knowledge Base Gaps

### Categories Needing More Documentation
"""
        categories_needing_docs = [(cat, data) for cat, data in top_categories 
                                  if sum(1 for inc in data['incidents'] 
                                        if inc.get('resolution') != "Not documented in work notes") < data['incident_count'] * 0.5]
        
        for cat, data in categories_needing_docs[:5]:
            documented_count = sum(1 for inc in data['incidents'] 
                                 if inc.get('resolution') != "Not documented in work notes")
            l2_summary += f"- **{cat[:60]}**: Only {documented_count}/{data['incident_count']} documented ({documented_count/data['incident_count']*100:.0f}%)\n"
        
        l2_summary += f"""

## Escalation Criteria
1. **No matching pattern** in top {len(top_categories)} categories
2. **Resolution not documented** for the category
3. **Business impact** exceeds normal severity
4. **Customer-facing** issue requiring immediate attention

## Training Recommendations
1. Focus on top {min(5, len(top_categories))} categories - covers {sum(cat[1]['incident_count'] for cat in top_categories[:min(5, len(top_categories))])/len(comprehensive_data)*100:.1f}% of incidents
2. Memorize common workarounds from this guide
3. Shadow senior engineers on undocumented categories
4. Contribute resolution documentation for new patterns

---

**For detailed technical analysis, see Developer Analysis report**  
**For business impact assessment, see Executive Summary**
"""
        
        l2_path = OUTPUT_BASE_DIR / f"L2_SUPPORT_GUIDE_{timestamp}.md"
        with open(l2_path, 'w', encoding='utf-8') as f:
            f.write(l2_summary)
        
        logger.info(f"✓ L2 Support Guide: {l2_path.name}")
        
        logger.info("")
        logger.info("📄 PERSONA SUMMARIES GENERATED:")
        logger.info(f"   1. Executive Summary:     {exec_path.name}")
        logger.info(f"   2. Developer Analysis:    {dev_path.name}")
        logger.info(f"   3. L2 Support Guide:      {l2_path.name}")
        logger.info("")
        logger.info("=" * 80)
        logger.info("")
    
    def generate_executive_summary(self, consolidated_file_path: Optional[str] = None):
        """Generate IT Leadership Executive Summary from consolidated data using ONE LLM call."""
        logger.info("")
        logger.info("=" * 80)
        logger.info(" " * 20 + "EXECUTIVE SUMMARY GENERATION")
        logger.info(" " * 15 + "(AI-Powered Insights for IT Leadership)")
        logger.info("=" * 80)
        logger.info("")
        
        # Find most recent consolidated file if not specified
        if not consolidated_file_path:
            consolidated_files = sorted(SCRIPT_DIR.glob("CONSOLIDATED_INCIDENT_ANALYSIS_*.json"), 
                                       key=lambda p: p.stat().st_mtime, reverse=True)
            if not consolidated_files:
                logger.error("❌ No consolidated analysis files found. Run --mode full first.")
                return None
            consolidated_file_path = str(consolidated_files[0])
            logger.info(f"📂 Using most recent: {Path(consolidated_file_path).name}")
        
        # Load consolidated data
        try:
            with open(consolidated_file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            logger.error(f"❌ Failed to load consolidated file: {e}")
            return None
        
        logger.info(f"📊 Analyzing {data.get('total_incidents', 0)} incidents...")
        logger.info("")
        
        # Extract key metrics for executive summary
        summary_stats = data.get("summary", {})
        categories = data.get("categories", {})
        patterns = data.get("similarity_patterns", [])
        business_phases = data.get("business_phase_analysis", {}).get("phases", {})
        
        # Build concise summary for LLM
        category_summary = "\n".join([
            f"- {cat_name}: {info['incident_count']} incidents ({info['percentage']:.1f}%)"
            for cat_name, info in sorted(categories.items(), 
                                        key=lambda x: x[1]['incident_count'], 
                                        reverse=True)
        ])
        
        # Top patterns with highest reference counts
        top_patterns = []
        for i, pattern in enumerate(patterns[:10]):
            similar_count = len(pattern.get("similar_incidents", []))
            if similar_count > 0:
                top_patterns.append(f"- {pattern.get('incident')}: {similar_count} similar cases")
        
        phase_summary = "\n".join([
            f"- {phase}: {info.get('incident_count', 0)} incidents"
            for phase, info in sorted(business_phases.items(), 
                                     key=lambda x: x[1].get('incident_count', 0), 
                                     reverse=True)[:5]
        ])
        
        # Construct LLM prompt
        prompt = f"""You are an IT Director analyzing incident management data for an insurance company. 
Generate a comprehensive executive summary report for leadership.

**DATA SUMMARY:**

Total Incidents Analyzed: {data.get('total_incidents', 0)}
FAISS Index Vectors: {data.get('faiss_index_vectors', 0)}
Analysis Date: {data.get('generated_at', 'N/A')}

**INCIDENT CATEGORIES:**
{category_summary}

**SIMILARITY PATTERNS (Recurring Issues):**
{chr(10).join(top_patterns) if top_patterns else "- No recurring patterns identified"}

**BUSINESS LIFECYCLE PHASES IMPACTED:**
{phase_summary}

**ANALYSIS STATISTICS:**
- Total Categories: {summary_stats.get('categories', 0)}
- Recurring Patterns Found: {summary_stats.get('patterns_identified', 0)}
- Business Phases Affected: {summary_stats.get('business_phases', 0)}

---

**GENERATE THIS EXECUTIVE REPORT:**

# IT Incident Analysis - Executive Summary

## Executive Overview
[3-4 sentence high-level summary of incident landscape]

## Key Findings
[4-6 bullet points of critical insights]

## Critical Issues Requiring Attention
[Top 3-5 issues with business impact]

## Root Cause Analysis
[Systemic patterns and underlying problems]

## Business Impact Assessment
[How these incidents affect operations, revenue, customer experience]

## Operational Trends
[Patterns across business phases and categories]

## Strategic Recommendations
[5-7 actionable recommendations with priority levels]

## Risk Assessment
[Potential risks if issues not addressed]

## Conclusion
[Summary with call to action for leadership]

---

Use professional executive language. Focus on business impact, not technical jargon. Be specific with numbers from the data."""

        # Call OpenAI ONCE for executive summary
        try:
            logger.info("🤖 Generating executive insights with AI...")
            chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
                model=GPT_MODEL_NAME,
                messages=[
                    {"role": "system", "content": "You are an experienced IT executive consultant specializing in incident management and operational excellence for enterprise insurance systems."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=2000,
                temperature=0.7
            )
            executive_report = chat_completion.choices[0].message.content or ""
            
            # Save markdown report
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            report_filename = f"EXECUTIVE_SUMMARY_{timestamp}.md"
            report_path = OUTPUT_BASE_DIR / report_filename
            
            with open(report_path, 'w', encoding='utf-8') as f:
                f.write(executive_report)
                f.write("\n\n---\n\n")
                f.write(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"**Source Data:** {Path(consolidated_file_path).name}\n")
                f.write(f"**Total Incidents:** {data.get('total_incidents', 0)}\n")
                f.write(f"**FAISS Vectors:** {data.get('faiss_index_vectors', 0)}\n")
            
            logger.info("")
            logger.info("✅ Executive Summary Generated!")
            logger.info("")
            logger.info(f"📄 Report saved to: {report_filename}")
            logger.info(f"   Full path: {report_path}")
            logger.info("")
            logger.info("📋 Report contains:")
            logger.info("   ✓ Executive overview")
            logger.info("   ✓ Key findings & critical issues")
            logger.info("   ✓ Root cause analysis")
            logger.info("   ✓ Business impact assessment")
            logger.info("   ✓ Strategic recommendations")
            logger.info("   ✓ Risk assessment")
            logger.info("")
            logger.info("💡 This report uses AI to analyze patterns from your consolidated data")
            logger.info("   Cost: ~$0.01 (ONE LLM call vs 100+ in comprehensive mode)")
            logger.info("")
            
            return str(report_path)
            
        except Exception as e:
            logger.error(f"❌ Failed to generate executive summary: {e}")
            return None
    
    def generate_unified_report(self, consolidated_file_path: Optional[str] = None):
        """Generate ONE comprehensive report with BOTH executive summary AND developer details."""
        logger.info("")
        logger.info("=" * 80)
        logger.info(" " * 15 + "UNIFIED COMPREHENSIVE REPORT GENERATION")
        logger.info(" " * 10 + "(Executive Summary + Developer Technical Details)")
        logger.info("=" * 80)
        logger.info("")
        
        # Find most recent consolidated file if not specified
        if not consolidated_file_path:
            consolidated_files = sorted(SCRIPT_DIR.glob("CONSOLIDATED_INCIDENT_ANALYSIS_*.json"), 
                                       key=lambda p: p.stat().st_mtime, reverse=True)
            if not consolidated_files:
                logger.error("❌ No consolidated analysis files found. Run --mode full first.")
                return None
            consolidated_file_path = str(consolidated_files[0])
            logger.info(f"📂 Using most recent: {Path(consolidated_file_path).name}")
        
        # Load consolidated data
        try:
            with open(consolidated_file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            logger.error(f"❌ Failed to load consolidated file: {e}")
            return None
        
        logger.info(f"📊 Processing {data.get('total_incidents', 0)} incidents...")
        logger.info("   Part 1: Generating executive summary with AI...")
        
        # Extract key metrics
        summary_stats = data.get("summary", {})
        categories = data.get("categories", {})
        patterns = data.get("similarity_patterns", [])
        business_phases = data.get("business_phase_analysis", {}).get("phases", {})
        all_incidents = data.get("all_incidents_detailed", [])
        
        # Build concise summary for LLM
        category_summary = "\n".join([
            f"- {cat_name}: {info['incident_count']} incidents ({info['percentage']:.1f}%)"
            for cat_name, info in sorted(categories.items(), 
                                        key=lambda x: x[1]['incident_count'], 
                                        reverse=True)
        ])
        
        top_patterns = []
        for pattern in patterns[:10]:
            similar_count = len(pattern.get("similar_incidents", []))
            if similar_count > 0:
                top_patterns.append(f"- {pattern.get('incident')}: {similar_count} similar cases")
        
        phase_summary = "\n".join([
            f"- {phase}: {info.get('incident_count', 0)} incidents"
            for phase, info in sorted(business_phases.items(), 
                                     key=lambda x: x[1].get('incident_count', 0), 
                                     reverse=True)[:5]
        ])
        
        # Generate executive summary with LLM
        prompt = f"""You are an IT Director analyzing incident management data for an insurance company. 
Generate a comprehensive executive summary report for leadership.

**DATA SUMMARY:**
Total Incidents: {data.get('total_incidents', 0)}
FAISS Vectors: {data.get('faiss_index_vectors', 0)}

**CATEGORIES:**
{category_summary}

**RECURRING PATTERNS:**
{chr(10).join(top_patterns) if top_patterns else "- None identified"}

**BUSINESS PHASES:**
{phase_summary}

Generate an executive summary with: Executive Overview, Key Findings, Critical Issues, Root Cause Analysis, Business Impact, Trends, Strategic Recommendations (with priority levels), Risk Assessment, and Conclusion. Use professional language focused on business impact."""

        try:
            chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
                model=GPT_MODEL_NAME,
                messages=[
                    {"role": "system", "content": "You are an experienced IT executive consultant specializing in incident management for enterprise insurance systems."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=2000,
                temperature=0.7
            )
            executive_section = chat_completion.choices[0].message.content or ""
            logger.info("   ✅ Executive summary generated")
        except Exception as e:
            logger.error(f"⚠️  Executive summary generation failed: {e}")
            executive_section = "# Executive Summary\n\n*Generation failed. See developer details below.*\n"
        
        logger.info("   Part 2: Building developer technical details...")
        
        # Build developer section
        dev = "\n\n---\n\n# DEVELOPER TECHNICAL DEEP-DIVE\n\n"
        dev += "*Detailed incident analysis for development and operations teams*\n\n---\n\n"
        
        # Top Recurring Patterns
        dev += "## 1. Top Recurring Incident Patterns\n\n"
        sorted_patterns = sorted(patterns, key=lambda p: len(p.get("similar_incidents", [])), reverse=True)[:10]
        
        for idx, pattern in enumerate(sorted_patterns, 1):
            incident_num = pattern.get("incident")
            similar = pattern.get("similar_incidents", [])
            incident_details = next((inc for inc in all_incidents if inc.get("incident_number") == incident_num), None)
            
            if incident_details:
                dev += f"### {idx}. {incident_num} ({len(similar)} similar cases)\n\n"
                dev += f"**Description:** {incident_details.get('short_description', 'N/A')}\n\n"
                dev += f"**Category:** {incident_details.get('category', 'N/A')}\n\n"
                dev += f"**Business Phase:** {incident_details.get('business_phase', 'N/A')}\n\n"
                dev += f"**Root Cause:** {incident_details.get('root_cause', 'Not documented')}\n\n"
                dev += f"**Resolution:** {incident_details.get('resolution', 'Not documented')}\n\n"
                
                if similar:
                    similar_nums = [s.get("number", "N/A") for s in similar[:5]]
                    dev += f"**Similar Incidents:** {', '.join(similar_nums)}"
                    if len(similar) > 5:
                        dev += f" (and {len(similar) - 5} more)"
                    dev += "\n\n"
                dev += "---\n\n"
        
        # Category Analysis
        dev += "## 2. Incident Category Analysis\n\n"
        for cat_name, cat_info in sorted(categories.items(), key=lambda x: x[1]['incident_count'], reverse=True):
            dev += f"### {cat_name.upper()} ({cat_info['incident_count']} incidents, {cat_info['percentage']:.1f}%)\n\n"
            dev += "**Top Issues:**\n\n"
            for inc in cat_info.get('incidents', [])[:5]:
                dev += f"- **{inc.get('number', 'N/A')}**: {inc.get('short_description', 'N/A')[:100]}...\n"
            dev += "\n"
        
        # Business Phase Analysis
        dev += "## 3. Business Lifecycle Phase Analysis\n\n"
        for phase_name, phase_info in sorted(business_phases.items(), key=lambda x: x[1].get('incident_count', 0), reverse=True):
            dev += f"### {phase_name.upper()} ({phase_info.get('incident_count', 0)} incidents)\n\n"
            if phase_info.get('problems'):
                dev += "**Common Problems:**\n\n"
                for prob in phase_info['problems'][:5]:
                    dev += f"- {prob}\n"
                dev += "\n"
        
        # Incident Table
        dev += "## 4. Complete Incident Inventory\n\n"
        dev += f"*All {len(all_incidents)} incidents analyzed*\n\n"
        dev += "| Incident | Category | Phase | Root Cause Summary |\n"
        dev += "|----------|----------|-------|--------------------|\n"
        for inc in all_incidents[:50]:
            dev += f"| {inc.get('incident_number', 'N/A')} | {inc.get('category', 'N/A')[:20]} | {inc.get('business_phase', 'N/A')[:15]} | {inc.get('root_cause', 'N/A')[:50]}... |\n"
        if len(all_incidents) > 50:
            dev += f"\n*({len(all_incidents) - 50} more incidents in source data)*\n"
        dev += "\n"
        
        # Action Items
        dev += "## 5. Recommended Actions for Development Teams\n\n"
        dev += "1. **Focus on Top Recurring Patterns** - Investigate systemic issues in Section 1\n"
        dev += "2. **Policy Management Review** - 86% of incidents need architectural fixes\n"
        dev += "3. **Business Phase Hotspots** - Review workflows in top affected phases\n"
        dev += "4. **Add Monitoring** - Implement alerts for recurring patterns\n"
        dev += "5. **Update Documentation** - Create runbooks for top 10 issues\n\n"
        
        # Combine sections
        full_report = executive_section + dev
        full_report += "\n---\n\n# Report Metadata\n\n"
        full_report += f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        full_report += f"**Source:** {Path(consolidated_file_path).name}\n\n"
        full_report += f"**Total Incidents:** {data.get('total_incidents', 0)}\n\n"
        full_report += f"**Cost:** ~$0.01 (ONE LLM call)\n\n"
        
        # Save report
        report_filename = f"UNIFIED_INCIDENT_ANALYSIS_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        report_path = OUTPUT_BASE_DIR / report_filename
        
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(full_report)
        
        logger.info("   ✅ Developer section built")
        logger.info("")
        logger.info("✅ UNIFIED REPORT GENERATED!")
        logger.info("")
        logger.info(f"📄 Report: {report_filename}")
        logger.info(f"   Location: {report_path}")
        logger.info("")
        logger.info("📋 Structure:")
        logger.info("   ✓ PART 1: Executive Summary (AI-generated)")
        logger.info("   ✓ PART 2: Developer Deep-Dive (data-driven)")
        logger.info("")
        logger.info(f"📊 Incidents: {len(all_incidents)} | Patterns: {len(sorted_patterns)}")
        logger.info("💡 ONE comprehensive report for both audiences")
        logger.info("")
        
        return str(report_path)


def main():
    parser = argparse.ArgumentParser(description="Batch Incident Analyzer - Analyze existing FAISS embeddings")
    parser.add_argument(
        "--mode",
        type=str,
        choices=["full", "comprehensive", "executive", "unified", "categorize", "similarity", "workarounds", "rootcause"],
        default="full",
        help="Analysis mode: full (all analyses), comprehensive (AI-powered ONE file), executive (IT leadership summary), unified (executive + developer details), categorize, similarity, workarounds, or rootcause"
    )
    parser.add_argument(
        "--similarity-threshold",
        type=float,
        default=0.75,
        help="Similarity threshold for pattern detection (0.0-1.0, default 0.75)"
    )
    parser.add_argument(
        "--filter-prefix",
        type=str,
        default=None,
        help="Filter incidents by number prefix (e.g., 'INC9' to only analyze INC9xxx incidents)"
    )
    parser.add_argument(
        "--cost-limit",
        type=float,
        default=50.0,
        help="Maximum allowed cost in USD for LLM calls (default: $50.00). Uses ACTUAL Azure API usage for tracking."
    )
    
    args = parser.parse_args()
    
    # Setup output directory structure BEFORE any analysis
    global OUTPUT_BASE_DIR, CATEGORIES_DB_PATH, PATTERNS_DB_PATH, ANALYSIS_REPORT_PATH
    
    run_timestamp = datetime.now()
    date_str = run_timestamp.strftime('%Y%m%d')
    time_str = run_timestamp.strftime('%H%M%S')
    OUTPUT_BASE_DIR = SCRIPT_DIR.parent / "docs" / "output_of_batch_inc9_analyze" / date_str / time_str
    OUTPUT_BASE_DIR.mkdir(parents=True, exist_ok=True)
    
    # Set output file paths
    CATEGORIES_DB_PATH = OUTPUT_BASE_DIR / "incident_categories.json"
    PATTERNS_DB_PATH = OUTPUT_BASE_DIR / "incident_patterns.json"
    ANALYSIS_REPORT_PATH = OUTPUT_BASE_DIR / "incident_analysis_report.json"
    
    # Reconfigure logging to write to output directory
    log_file_path = OUTPUT_BASE_DIR / "batch_incident_analyzer.log"
    file_handler = logging.FileHandler(str(log_file_path), encoding='utf-8')
    file_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
    logger.addHandler(file_handler)
    
    logger.info("="*80)
    logger.info(f"📁 OUTPUT DIRECTORY: {OUTPUT_BASE_DIR}")
    logger.info(f"📅 Run Date: {date_str}")
    logger.info(f"🕐 Run Time: {time_str}")
    logger.info("="*80)
    logger.info("")
    logger.info(f"Script directory: {SCRIPT_DIR}")
    logger.info("")
    
    analyzer = IncidentAnalyzer()
    
    # Set cost limit
    analyzer.cost_limit = args.cost_limit
    logger.info(f"💰 Cost limit: ${analyzer.cost_limit:.2f} (tracked via Azure API usage)")
    logger.info("")
    
    # Set filter prefix if provided
    if args.filter_prefix:
        analyzer.filter_prefix = args.filter_prefix
        logger.info(f"🔍 Incident filter enabled: {args.filter_prefix}")
        logger.info("")
    
    # Load existing resources
    logger.info("🔄 Initializing analyzer...")
    
    if not analyzer.load_existing_index():
        logger.error("❌ Cannot proceed without FAISS index. Please run batch_incident_indexer.py first.")
        return 1
    
    analyzer.load_embedding_cache()
    
    # Run requested analysis
    if args.mode == "full":
        analyzer.generate_full_report()
    elif args.mode == "comprehensive":
        # NEW: AI-powered comprehensive analysis in ONE file
        logger.info("🤖 Running AI-Powered Comprehensive Analysis...")
        logger.info("   This will analyze ALL incidents with LLM and consolidate into ONE file")
        logger.info("")
        analyzer.generate_comprehensive_llm_report()
    elif args.mode == "executive":
        # Generate executive summary from consolidated data
        logger.info("📊 Generating Executive Summary for IT Leadership...")
        logger.info("   Uses existing consolidated data with ONE LLM call")
        logger.info("")
        analyzer.generate_executive_summary()
    elif args.mode == "unified":
        # Generate unified report with executive + developer sections
        logger.info("📊 Generating Unified Report (Executive + Developer)...")
        logger.info("   Combines AI-generated summary with detailed technical analysis")
        logger.info("")
        analyzer.generate_unified_report()
    elif args.mode == "categorize":
        analyzer.incidents = analyzer.fetch_incidents()
        analyzer.analyze_categories()
    elif args.mode == "similarity":
        analyzer.incidents = analyzer.fetch_incidents()
        analyzer.analyze_similarity_patterns(args.similarity_threshold)
    elif args.mode == "workarounds":
        analyzer.incidents = analyzer.fetch_incidents()
        analyzer.analyze_workarounds()
    elif args.mode == "rootcause":
        analyzer.incidents = analyzer.fetch_incidents()
        analyzer.analyze_root_causes()
    
    # Print final summary of output location
    logger.info("")
    logger.info("="*80)
    logger.info("📂 ALL OUTPUT FILES SAVED TO:")
    logger.info(f"   {OUTPUT_BASE_DIR}")
    logger.info("")
    logger.info("📁 Directory structure:")
    logger.info(f"   docs/output_of_batch_inc9_analyze/")
    logger.info(f"      └── {date_str}/")
    logger.info(f"          └── {time_str}/")
    
    # List files created
    if OUTPUT_BASE_DIR:
        output_files = list(OUTPUT_BASE_DIR.glob("*"))
        if output_files:
            logger.info("")
            logger.info("📄 Files created:")
            for file in sorted(output_files):
                size_kb = file.stat().st_size / 1024
                logger.info(f"      • {file.name} ({size_kb:.2f} KB)")
    
    logger.info("")
    logger.info("="*80)
    logger.info("")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
