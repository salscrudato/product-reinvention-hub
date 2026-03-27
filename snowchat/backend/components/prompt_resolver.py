"""PHASE3: Prompt resolver with persona normalization & event logging.
Rollback Phase3: delete this file & remove orchestrator call.
"""
import os, logging, json
from typing import Dict, Any, Optional
from .prompt_catalog import get_active, normalize_persona
from .arg_extractors import EXTRACTOR_REGISTRY
from .prompt_events import record_event

STOP_WORDS = {"the","a","an","and","or","of"}
_logger = logging.getLogger("agentic_orchestrator_auto")

def _score(question: str, entry: Dict[str, Any]) -> float:
    q_lower = (question or '').lower()
    keywords = entry.get('activation_keywords', [])
    hits = 0
    for kw in keywords:
        if not kw or kw.lower() in STOP_WORDS:
            continue
        if kw.lower() in q_lower:
            hits += 1
    extractor_hits = 0
    for ex_key in entry.get('param_extractors', []):
        fn = EXTRACTOR_REGISTRY.get(ex_key)
        if not fn:
            continue
        try:
            val = fn(question)
            if val:
                extractor_hits += 1
        except Exception:
            pass
    return hits + extractor_hits

def resolve_prompt(question: str, persona: Optional[str], metadata: Dict[str, Any]) -> Dict[str, Any]:
    if os.getenv('PROMPT_CATALOG_ENABLED','1').lower() not in ('1','true','yes','on'):
        _logger.info("FLOW[PROMPT_RESOLVER] disabled | %s", json.dumps({"question": question[:160]}, default=str))
        return {'matched': False, 'reason': 'feature_disabled'}
    persona_norm = normalize_persona(persona)
    entries = get_active(persona_norm)
    if not entries:
        record_event('prompt.fallback', reason='no_active_entries', persona=persona_norm, question=question)
        _logger.info("FLOW[PROMPT_RESOLVER] no_active_entries | %s", json.dumps({"persona": persona_norm, "q_head": question[:120]}, default=str))
        return {'matched': False, 'reason': 'no_active_entries'}
    best = None
    best_score = -1.0
    for e in entries:
        sc = _score(question, e)
        if sc > best_score:
            best = e
            best_score = sc
    if not best:
        record_event('prompt.fallback', reason='no_score', persona=persona_norm, question=question)
        _logger.info("FLOW[PROMPT_RESOLVER] no_score | %s", json.dumps({"persona": persona_norm, "q_head": question[:120]}, default=str))
        return {'matched': False, 'reason': 'no_score'}
    threshold = best.get('metadata', {}).get('confidence_threshold', 0.4)
    if best_score < threshold:
        record_event('prompt.fallback', reason='below_threshold', persona=persona_norm, question=question, score=best_score, threshold=threshold, candidate=best.get('id'))
        _logger.info("FLOW[PROMPT_RESOLVER] below_threshold | %s", json.dumps({"persona": persona_norm, "score": best_score, "threshold": threshold, "candidate": best.get('id')}, default=str))
        return {'matched': False, 'reason': 'below_threshold', 'score': best_score, 'threshold': threshold}
    record_event('prompt.match', prompt_id=best.get('id'), persona=persona_norm, score=best_score)
    _logger.info("FLOW[PROMPT_RESOLVER] match | %s", json.dumps({"prompt_id": best.get('id'), "persona": persona_norm, "score": best_score}, default=str))
    return {
        'matched': True,
        'prompt_id': best.get('id'),
        'confidence': best_score,
        'intent_override': best.get('intent'),
        'tool_hints': best.get('tool_hints', []),
        'param_extractors': best.get('param_extractors', []),
        'activation_keywords': best.get('activation_keywords', []),
        'prompt_text': best.get('prompt'),  # PHASE3: expose full prompt text for orchestration augmentation
    }

__all__ = ['resolve_prompt']
