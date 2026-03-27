"""token_instrumentation

Enhanced token usage tracking for each interaction.

Features Added:
 - Attempts real token counting via tiktoken for OpenAI models (falls back to heuristic).
 - Distinguishes prompt vs completion vs system/history tokens.
 - Records rolling summary compression savings when available in metadata.
 - Two-phase recording: record() for pre-answer planning (baseline + prompt), finalize() updates entry with completion & savings after answer synthesis.
 - Approximate cost calculation with separate prompt/completion rates (env configurable).

Environment Variables:
 TOKEN_PROMPT_RATE_PER_1K  (default 0.0003)
 TOKEN_COMPLETION_RATE_PER_1K (default 0.0006)
 ENABLE_TOKEN_METRICS (must be truthy to persist)
 GPT_MODEL_NAME (used for tokenizer selection if tiktoken installed)
"""
from __future__ import annotations
from typing import Dict, Any, List, Optional
import time, os, json, threading
from tinydb import TinyDB, Query

_tiktoken_loader_lock = threading.Lock()
_tiktoken_cache = {}

PROMPT_RATE = float(os.getenv('TOKEN_PROMPT_RATE_PER_1K', '0.0003'))
COMPLETION_RATE = float(os.getenv('TOKEN_COMPLETION_RATE_PER_1K', '0.0006'))

def _approx_tokens(text: str) -> int:
    if not text:
        return 0
    # Rough 4 chars/token heuristic
    return max(1, int(len(text) / 4))

def _try_count_tokens(text: str, model: str) -> int:
    """Attempt real token counting using tiktoken; fallback to heuristic if unavailable or error."""
    if not text:
        return 0
    try:
        with _tiktoken_loader_lock:
            if 'tiktoken' not in _tiktoken_cache:
                try:
                    import tiktoken  # type: ignore
                    _tiktoken_cache['tiktoken'] = tiktoken
                except Exception:
                    _tiktoken_cache['tiktoken'] = None
            tk = _tiktoken_cache.get('tiktoken')
        if not tk:
            return _approx_tokens(text)
        enc = tk.encoding_for_model(model) if hasattr(tk, 'encoding_for_model') else tk.get_encoding('cl100k_base')
        return len(enc.encode(text))
    except Exception:
        return _approx_tokens(text)

class TokenInstrumentation:
    def __init__(self):
        self.db = TinyDB('state_db.json')
        self.table = self.db.table('token_usage')

    def _enabled(self) -> bool:
        return os.getenv('ENABLE_TOKEN_METRICS', '').lower() in ('1','true','yes','on')

    def record(self, username: str, question: str, prompt: str, plan: List[Dict[str,Any]], micro_intent: Optional[str], cache_hit: bool, metadata: Dict[str, Any]) -> Optional[str]:
        """Initial record before answer synthesis. Returns entry id for later finalize()."""
        if not self._enabled():
            return None
        model = os.getenv('GPT_MODEL_NAME', 'gpt-4o-mini')
        prompt_tokens = _try_count_tokens(prompt, model)
        # History/context tokens estimation (system + compressed history) if present
        context_tokens = 0
        compressed_history = metadata.get('rolling_summary') or ''
        if compressed_history:
            context_tokens += _try_count_tokens(compressed_history, model)
        # Baseline estimation: prompt + (steps * 120) + persona overhead 60 + hypothetical unconstrained history (add 300 if summary exists)
        baseline = prompt_tokens + len(plan)*120 + 60
        if micro_intent:
            baseline += 150
        if compressed_history:
            # assume uncompressed would have been ~3.2x larger (heuristic); attribute potential savings later
            baseline += 300
        entry = {
            'timestamp': time.time(),
            'username': username,
            'persona': metadata.get('persona'),
            'question': question[:500],
            'micro_intent': micro_intent,
            'prompt_tokens': prompt_tokens,
            'context_tokens': context_tokens,
            'completion_tokens': 0,
            'total_tokens': prompt_tokens + context_tokens,
            'baseline_estimate': baseline,
            'savings_tokens': 0,
            'savings_percent': 0.0,
            'cache_hit': cache_hit,
            'cost_usd': 0.0,
            'plan_steps': [ (s.get('function_name') or s.get('tool')) for s in plan ],
            'entry_phase': 'pre',
            'summary_token_savings_estimate': metadata.get('summary_token_savings_estimate'),
        }
        doc_id = self.table.insert(entry)
        # Store explicit entry_id field for robust lookup independent of TinyDB internal doc_id mechanics on reload
        try:
            self.table.update({'entry_id': str(doc_id)}, doc_ids=[doc_id])
        except Exception:
            pass
        return str(doc_id)

    def finalize(self, entry_id: Optional[str], final_answer: str, metadata: Dict[str, Any]) -> None:
        """Update the previously created entry with completion tokens and computed savings."""
        if not self._enabled() or not entry_id:
            return
        model = os.getenv('GPT_MODEL_NAME', 'gpt-4o-mini')
        completion_tokens = _try_count_tokens(final_answer, model)
        q = Query()
        # Prefer custom entry_id field lookup; fallback to doc_id
        entry = None
        try:
            found = self.table.search(Query().entry_id == str(entry_id))
            if found:
                entry = found[0]
        except Exception:
            entry = None
        if entry is None:
            try:
                rows = self.table.search(q.doc_id == int(entry_id))
                if rows:
                    entry = rows[0]
            except Exception:
                entry = None
        if entry is None:
            return
        prompt_tokens = entry.get('prompt_tokens', 0)
        context_tokens = entry.get('context_tokens', 0)
        total_tokens = prompt_tokens + context_tokens + completion_tokens
        baseline = entry.get('baseline_estimate', total_tokens)
        savings = max(0, baseline - total_tokens)
        # Incorporate rolling summary estimated savings if present and larger
        summary_savings_est = metadata.get('summary_token_savings_estimate')
        if isinstance(summary_savings_est, (int, float)) and summary_savings_est > savings:
            savings = summary_savings_est
        cost_usd = (prompt_tokens/1000.0)*PROMPT_RATE + (completion_tokens/1000.0)*COMPLETION_RATE
        updated = {
            'completion_tokens': completion_tokens,
            'total_tokens': total_tokens,
            'savings_tokens': savings,
            'savings_percent': round((savings / baseline)*100,2) if baseline else 0.0,
            'cost_usd': round(cost_usd, 6),
            'entry_phase': 'final',
            'final_answer_preview': final_answer[:800]
        }
        try:
            # Update by custom entry_id field first
            if 'entry_id' in entry and entry.get('entry_id') == str(entry_id):
                self.table.update(updated, doc_ids=[entry.doc_id])  # type: ignore[attr-defined]
            else:
                self.table.update(updated, doc_ids=[int(entry_id)])
        except Exception:
            pass

GLOBAL_TOKEN_INSTRUMENTATION = TokenInstrumentation()

__all__ = ['GLOBAL_TOKEN_INSTRUMENTATION']
