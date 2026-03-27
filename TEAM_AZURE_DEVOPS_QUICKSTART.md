# Team Quick Start - Azure DevOps

**For team members cloning the repository from Azure DevOps**

---

## 🚀 Get Started in 5 Minutes

### Step 1: Get Access

Contact your team lead to:
- ✅ Grant you access to the Azure DevOps project
- ✅ Provide the repository URL
- ✅ Share credentials or PAT instructions

### Step 2: Clone Repository

```powershell
# Navigate to your dev folder
cd C:\dev

# Clone from Azure DevOps
git clone https://your-organization@dev.azure.com/your-organization/SnowChat/_git/snowchat

# Navigate to project
cd snowchat
```

**Replace `your-organization` with your actual Azure DevOps organization name!**

### Step 3: Setup Environment

```powershell
# Install Python dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd frontend
npm install
cd ..

# Create .env file (ask team lead for credentials)
# Copy .env.example or get from team shared location
```

### Step 4: Run Application

```powershell
# Start everything
.\start-all.ps1 -Quick -NoKeycloak -Backend

# Open browser to http://localhost:3000
```

---

## 📝 Daily Development Workflow

### Start Your Day

```powershell
# Navigate to project
cd C:\dev\snowchat

# Update your local repository
git checkout develop
git pull origin develop
```

### Work on a Feature

```powershell
# Create feature branch
git checkout -b feature/my-new-feature

# Make your changes
# ... edit files ...

# Check what changed
git status

# Add and commit
git add .
git commit -m "feat: Add my new feature"

# Push to Azure DevOps
git push -u origin feature/my-new-feature
```

### Create Pull Request

1. Go to Azure DevOps: `https://dev.azure.com/your-org/SnowChat/_git/snowchat`
2. Click **Pull Requests** in left menu
3. Click **New Pull Request**
4. Select your branch → develop
5. Fill in description
6. Add reviewers
7. Click **Create**

### After PR is Approved

```powershell
# Switch back to develop
git checkout develop

# Pull latest (includes your merged changes)
git pull origin develop

# Delete local feature branch
git branch -d feature/my-new-feature
```

---

## 🔐 Authentication

### Option 1: Personal Access Token (Recommended)

1. **Create PAT:**
   - Go to Azure DevOps → Click your profile icon (top right)
   - **Personal access tokens** → **+ New Token**
   - Name: `Development Machine`
   - Scopes: Code (Read, Write, & Manage)
   - Click **Create**
   - **COPY THE TOKEN** (shown only once!)

2. **Use PAT:**
   - When Git prompts for password, paste your PAT
   - Windows will cache it automatically

### Option 2: Let Windows Manage (Easiest)

```powershell
# Configure credential helper
git config --global credential.helper wincred

# On first push/pull, enter your Azure DevOps credentials
# Windows will remember them
```

---

## 🛠️ Common Commands

| Task | Command |
|------|---------|
| Check status | `git status` |
| View branches | `git branch -a` |
| Switch branch | `git checkout branch-name` |
| Create branch | `git checkout -b feature/name` |
| Pull latest | `git pull origin develop` |
| Commit changes | `git add .` then `git commit -m "message"` |
| Push branch | `git push -u origin branch-name` |
| View log | `git log --oneline` |
| Undo changes | `git checkout -- .` |

---

## 📚 Resources

### Documentation
- **Setup Guide:** [COMPLETE_SETUP_GUIDE.md](COMPLETE_SETUP_GUIDE.md)
- **Azure DevOps Guide:** [AZURE_DEVOPS_MIGRATION_GUIDE.md](AZURE_DEVOPS_MIGRATION_GUIDE.md)
- **Project README:** [README.md](README.md)

### URLs
- **Azure DevOps:** `https://dev.azure.com/your-org/SnowChat`
- **Repository:** `https://dev.azure.com/your-org/SnowChat/_git/snowchat`
- **Pull Requests:** `https://dev.azure.com/your-org/SnowChat/_git/snowchat/pullrequests`
- **Pipelines:** `https://dev.azure.com/your-org/SnowChat/_build`

### Support
- **Team Lead:** ____________________
- **Slack/Teams:** ____________________
- **Azure DevOps Admin:** ____________________

---

## ⚠️ Important Notes

### DO NOT Commit These Files:
- `.env` (contains secrets!)
- `state_db.json` (local database)
- `*.log` files
- `node_modules/` (automatically excluded)
- `__pycache__/` (automatically excluded)

### Always:
- ✅ Pull before starting work
- ✅ Create feature branches
- ✅ Write meaningful commit messages
- ✅ Create Pull Requests (don't push to main/develop directly)
- ✅ Get code reviewed before merging

### Never:
- ❌ Commit API keys or passwords
- ❌ Push directly to `main` or `develop`
- ❌ Force push to shared branches
- ❌ Commit large binary files without Git LFS

---

## 🆘 Troubleshooting

### "Authentication failed"
```powershell
# Clear cached credentials
git credential reject
# Enter: host=dev.azure.com
# Next push will prompt for new credentials
```

### "Push rejected - branch is protected"
This is expected! Create a Pull Request instead:
1. Push your feature branch
2. Create PR in web portal
3. Get approval
4. Merge via PR

### "Merge conflict"
```powershell
# Update your branch with latest develop
git checkout develop
git pull origin develop
git checkout feature/your-branch
git merge develop

# Resolve conflicts in VS Code
# Then commit the merge
git add .
git commit -m "Merge develop and resolve conflicts"
git push
```

### "Can't find repository"
- Verify you have access in Azure DevOps
- Check the URL is correct
- Ensure you're authenticated

### "Port already in use"
```powershell
# Find and kill process on port 5001
netstat -ano | findstr :5001
taskkill /PID <PID> /F
```

---

## ✅ Quick Checklist

**First Time Setup:**
- [ ] Azure DevOps access granted
- [ ] Repository cloned
- [ ] Python dependencies installed
- [ ] Frontend dependencies installed
- [ ] `.env` file created with credentials
- [ ] Application runs successfully

**Before Each Work Session:**
- [ ] `git checkout develop`
- [ ] `git pull origin develop`
- [ ] `git checkout -b feature/my-work`

**After Completing Work:**
- [ ] `git add .`
- [ ] `git commit -m "descriptive message"`
- [ ] `git push -u origin feature/my-work`
- [ ] Create Pull Request in Azure DevOps
- [ ] Request code review

---

**Welcome to the team! Happy coding! 🎉**

---

*For detailed information, see [AZURE_DEVOPS_MIGRATION_GUIDE.md](AZURE_DEVOPS_MIGRATION_GUIDE.md)*
