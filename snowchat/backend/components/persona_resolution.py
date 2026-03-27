from __future__ import annotations
from typing import Dict, Any, Optional, Tuple
from .persona_registry import PERSONA_DEFS
import logging

logger = logging.getLogger("agentic_orchestrator_auto.persona_resolution")
from .keycloak_persona import resolve_persona_from_token
from .persona_registry import select_persona

# Precedence: explicit metadata > token > session (if passed) > heuristic > default
# Multi-role priority managed via PERSONA_DEFS['priority']

DEFAULT_PERSONA = 'product_owner'


def _priority(persona: str) -> int:
    return PERSONA_DEFS.get(persona, {}).get('priority', 0)


def choose_highest_priority(candidates: list[str]) -> str:
    if not candidates:
        return DEFAULT_PERSONA
    return sorted(candidates, key=lambda p: _priority(p), reverse=True)[0]


def determine_persona(metadata: Dict[str, Any] | None,
                      token: Optional[str],
                      question: Optional[str],
                      stored_session_persona: Optional[str] = None,
                      allow_heuristic_override: bool = True) -> Tuple[str, str]:
    """Return (persona, source) according to precedence strategy.

    source values: explicit|token|session|heuristic|default
    """
    metadata = metadata or {}

    # Extract potential personas early
    explicit = metadata.get('persona')
    force_explicit = bool(metadata.get('force_persona'))
    token_persona: Optional[str] = None
    if token:
        try:
            token_persona = resolve_persona_from_token(token)
        except Exception:
            token_persona = None

    # Precedence tweak:
    #  - If token persona present and differs from explicit, prefer token UNLESS force_persona flag set.
    #  - If explicit present AND (matches token OR token absent) treat as explicit.
    if token_persona and token_persona in PERSONA_DEFS:
        if explicit and explicit in PERSONA_DEFS:
            if force_explicit and explicit != token_persona:
                logger.info(f"[persona_resolution] force_persona honored explicit={explicit} over token={token_persona}")
                return explicit, 'explicit-forced'
            if explicit == token_persona:
                logger.debug(f"[persona_resolution] explicit matches token persona={explicit}")
                return explicit, 'token'
            # token overrides unintended explicit
            logger.info(f"[persona_resolution] Overriding explicit '{explicit}' with token persona={token_persona}")
            return token_persona, 'token'
        # No explicit, token wins
        logger.info(f"[persona_resolution] Persona derived from token={token_persona}")
        return token_persona, 'token'
    # No token persona or unrecognized, fallback to explicit if valid
    if explicit and explicit in PERSONA_DEFS:
        logger.debug(f"[persona_resolution] Using explicit persona={explicit}")
        return explicit, 'explicit'

    # 3. Stored session (allow override if question contains strong ownership keywords for developer)
    ownership_triggers = (question or '').lower()
    ownership_hit = any(k in ownership_triggers for k in [
        'my incidents','my open incidents','assigned to me','my backlog','things assigned to me','my tickets',
        'incidents for me','incidents assigned to me','dev1 incidents','incidents for dev1'
    ])
    if stored_session_persona and stored_session_persona in PERSONA_DEFS and not ownership_hit:
        logger.debug(f"[persona_resolution] Reusing session persona={stored_session_persona}")
        return stored_session_persona, 'session'

    # 4. Heuristic (if allowed)
    if allow_heuristic_override and question:
        heuristic = select_persona(question, metadata)
        if heuristic and heuristic in PERSONA_DEFS:
            logger.info(f"[persona_resolution] Heuristic persona={heuristic}")
            return heuristic, 'heuristic'

    # 5. Default
    logger.debug(f"[persona_resolution] Falling back to default persona={DEFAULT_PERSONA}")
    return DEFAULT_PERSONA, 'default'

__all__ = ["determine_persona"]
