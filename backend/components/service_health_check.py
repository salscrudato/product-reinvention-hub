"""
Service Health Check Module - Monitors external service availability.

Provides health checks for:
- ServiceNow API
- Confluence Wiki API
- JIRA API
- Internal Wiki RAG (FAISS indices)

Author: DevPilot Enhancement
Date: February 4, 2026
"""

import logging
import os
import time
from typing import Dict, Any
import requests
from requests.auth import HTTPBasicAuth

logger = logging.getLogger("agentic_orchestrator_auto").getChild("health_check")

# Timeout for health checks
HEALTH_CHECK_TIMEOUT = 5


def check_servicenow_health() -> Dict[str, Any]:
    """
    Check ServiceNow instance connectivity and authentication.
    
    Returns:
        {
            "status": "healthy" | "degraded" | "down",
            "response_time_ms": float,
            "error": str | None,
            "instance": str,
            "last_checked": timestamp
        }
    """
    start_time = time.time()
    
    instance = os.getenv("SERVICENOW_INSTANCE")
    user = os.getenv("SERVICENOW_USER")
    password = os.getenv("SERVICENOW_PASSWORD")
    
    result = {
        "status": "unknown",
        "response_time_ms": 0,
        "error": None,
        "instance": instance or "not_configured",
        "last_checked": time.time(),
        "authenticated": False
    }
    
    if not instance or not user or not password:
        result["status"] = "down"
        result["error"] = "ServiceNow credentials not configured"
        logger.warning("[HealthCheck] ServiceNow not configured")
        return result
    
    try:
        # Try to fetch a single incident as a lightweight health check
        url = f"{instance}/api/now/table/incident"
        params = {
            "sysparm_limit": 1,
            "sysparm_fields": "number"
        }
        
        response = requests.get(
            url,
            auth=HTTPBasicAuth(user, password),
            params=params,
            timeout=HEALTH_CHECK_TIMEOUT
        )
        
        elapsed_ms = (time.time() - start_time) * 1000
        result["response_time_ms"] = round(elapsed_ms, 2)
        
        if response.status_code == 200:
            try:
                data = response.json()
                if "result" in data:
                    result["status"] = "healthy"
                    result["authenticated"] = True
                    logger.info(f"[HealthCheck] ServiceNow healthy | {elapsed_ms:.0f}ms")
                else:
                    result["status"] = "degraded"
                    result["error"] = "Unexpected response format"
            except Exception as json_err:
                result["status"] = "degraded"
                result["error"] = f"JSON parse error: {str(json_err)}"
                logger.error(f"[HealthCheck] ServiceNow JSON error: {json_err}")
        elif response.status_code == 401:
            result["status"] = "down"
            result["error"] = "Authentication failed (401)"
            logger.error("[HealthCheck] ServiceNow auth failed")
        elif response.status_code == 403:
            result["status"] = "down"
            result["error"] = "Access forbidden (403)"
        else:
            result["status"] = "degraded"
            result["error"] = f"HTTP {response.status_code}"
            logger.warning(f"[HealthCheck] ServiceNow returned {response.status_code}")
            
    except requests.exceptions.Timeout:
        result["status"] = "down"
        result["error"] = f"Request timeout (>{HEALTH_CHECK_TIMEOUT}s)"
        logger.error("[HealthCheck] ServiceNow timeout")
    except requests.exceptions.ConnectionError as e:
        result["status"] = "down"
        result["error"] = f"Connection error: {str(e)[:100]}"
        logger.error(f"[HealthCheck] ServiceNow connection error: {e}")
    except Exception as e:
        result["status"] = "down"
        result["error"] = f"Unexpected error: {str(e)[:100]}"
        logger.error(f"[HealthCheck] ServiceNow unexpected error: {e}")
    
    return result


def check_wiki_health() -> Dict[str, Any]:
    """
    Check Wiki RAG system (FAISS indices) health.
    
    Returns:
        {
            "status": "healthy" | "degraded" | "down",
            "index_loaded": bool,
            "docs_count": int,
            "error": str | None,
            "last_checked": timestamp
        }
    """
    result = {
        "status": "unknown",
        "index_loaded": False,
        "docs_count": 0,
        "error": None,
        "last_checked": time.time()
    }
    
    try:
        # Check if FAISS index files exist
        import os.path
        index_path = os.path.join(os.path.dirname(__file__), "..", "Embeddings_Lookup_cache.index")
        docs_path = os.path.join(os.path.dirname(__file__), "..", "..", "faiss_docs.pkl")
        
        if not os.path.exists(index_path):
            result["status"] = "down"
            result["error"] = "FAISS index file not found"
            logger.warning("[HealthCheck] Wiki FAISS index missing")
            return result
        
        # Try to load the index
        import faiss
        import pickle
        
        try:
            index = faiss.read_index(index_path)
            result["index_loaded"] = True
            
            if os.path.exists(docs_path):
                with open(docs_path, 'rb') as f:
                    docs = pickle.load(f)
                    result["docs_count"] = len(docs)
            
            # Check if index has vectors
            if index.ntotal > 0:
                result["status"] = "healthy"
                logger.info(f"[HealthCheck] Wiki healthy | {index.ntotal} vectors, {result['docs_count']} docs")
            else:
                result["status"] = "degraded"
                result["error"] = "Index is empty"
                
        except Exception as load_err:
            result["status"] = "down"
            result["error"] = f"Failed to load index: {str(load_err)[:100]}"
            logger.error(f"[HealthCheck] Wiki load error: {load_err}")
            
    except ImportError as imp_err:
        result["status"] = "down"
        result["error"] = f"Missing dependencies: {str(imp_err)}"
        logger.error(f"[HealthCheck] Wiki import error: {imp_err}")
    except Exception as e:
        result["status"] = "down"
        result["error"] = f"Unexpected error: {str(e)[:100]}"
        logger.error(f"[HealthCheck] Wiki unexpected error: {e}")
    
    return result


def check_jira_health() -> Dict[str, Any]:
    """
    Check JIRA API connectivity and authentication.
    
    Returns:
        {
            "status": "healthy" | "degraded" | "down",
            "response_time_ms": float,
            "error": str | None,
            "server": str,
            "last_checked": timestamp
        }
    """
    start_time = time.time()
    
    jira_url = os.getenv("JIRA_URL")
    jira_email = os.getenv("JIRA_EMAIL")
    jira_token = os.getenv("JIRA_API_TOKEN")
    
    result = {
        "status": "unknown",
        "response_time_ms": 0,
        "error": None,
        "server": jira_url or "not_configured",
        "last_checked": time.time(),
        "authenticated": False
    }
    
    if not jira_url or not jira_email or not jira_token:
        result["status"] = "down"
        result["error"] = "JIRA credentials not configured"
        logger.warning("[HealthCheck] JIRA not configured")
        return result
    
    try:
        # Use /myself endpoint as lightweight health check
        url = f"{jira_url}/rest/api/2/myself"
        
        response = requests.get(
            url,
            auth=HTTPBasicAuth(jira_email, jira_token),
            timeout=HEALTH_CHECK_TIMEOUT
        )
        
        elapsed_ms = (time.time() - start_time) * 1000
        result["response_time_ms"] = round(elapsed_ms, 2)
        
        if response.status_code == 200:
            try:
                data = response.json()
                if "emailAddress" in data or "displayName" in data:
                    result["status"] = "healthy"
                    result["authenticated"] = True
                    logger.info(f"[HealthCheck] JIRA healthy | {elapsed_ms:.0f}ms")
                else:
                    result["status"] = "degraded"
                    result["error"] = "Unexpected response format"
            except Exception:
                result["status"] = "degraded"
                result["error"] = "Failed to parse response"
        elif response.status_code == 401:
            result["status"] = "down"
            result["error"] = "Authentication failed (401)"
            logger.error("[HealthCheck] JIRA auth failed")
        elif response.status_code == 403:
            result["status"] = "down"
            result["error"] = "Access forbidden (403)"
        else:
            result["status"] = "degraded"
            result["error"] = f"HTTP {response.status_code}"
            logger.warning(f"[HealthCheck] JIRA returned {response.status_code}")
            
    except requests.exceptions.Timeout:
        result["status"] = "down"
        result["error"] = f"Request timeout (>{HEALTH_CHECK_TIMEOUT}s)"
        logger.error("[HealthCheck] JIRA timeout")
    except requests.exceptions.ConnectionError as e:
        result["status"] = "down"
        result["error"] = f"Connection error: {str(e)[:100]}"
        logger.error(f"[HealthCheck] JIRA connection error: {e}")
    except Exception as e:
        result["status"] = "down"
        result["error"] = f"Unexpected error: {str(e)[:100]}"
        logger.error(f"[HealthCheck] JIRA unexpected error: {e}")
    
    return result


def get_all_services_health() -> Dict[str, Any]:
    """
    Check health of all external services.
    
    Returns:
        {
            "overall_status": "healthy" | "degraded" | "down",
            "services": {
                "servicenow": {...},
                "wiki": {...},
                "jira": {...}
            },
            "timestamp": float
        }
    """
    servicenow_health = check_servicenow_health()
    wiki_health = check_wiki_health()
    jira_health = check_jira_health()
    
    # Determine overall status
    statuses = [
        servicenow_health["status"],
        wiki_health["status"],
        jira_health["status"]
    ]
    
    if all(s == "healthy" for s in statuses):
        overall = "healthy"
    elif any(s == "down" for s in statuses):
        overall = "degraded"  # At least one service down
    else:
        overall = "degraded"  # Some services degraded
    
    return {
        "overall_status": overall,
        "services": {
            "servicenow": servicenow_health,
            "wiki": wiki_health,
            "jira": jira_health
        },
        "timestamp": time.time()
    }
