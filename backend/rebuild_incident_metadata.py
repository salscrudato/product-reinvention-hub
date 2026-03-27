"""
Rebuild incidents_metadata.json to match the FAISS index.
This syncs the metadata database when it's out of date with the FAISS index.
"""
import faiss
from tinydb import TinyDB, Query
from pathlib import Path
from datetime import datetime
from components.servicenowgenaitool import fetch_all_incidents_core
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FAISS_INDEX_PATH = Path("incidents_production.index")
METADATA_DB_PATH = Path("incidents_metadata.json")

def rebuild_metadata():
    # Load FAISS index
    if not FAISS_INDEX_PATH.exists():
        logger.error(f"FAISS index not found: {FAISS_INDEX_PATH}")
        return
    
    index = faiss.read_index(str(FAISS_INDEX_PATH))
    total_vectors = index.ntotal
    logger.info(f"Loaded FAISS index: {total_vectors} vectors")
    
    # Fetch all incidents from ServiceNow
    logger.info("Fetching incidents from ServiceNow...")
    incidents = fetch_all_incidents_core()
    logger.info(f"Fetched {len(incidents)} incidents")
    
    # Open metadata database
    db = TinyDB(str(METADATA_DB_PATH))
    incidents_table = db.table('incidents')
    Incident = Query()
    
    # Get existing metadata
    existing_records = {rec.get('number'): rec for rec in incidents_table.all()}
    logger.info(f"Existing metadata records: {len(existing_records)}")
    
    # We need to match incidents to FAISS indices
    # Assumption: The first 'total_vectors' incidents match the FAISS index in order
    # This is a simplification - ideally you'd store the embedding text hash
    
    logger.info(f"\nThis script needs the original indexer logic to properly match.")
    logger.info(f"Recommendation: Re-run batch_incident_indexer.py to ensure sync.")
    logger.info(f"\nCurrent state:")
    logger.info(f"  - FAISS vectors: {total_vectors}")
    logger.info(f"  - Metadata records: {len(existing_records)}")
    logger.info(f"  - ServiceNow incidents: {len(incidents)}")
    
    db.close()

if __name__ == "__main__":
    rebuild_metadata()
