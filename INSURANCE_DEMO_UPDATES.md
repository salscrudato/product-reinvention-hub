# Insurance Quote Demo - Policy Selection & Agent Data Flow

## ✅ **What Changed**

### **User's Request:**
> "you cannot just unilaterally assume the user right ? you have to clarify to the user that there is 1 Auto policy for Honda CRV , 2010 with polNo 100001 and 2. Auto policy for Acura MDX, 2024  with pol no 100002 and user should be able to select one of those that then runs through above process where the policy no is used to query backend and show the data ....can we do this change appropriately? we need a tool to fetch policy details based on the pol no and only get what is needed to next agent in the process otherwise audience will immediately question its APIs orchestration not the Agents ...make it more natural"

### **Core Changes Made:**

####  **1. Updated Mock Data (2 Policies)**
- **Policy 100001**: 2010 Honda CR-V, $145/month, 145k miles, $8,500 value
- **Policy 100002**: 2024 Acura MDX, $285/month, 8,500 miles, $52,000 value
- Both owned by john.doe@email.com

#### **2. New Tool: `list_available_policies`**
Shows policy choices for user selection:
```json
{
  "policies": [
    {
      "policy_number": "100001",
      "vehicle_display": "2010 Honda CR-V",
      "current_premium": 145,
      "status": "Active"
    },
    {
      "policy_number": "100002",
      "vehicle_display": "2024 Acura MDX",
      "current_premium": 285,
      "status": "Active"
    }
  ]
}
```

#### **3. New Tool: `fetch_policy_details`**
Returns ONLY essential data (lean API pattern):
```json
{
  "policy_number": "100001",
  "current_zip": "60100",
  "current_premium": 145,
  "vehicle_year": 2010,
  "vehicle_make": "Honda",
  "vehicle_model": "CR-V"
}
```

**NO full policy dump** - just what next agent needs!

#### **4. Agent-to-Agent Data Passing**
Each tool now passes data to the next agent (no redundant DB calls):

**Old Way (Bad):**
```python
# Every tool re-fetches from DB
def calculate_premium(policy_number):
    policy = MOCK_POLICIES[policy_number]  # DB call
    old_zip = policy["location"]["zip"]     # Full object
    # ... do calculation
```

**New Way (Good):**
```python
# Uses data FROM previous agents
def calculate_premium(
    policy_number,
    current_premium,      # FROM fetch_policy_details agent
    old_zip,              # FROM fetch_policy_details agent
    new_zip,              # FROM user query
    old_zip_risk,         # FROM risk_analyzer agent
    new_zip_risk,         # FROM risk_analyzer agent
    vehicle_value         # FROM vehicle_valuation agent
):
    # NO DB calls - uses data passed from upstream agents!
    risk_ratio = new_zip_risk["base_factor"] / old_zip_risk["base_factor"]
    new_premium = current_premium * risk_ratio
    # ... calculate
```

#### **5. Updated Recipe Workflow**
```
OLD WORKFLOW:
1. fetch_policy_by_holder (assumes policy)
2. get_zip_risk_rating (old)
3. get_zip_risk_rating (new)
4. get_vehicle_details
5. calculate_premium (re-fetches policy!)
6. format_quote (re-fetches policy and risks!)

NEW WORKFLOW:
1. list_available_policies → Shows: "1. 2010 Honda CR-V (100001), 2. 2024 Acura MDX (100002)"
2. User selects policy number (e.g., "100001")
3. fetch_policy_details → Returns: {current_zip, current_premium, vehicle_details}
4. get_zip_risk_rating(old_zip) → Returns: {risk_zone, base_factor, collision_factor, ...}
5. get_zip_risk_rating(new_zip) → Returns: {risk_zone, base_factor, collision_factor, ...}
6. get_vehicle_details → Returns: {estimated_value, vehicle_age}
7. calculate_premium → Uses data from steps 3-6 (NO DB calls)
8. format_quote → Uses data from steps 3-7 (NO DB calls)
```

#### **6. Clarification Logic**
If user doesn't specify policy number:
```python
if not policy_number_in_query:
    # Return clarification with policy list
    return list_available_policies()
    # LLM sees: "I found 2 policies. Which one would you like a quote for?"
else:
    # User selected - proceed with full workflow
    proceed_with_quote()
```

---

## **Demo Flow**

### **Query 1: Initial Request (No Policy Selected)**
> "I'm moving from zip 60100 to 60501, can you help me get an insurance quote?"

**System Response:**
```
I found 2 active auto insurance policies for you:

1. **Policy 100001** - 2010 Honda CR-V ($145/month)
2. **Policy 100002** - 2024 Acura MDX ($285/month)

Which policy would you like me to quote for your move to ZIP code 60501?
```

### **Query 2: User Selection**
> "The Honda one" OR "Policy 100001"

**System Executes:**
```
[Step 1] fetch_policy_details(100001)
  → Output: {current_zip: "60100", current_premium: 145, vehicle: "2010 Honda CR-V"}
  
[Step 2] get_zip_risk_rating("60100")  
  → Output: {risk_zone: "Suburban-Low", base_factor: 0.85, ...}
  
[Step 3] get_zip_risk_rating("60501")
  → Output: {risk_zone: "Urban-Medium", base_factor: 1.15, ...}
  
[Step 4] get_vehicle_details(100001)
  → Output: {estimated_value: 8500, vehicle_age: 16}
  
[Step 5] calculate_premium(
    policy="100001",
    current_premium=145,        # FROM Step 1
    old_zip="60100",            # FROM Step 1
    new_zip="60501",            # FROM user query
    old_zip_risk={...},         # FROM Step 2
    new_zip_risk={...},         # FROM Step 3
    vehicle_value=8500          # FROM Step 4
)
  → Output: {new_premium: 187, change_amount: +42, change_percent: +29%}
  
[Step 6] format_quote_comparison(
    policy="100001",
    policy_details={...},       # FROM Step 1
    old_zip_risk={...},         # FROM Step 2
    new_zip_risk={...},         # FROM Step 3
    premium_calc={...}          # FROM Step 5
)
  → Output: Natural language report
```

**System Response:**
```
Insurance Quote Comparison - Relocation from 60100 to 60501

Policy Number: 100001
Vehicle: 2010 Honda CR-V

Current Coverage (Crystal Lake, IL - 60100)
- Risk Zone: Suburban-Low
- Monthly Premium: $145

New Quote (Summit, IL - 60501)
- Risk Zone: Urban-Medium
- Monthly Premium: $187

Premium Change:
Your premium will increase by $42/month (+29%) due to higher theft rates and higher collision frequency.

Next Steps:
1. Review the quote above
2. Confirm your moving date to schedule the policy update
3. Update your vehicle registration with the new address
4. Notify us 30 days before the move to ensure continuous coverage
```

---

## **Why This Is Better**

### ✅ **1. Natural User Interaction**
- System asks for clarification when needed
- User selects policy in natural language ("the Honda one")
- No assumptions made

### ✅ **2. Realistic API Orchestration**
- Each tool returns ONLY what next agent needs
- No full object dumps
- Demonstrates how real microservices would work

### ✅ **3. Agent-to-Agent Data Flow**
- Upstream agents pass data downstream
- NO redundant DB/API calls
- Shows true orchestration, not just tool calls

### ✅ **4. Scalable Pattern**
- Easy to add more policies
- Easy to add more selection criteria (year, type, etc.)
- Workflow adapts automatically

---

## **Files Modified**

1. **`backend/components/insurance_quote_tool.py`** - Recreated cleanly
   - Added `list_available_policies_core()`
   - Added `fetch_policy_details_core()` (lean data)
   - Updated `calculate_premium_core()` to accept agent data
   - Updated `format_quote_comparison_core()` to use agent data
   - Updated mock policies: 100001 (Honda CR-V 2010), 100002 (Acura MDX 2024)

2. **`backend/components/snowaaonetool.py`** - Updated tool registrations
   - Added `list_available_policies` tool
   - Added `fetch_policy_details` tool
   - Updated all 7 insurance tools with agent-data signatures

3. **`backend/components/plan_recipes.py`** - Updated recipe & extractors
   - Added `_extract_policy_number()` helper
   - Added `_args_insurance_policy_list()` extractor
   - Added `_args_insurance_policy_details()` extractor (returns None if not selected)
   - Updated all insurance extractors to use agent data from `tool_outputs`
   - Updated `insurance_quote_request` recipe to 7 steps with clarification
   - Added clarification logic in `build_recipe()`

---

## **Testing**

### **Start Backend:**
```powershell
cd c:\dev\snowchat\backend
python app.py
```

### **Test Query 1 (No policy):**
> "I'm moving from 60100 to 60501, help me get an insurance quote"

**Expected:** System lists 2 policies and asks user to select

### **Test Query 2 (After selection):**
> "The Honda one" OR "Policy 100001"

**Expected:** Full quote with premium calculation ($145 → $187, +29%)

### **Watch Logs For:**
```
[list_available_policies_core] Found 2 policies
[fetch_policy_details_core] Retrieved policy 100001: 2010 Honda CR-V, $145/mo
[get_zip_risk_rating_core] Found: Crystal Lake, IL - Suburban-Low
[get_zip_risk_rating_core] Found: Summit, IL - Urban-Medium
[get_vehicle_details_core] Vehicle age: 16 years, value: $8500
[calculate_premium_core] Premium change: $145 → $187 (+29.0%)
[format_quote_comparison_core] Quote comparison formatted successfully
```

**NO logs showing redundant DB fetches!**

---

##  **Summary**

This update transforms the insurance demo from a simplistic "mock API" into a realistic **agent-to-agent orchestration** showcasing:
- User clarification workflow (list → select → execute)
- Lean API design (only essential data returned)
- True agent chaining (upstream data flows downstream)
- Zero redundant calls (each agent uses previous agents' outputs)

**This is exactly what will impress stakeholders** - showing the framework enables real microservice orchestration patterns, not just toy demos!
