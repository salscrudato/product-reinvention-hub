"""
Iterative Knowledge Tree Builder for Incident Analysis

This builds a hierarchical knowledge structure by:
1. Processing incidents one-by-one
2. Finding similar incidents using FAISS vectors
3. Extracting root causes, resolutions, and workarounds from work notes
4. Clustering into categories → root causes → workarounds
5. Building actionable L2 support knowledge base

Output Structure:
- Hierarchical JSON knowledge tree
- L2 Support Guide with workarounds by category
- Root Cause → Resolution mapping
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple, Set
from pathlib import Path
from collections import defaultdict
import numpy as np
import faiss
from difflib import SequenceMatcher

# Add components to path
sys.path.insert(0, os.path.dirname(__file__))

from components.servicenowgenaitool import (
    fetch_all_incidents_core,
    get_cached_embedding,
    generate_embeddings,
    GPT_MODEL_NAME
)
import openai
from tinydb import TinyDB, Query

# Configuration
SCRIPT_DIR = Path(__file__).parent.resolve()
OUTPUT_BASE_DIR = SCRIPT_DIR.parent / "docs" / "incident_knowledge_tree"
OUTPUT_BASE_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(str(OUTPUT_BASE_DIR / 'knowledge_tree_builder.log'), encoding='utf-8'),
        logging.StreamHandler()
    ]
)
# Force stdout to use UTF-8 encoding on Windows
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
logger = logging.getLogger(__name__)

# Feature flags
VECTORED_INCIDENTS_ONLY = os.getenv("VECTORED_INCIDENTS_ANALYSIS_ONLY", "0").lower() in ("1", "true", "yes", "on")

class KnowledgeTreeBuilder:
    """Builds hierarchical incident knowledge tree through iterative clustering."""
    
    # Cost tracking (GPT-3.5-Turbo pricing)
    COST_PER_1K_INPUT_TOKENS = 0.0005
    COST_PER_1K_OUTPUT_TOKENS = 0.0015
    
    def __init__(self):
        self.faiss_index: Optional[faiss.Index] = None
        self.indexed_incidents: List[Dict[str, Any]] = []  # Already processed incidents
        self.knowledge_tree: Dict[str, Any] = {
            "categories": {},
            "metadata": {
                "created_at": datetime.now().isoformat(),
                "total_incidents_processed": 0,
                "vectored_only": VECTORED_INCIDENTS_ONLY
            }
        }
        
        # Cost tracking
        self.total_cost = 0.0
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.api_call_count = 0
        
    def load_faiss_index(self) -> bool:
        """Load existing FAISS index and metadata."""
        index_path = SCRIPT_DIR / "incidents_production.index"
        metadata_path = SCRIPT_DIR / "incidents_metadata.json"
        
        if not index_path.exists():
            logger.error(f"❌ FAISS index not found: {index_path}")
            logger.error("   Run batch_incident_indexer.py first!")
            return False
        
        try:
            self.faiss_index = faiss.read_index(str(index_path))
            logger.info(f"✅ Loaded FAISS index: {self.faiss_index.ntotal} vectors")
            
            # Load metadata (informational only - not used for filtering)
            if metadata_path.exists():
                metadata_db = TinyDB(str(metadata_path))
                incidents_table = metadata_db.table('incidents')
                metadata_list = incidents_table.all()
                logger.info(f"ℹ️  Metadata DB has {len(metadata_list)} records (may differ from index)")
                metadata_db.close()
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to load FAISS index: {e}")
            return False
    
    def extract_from_work_notes(self, work_notes: str, close_notes: str, short_desc: str) -> Dict[str, str]:
        """Extract structured information from work notes using LLM."""
        # Combine all available text
        combined_text = f"""
Short Description: {short_desc}

Work Notes:
{work_notes[:2500]}

Close Notes:
{close_notes[:1000]}
""".strip()
        
        prompt = f"""Extract the following from this incident's work notes and resolution history.
Focus on ACTUAL documented information, not assumptions.

{combined_text}

Provide in this EXACT format:
ROOT_CAUSE: [What caused the issue? Quote from notes if documented]
RESOLUTION: [How was it fixed? Step-by-step if available]
WORKAROUND: [Temporary fix or workaround mentioned, if any]
CATEGORY: [Business area: Policy Management, Claims, Billing, Underwriting, Documents, System/Technical, Other]
PATTERN: [Brief pattern description: e.g., "Database timeout during peak hours"]

If information not found in notes, write "Not documented in work notes"
"""
        
        try:
            response = openai.chat.completions.create(
                model=GPT_MODEL_NAME,
                messages=[
                    {"role": "system", "content": "You are extracting actual documented information from incident work notes. Only report what is explicitly stated."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=600,
                temperature=0.2
            )
            
            # Track cost
            usage = response.usage
            if usage:
                self.api_call_count += 1
                self.total_input_tokens += usage.prompt_tokens
                self.total_output_tokens += usage.completion_tokens
                self.total_cost += (
                    (usage.prompt_tokens / 1000) * self.COST_PER_1K_INPUT_TOKENS +
                    (usage.completion_tokens / 1000) * self.COST_PER_1K_OUTPUT_TOKENS
                )
            
            content = response.choices[0].message.content or ""
            
            # Parse response
            extracted = {
                "root_cause": "Not documented",
                "resolution": "Not documented",
                "workaround": "Not documented",
                "category": "other",
                "pattern": "Not documented"
            }
            
            for line in content.split('\n'):
                line = line.strip()
                if line.startswith('ROOT_CAUSE:'):
                    extracted["root_cause"] = line.replace('ROOT_CAUSE:', '').strip()
                elif line.startswith('RESOLUTION:'):
                    extracted["resolution"] = line.replace('RESOLUTION:', '').strip()
                elif line.startswith('WORKAROUND:'):
                    extracted["workaround"] = line.replace('WORKAROUND:', '').strip()
                elif line.startswith('CATEGORY:'):
                    extracted["category"] = line.replace('CATEGORY:', '').strip().lower().replace(' ', '_')
                elif line.startswith('PATTERN:'):
                    extracted["pattern"] = line.replace('PATTERN:', '').strip()
            
            return extracted
            
        except Exception as e:
            logger.warning(f"⚠️  LLM extraction failed: {e}")
            return {
                "root_cause": "Extraction failed",
                "resolution": "Extraction failed",
                "workaround": "Not available",
                "category": "other",
                "pattern": "Unknown"
            }
    
    def find_similar_processed(self, incident_embedding: List[float], top_k: int = 10) -> List[Tuple[int, float, Dict]]:
        """Find similar incidents among already processed ones."""
        if not self.indexed_incidents or not self.faiss_index:
            return []
        
        query_vec = np.array(incident_embedding, dtype='float32').reshape(1, -1)
        distances, indices = self.faiss_index.search(query_vec, min(top_k, len(self.indexed_incidents)))  # type: ignore[call-arg]
        
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx < len(self.indexed_incidents):
                similarity = 1.0 / (1.0 + float(dist))  # Convert distance to similarity
                if similarity > 0.70:  # Only return genuinely similar
                    results.append((idx, similarity, self.indexed_incidents[idx]))
        
        return results
    
    def text_similarity(self, text1: str, text2: str) -> float:
        """Calculate text similarity using SequenceMatcher."""
        return SequenceMatcher(None, text1.lower(), text2.lower()).ratio()
    
    def add_to_knowledge_tree(self, incident: Dict[str, Any], extracted: Dict[str, str], 
                              similar_incidents: List[Tuple[int, float, Dict]]):
        """Add incident to knowledge tree with clustering logic."""
        category = extracted["category"]
        root_cause = extracted["root_cause"]
        resolution = extracted["resolution"]
        workaround = extracted["workaround"]
        pattern = extracted["pattern"]
        
        # Initialize category if new
        if category not in self.knowledge_tree["categories"]:
            self.knowledge_tree["categories"][category] = {
                "total_incidents": 0,
                "root_cause_patterns": {},
                "category_name": category.replace('_', ' ').title()
            }
        
        cat_data = self.knowledge_tree["categories"][category]
        cat_data["total_incidents"] += 1
        
        # Find matching root cause pattern within category
        best_match_pattern = None
        best_similarity = 0.0
        
        for existing_pattern, pattern_data in cat_data["root_cause_patterns"].items():
            similarity = self.text_similarity(root_cause, existing_pattern)
            if similarity > best_similarity and similarity > 0.7:
                best_similarity = similarity
                best_match_pattern = existing_pattern
        
        # Add to existing pattern or create new
        if best_match_pattern and best_similarity > 0.7:
            pattern_key = best_match_pattern
        else:
            pattern_key = root_cause[:100]  # Use truncated root cause as key
        
        if pattern_key not in cat_data["root_cause_patterns"]:
            cat_data["root_cause_patterns"][pattern_key] = {
                "incident_count": 0,
                "root_cause_full": root_cause,
                "pattern_desc": pattern,
                "resolutions": [],
                "workarounds": [],
                "incidents": []
            }
        
        pattern_data = cat_data["root_cause_patterns"][pattern_key]
        pattern_data["incident_count"] += 1
        
        # Add resolution if documented
        if resolution != "Not documented" and resolution != "Not documented in work notes":
            if resolution not in pattern_data["resolutions"]:
                pattern_data["resolutions"].append(resolution)
        
        # Add workaround if documented
        if workaround != "Not documented" and workaround != "Not documented in work notes":
            if workaround not in pattern_data["workarounds"]:
                pattern_data["workarounds"].append(workaround)
        
        # Track incident
        pattern_data["incidents"].append({
            "number": incident.get("number"),
            "short_description": incident.get("short_description", "")[:100],
            "state": incident.get("state"),
            "priority": incident.get("priority")
        })
    
    def build_knowledge_tree(self, incidents: List[Dict[str, Any]], cost_limit: float = 25.0):
        """Main processing loop - iteratively build knowledge tree."""
        logger.info("")
        logger.info("=" * 80)
        logger.info("ITERATIVE KNOWLEDGE TREE BUILDER")
        logger.info("=" * 80)
        logger.info("")
        logger.info(f"📊 Total incidents from ServiceNow: {len(incidents)}")
        logger.info(f"💰 Cost limit: ${cost_limit:.2f}")
        logger.info(f"📁 Output directory: {OUTPUT_BASE_DIR}")
        logger.info("")
        logger.info("⏳ Starting analysis...")
        logger.info("   (Only incidents with work notes will be analyzed)")
        logger.info("")
        
        start_time = datetime.now()
        skipped_no_notes = 0
        idx = -1  # Initialize in case loop doesn't run
        
        for idx, incident in enumerate(incidents):
            # Cost limit check
            if self.total_cost >= cost_limit:
                logger.warning(f"⚠️  Cost limit reached: ${self.total_cost:.2f}")
                logger.warning(f"   Scanned {idx}/{len(incidents)} incidents")
                logger.warning(f"   Analyzed: {len(self.indexed_incidents)} (with work notes)")
                break
            
            inc_num = incident.get("number")
            short_desc = incident.get("short_description", "")
            work_notes = incident.get("work_notes", "") or ""
            close_notes = incident.get("close_notes", "") or ""
            
            if not work_notes and not close_notes:
                skipped_no_notes += 1
                continue  # Skip silently
            
            try:
                # Progress indicator for incidents BEING ANALYZED
                if len(self.indexed_incidents) % 10 == 0 and len(self.indexed_incidents) > 0:
                    logger.info(f"🔄 Analyzing: {inc_num} (#{len(self.indexed_incidents)+1} with work notes, scanned {idx + 1}/{len(incidents)} total)")
                
                # Step 1: Extract information from work notes
                extracted = self.extract_from_work_notes(work_notes, close_notes, short_desc)
                
                # Step 2: Find similar already-processed incidents (using FAISS)
                # Generate embedding for similarity search
                embedding_text = f"{short_desc}\n{work_notes[:500]}"
                embedding = get_cached_embedding(embedding_text)
                if not embedding:
                    embedding = generate_embeddings([embedding_text])[0]
                
                similar_incidents = self.find_similar_processed(embedding, top_k=10)
                
                # Step 3: Add to knowledge tree with clustering
                self.add_to_knowledge_tree(incident, extracted, similar_incidents)
                
                # Track this incident as processed
                self.indexed_incidents.append({
                    "number": inc_num,
                    "embedding": embedding,
                    "extracted": extracted
                })
                
                # Progress reporting every 25 incidents ANALYZED (not scanned)
                if len(self.indexed_incidents) % 25 == 0:
                    progress_scanned = (idx + 1) / len(incidents) * 100
                    elapsed = (datetime.now() - start_time).total_seconds()
                    rate = len(self.indexed_incidents) / elapsed if elapsed > 0 else 0
                    remaining_to_scan = len(incidents) - idx - 1
                    eta_scan = (remaining_to_scan / ((idx + 1) / elapsed)) if elapsed > 0 and idx > 0 else 0
                    
                    logger.info(f"")
                    logger.info(f"📈 PROGRESS UPDATE")
                    logger.info(f"   Scanned: {idx + 1}/{len(incidents)} ({progress_scanned:5.1f}%)")
                    logger.info(f"   Analyzed: {len(self.indexed_incidents)} incidents (WITH work notes)")
                    logger.info(f"   Skipped: {skipped_no_notes} (no work notes)")
                    logger.info(f"   Categories: {len(self.knowledge_tree['categories'])}")
                    logger.info(f"   Cost: ${self.total_cost:.4f} / ${cost_limit:.2f}")
                    logger.info(f"   API calls: {self.api_call_count}")
                    logger.info(f"   Analysis rate: {rate:.2f} inc/sec")
                    logger.info(f"   ETA: {eta_scan/60:.1f} minutes")
                    logger.info(f"")
                
            except Exception as e:
                logger.error(f"❌ Error processing {inc_num}: {e}")
                continue
        
        duration = (datetime.now() - start_time).total_seconds()
        
        # Update metadata
        self.knowledge_tree["metadata"]["total_incidents_processed"] = len(self.indexed_incidents)
        self.knowledge_tree["metadata"]["processing_duration_seconds"] = duration
        self.knowledge_tree["metadata"]["total_cost"] = self.total_cost
        
        logger.info("")
        logger.info("✅ Knowledge Tree Building Complete!")
        logger.info("")
        logger.info(f"📊 Results:")
        logger.info(f"   Incidents scanned: {idx + 1}/{len(incidents)}")
        logger.info(f"   Incidents analyzed: {len(self.indexed_incidents)} (had work notes)")
        logger.info(f"   Incidents skipped: {skipped_no_notes} (no work notes)")
        logger.info(f"   Categories found: {len(self.knowledge_tree['categories'])}")
        logger.info(f"   Total API calls: {self.api_call_count}")
        logger.info(f"   Total cost: ${self.total_cost:.4f}")
        logger.info(f"   Duration: {duration:.1f}s ({duration/60:.1f} minutes)")
        logger.info("")
        
        return self.knowledge_tree
    
    def save_knowledge_tree(self, output_dir: Path = OUTPUT_BASE_DIR):
        """Save knowledge tree and generate reports."""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Save JSON tree
        json_path = output_dir / f"KNOWLEDGE_TREE_{timestamp}.json"
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(self.knowledge_tree, f, indent=2, ensure_ascii=False)
        
        logger.info(f"💾 Knowledge tree saved: {json_path.name}")
        
        # Generate L2 Support Guide
        self.generate_l2_guide(output_dir, timestamp)
        
        return json_path
    
    def generate_l2_guide(self, output_dir: Path, timestamp: str):
        """Generate actionable L2 support guide from knowledge tree."""
        guide = f"""# L2 SUPPORT GUIDE - Incident Knowledge Base
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  
**Source:** {self.knowledge_tree['metadata']['total_incidents_processed']} analyzed incidents

---

## Quick Reference by Category

"""
        
        # Sort categories by incident count
        sorted_categories = sorted(
            self.knowledge_tree["categories"].items(),
            key=lambda x: x[1]["total_incidents"],
            reverse=True
        )
        
        for cat_key, cat_data in sorted_categories:
            cat_name = cat_data["category_name"]
            total = cat_data["total_incidents"]
            
            guide += f"\n## {cat_name} ({total} incidents)\n\n"
            
            # Sort root causes by frequency
            sorted_patterns = sorted(
                cat_data["root_cause_patterns"].items(),
                key=lambda x: x[1]["incident_count"],
                reverse=True
            )
            
            for pattern_key, pattern_data in sorted_patterns:
                count = pattern_data["incident_count"]
                guide += f"### {pattern_data['pattern_desc']} ({count} occurrences)\n\n"
                guide += f"**Root Cause:**  \n{pattern_data['root_cause_full']}\n\n"
                
                if pattern_data["workarounds"]:
                    guide += "**Workarounds:**\n"
                    for workaround in pattern_data["workarounds"]:
                        guide += f"- {workaround}\n"
                    guide += "\n"
                
                if pattern_data["resolutions"]:
                    guide += "**Resolutions:**\n"
                    for resolution in pattern_data["resolutions"]:
                        guide += f"- {resolution}\n"
                    guide += "\n"
                
                # Sample incidents
                if pattern_data["incidents"]:
                    guide += "**Example Incidents:**  \n"
                    for inc in pattern_data["incidents"][:3]:
                        guide += f"- {inc['number']}: {inc['short_description']}\n"
                    guide += "\n"
        
        guide_path = output_dir / f"L2_KNOWLEDGE_BASE_{timestamp}.md"
        with open(guide_path, 'w', encoding='utf-8') as f:
            f.write(guide)
        
        logger.info(f"📚 L2 Guide created: {guide_path.name}")


def main():
    parser = argparse.ArgumentParser(description="Build hierarchical knowledge tree from incidents")
    parser.add_argument('--cost-limit', type=float, default=25.0, help="Maximum cost in USD")
    
    args = parser.parse_args()
    
    logger.info("🌳 Starting Knowledge Tree Builder")
    logger.info("")
    logger.info(f"📁 Output directory: {OUTPUT_BASE_DIR}")
    logger.info(f"💰 Cost limit: ${args.cost_limit:.2f}")
    logger.info("")
    
    builder = KnowledgeTreeBuilder()
    
    # Load FAISS index
    if not builder.load_faiss_index():
        return 1
    
    # Fetch incidents
    logger.info("📥 Fetching incidents from ServiceNow...")
    incidents_raw = fetch_all_incidents_core()
    
    if not incidents_raw:
        logger.error("❌ No incidents fetched")
        return 1
    
    # Type assertion - fetch_all_incidents_core returns list of dicts
    incidents: List[Dict[str, Any]] = incidents_raw if isinstance(incidents_raw, list) else []
    
    logger.info(f"✅ Fetched {len(incidents)} incidents from ServiceNow")
    
    # Filter to ONLY incidents that are already in FAISS index
    if VECTORED_INCIDENTS_ONLY:
        # Use incidents_metadata.json as source of truth for indexed incidents
        metadata_path = SCRIPT_DIR / "incidents_metadata.json"
        if metadata_path.exists():
            try:
                metadata_db = TinyDB(str(metadata_path))
                incidents_table = metadata_db.table('incidents')
                indexed_records = incidents_table.all()
                metadata_db.close()
                
                # Extract incident numbers from indexed records
                indexed_numbers = {rec.get('number') for rec in indexed_records if rec.get('number')}
                
                # Filter incidents to only those that are indexed
                original_count = len(incidents)
                incidents = [inc for inc in incidents 
                            if isinstance(inc, dict) and inc.get('number') in indexed_numbers]
                
                logger.info("")
                logger.info("⚙️  VECTORED_INCIDENTS_ANALYSIS_ONLY mode enabled")
                logger.info(f"   Filtered to ONLY incidents with FAISS embeddings: {len(incidents)}/{original_count}")
                logger.info(f"   Source: incidents_metadata.json ({len(indexed_numbers)} indexed incidents)")
                logger.info(f"   Skipping {original_count - len(incidents)} non-vectorized incidents")
            except Exception as e:
                logger.warning(f"⚠️  Failed to load metadata: {e}")
                logger.warning(f"   Processing all {len(incidents)} incidents without filtering")
        else:
            logger.warning(f"⚠️  Metadata file not found: {metadata_path}")
            logger.warning(f"   Processing all {len(incidents)} incidents without filtering")
            logger.info("")
    
    # Build knowledge tree
    knowledge_tree = builder.build_knowledge_tree(incidents, cost_limit=args.cost_limit)
    
    # Save results
    output_path = builder.save_knowledge_tree()
    
    logger.info("")
    logger.info("✅ Complete! Output files saved to:")
    logger.info(f"   {OUTPUT_BASE_DIR}")
    logger.info("")
    logger.info("📄 Files created:")
    logger.info(f"   - KNOWLEDGE_TREE_*.json (hierarchical structure)")
    logger.info(f"   - L2_KNOWLEDGE_BASE_*.md (actionable guide)")
    logger.info(f"   - knowledge_tree_builder.log (processing log)")
    logger.info("")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
