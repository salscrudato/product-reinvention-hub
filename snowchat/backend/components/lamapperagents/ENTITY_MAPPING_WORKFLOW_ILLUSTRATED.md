# Data Mapper Entity Review Workflow - Illustrated Guide

## Current Problem
✅ Backend extracts entities successfully
❌ No way for users to review/approve/edit extracted mappings
❌ Entities stored but never shown to user for validation

---

## Proposed Workflow with Test Data

### Step 1: User Asks Question
```
User: "I need customer name and billing address"
```

### Step 2: Backend Extracts Entities
```json
{
  "entities": [
    {
      "entity_name": "customer name",
      "business_definition": "Full legal name of the customer as it appears on official documents",
      "tables": ["customer_master", "customer_profile"],
      "columns": ["first_name", "middle_name", "last_name"],
      "population_logic": "CONCAT(first_name, ' ', COALESCE(middle_name + ' ', ''), last_name)",
      "conditions": [
        "WHERE customer_status = 'ACTIVE'",
        "AND record_type = 'PRIMARY'"
      ],
      "test_data": [
        {"value": "John Alexander Doe", "row_id": 1001, "source_table": "customer_master"},
        {"value": "Jane Marie Smith", "row_id": 1002, "source_table": "customer_master"},
        {"value": "Robert Lee Johnson", "row_id": 1003, "source_table": "customer_master"}
      ],
      "status": "pending",
      "confidence": 0.92,
      "sources": ["requirements_v2.3.docx", "data_dictionary.xlsx", "customer_test_cases.xlsx"],
      "agent_contributions": {
        "Business Analyst": ["business_definition", "sources"],
        "Data Consultant": ["tables", "columns", "population_logic", "conditions"],
        "Tester": ["test_data"]
      },
      "validation_notes": [
        "✅ Found in 3 knowledge sources",
        "⚠️  Middle name is optional (COALESCE used)",
        "✅ Test data matches pattern"
      ]
    },
    {
      "entity_name": "billing address",
      "business_definition": "Complete mailing address for billing purposes including street, city, state, and ZIP code",
      "tables": ["customer_billing", "address_master"],
      "columns": ["street_address", "city", "state", "zip_code"],
      "population_logic": "CONCAT(street_address, ', ', city, ', ', state, ' ', zip_code)",
      "conditions": [
        "WHERE address_type = 'BILLING'",
        "AND is_primary = 1",
        "AND effective_date <= CURRENT_DATE",
        "AND (expiration_date IS NULL OR expiration_date > CURRENT_DATE)"
      ],
      "test_data": [
        {"value": "123 Main St, Springfield, IL 62701", "row_id": 2001, "source_table": "customer_billing"},
        {"value": "456 Oak Ave, Portland, OR 97204", "row_id": 2002, "source_table": "customer_billing"},
        {"value": "789 Pine Rd, Austin, TX 78701", "row_id": 2003, "source_table": "customer_billing"}
      ],
      "status": "needs_review",
      "confidence": 0.78,
      "sources": ["requirements_v2.3.docx", "data_dictionary.xlsx"],
      "agent_contributions": {
        "Business Analyst": ["business_definition"],
        "Data Consultant": ["tables", "columns", "population_logic", "conditions"],
        "Tester": ["test_data"]
      },
      "validation_notes": [
        "⚠️  Confidence below 85% - review recommended",
        "⚠️  Multiple active address types found",
        "✅ Test data format validated"
      ]
    }
  ]
}
```

---

## UI Display Options

### Option A: Inline Entity Cards in Chat (Recommended)

```
┌─────────────────────────────────────────────────────────────────┐
│ Chat Interface                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  👤 You  5:44:50 PM                                              │
│  I need customer name and billing address                        │
│                                                                   │
│  ⚙️ System  5:44:50 PM                                           │
│  Initializing agentic orchestration...                           │
│                                                                   │
│  🤖 AI Consultant  5:44:52 PM                                    │
│  ✅ Extracted 2 entity mappings. Review below:                   │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 📋 Entity: customer name                 ⭐ 92% confidence │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │ Business Definition:                                       │  │
│  │ Full legal name of the customer as it appears on          │  │
│  │ official documents                                         │  │
│  │                                                            │  │
│  │ 📊 Data Source:                                           │  │
│  │ Tables: customer_master, customer_profile                 │  │
│  │ Columns: first_name, middle_name, last_name              │  │
│  │                                                            │  │
│  │ 🔧 Population Logic:                                      │  │
│  │ CONCAT(first_name, ' ', COALESCE(middle_name + ' ', ''), │  │
│  │        last_name)                                          │  │
│  │                                                            │  │
│  │ 📝 Conditions:                                            │  │
│  │ • WHERE customer_status = 'ACTIVE'                        │  │
│  │ • AND record_type = 'PRIMARY'                             │  │
│  │                                                            │  │
│  │ 🧪 Test Data:                                             │  │
│  │ • John Alexander Doe (row 1001)                           │  │
│  │ • Jane Marie Smith (row 1002)                             │  │
│  │ • Robert Lee Johnson (row 1003)                           │  │
│  │                                                            │  │
│  │ 📚 Sources: requirements_v2.3.docx, data_dictionary.xlsx │  │
│  │                                                            │  │
│  │ ✅ Validated  ⚠️ Needs Review  • • •  More                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 📋 Entity: billing address           ⚠️ 78% confidence    │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │ Business Definition:                                       │  │
│  │ Complete mailing address for billing purposes including   │  │
│  │ street, city, state, and ZIP code                         │  │
│  │                                                            │  │
│  │ 📊 Data Source:                                           │  │
│  │ Tables: customer_billing, address_master                  │  │
│  │ Columns: street_address, city, state, zip_code           │  │
│  │                                                            │  │
│  │ 🔧 Population Logic:                                      │  │
│  │ CONCAT(street_address, ', ', city, ', ', state, ' ',     │  │
│  │        zip_code)                                           │  │
│  │                                                            │  │
│  │ ⚠️ Review Needed:                                         │  │
│  │ • Confidence below 85%                                    │  │
│  │ • Multiple active address types found                     │  │
│  │                                                            │  │
│  │ ✅ Approve  ✏️ Edit  ❌ Reject                            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  💬 Ask a question or say "approve all" to continue              │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

### Option B: Side Panel with Entity Cards

```
┌──────────────────────────┬──────────────────────────────────────┐
│ Chat (60%)               │ Extracted Entities (40%)             │
├──────────────────────────┼──────────────────────────────────────┤
│ 👤 You                   │ 📋 Pending Review (2)                │
│ I need customer name     │                                       │
│                          │ ┌────────────────────────────────┐   │
│ 🤖 AI Consultant         │ │ ✅ customer name               │   │
│ ✅ Extracted 2 entities  │ │ Confidence: 92%                │   │
│                          │ │ Status: Ready                  │   │
│                          │ │                                │   │
│                          │ │ Tables: customer_master        │   │
│                          │ │ Columns: first_name, last_name │   │
│                          │ │                                │   │
│                          │ │ [View Details] [✓ Approve]     │   │
│                          │ └────────────────────────────────┘   │
│                          │                                       │
│                          │ ┌────────────────────────────────┐   │
│                          │ │ ⚠️ billing address             │   │
│                          │ │ Confidence: 78%                │   │
│                          │ │ Status: Needs Review           │   │
│                          │ │                                │   │
│                          │ │ Tables: customer_billing       │   │
│                          │ │ Columns: street_address, city  │   │
│                          │ │                                │   │
│                          │ │ [View Details] [Edit] [Reject] │   │
│                          │ └────────────────────────────────┘   │
│                          │                                       │
│                          │ [Approve All] [Export]               │
└──────────────────────────┴──────────────────────────────────────┘
```

---

### Option C: Modal Review Dialog (Batch Review)

```
┌─────────────────────────────────────────────────────────────────┐
│ Review Extracted Entities                                    × │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│ 2 entities extracted from: "I need customer name and billing    │
│ address"                                                         │
│                                                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 1/2  customer name                          ⭐ 92% Ready    │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │                                                              │ │
│ │ Definition: Full legal name of customer...                  │ │
│ │ Tables: customer_master, customer_profile                   │ │
│ │ Logic: CONCAT(first_name, ' ', last_name)                   │ │
│ │                                                              │ │
│ │ Test Data Preview:                                          │ │
│ │ • John Alexander Doe                                        │ │
│ │ • Jane Marie Smith                                          │ │
│ │ • Robert Lee Johnson                                        │ │
│ │                                                              │ │
│ │ [✓] Approve   [Edit]   [Skip]                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ [← Previous]  [Next →]  [Approve All 2]  [Cancel]              │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Interaction Flow with Natural Language

### Conversation Example:

```
User: "I need customer name and email address"

System: "Initializing orchestration..."

AI Consultant: "✅ Extracted 2 entities. Here's what I found:"

[Entity Card 1: customer name - 92% confidence]
[Entity Card 2: email address - 88% confidence]

System: "Would you like to approve these mappings, or should I refine them?"

User: "The customer name looks good but I'm not sure about email"

AI Consultant: "I've approved 'customer name'. Would you like me to:"
• Show more details about email address mapping?
• Search for alternative email fields?
• Edit the email definition?"

User: "Show more details about email"

AI Consultant: "Here's the detailed mapping for email address:
📊 Tables: customer_contact, email_master
📝 Logic: Uses primary_email where contact_type='EMAIL'
🧪 Test Data: john.doe@email.com, jane.smith@email.com
📚 Found in: data_dictionary.xlsx, API_specification.yaml

Validation Notes:
✅ Primary key relationship verified
⚠️  Some records have multiple email addresses
✅ Format validated (contains @)

Would you like to approve this or make edits?"

User: "Approve both"

AI Consultant: "✅ Approved 2 entity mappings:
• customer name → CONCAT(first_name, ' ', last_name)
• email address → primary_email from customer_contact

These mappings are now stored and ready for code generation. Would you like to:
• Extract more entities?
• Export these mappings?
• Generate SQL code?"
```

---

## User Actions Available

### 1. Approve Entity
```
User: "approve customer name"
User: "looks good"  
User: "approve all"
User: "✓" (in chat or button)
```

**Backend Action:**
- Updates entity status: `pending` → `approved`
- Stores in `state_db.json` mapper_conversations
- Makes available for code generation

---

### 2. Request More Details
```
User: "show me more about billing address"
User: "what tables are used for customer name?"
User: "can you show test data?"
```

**Backend Response:**
```json
{
  "entity_name": "customer name",
  "expanded_details": {
    "table_relationships": [
      {
        "table": "customer_master",
        "join_type": "LEFT",
        "join_condition": "customer_id",
        "columns_used": ["first_name", "middle_name", "last_name"]
      },
      {
        "table": "customer_profile", 
        "join_type": "INNER",
        "join_condition": "customer_id",
        "columns_used": ["preferred_name"]
      }
    ],
    "business_rules": [
      "Always use legal name from customer_master",
      "Fallback to preferred_name if legal name is NULL",
      "Middle name is optional"
    ],
    "test_coverage": {
      "total_test_cases": 15,
      "passing": 14,
      "failing": 1,
      "edge_cases": ["NULL middle name", "Special characters in name"]
    },
    "data_quality": {
      "completeness": "98.5%",
      "null_percentage": "1.5%",
      "duplicate_check": "No duplicates found"
    }
  }
}
```

---

### 3. Edit Entity
```
User: "edit the customer name logic"
User: "change billing address to use mailing table instead"
User: "add a condition to customer name"
```

**UI Shows Edit Form:**
```
┌─────────────────────────────────────────────────────────┐
│ Edit Entity: customer name                              │
├─────────────────────────────────────────────────────────┤
│ Business Definition:                                     │
│ [Full legal name of customer...                    ]   │
│                                                          │
│ Tables: [✓ customer_master] [✓ customer_profile]       │
│         [ ] customer_history                            │
│                                                          │
│ Columns:                                                 │
│ [✓ first_name] [✓ middle_name] [✓ last_name]          │
│ [✓ preferred_name as fallback]                         │
│                                                          │
│ Population Logic:                                        │
│ [CONCAT(first_name, ' ',                          ]    │
│ [      COALESCE(middle_name + ' ', ''),          ]    │
│ [      last_name)                                  ]    │
│                                                          │
│ Conditions:                                              │
│ + Add condition                                          │
│ [WHERE customer_status = 'ACTIVE'              ][×]    │
│ [AND record_type = 'PRIMARY'                   ][×]    │
│                                                          │
│ [Save Changes] [Cancel] [Test Query]                   │
└─────────────────────────────────────────────────────────┘
```

---

### 4. Reject Entity
```
User: "reject billing address"
User: "that's wrong"
User: "skip this one"
```

**Backend Action:**
- Updates status: `pending` → `rejected`
- Logs rejection reason
- Optionally asks: "Would you like me to search for alternative definitions?"

---

### 5. Refine with Context References
```
User: "I need customer name"
[System extracts customer name]

User: "add email to that"  ← Uses memory!
[System resolves "that" → customer name context]
[System extracts email and associates with customer name]

User: "actually use the contact table for those two"
[System updates both customer name and email table references]
```

---

## Complete Entity Mapping Example with ALL Fields

```json
{
  "entity_name": "policy effective date",
  "entity_id": "entity_20260220_001",
  "business_definition": "The date when an insurance policy becomes active and coverage begins. Must be a future date at policy creation time.",
  
  "technical_specification": {
    "tables": [
      {
        "name": "policy_master",
        "alias": "pm",
        "columns": ["effective_date", "policy_id", "policy_status"],
        "is_primary": true
      },
      {
        "name": "policy_history",
        "alias": "ph", 
        "columns": ["effective_date_original", "change_reason"],
        "is_primary": false
      }
    ],
    
    "population_logic": {
      "sql": "COALESCE(pm.effective_date, ph.effective_date_original)",
      "explanation": "Uses current effective date from policy_master, falls back to original date from history if current is NULL",
      "edge_cases": [
        "If both are NULL, return policy creation date",
        "If effective_date is past date and status='PENDING', flag as error"
      ]
    },
    
    "join_conditions": [
      "policy_history ph ON pm.policy_id = ph.policy_id AND ph.version = 1"
    ],
    
    "where_conditions": [
      "pm.policy_status IN ('ACTIVE', 'PENDING')",
      "pm.effective_date IS NOT NULL",
      "pm.effective_date <= DATEADD(year, 1, GETDATE())"
    ]
  },
  
  "test_data": {
    "samples": [
      {
        "value": "2026-03-01",
        "row_id": 5001,
        "source_table": "policy_master",
        "context": "New policy effective next month",
        "validation": "✅ Future date, within 1 year"
      },
      {
        "value": "2026-01-15", 
        "row_id": 5002,
        "source_table": "policy_master",
        "context": "Policy effective last month",
        "validation": "✅ Recent past date, policy active"
      },
      {
        "value": "2025-12-01",
        "row_id": 5003,
        "source_table": "policy_history",
        "context": "Historical policy, using original date",
        "validation": "✅ Falls back to history table"
      }
    ],
    "edge_case_tests": [
      {
        "scenario": "NULL effective_date",
        "expected_behavior": "Use policy_creation_date as fallback",
        "test_result": "PASS"
      },
      {
        "scenario": "effective_date > 1 year in future",
        "expected_behavior": "Flag warning - may be data entry error",
        "test_result": "PASS"
      }
    ],
    "test_statistics": {
      "total_rows_tested": 1500,
      "null_count": 3,
      "invalid_format_count": 0,
      "out_of_range_count": 2
    }
  },
  
  "data_quality": {
    "completeness": 99.8,
    "accuracy_score": 98.5,
    "consistency_check": "PASS",
    "issues": [
      {
        "severity": "LOW",
        "description": "2 records have effective_date > 1 year in future",
        "recommended_action": "Review with business analyst"
      }
    ]
  },
  
  "business_rules": [
    "Policy effective date must be >= application date",
    "Cannot be more than 1 year in the future",
    "If policy status is ACTIVE, effective_date must be <= current date",
    "For renewal policies, must be after previous policy expiration"
  ],
  
  "validation_notes": [
    "✅ Found in 3 knowledge sources",
    "✅ Date format validated across all test data",
    "✅ Business rules implemented in WHERE clause",
    "⚠️  2 outlier records found (> 1 year future) - flagged for review",
    "✅ NULL handling strategy defined"
  ],
  
  "sources": [
    {
      "name": "insurance_requirements_v3.docx",
      "section": "Policy Lifecycle - Effective Date Rules",
      "confidence": 0.95
    },
    {
      "name": "data_dictionary_insurance.xlsx",
      "sheet": "Policy Tables",
      "row": 47,
      "confidence": 0.98
    },
    {
      "name": "policy_test_cases.xlsx",
      "test_count": 12,
      "confidence": 0.85
    }
  ],
  
  "agent_contributions": {
    "Business Analyst": {
      "fields": ["business_definition", "business_rules"],
      "sources_used": ["insurance_requirements_v3.docx"],
      "confidence": 0.95
    },
    "Data Consultant": {
      "fields": ["tables", "columns", "population_logic", "where_conditions"],
      "sources_used": ["data_dictionary_insurance.xlsx", "database_schema"],
      "confidence": 0.92
    },
    "Tester": {
      "fields": ["test_data", "edge_case_tests", "data_quality"],
      "sources_used": ["policy_test_cases.xlsx"],
      "confidence": 0.88
    }
  },
  
  "metadata": {
    "created_at": "2026-02-20T17:44:52Z",
    "created_by": "user@company.com",
    "conversation_id": "conv_1740051892_xyz789",
    "extraction_method": "crewai_hierarchical",
    "llm_calls": 3,
    "processing_time_ms": 2850,
    "version": 1
  },
  
  "status": "needs_review",
  "confidence": 0.85,
  "review_required_reason": "Confidence below 90% threshold due to outlier records"
}
```

---

## Recommended Implementation: **Option A + Natural Language**

✅ **Why This Works Best:**

1. **No context switching** - Everything in one conversation view
2. **Natural interaction** - Users can say "approve that", "edit billing address"
3. **Memory-enabled** - Backend resolves "that", "those entities", "the mapping"
4. **Progressive disclosure** - Collapsed cards, expand for details
5. **Follows chat pattern** - Users already comfortable with chat UI

---

## Implementation in AgenticMode.tsx

Add this component to display entity cards inline: