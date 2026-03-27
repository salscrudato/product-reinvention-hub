from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict, List, Tuple

from .personas import PersonaProfile, get_persona


RESTRICTED_RIDER_STATES = {"NY"}
MIN_PREMIUM = 10_000
MAX_STANDARD_PREMIUM = 1_000_000
MAX_AGE = 78
AGE_WARNING_THRESHOLD = 76
MIN_RIDER_AGE = 50
MAX_FREE_WITHDRAWAL = 10  # percent


def _normalise_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = payload or {}
    client = payload.get("clientProfile", {}) or {}
    funding = payload.get("funding", {}) or {}
    allocations = payload.get("allocations", payload.get("allocation", [])) or []
    return {
        "personaId": payload.get("personaId") or client.get("personaId"),
        "ownerAge": payload.get("ownerAge") or client.get("age"),
        "state": payload.get("state") or client.get("state"),
        "premiumAmount": payload.get("premiumAmount") or funding.get("amount"),
        "withdrawalPercent": payload.get("withdrawalPercent") or funding.get("withdrawalPercent"),
        "selectedGLBRider": payload.get("selectedGLBRider"),
        "extendedCareRider": bool(payload.get("extendedCareRider")),
        "liquidityNeed": payload.get("liquidityNeed") or client.get("liquidity"),
        "allocations": allocations,
        "sourceOfFunds": payload.get("sourceOfFunds") or funding.get("sources", []),
        "cashContribution": payload.get("cashContribution") or funding.get("cash", 0),
        "emergencyFunds": payload.get("emergencyFunds", client.get("emergencyFunds")),
    }


def evaluate_rules(step: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalise_payload(payload)
    persona = get_persona(normalized.get("personaId"))

    warnings: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    next_actions: List[Dict[str, Any]] = []

    _check_age(normalized, warnings, errors)
    _check_premium(normalized, warnings, errors)
    _check_liquidity(normalized, warnings)
    _check_allocations(normalized, warnings)
    _check_rider(age=normalized.get("ownerAge"), rider=normalized.get("selectedGLBRider"), errors=errors)
    _check_state_restriction(normalized, errors)
    _check_aml(normalized, warnings)

    if persona:
        next_actions.extend(_persona_actions(persona))

    return {
        "warnings": warnings,
        "errors": errors,
        "nextBestActions": next_actions,
        "metadata": {
            "ruleVersion": 1,
            "persona": persona.persona_id if persona else None,
            "step": step,
            "personaProfile": asdict(persona) if persona else None,
        },
    }


def _check_age(data: Dict[str, Any], warnings: List[Dict[str, Any]], errors: List[Dict[str, Any]]):
    age = data.get("ownerAge")
    if age is None:
        return
    if age > MAX_AGE:
        errors.append({
            "code": "AGE_LIMIT_EXCEEDED",
            "severity": "error",
            "message": "Owner age exceeds permitted range for Power Select Plus Income.",
            "field": "ownerDOB",
        })
    elif age >= AGE_WARNING_THRESHOLD:
        warnings.append({
            "code": "AGE_LIMIT_NEAR",
            "severity": "warning",
            "message": "Owner age is within two years of the maximum for this product.",
            "field": "ownerDOB",
            "suggestion": "Consider IncomeShield 10 FIA",
        })


def _check_premium(data: Dict[str, Any], warnings: List[Dict[str, Any]], errors: List[Dict[str, Any]]):
    premium = data.get("premiumAmount") or 0
    if premium < MIN_PREMIUM:
        errors.append({
            "code": "PREMIUM_MIN_FAIL",
            "severity": "error",
            "message": "Minimum premium for Power Select Plus Income is $10,000.",
            "field": "premiumAmount",
        })
    if premium > MAX_STANDARD_PREMIUM:
        warnings.append({
            "code": "PREMIUM_MAX_ALERT",
            "severity": "warning",
            "message": "Premium above standard maximum requires suitability letter.",
            "field": "premiumAmount",
            "suggestion": "Attach suitability rationale or split premiums across policies.",
        })


def _check_liquidity(data: Dict[str, Any], warnings: List[Dict[str, Any]]):
    withdrawal_pct = data.get("withdrawalPercent") or 0
    liquidity_need = (data.get("liquidityNeed") or "").lower()
    emergency_funds = data.get("emergencyFunds")
    if withdrawal_pct and withdrawal_pct > MAX_FREE_WITHDRAWAL:
        warnings.append({
            "code": "LIQUIDITY_RISK",
            "severity": "warning",
            "message": "Planned withdrawals exceed penalty-free amount.",
            "field": "withdrawalPercent",
            "suggestion": "Shift allocation to fixed bucket or adjust withdrawal plan.",
        })
    if liquidity_need == "high" and not emergency_funds:
        warnings.append({
            "code": "EMERGENCY_FUNDS_LOW",
            "severity": "warning",
            "message": "Client flagged high liquidity but no emergency funds documented.",
            "field": "emergencyFunds",
        })


def _check_allocations(data: Dict[str, Any], warnings: List[Dict[str, Any]]):
    allocations: List[Dict[str, Any]] = data.get("allocations", [])
    if not allocations:
        return
    for allocation in allocations:
        percent = allocation.get("percent") or allocation.get("allocation") or 0
        if percent >= 80:
            warnings.append({
                "code": "ALLOCATION_IMBALANCE",
                "severity": "warning",
                "message": "Allocation heavily concentrated in one index.",
                "field": "allocations",
                "suggestion": "Diversify across multiple accounts to stabilize volatility.",
            })
            break


def _check_rider(age: int | None, rider: str | None, errors: List[Dict[str, Any]]):
    if not rider:
        return
    if age is None:
        return
    if age < MIN_RIDER_AGE:
        errors.append({
            "code": "RIDER_INELIGIBLE_AGE",
            "severity": "error",
            "message": "Selected rider is not available for this age.",
            "field": "selectedGLBRider",
        })


def _check_state_restriction(data: Dict[str, Any], errors: List[Dict[str, Any]]):
    if not data.get("extendedCareRider"):
        return
    state = (data.get("state") or "").upper()
    if state in RESTRICTED_RIDER_STATES:
        errors.append({
            "code": "STATE_RESTRICTION",
            "severity": "error",
            "message": "Extended Care Rider not available in this state.",
            "field": "extendedCareRider",
        })


def _check_aml(data: Dict[str, Any], warnings: List[Dict[str, Any]]):
    cash = data.get("cashContribution") or 0
    sources = [s.lower() for s in (data.get("sourceOfFunds") or [])]
    if cash > 50_000 or "cash" in sources:
        warnings.append({
            "code": "AML_FLAG",
            "severity": "warning",
            "message": "Large cash funding requires AML documentation.",
            "field": "sourceOfFunds",
            "suggestion": "Upload AML verification before submission.",
        })


def _persona_actions(persona: PersonaProfile) -> List[Dict[str, Any]]:
    actions: List[Dict[str, Any]] = []
    if persona.risk_tolerance.lower() == "aggressive":
        actions.append({
            "title": "Highlight market participation options",
            "reason": "Persona prefers aggressive strategies; reinforce index allocations with guardrails.",
        })
    if persona.planned_investment > 1_000_000:
        actions.append({
            "title": "Pre-review suitability letter",
            "reason": "Investment exceeds $1M plan; expedite compliance review.",
        })
    if persona.liquidity_need == "high":
        actions.append({
            "title": "Discuss penalty-free withdrawal program",
            "reason": "Client indicated high liquidity needs.",
        })
    return actions
