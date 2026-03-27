from __future__ import annotations
from typing import Optional, Dict, Any
from tinydb import TinyDB, Query
from tinydb.storages import JSONStorage
from tinydb.middlewares import CachingMiddleware
import logging
import os, time

DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'state_db.json'))

def _init_db() -> TinyDB:
    """Initialize TinyDB with a caching middleware for fewer writes."""
    try:
        return TinyDB(DB_PATH, storage=CachingMiddleware(JSONStorage))
    except Exception as e:  # Fallback to basic storage if middleware fails
        logger.warning(f"[session] Failed to init TinyDB with caching: {e}; falling back to default")
        return TinyDB(DB_PATH)

_db = _init_db()
_sessions = _db.table('sessions')

def _reinit_db() -> None:
    """Reinitialize TinyDB objects after a recovery."""
    global _db, _sessions
    _db = _init_db()
    _sessions = _db.table('sessions')
logger = logging.getLogger("agentic_orchestrator_auto.session")

# Sessions are transient per-login (caller may choose to re-init each login)

def _attempt_recover_corrupt_db(raw_error: Exception) -> None:
    """Attempt to recover if the JSON file is corrupted (e.g., concurrent write produced 'Extra data').

    Strategy:
      1. Backup the existing file to *.corrupt.<timestamp>.bak
      2. Try to heuristically salvage the first valid JSON object (up to the last matching closing brace)
      3. If salvage fails, create a fresh minimal DB structure.
    """
    try:
        if not os.path.exists(DB_PATH):
            return
        ts = int(time.time())
        backup_path = f"{DB_PATH}.corrupt.{ts}.bak"
        with open(DB_PATH, 'rb') as rf, open(backup_path, 'wb') as wf:
            wf.write(rf.read())
        logger.error(f"[session] Detected TinyDB corruption ({raw_error}); backup written to {backup_path}")

        # Heuristic salvage: keep trimming from end until json loads or give up
        try:
            with open(backup_path, 'r', encoding='utf-8') as bf:
                data = bf.read()
            # Quick heuristic: find last '}' and truncate after it
            last_brace = data.rfind('}')
            if last_brace != -1:
                candidate = data[:last_brace+1]
                import json
                try:
                    obj = json.loads(candidate)
                    with open(DB_PATH, 'w', encoding='utf-8') as wf2:
                        json.dump(obj, wf2)
                    logger.info("[session] Salvaged TinyDB JSON by truncation at last closing brace")
                    return
                except Exception as salvage_err:
                    logger.warning(f"[session] Salvage attempt failed: {salvage_err}; creating fresh DB")
        except Exception as e2:
            logger.warning(f"[session] Error during salvage read: {e2}; creating fresh DB")

        # Fresh file
        with open(DB_PATH, 'w', encoding='utf-8') as wf_new:
            wf_new.write('{"_default": {}, "sessions": {}}')
        logger.info("[session] Reinitialized TinyDB file with empty structure after corruption")
    except Exception as final_err:
        logger.exception(f"[session] Failed during corruption recovery: {final_err}")


def get_session(user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        logger.debug("[session] get_session called with empty user_id")
        return None
    q = Query()
    try:
        rows = _sessions.search(q.user_id == user_id)
    except Exception as e:
        # Detect JSONDecodeError (string match to avoid direct import if environment differs)
        if 'Extra data' in str(e) or 'JSONDecodeError' in str(e):
            _attempt_recover_corrupt_db(e)
            try:
                _reinit_db()
                rows = _sessions.search(q.user_id == user_id)
            except Exception as e2:
                logger.exception(f"[session] Post-recovery get_session failed: {e2}")
                return None
        else:
            logger.exception(f"[session] get_session failed: {e}")
            return None
    if rows:
        logger.debug(f"[session] Retrieved session for user_id={user_id} persona={rows[0].get('persona')}")
        return rows[0]
    logger.debug(f"[session] No existing session for user_id={user_id}")
    return None


def set_session_persona(user_id: str, persona: str, source: str) -> None:
    if not user_id:
        logger.warning("[session] set_session_persona called with empty user_id")
        return
    now = int(time.time())
    existing = get_session(user_id)
    if existing:
        logger.info(f"[session] Update session user_id={user_id} persona={persona} source={source}")
        try:
            _sessions.update({"persona": persona, "source": source, "updated_at": now}, Query().user_id == user_id)
        except Exception as e:
            if 'Extra data' in str(e) or 'JSONDecodeError' in str(e):
                _attempt_recover_corrupt_db(e)
                try:
                    _reinit_db()
                    _sessions.update({"persona": persona, "source": source, "updated_at": now}, Query().user_id == user_id)
                except Exception as e2:
                    logger.exception(f"[session] Post-recovery update failed: {e2}")
            else:
                logger.exception(f"[session] Update failed: {e}")
    else:
        logger.info(f"[session] Create session user_id={user_id} persona={persona} source={source}")
        try:
            _sessions.insert({"user_id": user_id, "persona": persona, "source": source, "created_at": now, "updated_at": now})
        except Exception as e:
            if 'Extra data' in str(e) or 'JSONDecodeError' in str(e):
                _attempt_recover_corrupt_db(e)
                try:
                    _reinit_db()
                    _sessions.insert({"user_id": user_id, "persona": persona, "source": source, "created_at": now, "updated_at": now})
                except Exception as e2:
                    logger.exception(f"[session] Post-recovery insert failed: {e2}")
            else:
                logger.exception(f"[session] Insert failed: {e}")

__all__ = ["get_session", "set_session_persona"]
