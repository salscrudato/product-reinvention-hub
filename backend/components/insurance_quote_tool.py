"""
Insurance Quote Tool - Mock Insurance Policy Administration APIs

This module provides mock insurance tools to demonstrate the agentic orchestration
framework works for ANY domain, not just ServiceNow incident management.

Key features:
- Policy selection workflow (list → user selects → fetch)
- Agent-to-agent data passing (each tool passes only needed data to next agent)
- Realistic API orchestration (no full policy dumps)

Mock APIs:
1. list_available_policies - Show policy choices for user selection
2. fetch_policy_details - Get ONLY essential data for next agent
3. get_zip_risk_rating - Get risk factors for ZIP codes
4. get_vehicle_details - Get vehicle valuation (lean data)
5. calculate_premium - Calculate new premium using data from previousagents
6. format_quote_comparison - Create comparison using data from all agents

All functions return realistic mock data to simulate real insurance APIs.
"""

import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import json

logger = logging.getLogger(__name__)

# ============================================================================
# MOCK DATA STRUCTURES
# ============================================================================

MOCK_POLICIES = {
    "100001": {
        "policy_number": "100001",
        "holder_email": "john.doe@email.com",
        "holder_name": "John Doe",
        "policy_type": "Auto Insurance",
        "status": "Active",
        "effective_date": "2020-03-15",
        "expiration_date": "2026-03-15",
        "vehicle": {
            "year": 2010,
            "make": "Honda",
            "model": "CR-V",
            "vin": "1HGBH41JXMN109186",
            "mileage": 145000,
            "value": 8500
        },
        "coverage": {
            "liability": {
                "bodily_injury": "25000/50000",
                "property_damage": "20000"
            },
            "collision": {
                "deductible": 500,
                "coverage": "Actual Cash Value"
            },
            "comprehensive": {
                "deductible": 500,
                "coverage": "Actual Cash Value"
            },
            "uninsured_motorist": "25000/50000"
        },
        "current_premium": {
            "monthly": 145,
            "annual": 1740
        },
        "current_location": {
            "zip_code": "60100",
            "city": "Crystal Lake",
            "state": "IL",
            "risk_zone": "Suburban-Low"
        },
        "driver_info": {
            "age": 45,
            "years_licensed": 27,
            "accidents_3yr": 0,
            "violations_3yr": 0,
            "credit_tier": "Good"
        }
    },
    "100002": {
        "policy_number": "100002",
        "holder_email": "john.doe@email.com",
        "holder_name": "John Doe",
        "policy_type": "Auto Insurance",
        "status": "Active",
        "effective_date": "2024-01-10",
        "expiration_date": "2027-01-10",
        "vehicle": {
            "year": 2024,
            "make": "Acura",
            "model": "MDX",
            "vin": "5J8YD4H85PL012345",
            "mileage": 8500,
            "value": 52000
        },
        "coverage": {
            "liability": {
                "bodily_injury": "100000/300000",
                "property_damage": "50000"
            },
            "collision": {
                "deductible": 1000,
                "coverage": "Replacement Cost"
            },
            "comprehensive": {
                "deductible": 500,
                "coverage": "Replacement Cost"
            },
            "uninsured_motorist": "100000/300000"
        },
        "current_premium": {
            "monthly": 285,
            "annual": 3420
        },
        "current_location": {
            "zip_code": "60100",
            "city": "Crystal Lake",
            "state": "IL",
            "risk_zone": "Suburban-Low"
        },
        "driver_info": {
            "age": 45,
            "years_licensed": 27,
            "accidents_3yr": 0,
            "violations_3yr": 0,
            "credit_tier": "Excellent"
        }
    }
}

ZIP_RISK_DATA = {
    # Chicago suburbs - Low risk
    "60100": {
        "zip_code": "60100",
        "city": "Crystal Lake",
        "state": "IL",
        "risk_zone": "Suburban-Low",
        "theft_rate": "Low",
        "collision_frequency": "Low",
        "base_factor": 0.85,
        "comprehensive_factor": 0.92,
        "collision_factor": 0.88,
        "avg_claim_cost": 3200
    },
    "60047": {
        "zip_code": "60047",
        "city": "Lake Zurich",
        "state": "IL",
        "risk_zone": "Suburban-Low",
        "theft_rate": "Very Low",
        "collision_frequency": "Low",
        "base_factor": 0.82,
        "comprehensive_factor": 0.89,
        "collision_factor": 0.85,
        "avg_claim_cost": 3000
    },
    
    # Chicago suburbs - Medium risk
    "60501": {
        "zip_code": "60501",
        "city": "Summit",
        "state": "IL",
        "risk_zone": "Urban-Medium",
        "theft_rate": "Medium",
        "collision_frequency": "Medium",
        "base_factor": 1.15,
        "comprehensive_factor": 1.22,
        "collision_factor": 1.18,
        "avg_claim_cost": 4800
    },
    "60107": {
        "zip_code": "60107",
        "city": "Streamwood",
        "state": "IL",
        "risk_zone": "Suburban-Medium",
        "theft_rate": "Medium",
        "collision_frequency": "Medium",
        "base_factor": 0.98,
        "comprehensive_factor": 1.05,
        "collision_factor": 1.02,
        "avg_claim_cost": 3900
    },
    
    # Chicago urban - High risk
    "60614": {
        "zip_code": "60614",
        "city": "Chicago",
        "state": "IL",
        "risk_zone": "Urban-High",
        "theft_rate": "High",
        "collision_frequency": "High",
        "base_factor": 1.35,
        "comprehensive_factor": 1.48,
        "collision_factor": 1.42,
        "avg_claim_cost": 5500
    },
    "60601": {
        "zip_code": "60601",
        "city": "Chicago",
        "state": "IL",
        "risk_zone": "Urban-Very-High",
        "theft_rate": "Very High",
        "collision_frequency": "Very High",
        "base_factor": 1.52,
        "comprehensive_factor": 1.65,
        "collision_factor": 1.58,
        "avg_claim_cost": 6200
    }
}

# Illinois state minimum requirements (realistic as of 2024)
IL_STATE_MINIMUMS = {
    "state": "IL",
    "liability": {
        "bodily_injury_per_person": 25000,
        "bodily_injury_per_accident": 50000,
        "property_damage": 20000,
        "display": "$25,000/$50,000/$20,000"
    },
    "uninsured_motorist": {
        "required": True,
        "bodily_injury_per_person": 25000,
        "bodily_injury_per_accident": 50000
    }
}

# =========================================================================
# CORE TOOL FUNCTIONS
# ============================================================================

def list_available_policies_core(email: Optional[str] = None) -> Dict[str, Any]:
    """
    List all available policies for a user (for selection).
    
    Simulates: GET /api/policies/list?holder_email={email}
    
    Args:
        email: Policy holder email address (optional)
        
    Returns:
        Dict containing:
        - policies: List of basic policy info for selection
        - count: Number of policies found
    """
    logger.info(f"[list_available_policies_core] Listing policies for email={email}")
    
    # Filter policies by email if provided
    matching_policies = []
    for pol_num, policy in MOCK_POLICIES.items():
        if not email or policy["holder_email"].lower() == email.lower():
            # Return only essential info for selection
            matching_policies.append({
                "policy_number": policy["policy_number"],
                "vehicle_display": f"{policy['vehicle']['year']} {policy['vehicle']['make']} {policy['vehicle']['model']}",
                "current_premium": policy["current_premium"]["monthly"],
                "status": policy["status"]
            })
    
    logger.info(f"[list_available_policies_core] Found {len(matching_policies)} policies")
    
    return {
        "success": True,
        "policies": matching_policies,
        "count": len(matching_policies),
        "message": f"Found {len(matching_policies)} active policies"
    }


def fetch_policy_by_holder_core(email: str) -> Dict[str, Any]:
    """
    Legacy function - Fetch first policy for a given policy holder.
    Kept for backward compatibility. New code should use list_available_policies + fetch_policy_details.
    
    Args:
        email: Policy holder email
        
    Returns:
        Dict containing the first matching policy's full details
    """
    logger.info(f"[fetch_policy_by_holder_core] DEPRECATED: Fetching first policy for holder {email}")
    logger.warning("[fetch_policy_by_holder_core] This function is deprecated. Use list_available_policies + fetch_policy_details instead.")
    
    # Find matching policies
    matching_policies = [
        policy for policy in MOCK_POLICIES.values()
        if policy["holder_email"].lower() == email.lower()
    ]
    
    if not matching_policies:
        logger.error(f"[fetch_policy_by_holder_core] No policies found for email: {email}")
        return {
            "success": False,
            "error": f"No policies found for email: {email}",
            "policy": None
        }
    
    # Return first policy (legacy behavior)
    policy = matching_policies[0]
    logger.info(f"[fetch_policy_by_holder_core] Found policy {policy['policy_number']} for {email}")
    
    return {
        "success": True,
        "policy": policy,
        "message": f"Found policy {policy['policy_number']} (note: {len(matching_policies)} total policies exist)"
    }


def fetch_policy_details_core(policy_number: str) -> Dict[str, Any]:
    """
    Fetch specific policy details by policy number.
    Returns ONLY essential data needed for quote calculation (not full policy dump).
    
    Simulates: GET /api/policies/{policy_number}/details
    
    Args:
        policy_number: Policy number to fetch
        
    Returns:
        Dict containing ONLY:
        - policy_number
        - current_zip
        - current_premium
        - vehicle_year, vehicle_make, vehicle_model
    """
    logger.info(f"[fetch_policy_details_core] Fetching policy {policy_number}")
    
    if policy_number not in MOCK_POLICIES:
        logger.error(f"[fetch_policy_details_core] Policy {policy_number} not found")
        return {
            "success": False,
            "message": f"Policy {policy_number} not found"
        }
    
    policy = MOCK_POLICIES[policy_number]
    
    # Return ONLY what's needed for next agent (not full policy object)
    essential_data = {
        "policy_number": policy["policy_number"],
        "current_zip": policy["current_location"]["zip_code"],
        "current_premium": policy["current_premium"]["monthly"],
        "vehicle_year": policy["vehicle"]["year"],
        "vehicle_make": policy["vehicle"]["make"],
        "vehicle_model": policy["vehicle"]["model"]
    }
    
    logger.info(f"[fetch_policy_details_core] Retrieved policy {policy_number}: {policy['vehicle']['year']} {policy['vehicle']['make']} {policy['vehicle']['model']}, ${essential_data['current_premium']}/mo")
    
    return {
        "success": True,
        "policy_details": essential_data,
        "message": f"Policy {policy_number} details retrieved"
    }


def get_zip_risk_rating_core(zip_code: str) -> Dict[str, Any]:
    """
    Get insurance risk rating for a ZIP code.
    
    Simulates: GET /api/risk-ratings/zip/{zip_code}
    
    Args:
        zip_code: 5-digit ZIP code
        
    Returns:
        Dict containing:
        - zip_code
        - city, state
        - risk_zone (Suburban-Low, Urban-Medium, Urban-High, etc.)
        - theft_rate, collision_frequency
        - base_factor, comprehensive_factor, collision_factor
        - avg_claim_cost
    """
    logger.info(f"[get_zip_risk_rating_core] Looking up risk data for ZIP {zip_code}")
    
    if zip_code in ZIP_RISK_DATA:
        risk_data = ZIP_RISK_DATA[zip_code]
        logger.info(f"[get_zip_risk_rating_core] Found: {risk_data['city']}, {risk_data['state']} - {risk_data['risk_zone']}")
        return {
            "success": True,
            "risk_data": risk_data,
            "message": f"Risk rating found for {zip_code}"
        }
    
    # Unknown ZIP - return medium risk estimate
    logger.warning(f"[get_zip_risk_rating_core] ZIP {zip_code} not in database - returning medium risk estimate")
    return {
        "success": False,
        "risk_data": {
            "zip_code": zip_code,
            "city": "Unknown",
            "state": "Unknown",
            "risk_zone": "Unknown-Medium",
            "theft_rate": "Medium",
            "collision_frequency": "Medium",
            "base_factor": 1.0,
            "comprehensive_factor": 1.0,
            "collision_factor": 1.0,
            "avg_claim_cost": 4000
        },
        "message": f"ZIP {zip_code} not in database - using medium risk estimate"
    }


def get_vehicle_details_core(policy_number: str) -> Dict[str, Any]:
    """
    Get vehicle valuation details (returns ONLY current value for premium calculation).
    
    Simulates: GET /api/vehicles/valuation?policy_number={policy_number}
    
    Args:
        policy_number: Policy number
        
    Returns:
        Dict containing ONLY:
        - estimated_value: Current market value
        - vehicle_age: Age in years
    """
    logger.info(f"[get_vehicle_details_core] Getting valuation for policy {policy_number}")
    
    if policy_number not in MOCK_POLICIES:
        logger.error(f"[get_vehicle_details_core] Policy {policy_number} not found")
        return {
            "success": False,
            "message": f"Policy {policy_number} not found"
        }
    
    policy_data = MOCK_POLICIES[policy_number]
    vehicle = policy_data["vehicle"]
    
    # Calculate vehicle age
    current_year = datetime.now().year
    vehicle_age = current_year - vehicle["year"]
    current_value = vehicle["value"]
    
    logger.info(f"[get_vehicle_details_core] Vehicle age: {vehicle_age} years, value: ${current_value}")
    
    # Return ONLY what premium calculator needs
    return {
        "success": True,
        "valuation": {
            "estimated_value": current_value,
            "vehicle_age": vehicle_age
        },
        "message": f"Vehicle valuation: ${current_value}"
    }


def calculate_premium_core(
    policy_number: str,
    current_premium: float,
    old_zip: str,
    new_zip: str,
    old_zip_risk: Dict[str, Any],
    new_zip_risk: Dict[str, Any],
    vehicle_value: float
) -> Dict[str, Any]:
    """
    Calculate new insurance premium based on risk factors.
    Takes data from previous agents (not re-fetching from DB).
    
    Simulates: POST /api/quotes/calculate
    
    Args:
        policy_number: Policy number
        current_premium: Current monthly premium (from policy details agent)
        old_zip: Current ZIP code (from policy details agent)
        new_zip: New ZIP code (from user query)
        old_zip_risk: Risk data for old ZIP (from risk analyzer agent)
        new_zip_risk: Risk data for new ZIP (from risk analyzer agent)
        vehicle_value: Current vehicle value (from vehicle valuation agent)
        
    Returns:
        Dict containing ONLY:
        - new_premium_monthly
        - premium_change_amount
        - premium_change_percent
        - risk_zone_old
        - risk_zone_new
    """
    logger.info(f"[calculate_premium_core] Calculating premium: policy={policy_number}, {old_zip} → {new_zip}")
    
    # Use risk factors passed from previous agents (not re-fetching)
    old_risk_factor = old_zip_risk.get("base_factor", 1.0)
    new_risk_factor = new_zip_risk.get("base_factor", 1.0)
    
    # Calculate base premium adjustment using data from previous agents
    risk_ratio = new_risk_factor / old_risk_factor
    
    # Break down by coverage type (simplified calculation)
    # Assume current premium split: 40% liability, 30% collision, 30% comprehensive
    liability_monthly = current_premium * 0.40
    collision_monthly = current_premium * 0.30
    comprehensive_monthly = current_premium * 0.30
    
    # Apply risk-specific factors
    old_collision_factor = old_zip_risk.get("collision_factor", 1.0)
    new_collision_factor = new_zip_risk.get("collision_factor", 1.0)
    old_comp_factor = old_zip_risk.get("comprehensive_factor", 1.0)
    new_comp_factor = new_zip_risk.get("comprehensive_factor", 1.0)
    
    new_liability = liability_monthly  # Liability typically same
    new_collision = collision_monthly * (new_collision_factor / old_collision_factor)
    new_comprehensive = comprehensive_monthly * (new_comp_factor / old_comp_factor)
    
    new_premium_monthly = new_liability + new_collision + new_comprehensive
    new_premium_monthly = round(new_premium_monthly)
    
    change_amount = new_premium_monthly - round(current_premium)
    change_percent = (change_amount / current_premium) * 100 if current_premium > 0 else 0
    
    logger.info(f"[calculate_premium_core] Premium change: ${round(current_premium)} → ${new_premium_monthly} ({change_percent:+.1f}%)")
    
    # Return ONLY essential calculation results (not full breakdown)
    return {
        "success": True,
        "calculation": {
            "new_premium_monthly": new_premium_monthly,
            "premium_change_amount": change_amount,
            "premium_change_percent": round(change_percent, 1),
            "risk_zone_old": old_zip_risk.get("risk_zone", "Unknown"),
            "risk_zone_new": new_zip_risk.get("risk_zone", "Unknown")
        },
        "message": f"Premium: ${round(current_premium)} → ${new_premium_monthly}/month ({change_percent:+.1f}%)"
    }


def format_quote_comparison_core(
    policy_number: str,
    policy_details: Dict[str, Any],
    old_zip: str,
    new_zip: str,
    old_zip_risk: Dict[str, Any],
    new_zip_risk: Dict[str, Any],
    premium_calculation: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Format comprehensive quote comparison report using data from previous agents.
    
    Args:
        policy_number: Policy number
        policy_details: Policy data from fetch_policy_details agent
        old_zip: Current ZIP
        new_zip: New ZIP
        old_zip_risk: Risk data from risk analyzer agent (old location)
        new_zip_risk: Risk data from risk analyzer agent (new location)
        premium_calculation: Calculation from premium calculator agent
        
    Returns:
        Dict containing:
        - formatted_report (natural language summary)
    """
    logger.info(f"[format_quote_comparison_core] Formatting quote comparison for policy {policy_number}")
    
    # Use data passed from previous agents (not re-fetching from DB)
    calc_data = premium_calculation.get("calculation", {})
    current_premium = policy_details.get("current_premium", 0)
    vehicle_display = f"{policy_details.get('vehicle_year')} {policy_details.get('vehicle_make')} {policy_details.get('vehicle_model')}"
    
    # Build natural language report using data from previous agents
    new_premium = calc_data.get("new_premium_monthly", 0)
    change_amount = calc_data.get("premium_change_amount", 0)
    change_percent = calc_data.get("premium_change_percent", 0)
    
    change_direction = "increase" if change_amount > 0 else "decrease"
    change_descriptor = "higher" if change_amount > 0 else "lower"
    
    old_risk_zone = calc_data.get("risk_zone_old", "Unknown")
    new_risk_zone = calc_data.get("risk_zone_new", "Unknown")
    
    old_city = old_zip_risk.get("city", "Unknown")
    old_state = old_zip_risk.get("state", "Unknown")
    new_city = new_zip_risk.get("city", "Unknown")
    new_state = new_zip_risk.get("state", "Unknown")
    
    # Build risk explanation
    old_theft = old_zip_risk.get("theft_rate", "Unknown")
    new_theft = new_zip_risk.get("theft_rate", "Unknown")
    old_collision = old_zip_risk.get("collision_frequency", "Unknown")
    new_collision = new_zip_risk.get("collision_frequency", "Unknown")
    
    risk_reason = ""
    if new_theft != old_theft:
        risk_reason = f"due to {change_descriptor} theft rates"
    if new_collision != old_collision:
        if risk_reason:
            risk_reason += f" and {change_descriptor} collision frequency"
        else:
            risk_reason = f"due to {change_descriptor} collision frequency"
    
    formatted_report = f"""
**Insurance Quote Comparison - Relocation from {old_zip} to {new_zip}**

Policy Number: {policy_number}
Vehicle: {vehicle_display}

**Current Coverage ({old_city}, {old_state} - {old_zip})**
- Risk Zone: {old_risk_zone}
- Monthly Premium: ${round(current_premium)}

**New Quote ({new_city}, {new_state} - {new_zip})**
- Risk Zone: {new_risk_zone}
- Monthly Premium: ${new_premium}

**Premium Change:**
Your premium will {change_direction} by ${abs(change_amount)}/month ({change_percent:+.1f}%) {risk_reason}.

**Next Steps:**
1. Review the quote above
2. Confirm your moving date to schedule the policy update
3. Update your vehicle registration with the new address
4. Notify us 30 days before the move to ensure continuous coverage

Questions? Contact our customer service team at 1-800-INS-URANCE.
""".strip()
    
    logger.info(f"[format_quote_comparison_core] Quote comparison formatted successfully")
    
    return {
        "success": True,
        "formatted_report": formatted_report,
        "message": "Quote comparison generated"
    }
