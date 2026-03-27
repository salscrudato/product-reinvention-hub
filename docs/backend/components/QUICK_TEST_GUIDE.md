# Quick Test Guide - Word Document Location in Mapping Results

## What Was Changed
The mapping rationale now shows WHERE in the Word document each field was found.

**Before:**
```
"Rationale": "Mapped based on semantic similarity"
```

**After:**
```
"Rationale": "Mapped based on semantic similarity [Word location: paragraph[17], type: label]"
```

## How to Test

### Step 1: Start the Services
```powershell
cd C:\dev\snowchat\scripts
.\start-mapper-stack.ps1
```

This starts:
- Backend at http://localhost:5000
- Frontend at http://localhost:3000

### Step 2: Upload Word Template
1. Open http://localhost:3000 in browser
2. Navigate to mapping/upload section
3. Upload a Word template (.docx file)
4. **Important:** Enable "Include Vectors" option
5. Submit the upload

### Step 3: Review Mapping Results
Check the mapping results table for:
- **Rationale column** should show location metadata
- **Format:** `[Word location: paragraph[N], type: label]`
- **Examples:**
  - `paragraph[17]` = 17th paragraph
  - `table[2]:cell[3,5]` = Table 2, Row 3, Column 5
  - `section_heading[4]` = 4th section heading

### Step 4: Verify Location Accuracy
1. Open the original Word document
2. Find the 17th paragraph (or referenced location)
3. Confirm it matches the target field from mapping results

## Expected Behavior

### Location Present
When Word field has location metadata:
```json
{
  "target_field": "Policyholder Name",
  "source_column": "Applicants::First Name",
  "confidence": 0.85,
  "rationale": "Semantic match with history [Word location: paragraph[17], type: label]",
  "strategy": "llm"
}
```

### Location Missing
If location data unavailable (graceful degradation):
```json
{
  "target_field": "Policyholder Name",
  "source_column": "Applicants::First Name",
  "confidence": 0.85,
  "rationale": "Semantic match with history",
  "strategy": "llm"
}
```

## Troubleshooting

### Location Not Showing
**Check:**
1. Did you enable "Include Vectors" when uploading?
2. Is the Word document properly formatted with placeholders?
3. Check backend logs: `C:\dev\snowchat\backend\agentic_orchestrator_auto.log`

### Services Not Starting
**Check:**
1. Port 5000 available: `netstat -ano | findstr ":5000"`
2. Port 3000 available: `netstat -ano | findstr ":3000"`
3. Conda environment active: `conda activate devpilot`

### Backend Errors
**Common Issues:**
- Import errors: Check Python dependencies in `requirements.txt`
- CORS errors: Already fixed in `app.py` (lines 110-133)
- Missing files: Ensure all mapping_agents files present

## Benefits of This Enhancement

### For Business Analysts
- **Fast Validation**: Jump directly to source field in Word doc
- **Quality Assurance**: Verify mappings against original context
- **Documentation**: Auto-trace mapping decisions

### For Developers
- **Debugging**: Understand why field was mapped
- **Testing**: Validate parser accuracy
- **Maintenance**: Track field evolution across document versions

## Next Steps

### Phase 1 (Complete ✅)
- [x] Extract location from WordField
- [x] Pass location through LLM synthesis
- [x] Augment rationale with location metadata
- [x] Apply to heuristic fallback

### Phase 2 (Future)
- [ ] Add page numbers to location
- [ ] Include parent section titles
- [ ] Render clickable navigation in frontend
- [ ] Visual highlighting in Word preview

## Questions?
Check the detailed implementation summary:
`C:\dev\snowchat\backend\components\mapping_agents\LOCATION_ENHANCEMENT_SUMMARY.md`
