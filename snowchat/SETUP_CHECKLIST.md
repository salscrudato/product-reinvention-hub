# SnowChat - First Time Setup Checklist

**Print this page and check off items as you complete them**

---

## ☑️ Prerequisites Installation

- [ ] **Python 3.8+** installed
  - Download: https://www.python.org/downloads/
  - ✅ Check "Add Python to PATH" during installation
  - Test: `python --version`

- [ ] **Node.js 16+** and npm installed
  - Download: https://nodejs.org/ (LTS version)
  - Test: `node --version` and `npm --version`

- [ ] **Git** installed
  - Download: https://git-scm.com/downloads/
  - Test: `git --version`

---

## ☑️ Repository Setup

- [ ] Clone repository to `C:\dev\snowchat`
  ```powershell
  cd C:\dev
  git clone <repo-url> snowchat
  cd snowchat
  ```

---

## ☑️ Credentials & Configuration

- [ ] Obtain **Azure OpenAI** credentials from team lead
  - Endpoint URL: _______________________________
  - API Key: _______________________________
  - Model deployment name: _______________________________

- [ ] Obtain **ServiceNow** credentials from team lead
  - Instance URL: _______________________________
  - Username: _______________________________
  - Password: _______________________________

- [ ] Create `.env` file in project root (`C:\dev\snowchat\.env`)

- [ ] Copy the following template into `.env` and fill in your credentials:
  ```bash
  AZURE_OPENAI_ENDPOINT=https://your-instance.openai.azure.com/
  AZURE_OPENAI_API_KEY=your-key-here
  OPENAI_API_VERSION=2023-05-15
  GPT_MODEL_NAME=gpt-4
  EMBEDDING_MODEL_NAME=text-embedding-ada-002
  
  SERVICENOW_INSTANCE=https://your-instance.service-now.com
  SERVICENOW_USERNAME=your-username
  SERVICENOW_PASSWORD=your-password
  
  SNOWCHAT_CORS_ORIGINS=http://localhost:3000,http://localhost:5001
  ```

- [ ] Verify `.env` file has **NO** placeholders (all values filled in)

---

## ☑️ Dependencies Installation

- [ ] Install Python dependencies
  ```powershell
  pip install -r requirements.txt
  ```
  Expected time: ~2-3 minutes

- [ ] Install Frontend dependencies
  ```powershell
  cd frontend
  npm install
  cd ..
  ```
  Expected time: ~3-5 minutes

---

## ☑️ First Run

- [ ] Start the application
  ```powershell
  .\start-all.ps1 -Quick -NoKeycloak -Backend
  ```

- [ ] Wait for startup messages showing:
  - [ ] Kafka: `false` (skipped - this is expected)
  - [ ] Keycloak: `0` (skipped - this is expected)
  - [ ] Frontend: `1` (started)
  - [ ] Backend Auto: `1` (started)

- [ ] Open browser to http://localhost:3000
  - You should see the SnowChat UI

- [ ] Open browser to http://localhost:5001
  - You should see backend response (may be JSON or blank page)

---

## ☑️ Verification Tests

- [ ] **Test 1: Basic Chat**
  - In the UI, type: `Hello`
  - Response should appear from the AI

- [ ] **Test 2: Backend Logs**
  - Open `snowchat_backend.log` in text editor
  - Should see recent log entries with timestamps

- [ ] **Test 3: Frontend Console**
  - Press F12 in browser
  - Check for any red errors in Console tab
  - Minor warnings are OK, but no critical errors

---

## ☑️ Troubleshooting (if needed)

If you encounter issues, check these:

- [ ] Both terminals (backend and frontend) are still running
- [ ] No error messages in PowerShell windows
- [ ] `.env` file exists and has correct credentials
- [ ] Port 3000 and 5001 are not in use by other apps
- [ ] Python and Node are in system PATH

**Get help:**
- [ ] Check `snowchat_backend.log` for error messages
- [ ] Review [TEAM_SETUP_GUIDE.md](TEAM_SETUP_GUIDE.md) Troubleshooting section
- [ ] Ask in team Slack/Teams channel

---

## ☑️ Optional Components (Do Later)

These can be set up after basic functionality is working:

- [ ] **Kafka** (for event streaming)
  - Not required - system uses file-based spooling by default
  - Install only if doing multi-service development

- [ ] **Keycloak** (for authentication)
  - Not required - auth can be disabled for development
  - Install only if testing authentication flows

- [ ] **Docker Desktop** (for containerized Kafka)
  - Alternative to native Kafka installation
  - Download: https://www.docker.com/products/docker-desktop/

---

## ☑️ Post-Setup

- [ ] Bookmark http://localhost:3000 in browser

- [ ] Add project to IDE/editor
  - Recommended: VS Code with Python and React extensions

- [ ] Review main documentation
  - [ ] Read [README.md](README.md) for architecture overview
  - [ ] Read [QUICK_START.md](QUICK_START.md) for common commands

- [ ] Join team channels
  - [ ] Slack/Teams channel: _______________________________
  - [ ] Add yourself to team roster

- [ ] Schedule pairing session with team member (optional)

---

## 📊 Success Criteria

✅ You've successfully set up SnowChat when you can:

1. Start the application with one command (`.\start-all.ps1 -Quick -NoKeycloak -Backend`)
2. Access the frontend UI at http://localhost:3000
3. Send a chat message and receive a response
4. See log entries in `snowchat_backend.log`
5. All dependencies installed without errors

---

## 🆘 Still Stuck?

**Before asking for help, collect this info:**

1. Output of `python --version`
2. Output of `node --version`
3. Screenshot of any error messages
4. Last 20 lines of `snowchat_backend.log`
5. Browser console errors (F12 → Console tab)

**Then contact:**
- Team lead: _______________________________
- Slack/Teams channel: _______________________________
- Email: _______________________________

---

**Date Completed:** _______________  
**Completed By:** _______________  
**Verified By:** _______________ _(Team Lead/Mentor)_

---

**Congratulations! You're ready to start developing with SnowChat! 🎉**
