# Token Cost Tracking - Accuracy Analysis & Improvements

## Current Implementation Issues

### Issue 1: ❌ Hardcoded Pricing (Incorrect for Most Models)

**File:** `backend/components/token_instrumentation.py:26-27`

```python
PROMPT_RATE = float(os.getenv('TOKEN_PROMPT_RATE_PER_1K', '0.0003'))
COMPLETION_RATE = float(os.getenv('TOKEN_COMPLETION_RATE_PER_1K', '0.0006'))
```

**Problems:**
1. **Default rates are GPT-3.5-Turbo pricing** ($0.0003/$0.0006 per 1K tokens)
2. **Doesn't detect actual model from `GPT_MODEL_NAME`**
3. **No support for Azure OpenAI deployment-specific pricing**
4. **Ignores cached token discounts** (90% off for cached prompts)

### Issue 2: ❌ No Cumulative Cost Tracking

**Current Behavior:**
- Token metrics show **per-query cost only**
- Aggregate cost is **only for current page** (5-50 entries visible)
- **No daily/weekly/monthly totals**
- **No cost alerts or budget tracking**

**Frontend Display (TokenUsageTab.jsx:124):**
```jsx
<Chip label={`Cost: $${aggregate.total_cost_usd}`} />
```
This shows **cost for current page slice only**, NOT total cumulative cost!

### Issue 3: ❌ Token Counting May Be Inaccurate

**File:** `token_instrumentation.py:38-58`

```python
def _try_count_tokens(text: str, model: str) -> int:
    """Attempt real token counting using tiktoken; fallback to heuristic."""
    if not text:
        return 0
    try:
        # ... tries tiktoken.encoding_for_model(model)
    except Exception:
        return _approx_tokens(text)  # Fallback: len(text) / 4
```

**Problems:**
1. **Fallback heuristic is crude** (4 chars per token is rough average)
2. **Doesn't account for special tokens** (system messages, function definitions)
3. **May fail silently** if tiktoken not installed or model name unrecognized

### Issue 4: ❌ Missing Cost Breakdown

**Current Display:** Only shows total cost
**Missing:**
- Prompt cost vs completion cost breakdown
- Cached token savings ($)
- Context token cost
- Function call overhead cost

## What's Actually Being Tracked

### Per-Query Metrics (Stored in TinyDB)
```json
{
  "timestamp": 1737328800.123,
  "username": "snow_admin",
  "persona": "product_owner",
  "question": "What are incidents for today?",
  "micro_intent": "incident_opened_lookup",
  "prompt_tokens": 2200,
  "context_tokens": 150,
  "completion_tokens": 180,
  "total_tokens": 2530,
  "baseline_estimate": 2800,
  "savings_tokens": 270,
  "savings_percent": 9.64,
  "cache_hit": false,
  "cost_usd": 0.000768,  // ⚠️ Using hardcoded rates!
  "plan_steps": ["get_incidents_created_today"]
}
```

### Aggregate Display (Frontend)
- Shows: Total tokens, baseline, savings, cost **for current page only**
- Missing: Cumulative cost across all history
- Missing: Daily/weekly/monthly rollups
- Missing: Cost per user, cost per persona

## Correct Pricing (As of Jan 2026)

### OpenAI Models (Input / Output per 1M tokens)
| Model | Input | Output |
|-------|-------|--------|
| **gpt-4o** | $2.50 | $10.00 |
| **gpt-4o-mini** | $0.150 | $0.600 |
| **gpt-3.5-turbo** | $0.50 | $1.50 |
| **gpt-4-turbo** | $10.00 | $30.00 |
| **gpt-4** (legacy) | $30.00 | $60.00 |

**Current defaults ($0.30 / $0.60 per 1M) match gpt-3.5-turbo!**

### Azure OpenAI Pricing
- **Same as OpenAI** but billed in Azure subscription
- **Regional variations** (US East, Europe, etc.)
- **Deployment-specific pricing** (can differ from base model)
- **Commitment discounts** available

### Cached Token Discount (Prompt Caching)
- **First cache miss:** Full input token cost
- **Cache hit (within 5-10 min):** **90% discount** on cached prefix
- **Example:** 2000 token cached prefix → $0.0005 instead of $0.005

## Solution: Accurate Multi-Model Cost Tracking

### Fix 1: Model-Specific Pricing Database

**File:** `backend/components/token_instrumentation.py` (add at top)

```python
# Pricing per 1M tokens (as of January 2026)
MODEL_PRICING = {
    # OpenAI Models
    'gpt-4o': {'input': 2.50, 'output': 10.00, 'cached': 0.25},
    'gpt-4o-mini': {'input': 0.15, 'output': 0.60, 'cached': 0.015},
    'gpt-3.5-turbo': {'input': 0.50, 'output': 1.50, 'cached': 0.05},
    'gpt-4-turbo': {'input': 10.00, 'output': 30.00, 'cached': 1.00},
    'gpt-4': {'input': 30.00, 'output': 60.00, 'cached': 3.00},
    
    # Azure OpenAI (use deployment name or base model)
    'cna-gpt-35-turbo': {'input': 0.50, 'output': 1.50, 'cached': 0.05},
    'cna-gpt-4o': {'input': 2.50, 'output': 10.00, 'cached': 0.25},
    
    # Fallback generic rates (if model unknown)
    'default': {'input': 0.50, 'output': 1.50, 'cached': 0.05}
}

def get_model_pricing(model_name: str) -> dict:
    """Get pricing for model, with fuzzy matching and fallback."""
    # Exact match
    if model_name in MODEL_PRICING:
        return MODEL_PRICING[model_name]
    
    # Fuzzy match (e.g., "gpt-4o-2024-05-13" → "gpt-4o")
    model_lower = model_name.lower()
    for key in MODEL_PRICING:
        if key in model_lower or model_lower.startswith(key):
            return MODEL_PRICING[key]
    
    # Fallback to default
    return MODEL_PRICING['default']

def calculate_cost(prompt_tokens: int, completion_tokens: int, 
                   cached_tokens: int, model: str) -> dict:
    """Calculate accurate cost breakdown with caching support.
    
    Returns:
        {
            'prompt_cost': float,
            'completion_cost': float,
            'cache_cost': float,
            'cache_savings': float,
            'total_cost': float
        }
    """
    pricing = get_model_pricing(model)
    
    # Cached tokens get 90% discount
    uncached_prompt_tokens = max(0, prompt_tokens - cached_tokens)
    
    prompt_cost = (uncached_prompt_tokens / 1_000_000) * pricing['input']
    cache_cost = (cached_tokens / 1_000_000) * pricing.get('cached', pricing['input'] * 0.1)
    completion_cost = (completion_tokens / 1_000_000) * pricing['output']
    
    # Calculate what it would have cost without caching
    full_prompt_cost = (prompt_tokens / 1_000_000) * pricing['input']
    cache_savings = full_prompt_cost - (prompt_cost + cache_cost)
    
    total_cost = prompt_cost + cache_cost + completion_cost
    
    return {
        'prompt_cost': round(prompt_cost, 6),
        'completion_cost': round(completion_cost, 6),
        'cache_cost': round(cache_cost, 6),
        'cache_savings': round(cache_savings, 6),
        'total_cost': round(total_cost, 6),
        'model': model,
        'pricing_source': 'detected' if model in MODEL_PRICING else 'fallback'
    }
```

**Update `TokenInstrumentation.finalize()` method (line ~110):**

```python
def finalize(self, entry_id: Optional[str], final_answer: str, metadata: Dict[str, Any]) -> None:
    """Update the previously created entry with completion tokens and computed savings."""
    if not self._enabled() or not entry_id:
        return
    model = os.getenv('GPT_MODEL_NAME', 'gpt-4o-mini')
    completion_tokens = _try_count_tokens(final_answer, model)
    
    # ... existing entry lookup code ...
    
    prompt_tokens = entry.get('prompt_tokens', 0)
    context_tokens = entry.get('context_tokens', 0)
    cached_tokens = context_tokens if entry.get('cache_hit') else 0  # Assume context was cached
    
    # ✅ NEW: Use accurate model-specific pricing
    cost_breakdown = calculate_cost(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        model=model
    )
    
    total_tokens = prompt_tokens + context_tokens + completion_tokens
    baseline = entry.get('baseline_estimate', total_tokens)
    savings = max(0, baseline - total_tokens)
    
    # Incorporate rolling summary estimated savings if present and larger
    summary_savings_est = metadata.get('summary_token_savings_estimate')
    if isinstance(summary_savings_est, (int, float)) and summary_savings_est > savings:
        savings = summary_savings_est
    
    updated = {
        'completion_tokens': completion_tokens,
        'total_tokens': total_tokens,
        'savings_tokens': savings,
        'savings_percent': round((savings / baseline)*100, 2) if baseline else 0.0,
        
        # ✅ NEW: Detailed cost breakdown
        'cost_usd': cost_breakdown['total_cost'],
        'cost_breakdown': {
            'prompt': cost_breakdown['prompt_cost'],
            'completion': cost_breakdown['completion_cost'],
            'cache': cost_breakdown['cache_cost'],
            'cache_savings_usd': cost_breakdown['cache_savings']
        },
        'model_used': model,
        'pricing_source': cost_breakdown['pricing_source'],
        
        'entry_phase': 'final',
        'final_answer_preview': final_answer[:800]
    }
    
    # ... existing update code ...
```

### Fix 2: Cumulative Cost Tracking

**Add new endpoint:** `backend/components/agentic_orchestrator_api.py`

```python
@agentic_blueprint.route('/token_metrics/cumulative', methods=['GET'])
def token_metrics_cumulative():
    """Get cumulative cost and usage statistics.
    
    Query params:
        username (optional): Filter by user
        timeframe: 'day', 'week', 'month', 'all' (default 'all')
        start_date (optional): ISO format YYYY-MM-DD
        end_date (optional): ISO format YYYY-MM-DD
    
    Returns:
        {
            'cumulative_cost_usd': float,
            'cumulative_tokens': int,
            'cumulative_cache_savings_usd': float,
            'query_count': int,
            'avg_cost_per_query': float,
            'breakdown_by_persona': {...},
            'breakdown_by_model': {...},
            'daily_trend': [...],
            'top_users': [...]
        }
    """
    if not os.getenv('ENABLE_TOKEN_METRICS', '').lower() in ('1','true','yes','on'):
        return jsonify({'enabled': False}), 200
    
    username = request.args.get('username')
    timeframe = request.args.get('timeframe', 'all')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    db = TinyDB('state_db.json')
    table = db.table('token_usage')
    
    # Filter by username if provided
    if username:
        rows = table.search(Query().username == username)
    else:
        rows = table.all()
    
    # Filter by timeframe
    import datetime
    now = datetime.datetime.now()
    
    if timeframe == 'day':
        cutoff = (now - datetime.timedelta(days=1)).timestamp()
        rows = [r for r in rows if r.get('timestamp', 0) > cutoff]
    elif timeframe == 'week':
        cutoff = (now - datetime.timedelta(days=7)).timestamp()
        rows = [r for r in rows if r.get('timestamp', 0) > cutoff]
    elif timeframe == 'month':
        cutoff = (now - datetime.timedelta(days=30)).timestamp()
        rows = [r for r in rows if r.get('timestamp', 0) > cutoff]
    
    # Custom date range
    if start_date:
        start_ts = datetime.datetime.fromisoformat(start_date).timestamp()
        rows = [r for r in rows if r.get('timestamp', 0) >= start_ts]
    if end_date:
        end_ts = datetime.datetime.fromisoformat(end_date).timestamp()
        rows = [r for r in rows if r.get('timestamp', 0) <= end_ts]
    
    # Calculate cumulative metrics
    total_cost = sum(r.get('cost_usd', 0) for r in rows)
    total_tokens = sum(r.get('total_tokens', 0) for r in rows)
    cache_savings = sum(r.get('cost_breakdown', {}).get('cache_savings_usd', 0) for r in rows)
    query_count = len(rows)
    
    # Breakdown by persona
    persona_breakdown = {}
    for row in rows:
        persona = row.get('persona', 'unknown')
        if persona not in persona_breakdown:
            persona_breakdown[persona] = {'cost': 0, 'tokens': 0, 'count': 0}
        persona_breakdown[persona]['cost'] += row.get('cost_usd', 0)
        persona_breakdown[persona]['tokens'] += row.get('total_tokens', 0)
        persona_breakdown[persona]['count'] += 1
    
    # Breakdown by model
    model_breakdown = {}
    for row in rows:
        model = row.get('model_used', 'unknown')
        if model not in model_breakdown:
            model_breakdown[model] = {'cost': 0, 'tokens': 0, 'count': 0}
        model_breakdown[model]['cost'] += row.get('cost_usd', 0)
        model_breakdown[model]['tokens'] += row.get('total_tokens', 0)
        model_breakdown[model]['count'] += 1
    
    # Daily trend (last 30 days)
    daily_data = {}
    for row in rows:
        ts = row.get('timestamp', 0)
        date_key = datetime.datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
        if date_key not in daily_data:
            daily_data[date_key] = {'cost': 0, 'tokens': 0, 'queries': 0}
        daily_data[date_key]['cost'] += row.get('cost_usd', 0)
        daily_data[date_key]['tokens'] += row.get('total_tokens', 0)
        daily_data[date_key]['queries'] += 1
    
    daily_trend = [
        {'date': k, 'cost': round(v['cost'], 6), 'tokens': v['tokens'], 'queries': v['queries']}
        for k, v in sorted(daily_data.items())
    ]
    
    # Top users by cost
    user_costs = {}
    for row in rows:
        user = row.get('username', 'anonymous')
        user_costs[user] = user_costs.get(user, 0) + row.get('cost_usd', 0)
    
    top_users = [
        {'username': k, 'cost': round(v, 6)}
        for k, v in sorted(user_costs.items(), key=lambda x: x[1], reverse=True)[:10]
    ]
    
    return jsonify({
        'enabled': True,
        'timeframe': timeframe,
        'cumulative_cost_usd': round(total_cost, 6),
        'cumulative_tokens': total_tokens,
        'cumulative_cache_savings_usd': round(cache_savings, 6),
        'query_count': query_count,
        'avg_cost_per_query': round(total_cost / query_count, 6) if query_count else 0,
        'breakdown_by_persona': {k: {'cost': round(v['cost'], 6), **v} for k, v in persona_breakdown.items()},
        'breakdown_by_model': {k: {'cost': round(v['cost'], 6), **v} for k, v in model_breakdown.items()},
        'daily_trend': daily_trend,
        'top_users': top_users
    })
```

### Fix 3: Enhanced Frontend Display

**File:** `frontend/src/TokenUsageTab.jsx`

**Add cumulative cost section:**

```jsx
const [cumulativeStats, setCumulativeStats] = useState(null);
const [timeframe, setTimeframe] = useState('day');

// Fetch cumulative stats
const fetchCumulative = useCallback(async (tf) => {
  try {
    const qp = new URLSearchParams();
    qp.set('timeframe', tf);
    if (username) qp.set('username', username);
    const url = `${apiBase}/token_metrics/cumulative?${qp.toString()}`;
    const resp = await axios.get(url);
    if (resp.data.enabled) {
      setCumulativeStats(resp.data);
    }
  } catch (e) {
    console.error('Failed fetching cumulative stats:', e);
  }
}, [apiBase, username]);

useEffect(() => {
  fetchCumulative(timeframe);
  const interval = setInterval(() => fetchCumulative(timeframe), 30000); // refresh every 30s
  return () => clearInterval(interval);
}, [timeframe, fetchCumulative]);

// Add cumulative stats display ABOVE aggregate section
{cumulativeStats && (
  <Paper sx={{ p: 3, mb: 2, bgcolor: '#e3f5ff', border: '2px solid #0078d4' }} elevation={3}>
    <Typography variant="h6" sx={{ fontWeight: 700, color: '#0078d4', mb: 2 }}>
      💰 Cumulative Cost Tracking
    </Typography>
    <Stack direction="row" spacing={2} flexWrap="wrap">
      <FormControl size="small" sx={{ minWidth: 120 }}>
        <InputLabel>Timeframe</InputLabel>
        <Select value={timeframe} label="Timeframe" onChange={e => setTimeframe(e.target.value)}>
          <MenuItem value="day">Last 24 Hours</MenuItem>
          <MenuItem value="week">Last 7 Days</MenuItem>
          <MenuItem value="month">Last 30 Days</MenuItem>
          <MenuItem value="all">All Time</MenuItem>
        </Select>
      </FormControl>
      <Chip 
        label={`Total Cost: $${cumulativeStats.cumulative_cost_usd}`} 
        color="error" 
        sx={{ fontSize: '1.1rem', fontWeight: 700, px: 2 }}
      />
      <Chip 
        label={`Cache Savings: $${cumulativeStats.cumulative_cache_savings_usd}`} 
        color="success" 
        sx={{ fontSize: '1rem', fontWeight: 600 }}
      />
      <Chip 
        label={`Total Queries: ${cumulativeStats.query_count}`} 
        color="primary" 
        sx={{ fontSize: '1rem', fontWeight: 600 }}
      />
      <Chip 
        label={`Avg/Query: $${cumulativeStats.avg_cost_per_query}`} 
        color="secondary" 
      />
      <Chip 
        label={`Total Tokens: ${(cumulativeStats.cumulative_tokens / 1000000).toFixed(2)}M`} 
        variant="outlined" 
      />
    </Stack>
    
    {/* Breakdown by Persona */}
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Cost by Persona:</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {Object.entries(cumulativeStats.breakdown_by_persona).map(([persona, data]) => (
          <Chip 
            key={persona}
            label={`${persona}: $${data.cost} (${data.count} queries)`}
            size="small"
            variant="outlined"
          />
        ))}
      </Stack>
    </Box>
    
    {/* Breakdown by Model */}
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Cost by Model:</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {Object.entries(cumulativeStats.breakdown_by_model).map(([model, data]) => (
          <Chip 
            key={model}
            label={`${model}: $${data.cost}`}
            size="small"
            color="secondary"
            variant="outlined"
          />
        ))}
      </Stack>
    </Box>
  </Paper>
)}
```

**Update Interaction Details Modal to show cost breakdown:**

```jsx
{/* Add after Execution Metrics section */}
<Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: '#fff8e1', borderLeft: '4px solid #ffa000' }}>
  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#f57c00', mb: 1.5 }}>
    💰 Cost Breakdown
  </Typography>
  {selectedRow.cost_breakdown ? (
    <Stack spacing={1}>
      <Typography variant="body2">
        Prompt Cost: <strong>${selectedRow.cost_breakdown.prompt}</strong>
      </Typography>
      <Typography variant="body2">
        Completion Cost: <strong>${selectedRow.cost_breakdown.completion}</strong>
      </Typography>
      {selectedRow.cost_breakdown.cache > 0 && (
        <Typography variant="body2" color="success.main">
          Cached Tokens: <strong>${selectedRow.cost_breakdown.cache}</strong> 
          (Saved: ${selectedRow.cost_breakdown.cache_savings_usd})
        </Typography>
      )}
      <Divider sx={{ my: 1 }} />
      <Typography variant="body1" sx={{ fontWeight: 700 }}>
        Total Cost: <strong>${selectedRow.cost_usd}</strong>
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Model: {selectedRow.model_used || 'unknown'} 
        {selectedRow.pricing_source === 'fallback' && ' (fallback pricing)'}
      </Typography>
    </Stack>
  ) : (
    <Typography variant="body2" color="text.secondary">
      Legacy entry - no breakdown available
    </Typography>
  )}
</Paper>
```

## Testing Verification

### Test 1: Model Detection
```python
# Set GPT_MODEL_NAME to various models and verify correct pricing
os.environ['GPT_MODEL_NAME'] = 'gpt-4o'
# Should use: input=$2.50, output=$10.00 per 1M

os.environ['GPT_MODEL_NAME'] = 'cna-gpt-35-turbo'  
# Should match Azure deployment pricing
```

### Test 2: Cumulative Cost
```bash
# Make 10 queries, then check cumulative endpoint
curl "http://localhost:5000/token_metrics/cumulative?timeframe=day"

# Should return:
# - cumulative_cost_usd: Sum of all 10 queries
# - query_count: 10
# - breakdown_by_persona: Costs grouped by persona
```

### Test 3: Cache Savings
```python
# First query (cache miss)
# cost_usd: $0.005

# Second query within 5 min (cache hit)
# cache_cost: $0.0005
# cache_savings_usd: $0.0045
```

## Implementation Checklist

- [ ] **Add MODEL_PRICING dictionary** to token_instrumentation.py
- [ ] **Add get_model_pricing() function** with fuzzy matching
- [ ] **Add calculate_cost() function** with cache support
- [ ] **Update TokenInstrumentation.finalize()** to use new cost calculation
- [ ] **Add /token_metrics/cumulative endpoint** to agentic_orchestrator_api.py
- [ ] **Update frontend** to fetch and display cumulative stats
- [ ] **Add cost breakdown** to Interaction Details modal
- [ ] **Add timeframe filter** (day/week/month/all)
- [ ] **Add model detection logging** to verify correct pricing used
- [ ] **Test with multiple models** (gpt-4o, gpt-4o-mini, gpt-3.5-turbo)
- [ ] **Verify Azure deployment pricing** (cna-gpt-35-turbo, etc.)
- [ ] **Test cache savings calculation** (sequential queries)
- [ ] **Export cumulative stats** to CSV

## Budget Alerts (Future Enhancement)

Add budget tracking with alerts:

```python
# Environment variables
MONTHLY_BUDGET_USD = float(os.getenv('MONTHLY_BUDGET_USD', '100.0'))
BUDGET_ALERT_THRESHOLD = float(os.getenv('BUDGET_ALERT_THRESHOLD', '0.8'))  # 80%

def check_budget_status():
    """Check if monthly budget threshold reached."""
    cumulative = get_cumulative_stats(timeframe='month')
    spent = cumulative['cumulative_cost_usd']
    budget_pct = (spent / MONTHLY_BUDGET_USD) * 100
    
    if budget_pct >= BUDGET_ALERT_THRESHOLD * 100:
        # Send alert (email, Slack, etc.)
        emit_event('budget.alert', spent=spent, budget=MONTHLY_BUDGET_USD, pct=budget_pct)
    
    return {
        'spent': spent,
        'budget': MONTHLY_BUDGET_USD,
        'remaining': MONTHLY_BUDGET_USD - spent,
        'percent_used': budget_pct
    }
```

---

**Priority:** HIGH - Cost tracking is critical for production deployment and budget management
**Estimated Effort:** 4-6 hours
**Dependencies:** None (all components exist)
**Impact:** Accurate cost visibility, budget tracking, model optimization insights
