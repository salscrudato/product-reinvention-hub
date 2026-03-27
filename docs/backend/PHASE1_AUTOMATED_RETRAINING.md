# Phase 1: Automated ML Retraining Pipeline

**Implementation Date:** January 20, 2026  
**Status:** ✅ Complete

## Overview

Phase 1 implements automated retraining infrastructure for the ML intent classifier, including:
1. **Automated retraining pipeline** with validation and rollback
2. **Log rotation** to prevent unbounded log file growth
3. **Windows Task Scheduler integration** for weekly execution

This eliminates manual intervention while ensuring model quality through validation gates.

---

## Components

### 1. Retraining Pipeline (`scripts/retrain_pipeline.py`)

**Purpose:** Orchestrates complete retraining workflow with quality gates

**Workflow:**
```
1. Check if retraining needed (>=50 new examples)
   ↓ YES
2. Backup current model (timestamped)
   ↓
3. Train new model with validation
   ↓
4. Compare accuracy: new >= current?
   ↓ YES
5. Deploy new model
   ↓
6. Send notification
```

**Key Features:**
- **Smart triggering:** Only retrain with >=50 new examples (configurable)
- **Model validation:** Deploy only if accuracy >= current model
- **Automatic rollback:** Restore previous model if validation fails
- **Backup management:** Keep last 3 model versions
- **Notification ready:** Logging infrastructure for email/Slack (TODO: integrate)

**Usage:**
```bash
# Normal execution (checks if retraining needed)
python scripts/retrain_pipeline.py

# Force retraining regardless of new examples
python scripts/retrain_pipeline.py --force

# Enable notifications (requires integration setup)
python scripts/retrain_pipeline.py --notify

# Custom threshold
python scripts/retrain_pipeline.py --min-new-examples 30
```

**Configuration:**
```python
# In RetrainPipeline class
self.min_new_examples = 50        # Minimum new examples to trigger
self.max_model_backups = 3        # Keep last N backups
self.min_accuracy_improvement = 0.0  # Deploy if >= current (no degradation)
```

**Output Files:**
- `retrain_pipeline.log` - Full execution log
- `models/backup_YYYYMMDD_HHMMSS/` - Model backups
- `models/intent_classifier_*.pkl` - Current production model

### 2. Log Rotation (`components/agentic_orchestrator_auto.py`)

**Purpose:** Prevent log file from growing unbounded

**Configuration:**
```python
from logging.handlers import RotatingFileHandler

fh = RotatingFileHandler(
    'agentic_orchestrator_auto.log',
    maxBytes=50 * 1024 * 1024,  # 50MB per file
    backupCount=5               # Keep 5 backup files
)
```

**Behavior:**
- Main log: `agentic_orchestrator_auto.log` (active, up to 50MB)
- Rotated logs: `agentic_orchestrator_auto.log.1` through `.5`
- Total disk usage: ~250MB max (50MB × 5 backups)
- Automatic rotation when main log reaches 50MB

**Log Lifecycle:**
```
agentic_orchestrator_auto.log (active, 48MB)
  ↓ New entries push it to 50MB
agentic_orchestrator_auto.log.1 (50MB, renamed from main)
agentic_orchestrator_auto.log (0KB, new file)
  ↓ Continues until main reaches 50MB again
agentic_orchestrator_auto.log.2 (renamed from .1)
agentic_orchestrator_auto.log.1 (renamed from main)
agentic_orchestrator_auto.log (new file)
  ↓ After 5 rotations
agentic_orchestrator_auto.log.5 (oldest, will be deleted next rotation)
```

### 3. Windows Task Scheduler Setup (`scripts/setup_windows_scheduler.ps1`)

**Purpose:** Automate weekly retraining execution on Windows

**Default Configuration:**
- **Schedule:** Weekly on Sunday at 2:00 AM
- **Retry:** Up to 3 attempts, 10-minute intervals
- **Timeout:** 2 hours max execution time
- **Power:** Run even on battery, don't stop if unplugged
- **Network:** Only run if network available

**Setup:**
```powershell
# Basic setup (weekly Sunday 2 AM)
.\scripts\setup_windows_scheduler.ps1

# Custom schedule
.\scripts\setup_windows_scheduler.ps1 -DayOfWeek Saturday -Time "03:00"

# Force overwrite existing task
.\scripts\setup_windows_scheduler.ps1 -Force

# Create task and run immediately for testing
.\scripts\setup_windows_scheduler.ps1 -RunNow
```

**Task Management Commands:**
```powershell
# View task details
Get-ScheduledTask -TaskName "SnowChat_ML_Retraining"

# Run task manually
Start-ScheduledTask -TaskName "SnowChat_ML_Retraining"

# Check last run status
Get-ScheduledTask -TaskName "SnowChat_ML_Retraining" | Get-ScheduledTaskInfo

# View task history in Event Viewer
Get-WinEvent -LogName "Microsoft-Windows-TaskScheduler/Operational" | Where-Object { $_.Message -like "*SnowChat*" } | Select-Object -First 10

# Remove task
Unregister-ScheduledTask -TaskName "SnowChat_ML_Retraining" -Confirm:$false
```

**Task Verification:**
```powershell
# Check if task exists and is enabled
$task = Get-ScheduledTask -TaskName "SnowChat_ML_Retraining"
$task.State  # Should show "Ready"

# View next scheduled run time
$taskInfo = $task | Get-ScheduledTaskInfo
$taskInfo.NextRunTime

# Check last run result (0 = success)
$taskInfo.LastTaskResult
```

---

## Installation & Setup

### Step 1: Verify Environment
```bash
# Ensure scikit-learn is installed
pip list | grep scikit-learn

# Verify training data exists
python scripts/extract_training_data_from_logs.py
# Should create training_data_extracted.json with examples
```

### Step 2: Test Pipeline Manually
```bash
cd backend

# Test retraining (will skip if not enough new data)
python scripts/retrain_pipeline.py

# Force a training run for testing
python scripts/retrain_pipeline.py --force

# Check logs
cat retrain_pipeline.log
```

### Step 3: Setup Windows Task Scheduler
```powershell
cd c:\dev\snowchat\backend

# Create scheduled task
.\scripts\setup_windows_scheduler.ps1

# Verify task was created
Get-ScheduledTask -TaskName "SnowChat_ML_Retraining"

# Run task immediately to test
Start-ScheduledTask -TaskName "SnowChat_ML_Retraining"

# Wait 30 seconds, then check result
Start-Sleep -Seconds 30
Get-ScheduledTask -TaskName "SnowChat_ML_Retraining" | Get-ScheduledTaskInfo
```

### Step 4: Monitor First Automatic Run
```powershell
# Check when next run is scheduled
Get-ScheduledTask -TaskName "SnowChat_ML_Retraining" | Get-ScheduledTaskInfo | Select-Object NextRunTime

# After scheduled run completes, check logs
Get-Content backend\retrain_pipeline.log -Tail 100

# Verify model was updated
Get-ChildItem backend\models\ -Filter "intent_classifier_*" | Select-Object Name, LastWriteTime
```

---

## Monitoring & Maintenance

### Key Metrics to Track

**Retraining Frequency:**
```bash
# Count retraining attempts
grep "Starting Automated Retraining Pipeline" retrain_pipeline.log | wc -l

# Count successful retrains
grep "Retraining pipeline completed successfully" retrain_pipeline.log | wc -l

# Count skipped retrains (not enough data)
grep "Skipping retraining" retrain_pipeline.log | wc -l
```

**Model Performance Trend:**
```bash
# Extract accuracy from training logs
grep "Test Accuracy:" retrain_pipeline.log

# View model validation results
grep "Model comparison:" retrain_pipeline.log
```

**Log File Growth:**
```powershell
# Check main log size
(Get-Item agentic_orchestrator_auto.log).Length / 1MB

# Check all rotated logs
Get-ChildItem agentic_orchestrator_auto.log* | Select-Object Name, @{Name="SizeMB";Expression={[math]::Round($_.Length / 1MB, 2)}}

# Total log disk usage
(Get-ChildItem agentic_orchestrator_auto.log* | Measure-Object -Property Length -Sum).Sum / 1MB
```

**Model Backup Health:**
```powershell
# List model backups (should have <= 3)
Get-ChildItem backend\models\backup_* -Directory | Select-Object Name, CreationTime

# Verify backup contents
Get-ChildItem backend\models\backup_*\* | Select-Object Directory, Name
```

### Alert Conditions

**Set up monitoring for:**

1. **Retraining Failures (Critical)**
   - Grep: `"Training failed, rolling back"`
   - Action: Check Python environment, training data quality

2. **Model Validation Failures (Warning)**
   - Grep: `"Model validation failed"`
   - Action: Review training data, consider increasing min_examples threshold

3. **Log File Not Rotating (Warning)**
   - Check: Main log size > 50MB
   - Action: Verify RotatingFileHandler configuration

4. **No Retraining for 30+ Days (Info)**
   - Check: Last successful retrain timestamp
   - Action: Verify user activity, data collection pipeline

5. **Disk Space Low (Critical)**
   - Check: Total log + model backup usage > 1GB
   - Action: Adjust backupCount or maxBytes

### Troubleshooting

**Problem: Task doesn't run**
```powershell
# Check task status
Get-ScheduledTask -TaskName "SnowChat_ML_Retraining" | Select-Object State, TaskName

# Check task trigger
Get-ScheduledTask -TaskName "SnowChat_ML_Retraining" | Select-Object -ExpandProperty Triggers

# View task action
Get-ScheduledTask -TaskName "SnowChat_ML_Retraining" | Select-Object -ExpandProperty Actions

# Check last run result
$info = Get-ScheduledTask -TaskName "SnowChat_ML_Retraining" | Get-ScheduledTaskInfo
$info.LastTaskResult  # 0 = success, other = error code
```

**Problem: Training fails with stratification error**
```bash
# Solution: Lower min_examples threshold in train_intent_classifier.py
python scripts/train_intent_classifier.py --min-examples 2

# Or filter rare intents in retrain_pipeline.py (already implemented)
```

**Problem: Logs not rotating**
```python
# Verify RotatingFileHandler in agentic_orchestrator_auto.py
# Check handler configuration:
import logging
logger = logging.getLogger("agentic_orchestrator_auto")
for handler in logger.handlers:
    print(f"{type(handler).__name__}: {handler}")
```

**Problem: Model accuracy declining**
```bash
# Check training data quality
python scripts/analyze_training_data.py

# Review recent training results
grep -A 10 "Classification Report:" retrain_pipeline.log | tail -20

# Manual retrain with validation
python scripts/retrain_pipeline.py --force
```

---

## Next Steps (Phase 2 & 3)

### Phase 2: Elasticsearch Integration (Future)
- Structured logging to ES index
- Query-based training data extraction
- Kibana dashboards for observability
- Real-time monitoring and alerting

### Phase 3: MLOps Infrastructure (Future)
- MLflow experiment tracking
- Model registry with versioning
- A/B testing framework
- Automated canary deployments
- Feature store for consistent feature engineering

---

## Configuration Reference

### Environment Variables (Optional)

```bash
# Minimum confidence threshold for ML predictions (default: 0.6)
export ML_INTENT_CONFIDENCE_THRESHOLD=0.7

# Enable notification integrations (requires implementation)
export RETRAIN_NOTIFY_EMAIL=devops@company.com
export RETRAIN_NOTIFY_SLACK_WEBHOOK=https://hooks.slack.com/services/...
```

### Tunable Parameters

**Retraining Trigger:**
```python
# scripts/retrain_pipeline.py
pipeline.min_new_examples = 50  # Lower = more frequent retraining
```

**Model Validation:**
```python
# scripts/retrain_pipeline.py
pipeline.min_accuracy_improvement = 0.0  # Require no degradation
# Set to 0.05 to require 5% improvement before deployment
```

**Log Rotation:**
```python
# components/agentic_orchestrator_auto.py
maxBytes=50 * 1024 * 1024  # 50MB per file
backupCount=5              # Keep 5 rotated files
```

**Backup Retention:**
```python
# scripts/retrain_pipeline.py
pipeline.max_model_backups = 3  # Keep last 3 model versions
```

---

## File Structure

```
backend/
├── components/
│   └── agentic_orchestrator_auto.py    # [MODIFIED] Added log rotation
├── scripts/
│   ├── retrain_pipeline.py             # [NEW] Main retraining orchestrator
│   ├── setup_windows_scheduler.ps1     # [NEW] Task scheduler setup
│   ├── extract_training_data_from_logs.py  # [EXISTING] Used by pipeline
│   └── train_intent_classifier.py      # [EXISTING] Used by pipeline
├── models/
│   ├── intent_classifier_model.pkl
│   ├── intent_classifier_vectorizer.pkl
│   ├── intent_classifier_labels.pkl
│   ├── intent_classifier_metadata.json
│   ├── training_info.json
│   └── backup_YYYYMMDD_HHMMSS/        # Auto-created by pipeline
│       ├── intent_classifier_model.pkl
│       └── ...
├── agentic_orchestrator_auto.log       # Active log (up to 50MB)
├── agentic_orchestrator_auto.log.1     # Rotated log 1
├── agentic_orchestrator_auto.log.2     # Rotated log 2
├── ...
└── retrain_pipeline.log                # Retraining execution log
```

---

## Success Criteria ✅

- [x] Automated retraining pipeline implemented
- [x] Model validation with rollback on degradation
- [x] Backup management (keep last 3 versions)
- [x] Log rotation configured (50MB × 5 files)
- [x] Windows Task Scheduler integration
- [x] Comprehensive documentation
- [ ] First automated retraining successful (pending scheduled run)
- [ ] Notification integration (email/Slack) - TODO Phase 2

---

## Testing Checklist

Before production deployment:

```powershell
# 1. Test manual retraining
cd c:\dev\snowchat\backend
python scripts\retrain_pipeline.py --force

# 2. Verify backup creation
Get-ChildItem models\backup_* | Select-Object Name

# 3. Test model rollback (simulate failure)
# Temporarily break training, run pipeline, verify rollback

# 4. Test log rotation
# Generate large log entries, verify rotation at 50MB

# 5. Test Windows Task Scheduler
.\scripts\setup_windows_scheduler.ps1 -RunNow
Start-Sleep -Seconds 60
Get-Content retrain_pipeline.log -Tail 20

# 6. Verify scheduled task
Get-ScheduledTask -TaskName "SnowChat_ML_Retraining" | Get-ScheduledTaskInfo
```

---

## Rollback Procedure

If automated retraining causes issues:

```powershell
# 1. Disable scheduled task immediately
Disable-ScheduledTask -TaskName "SnowChat_ML_Retraining"

# 2. Manually rollback to previous model
cd c:\dev\snowchat\backend
python -c "from scripts.retrain_pipeline import RetrainPipeline; from pathlib import Path; p = RetrainPipeline(Path.cwd()); p.rollback_model()"

# 3. Verify rollback
python scripts\test_hybrid_classifier.py

# 4. Investigate issue
Get-Content retrain_pipeline.log -Tail 100

# 5. After fix, re-enable task
Enable-ScheduledTask -TaskName "SnowChat_ML_Retraining"
```

---

## Support & Troubleshooting

**Logs Location:**
- Retraining: `backend/retrain_pipeline.log`
- Application: `backend/agentic_orchestrator_auto.log*`
- Task Scheduler: Event Viewer → Applications and Services → Microsoft → Windows → TaskScheduler

**Common Issues:**
- "Training failed" → Check Python environment, verify training data exists
- "Model validation failed" → Training data quality issue, consider lowering threshold
- Task doesn't run → Verify Python path in task action, check user permissions
- Log not rotating → Restart Flask app to reinitialize logger with RotatingFileHandler

**Contact:**
- Developer: See git blame for components/agentic_orchestrator_auto.py
- Documentation: This file (PHASE1_AUTOMATED_RETRAINING.md)
