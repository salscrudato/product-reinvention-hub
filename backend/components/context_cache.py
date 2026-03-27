"""context_cache

Hybrid in-memory + TinyDB cache for incident context cards.
Key: (username, incident_number)

Entry shape:
{
  'incident_number': str,
  'username': str,
  'card': dict,            # condensed incident context card
  'compressed_history': str,
  'micro_intents_served': list[str],
  'saved_tokens_estimate': int,
  'fetched_at': float,
  'last_access': float,
  'ttl_seconds': int
}

Environment variables:
  CONTEXT_CACHE_TTL (default 300)
  CONTEXT_CACHE_MAX_ENTRIES (default 500)
  ENABLE_CONTEXT_CACHE (1/0)
"""
from __future__ import annotations
import time, os
from typing import Dict, Any, Tuple, Optional
from tinydb import TinyDB, Query

_TTL_DEFAULT = int(os.getenv("CONTEXT_CACHE_TTL", "300"))
_MAX_ENTRIES = int(os.getenv("CONTEXT_CACHE_MAX_ENTRIES", "500"))

class ContextCache:
    def __init__(self, ttl_seconds: int = _TTL_DEFAULT, max_entries: int = _MAX_ENTRIES):
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._store: Dict[Tuple[str,str], Dict[str, Any]] = {}
        self._db = TinyDB("state_db.json")
        self._table = self._db.table("context_cache")

    def _expired(self, entry: Dict[str, Any]) -> bool:
        return (time.time() - entry.get("fetched_at", 0)) > entry.get("ttl_seconds", self.ttl_seconds)

    def get(self, username: str, incident_number: str) -> Optional[Dict[str, Any]]:
        key = (username, incident_number.upper())
        entry = self._store.get(key)
        if entry and not self._expired(entry):
            entry["last_access"] = time.time()
            return entry
        # Attempt TinyDB load if not in memory
        q = Query()
        db_entry = self._table.get((q.username == username) & (q.incident_number == incident_number.upper()))
        if isinstance(db_entry, dict) and not self._expired(db_entry):
            entry_copy = dict(db_entry)
            entry_copy["last_access"] = time.time()
            self._store[key] = entry_copy
            return entry_copy
        return None

    def store(self, entry: Dict[str, Any]):
        # Upsert
        username = entry.get("username")
        incident_number = (entry.get("incident_number") or "").upper()
        if not username or not incident_number:
            return
        key = (username, incident_number)
        now = time.time()
        entry.setdefault("fetched_at", now)
        entry.setdefault("last_access", now)
        entry.setdefault("ttl_seconds", self.ttl_seconds)
        self._store[key] = entry
        # Persist condensed subset
        persist_subset = {k: entry.get(k) for k in (
            "incident_number","username","card","compressed_history","micro_intents_served","saved_tokens_estimate","fetched_at","last_access","ttl_seconds"
        )}
        q = Query()
        self._table.upsert(persist_subset, (q.username == username) & (q.incident_number == incident_number))
        self.prune()

    def invalidate(self, username: str, incident_number: str):
        key = (username, incident_number.upper())
        self._store.pop(key, None)
        q = Query()
        self._table.remove((q.username == username) & (q.incident_number == incident_number.upper()))

    def prune(self):
        # TTL prune
        for key in list(self._store.keys()):
            if self._expired(self._store[key]):
                self._store.pop(key, None)
        # Size prune (LRU by last_access)
        if len(self._store) > self.max_entries:
            sorted_items = sorted(self._store.items(), key=lambda kv: kv[1].get("last_access", 0))
            overflow = len(self._store) - self.max_entries
            for i in range(overflow):
                to_remove_key = sorted_items[i][0]
                self._store.pop(to_remove_key, None)

GLOBAL_CONTEXT_CACHE = ContextCache()

__all__ = ["GLOBAL_CONTEXT_CACHE"]
