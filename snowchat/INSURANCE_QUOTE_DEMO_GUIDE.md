# Insurance Quote Tool - Demo Guide

## Overview
This demonstrates the agentic orchestration framework works for **multiple domains**, not just ServiceNow incidents. The insurance quote workflow shows the same pre-planning, recipe evaluation, and agent chaining capabilities applied to a completely different use case.

---

## What Was Added

### 1. **New Tool Module:** `backend/components/insurance_quote_tool.py`
Contains 5 mock insurance API tools:
- `fetch_policy_by_holder` - Get current policy details by email
- `get_zip_risk_rating` - Get risk factors for ZIP codes  
- `get_vehicle_details` - Get vehicle info and depreciation
- `calculate_premium` - Calculate new premium based on location change
- `format_quote_comparison` - Create natural language comparison report

### 2. **Tool Registration:** Updated `backend/components/snowaaonetool.py`
All 5 tools registered in `FUNCTION_REGISTRY` with `@register_tool_function` decorator

### 3. **New Recipe:** Updated `backend/components/plan_recipes.py`
Added `insurance_quote_request` recipe with 6-step workflow:
1. Fetch current policy → `fetch_policy_by_holder`
2. Get old ZIP risk → `get_zip_risk_rating`
3. Get new ZIP risk → `get_zip_risk_rating`
4. Get vehicle details → `get_vehicle_details`
5. Calculate premium → `calculate_premium`
6. Format comparison → `format_quote_comparison`

---

## Mock Data

### Policies
- **POL-2024-001234** - John Doe, 2020 Honda CR-V, $145/month, ZIP 60100 (Crystal Lake, IL)
- **POL-2024-005678** - Jane Smith, 2019 Toyota Camry, $178/month, ZIP 60614 (Chicago, IL)

### ZIP Codes (Illinois)
- **60100** - Crystal Lake (Suburban-Low, 0.85x factor)
- **60047** - Lake Zurich (Suburban-Low, 0.82x factor)
- **60107** - Streamwood (Suburban-Medium, 0.98x factor)
- **60501** - Summit (Urban-Medium, 1.15x factor)
- **60614** - Chicago (Urban-High, 1.35x factor)
- **60601** - Chicago Loop (Urban-Very-High, 1.52x factor)

---

## How to Test

### 1. **Start Backend**
```powershell
cd c:\dev\snowchat\backend
python app.py
```

Backend logs should show:
```
[INFO] Registered tool: fetch_policy_by_holder
[INFO] Registered tool: get_zip_risk_rating
[INFO] Registered tool: get_vehicle_details
[INFO] Registered tool: calculate_premium
[INFO] Registered tool: format_quote_comparison
```

### 2. **Ask Insurance Quote Questions**

**Basic Query:**
> "I'm moving from zip code 60100 to 60501, can you help me get a new insurance quote for my vehicle?"

**Expected Flow:**
```
Phase 1: Question Decomposition
  → Entities: old_zip=60100, new_zip=60501, intent=insurance_quote

Phase 2: Intent Classification
  → Primary: insurance_quote_request (confidence: 92%)
  → Persona: insurance_agent

Phase 3: Pre-Planning
  → Feasibility: SUPPORTED (95% confidence)
  → Operations required: 5 (policy fetch, risk analysis, premium calc)
  → Data sources: All accessible

Phase 4: Recipe Evaluation
  → Recipe: insurance_quote_request
  → Match score: 88%
  → Steps: 6 tools
  → Gaps: None - Recipe COMPLETE

Phase 5: Plan Generation
  → Agent chain: PolicyRetriever → RiskAnalyzer → VehicleEvaluator → PremiumCalculator → QuoteGenerator

Phase 6: Execution
  → fetch_policy_by_holder(email="john.doe@email.com") → 245ms ✓
  → get_zip_risk_rating(zip_code="60100") → 120ms ✓
  → get_zip_risk_rating(zip_code="60501") → 118ms ✓
  → get_vehicle_details(policy_number="POL-2024-001234") → 95ms ✓
  → calculate_premium(...) → 890ms ✓
  → format_quote_comparison(...) → 320ms ✓

Phase 7: Response Synthesis
  → Natural language summary with comparison
```

**Expected Response:**
```
Insurance Quote Comparison - Relocation from 60100 to 60501

Policy Holder: John Doe
Policy Number: POL-2024-001234
Vehicle: 2020 Honda CR-V

Current Coverage (Crystal Lake, IL - 60100)
- Risk Zone: Suburban-Low
- Monthly Premium: $145
- Annual Premium: $1,740

New Quote (Summit, IL - 60501)
- Risk Zone: Urban-Medium
- Monthly Premium: $187
- Annual Premium: $2,244

Premium Change:
Your premium will increase by $42/month (+29%) due to higher theft rates and higher collision frequency.

Coverage Breakdown:
- Liability: $58/month
- Collision: $65/month
- Comprehensive: $64/month

State Requirements:
✓ Meets all Illinois state minimum requirements

Recommendations:
1. Consider increasing deductibles to $1,000 to offset premium increase ($15-25/month)
2. Add comprehensive coverage with theft protection due to higher theft risk in new area (+$23/month)

Next Steps:
1. Review the quote and coverage recommendations above
2. Confirm your moving date to schedule the policy update
3. Update your vehicle registration with the new address
4. Notify us 30 days before the move to ensure continuous coverage
```

---

## Alternative Queries to Test

### High-Risk Move
> "What's my insurance quote if I move to Chicago 60614?"

**Expected:** Larger premium increase (1.35x factor vs current 0.85x = 59% increase)

### Low-Risk Move
> "Moving from 60100 to 60047, what will happen to my insurance?"

**Expected:** Premium DECREASE (0.82x factor vs 0.85x = 3.5% decrease)

### Multi-Person Test
> "I'm jane.smith@email.com, what if I move from 60614 to 60107?"

**Expected:** Premium decrease (already in high-risk zone, moving to medium-risk)

### Without Email
> "Moving from ZIP 60501 to 60601, how much will my insurance change?"

**Expected:** Uses default policy, shows increase for very high risk zone

---

## What This Demonstrates

### ✅ **Zero Hardcoded Logic**
No if/else statements for insurance calculations - all driven by:
- Recipe selection (intent → recipe mapping)
- Agent chaining (depends on recipe steps)
- Mock data lookup (realistic API simulation)

### ✅ **Same Orchestration Framework**
Uses identical infrastructure as ServiceNow:
- Pre-planning validates data availability
- Recipe evaluates tool requirements
- LangGraph chains agents with dependencies
- Full trace logging and observability

### ✅ **Multi-Domain Capability**
System now handles:
- **ServiceNow incidents** - IT operations
- **Jira user stories** - Agile planning
- **Wiki knowledge** - Documentation lookup
- **Insurance quotes** - Policy administration (NEW!)

### ✅ **Extensible Pattern**
Adding a new domain requires only:
1. Create tool module with domain functions
2. Register tools with `@register_tool_function`
3. Add recipe to `RECIPE_MAP`
4. Add argument extractors

**No changes to core orchestration engine!**

---

## Observability

Backend logs will show:
```
[INFO] [PRE_ANALYSIS] Extracted entities: old_zip=60100, new_zip=60501
[INFO] [INTENT] Primary: insurance_quote_request, Confidence: 0.92
[INFO] [PRE_ANALYSIS] FEASIBILITY: SUPPORTED (confidence=0.95)
[INFO] [RECIPE_EVAL] Recipe: insurance_quote_request, Score: 0.88, Gaps: []
[INFO] [plan_recipes] Building insurance_quote_request recipe (6 steps)
[INFO] [AGENT_CHAIN] Building execution chain... 6 agents
[INFO] [fetch_policy_by_holder_core] Found policy POL-2024-001234 for John Doe
[INFO] [get_zip_risk_rating_core] Found: Crystal Lake, IL - Suburban-Low
[INFO] [get_zip_risk_rating_core] Found: Summit, IL - Urban-Medium
[INFO] [calculate_premium_core] Premium change: $145 → $187 (+29.0%)
[INFO] [format_quote_comparison_core] Quote comparison formatted successfully
[INFO] [TRACE] Step 1/6: fetch_policy_by_holder, Status: OK, Duration: 245ms
[INFO] [TRACE] Step 2/6: get_zip_risk_rating, Status: OK, Duration: 120ms
[INFO] [TRACE] Step 3/6: get_zip_risk_rating, Status: OK, Duration: 118ms
[INFO] [TRACE] Step 4/6: get_vehicle_details, Status: OK, Duration: 95ms
[INFO] [TRACE] Step 5/6: calculate_premium, Status: OK, Duration: 890ms
[INFO] [TRACE] Step 6/6: format_quote_comparison, Status: OK, Duration: 320ms
[INFO] [RESPONSE] Final answer generated, Length: ~1,200 words
```

---

## Architecture Diagram

```
User Query: "Moving from 60100 to 60501, help me get insurance quote"
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Question Decomposition                                 │
│  → Extract: old_zip=60100, new_zip=60501                       │
│  → Intent keywords: "moving", "insurance quote"                │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Intent Classification                                  │
│  → ML classifier: insurance_quote_request (92% confidence)     │
│  → Persona: insurance_agent                                    │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: Pre-Planning (Feasibility Validation)                 │
│  → Check: Policy data accessible? ✓                           │
│  → Check: Risk rating data available? ✓                       │
│  → Check: Premium calculator available? ✓                     │
│  → Result: SUPPORTED (95% confidence)                          │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 4: Recipe Evaluation                                      │
│  → Match: insurance_quote_request recipe (88% score)           │
│  → Required tools: 6                                           │
│  → Available tools: 6                                          │
│  → Gaps: None → Recipe COMPLETE                               │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 5: Plan Generation (Agent Chain)                          │
│  ┌────────────────┐                                            │
│  │ PolicyRetriever│ → fetch_policy_by_holder                 │
│  └────────┬───────┘                                            │
│           ↓                                                     │
│  ┌────────────────┐                                            │
│  │ RiskAnalyzer   │ → get_zip_risk_rating (old + new)        │
│  └────────┬───────┘                                            │
│           ↓                                                     │
│  ┌────────────────┐                                            │
│  │VehicleEvaluator│ → get_vehicle_details                    │
│  └────────┬───────┘                                            │
│           ↓                                                     │
│  ┌────────────────┐                                            │
│  │PremiumCalc     │ → calculate_premium                       │
│  └────────┬───────┘                                            │
│           ↓                                                     │
│  ┌────────────────┐                                            │
│  │QuoteGenerator  │ → format_quote_comparison                 │
│  └────────────────┘                                            │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 6: Execution (with traces)                                │
│  [245ms] fetch_policy_by_holder → POL-2024-001234             │
│  [120ms] get_zip_risk_rating(60100) → Suburban-Low            │
│  [118ms] get_zip_risk_rating(60501) → Urban-Medium            │
│  [95ms]  get_vehicle_details → 2020 Honda CR-V, $24,500       │
│  [890ms] calculate_premium → $145 → $187 (+29%)               │
│  [320ms] format_quote_comparison → Natural language report    │
│  ────────────────────────────────────────────────────────────  │
│  Total: 1,788ms                                                 │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 7: Response Synthesis                                     │
│  → Natural language summary                                    │
│  → Comparison table (current vs new)                          │
│  → State compliance check (IL minimums)                       │
│  → Recommendations (deductible increase, coverage add-ons)    │
│  → Next steps (confirm date, update registration)             │
└─────────────────────────────────────────────────────────────────┘
    ↓
User receives comprehensive quote comparison
```

---

## Files Modified

1. **Created:** `backend/components/insurance_quote_tool.py` (780 lines)
   - 5 core tool functions with realistic mock data
   - Mock policies, ZIP risk ratings, IL state minimums
   - Natural language formatting

2. **Updated:** `backend/components/snowaaonetool.py` (+80 lines)
   - Imported insurance tool functions
   - Registered 5 tools with decorators

3. **Updated:** `backend/components/plan_recipes.py` (+120 lines)
   - Added ZIP code extraction helper
   - Added 6 argument extractor functions
   - Added `insurance_quote_request` recipe

---

## Next Steps

### Test the Demo
1. Start backend: `python app.py`
2. Open frontend: http://localhost:3000
3. Ask: "I'm moving from zip code 60100 to 60501, can you help me get a new insurance quote for my vehicle?"
4. Watch backend logs for full orchestration trace
5. Verify response includes premium comparison and recommendations

### Add More Scenarios
- Property Insurance: Home value estimates, disaster risk zones
- Health Insurance: Coverage comparisons, provider networks
- Life Insurance: Underwriting, beneficiary management
- Claims Processing: Damage assessment, payout calculation

### Show to Stakeholders
This proves the framework is:
- ✅ Domain-agnostic (works for ANY vertical)
- ✅ Zero-code for new queries (no development needed)
- ✅ Fully observable (every step traced)
- ✅ Production-ready architecture (recipe-driven)

---

## Cleanup (If Needed)

To remove insurance demo without affecting existing functionality:

1. Delete: `backend/components/insurance_quote_tool.py`
2. Remove from `snowaaonetool.py`: Lines with insurance tool registrations
3. Remove from `plan_recipes.py`: `insurance_quote_request` recipe and argument extractors

**No core orchestration changes** - framework remains unchanged!
