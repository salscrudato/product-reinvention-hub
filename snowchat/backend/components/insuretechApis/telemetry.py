from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict

from .personas import get_persona

BASE_RATE_BY_PERSONA = {
    "JOE-1": 0.052,
    "JOE-2": 0.047,
    "JOE-3": 0.043,
    "JOE-4": 0.055,
    "JOE-5": 0.051,
    "JOE-6": 0.048,
}


def compute_analytics(persona_id: str | None, payload: Dict[str, Any]) -> Dict[str, Any]:
    persona = get_persona(persona_id)
    premium = _to_number(payload.get("premiumAmount"))
    withdrawals = _to_number(payload.get("withdrawalPercent"))
    allocation_mix = payload.get("allocations", [])
    credit_rate = BASE_RATE_BY_PERSONA.get(persona_id or "", 0.045)

    stability_score = _calc_stability_score(allocation_mix, withdrawals)
    growth_score = _calc_growth_score(allocation_mix)
    liquidity_score = _calc_liquidity_score(withdrawals)

    return {
        "persona": asdict(persona) if persona else None,
        "metrics": {
            "premium": premium,
            "withdrawalPercent": withdrawals,
            "creditRate": round(credit_rate, 3),
            "stabilityScore": stability_score,
            "growthScore": growth_score,
            "liquidityScore": liquidity_score,
        },
        "insights": {
            "newMoneyRate": round(credit_rate + (growth_score * 0.005), 3),
            "guardrail": "Reduce withdrawals" if liquidity_score < 60 else "Maintain",
            "allocationSummary": _summarize_allocations(allocation_mix),
        },
    }


def _calc_stability_score(allocations, withdrawals):
    if not allocations:
        return 50
    concentration = max((a.get("percent") or a.get("allocation") or 0) for a in allocations)
    penalty = max(concentration - 40, 0)
    withdrawal_penalty = max((withdrawals or 0) - 5, 0) * 3
    score = 90 - penalty - withdrawal_penalty
    return max(min(score, 95), 30)


def _calc_growth_score(allocations):
    if not allocations:
        return 40
    index_alloc = sum(a.get("percent") or a.get("allocation") or 0 for a in allocations if a.get("type", "index") == "index")
    return max(min(50 + int(index_alloc / 5), 95), 20)


def _calc_liquidity_score(withdrawals):
    withdrawals = withdrawals or 0
    if withdrawals == 0:
        return 90
    if withdrawals <= 5:
        return 75
    if withdrawals <= 10:
        return 55
    return 40


def _summarize_allocations(allocations):
    if not allocations:
        return "No allocation data"
    summaries = []
    for allocation in allocations:
        name = allocation.get("name") or allocation.get("index") or "Bucket"
        pct = allocation.get("percent") or allocation.get("allocation") or 0
        summaries.append(f"{name}: {pct}%")
    return ", ".join(summaries)


def _to_number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
