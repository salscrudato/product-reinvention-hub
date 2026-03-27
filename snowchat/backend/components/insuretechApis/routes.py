from __future__ import annotations

from flask import Blueprint, jsonify, request

from .rules_engine import evaluate_rules
from .telemetry import compute_analytics

insuretech_bp = Blueprint("insuretech", __name__, url_prefix="/insuretech")


@insuretech_bp.route("/rules", methods=["POST"])
def rules_endpoint():
    payload = request.get_json(silent=True) or {}
    step = payload.get("step") or "application"
    response = evaluate_rules(step, payload)
    return jsonify(response)


@insuretech_bp.route("/analytics", methods=["POST"])
def analytics_endpoint():
    payload = request.get_json(silent=True) or {}
    persona_id = payload.get("personaId")
    metrics = compute_analytics(persona_id, payload)
    return jsonify(metrics)


@insuretech_bp.route("/offers", methods=["POST"])
def offers_endpoint():
    payload = request.get_json(silent=True) or {}
    metrics = compute_analytics(payload.get("personaId"), payload)
    rules = evaluate_rules(payload.get("step", "application"), payload)

    offer = {
        "product": "Power Select Plus Income",
        "bonus": metrics.get("insights", {}).get("newMoneyRate") or 0.05,
        "justification": "Aligned with persona guardrails and current allocation mix.",
        "warnings": rules.get("warnings", []),
    }
    return jsonify({"offer": offer, "telemetry": metrics, "rules": rules})
