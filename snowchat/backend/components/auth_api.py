from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import List, Optional
import logging

from flask import Blueprint, jsonify, request

logger = logging.getLogger("agentic_orchestrator_auto")

auth_bp = Blueprint("auth_api", __name__)


@dataclass
class UserProfile:
    name: str
    email: str
    phone: str
    address: str
    avatarUrl: str = ""


@dataclass
class AgentProfile:
    agentWritingCode: str
    agentName: str
    agentEmail: str
    agentPhone: str
    agentLicense: str
    agentState: str
    agentNPN: str


@dataclass
class CredentialRecord:
    username: str
    password: str
    role: str
    user: UserProfile
    agentInfo: Optional[AgentProfile] = None
    aliases: Optional[List[str]] = None


def _normalize(value: str | None) -> str:
    return (value or "").strip().lower()


CREDENTIALS: List[CredentialRecord] = [
    CredentialRecord(
        username="agent",
        password="agent123",
        role="agent",
        user=UserProfile(
            name="Michael Rodriguez",
            email="michael.rodriguez@corebridge.com",
            phone="(555) 123-4567",
            address="123 Insurance Lane, New York, NY 10001",
        ),
        agentInfo=AgentProfile(
            agentWritingCode="AWC-NY-12345",
            agentName="Michael Rodriguez",
            agentEmail="michael.rodriguez@corebridge.com",
            agentPhone="(555) 123-4567",
            agentLicense="LIC-NY-98765",
            agentState="NY",
            agentNPN="12345678",
        ),
    ),
    CredentialRecord(
        username="policyholder",
        password="john123",
        role="policyholder",
        user=UserProfile(
            name="John Anderson",
            email="john.anderson@email.com",
            phone="(555) 987-6543",
            address="456 Policyholder Drive, Boston, MA 02101",
        ),
        aliases=["john", "john.anderson@email.com"],
    ),
    CredentialRecord(
        username="admin",
        password="admin123",
        role="admin",
        user=UserProfile(
            name="Sarah Administrator",
            email="sarah.admin@corebridge.com",
            phone="(555) 111-2222",
            address="789 Admin Tower, New York, NY 10001",
        ),
    ),
    CredentialRecord(
        username="underwriter",
        password="under123",
        role="underwriter",
        user=UserProfile(
            name="David Underwriter",
            email="david.underwriter@corebridge.com",
            phone="(555) 333-4444",
            address="321 Review Street, New York, NY 10001",
        ),
    ),
    CredentialRecord(
        username="guest",
        password="guest123",
        role="guest",
        user=UserProfile(
            name="Guest User",
            email="guest@demo.com",
            phone="(555) 000-0000",
            address="Demo Address",
        ),
    ),
]


def _role_priority(preferred_role: Optional[str]) -> List[str]:
    roles = [record.role for record in CREDENTIALS]
    if not preferred_role:
        return roles
    ordered = [preferred_role]
    ordered.extend(role for role in roles if role != preferred_role)
    return ordered


def _match_credential(username: str, password: str, preferred_role: Optional[str]) -> Optional[CredentialRecord]:
    normalized_username = _normalize(username)
    for role in _role_priority(preferred_role):
        for record in CREDENTIALS:
            if record.role != role:
                continue
            identifiers = [_normalize(record.username)] + [
                _normalize(alias) for alias in (record.aliases or [])
            ]
            if normalized_username in identifiers and record.password == password:
                return record
    # fallback search (role mismatch)
    for record in CREDENTIALS:
        identifiers = [_normalize(record.username)] + [
            _normalize(alias) for alias in (record.aliases or [])
        ]
        if normalized_username in identifiers and record.password == password:
            return record
    return None


@auth_bp.route("/auth/login", methods=["POST"])
def login_route():
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "")
    password = payload.get("password", "")
    preferred_role = payload.get("preferredRole")

    if not username or not password:
        logger.warning("AUTH_LOGIN_MISSING_FIELDS", extra={"username": bool(username)})
        return jsonify({"message": "Username and password are required"}), 400

    credential = _match_credential(username, password, preferred_role)
    if not credential:
        logger.warning("AUTH_LOGIN_INVALID", extra={"username": username})
        return jsonify({"message": "Invalid username or password"}), 401

    logger.info(
        "AUTH_LOGIN_SUCCESS",
        extra={"username": credential.username, "role": credential.role},
    )

    response = {
        "role": credential.role,
        "user": asdict(credential.user),
        "agentInfo": asdict(credential.agentInfo) if credential.agentInfo else None,
        "token": f"mock-token-{credential.role}",
    }
    return jsonify(response)


@auth_bp.route("/auth/logout", methods=["POST"])
def logout_route():
    logger.info("AUTH_LOGOUT")
    return jsonify({"success": True})
