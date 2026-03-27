# Word Document Location Enhancement - Implementation Summary

## Overview
Enhanced the mapping synthesizer to include Word document location metadata in the final mapping rationale, providing better traceability from mapping results back to the source document.

## Changes Made (2026-01-20)

### 1. LLM Mapping Enhancement (`llm_mapping.py`)

#### Updated `_build_messages()` (Lines 72-80)
- Added guidance rule #6 to instruct the LLM to reference document location in rationale
- Example instruction: "If 'target_context' contains 'location' or 'classification', reference the document location in your rationale (e.g., 'Found at paragraph[17] in Benefits section')"

#### Updated `_invoke_batch()` (Lines 241-250)
- Modified to extract `target_context` from batch entry
- Pass `target_context` to `_post_process()` function for location augmentation

#### Enhanced `_post_process()` (Lines 103-145)
- Added optional `target_context` parameter (default: None)
- Augments rationale with Word document location metadata:
  ```python
  # Example output format:
  "Mapped based on semantic similarity [Word location: paragraph[17], type: label]"
  ```
- Location format: `[Word location: {location}, type: {classification}]`
- Only appends if location exists in target_context

### 2. Heuristic Fallback Enhancement (`mapping_synthesizer.py`)

#### Updated `_heuristic_rows()` (Lines 106-158)
- Extracts `location` and `classification` from target fields
- Augments rationale with same location metadata format as LLM mapping
- Ensures consistency between LLM and heuristic strategies

## Location Data Structure

### WordField (from `parsers.py`)
```python
@dataclass
class WordField:
    label: str
    placeholder: str
    classification: str  # "section_heading", "label", "paragraph", "table"
    location: str        # e.g., "paragraph[17]", "table[2]:cell[3,5]"
    endnote_ids: List[str]
    endnote_texts: List[str]
```

### Location Format Examples
- Paragraph: `"paragraph[17]"` - 17th paragraph in document
- Table cell: `"table[2]:cell[3,5]"` - Row 3, Column 5 of table 2
- Section heading: `"section_heading[4]"` - 4th section heading

### Classification Types
- `section_heading` - Major section titles
- `label` - Field labels (e.g., "Policyholder Name:")
- `paragraph` - Regular paragraph text
- `table` - Table cell content

## Expected Output Format

### Before Enhancement
```json
{
  "target_field": "Policyholder Name",
  "source_column": "Applicants::First Name",
  "confidence": 0.85,
  "rationale": "Mapped based on semantic similarity and column name match",
  "strategy": "llm"
}
```

### After Enhancement
```json
{
  "target_field": "Policyholder Name",
  "source_column": "Applicants::First Name",
  "confidence": 0.85,
  "rationale": "Mapped based on semantic similarity and column name match [Word location: paragraph[17], type: label]",
  "strategy": "llm"
}
```

## Integration Points

### API Endpoint (`/mapping/parse/word`)
- Already captures location during Word document parsing
- Location metadata flows through:
  1. `parse_word_document()` → WordField objects
  2. `state.target_fields` → List[WordField]
  3. `generate_with_llm()` → batch entries with target_context
  4. `_post_process()` → final mapping rows with augmented rationale

### Frontend Display
- Rationale now includes actionable location reference
- Business analysts can quickly navigate to exact paragraph/table in Word template
- Format is human-readable: "paragraph[17]" = "17th paragraph"

## Testing Recommendations

### 1. End-to-End Test
```bash
# Start the stack
cd C:\dev\snowchat\scripts
.\start-mapper-stack.ps1

# Upload Word template via frontend:
# - Navigate to http://localhost:3000
# - Upload Word template with includeVectors=true
# - Verify mapping results show location metadata in rationale
```

### 2. Verify Location Metadata
Check that mapping results include location references:
- LLM strategy: Rationale should end with `[Word location: ...]`
- Heuristic strategy: Same format for consistency
- Both strategies: Only appends if location exists (graceful degradation)

### 3. Manual Validation
1. Upload a Word template with known field locations
2. Cross-reference mapping results with source document
3. Verify paragraph/table numbers match document structure

## Benefits

### Traceability
- Direct linkage from mapping result → Word document section
- Enables quick validation and review by business analysts
- Reduces time spent hunting for field locations in source documents

### Consistency
- Both LLM and heuristic strategies use identical location format
- Location metadata automatically included when available
- Graceful degradation: if location missing, rationale unchanged

### Maintainability
- Centralized logic in `_post_process()` and `_heuristic_rows()`
- No changes required to parsers or API endpoints
- Preserves backward compatibility (location optional)

## Future Enhancements

### Potential Improvements
1. **Page Numbers**: Add page number to location metadata
2. **Section Titles**: Include parent section heading in location
3. **Clickable Links**: Frontend could render location as clickable navigation
4. **Visual Highlighting**: Show field location visually in Word preview
5. **Batch Annotation**: Auto-annotate Word doc with mapping results

### API Enhancement
Consider adding structured location field to response:
```json
{
  "target_field": "Policyholder Name",
  "source_column": "Applicants::First Name",
  "confidence": 0.85,
  "rationale": "Mapped based on semantic similarity...",
  "document_location": {
    "type": "paragraph",
    "index": 17,
    "page": 2,
    "section": "Applicant Information"
  }
}
```

## Dependencies
- No new dependencies added
- Uses existing `parsers.py` WordField structure
- Compatible with current LLM/heuristic synthesis pipelines

## Rollback
If issues arise, revert these commits:
1. `llm_mapping.py` - Remove target_context parameter and location augmentation
2. `mapping_synthesizer.py` - Remove location extraction in heuristic loop

No database migrations or API contract changes required.
