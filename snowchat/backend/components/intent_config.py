import json, os, re, time, logging
from typing import Dict, Any, List, Tuple, Optional
from math import inf
try:
    # RapidFuzz provides efficient fuzzy ratio; fall back gracefully if unavailable
    from rapidfuzz import fuzz  # type: ignore
    def _fuzzy_ratio(a: str, b: str) -> int:
        try:
            return int(fuzz.partial_ratio(a, b))
        except Exception:
            return 0
except Exception:  # pragma: no cover - optional dependency
    def _fuzzy_ratio(a: str, b: str) -> int:  # type: ignore
        # Simple fallback: length-normalized common substring heuristic
        a_l = a.lower(); b_l = b.lower()
        best = 0
        # Early exit for empty
        if not a_l or not b_l:
            return 0
        # Sliding window over shorter string up to 32 chars (heuristic)
        shorter, longer = (a_l, b_l) if len(a_l) <= len(b_l) else (b_l, a_l)
        max_len = min(32, len(shorter))
        for w in range(max_len, 2, -1):
            for i in range(0, len(shorter)-w+1):
                seg = shorter[i:i+w]
                if seg in longer:
                    best = w
                    break
            if best:
                break
        # Scale to 0-100
        return int((best / max(len(a_l), len(b_l))) * 100)

logger = logging.getLogger("agentic_orchestrator_auto.intent_config")

_CONFIG_CACHE = {"data": None, "mtime": 0.0, "last_load": 0.0, "path": None}
CONFIG_REL_PATH = os.path.join('config', 'intent_heuristics.json')


def load_intent_config(force: bool = False) -> Dict[str, Any]:
    """Load (and hot-reload) heuristic intent configuration.

    Structure per-intent:
      {
        "literal_phrases": ["phrase", ...],
        "regex": ["pattern", ...],
        "auto_persona": "developer" | null,
        "stop_on_match": true/false,
        "context_injection": {
            "summary_key": str,
            "max_age_minutes": int,
            "retain_tool_outputs": [toolName, ...]
        }
      }
    """
    global _CONFIG_CACHE
    path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', CONFIG_REL_PATH))
    _CONFIG_CACHE['path'] = path
    try:
        st = os.stat(path)
    except FileNotFoundError:
        if _CONFIG_CACHE["data"] is None:
            logger.warning(f"[intent_config] Intent config missing at {path}")
            _CONFIG_CACHE["data"] = {}
        return _CONFIG_CACHE["data"]
    if force or st.st_mtime != _CONFIG_CACHE["mtime"]:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            # Compile regex
            for intent, block in raw.items():
                block['compiled_regex'] = [re.compile(p, re.IGNORECASE) for p in block.get('regex', [])]
                # Normalize phrase list to lower
                block['literal_phrases'] = [p.lower() for p in block.get('literal_phrases', [])]
            _CONFIG_CACHE['data'] = raw
            _CONFIG_CACHE['mtime'] = st.st_mtime
            _CONFIG_CACHE['last_load'] = time.time()
            logger.info(f"[intent_config] Loaded intents: {list(raw.keys())}")
        except Exception as e:
            logger.error(f"[intent_config] Failed loading intent config: {e}")
    return _CONFIG_CACHE['data'] or {}


def classify_with_config(question: str, metadata: Dict[str, Any], *, enable_fuzzy: bool = True, fuzzy_threshold: int = 86) -> Dict[str, Any]:
    """Return classification dict.

    Fuzzy logic: If no literal or regex match hits, optionally compute best fuzzy score across all literal phrases.
    Provide diagnostics under key '_debug' (not persisted unless caller keeps it) for observability.
    """
    q_original = question or ''
    ql = q_original.lower()
    cfg = load_intent_config()
    best_fuzzy: Tuple[int, Optional[str], Optional[str]] = ( -1, None, None )  # score, intent, phrase
    for intent, block in cfg.items():
        # literal match
        for phrase in block.get('literal_phrases', []):
            if phrase in ql:
                logger.info(f"[intent_config] Literal match intent={intent}")
                return {
                    'intent': intent,
                    'auto_persona': block.get('auto_persona'),
                    'context_injection': block.get('context_injection'),
                    '_debug': { 'match_type': 'literal', 'phrase': phrase }
                }
        # regex match
        for cre in block.get('compiled_regex', []):
            try:
                if cre.search(ql):
                    logger.info(f"[intent_config] Regex match intent={intent}")
                    return {
                        'intent': intent,
                        'auto_persona': block.get('auto_persona'),
                        'context_injection': block.get('context_injection'),
                        '_debug': { 'match_type': 'regex', 'pattern': cre.pattern }
                    }
            except Exception:
                continue
        # Fuzzy candidate collection
        if enable_fuzzy:
            for phrase in block.get('literal_phrases', []):
                sc = _fuzzy_ratio(ql, phrase)
                if sc > best_fuzzy[0]:
                    best_fuzzy = (sc, intent, phrase)
    # Fuzzy fallback
    if enable_fuzzy and best_fuzzy[0] >= fuzzy_threshold and best_fuzzy[1]:
        logger.info(f"[intent_config] Fuzzy match intent={best_fuzzy[1]} phrase='{best_fuzzy[2]}' score={best_fuzzy[0]}")
        block = cfg.get(best_fuzzy[1], {})
        return {
            'intent': best_fuzzy[1],
            'auto_persona': block.get('auto_persona'),
            'context_injection': block.get('context_injection'),
            '_debug': { 'match_type': 'fuzzy', 'phrase': best_fuzzy[2], 'score': best_fuzzy[0], 'threshold': fuzzy_threshold }
        }
    return {'intent': None, 'auto_persona': None, 'context_injection': None, '_debug': { 'match_type': None }}


def intent_diagnostics() -> Dict[str, Any]:
    """Return diagnostics about current intent configuration for /intents endpoint."""
    data = load_intent_config()
    diag = {
        'intents': {},
        'path': _CONFIG_CACHE.get('path'),
        'mtime': _CONFIG_CACHE.get('mtime'),
        'last_load': _CONFIG_CACHE.get('last_load'),
        'count': len(data or {})
    }
    for k, block in (data or {}).items():
        diag['intents'][k] = {
            'literal_count': len(block.get('literal_phrases', [])),
            'regex_count': len(block.get('regex', [])),
            'auto_persona': block.get('auto_persona'),
            'has_context_injection': bool(block.get('context_injection'))
        }
    return diag

__all__ = [
    'load_intent_config',
    'classify_with_config',
    'intent_diagnostics'
]
