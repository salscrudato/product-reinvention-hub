# SnowChat Setup Documentation

**Welcome to SnowChat!** This directory contains everything your team needs to get up and running.

---

## 📚 Documentation Overview

We've created three guides to match different learning styles and needs:

### 1️⃣ [QUICK_START.md](QUICK_START.md) - **Start Here!**
**Best for:** Developers who want to get running FAST

- ⏱️ **Time to read:** 2 minutes
- 🎯 **Goal:** Get the app running in 5 minutes
- 📋 **Contains:** Minimal setup, common commands, quick troubleshooting

**Use this if:** You're experienced with Python/Node and just need the basics.

---

### 2️⃣ [TEAM_SETUP_GUIDE.md](TEAM_SETUP_GUIDE.md) - **Complete Reference**
**Best for:** Detailed setup and comprehensive troubleshooting

- ⏱️ **Time to read:** 15 minutes
- 🎯 **Goal:** Understand the full system and handle any issues
- 📋 **Contains:** 
  - Detailed prerequisites and installation steps
  - Complete environment variable reference
  - Architecture overview
  - Comprehensive troubleshooting section
  - Command reference
  - Development tips and best practices

**Use this if:** 
- You're new to Python or Node development
- You're encountering issues during setup
- You want to understand how the system works
- You need to configure optional components (Kafka, Keycloak)

---

### 3️⃣ [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md) - **Printable Checklist**
**Best for:** First-time setup with step-by-step verification

- ⏱️ **Time to complete:** 20-30 minutes (first time)
- 🎯 **Goal:** Ensure nothing is missed during setup
- 📋 **Contains:**
  - Checkbox format for tracking progress
  - Credential gathering section
  - Verification tests
  - Success criteria
  - Troubleshooting info collection

**Use this if:**
- This is your first time setting up the project
- You want to verify each step as you go
- You're doing onboarding/training
- You want a printable reference

---

## 🚀 Quick Decision Guide

**Choose your path:**

```
┌─────────────────────────────────────────────────┐
│ Have you set up Python/Node projects before?    │
└─────────────────┬───────────────────────────────┘
                  │
         ┌────────┴────────┐
         │                 │
        YES               NO
         │                 │
         ▼                 ▼
    QUICK_START.md    SETUP_CHECKLIST.md
         │                 │
         │                 │
    ┌────┴────┐           │
    │ Works?  │           │
    └────┬────┘           │
         │                │
    ┌────┴────┐           │
   YES       NO           │
    │         │           │
    │         └───────────┴──────────┐
    │                                │
    ▼                                ▼
 You're ready!           TEAM_SETUP_GUIDE.md
                         (Troubleshooting section)
```

---

## 📖 Additional Resources

### Main Project Documentation
- **[README.md](README.md)** - Full project overview, architecture, and features
- **[AGENTIC_AI_PROJECT_INTENTION.md](AGENTIC_AI_PROJECT_INTENTION.md)** - Project vision and goals
- **[.github/copilot-instructions.md](.github/copilot-instructions.md)** - Development guidelines and patterns

### Configuration Files
- **[annotation_commands.json](annotation_commands.json)** - Available @ commands for workflows
- **[requirements.txt](requirements.txt)** - Python dependencies
- **[frontend/package.json](frontend/package.json)** - Node dependencies

---

## 🎯 Recommended Setup Process

### For New Team Members:

1. **Read** [QUICK_START.md](QUICK_START.md) (2 min)
2. **Follow** [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md) (20-30 min)
3. **Reference** [TEAM_SETUP_GUIDE.md](TEAM_SETUP_GUIDE.md) if you hit issues
4. **Test** basic functionality (5 min)
5. **Review** main [README.md](README.md) to understand features (15 min)

**Total time:** ~45-60 minutes for complete onboarding

---

### For Experienced Developers:

1. **Read** [QUICK_START.md](QUICK_START.md) (2 min)
2. **Run** `.\start-all.ps1 -Quick -NoKeycloak -Backend` (1 min)
3. **Done!** Refer to other docs only if needed

**Total time:** ~5-10 minutes

---

## 🆘 When Things Go Wrong

### Error Occurred During Setup?

1. **First:** Check the specific error message
2. **Then:** Look in the Troubleshooting section of [TEAM_SETUP_GUIDE.md](TEAM_SETUP_GUIDE.md)
3. **Still stuck?** Collect info from the "Still Stuck?" section in [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md)
4. **Get help:** Contact team lead or post in team channel with the collected info

### Common Issues Quick Links

| Issue | See |
|-------|-----|
| Port already in use | [TEAM_SETUP_GUIDE.md - Troubleshooting #3](TEAM_SETUP_GUIDE.md#3-port-already-in-use) |
| Module not found | [TEAM_SETUP_GUIDE.md - Troubleshooting #1-2](TEAM_SETUP_GUIDE.md#1-backend-wont-start) |
| Azure OpenAI 404 | [TEAM_SETUP_GUIDE.md - Troubleshooting #5](TEAM_SETUP_GUIDE.md#5-azure-openai-404-errors) |
| CORS errors | [TEAM_SETUP_GUIDE.md - Troubleshooting #4](TEAM_SETUP_GUIDE.md#4-cors-errors-in-browser) |
| Nothing happens | [QUICK_START.md - Troubleshooting](QUICK_START.md#-quick-troubleshooting) |

---

## 📝 Document Maintenance

### For Team Leads / Documentation Maintainers:

**Keep these docs updated when:**
- Prerequisites change (new software required)
- Environment variables are added/removed
- Startup process changes
- New common issues are discovered
- Team gets recurring questions (add to FAQ/troubleshooting)

**Update all three docs** to keep them in sync, especially:
- Ports (if changed)
- Required environment variables
- Startup commands
- Credential sources

---

## 🤝 Contributing

Found an issue in the docs? Have a suggestion?

1. Create an issue or PR
2. Tag it with `documentation`
3. Describe what's unclear or wrong
4. Suggest improvements

---

## 📞 Support Contacts

- **Team Lead:** ________________
- **Slack/Teams Channel:** ________________
- **Email:** ________________
- **Office Hours:** ________________

---

## ✅ After Successful Setup

Once you're up and running:

1. ⭐ Bookmark the [QUICK_START.md](QUICK_START.md) for daily commands
2. 📚 Read the main [README.md](README.md) to understand the architecture
3. 🎓 Try the example queries in [QUICK_START.md - First Things to Try](QUICK_START.md#-first-things-to-try)
4. 👥 Introduce yourself in the team channel
5. 📅 Schedule a pairing session with a team member (optional but recommended)

---

**Welcome to the team! Happy coding! 🚀**

---

*Last updated: March 27, 2026*
