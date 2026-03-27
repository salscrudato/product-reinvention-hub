from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass(frozen=True)
class PersonaProfile:
    persona_id: str
    name: str
    age: int
    state: str
    smoker: bool
    drinker: bool
    high_risk_activities: List[str]
    planned_investment: int  # five-year horizon USD
    liquidity_need: str  # low/medium/high
    risk_tolerance: str
    emergency_funds: bool
    habits: List[str]


PERSONAS: Dict[str, PersonaProfile] = {
    "JOE-1": PersonaProfile(
        persona_id="JOE-1",
        name="Joe Supervisor",
        age=37,
        state="CO",
        smoker=True,
        drinker=True,
        high_risk_activities=["skiing", "skydiving"],
        planned_investment=1_200_000,
        liquidity_need="medium",
        risk_tolerance="Aggressive",
        emergency_funds=True,
        habits=["smoker", "drinker"],
    ),
    "JOE-2": PersonaProfile(
        persona_id="JOE-2",
        name="Joe2 Sup2",
        age=37,
        state="TX",
        smoker=True,
        drinker=False,
        high_risk_activities=[],
        planned_investment=500_000,
        liquidity_need="high",
        risk_tolerance="Moderate",
        emergency_funds=False,
        habits=["smoker"],
    ),
    "JOE-3": PersonaProfile(
        persona_id="JOE-3",
        name="Joe3 Sup3",
        age=37,
        state="CA",
        smoker=False,
        drinker=False,
        high_risk_activities=["base jumping"],
        planned_investment=3_000_000,
        liquidity_need="low",
        risk_tolerance="Aggressive",
        emergency_funds=True,
        habits=[],
    ),
    "JOE-4": PersonaProfile(
        persona_id="JOE-4",
        name="Joe4 Sup4",
        age=55,
        state="WA",
        smoker=False,
        drinker=True,
        high_risk_activities=["marathon"],
        planned_investment=250_000,
        liquidity_need="high",
        risk_tolerance="Moderate",
        emergency_funds=True,
        habits=["drinker"],
    ),
    "JOE-5": PersonaProfile(
        persona_id="JOE-5",
        name="Joe5 Sup5",
        age=48,
        state="NY",
        smoker=True,
        drinker=False,
        high_risk_activities=["aviation"],
        planned_investment=900_000,
        liquidity_need="medium",
        risk_tolerance="Moderate",
        emergency_funds=False,
        habits=["smoker"],
    ),
    "JOE-6": PersonaProfile(
        persona_id="JOE-6",
        name="Joe6 Sup6",
        age=62,
        state="AZ",
        smoker=False,
        drinker=False,
        high_risk_activities=["ski instructor"],
        planned_investment=650_000,
        liquidity_need="low",
        risk_tolerance="Conservative",
        emergency_funds=True,
        habits=[],
    ),
}


def get_persona(persona_id: str | None) -> PersonaProfile | None:
    if not persona_id:
        return None
    return PERSONAS.get(persona_id.upper())
