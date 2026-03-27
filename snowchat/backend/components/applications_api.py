"""REST-style endpoints backing the CoreBridge applications UI.

This module intentionally keeps business logic lightweight: TinyDB persists
records inside backend/state_db.json so local development does not require a
separate database. The schema matches src/types/applications.ts in the
CoreBridge frontend so fields stay flexible and forward-compatible.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, cast

from flask import Blueprint, jsonify, request
from tinydb import Query, TinyDB
from tinydb.table import Document

applications_bp = Blueprint("applications_api", __name__)

DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "state_db.json"))
db = TinyDB(DB_PATH)
applications_table = db.table("applications")


def _utc_now() -> str:
    return datetime.utcnow().isoformat()


def _generate_application_id() -> str:
    return f"APP{datetime.utcnow().strftime('%y%m%d')}{uuid.uuid4().hex[:4].upper()}"


def _generate_policy_number() -> str:
    return f"POL{datetime.utcnow().strftime('%y%m%d')}{uuid.uuid4().hex[:5].upper()}"


def _normalize_application(payload: Dict[str, Any], existing: Dict[str, Any] | None = None) -> Dict[str, Any]:
    record: Dict[str, Any] = {}
    if existing:
        record.update(existing)
    record.update(payload)

    if not record.get("id"):
        record["id"] = _generate_application_id()
    record.setdefault("status", "Submitted")
    record.setdefault("submittedDate", _utc_now())
    record.setdefault("ownerName", "")
    record.setdefault("ownerDOB", "")
    record.setdefault("productType", "")
    record.setdefault("annualIncome", "")
    record.setdefault("netWorth", "")
    record.setdefault("replacingExisting", "No")
    record["lastUpdated"] = _utc_now()
    return record


def _seed_data() -> None:
    if applications_table.all():
        return
    seed_records = [
        {
            "id": "APP240901A1",
            "ownerName": "Michael Thompson",
            "ownerDOB": "1973-04-11",
            "productType": "Annuities",
            "status": "Underwriter Review",
            "submittedDate": "2024-09-01T14:12:00Z",
            "annualIncome": "175000",
            "netWorth": "1250000",
            "replacingExisting": "No",
            "agentWritingCode": "AGT-45821",
            "agentName": "Agent Michael",
            "agentEmail": "michael.agent@example.com",
            "agentPhone": "555-123-0101",
            "ownerEmail": "michael.thompson@example.com",
        },
        {
            "id": "APP240824B2",
            "ownerName": "Sarah Delgado",
            "ownerDOB": "1980-08-22",
            "productType": "Life Insurance",
            "status": "Approved",
            "submittedDate": "2024-08-24T09:45:00Z",
            "annualIncome": "210000",
            "netWorth": "980000",
            "replacingExisting": "Yes",
            "policyNumber": "POL24090177",
            "agentWritingCode": "AGT-56433",
            "agentName": "Agent Sarah",
            "agentEmail": "sarah.agent@example.com",
            "agentPhone": "555-987-2222",
            "ownerEmail": "sarah.delgado@example.com",
        },
    ]
    applications_table.insert_multiple(seed_records)


def _apply_filters(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    status_filter = (request.args.get("status") or "").strip()
    owner_filter = (request.args.get("ownerEmail") or "").strip().lower()
    search_term = (request.args.get("search") or "").strip().lower()

    def matches(record: Dict[str, Any]) -> bool:
        if status_filter and status_filter.lower() != (record.get("status") or "").lower():
            return False
        if owner_filter and owner_filter != (record.get("ownerEmail") or "").lower():
            return False
        if search_term:
            haystack = f"{record.get('ownerName', '')} {record.get('id', '')}".lower()
            if search_term not in haystack:
                return False
        return True

    return [r for r in records if matches(r)]


@applications_bp.route("/applications", methods=["GET"])
def list_applications():
    _seed_data()
    raw_records: List[Document] = applications_table.all()
    records = [cast(Dict[str, Any], dict(item)) for item in raw_records]
    filtered = _apply_filters(records)
    filtered.sort(key=lambda item: item.get("submittedDate", ""), reverse=True)
    return jsonify(filtered)


@applications_bp.route("/applications", methods=["POST"])
def create_application():
    payload = request.get_json(silent=True) or {}
    required = ["ownerName", "ownerDOB", "productType"]
    missing = [field for field in required if not payload.get(field)]
    if missing:
        return jsonify({"error": "missing_fields", "fields": missing}), 400

    record = _normalize_application(payload)
    applications_table.upsert(record, Query().id == record["id"])
    return jsonify(record), 201


@applications_bp.route("/applications/<app_id>", methods=["PATCH"])
def update_application(app_id: str):
    payload = request.get_json(silent=True) or {}
    Application = Query()
    existing_raw = applications_table.get(Application.id == app_id)
    if not existing_raw:
        return jsonify({"error": "not_found", "id": app_id}), 404

    existing = cast(Dict[str, Any], existing_raw)
    updated = _normalize_application(payload, existing)
    applications_table.update(updated, Application.id == app_id)
    return jsonify(updated)


@applications_bp.route("/applications/<app_id>", methods=["DELETE"])
def delete_application(app_id: str):
    Application = Query()
    removed = applications_table.remove(Application.id == app_id)
    if not removed:
        return jsonify({"error": "not_found", "id": app_id}), 404
    return jsonify({"id": app_id})


@applications_bp.route("/applications/<app_id>/convert", methods=["POST"])
def convert_application(app_id: str):
    Application = Query()
    existing_raw = applications_table.get(Application.id == app_id)
    if not existing_raw:
        return jsonify({"error": "not_found", "id": app_id}), 404

    existing = cast(Dict[str, Any], existing_raw)
    policy_number = existing.get("policyNumber") or _generate_policy_number()
    updated = _normalize_application(
        {
            "status": "Converted to Policy",
            "policyNumber": policy_number,
        },
        existing,
    )
    applications_table.update(updated, Application.id == app_id)
    return jsonify(updated)
