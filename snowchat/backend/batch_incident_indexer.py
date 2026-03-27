"""
Batch Incident Indexer for ServiceNow Incidents

This script implements a production-grade incident indexing pipeline:
1. Fetches ALL incidents from ServiceNow (900+)
2. Generates embeddings (using cache to avoid redundant API calls)
3. Builds persistent FAISS index
4. Creates metadata database for fast lookups
5. Supports incremental updates (only process new/changed incidents)

Run Modes:
- Full Rebuild: python batch_incident_indexer.py --mode full
- Incremental: python batch_incident_indexer.py --mode incremental
- Stats Only: python batch_incident_indexer.py --mode stats

Architecture:
- FAISS Index: incidents_production.index (persistent vector index)
- Metadata DB: incidents_metadata.db (SQLite for production or TinyDB for simplicity)
- Embedding Cache: embedding_cache.json (reuses existing cache)
- Index Manifest: incidents_index_manifest.json (metadata about index)
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
import numpy as np
import faiss

# Add components to path
sys.path.insert(0, os.path.dirname(__file__))

from components.servicenowgenaitool import (
    fetch_all_incidents_core,
    get_cached_embedding,
    cache_embedding,
    generate_embeddings
)
from tinydb import TinyDB, Query

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('batch_incident_indexer.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Configuration
FAISS_INDEX_PATH = Path("incidents_production.index")
METADATA_DB_PATH = Path("incidents_metadata.json")
MANIFEST_PATH = Path("incidents_index_manifest.json")
EMBEDDING_DIM = 1536  # OpenAI text-embedding-3-small/large

# Feature Flag: Enable full incident embedding (short_description + work_notes)
FULL_INCIDENT_EMBEDDED_SIMILARITY = os.getenv("FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS", "0").lower() in ("1", "true", "yes", "on")

class IncidentIndexer:
    """Manages batch indexing and incremental updates of ServiceNow incidents."""
    
    def __init__(self):
        self.faiss_index: Optional[faiss.Index] = None
        self.metadata_db = TinyDB(str(METADATA_DB_PATH))
        self.incidents_table = self.metadata_db.table('incidents')
        self.manifest: Dict[str, Any] = {}
        self.filter_prefix: Optional[str] = None  # Incident number prefix filter
    
    def close(self):
        """Properly close metadata database to ensure all writes are flushed."""
        if hasattr(self, 'metadata_db'):
            self.metadata_db.close()
            logger.info("✅ Closed metadata database (all writes flushed)")
        
    def load_or_create_index(self) -> faiss.Index:
        """Load existing FAISS index or create new one."""
        if FAISS_INDEX_PATH.exists():
            try:
                index = faiss.read_index(str(FAISS_INDEX_PATH))
                logger.info(f"Loaded existing FAISS index from {FAISS_INDEX_PATH} | vectors={index.ntotal}")
                return index
            except Exception as e:
                logger.warning(f"Failed to load index: {e}. Creating new index.")
        
        logger.info("Creating new FAISS index")
        index = faiss.IndexFlatL2(EMBEDDING_DIM)
        return index
    
    def save_index(self):
        """Persist FAISS index to disk."""
        if self.faiss_index is None:
            logger.warning("No index to save")
            return
        
        try:
            faiss.write_index(self.faiss_index, str(FAISS_INDEX_PATH))
            logger.info(f"Saved FAISS index to {FAISS_INDEX_PATH} | vectors={self.faiss_index.ntotal}")
        except Exception as e:
            logger.error(f"Failed to save FAISS index: {e}")
    
    def load_manifest(self) -> Dict[str, Any]:
        """Load index manifest (metadata about the index)."""
        if MANIFEST_PATH.exists():
            try:
                with open(MANIFEST_PATH, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load manifest: {e}")
        
        return {
            "created_at": datetime.now().isoformat(),
            "last_updated": None,
            "total_incidents": 0,
            "embedding_model": "text-embedding-3-small",
            "faiss_index_type": "IndexFlatL2",
            "dimension": EMBEDDING_DIM
        }
    
    def save_manifest(self):
        """Save index manifest."""
        self.manifest["last_updated"] = datetime.now().isoformat()
        self.manifest["total_incidents"] = self.faiss_index.ntotal if self.faiss_index else 0
        
        try:
            with open(MANIFEST_PATH, 'w') as f:
                json.dump(self.manifest, f, indent=2)
            logger.info(f"Saved manifest to {MANIFEST_PATH}")
        except Exception as e:
            logger.error(f"Failed to save manifest: {e}")
    
    def fetch_all_incidents_unlimited(self, limit: int = 10000) -> List[Dict[str, Any]]:
        """Fetch all incidents from ServiceNow (not limited to 100)."""
        logger.info(f"Fetching up to {limit} incidents from ServiceNow...")
        
        # Use existing function but with higher limit
        # Note: May need to implement pagination for truly large datasets
        try:
            from components.servicenowgenaitool import servicenow_instance, _sn_auth
            import requests
            
            if not servicenow_instance:
                logger.error("ServiceNow instance not configured")
                return []
            
            url = f"{servicenow_instance}/api/now/table/incident?sysparm_limit={limit}"
            headers = {"Accept": "application/json"}
            
            response = requests.get(url, auth=_sn_auth(), headers=headers, timeout=60)
            response.raise_for_status()
            
            result = response.json()
            incidents = result.get("result", [])
            
            logger.info(f"Fetched {len(incidents)} incidents from ServiceNow")
            return incidents
            
        except Exception as e:
            logger.error(f"Failed to fetch incidents: {e}")
            return []
    
    def get_incident_metadata(self, incident_number: str) -> Optional[Dict[str, Any]]:
        """Get metadata for an incident from database."""
        Incident = Query()
        result = self.incidents_table.get(Incident.number == incident_number)
        if result:
            return dict(result)  # type: ignore
        return None
    
    def upsert_incident_metadata(self, incident: Dict[str, Any], faiss_index: int, embedding_generated_at: str):
        """Store/update incident metadata in database."""
        Incident = Query()
        
        metadata = {
            "number": incident.get("number"),
            "short_description": incident.get("short_description", ""),
            "state": incident.get("state", ""),
            "priority": incident.get("priority", ""),
            "category": incident.get("category", ""),
            "assigned_to": incident.get("u_assigned_to", ""),
            "created_at": incident.get("sys_created_on", ""),
            "updated_at": incident.get("sys_updated_on", ""),
            "faiss_index": faiss_index,  # Position in FAISS index
            "embedding_generated_at": embedding_generated_at,
            "indexed_at": datetime.now().isoformat()
        }
        
        self.incidents_table.upsert(metadata, Incident.number == incident.get("number"))
    
    def categorize_incident(self, incident: Dict[str, Any]) -> str:
        """Simple rule-based categorization (can be enhanced with ML)."""
        desc = incident.get("short_description", "").lower()
        
        # Simple keyword-based categorization
        if any(kw in desc for kw in ["server", "down", "outage", "unavailable"]):
            return "server_outage"
        elif any(kw in desc for kw in ["login", "auth", "password", "access denied"]):
            return "authentication"
        elif any(kw in desc for kw in ["network", "connection", "timeout", "latency"]):
            return "network"
        elif any(kw in desc for kw in ["database", "query", "sql", "data"]):
            return "database"
        elif any(kw in desc for kw in ["application", "app", "software", "bug"]):
            return "application"
        else:
            return "other"
    
    def full_rebuild(self):
        """Perform full rebuild of incident index."""
        start_time = datetime.now()
        
        logger.info("")
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 20 + "BATCH INCIDENT INDEXER - FULL REBUILD" + " " * 21 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        logger.info(f"⏰ Started at: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"📊 Mode: FULL REBUILD (all incidents from scratch)")
        logger.info("")
        
        # Load manifest
        self.manifest = self.load_manifest()
        
        # Show feature flag status
        logger.info("")
        logger.info("🔧 FEATURE FLAGS:")
        logger.info(f"   FULL_INCIDENT_EMBEDDED_SIMILARITY_ANALYSIS: {'ENABLED ✓' if FULL_INCIDENT_EMBEDDED_SIMILARITY else 'DISABLED'}")
        if FULL_INCIDENT_EMBEDDED_SIMILARITY:
            logger.info("   → Embeddings will include: short_description + work_notes (up to 2000 chars)")
        else:
            logger.info("   → Embeddings will include: short_description only (standard)")
        logger.info("")
        
        # Phase 1: Fetch incidents
        logger.info("[PHASE 1/4] Fetching incidents from ServiceNow...")
        fetch_start = datetime.now()
        all_incidents = self.fetch_all_incidents_unlimited(limit=10000)
        fetch_duration = (datetime.now() - fetch_start).total_seconds()
        
        if not all_incidents:
            logger.error("❌ No incidents fetched. Aborting.")
            return
        
        logger.info(f"✅ Fetched {len(all_incidents)} incidents in {fetch_duration:.1f}s")
        logger.info("")
        
        # Apply incident number filter if specified
        if hasattr(self, 'filter_prefix') and self.filter_prefix:
            original_count = len(all_incidents)
            all_incidents = [inc for inc in all_incidents if inc.get('number', '').startswith(self.filter_prefix)]
            logger.info(f"🔍 FILTER APPLIED: Incident numbers starting with '{self.filter_prefix}'")
            logger.info(f"   Before filter: {original_count} incidents")
            logger.info(f"   After filter:  {len(all_incidents)} incidents")
            logger.info("")
            
            if not all_incidents:
                logger.warning(f"⚠️  No incidents match filter '{self.filter_prefix}'. Aborting.")
                return
        
        # Phase 2: Initialize index
        logger.info("[PHASE 2/4] Initializing FAISS index and metadata database...")
        self.faiss_index = faiss.IndexFlatL2(EMBEDDING_DIM)
        self.incidents_table.truncate()
        logger.info(f"✅ Created empty FAISS index (dimension={EMBEDDING_DIM})")
        logger.info(f"✅ Cleared metadata database")
        logger.info("")
        
        # Phase 3: Process incidents
        logger.info("[PHASE 3/4] Processing incidents and generating embeddings...")
        process_start = datetime.now()
        
        # Process incidents
        processed = 0
        skipped = 0
        cache_hits = 0
        cache_misses = 0
        category_stats: Dict[str, int] = {}
        
        for idx, incident in enumerate(all_incidents):
            inc_num = incident.get("number")
            short_desc = incident.get("short_description", "")
            
            if not short_desc:
                logger.debug(f"⚠️  Skipping {inc_num}: no short description")
                skipped += 1
                continue
            
            try:
                # Determine embedding text based on feature flag
                if FULL_INCIDENT_EMBEDDED_SIMILARITY:
                    # Combine short_description + work_notes for richer similarity
                    work_notes = incident.get("work_notes", "") or ""
                    # Limit work_notes to 2000 chars to avoid token limits
                    work_notes_truncated = work_notes[:2000] if work_notes else ""
                    embedding_text = f"{short_desc}\n\n{work_notes_truncated}".strip()
                    cache_key = f"FULL:{short_desc}"  # Use prefix to distinguish from short-only
                else:
                    # Standard mode: only short_description
                    embedding_text = short_desc
                    cache_key = short_desc
                
                # Check cache first
                embedding = get_cached_embedding(cache_key)
                
                if embedding is not None:
                    cache_hits += 1
                else:
                    # Generate new embedding
                    embedding = generate_embeddings([embedding_text])[0]
                    cache_embedding(cache_key, embedding)
                    cache_misses += 1
                
                # Add to FAISS index
                embedding_np = np.array(embedding, dtype="float32").reshape(1, -1)
                self.faiss_index.add(embedding_np)  # type: ignore[call-arg]
                
                # Track category statistics
                category = self.categorize_incident(incident)
                category_stats[category] = category_stats.get(category, 0) + 1
                
                # Store metadata
                self.upsert_incident_metadata(
                    incident=incident,
                    faiss_index=idx,  # Position in FAISS index
                    embedding_generated_at=datetime.now().isoformat()
                )
                
                processed += 1
                
                # Progress updates with ETA
                if processed % 50 == 0 or processed == len(all_incidents):
                    elapsed = (datetime.now() - process_start).total_seconds()
                    rate = processed / elapsed if elapsed > 0 else 0
                    remaining = len(all_incidents) - processed
                    eta_seconds = remaining / rate if rate > 0 else 0
                    
                    progress_pct = (processed / len(all_incidents)) * 100
                    bar_length = 40
                    filled = int(bar_length * processed / len(all_incidents))
                    bar = '█' * filled + '░' * (bar_length - filled)
                    
                    logger.info(f"   {bar} {progress_pct:5.1f}% | "
                               f"{processed}/{len(all_incidents)} | "
                               f"Rate: {rate:.1f}/s | "
                               f"Cache: {cache_hits}✓/{cache_misses}✗ | "
                               f"ETA: {eta_seconds/60:.1f}m")
                
            except Exception as e:
                logger.error(f"❌ Failed to process {inc_num}: {e}")
                skipped += 1
        
        process_duration = (datetime.now() - process_start).total_seconds()
        logger.info(f"✅ Processed {processed} incidents in {process_duration:.1f}s")
        logger.info("")
        
        # Phase 4: Save index
        logger.info("[PHASE 4/4] Saving FAISS index and metadata...")
        save_start = datetime.now()
        self.save_index()
        self.save_manifest()
        save_duration = (datetime.now() - save_start).total_seconds()
        logger.info(f"✅ Saved index and metadata in {save_duration:.1f}s")
        logger.info("")
        
        # Calculate total time and cost
        total_duration = (datetime.now() - start_time).total_seconds()
        
        # Cost estimation (text-embedding-ada-002: $0.0001 per 1K tokens)
        avg_tokens_per_incident = 50  # Conservative estimate
        total_tokens = cache_misses * avg_tokens_per_incident
        estimated_cost = (total_tokens / 1000000) * 0.10  # $0.10 per 1M tokens
        
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 25 + "INDEXING COMPLETE - SUMMARY" + " " * 26 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        logger.info("📊 PROCESSING STATISTICS:")
        logger.info(f"   Total incidents fetched: {len(all_incidents)}")
        logger.info(f"   Successfully processed:  {processed}")
        logger.info(f"   Skipped (no desc):       {skipped}")
        logger.info("")
        logger.info("💾 CACHE PERFORMANCE:")
        total_requests = cache_hits + cache_misses
        cache_hit_rate = (cache_hits / total_requests * 100) if total_requests > 0 else 0
        logger.info(f"   Cache hits:     {cache_hits:4d} ({cache_hit_rate:.1f}%)")
        logger.info(f"   Cache misses:   {cache_misses:4d} (new embeddings generated)")
        logger.info(f"   API calls made: {cache_misses:4d}")
        logger.info("")
        logger.info("💰 COST ESTIMATION:")
        logger.info(f"   Tokens processed:  ~{total_tokens:,} tokens")
        logger.info(f"   Estimated cost:    ${estimated_cost:.4f}")
        logger.info("")
        logger.info("📁 OUTPUT FILES:")
        index_size_kb = FAISS_INDEX_PATH.stat().st_size / 1024
        index_size_mb = index_size_kb / 1024
        metadata_size_kb = METADATA_DB_PATH.stat().st_size / 1024
        logger.info(f"   FAISS index:    {FAISS_INDEX_PATH}")
        logger.info(f"                  {index_size_mb:.2f} MB ({self.faiss_index.ntotal} vectors)")
        logger.info(f"   Metadata DB:    {METADATA_DB_PATH}")
        logger.info(f"                  {metadata_size_kb:.2f} KB ({processed} incidents)")
        logger.info(f"   Manifest:       {MANIFEST_PATH}")
        logger.info("")
        logger.info("📈 CATEGORY BREAKDOWN:")
        for category, count in sorted(category_stats.items(), key=lambda x: x[1], reverse=True):
            logger.info(f"   {category:20s}: {count:4d} incidents")
        logger.info("")
        logger.info("⏱️  TIMING BREAKDOWN:")
        logger.info(f"   Fetch incidents:    {fetch_duration:6.1f}s")
        logger.info(f"   Process embeddings: {process_duration:6.1f}s ({processed/process_duration:.1f} inc/s)")
        logger.info(f"   Save to disk:       {save_duration:6.1f}s")
        logger.info(f"   ───────────────────────────")
        logger.info(f"   Total time:         {total_duration:6.1f}s ({total_duration/60:.1f} minutes)")
        logger.info("")
        logger.info(f"✅ Index is ready for use!")
        logger.info(f"   Next: Restart backend to use optimized similarity search")
        logger.info("")
        logger.info("#" * 80)
        logger.info("")
    
    def incremental_update(self, since_hours: int = 24):
        """Perform incremental update for new/changed incidents."""
        start_time = datetime.now()
        
        logger.info("")
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 15 + "BATCH INCIDENT INDEXER - INCREMENTAL UPDATE" + " " * 20 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        logger.info(f"⏰ Started at: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"🔄 Mode: INCREMENTAL (changes in last {since_hours} hours)")
        logger.info("")
        
        # Load existing index
        logger.info("[PHASE 1/4] Loading existing index...")
        self.faiss_index = self.load_or_create_index()
        self.manifest = self.load_manifest()
        initial_count = self.faiss_index.ntotal
        logger.info(f"✅ Loaded index with {initial_count} existing vectors")
        logger.info("")
        
        # Fetch recent incidents
        logger.info("[PHASE 2/4] Fetching incidents from ServiceNow...")
        fetch_start = datetime.now()
        all_incidents = self.fetch_all_incidents_unlimited(limit=10000)
        fetch_duration = (datetime.now() - fetch_start).total_seconds()
        
        if not all_incidents:
            logger.warning("⚠️  No incidents fetched")
            return
        
        logger.info(f"✅ Fetched {len(all_incidents)} total incidents in {fetch_duration:.1f}s")
        logger.info("")
        
        # Filter for recent updates
        logger.info("[PHASE 3/4] Filtering for recent changes...")
        cutoff_time = datetime.now() - timedelta(hours=since_hours)
        recent_incidents = []
        
        for inc in all_incidents:
            updated_str = inc.get("sys_updated_on", "")
            if updated_str:
                try:
                    # Parse ServiceNow datetime format
                    updated_dt = datetime.strptime(updated_str.split('.')[0], "%Y-%m-%d %H:%M:%S")
                    if updated_dt >= cutoff_time:
                        recent_incidents.append(inc)
                except Exception:
                    pass
        
        logger.info(f"✅ Found {len(recent_incidents)} incidents updated since {cutoff_time.strftime('%Y-%m-%d %H:%M:%S')}")
        
        if not recent_incidents:
            logger.info("ℹ️  No recent updates. Index is current.")
            logger.info("")
            return
        
        logger.info("")
        
        # Process recent incidents
        logger.info("[PHASE 4/4] Processing updates...")
        process_start = datetime.now()
        new_count = 0
        updated_count = 0
        cache_hits = 0
        cache_misses = 0
        
        for incident in recent_incidents:
            inc_num = incident.get("number")
            short_desc = incident.get("short_description", "")
            
            if not short_desc:
                continue
            
            # Check if incident already indexed
            existing_meta = self.get_incident_metadata(inc_num)
            
            if existing_meta:
                # Update existing entry
                # For simplicity, we'll append new vector (FAISS doesn't support in-place updates easily)
                # Production systems might rebuild periodically or use more sophisticated indexing
                logger.debug(f"Updating {inc_num} (already indexed at position {existing_meta['faiss_index']})")
                updated_count += 1
            else:
                # New incident - add to index
                try:
                    embedding = get_cached_embedding(short_desc)
                    if embedding is None:
                        embedding = generate_embeddings([short_desc])[0]
                        cache_embedding(short_desc, embedding)
                        cache_misses += 1
                    else:
                        cache_hits += 1
                    
                    embedding_np = np.array(embedding, dtype="float32").reshape(1, -1)
                    current_position = self.faiss_index.ntotal
                    self.faiss_index.add(embedding_np)  # type: ignore[call-arg]
                    
                    self.upsert_incident_metadata(
                        incident=incident,
                        faiss_index=current_position,
                        embedding_generated_at=datetime.now().isoformat()
                    )
                    
                    new_count += 1
                    if new_count % 10 == 0:
                        logger.info(f"   Added {new_count}/{len(recent_incidents)} new incidents...")
                    
                except Exception as e:
                    logger.error(f"❌ Failed to process {inc_num}: {e}")
        
        process_duration = (datetime.now() - process_start).total_seconds()
        logger.info(f"✅ Processed updates in {process_duration:.1f}s")
        logger.info("")
        
        # Save updated index
        logger.info("Saving updated index...")
        save_start = datetime.now()
        self.save_index()
        self.save_manifest()
        save_duration = (datetime.now() - save_start).total_seconds()
        logger.info(f"✅ Saved in {save_duration:.1f}s")
        logger.info("")
        
        total_duration = (datetime.now() - start_time).total_seconds()
        
        # Cost estimation
        avg_tokens_per_incident = 50
        total_tokens = cache_misses * avg_tokens_per_incident
        estimated_cost = (total_tokens / 1000000) * 0.10
        
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 20 + "INCREMENTAL UPDATE COMPLETE - SUMMARY" + " " * 19 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        logger.info("📊 UPDATE STATISTICS:")
        logger.info(f"   Recent incidents found:  {len(recent_incidents)}")
        logger.info(f"   New incidents added:     {new_count}")
        logger.info(f"   Existing incidents seen: {updated_count}")
        logger.info(f"   Previous vector count:   {initial_count}")
        logger.info(f"   Current vector count:    {self.faiss_index.ntotal}")
        logger.info(f"   Net change:              +{self.faiss_index.ntotal - initial_count}")
        logger.info("")
        logger.info("💾 CACHE PERFORMANCE:")
        total_requests = cache_hits + cache_misses
        cache_hit_rate = (cache_hits / total_requests * 100) if total_requests > 0 else 0
        logger.info(f"   Cache hits:   {cache_hits:4d} ({cache_hit_rate:.1f}%)")
        logger.info(f"   Cache misses: {cache_misses:4d}")
        logger.info("")
        logger.info("💰 COST ESTIMATION:")
        logger.info(f"   Tokens processed: ~{total_tokens:,}")
        logger.info(f"   Estimated cost:   ${estimated_cost:.4f}")
        logger.info("")
        logger.info("⏱️  TIMING:")
        logger.info(f"   Total time: {total_duration:.1f}s ({total_duration/60:.1f} minutes)")
        logger.info("")
        logger.info("✅ Index updated successfully!")
        logger.info("")
        logger.info("#" * 80)
        logger.info("")
    
    def show_stats(self):
        """Display statistics about the current index."""
        logger.info("")
        logger.info("#" * 80)
        logger.info("#" + " " * 78 + "#")
        logger.info("#" + " " * 20 + "INCIDENT INDEX STATISTICS & HEALTH" + " " * 23 + "#")
        logger.info("#" + " " * 78 + "#")
        logger.info("#" * 80)
        logger.info("")
        
        # Load manifest
        self.manifest = self.load_manifest()
        
        logger.info("📋 MANIFEST INFORMATION:")
        created = self.manifest.get('created_at', 'N/A')
        updated = self.manifest.get('last_updated', 'N/A')
        logger.info(f"   Created:         {created}")
        logger.info(f"   Last Updated:    {updated}")
        logger.info(f"   Total Incidents: {self.manifest.get('total_incidents', 0)}")
        logger.info(f"   Embedding Model: {self.manifest.get('embedding_model', 'N/A')}")
        logger.info(f"   Dimension:       {self.manifest.get('dimension', 0)}")
        
        # Calculate age
        if updated != 'N/A':
            try:
                updated_dt = datetime.fromisoformat(updated)
                age_hours = (datetime.now() - updated_dt).total_seconds() / 3600
                if age_hours < 24:
                    age_str = f"{age_hours:.1f} hours ago ✅"
                elif age_hours < 48:
                    age_str = f"{age_hours/24:.1f} days ago ⚠️ (consider update)"
                else:
                    age_str = f"{age_hours/24:.1f} days ago ⚠️ (UPDATE RECOMMENDED)"
                logger.info(f"   Index Age:       {age_str}")
            except:
                pass
        
        logger.info("")
        
        # FAISS index stats
        logger.info("🗂️  FAISS INDEX:")
        if FAISS_INDEX_PATH.exists():
            index = self.load_or_create_index()
            size_kb = FAISS_INDEX_PATH.stat().st_size / 1024
            size_mb = size_kb / 1024
            logger.info(f"   Status:   ✅ EXISTS")
            logger.info(f"   Path:     {FAISS_INDEX_PATH}")
            logger.info(f"   Size:     {size_mb:.2f} MB ({index.ntotal:,} vectors)")
            logger.info(f"   Vectors:  {index.ntotal:,}")
        else:
            logger.info(f"   Status:   ❌ NOT FOUND")
            logger.info(f"   Path:     {FAISS_INDEX_PATH}")
            logger.info(f"   Action:   Run 'python batch_incident_indexer.py --mode full'")
        
        logger.info("")
        
        # Metadata DB stats
        logger.info("💾 METADATA DATABASE:")
        if METADATA_DB_PATH.exists():
            size_kb = METADATA_DB_PATH.stat().st_size / 1024
            count = len(self.incidents_table.all())
            logger.info(f"   Status:    ✅ EXISTS")
            logger.info(f"   Path:      {METADATA_DB_PATH}")
            logger.info(f"   Size:      {size_kb:.2f} KB")
            logger.info(f"   Incidents: {count:,}")
            logger.info("")
            
            # Category breakdown
            logger.info("📊 INCIDENT BREAKDOWN:")
            all_incidents = self.incidents_table.all()
            states = {}
            priorities = {}
            categories = {}
            
            for inc in all_incidents:
                state = inc.get('state', 'unknown')
                states[state] = states.get(state, 0) + 1
                
                priority = inc.get('priority', 'unknown')
                priorities[priority] = priorities.get(priority, 0) + 1
                
                category = inc.get('category', 'unknown')
                categories[category] = categories.get(category, 0) + 1
            
            logger.info(f"   By State (top 5):")
            for state, cnt in sorted(states.items(), key=lambda x: -x[1])[:5]:
                pct = (cnt / count * 100) if count > 0 else 0
                bar = "█" * int(pct / 5)
                logger.info(f"      {state:15s}: {cnt:4d} ({pct:5.1f}%) {bar}")
            
            logger.info(f"")
            logger.info(f"   By Priority (top 5):")
            for priority, cnt in sorted(priorities.items(), key=lambda x: -x[1])[:5]:
                pct = (cnt / count * 100) if count > 0 else 0
                bar = "█" * int(pct / 5)
                logger.info(f"      {priority:15s}: {cnt:4d} ({pct:5.1f}%) {bar}")
            
            logger.info(f"")
            logger.info(f"   By Category (top 5):")
            for category, cnt in sorted(categories.items(), key=lambda x: -x[1])[:5]:
                pct = (cnt / count * 100) if count > 0 else 0
                bar = "█" * int(pct / 5)
                logger.info(f"      {category:15s}: {cnt:4d} ({pct:5.1f}%) {bar}")
        
        else:
            logger.info(f"   Status: ❌ NOT FOUND")
            logger.info(f"   Path:   {METADATA_DB_PATH}")
        
        logger.info("")
        logger.info("#" * 80)
        logger.info("")


def main():
    parser = argparse.ArgumentParser(description="Batch Incident Indexer for ServiceNow")
    parser.add_argument(
        '--mode',
        choices=['full', 'incremental', 'stats'],
        default='stats',
        help='Operation mode: full rebuild, incremental update, or show stats'
    )
    parser.add_argument(
        '--since-hours',
        type=int,
        default=24,
        help='For incremental mode: process incidents updated in last N hours (default: 24)'
    )
    parser.add_argument(
        '--filter-prefix',
        type=str,
        default=None,
        help='Filter incidents by number prefix (e.g., "INC9" to only process INC9xxx incidents)'
    )
    
    args = parser.parse_args()
    
    indexer = IncidentIndexer()
    
    try:
        # Set filter prefix if provided
        if args.filter_prefix:
            indexer.filter_prefix = args.filter_prefix
            logger.info(f"🔍 Incident filter enabled: {args.filter_prefix}")
            logger.info("")
        
        if args.mode == 'full':
            indexer.full_rebuild()
        elif args.mode == 'incremental':
            indexer.incremental_update(since_hours=args.since_hours)
        elif args.mode == 'stats':
            indexer.show_stats()
    finally:
        # Always close database to flush writes
        indexer.close()


if __name__ == "__main__":
    main()
