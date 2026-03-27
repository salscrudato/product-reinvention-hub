# SnowChat - Quick Start Guide

**For team members who just want to get running fast!**

## ⚡ TL;DR - Get Running in 5 Minutes

### 1. Prerequisites
```powershell
# Check you have these installed:
python --version   # Need 3.8+
node --version     # Need 16+
npm --version
```

### 2. Clone & Configure
```powershell
cd C:\dev
git clone <repo-url> snowchat
cd snowchat

# Create .env file with your credentials (see example below)
```

### 3. Run Everything
```powershell
# This one command starts everything you need:
.\start-all.ps1 -Quick -NoKeycloak -Backend

# Wait 30 seconds, then open: http://localhost:3000
```

---

## 📝 Minimum .env File

Create `.env` file in the `snowchat/` root directory:

```bash
# Azure OpenAI (REQUIRED)
AZURE_OPENAI_ENDPOINT=https://your-instance.openai.azure.com/
AZURE_OPENAI_API_KEY=your-key-here
OPENAI_API_VERSION=2023-05-15
GPT_MODEL_NAME=gpt-4
EMBEDDING_MODEL_NAME=text-embedding-ada-002

# ServiceNow (REQUIRED if using incident features)
SERVICENOW_INSTANCE=https://your-instance.service-now.com
SERVICENOW_USERNAME=your-username
SERVICENOW_PASSWORD=your-password

# CORS (REQUIRED)
SNOWCHAT_CORS_ORIGINS=http://localhost:3000,http://localhost:5001
```

**Replace the placeholders with your actual credentials!**

---

## 🎯 What the Quick Start Does

| Component | Status | Port | Notes |
|-----------|--------|------|-------|
| Backend | ✅ Auto-started | 5001 | Flask API |
| Frontend | ✅ Auto-started | 3000 | React UI |
| Kafka | ⏭️ Skipped | - | Uses file spooling instead |
| Keycloak | ⏭️ Skipped | - | Auth disabled |

---

## 🔥 Common Commands

```powershell
# Start everything (recommended for development)
.\start-all.ps1 -Quick -NoKeycloak -Backend

# Stop everything (close all terminal windows or Ctrl+C each)

# View logs
Get-Content .\snowchat_backend.log -Wait -Tail 50

# Restart just backend
cd backend
python app.py

# Restart just frontend
cd frontend
npm start
```

---

## 🚨 Quick Troubleshooting

### "Port 5001 already in use"
```powershell
# Find and kill the process
netstat -ano | findstr :5001
taskkill /PID <PID> /F
```

### "Module not found" errors
```powershell
# Backend
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

### "Azure OpenAI 404 error"
- Check that `GPT_MODEL_NAME` matches your Azure **deployment name**, not the model name
- Verify `AZURE_OPENAI_ENDPOINT` is correct

### "Nothing happens when I type"
- Make sure both backend (5001) and frontend (3000) are running
- Check browser console for errors (F12)
- Verify `.env` file exists and has valid credentials

---

## 📱 Where to Go

- **Full Documentation:** See [TEAM_SETUP_GUIDE.md](TEAM_SETUP_GUIDE.md)
- **Main README:** See [README.md](README.md)
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:5001
- **Logs:** `snowchat_backend.log` and `agentic_orchestrator_auto.log`

---

## 🎓 First Things to Try

1. **Basic Chat:** Type a question in the UI
2. **Wiki Search:** Try `@wiki how to reset password`
3. **Code Search:** Try `@code authentication function`
4. **ServiceNow:** Type "show me incident INC0012345"

---

## 💡 Pro Tips

- **Frontend hot-reloads automatically** - just save your React files
- **Backend needs manual restart** - Ctrl+C and `python backend/app.py`
- **Logs are your friend** - Always check `snowchat_backend.log` first
- **Clear the database** - Delete `state_db.json` to reset everything
- **No Kafka needed** - The `-Quick` flag uses file-based event logging

---

**That's it! You're ready to go. See you in Slack if you need help! 🚀**
