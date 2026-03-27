from components.plan_recipes import build_recipe


def test_login_governance_recipe_sequences_plan_receipt():
    question = "Audit login governance for IN-201 entitlements"
    metadata = {"persona": "business_owner", "intent": "login_governance", "jira_issue_key": "IN-201"}
    recipe = build_recipe("login_governance", "business_owner", question, metadata)
    assert recipe, "Expected recipe for login_governance intent"
    tools = [step.get("tool") for step in recipe]
    assert tools[:2] == ["jira_fetch_user_story", "jira_summarize_user_story"]
    assert tools[-1] == "generate_plan_receipt"
    receipt_args = recipe[-1].get("args", {})
    assert receipt_args.get("persona") == "business_owner"
    assert receipt_args.get("intent") == "login_governance"
    assert receipt_args.get("jira_issue_key") == "IN-201"
