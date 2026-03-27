# Question Helper - UX Design Principles

## How This Helps Users

### 🎯 Core User Problems Solved

1. **"What can I even ask?"** - New users don't know system capabilities
2. **"How do I phrase this?"** - Users struggle with query syntax
3. **"I forgot that useful query"** - Recurring needs are hard to remember
4. **"What's the best way to ask this?"** - Learning from others' successful patterns

## UX Principles Applied

### 1. **Progressive Disclosure** ✅
**Principle:** Don't overwhelm users - reveal complexity gradually

**Implementation:**
- Component starts **collapsed** with subtle hint
- Only **auto-expands if suggestions exist** (not on empty state)
- Users can manually toggle anytime
- Collapses automatically after selection (doesn't clutter)

```jsx
// Auto-expand ONLY if we have helpful suggestions
if (suggestions.length > 0) {
  setOpen(true);  // Show helpful content
}
// Otherwise stay collapsed - no noise
```

### 2. **Discoverability** ✅
**Principle:** Users must be able to find features without hunting

**Implementation:**
- 💡 **Lightbulb icon** - Universal symbol for "help/ideas"
- **Subtle pulse animation** when suggestions available
- Clear text: "Not sure what to ask? Click for suggestions"
- Badge shows **count** of available suggestions
- Always visible above input (prime location)

```jsx
// Visual attention without annoyance
animation: 'pulse 2s ease-in-out infinite'
// Glows gently when help is available
```

### 3. **Contextual Awareness** ✅
**Principle:** Show relevant help at the right time

**Implementation:**
- **Persona-specific** - Developers see dev questions, POs see business questions
- **Context-aware** - Detects incident numbers in chat history → suggests related queries
- **Real-time** - Updates as conversation progresses
- Shows **why** each suggestion is relevant (badges: "Popular for you", "Related", "Trending")

```jsx
context: {
  incidents: ['INC0010013', 'INC0010001'],  // From recent chat
  persona: 'developer'  // Role-specific filtering
}
```

### 4. **Clear Affordances** ✅
**Principle:** Users should instantly know what's clickable and what happens

**Implementation:**
- **Hover states** - Cards shift right, change color, show shadow
- **Cursor changes** to pointer on interactive elements
- **Visual hierarchy** - Larger text for questions, smaller for metadata
- **Click anywhere** on card to use suggestion
- **Confidence bars** - Visual indicator of suggestion quality

```jsx
'&:hover': {
  backgroundColor: '#f0f7ff',
  transform: 'translateX(4px)',  // Slides right
  borderColor: '#004aad'
}
```

### 5. **Immediate Feedback** ✅
**Principle:** Users must know their action had an effect

**Implementation:**
- Click suggestion → **Input auto-fills instantly**
- Panel **collapses automatically** (visual confirmation)
- **Focus moves to input** (ready to edit/send)
- Loading states with spinner (network calls visible)
- Success: "Loaded 6 suggestions"

```jsx
const handleSuggestionClick = (question) => {
  onSelectQuestion(question);  // Fill input
  setOpen(false);             // Close panel (feedback)
};
```

### 6. **Respect User Preferences** ✅
**Principle:** Don't annoy users - let them control their experience

**Implementation:**
- **Permanent dismiss** - "Don't show automatically anymore" button
- Uses `localStorage` to remember preference
- Still accessible manually (icon remains) but won't auto-expand
- Per-user setting persists across sessions

```jsx
localStorage.setItem('questionHelper_dismissed', 'true');
// User said no - we listen
```

### 7. **Accessibility** ✅
**Principle:** Works for all users, including keyboard-only navigation

**Implementation:**
- **Keyboard support** - Enter key activates buttons
- **Tab navigation** - Focus visible with outline
- **ARIA labels** - Screen reader descriptions
- **Focus indicators** - Clear blue outline on focused elements
- **Semantic HTML** - Proper role attributes

```jsx
role="button"
tabIndex={0}
aria-label="Use suggestion: What is incident INC001?"
onKeyDown={(e) => e.key === 'Enter' && handleClick()}
```

### 8. **Non-Intrusive Design** ✅
**Principle:** Help without blocking the main workflow

**Implementation:**
- Doesn't **block** main interface
- Collapses to **single line** when not needed
- Auto-closes after use (doesn't stick around)
- **Skips empty states** - Won't pop up with "No suggestions"
- Respects workspace flow

### 9. **Graceful Degradation** ✅
**Principle:** Work even when backend fails

**Implementation:**
- **Error states** handled gracefully
- "No suggestions yet" with **helpful guidance**
- Backend offline? Shows friendly message
- No cache? Explains how to build suggestions
- Never crashes the parent component

```jsx
if (error) {
  return <Typography>Failed to load. Try refreshing.</Typography>
}
```

### 10. **Learning System** ✅
**Principle:** Gets better over time with usage

**Implementation:**
- Learns from **production logs** (real user queries)
- Surfaces **successful patterns** (not failed attempts)
- **Frequency tracking** - Popular = proven helpful
- Adapts to **team vocabulary** (incident INC vs TICKET vs CASE)

## Visual Design Hierarchy

### Information Architecture
```
┌─────────────────────────────────────────┐
│ 💡 Not sure what to ask? [6]          │  ← Collapsed state (always visible)
└─────────────────────────────────────────┘

When expanded:
┌─────────────────────────────────────────┐
│ 💡 Question Helper     [↻] [×] [×]     │  ← Header with actions
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ "What is incident INC001?"          │ │  ← Suggestion card
│ │ [Popular for you]         [90%]     │ │  ← Badge + Confidence
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ "Show all incidents last 3 days"    │ │
│ │ [Trending]                [85%]     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 💡 Personalized for developer • 2 incidents │  ← Context info
└─────────────────────────────────────────┘
```

### Color Psychology
- **Blue (#004aad)** - Trust, help, non-threatening
- **Green (confidence > 70%)** - Success, confidence
- **Orange (confidence < 70%)** - Caution, experimental
- **Yellow (lightbulb)** - Ideas, creativity
- **Gray** - Passive, unobtrusive when collapsed

## User Flows

### First-Time User Experience
```
1. User opens DevCopilot
   → Sees pulsing lightbulb 💡 with "Not sure what to ask?"
   
2. User clicks lightbulb
   → Panel expands showing 6 personalized suggestions
   → Each has badge explaining why suggested
   
3. User hovers over suggestion
   → Card shifts right, highlights
   → Cursor changes to pointer
   
4. User clicks "What is incident INC0010001?"
   → Input field fills with question
   → Panel collapses
   → Focus moves to input
   
5. User presses Enter → Question sent
   → Gets helpful response
   → Learns what's possible
```

### Returning User Experience
```
1. User opens DevCopilot
   → Lightbulb visible but collapsed (not annoying)
   → Badge shows "6" new suggestions
   
2. User ignores helper (knows what to ask)
   → Types question directly
   → Helper doesn't interfere
   
3. Later: User forgets syntax for date queries
   → Clicks lightbulb
   → Finds "Show incidents last 3 days" example
   → Uses it as template
```

### Power User Experience
```
1. User finds helper helpful initially
2. After mastering system, clicks "Don't show automatically"
3. Helper stops auto-expanding
4. Still accessible via manual click if needed
5. User in control
```

## Metrics for Success

### Engagement Metrics
- **Suggestion Click Rate** - % of users who click suggestions
- **Auto-Expand Dismissal Rate** - How many permanently dismiss
- **Suggestion to Query Conversion** - Do users send the suggested question?
- **Time to First Query** - Does helper reduce hesitation?

### Quality Metrics
- **Suggestion Relevance** - Are suggestions appropriate for persona?
- **Context Accuracy** - Do incident-based suggestions match chat context?
- **Confidence Correlation** - Do high-confidence suggestions get clicked more?

### User Satisfaction
- **Feature Discovery** - Do users learn new capabilities?
- **Query Success Rate** - Do suggested questions lead to better outcomes?
- **Return Usage** - Do users come back to helper over time?

## Future Enhancements

### Planned UX Improvements

1. **Personalization Learning**
   - Track which suggestions each user clicks
   - Reorder based on individual preferences
   - Hide suggestions user never uses

2. **Inline Suggestions**
   - Show suggestions as user types (like autocomplete)
   - "You're typing about incidents - try: 'Show similar incidents'"

3. **Onboarding Tour**
   - First-time users get brief tooltip
   - "💡 Stuck? Click here for example questions"
   - Dismissible after first interaction

4. **Smart Timing**
   - Detect user hesitation (empty input for 10s)
   - Gently expand: "Need ideas?"
   - Close if user starts typing

5. **Category Filters**
   - Group by intent: "Incidents", "Wiki", "Analysis"
   - User picks category → See relevant suggestions
   - Reduces cognitive load

6. **Favorite Suggestions**
   - Star icon on each suggestion
   - Quick access to frequently-used queries
   - Personal shortcut library

## Accessibility Compliance

### WCAG 2.1 AA Standards

✅ **Perceivable**
- Color not sole indicator (badges have text)
- Sufficient contrast ratios (4.5:1 minimum)
- Text resize works (relative units)

✅ **Operable**
- Keyboard navigation (Tab, Enter)
- No time limits on interaction
- Focus visible and clear

✅ **Understandable**
- Clear labels and instructions
- Consistent behavior (always collapses after use)
- Error messages are helpful

✅ **Robust**
- Semantic HTML (roles, aria-labels)
- Works with screen readers
- Degrades gracefully

## Conclusion

The Question Helper is designed with **user empowerment** at its core:
- **Helps without hindering**
- **Teaches without lecturing**
- **Guides without forcing**
- **Adapts to user skill level**

It's not just a suggestion box - it's a **learning companion** that helps users discover the system's capabilities naturally, at their own pace.

