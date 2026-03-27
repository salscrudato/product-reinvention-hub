import os
import jwt
import base64
import json
from components.keycloak_persona import resolve_persona_from_token, map_roles_to_persona

# Simple HS256 test (dev scenario) so we don't need real Keycloak public key

def make_token(roles, secret='devsecret'):
    payload = {
        'iss': os.getenv('KEYCLOAK_EXPECTED_ISS', 'http://localhost:8080/realms/demo'),
        'aud': os.getenv('KEYCLOAK_AUDIENCE', 'snowchat'),
        'realm_access': {'roles': roles}
    }
    return jwt.encode(payload, secret, algorithm='HS256')

def test_role_mapping_default():
    assert map_roles_to_persona(['product_owner']) == 'product_owner'
    assert map_roles_to_persona(['eng_lead']) == 'engineering_lead'


def test_resolve_persona_from_token_hs256(monkeypatch):
    secret = 'devsecret'
    monkeypatch.setenv('KEYCLOAK_PUBLIC_KEY', secret)
    token = make_token(['product_owner'], secret=secret)
    persona = resolve_persona_from_token(token)
    assert persona == 'product_owner'

    token2 = make_token(['eng_lead'], secret=secret)
    persona2 = resolve_persona_from_token(token2)
    assert persona2 == 'engineering_lead'


def test_unmatched_roles(monkeypatch):
    secret = 'devsecret'
    monkeypatch.setenv('KEYCLOAK_PUBLIC_KEY', secret)
    token = make_token(['random_role'], secret=secret)
    persona = resolve_persona_from_token(token)
    assert persona is None
