# Getting Started Testing Guide - NIGO Domain Enhancements

**Date:** January 22, 2026  
**Status:** ✅ Ready to Test  
**Frontend Status:** ✅ Already Configured - No Changes Needed

---

## 🎯 Quick Start

### Prerequisites
```bash
# 1. Ensure backend is running
cd c:\dev\snowchat\backend
python app.py

# 2. Ensure frontend is running
cd c:\dev\snowchat\frontend
npm start

# 3. Navigate to DevCopilot in browser
http://localhost:3000
```

---

## ✅ Frontend Status: READY

**Good news!** Your frontend (`DevCopilot.jsx`) **already handles** suggested questions:

- ✅ **API Integration:** Line 254 - Receives `suggested_questions` from backend
- ✅ **UI Rendering:** Lines 588-620 - Displays suggestions as clickable buttons
- ✅ **User Interaction:** Clicking suggestion auto-submits as new question
- ✅ **Visual Design:** Blue-bordered box with "💡 You might also want to ask:" header

**No frontend changes needed!** The enhanced backend will automatically populate better suggestions.

---

## 🧪 Testing Path - 3 Scenarios

### Scenario 1: First-Time User Experience (2 minutes)
**Goal:** See insurance-domain default suggestions

**Steps:**
1. Open DevCopilot (clear browser cache if needed)
2. Click in the message box
3. Look for suggested questions below

**What You'll See:**
```
💡 You might also want to ask:
[What are the top incidents in the backlog?]
[Show me critical incidents from the last 7 days]
[What are the current Life & Annuity NIGO types?] ← NEW!
[Show me P&C NIGO resolution procedures] ← NEW!
[Help me resolve an APS NIGO issue] ← NEW!
```

**✅ Success Criteria:**
- See 5+ suggested questions
- At least 3 insurance-specific suggestions visible

---

### Scenario 2: Life & Annuity NIGO Flow (5 minutes)
**Goal:** Test L&A domain detection and context-aware suggestions

#### Test Question 1: Ask About L&A NIGO Incident
```
Tell me about incident INC0010001
```

**Expected Response:**
- System fetches incident from ServiceNow
- Shows: "Intervention Needed: 22986759 - NIGO successor owner"
- Detects L&A NIGO type: `successor_owner`

**Expected Suggestions (9 total):**
```
💡 You might also want to ask:
[What's the root cause of INC0010001?]
[Show me similar incidents to INC0010001]
[Has INC0010001 been resolved?]
[Who is working on INC0010001?]
[What's the impact of this incident?]
[What NIGO type is INC0010001?] ← L&A Domain!
[Show me L&A NIGO resolution procedures for INC0010001] ← L&A Domain!
[What are common L&A NIGO resolution steps?] ← L&A Domain!
[Find similar Life & Annuity NIGO cases] ← L&A Domain!
```

#### Test Question 2: Click L&A Suggestion
Click: **"What are common L&A NIGO resolution steps?"**

**Expected Response:**
- System calls `get_la_nigo_types_tool()`
- Shows 8 L&A NIGO types with descriptions:
  - successor_owner
  - aps
  - underwriting
  - missing_requirements
  - payment
  - compliance
  - signature
  - policy_admin

#### Test Question 3: Deep Dive
Ask: **"Show me L&A NIGO resolution procedures for successor owner"**

**Expected Response:**
- System calls `resolve_la_nigo_tool()` with context augmentation
- Queries Wiki FAISS with: "Life and Annuity Insurance NIGO successor_owner resolution procedures requirements"
- Shows resolution knowledge from Wiki (if populated)

**✅ Success Criteria:**
- 9 suggestions appear after first question
- 4 suggestions are L&A-specific (marked with domain keywords)
- Clicking suggestions triggers automatic follow-up
- System correctly identifies NIGO type

---

### Scenario 3: Property & Casualty NIGO Flow (5 minutes)
**Goal:** Test P&C domain detection and differentiation from L&A

#### Test Question 1: Ask About P&C NIGO
```
Show me incident about auto policy binding failed with missing VIN
```

**Expected Response:**
- System detects P&C context (keywords: auto, vehicle, VIN, binding)
- Routes to P&C NIGO resolver
- Shows P&C-specific suggestions

**Expected Suggestions (9 total):**
```
💡 You might also want to ask:
[What's the root cause of this incident?]
[Show me similar auto policy incidents]
[Has this been resolved?]
[Who is working on this?]
[What's the impact of this incident?]
[What P&C NIGO type is this?] ← P&C Domain!
[Show me P&C NIGO resolution procedures] ← P&C Domain!
[What are common P&C NIGO resolution steps?] ← P&C Domain!
[Find similar Property & Casualty NIGO cases] ← P&C Domain!
```

#### Test Question 2: Click P&C Suggestion
Click: **"What are common P&C NIGO resolution steps?"**

**Expected Response:**
- System calls `get_pc_nigo_types_tool()`
- Shows 7 P&C NIGO types:
  - binding
  - coverage
  - vehicle
  - property
  - underwriting
  - premium
  - documentation

#### Test Question 3: Verify Product Differentiation
Ask: **"What's the difference between L&A and P&C NIGO types?"**

**Expected Response:**
- System explains L&A focuses on: policies, beneficiaries, medical underwriting, APS
- System explains P&C focuses on: vehicles, properties, coverage limits, premium calculations
- Shows both product categories are supported

**✅ Success Criteria:**
- P&C suggestions different from L&A suggestions
- System correctly routes to P&C tools (not L&A tools)
- 7 P&C NIGO types shown (not 8 L&A types)

---

## 📋 Quick Test Questions (Copy-Paste Ready)

### First-Time User Questions
```
What can you help me with?
Show me suggested questions
What are NIGO types?
```

### Life & Annuity Questions
```
Tell me about incident INC0010001
What are the current Life & Annuity NIGO types?
Show me L&A NIGO resolution procedures
Help me resolve an APS NIGO issue
What are common successor owner NIGO problems?
Find similar Life & Annuity NIGO cases
```

### Property & Casualty Questions
```
Show me P&C NIGO resolution procedures
What are common P&C NIGO types?
Help me with auto policy binding issue
Explain vehicle VIN NIGO problems
What causes property address NIGO failures?
Find similar Property & Casualty NIGO cases
```

### Comparison Questions
```
What's the difference between L&A and P&C NIGO?
Compare Life Annuity vs Property Casualty NIGO types
Show me all NIGO types across products
```

---

## 🎬 Demo Script for Stakeholders

### Opening (30 seconds)
**You:** "Let me show you how the system guides users with intelligent suggestions."

**Action:** Open DevCopilot, point to default suggestions
- "Notice it already suggests insurance-specific questions"
- "These are dynamically generated based on our domain knowledge"

### L&A Flow (2 minutes)
**You:** "Let's ask about a Life & Annuity incident."

**Type:** `Tell me about incident INC0010001`

**Wait for response, then point to suggestions:**
- "See how it automatically detected this is a Life & Annuity case"
- "Notice 4 new suggestions specific to L&A NIGO procedures"

**Click:** "What are common L&A NIGO resolution steps?"

**Show result:**
- "It knows 8 different L&A NIGO types"
- "Each with resolution procedures"

### P&C Flow (2 minutes)
**You:** "Now let's try Property & Casualty."

**Type:** `Help me with auto policy binding issue`

**Point to suggestions:**
- "Different suggestions - these are P&C-specific"
- "Notice it says 'P&C NIGO' not 'L&A NIGO'"

**Click:** "What are common P&C NIGO resolution steps?"

**Show result:**
- "Different NIGO types - only 7 for P&C"
- "Vehicle, property, coverage specific"

### Closing (30 seconds)
**You:** "The system automatically:
- Detects product type (L&A vs P&C)
- Suggests relevant next questions
- Guides users through resolution workflows
- All without manual configuration"

---

## 🔍 What to Look For

### ✅ Success Indicators

**1. Default Suggestions**
- [ ] See 8-13 suggested questions on first load
- [ ] At least 3 insurance-domain questions visible
- [ ] Questions are clickable and submit automatically

**2. L&A NIGO Detection**
- [ ] After L&A question, see 4 L&A-specific suggestions
- [ ] Suggestions mention "L&A", "Life & Annuity", "successor owner", "APS"
- [ ] System routes to `resolve_la_nigo_tool`

**3. P&C NIGO Detection**
- [ ] After P&C question, see 4 P&C-specific suggestions
- [ ] Suggestions mention "P&C", "Property & Casualty", "vehicle", "binding"
- [ ] System routes to `resolve_pc_nigo_tool`

**4. Context Continuity**
- [ ] Suggestions change after each question
- [ ] Suggestions relevant to current conversation
- [ ] No duplicate suggestions in same response

### ⚠️ Potential Issues to Check

**1. No Suggestions Appearing**
- Check browser console for errors
- Verify backend returned `suggested_questions` in response
- Check API endpoint: `POST /api/agentic/chat`

**2. Generic Suggestions Only**
- Verify keyword detection working (use "life", "annuity", "auto", "property")
- Check backend logs for: `[ContextualSuggester] Added to history`
- Ensure `get_contextual_suggester()` being called

**3. Wrong Product Suggestions**
- Check keyword matching logic in `contextual_question_suggester.py` (lines ~255-275)
- Verify L&A keywords: life, annuity, aps, successor, nigo
- Verify P&C keywords: auto, property, homeowner, vehicle, vin, binding

---

## 🛠️ Debugging Commands

### Check Backend Logs
```bash
cd c:\dev\snowchat\backend
tail -f agentic_orchestrator_auto.log | grep -i "suggest\|nigo"
```

### Check Registered Tools
```python
cd c:\dev\snowchat\backend
python
>>> from components.shared_registry import FUNCTION_REGISTRY
>>> print("resolve_la_nigo" in FUNCTION_REGISTRY)  # Should be True
>>> print("resolve_pc_nigo" in FUNCTION_REGISTRY)  # Should be True
>>> print("get_la_nigo_types" in FUNCTION_REGISTRY)  # Should be True
>>> print("get_pc_nigo_types" in FUNCTION_REGISTRY)  # Should be True
```

### Test Context Suggester Directly
```python
cd c:\dev\snowchat\backend
python
>>> from components.contextual_question_suggester import get_contextual_suggester
>>> suggester = get_contextual_suggester()
>>> suggester._get_default_suggestions(limit=10)
# Should see 13 suggestions including insurance-domain ones
```

---

## 📊 Expected Results Summary

| Test | Expected Suggestions | Expected Tools Called |
|------|---------------------|----------------------|
| First Load | 13 (8 generic + 5 insurance) | None |
| L&A Incident | 9 (5 generic + 4 L&A) | `resolve_la_nigo_tool` |
| L&A Deep Dive | 8 L&A NIGO types | `get_la_nigo_types_tool` |
| P&C Incident | 9 (5 generic + 4 P&C) | `resolve_pc_nigo_tool` |
| P&C Deep Dive | 7 P&C NIGO types | `get_pc_nigo_types_tool` |

---

## 🎯 Success Metrics

After testing, you should confirm:

✅ **Default Experience:** 5 insurance-specific starter questions visible  
✅ **L&A Flow:** 4 L&A-specific suggestions after L&A incident query  
✅ **P&C Flow:** 4 P&C-specific suggestions after P&C incident query  
✅ **Product Differentiation:** Different suggestions for L&A vs P&C  
✅ **Click Behavior:** Suggestions auto-submit and continue conversation  
✅ **Context Awareness:** Suggestions change based on conversation history  

---

## 🚀 Next Steps After Testing

1. **If All Tests Pass:**
   - Demo to stakeholders using scenarios above
   - Gather feedback on suggestion quality
   - Monitor which suggestions users click most

2. **If Issues Found:**
   - Check backend logs for errors
   - Verify tool registration in `FUNCTION_REGISTRY`
   - Test individual tools directly with Python REPL

3. **Future Enhancements:**
   - Populate Wiki FAISS with L&A and P&C NIGO procedures
   - Add more trigger keywords for better detection
   - Track suggestion click-through rates

---

## 💡 Pro Tips

1. **Clear browser cache** between tests to see fresh default suggestions
2. **Open browser console (F12)** to see API responses
3. **Use exact incident numbers** from your ServiceNow (INC0010001, INC0010002)
4. **Try different phrasings** to test keyword detection robustness
5. **Mix L&A and P&C questions** in same session to test context switching

---

## 📞 Quick Reference

**Frontend File:** `frontend/src/DevCopilot.jsx`  
**Backend File:** `backend/components/contextual_question_suggester.py`  
**NIGO Resolvers:** `backend/components/domain/life_annuity_knowledge.py`, `pc_nigo_resolver.py`  
**Test Suite:** `backend/test_nigo_resolvers_comprehensive.py`  
**Demo Script:** `backend/demo_enhanced_suggestions.py`

---

**Ready to test!** Start with Scenario 1 (first-time user) and progress through Scenarios 2 and 3. The frontend is already configured, so you'll immediately see the enhanced suggestions in action.
