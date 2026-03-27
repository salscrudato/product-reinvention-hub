# SnowChat - New Team Member Quick Reference

**One-page reference for your first day**

---

## 🎯 Your Mission: Get SnowChat Running

### Prerequisites (5 min install if needed)
- Python 3.8+ → https://www.python.org/downloads/
- Node.js 16+ → https://nodejs.org/
- Git → https://git-scm.com/downloads/

### Get the Code (1 min)
```powershell
cd C:\dev
git clone <repo-url> snowchat
cd snowchat
```

### Get Credentials (Ask Team Lead)
You need:
- ✉️ Azure OpenAI endpoint + API key
- 🔧 ServiceNow instance + username + password

### Configure (2 min)
Create `C:\dev\snowchat\.env`:
```bash
AZURE_OPENAI_ENDPOINT=https://your-instance.openai.azure.com/
AZURE_OPENAI_API_KEY=your-key
OPENAI_API_VERSION=2023-05-15
GPT_MODEL_NAME=gpt-4
EMBEDDING_MODEL_NAME=text-embedding-ada-002
SERVICENOW_INSTANCE=https://your-instance.service-now.com
SERVICENOW_USERNAME=your-username
SERVICENOW_PASSWORD=your-password
SNOWCHAT_CORS_ORIGINS=http://localhost:3000,http://localhost:5001
```

### Install & Run (5 min)
```powershell
# Install dependencies
pip install -r requirements.txt
cd frontend
npm install
cd ..

# Start everything
.\start-all.ps1 -Quick -NoKeycloak -Backend
```

### Verify (1 min)
Open http://localhost:3000 → Type "Hello" → Get AI response ✅

---

## 💻 Daily Development Commands

| Task | Command |
|------|---------|
| Start everything | `.\start-all.ps1 -Quick -NoKeycloak -Backend` |
| View logs | `Get-Content .\snowchat_backend.log -Wait -Tail 50` |
| Restart backend | `cd backend` → `python app.py` |
| Restart frontend | `cd frontend` → `npm start` |

---

## 🚨 Common Fixes

| Problem | Solution |
|---------|----------|
| Port in use | `netstat -ano \| findstr :5001` → `taskkill /PID <PID> /F` |
| Module error | `pip install -r requirements.txt` |
| No response | Check both terminals running + `.env` credentials |
| Azure 404 | `GPT_MODEL_NAME` = deployment name (not model name) |

---

## 📚 Where to Find Stuff

- **Full Setup Guide:** [TEAM_SETUP_GUIDE.md](TEAM_SETUP_GUIDE.md)
- **Quick Reference:** [QUICK_START.md](QUICK_START.md)
- **Setup Checklist:** [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md)
- **Main Docs:** [README.md](README.md)
- **Logs:** `snowchat_backend.log` + `agentic_orchestrator_auto.log`

---

## 🎓 Try These First

1. **Basic chat:** Just type a question
2. **Wiki search:** `@wiki how to reset password`
3. **Code search:** `@code authentication`
4. **ServiceNow:** `show me incident INC0012345`

---

## 📞 Get Help

- **Team Channel:** ________________
- **Team Lead:** ________________
- **Pair Partner:** ________________

---

## ✅ Success Checklist

- [ ] Python, Node, Git installed
- [ ] Repository cloned
- [ ] `.env` file created with credentials
- [ ] Dependencies installed (`pip` + `npm`)
- [ ] App starts with one command
- [ ] Frontend loads at :3000
- [ ] Chat works (type "Hello")
- [ ] Logs are visible
- [ ] Read main README.md
- [ ] Joined team channel

---

**You've got this! See you in the codebase! 👋**

---

*Print this page for your desk reference • Updated: March 2026*
