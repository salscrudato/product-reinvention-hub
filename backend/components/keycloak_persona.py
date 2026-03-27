import os
from typing import Dict, Any, Optional, List
import jwt

# Environment variables expected:
# KEYCLOAK_EXPECTED_ISS (optional)
# KEYCLOAK_AUDIENCE (optional)
# PERSONA_ROLE_MAP='product_owner:po_role_name,engineering_lead:eng_lead_role_name'
# If PERSONA_ROLE_MAP is absent we use defaults.

DEFAULT_ROLE_MAP = {
    'engineering_lead': ['engineering_lead', 'eng_lead', 'lead', 'engineering-lead'],
    'developer': ['developer', 'dev', 'software-engineer', 'engineer'],
    'product_owner': ['product_owner', 'po', 'product-owner'],
    # Anticipated future roles (placeholders)
    'sre': ['sre', 'site-reliability', 'site-reliability-engineer'],
    'support_analyst': ['support_analyst', 'support-analyst', 'support', 'service-desk']
}

_cached_role_map: Dict[str, List[str]] | None = None

def _load_role_map() -> Dict[str, List[str]]:
    global _cached_role_map
    if _cached_role_map is not None:
        return _cached_role_map
    raw = os.getenv('PERSONA_ROLE_MAP')
    role_map = DEFAULT_ROLE_MAP.copy()
    if raw:
        for pair in raw.split(','):
            if ':' in pair:
                persona, roles = pair.split(':', 1)
                role_map[persona.strip()] = [r.strip() for r in roles.split('|') if r.strip()]
    _cached_role_map = role_map
    return role_map


def decode_keycloak_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        # For development: allow unsigned tokens if no public key is configured.
        # If a public key is present we verify the signature. Passing None directly causes a type issue,
        # so we use an empty string when signature verification is disabled.
        public_key = os.getenv('KEYCLOAK_PUBLIC_KEY')
        verify = bool(public_key)
        options = {"verify_signature": verify, "verify_aud": False}
        key_for_decode: str | bytes = public_key if public_key else ""  # empty placeholder when not verifying
        data = jwt.decode(token, key_for_decode, algorithms=["RS256", "HS256"], options=options)
        iss = os.getenv('KEYCLOAK_EXPECTED_ISS')
        if iss and data.get('iss') != iss:
            return None
        aud = os.getenv('KEYCLOAK_AUDIENCE')
        if aud and aud not in (data.get('aud') if isinstance(data.get('aud'), list) else [data.get('aud')]):
            return None
        return data
    except Exception:
        return None


def extract_roles(token_payload: Dict[str, Any]) -> List[str]:
    roles = []
    # Keycloak may store roles under realm_access or resource_access
    realm = token_payload.get('realm_access', {})
    if isinstance(realm, dict):
        roles.extend(realm.get('roles', []))
    resource = token_payload.get('resource_access', {})
    if isinstance(resource, dict):
        for _client, meta in resource.items():
            if isinstance(meta, dict):
                roles.extend(meta.get('roles', []))
    roles = list({r.lower() for r in roles})
    return roles


def map_roles_to_persona(roles: List[str]) -> Optional[str]:
    role_map = _load_role_map()
    for persona, role_aliases in role_map.items():
        for r in roles:
            if r.lower() in role_aliases:
                return persona
    return None


def resolve_persona_from_token(token: str) -> Optional[str]:
    payload = decode_keycloak_token(token)
    if not payload:
        return None
    roles = extract_roles(payload)
    persona = map_roles_to_persona(roles)
    if persona:
        return persona
    # Fallback: infer from preferred_username prefix patterns when roles missing
    pu = (payload.get('preferred_username') or '').lower()
    if pu.startswith('dev'):
        return 'developer'
    if pu.startswith('po') or pu.startswith('product'):
        return 'product_owner'
    if pu.startswith('eng') or pu.startswith('lead'):
        return 'engineering_lead'
    return None

__all__ = [
    'resolve_persona_from_token',
    'map_roles_to_persona',
    'extract_roles',
    'decode_keycloak_token'
]
