"""PHASE3: Prompt catalog loader & validator.
Rollback Phase3: delete this file and remove PHASE3 references in orchestrator & app.
Enhancements: persona normalization, entry sanitization, confidence threshold defaulting.
"""
from __future__ import annotations
import json, os, time, logging
from typing import List, Dict, Any, Optional

CATALOG_PATH = os.getenv("PROMPT_CATALOG_PATH", os.path.join(os.path.dirname(__file__), "prompt_catalog.json"))
_RELOAD_INTERVAL_SEC = 2.0

_catalog_cache: List[Dict[str, Any]] = []
_catalog_mtime: float = 0.0
_last_check: float = 0.0

# PHASE3 logging: reuse orchestrator logger to funnel events to agentic_orchestrator_auto.log
_logger = logging.getLogger("agentic_orchestrator_auto")

REQUIRED_FIELDS = [
    "id", "intent", "personas", "status", "prompt", "activation_keywords",
    "tool_hints", "param_extractors", "expected_receipt", "enabled", "version"
    # summary is optional and generated on the fly if absent
]
ALLOWED_STATUSES = {"draft", "pending_review", "active", "disabled", "deprecated"}
ALLOWED_PERSONAS = {"developer", "business_owner", "engineering_lead", "product_owner", "*"}

class CatalogValidationError(Exception):
    pass

def normalize_persona(p: Optional[str]) -> Optional[str]:
    if not p:
        return None
    pl = p.lower().strip()
    if pl == 'product_owner':
        return 'business_owner'
    return pl if pl in ALLOWED_PERSONAS else None

def _sanitize_text(val: Any, max_len: int) -> str:
    s = str(val or '').strip()
    if len(s) > max_len:
        s = s[:max_len]
    # remove control chars
    s = ''.join(ch for ch in s if ord(ch) >= 32)
    return s

def _validate_entry(e: Dict[str, Any]) -> Dict[str, Any]:
    for f in REQUIRED_FIELDS:
        if f not in e:
            raise CatalogValidationError(f"missing field: {f}")
    if not isinstance(e["id"], str) or not e["id"].strip():
        raise CatalogValidationError("id must be non-empty string")
    if e.get("status") not in ALLOWED_STATUSES:
        raise CatalogValidationError(f"invalid status: {e.get('status')}")
    personas = e.get("personas")
    if not isinstance(personas, list) or not personas:
        raise CatalogValidationError("personas must be non-empty list")
    norm_personas: List[str] = []
    for p in personas:
        np = normalize_persona(p)
        if not np:
            raise CatalogValidationError(f"invalid persona: {p}")
        norm_personas.append(np)
    e['personas'] = norm_personas
    if not isinstance(e.get("activation_keywords"), list):
        raise CatalogValidationError("activation_keywords must be list")
    if not isinstance(e.get("tool_hints"), list):
        raise CatalogValidationError("tool_hints must be list")
    if not isinstance(e.get("param_extractors"), list):
        raise CatalogValidationError("param_extractors must be list")
    if not isinstance(e.get("enabled"), bool):
        raise CatalogValidationError("enabled must be boolean")
    if not isinstance(e.get("version"), int):
        raise CatalogValidationError("version must be int")
    meta = e.get("metadata") or {}
    if "confidence_threshold" not in meta:
        meta["confidence_threshold"] = float(os.getenv("PROMPT_CONFIDENCE_DEFAULT", "0.4"))
        e["metadata"] = meta
    # Sanitize text fields
    e['prompt'] = _sanitize_text(e.get('prompt'), 600)
    if 'description' in e:
        e['description'] = _sanitize_text(e.get('description'), 400)
    e['expected_receipt'] = _sanitize_text(e.get('expected_receipt'), 800)
    return e

def _load_raw() -> List[Dict[str, Any]]:
    if not os.path.exists(CATALOG_PATH):
        return []
    with open(CATALOG_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise CatalogValidationError("catalog root must be a list")
    validated: List[Dict[str, Any]] = []
    for entry in data:
        try:
            validated.append(_validate_entry(entry))
        except CatalogValidationError as ce:
            _logger.info("FLOW[PROMPT_CATALOG] validation_skip | %s", json.dumps({"id": entry.get('id'), "error": str(ce)}, default=str))
    return validated

def _refresh_if_needed() -> None:
    global _catalog_cache, _catalog_mtime, _last_check
    now = time.time()
    if now - _last_check < _RELOAD_INTERVAL_SEC:
        return
    _last_check = now
    try:
        mtime = os.path.getmtime(CATALOG_PATH)
    except OSError:
        return
    if mtime <= _catalog_mtime:
        return
    try:
        new_entries = _load_raw()
        _catalog_cache = new_entries
        _catalog_mtime = mtime
        _logger.info("FLOW[PROMPT_CATALOG] reload | %s", json.dumps({"entries": len(new_entries), "path": CATALOG_PATH}, default=str))
    except Exception as e:
        _logger.error("FLOW[PROMPT_CATALOG] reload_failed | %s", json.dumps({"error": str(e)}, default=str))

def get_all() -> List[Dict[str, Any]]:
    _refresh_if_needed()
    return list(_catalog_cache)

def get_active(persona: Optional[str]) -> List[Dict[str, Any]]:
    _refresh_if_needed()
    persona_norm = normalize_persona(persona)
    out: List[Dict[str, Any]] = []
    for e in _catalog_cache:
        if not e.get('enabled') or e.get('status') != 'active':
            continue
        personas = e.get('personas') or []
        if persona_norm is None or persona_norm in personas or '*' in personas:
            out.append(e)
    return out

def catalog_health() -> Dict[str, Any]:
    # Tool availability validation (Phase4): ensure each tool_hints entry is registered
    missing_tools: Dict[str, List[str]] = {}
    try:
        from .shared_registry import FUNCTION_REGISTRY  # type: ignore
    except Exception:
        FUNCTION_REGISTRY = {}  # type: ignore
    for entry in _catalog_cache:
        missing = []
        for tool in entry.get('tool_hints', []):
            if tool not in FUNCTION_REGISTRY:
                missing.append(tool)
        if missing:
            missing_tools[entry.get('id','unknown')] = missing
    health = {
        'loaded': bool(_catalog_cache),
        'prompt_count': len(_catalog_cache),
        'active_count': len(get_active(None)),
        'last_reload_ts': _catalog_mtime,
        'path': CATALOG_PATH,
        'missing_tools': missing_tools,
    }
    _logger.info("FLOW[PROMPT_CATALOG] health_snapshot | %s", json.dumps(health, default=str))
    return health

__all__ = ['get_all','get_active','catalog_health','normalize_persona']
