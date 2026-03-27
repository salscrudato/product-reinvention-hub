"""Phase 2 & 3: Intelligent Workaround and Root Cause Identification Agents.

This module implements the advanced agent capabilities from the enhancement roadmap:
- Phase 2: Intelligent Workaround Agent with semantic search and success tracking
- Phase 3: Root Cause Identification Agent with symptom-to-cause mapping

Both agents use FAISS for semantic search, TinyDB for knowledge persistence,
and integrate with ServiceNow and GitHub for comprehensive analysis.
"""

import os
import json
import openai
import requests
import numpy as np
import faiss
import logging
import re
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from collections import Counter
from tinydb import TinyDB, Query
from .vectorization_and_index_creation import generate_embeddings
from .servicenowgenaitool import (
    fetch_servicenow_incident_core,
    servicenow_instance,
    servicenow_user,
    servicenow_password,
    GPT_MODEL_NAME
)

logger = logging.getLogger("agentic_orchestrator_auto.intelligent_agents")

def _sn_auth():
    """Return ServiceNow auth tuple."""
    if servicenow_user and servicenow_password:
        return (servicenow_user, servicenow_password)
    return None


# ============================================================================
# PHASE 2: INTELLIGENT WORKAROUND AGENT
# ============================================================================

def intelligent_workaround_search_core(
    incident_number: Optional[str] = None,
    symptom_description: Optional[str] = None,
    top_k: int = 5,
    min_success_rate: float = 0.5,
    prioritize_by: str = "success_rate"  # "success_rate" | "recency" | "frequency"
) -> Dict[str, Any]:
    """Intelligent workaround retrieval with semantic search and success ranking.
    
    This is Phase 2 implementation addressing the roadmap requirement:
    "Intelligent Workaround Agent with semantic search, success tracking, and ranking."
    
    Args:
        incident_number: ServiceNow incident number (will extract symptom from it)
        symptom_description: Direct symptom description for semantic search
        top_k: Number of workarounds to return (default 5)
        min_success_rate: Minimum success rate threshold 0.0-1.0 (default 0.5)
        prioritize_by: Ranking strategy - "success_rate", "recency", "frequency"
    
    Returns:
        Dictionary with:
        - workarounds: List of ranked workarounds with success metrics
        - symptom_analyzed: The symptom that was analyzed
        - search_method: How the workarounds were found
        - escalation_recommendations: If workarounds seen too many times
    """
    logger.info(f"[intelligent_workaround_search] incident={incident_number} symptom={symptom_description} top_k={top_k}")
    
    try:
        # Phase 1: Extract or use symptom description
        if incident_number and not symptom_description:
            incident = fetch_servicenow_incident_core(incident_number)
            if incident and not incident.get("error"):
                symptom_description = f"{incident.get('short_description', '')} {incident.get('description', '')}"
            else:
                return {"error": "Failed to fetch incident details", "incident": incident_number}
        
        if not symptom_description:
            return {"error": "Either incident_number or symptom_description is required"}
        
        logger.info(f"[intelligent_workaround_search] Analyzing symptom: {symptom_description[:100]}...")
        
        # Phase 2: Mine workarounds from historical incidents (limit to recent 500 closed incidents)
        workaround_db = _mine_workarounds_from_incidents(max_incidents=500)
        
        if not workaround_db:
            logger.warning("[intelligent_workaround_search] No workarounds found in historical data")
            return {
                "error": "No workarounds available in knowledge base",
                "recommendation": "Check similar incidents manually or escalate to engineering"
            }
        
        logger.info(f"[intelligent_workaround_search] Mined {len(workaround_db)} workarounds from historical data")
        
        # Phase 3: Semantic search using embeddings
        symptom_embedding = generate_embeddings([symptom_description])[0]
        symptom_embedding_np = np.array(symptom_embedding, dtype="float32")
        
        # Calculate similarity scores for each workaround
        ranked_workarounds = []
        for wa in workaround_db:
            wa_embedding = np.array(wa['symptom_embedding'], dtype="float32")
            similarity = float(np.dot(symptom_embedding_np, wa_embedding) / 
                              (np.linalg.norm(symptom_embedding_np) * np.linalg.norm(wa_embedding)))
            
            # Filter by minimum success rate
            if wa['success_rate'] >= min_success_rate:
                ranked_workarounds.append({
                    **wa,
                    'semantic_similarity': round(similarity, 3)
                })
        
        # Phase 4: Rank by specified strategy
        if prioritize_by == "success_rate":
            ranked_workarounds.sort(key=lambda x: (x['success_rate'], x['semantic_similarity']), reverse=True)
        elif prioritize_by == "recency":
            ranked_workarounds.sort(key=lambda x: (x['last_effective_date'], x['semantic_similarity']), reverse=True)
        elif prioritize_by == "frequency":
            ranked_workarounds.sort(key=lambda x: (x['applied_count'], x['semantic_similarity']), reverse=True)
        else:
            ranked_workarounds.sort(key=lambda x: x['semantic_similarity'], reverse=True)
        
        # Top K results
        top_workarounds = ranked_workarounds[:top_k]
        
        # Phase 5: Identify escalation candidates (workarounds used too frequently)
        escalation_candidates = [
            wa for wa in workaround_db 
            if wa['applied_count'] > wa.get('escalation_threshold', 5)
        ]
        
        return {
            "symptom_analyzed": symptom_description[:200],
            "search_method": "semantic_embedding_search",
            "total_workarounds_found": len(ranked_workarounds),
            "workarounds": top_workarounds,
            "escalation_recommendations": [
                {
                    "workaround_id": wa['id'],
                    "description": wa['description'],
                    "applied_count": wa['applied_count'],
                    "recommendation": f"This workaround has been applied {wa['applied_count']} times. Consider permanent fix."
                }
                for wa in escalation_candidates
            ],
            "prioritization_strategy": prioritize_by,
            "filters_applied": {"min_success_rate": min_success_rate, "top_k": top_k}
        }
        
    except Exception as e:
        logger.error(f"[intelligent_workaround_search] Error: {e}", exc_info=True)
        return {"error": f"Workaround search failed: {str(e)}"}


def _mine_workarounds_from_incidents(max_incidents: int = 500) -> List[Dict[str, Any]]:
    """Mine workarounds from closed ServiceNow incidents.
    
    Extracts workarounds from:
    1. u_workaround field (structured workaround data)
    2. Work notes (text analysis for workaround mentions)
    3. Close notes (resolution patterns)
    
    Returns:
        List of WorkaroundRecord dictionaries with embeddings and success metrics
    """
    logger.info(f"[mine_workarounds] Mining workarounds from last {max_incidents} closed incidents")
    
    try:
        # Fetch closed incidents with workarounds
        url = f"{servicenow_instance}/api/now/table/incident"
        params = {
            "sysparm_query": "state=6^u_workaroundISNOTEMPTY^ORclose_notesISNOTEMPTY",  # state=6 is Resolved
            "sysparm_limit": max_incidents,
            "sysparm_fields": "number,short_description,u_workaround,work_notes,close_notes,sys_updated_on,category"
        }
        
        response = requests.get(url, auth=_sn_auth(), params=params, timeout=60)
        response.raise_for_status()
        incidents = response.json().get("result", [])
        
        logger.info(f"[mine_workarounds] Fetched {len(incidents)} incidents with workaround data")
        
        # Extract unique workarounds
        workaround_map = {}  # key: workaround_text_normalized, value: WorkaroundRecord
        
        for inc in incidents:
            # Extract workaround from u_workaround field
            workaround_text = inc.get('u_workaround', '').strip()
            
            # Also extract from work notes using regex
            work_notes = inc.get('work_notes', '')
            if not workaround_text and work_notes:
                # Pattern: "workaround:", "temporary fix:", "applied:"
                wa_match = re.search(r'(?:workaround|temporary fix|applied|solution):\s*([^\n]{20,200})', 
                                     work_notes, re.IGNORECASE)
                if wa_match:
                    workaround_text = wa_match.group(1).strip()
            
            if not workaround_text or len(workaround_text) < 10:
                continue
            
            # Normalize workaround text (lowercase, remove extra spaces)
            normalized = ' '.join(workaround_text.lower().split())
            
            if normalized in workaround_map:
                # Update existing workaround record
                workaround_map[normalized]['applied_count'] += 1
                workaround_map[normalized]['source_incidents'].append(inc['number'])
                # Update last effective date if more recent
                if inc['sys_updated_on'] > workaround_map[normalized]['last_effective_date']:
                    workaround_map[normalized]['last_effective_date'] = inc['sys_updated_on']
            else:
                # Create new workaround record
                symptom = inc.get('short_description', '')
                symptom_embedding = generate_embeddings([symptom])[0]
                
                workaround_map[normalized] = {
                    "id": f"WA-{len(workaround_map) + 1:04d}",
                    "description": workaround_text,
                    "original_incident": inc['number'],
                    "symptom_embedding": symptom_embedding,
                    "affected_components": _extract_components(symptom),
                    "success_rate": 0.75,  # Default heuristic, would be updated by feedback tracking
                    "applied_count": 1,
                    "last_effective_date": inc.get('sys_updated_on', ''),
                    "source_incidents": [inc['number']],
                    "category": inc.get('category', 'general'),
                    "escalation_threshold": 5
                }
        
        workarounds = list(workaround_map.values())
        logger.info(f"[mine_workarounds] Extracted {len(workarounds)} unique workarounds")
        
        return workarounds
        
    except Exception as e:
        logger.error(f"[mine_workarounds] Error: {e}", exc_info=True)
        return []


def _extract_components(text: str) -> List[str]:
    """Extract component names from incident description using keyword matching."""
    # Common component keywords for insurance P&C systems
    component_keywords = {
        'BAW': ['baw', 'email', 'workflow'],
        'Rating Engine': ['rating', 'premium', 'calculation'],
        'Policy System': ['policy', 'quote', 'endorsement'],
        'Underwriting': ['underwriting', 'rules', 'eligibility'],
        'Claims': ['claim', 'loss', 'adjudication'],
        'Redis': ['redis', 'cache'],
        'Database': ['database', 'db', 'sql', 'postgres'],
        'API Gateway': ['api', 'gateway', 'endpoint'],
        'Auth Service': ['auth', 'login', 'sso', 'authentication']
    }
    
    text_lower = text.lower()
    matched_components = []
    
    for component, keywords in component_keywords.items():
        if any(kw in text_lower for kw in keywords):
            matched_components.append(component)
    
    return matched_components or ['Unknown']


def track_workaround_success(
    workaround_id: str,
    incident_number: str,
    outcome: str  # "success" | "partial" | "failed"
) -> Dict[str, Any]:
    """Track workaround application outcome for feedback loop.
    
    This function monitors work notes for workaround effectiveness and updates
    the success rate in a persistent knowledge base (TinyDB).
    
    Args:
        workaround_id: Unique workaround identifier (e.g., WA-0001)
        incident_number: Incident where workaround was applied
        outcome: Application outcome - "success", "partial", "failed"
    
    Returns:
        Updated workaround record with new success rate
    """
    logger.info(f"[track_workaround_success] workaround={workaround_id} incident={incident_number} outcome={outcome}")
    
    try:
        # Load workaround database (TinyDB for persistent tracking)
        wa_db = TinyDB('workaround_knowledge_base.json')
        wa_table = wa_db.table('workarounds')
        WA = Query()
        
        # Find workaround record
        wa_records = wa_table.search(WA.id == workaround_id)
        
        if not wa_records:
            logger.warning(f"[track_workaround_success] Workaround {workaround_id} not found")
            return {"error": "Workaround not found in knowledge base"}
        
        wa_record = wa_records[0]  # Get first match - type: Dict[str, Any]
        
        # Update success metrics
        outcome_weights = {"success": 1.0, "partial": 0.5, "failed": 0.0}
        weight = outcome_weights.get(outcome, 0.5)
        
        # Exponential moving average for success rate - wa_record is dict
        old_rate = float(wa_record.get('success_rate', 0.75))  # type: ignore[union-attr]
        new_count = int(wa_record.get('applied_count', 0)) + 1  # type: ignore[union-attr]
        alpha = 0.2  # Smoothing factor
        new_rate = (alpha * weight) + ((1 - alpha) * old_rate)
        
        # Update record
        wa_table.update({
            'success_rate': round(new_rate, 3),
            'applied_count': new_count,
            'last_applied_incident': incident_number,
            'last_updated': datetime.now().isoformat()
        }, WA.id == workaround_id)
        
        logger.info(f"[track_workaround_success] Updated {workaround_id}: success_rate={new_rate:.3f}, applied_count={new_count}")
        
        return {
            "workaround_id": workaround_id,
            "incident": incident_number,
            "outcome": outcome,
            "updated_success_rate": round(new_rate, 3),
            "total_applications": new_count
        }
        
    except Exception as e:
        logger.error(f"[track_workaround_success] Error: {e}", exc_info=True)
        return {"error": f"Failed to track workaround success: {str(e)}"}


# ============================================================================
# PHASE 3: ROOT CAUSE IDENTIFICATION AGENT
# ============================================================================

def identify_root_cause_core(
    incident_number: str,
    include_code_correlation: bool = True,
    historical_depth: int = 500,
    confidence_threshold: float = 0.6
) -> Dict[str, Any]:
    """Identify likely root causes using pattern analysis and correlation.
    
    This is Phase 3 implementation addressing the roadmap requirement:
    "Root Cause Identification Agent with symptom-to-cause mapping, multi-incident
    correlation, code-change correlation, and environmental context."
    
    Args:
        incident_number: ServiceNow incident number to analyze
        include_code_correlation: Link to recent code changes (requires GitHub integration)
        historical_depth: Number of historical incidents to analyze for patterns
        confidence_threshold: Minimum confidence score to include root cause (0.0-1.0)
    
    Returns:
        Dictionary with:
        - incident: Incident number analyzed
        - symptom: Extracted symptom description
        - likely_root_causes: Ranked list with confidence, evidence, investigation steps
        - cascading_failures: Related incidents (if detected)
        - code_correlation: Recent PRs/commits that may have introduced issue
        - recommended_action: Escalation or investigation recommendation
    """
    logger.info(f"[identify_root_cause] incident={incident_number} historical_depth={historical_depth}")
    
    try:
        # Phase 1: Fetch incident details
        incident = fetch_servicenow_incident_core(incident_number)
        if not incident or incident.get("error"):
            return {"error": "Failed to fetch incident details", "incident": incident_number}
        
        symptom = f"{incident.get('short_description', '')} {incident.get('description', '')}"
        category = incident.get('category', 'unknown')
        opened_at = incident.get('sys_created_on', '')
        
        logger.info(f"[identify_root_cause] Analyzing symptom: {symptom[:100]}...")
        
        # Phase 2: Symptom-to-Cause mapping from historical patterns
        symptom_cause_map = _build_symptom_cause_mapping(symptom, category, historical_depth)
        
        # Phase 3: Detect cascading failures (multi-incident correlation)
        cascading = _detect_cascading_failures(incident_number, opened_at)
        
        # Phase 4: Code-change correlation (if enabled)
        code_correlation = None
        if include_code_correlation:
            code_correlation = _correlate_with_code_changes(incident_number, symptom, opened_at)
        
        # Phase 5: Rank root causes by confidence
        likely_root_causes = []
        for cause_candidate in symptom_cause_map:
            if cause_candidate['confidence'] >= confidence_threshold:
                likely_root_causes.append(cause_candidate)
        
        # Sort by confidence
        likely_root_causes.sort(key=lambda x: x['confidence'], reverse=True)
        
        # Phase 6: Generate recommendations
        top_cause = likely_root_causes[0] if likely_root_causes else None
        
        escalation_needed = False
        escalation_reason = ""
        
        if top_cause and top_cause['confidence'] >= 0.8:
            escalation_reason = f"High confidence root cause identified: {top_cause['cause']}"
        elif not likely_root_causes:
            escalation_needed = True
            escalation_reason = "No historical pattern found. This may be a novel issue requiring engineering investigation."
        
        return {
            "incident": incident_number,
            "symptom": symptom[:200],
            "category": category,
            "analysis_timestamp": datetime.now().isoformat(),
            "likely_root_causes": likely_root_causes[:5],  # Top 5
            "cascading_failures": cascading,
            "code_correlation": code_correlation,
            "escalation_needed": escalation_needed,
            "escalation_reason": escalation_reason,
            "recommended_action": _generate_investigation_recommendation(likely_root_causes, cascading, code_correlation)
        }
        
    except Exception as e:
        logger.error(f"[identify_root_cause] Error: {e}", exc_info=True)
        return {"error": f"Root cause identification failed: {str(e)}"}


def _build_symptom_cause_mapping(
    symptom: str,
    category: str,
    historical_depth: int
) -> List[Dict[str, Any]]:
    """Build symptom-to-cause mapping from historical resolved incidents.
    
    Uses semantic similarity clustering to find incidents with similar symptoms
    and extracts their documented root causes.
    
    Returns:
        List of root cause candidates with confidence scores and evidence
    """
    logger.info(f"[symptom_cause_mapping] Analyzing {historical_depth} historical incidents")
    
    try:
        # Fetch resolved incidents with root cause documentation
        url = f"{servicenow_instance}/api/now/table/incident"
        params = {
            "sysparm_query": f"state=6^close_notesISNOTEMPTY^category={category}",  # Resolved with close notes
            "sysparm_limit": historical_depth,
            "sysparm_fields": "number,short_description,description,close_notes,u_root_cause,work_notes,sys_updated_on",
            "sysparm_order_by": "^sys_updated_on"  # Most recent first
        }
        
        response = requests.get(url, auth=_sn_auth(), params=params, timeout=60)
        response.raise_for_status()
        historical_incidents = response.json().get("result", [])
        
        logger.info(f"[symptom_cause_mapping] Fetched {len(historical_incidents)} historical incidents")
        
        # Generate embedding for current symptom
        symptom_embedding = generate_embeddings([symptom])[0]
        symptom_embedding_np = np.array(symptom_embedding, dtype="float32")
        
        # Calculate similarity with historical incidents
        similar_incidents = []
        for hist_inc in historical_incidents:
            hist_symptom = f"{hist_inc.get('short_description', '')} {hist_inc.get('description', '')}"
            hist_embedding = generate_embeddings([hist_symptom])[0]
            hist_embedding_np = np.array(hist_embedding, dtype="float32")
            
            similarity = float(np.dot(symptom_embedding_np, hist_embedding_np) / 
                              (np.linalg.norm(symptom_embedding_np) * np.linalg.norm(hist_embedding_np)))
            
            if similarity > 0.75:  # High similarity threshold
                similar_incidents.append({
                    "incident": hist_inc,
                    "similarity": similarity
                })
        
        similar_incidents.sort(key=lambda x: x['similarity'], reverse=True)
        logger.info(f"[symptom_cause_mapping] Found {len(similar_incidents)} similar historical incidents")
        
        # Extract root causes from similar incidents
        root_cause_freq = Counter()
        root_cause_evidence = {}
        
        for sim_inc in similar_incidents[:50]:  # Top 50 similar
            inc = sim_inc['incident']
            
            # Extract root cause from u_root_cause field or close notes
            root_cause = inc.get('u_root_cause', '').strip()
            if not root_cause:
                # Try to extract from close notes using LLM
                close_notes = inc.get('close_notes', '')
                if close_notes:
                    root_cause = _extract_root_cause_from_text(close_notes)
            
            if root_cause and len(root_cause) > 10:
                root_cause_freq[root_cause] += 1
                
                if root_cause not in root_cause_evidence:
                    root_cause_evidence[root_cause] = {
                        'incidents': [],
                        'first_seen': inc.get('sys_updated_on', ''),
                        'symptoms': set()
                    }
                
                root_cause_evidence[root_cause]['incidents'].append(inc['number'])
                root_cause_evidence[root_cause]['symptoms'].add(inc.get('short_description', '')[:100])
        
        # Build root cause candidates with confidence scores
        total_similar = len(similar_incidents) or 1
        root_cause_candidates = []
        
        for cause, freq in root_cause_freq.most_common(5):
            confidence = min(freq / total_similar, 1.0)  # Normalize to 0-1
            
            evidence = root_cause_evidence[cause]
            
            root_cause_candidates.append({
                "cause": cause,
                "confidence": round(confidence, 2),
                "evidence": [
                    f"{freq} similar incidents with this root cause",
                    f"Historical precedents: {', '.join(evidence['incidents'][:3])}",
                    f"First seen: {evidence['first_seen']}"
                ],
                "historical_precedent": evidence['incidents'][:5],
                "recommended_investigation": _generate_investigation_steps(cause)
            })
        
        return root_cause_candidates
        
    except Exception as e:
        logger.error(f"[symptom_cause_mapping] Error: {e}", exc_info=True)
        return []


def _extract_root_cause_from_text(text: str) -> str:
    """Extract root cause from close notes using regex patterns and LLM."""
    # Common root cause patterns
    patterns = [
        r'root cause:\s*([^\n]{20,200})',
        r'caused by:\s*([^\n]{20,200})',
        r'issue was:\s*([^\n]{20,200})',
        r'problem:\s*([^\n]{20,200})'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    
    # If no pattern match, use LLM to extract
    try:
        prompt = f"""Extract the root cause from this incident resolution note.
        Return ONLY the root cause as a concise statement (max 100 words), no explanation.
        
        Resolution note:
        {text[:500]}
        
        Root cause:"""
        
        messages = [
            {"role": "system", "content": "You extract root causes from incident notes."},
            {"role": "user", "content": prompt}
        ]
        
        chat_completion = openai.chat.completions.create(  # type: ignore[attr-defined]
            model=GPT_MODEL_NAME,
            messages=messages,  # type: ignore[arg-type]
            max_tokens=150
        )
        
        return chat_completion.choices[0].message.content.strip()
        
    except Exception as e:
        logger.error(f"[extract_root_cause] LLM extraction failed: {e}")
        return "Unknown"


def _detect_cascading_failures(
    incident_number: str,
    opened_at: str,
    time_window_minutes: int = 60
) -> Dict[str, Any]:
    """Detect if this incident is part of a cascading failure pattern.
    
    Looks for multiple incidents opened within a time window that may be related.
    """
    logger.info(f"[detect_cascading] incident={incident_number} time_window={time_window_minutes}min")
    
    try:
        # Parse opened_at timestamp
        opened_dt = datetime.fromisoformat(opened_at.replace('Z', '+00:00'))
        start_time = (opened_dt - timedelta(minutes=time_window_minutes)).isoformat()
        end_time = (opened_dt + timedelta(minutes=time_window_minutes)).isoformat()
        
        # Query incidents in time window
        url = f"{servicenow_instance}/api/now/table/incident"
        params = {
            "sysparm_query": f"sys_created_on>={start_time}^sys_created_on<={end_time}^numberNOT LIKE{incident_number}",
            "sysparm_limit": 50,
            "sysparm_fields": "number,short_description,category,sys_created_on"
        }
        
        response = requests.get(url, auth=_sn_auth(), params=params, timeout=30)
        response.raise_for_status()
        nearby_incidents = response.json().get("result", [])
        
        if len(nearby_incidents) >= 5:  # Threshold for cascading failure
            return {
                "detected": True,
                "related_incidents": [inc['number'] for inc in nearby_incidents[:10]],
                "incident_count": len(nearby_incidents),
                "time_window_minutes": time_window_minutes,
                "analysis": f"Detected {len(nearby_incidents)} incidents within {time_window_minutes} minutes. Possible cascading failure or systemic issue."
            }
        else:
            return {"detected": False, "incident_count": len(nearby_incidents)}
        
    except Exception as e:
        logger.error(f"[detect_cascading] Error: {e}", exc_info=True)
        return {"detected": False, "error": str(e)}


def _correlate_with_code_changes(
    incident_number: str,
    symptom: str,
    opened_at: str,
    days_back: int = 7
) -> Dict[str, Any]:
    """Correlate incident with recent code changes (PRs/commits).
    
    Integrates with developer_incident_tools to find recent code changes
    that may have introduced the issue.
    """
    logger.info(f"[code_correlation] incident={incident_number} days_back={days_back}")
    
    try:
        # Import developer tools for PR correlation
        from .developer_incident_tools import fetch_related_pull_requests
        
        # Fetch PRs that mention this incident OR were merged recently
        pr_data = fetch_related_pull_requests(incident_number, limit=10)
        
        if pr_data.get('stub'):
            logger.info("[code_correlation] Using stub data (GitHub not configured)")
            return {
                "available": False,
                "reason": "GitHub integration not configured",
                "recommendation": "Configure GITHUB_REPO and GITHUB_TOKEN for code correlation"
            }
        
        related_prs = pr_data.get('prs', [])
        
        # Analyze PRs for potential correlation
        suspicious_prs = []
        for pr in related_prs:
            if pr.get('merged'):
                suspicious_prs.append({
                    "pr_number": pr['number'],
                    "title": pr['title'],
                    "confidence": "medium",
                    "reasoning": "PR merged before incident and mentions incident number"
                })
        
        return {
            "available": True,
            "related_prs": related_prs,
            "suspicious_changes": suspicious_prs,
            "recommendation": "Review recent merged PRs for potential regression" if suspicious_prs else "No suspicious code changes identified"
        }
        
    except Exception as e:
        logger.error(f"[code_correlation] Error: {e}", exc_info=True)
        return {"available": False, "error": str(e)}


def _generate_investigation_steps(root_cause: str) -> List[str]:
    """Generate investigation checklist based on root cause type."""
    # Heuristic-based investigation templates
    if 'cache' in root_cause.lower():
        return [
            "Check Redis cache hit/miss ratios",
            "Review cache eviction policies and TTL settings",
            "Verify cache key naming conventions",
            "Test cache warming process"
        ]
    elif 'database' in root_cause.lower() or 'connection' in root_cause.lower():
        return [
            "Check database connection pool sizes",
            "Review slow query logs",
            "Verify connection timeout settings",
            "Test database failover mechanisms"
        ]
    elif 'api' in root_cause.lower() or 'timeout' in root_cause.lower():
        return [
            "Check API gateway logs for status codes",
            "Review timeout and retry configurations",
            "Verify circuit breaker status",
            "Test API endpoints with monitoring tools"
        ]
    elif 'deployment' in root_cause.lower() or 'release' in root_cause.lower():
        return [
            "Review recent deployment logs",
            "Compare production vs staging configurations",
            "Check for environment-specific issues",
            "Consider rollback if issue started after deployment"
        ]
    else:
        return [
            "Review application logs around incident time",
            "Check system resource utilization (CPU, memory, disk)",
            "Verify all dependent services are healthy",
            "Reproduce issue in test environment"
        ]


def _generate_investigation_recommendation(
    likely_root_causes: List[Dict[str, Any]],
    cascading: Dict[str, Any],
    code_correlation: Optional[Dict[str, Any]]
) -> str:
    """Generate overall investigation recommendation."""
    if not likely_root_causes:
        return "No historical pattern identified. This appears to be a novel issue. Recommend full diagnostic investigation involving engineering team."
    
    top_cause = likely_root_causes[0]
    recommendation = f"Primary investigation focus: {top_cause['cause']} (confidence: {top_cause['confidence']:.0%}). "
    
    if cascading.get('detected'):
        recommendation += f"ALERT: Cascading failure detected with {cascading['incident_count']} related incidents. Prioritize systemic root cause investigation. "
    
    if code_correlation and code_correlation.get('suspicious_changes'):
        recommendation += f"Code correlation found: {len(code_correlation['suspicious_changes'])} suspicious PRs. Review recent code changes. "
    
    if top_cause['confidence'] >= 0.8:
        recommendation += "High confidence - proceed with targeted investigation using recommended steps."
    else:
        recommendation += "Moderate confidence - validate hypothesis before implementing fix."
    
    return recommendation
