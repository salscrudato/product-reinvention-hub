# Context Layering Design for Mapping Quality Improvement

## Problem Statement

**Current Issue:** Embedding similarity between target and source fields suffers from context asymmetry:
- **Target fields** have rich context (endnotes, location, instructions) but embeddings don't fully leverage it
- **Source fields** have minimal context (just column names) leading to poor semantic matching
- **Business context** from UI (custom mapping project context) is not used in embeddings or LLM prompts
- **No layered approach** - context is flat rather than hierarchical

**Impact:**
- Semantically equivalent fields (e.g., "DUE DATE" vs "dueDate") score low similarity (~0.42 instead of ~0.85+)
- Business rules and domain knowledge from Word endnotes unused in matching
- User-provided project context in mapper UI ignored during synthesis
- LLM sees disconnected field pairs instead of holistic business scenario

**Field Detection Limitations:**
- Field identification is **purely regex-based** (detects `<PLACEHOLDER>` and `[FIELD]` patterns only)
- **No semantic understanding** during detection - treats `<FIELD1>` same as `<POLICY NUMBER>`
- Fields detected from poorly formatted documents lack intrinsic context (label = placeholder)
- Embeddings generated **immediately after parsing**, before user can validate/enrich context

---

## Detection Architecture: Regex-Based Field Extraction

### **How Fields Are Currently Detected**

**Regex Patterns** (`parsers.py` lines 75-76):
```python
_ANGLE_PLACEHOLDER_PATTERN = re.compile(r"<[^<>]+>")           # Matches <ANYTHING>
_BRACKET_PLACEHOLDER_PATTERN = re.compile(r"\[[^\[\]\r\n]+?\]") # Matches [ANYTHING]
```

**What Gets Captured:**
- ✅ Placeholder token (e.g., `<POLICY NUMBER>`)
- ✅ Surrounding paragraph text as "label" (e.g., "Enter the insured's policy number: <POLICY NUMBER>")
- ✅ Document location (paragraph index, table coordinates)
- ✅ Classification (heading, paragraph, table_cell, required/optional)
- ✅ Endnote references (if superscript numbers follow placeholder)

**Context Quality Depends on Document Formatting:**

| Document Quality | Example | Label Extraction | Embedding Quality |
|-----------------|---------|------------------|-------------------|
| **Excellent** | "Insured's Social Security Number (for tax reporting): <SSN>" | Rich semantic context | High similarity (0.80+) |
| **Good** | "Policy Number: <POLICY_NUM>" | Brief but meaningful | Medium similarity (0.60+) |
| **Fair** | Table cell with `<FIELD3>` but column header "Date of Birth" | Header text captured | Medium similarity (0.50+) |
| **Poor** | Bare `<FIELD1>` on its own line | Label = placeholder | Low similarity (0.20-) ❌ |

**Example - Well-Formatted Document:**
```
Please provide the following information:
1. Applicant's full legal name: <APPLICANT NAME>
2. Date of birth (MM/DD/YYYY): <DOB>
3. Annual income from employment: <ANNUAL INCOME>
```

**Extracted Context:**
- `<APPLICANT NAME>` label: "Applicant's full legal name: <APPLICANT NAME>"
- `<DOB>` label: "Date of birth (MM/DD/YYYY): <DOB>"  
- `<ANNUAL INCOME>` label: "Annual income from employment: <ANNUAL INCOME>"

✅ **Rich semantic context enables good matching!**

**Example - Poorly-Formatted Document:**
```
<FIELD1>
<FIELD2>
<FIELD3>
```

**Extracted Context:**
- `<FIELD1>` label: "<FIELD1>"
- `<FIELD2>` label: "<FIELD2>"
- `<FIELD3>` label: "<FIELD3>"

❌ **No semantic context! Matching relies purely on OpenAI model's ability to infer from placeholder token.**

### **Without Endnotes: Model Relies on Surrounding Text**

**Embedding Construction** (conditional endnote inclusion):
```python
# target_cache.py::build_target_descriptors(), lines 106-114
embedding_parts = [
    f"{token}",                                    # <POLICY NUMBER>
    f"label: {field.label}",                       # Full paragraph text with placeholder
    f"location: {field.location}",                 # paragraph[15] or table[0][1][2]
    f"occurrence: {occurrence}/{repeat_total}",    # 1/1 or 2/3 for arrays
]

# CONDITIONAL: Only if endnotes exist
if endnote_summary:
    embedding_parts.append(f"endnotes: {endnote_summary}")

embedding_text = " | ".join(embedding_parts)
```

**Result:**
- With endnotes: `"<POLICY NUMBER> | label: Policy Number | location: paragraph:15 | occurrence: 1/1 | endnotes: The unique identifier..."`
- Without endnotes: `"<POLICY NUMBER> | label: Please enter your policy number: <POLICY NUMBER> | location: paragraph:15 | occurrence: 1/1"`

**Key Insight:** Good document formatting (descriptive text) partially compensates for missing endnotes!

---

## Proposed Solution: 4-Layer Context Architecture

### **Layer 1: Field-Level Intrinsic Context**
*The field's own properties without external knowledge*

#### **Target Field Context:**
```python
{
  "field_name": "<POLICY NUMBER>",
  "placeholder": "<POLICY NUMBER>",
  "label": "Policy Number",
  "data_type": "identifier",
  "classification": "required",
  "location": "paragraph:15, section:Applicant Info",
  "occurrence": "1/1",  # or "2/3" for repeating fields
  "format_hints": ["uppercase", "alphanumeric"],
  "nearby_fields": ["<POLICY HOLDER NAME>", "<EFFECTIVE DATE>"]
}
```

#### **Source Field Context:**
```python
{
  "field_name": "PolicyNumber",
  "column": "PolicyNumber",
  "sheet": "Policies", 
  "data_type": "string",
  "sample_values": ["POL-2024-001", "POL-2024-002", "POL-2024-003"],
  "value_patterns": ["POL-YYYY-NNN"],
  "null_percentage": 0.0,
  "uniqueness": 1.0,  # All values unique
  "nearby_fields": ["PolicyHolderName", "EffectiveDate"]
}
```

**Implementation:**
- Extract from parsed Word/Excel analysis
- Infer data types from samples (dates, currencies, identifiers)
- Detect patterns using regex analysis
- Store in `target_descriptors` and `source_descriptors`

---

### **Layer 2: Field-Level Enriched Context**
*Business meaning and semantic descriptions*

#### **Target Field Enrichment:**
```python
{
  # ... Layer 1 fields ...
  "endnote_summary": "The unique identifier for the insurance policy. Must match policy documents.",
  "business_purpose": "Identifies the specific insurance contract",
  "validation_rules": ["Format: POL-YYYY-NNNNN", "Required field"],
  "user_instructions": "Enter the policy number exactly as shown on the declaration page",
  "semantic_tags": ["identifier", "policy_reference", "primary_key"]
}
```

#### **Source Field Enrichment:**
```python
{
  # ... Layer 1 fields ...
  "description": "Unique policy identifier from core system",  # From JSON data dictionary
  "json_path": "$.policy.policyNumber",
  "business_definition": "Primary key for policy records",
  "source_system": "PolicyMaster API v2",
  "semantic_tags": ["identifier", "policy_reference", "primary_key"],
  "related_fields": {
    "foreign_keys": ["$.policy.policyHolderId"],
    "dependent_fields": ["$.policy.renewalNumber"]
  }
}
```

**Sources:**
- **Targets:** Word endnotes, surrounding document text, section headings
- **Sources:** JSON data dictionaries, Excel metadata sheets, inferred from samples

---

### **Layer 3: Project-Level Business Context**
*Domain knowledge and mapping scenario from UI*

#### **From Mapper UI (Custom Mapping Wizard):**
```python
{
  "project_name": "Life & Annuity Policy Enrollment",
  "domain": "life_annuity",
  "source_system": "PolicyMaster API",
  "target_system": "Print Template - Policy Application Form",
  "business_scenario": "Map policy data from API to fillable PDF application form for underwriting review",
  
  # User-provided context (Step 3 of wizard)
  "custom_instructions": """
    This mapping is for new policy applications in the life insurance domain.
    Policy numbers must match exactly. Dates should be formatted as MM/DD/YYYY.
    Currency amounts include cents. Agent codes are 5-digit identifiers.
    Any health-related fields must comply with HIPAA privacy rules.
  """,
  
  "compliance_requirements": ["HIPAA", "NAIC Model Regulation"],
  "data_sensitivity": "PII - Protected Health Information",
  "transformation_hints": {
    "dates": "source: ISO-8601, target: MM/DD/YYYY",
    "currency": "source: decimal, target: formatted with $",
    "boolean": "source: true/false, target: Yes/No checkboxes"
  }
}
```

**Collection Points:**
- Wizard Step 1: Project name, domain, mapping type
- Wizard Step 2: Source/target file uploads (extract system names from metadata)
- Wizard Step 3: **Custom context text area** (currently underutilized!)
- Wizard Step 4: Previous mappings selection (historical context)

---

### **Layer 4: Cross-Field Relational Context**
*Relationships and dependencies between fields*

```python
{
  "field_groups": [
    {
      "group_name": "Applicant Demographics",
      "fields": ["<NAME>", "<DOB>", "<SSN>", "<ADDRESS>"],
      "business_rule": "Complete applicant identification required for underwriting"
    },
    {
      "group_name": "Coverage Details", 
      "fields": ["<POLICY TYPE>", "<COVERAGE AMOUNT>", "<PREMIUM>"],
      "business_rule": "Must specify complete coverage terms"
    }
  ],
  
  "conditional_mappings": [
    {
      "condition": "If <POLICY TYPE> = 'Term Life'",
      "then_required": ["<TERM LENGTH>", "<CONVERSION OPTION>"],
      "business_rule": "Term policies require duration specification"
    }
  ],
  
  "repeating_sections": [
    {
      "section": "Beneficiaries",
      "template": ["<BENEFICIARY NAME>#N", "<RELATIONSHIP>#N", "<PERCENTAGE>#N"],
      "source_array": "$.policy.beneficiaries[]",
      "business_rule": "Map array elements to numbered placeholders"
    }
  ]
}
```

**Detection:**
- Word template sections (headings, tables)
- JSON array structures
- Excel related columns (foreign keys, lookups)
- User-defined field groups

---

## Implementation Strategy

### **Phase 1: Symmetric Embedding Context** (Immediate Fix)

**Goal:** Make target and source embeddings comparable

#### **1A: Enrich Source Column Embeddings**
```python
# Current (asymmetric)
target_embed: "<POLICY NUMBER> | label: Policy Number | location: paragraph:15 | endnotes: ..."
source_embed: "Policies::PolicyNumber"

# Proposed (symmetric - semantic layer only)
target_embed: "Policy Number: unique policy identifier"
source_embed: "PolicyNumber: unique policy identifier, samples: POL-2024-001"
```

**Code Changes:**
- `retrieval.py::_build_column_index()` - add sample values to embedding text
- `retrieval.py::_build_object_index()` - already includes description, keep as-is
- `target_cache.py::build_target_descriptors()` - create separate `semantic_text` field for embedding

**Configuration:**
```bash
SNOWCHAT_MAPPING_SYMMETRIC_EMBEDDINGS=true  # Use semantic-only for embeddings
```

#### **1B: Maintain Full Context for LLM**
```python
# LLM prompt still gets full context:
target_context = {
  "placeholder": "<POLICY NUMBER>",
  "label": "Policy Number",
  "semantic": "unique policy identifier",  # Used for embedding
  "location": "paragraph:15",
  "classification": "required",
  "endnotes": "The unique identifier for the insurance policy...",
  "instructions": "Enter exactly as shown on declaration page"
}
```

**Result:** Embeddings match better, but LLM retains full reasoning context

---

### **Phase 2: Project Context Integration** (UI → Backend Pipeline)

**Goal:** Pass user-provided business context to synthesis

#### **2A: Frontend Changes (mapper/src)**

**Update `WizardData` interface:**
```typescript
// src/types/wizardTypes.ts
export interface WizardData {
  // ... existing fields ...
  
  // NEW: Project-level context
  projectContext: {
    businessScenario?: string;      // What is this mapping for?
    sourceSystemName?: string;       // Name of source system/API
    targetSystemName?: string;       // Name of target system
    complianceRequirements?: string[]; // HIPAA, NAIC, etc.
    dataSensitivity?: string;        // PII, PHI, Public, etc.
    transformationRules?: string;    // Date formats, currency, etc.
  };
}
```

**Update Synthesis Service:**
```typescript
// src/services/mappingSynthesisService.ts
const payload = {
  assignmentName: wizardData.projectName,
  targets: [...],
  excelObjects: [...],
  
  // NEW: Include project context
  contextProfile: {
    domain: wizardData.domain,
    sourceType: wizardData.sourceType,
    targetType: wizardData.targetType,
    businessScenario: wizardData.projectContext?.businessScenario,
    sourceSystem: wizardData.projectContext?.sourceSystemName,
    targetSystem: wizardData.projectContext?.targetSystemName,
    compliance: wizardData.projectContext?.complianceRequirements,
    customInstructions: wizardData.customPrompt,  // Already exists!
    transformationHints: parseTransformationRules(wizardData.projectContext?.transformationRules)
  }
};
```

#### **2B: Backend Changes**

**Update `MappingState` to store project context:**
```python
# mapping_agents/state.py
class MappingState:
    # ... existing fields ...
    
    # NEW: Project-level context
    project_context: Dict[str, Any]  # Business scenario, systems, compliance
    transformation_hints: Dict[str, str]  # date_format, currency_format, etc.
```

**Update LLM System Prompt:**
```python
# llm_mapping.py
SYSTEM_PROMPT_TEMPLATE = """
You are SnowChat's mapping architect for {domain} domain.

PROJECT CONTEXT:
- Business Scenario: {business_scenario}
- Source System: {source_system}
- Target System: {target_system}
- Compliance: {compliance_requirements}
- Data Sensitivity: {data_sensitivity}

TRANSFORMATION RULES:
{transformation_hints}

CUSTOM INSTRUCTIONS:
{custom_instructions}

Use this context to inform your mappings. For example:
- If compliance includes HIPAA, flag health-related field mappings
- Apply transformation rules (e.g., ISO-8601 dates → MM/DD/YYYY)
- Reference business scenario in rationale
"""
```

---

### **Phase 2.5: User Field Validation & Enrichment** (Interactive Quality Control)

**Goal:** Allow user to review detected fields and add missing context BEFORE embeddings are generated

#### **Problem This Solves:**
- **Poorly formatted documents** - Fields like `<FIELD1>` with no semantic meaning get user-added descriptions
- **Domain expertise injection** - User can specify data types, business purposes, validation rules
- **Confidence building** - User sees exactly what was detected and can correct false positives/negatives

#### **Workflow:**

**Step 1: Parse → Preview (Backend)**
```python
# New endpoint: POST /mapping/parse/word/preview
# Returns detected fields WITHOUT generating embeddings yet

@mapping_api.route("/mapping/parse/word/preview", methods=["POST"])
def parse_word_preview():
    """Parse template and show user what fields were detected"""
    file_path = request.json.get("filePath")
    word_summary = parse_word_document(file_path)
    
    field_previews = []
    for field in word_summary.fields:
        field_previews.append({
            "placeholder": field.placeholder,
            "label": field.label,
            "location": field.location,
            "has_endnotes": bool(field.endnote_texts),
            "endnote_preview": field.endnote_texts[0] if field.endnote_texts else None,
            
            # Context quality assessment
            "context_quality": calculate_context_quality(field),
            "needs_enrichment": is_poor_quality(field),
            
            # User-editable fields (initially empty)
            "user_description": "",
            "data_type": infer_data_type(field),  # Auto-suggest from label
            "semantic_tags": [],
            "validation_rules": ""
        })
    
    return jsonify({
        "fields": field_previews,
        "quality_score": calculate_overall_quality(field_previews),
        "recommendations": generate_enrichment_recommendations(field_previews)
    })


def calculate_context_quality(field: WordField) -> str:
    """Assess field context richness"""
    score = 0
    
    # Label is just placeholder (bad)
    if field.label.strip("<>[]") == field.placeholder.strip("<>[]"):
        score = 0
    # Label has surrounding text (good)
    elif len(field.label) > 30:
        score += 3
    
    # Has endnotes (excellent)
    if field.endnote_texts:
        score += 4
    
    # In structured location (good)
    if "table" in field.location:
        score += 1
    
    return "excellent" if score >= 6 else "good" if score >= 3 else "fair" if score >= 1 else "poor"


def infer_data_type(field: WordField) -> str:
    """Auto-suggest data type from label text"""
    label_lower = field.label.lower()
    
    if any(word in label_lower for word in ["date", "dob", "effective", "expiration"]):
        return "date"
    if any(word in label_lower for word in ["amount", "premium", "price", "$", "cost"]):
        return "currency"
    if any(word in label_lower for word in ["number", "id", "code", "policy", "ssn"]):
        return "identifier"
    if any(word in label_lower for word in ["address", "street", "city", "zip"]):
        return "address"
    if any(word in label_lower for word in ["phone", "telephone", "mobile"]):
        return "phone"
    if any(word in label_lower for word in ["email", "e-mail"]):
        return "email"
    if any(word in label_lower for word in ["yes/no", "true/false", "checkbox"]):
        return "boolean"
    
    return "text"
```

**Step 2: User Reviews & Enriches (Frontend)**
```tsx
// mapper/src/components/wizard/StepWordFieldReview.tsx

interface EnrichedField {
  placeholder: string;
  label: string;
  context_quality: 'excellent' | 'good' | 'fair' | 'poor';
  needs_enrichment: boolean;
  
  // User inputs
  user_description: string;
  data_type: string;
  semantic_tags: string[];
}

export function StepWordFieldReview({ 
  fields, 
  onContinue 
}: {
  fields: EnrichedField[];
  onContinue: (enriched: EnrichedField[]) => void;
}) {
  const [enrichedFields, setEnrichedFields] = useState(fields);
  const poorQualityCount = fields.filter(f => f.needs_enrichment).length;
  
  return (
    <Box>
      <Typography variant="h5">Review Detected Fields</Typography>
      <Typography variant="body2" color="textSecondary">
        We detected {fields.length} fields. 
        {poorQualityCount > 0 && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {poorQualityCount} fields have limited context. 
            Adding descriptions will significantly improve mapping accuracy.
          </Alert>
        )}
      </Typography>
      
      <Table sx={{ mt: 2 }}>
        <TableHead>
          <TableRow>
            <TableCell>Field</TableCell>
            <TableCell>Current Context</TableCell>
            <TableCell>Quality</TableCell>
            <TableCell>Add Description</TableCell>
            <TableCell>Type</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {enrichedFields.map((field, idx) => (
            <TableRow 
              key={idx} 
              sx={{ 
                backgroundColor: field.needs_enrichment ? 'warning.light' : 'inherit' 
              }}
            >
              <TableCell>
                <code>{field.placeholder}</code>
                <Typography variant="caption" display="block" color="textSecondary">
                  {field.location}
                </Typography>
              </TableCell>
              
              <TableCell>
                <Typography variant="body2">{field.label}</Typography>
                {field.has_endnotes && (
                  <Chip label="Has endnotes" size="small" color="success" sx={{ mt: 0.5 }} />
                )}
              </TableCell>
              
              <TableCell>
                <Chip 
                  label={field.context_quality} 
                  size="small"
                  color={
                    field.context_quality === 'excellent' ? 'success' :
                    field.context_quality === 'good' ? 'info' :
                    field.context_quality === 'fair' ? 'warning' : 'error'
                  }
                />
              </TableCell>
              
              <TableCell>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  placeholder="Describe this field's business purpose (e.g., 'The applicant's Social Security Number for tax reporting')"
                  value={field.user_description}
                  onChange={(e) => {
                    const updated = [...enrichedFields];
                    updated[idx].user_description = e.target.value;
                    setEnrichedFields(updated);
                  }}
                  helperText={
                    field.needs_enrichment 
                      ? "⚠️ Recommended - add context" 
                      : "Optional enhancement"
                  }
                  error={field.needs_enrichment && !field.user_description}
                />
              </TableCell>
              
              <TableCell>
                <Select
                  value={field.data_type}
                  onChange={(e) => {
                    const updated = [...enrichedFields];
                    updated[idx].data_type = e.target.value;
                    setEnrichedFields(updated);
                  }}
                  size="small"
                >
                  <MenuItem value="text">Text</MenuItem>
                  <MenuItem value="date">Date</MenuItem>
                  <MenuItem value="currency">Currency</MenuItem>
                  <MenuItem value="number">Number</MenuItem>
                  <MenuItem value="identifier">ID/Code</MenuItem>
                  <MenuItem value="boolean">Yes/No</MenuItem>
                  <MenuItem value="address">Address</MenuItem>
                  <MenuItem value="phone">Phone</MenuItem>
                  <MenuItem value="email">Email</MenuItem>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      
      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="outlined">Back</Button>
        <Button 
          variant="contained" 
          onClick={() => onContinue(enrichedFields)}
          disabled={poorQualityCount > 0 && enrichedFields.some(f => f.needs_enrichment && !f.user_description)}
        >
          Generate Embeddings & Continue
        </Button>
      </Box>
    </Box>
  );
}
```

**Step 3: Finalize with Enrichments (Backend)**
```python
@mapping_api.route("/mapping/parse/word/finalize", methods=["POST"])
def parse_word_finalize():
    """Generate embeddings with user-enriched context"""
    file_path = request.json.get("filePath")
    enriched_fields = request.json.get("enrichedFields")
    
    # Re-parse document
    word_summary = parse_word_document(file_path)
    
    # Merge user enrichments into field objects
    enrichment_map = {e["placeholder"]: e for e in enriched_fields}
    
    for field in word_summary.fields:
        enrichment = enrichment_map.get(field.placeholder, {})
        
        # Append user description to endnote texts
        user_desc = enrichment.get("user_description", "").strip()
        if user_desc:
            field.endnote_texts.append(user_desc)
        
        # Store metadata for downstream use
        field.user_metadata = {
            "data_type": enrichment.get("data_type"),
            "semantic_tags": enrichment.get("semantic_tags", []),
            "validation_rules": enrichment.get("validation_rules")
        }
    
    # NOW build target descriptors with enriched context
    targets = build_target_descriptors(word_summary)
    
    # Generate embeddings with user-enriched text
    vector_context = build_target_vector_context(word_summary.fields, targets)
    
    return jsonify({
        "success": True,
        "targets": targets,
        "vector_context": vector_context,
        "enrichment_applied": len([e for e in enriched_fields if e.get("user_description")])
    })
```

#### **Benefits:**

1. **Fixes Poor Documents:**
   - Before: `<FIELD1>` embeds as `"<FIELD1> | label: <FIELD1>"`
   - After: User adds "Policy number from core system" → embeds as `"<FIELD1> | label: <FIELD1> | endnotes: Policy number from core system"`
   - Similarity to "policyNumber": **0.12 → 0.82** ✅

2. **Domain Expertise Injection:**
   - User specifies `data_type: "currency"` → Boosts matches to numeric columns
   - User tags `semantic_tags: ["PII"]` → Enables compliance filtering

3. **Quality Control:**
   - User sees exactly what was detected (catch false positives)
   - User can identify missing fields (manual fallback)

4. **Gradual Rollout:**
   - Make review step **optional** initially (can skip to generate embeddings immediately)
   - Show quality score - if >80% excellent/good, allow skip
   - If <50% good quality, **require** user review

#### **Configuration:**
```bash
SNOWCHAT_REQUIRE_FIELD_REVIEW=false           # Initially optional
SNOWCHAT_MIN_QUALITY_THRESHOLD=0.5            # Require review if < 50% fields are "good" or better
SNOWCHAT_AUTO_INFER_DATA_TYPES=true           # Pre-populate data type suggestions
```

---

### **Phase 3: Layered Context Assembly** (Progressive Enrichment)

**Goal:** Build context incrementally from intrinsic → enriched → business → relational

#### **3A: Context Builder Pattern**

```python
# mapping_agents/context_builder.py

class FieldContextBuilder:
    """Incrementally builds context layers for a field"""
    
    def __init__(self, field_name: str, field_type: str):
        self.layers = {
            "intrinsic": {},      # Layer 1: Built-in properties
            "enriched": {},       # Layer 2: Semantic descriptions
            "business": {},       # Layer 3: Project/domain context
            "relational": {}      # Layer 4: Field relationships
        }
    
    def add_intrinsic(self, **kwargs):
        """Layer 1: name, type, samples, location"""
        self.layers["intrinsic"].update(kwargs)
        return self
    
    def add_enriched(self, **kwargs):
        """Layer 2: description, endnotes, semantic tags"""
        self.layers["enriched"].update(kwargs)
        return self
    
    def add_business_context(self, project_context: Dict):
        """Layer 3: domain, compliance, transformation rules"""
        self.layers["business"] = {
            "domain": project_context.get("domain"),
            "source_system": project_context.get("source_system"),
            "target_system": project_context.get("target_system"),
            "compliance": project_context.get("compliance_requirements", []),
            "custom_instructions": project_context.get("custom_instructions")
        }
        return self
    
    def add_relational(self, **kwargs):
        """Layer 4: field groups, dependencies, conditionals"""
        self.layers["relational"].update(kwargs)
        return self
    
    def build_semantic_text(self, include_layers: List[str] = None) -> str:
        """Build embedding text from specified layers"""
        include = include_layers or ["intrinsic", "enriched"]
        parts = []
        
        if "intrinsic" in include:
            parts.append(self.layers["intrinsic"].get("field_name", ""))
        
        if "enriched" in include:
            desc = self.layers["enriched"].get("description") or \
                   self.layers["enriched"].get("endnote_summary")
            if desc:
                parts.append(desc)
        
        if "business" in include:
            system = self.layers["business"].get("source_system") or \
                     self.layers["business"].get("target_system")
            if system:
                parts.append(f"from {system}")
        
        return " ".join(part for part in parts if part)
    
    def build_llm_context(self) -> Dict[str, Any]:
        """Build complete context for LLM prompt (all layers)"""
        return {
            **self.layers["intrinsic"],
            **self.layers["enriched"],
            "business_context": self.layers["business"],
            "relationships": self.layers["relational"]
        }
```

#### **3B: Usage Example**

```python
# In target_cache.py
def build_target_descriptors_v2(word_summary, project_context):
    descriptors = []
    
    for field in word_summary.fields:
        builder = FieldContextBuilder(field.placeholder, "target")
        
        # Layer 1: Intrinsic
        builder.add_intrinsic(
            field_name=field.placeholder,
            label=field.label,
            location=field.location,
            classification=field.classification,
            occurrence=f"{occurrence}/{total}"
        )
        
        # Layer 2: Enriched
        builder.add_enriched(
            endnote_summary=" ".join(field.endnote_texts),
            semantic_tags=infer_semantic_tags(field),
            data_type=infer_data_type(field.label, field.endnote_texts)
        )
        
        # Layer 3: Business
        builder.add_business_context(project_context)
        
        # Layer 4: Relational (detect field groups from section headings)
        builder.add_relational(
            field_group=detect_section_group(field.location),
            nearby_fields=get_nearby_fields(field, word_summary)
        )
        
        # Generate contexts for different purposes
        descriptor = {
            "heading": field.placeholder,
            "semantic_text": builder.build_semantic_text(["intrinsic", "enriched"]),
            "llm_context": builder.build_llm_context(),
            "layers": builder.layers  # Full context for inspection
        }
        
        descriptors.append(descriptor)
    
    return descriptors
```

---

### **Phase 4: Semantic Tag System** (Future Enhancement)

**Goal:** Standardize field semantics for cross-system matching

```python
SEMANTIC_TAG_ONTOLOGY = {
    "identifiers": {
        "policy_id": ["policy number", "policy_no", "policyid", "polnum"],
        "customer_id": ["customer number", "customerid", "client_id"],
        "agent_id": ["agent code", "agent number", "producing_agent"]
    },
    "temporal": {
        "effective_date": ["effective date", "start date", "coverage_start"],
        "expiration_date": ["expiration", "end date", "coverage_end"],
        "birth_date": ["dob", "date of birth", "birthdate"]
    },
    "monetary": {
        "premium": ["premium amount", "premium_amt", "total_premium"],
        "coverage_amount": ["face amount", "coverage", "benefit_amount"]
    },
    "personal_info": {
        "full_name": ["name", "insured name", "applicant_name"],
        "ssn": ["social security", "ssn", "tax_id"],
        "address": ["address", "street", "mailing_address"]
    }
}

def assign_semantic_tags(field_name: str, description: str = None) -> List[str]:
    """Auto-assign semantic tags based on field name and description"""
    normalized = field_name.lower().replace("_", " ").replace("-", " ")
    tags = []
    
    for category, tag_map in SEMANTIC_TAG_ONTOLOGY.items():
        for tag, patterns in tag_map.items():
            if any(pattern in normalized for pattern in patterns):
                tags.append(f"{category}.{tag}")
    
    return tags
```

**Usage in Matching:**
```python
# Boost similarity for fields with matching semantic tags
if set(source_tags) & set(target_tags):
    similarity_score *= 1.2  # 20% boost for semantic match
```

---

## Configuration Strategy

### **Enable/Disable Layers**
```bash
# Environment variables for gradual rollout
SNOWCHAT_CONTEXT_LAYER_1_INTRINSIC=true      # Always enabled
SNOWCHAT_CONTEXT_LAYER_2_ENRICHED=true       # Enable endnotes, descriptions
SNOWCHAT_CONTEXT_LAYER_3_BUSINESS=true       # Enable project context from UI
SNOWCHAT_CONTEXT_LAYER_4_RELATIONAL=false    # Future: field grouping

# Embedding strategy
SNOWCHAT_EMBEDDING_LAYERS=intrinsic,enriched # Which layers to use in embeddings
SNOWCHAT_LLM_LAYERS=all                      # LLM gets all layers

# Verbose context logging
SNOWCHAT_LOG_CONTEXT_LAYERS=true             # Log what context each field has
```

---

## Success Metrics

### **Embedding Quality:**
- [ ] Similarity score for semantically equivalent fields: **>0.80** (currently ~0.42)
- [ ] Top-3 FAISS recall for correct matches: **>90%** (currently ~60%)
- [ ] False positive rate (wrong fields in top-3): **<10%**

### **Mapping Quality:**
- [ ] Auto-mapping accuracy (LLM first-choice correct): **>85%** (currently ~65%)
- [ ] User approval rate (mappings accepted without modification): **>80%**
- [ ] Unmapped fields (no confident match found): **<15%** (currently ~30%)

### **Context Utilization:**
- [ ] Fields with Layer 2 enrichment: **>70%** of targets, **>50%** of sources
- [ ] Projects with Layer 3 business context: **>80%** (requires UI adoption)
- [ ] LLM citations referencing business context: **>60%** of rationales

### **User Validation (Phase 2.5):**
- [ ] User enrichment rate: **>60%** of projects use field review
- [ ] Poor-quality field enrichment: **>80%** of "poor" quality fields get user descriptions
- [ ] Enrichment impact: Fields with user descriptions show **>0.30 similarity improvement**

---

## Rollout Plan

### **Sprint 1: Quick Win (Symmetric Embeddings)**
- Implement Phase 1A: Add sample values to source embeddings
- Separate semantic text from full context
- A/B test: measure similarity score improvements
- **Effort:** 2-3 days | **Risk:** Low | **Impact:** Medium-High

### **Sprint 2: Business Context Pipeline**
- Implement Phase 2A: Update frontend wizard context collection
- Implement Phase 2B: Pass project context to backend
- Update LLM system prompt with business scenario
- **Effort:** 5-7 days | **Risk:** Medium (UI changes) | **Impact:** High

### **Sprint 2.5: User Field Validation (NEW - Optional Enhancement)**
- Implement `/mapping/parse/word/preview` endpoint
- Implement field review UI component (StepWordFieldReview)
- Add context quality assessment logic
- Add data type inference
- Make review step optional (configurable threshold)
- **Effort:** 4-6 days | **Risk:** Low-Medium (new UI step) | **Impact:** High for poor documents

### **Sprint 3: Layered Context System**
- Implement Phase 3: FieldContextBuilder pattern
- Migrate target/source descriptor builders to use layers
- Add configurable layer selection for embeddings
- **Effort:** 7-10 days | **Risk:** Medium-High (refactor) | **Impact:** High

### **Sprint 4: Validation & Tuning**
- Collect metrics on similarity scores
- User testing with business context
- Tune which layers work best for embeddings vs LLM
- **Effort:** 3-5 days | **Risk:** Low | **Impact:** Medium

---

## Open Questions

   - **NEW:** Show field review UI to let user add descriptions

3. **Should field review be mandatory or optional?**
   - **Proposed:** Optional by default, mandatory if context quality < threshold
   - Calculate quality score: if >70% fields are "good" or better, allow skip
   - If <50% good quality, require user review
   - Track user enrichment rate to measure adoption

4  - Yes, if we change embedding strategy significantly
   - Invalidate FAISS caches when `SNOWCHAT_EMBEDDING_LAYERS` changes

2. **How to handle missing Layer 2 context (no descriptions)?**
   - Fall back to Layer 1 only (intrinsic)
   - Log warning for source fields without descriptions
   - Encourage JSON data dictionary uploads

3. **Should business context be per-project or per-domain?**
   - Per-project: More specific, but requires user input every time
   - Per-domain: Reusable, but less accurate
   - **Hybrid:** Domain templates + per-project overrides

4. **How to validate relational context (Layer 4)?**
   - Auto-detect field groups from Word sections
   - Allow user to define groups in UI (future)
   - Use LLM to infer relationships from descriptions

5. **Performance impact of richer embeddings?**
   - More text = more OpenAI API cost
   - Semantic-only embeddings keep cost constant
   - Cache more aggressively (by content hash, not just file hash)

---

## Next Steps

1. **Review & Refine Design:**
   - Validate approach with team
   - Prioritize phases based on impact/effort
   - Get sign-off on UI changes for business context

2. **Prototype Phase 1:**
   - Branch: `feature/symmetric-embeddings`
   - Implement sample value enrichment
   - Run benchmark on test mappings
   - Measure before/after similarity scores

3. **Document UI Requirements:**
   - Design business context input form (Step 3.5 of wizard?)
   - Mockup transformation rules UI
   - Define validation rules for compliance tags

4. **Plan Migration:**
   - Backward compatibility for existing projects
   - Cache invalidation strategy
   - Gradual rollout with feature flags

---

## References

- **Current Code:**
  - `retrieval.py` - Embedding and ranking logic
  - `target_cache.py` - Target field descriptor building
  - `llm_mapping.py` - LLM prompt construction
  - `mapping_synthesizer.py` - Heuristic fallback

- **Related Designs:**
  - FAISS vector storage design
  - LLM structured output schema
  - Wizard state management

- **Business Context:**
  - Mapper UI wizard flow (React)
  - Custom mapping types configuration
  - Previous mappings feature (partially implemented)

---

**Document Status:** Draft for Review  
**Last Updated:** 2026-02-11  
**Author:** AI Analysis of Mapping Architecture  
**Reviewers Needed:** Backend Team, Frontend Team, Product Owner
