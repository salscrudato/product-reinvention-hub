# SnowChat - Azure DevOps Migration Guide

**Moving Your Code to Azure DevOps**

**Last Updated:** March 27, 2026  
**Document Status:** Official Migration Guide

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Azure DevOps Setup](#azure-devops-setup)
4. [Initial Code Push](#initial-code-push)
5. [Team Onboarding](#team-onboarding)
6. [Branch Strategy](#branch-strategy)
7. [CI/CD Pipeline Setup](#cicd-pipeline-setup)
8. [Best Practices](#best-practices)
9. [Common Commands](#common-commands)
10. [Troubleshooting](#troubleshooting)

---

## Overview

This guide walks you through migrating your existing SnowChat codebase to Azure DevOps (Azure Repos).

**What you'll do:**
- ✅ Create Azure DevOps project and repository
- ✅ Configure local Git to point to Azure DevOps
- ✅ Push existing code to Azure DevOps
- ✅ Set up branch policies and permissions
- ✅ Onboard team members
- ✅ (Optional) Configure CI/CD pipelines

**Time required:** 30-60 minutes for initial setup

---

## Prerequisites

### Before You Start

- [ ] Azure DevOps organization created
- [ ] Administrative access to Azure DevOps
- [ ] Git installed locally (`git --version`)
- [ ] Code committed locally (check with `git status`)
- [ ] Team member list and email addresses
- [ ] Azure DevOps license assignments (if needed)

### Required Information

Gather these from your Azure DevOps administrator:

- **Organization URL:** `https://dev.azure.com/your-organization`
- **Project Name:** (e.g., "SnowChat" or "AI-Platform")
- **Repository Name:** (e.g., "snowchat" or "snowchat-main")

---

## Azure DevOps Setup

### Step 1: Create Azure DevOps Project

#### Option A: Via Web Portal (Recommended for First Time)

1. **Navigate to Azure DevOps**
   ```
   https://dev.azure.com/your-organization
   ```

2. **Create New Project**
   - Click **"+ New Project"** (top right)
   - Fill in details:
     - **Project name:** `SnowChat`
     - **Description:** `Enterprise Agentic AI Platform for Incident Management`
     - **Visibility:** 
       - `Private` (recommended for enterprise code)
       - `Public` (only if open source)
     - **Version control:** `Git` ✅
     - **Work item process:** `Agile` (or your preference)
   - Click **"Create"**

3. **Verify Project Creation**
   - You'll be redirected to the project dashboard
   - Note the project URL: `https://dev.azure.com/your-org/SnowChat`

#### Option B: Via Azure CLI (Advanced)

```powershell
# Install Azure DevOps CLI extension
az extension add --name azure-devops

# Login to Azure
az login

# Set default organization
az devops configure --defaults organization=https://dev.azure.com/your-organization

# Create project
az devops project create --name "SnowChat" --description "Enterprise Agentic AI Platform" --visibility private
```

### Step 2: Create/Access Repository

#### If Repository Doesn't Exist:

1. In your Azure DevOps project, go to **Repos** → **Files**
2. If prompted to initialize, click **"Initialize"** or:
   - Select **"Import a repository"** if migrating from GitHub/GitLab
   - Select **"Add a README"** for a fresh start
   - Or skip initialization (we'll push from local)

#### If Repository Already Exists:

1. Go to **Repos** → **Files**
2. Note the repository name (usually same as project name)
3. Click **"Clone"** to see the repository URL

### Step 3: Get Repository URL

1. In Azure DevOps, navigate to **Repos** → **Files**
2. Click the **"Clone"** button (top right)
3. Copy the HTTPS URL:
   ```
   https://your-organization@dev.azure.com/your-organization/SnowChat/_git/snowchat
   ```

4. **Or** copy the SSH URL (if you prefer SSH):
   ```
   git@ssh.dev.azure.com:v3/your-organization/SnowChat/snowchat
   ```

---

## Initial Code Push

### Step 1: Prepare Local Repository

```powershell
# Navigate to your project
cd C:\dev\snowchat

# Check current Git status
git status

# Check current remotes
git remote -v
```

**Expected output:**
```
origin  https://github.com/old-repo/snowchat.git (fetch)
origin  https://github.com/old-repo/snowchat.git (push)
```

### Step 2: Commit Any Uncommitted Changes

```powershell
# Check for uncommitted files
git status

# If you see untracked or modified files, commit them
git add .
git commit -m "Prepare for Azure DevOps migration"
```

### Step 3: Add Azure DevOps Remote

#### Option A: Replace Existing Remote (Clean Migration)

```powershell
# Remove old origin
git remote remove origin

# Add Azure DevOps as new origin
git remote add origin https://your-organization@dev.azure.com/your-organization/SnowChat/_git/snowchat

# Verify
git remote -v
```

**Expected output:**
```
origin  https://your-organization@dev.azure.com/your-organization/SnowChat/_git/snowchat (fetch)
origin  https://your-organization@dev.azure.com/your-organization/SnowChat/_git/snowchat (push)
```

#### Option B: Keep Both Remotes (Dual Sync)

```powershell
# Keep existing origin, add Azure DevOps as 'azure'
git remote add azure https://your-organization@dev.azure.com/your-organization/SnowChat/_git/snowchat

# Verify
git remote -v
```

**Expected output:**
```
origin  https://github.com/old-repo/snowchat.git (fetch)
origin  https://github.com/old-repo/snowchat.git (push)
azure   https://your-organization@dev.azure.com/your-organization/SnowChat/_git/snowchat (fetch)
azure   https://your-organization@dev.azure.com/your-organization/SnowChat/_git/snowchat (push)
```

**Note:** With Option B, use `git push azure` instead of `git push origin`

### Step 4: Configure Git Credentials

#### Option A: Git Credential Manager (Recommended - Auto-login)

```powershell
# Windows - Usually installed with Git for Windows
git config --global credential.helper wincred

# First push will prompt for credentials
# Use your Azure DevOps credentials or Personal Access Token
```

#### Option B: Personal Access Token (PAT) - Most Secure

1. **Create PAT in Azure DevOps:**
   - Click your profile icon (top right) → **Personal access tokens**
   - Click **"+ New Token"**
   - Fill in:
     - **Name:** `SnowChat Development`
     - **Organization:** Select your org
     - **Expiration:** 90 days (or custom)
     - **Scopes:** 
       - ✅ Code (Read, Write, & Manage)
       - ✅ Build (Read & Execute) - for CI/CD
       - ✅ Work Items (Read & Write) - optional
   - Click **"Create"**
   - **IMPORTANT:** Copy the token immediately (shown once!)

2. **Use PAT in Git:**
   ```powershell
   # When prompted for password, use the PAT instead
   # Username: (your Azure DevOps email or username)
   # Password: (paste your PAT)
   
   # Or configure in remote URL:
   git remote set-url origin https://PAT@dev.azure.com/your-organization/SnowChat/_git/snowchat
   
   # Replace PAT with your actual token
   ```

#### Option C: SSH Keys (Advanced)

```powershell
# Generate SSH key
ssh-keygen -t rsa -b 4096 -C "your.email@company.com"

# Copy public key
Get-Content ~\.ssh\id_rsa.pub | Set-Clipboard

# Add to Azure DevOps:
# Profile → SSH public keys → Add → Paste key

# Use SSH remote URL
git remote set-url origin git@ssh.dev.azure.com:v3/your-organization/SnowChat/snowchat
```

### Step 5: Push Code to Azure DevOps

```powershell
# Push all branches and tags
git push -u origin --all
git push -u origin --tags

# Or if using 'azure' remote:
git push -u azure --all
git push -u azure --tags
```

**Expected output:**
```
Enumerating objects: 1523, done.
Counting objects: 100% (1523/1523), done.
Delta compression using up to 8 threads
Compressing objects: 100% (845/845), done.
Writing objects: 100% (1523/1523), 2.45 MiB | 3.21 MiB/s, done.
Total 1523 (delta 623), reused 1234 (delta 456), pack-reused 0
remote: Analyzing objects... (1523/1523) (123456 ms)
remote: Storing packfile... done (234 ms)
remote: Storing index... done (45 ms)
To https://dev.azure.com/your-organization/SnowChat/_git/snowchat
 * [new branch]      main -> main
 * [new branch]      develop -> develop
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

### Step 6: Verify Push

1. **Via Web Portal:**
   - Go to Azure DevOps project
   - Navigate to **Repos** → **Files**
   - You should see all your files and folders
   - Check **Branches** to see all pushed branches
   - Check **History** to see commit history

2. **Via Command Line:**
   ```powershell
   # List remote branches
   git branch -r
   
   # Fetch to confirm connection
   git fetch origin
   ```

---

## Team Onboarding

### Step 1: Add Team Members to Azure DevOps

1. **Navigate to Project Settings**
   - Go to your project in Azure DevOps
   - Click **Project Settings** (bottom left gear icon)
   - Click **Teams** or **Permissions**

2. **Add Users**
   - **Via Users:**
     - Go to **Organization Settings** → **Users**
     - Click **"+ Add users"**
     - Enter email addresses (comma-separated)
     - Select access level:
       - `Basic` (for developers - can read/write code)
       - `Stakeholder` (for managers - limited access)
     - Add to project: Select your project
     - Click **"Add"**
   
   - **Via Team:**
     - Go to **Project Settings** → **Teams** → Your team
     - Click **"Add"**
     - Search for users and add

3. **Set Permissions**
   - Go to **Repos** → **Branches**
   - Right-click your main branch → **Branch policies**
   - Configure who can push, approve, etc.

### Step 2: Team Member - Clone Repository

Each team member should:

```powershell
# Navigate to dev folder
cd C:\dev

# Clone repository
git clone https://your-organization@dev.azure.com/your-organization/SnowChat/_git/snowchat

# Navigate to project
cd snowchat

# Verify remote
git remote -v

# Verify branches
git branch -a
```

### Step 3: Team Member - Setup Development Environment

After cloning, follow the existing setup guide:

```powershell
# Install Python dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd frontend
npm install
cd ..

# Create .env file (each developer needs their own)
# Copy from .env.example or team shared location

# Run application
.\start-all.ps1 -Quick -NoKeycloak -Backend
```

---

## Branch Strategy

### Recommended GitFlow Strategy

```
main (production)
  └── develop (integration)
       ├── feature/user-auth
       ├── feature/wiki-rag-improvements
       └── hotfix/azure-openai-fix
```

### Branch Types

| Branch Type | Naming | Purpose | Lifetime |
|-------------|--------|---------|----------|
| `main` | `main` | Production-ready code | Permanent |
| `develop` | `develop` | Integration branch | Permanent |
| `feature` | `feature/description` | New features | Temporary |
| `bugfix` | `bugfix/issue-123` | Bug fixes | Temporary |
| `hotfix` | `hotfix/critical-issue` | Production fixes | Temporary |
| `release` | `release/v1.0.0` | Release preparation | Temporary |

### Create and Work with Branches

```powershell
# Update local repository
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/new-rag-pipeline

# Work on your feature
# ... make changes ...
git add .
git commit -m "Add enhanced RAG pipeline with caching"

# Push feature branch
git push -u origin feature/new-rag-pipeline

# In Azure DevOps, create Pull Request:
# Repos → Pull Requests → New Pull Request
# Source: feature/new-rag-pipeline → Target: develop
```

### Set Branch Policies

Protect your main branches from direct commits:

1. **Go to Azure DevOps:**
   - **Repos** → **Branches**
   - Click **"..."** next to `main` → **Branch policies**

2. **Configure Policies:**
   - ✅ **Require a minimum number of reviewers:** 1-2
   - ✅ **Check for linked work items:** Recommended
   - ✅ **Check for comment resolution:** All comments resolved
   - ✅ **Limit merge types:** Squash merge only (recommended)
   - ✅ **Build validation:** (add later with CI/CD)

3. **Repeat for `develop` branch**

---

## CI/CD Pipeline Setup

### Step 1: Create Build Pipeline

1. **Navigate to Pipelines**
   - Go to **Pipelines** → **Pipelines**
   - Click **"New pipeline"** or **"Create Pipeline"**

2. **Select Repository**
   - Choose **Azure Repos Git**
   - Select your `snowchat` repository

3. **Configure Pipeline**
   - Choose **Starter pipeline** or **Python package**
   - Or create custom YAML (see below)

### Step 2: Create azure-pipelines.yml

Create this file in your repository root:

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
      - develop
  paths:
    exclude:
      - README.md
      - docs/*

pool:
  vmImage: 'windows-latest'

variables:
  pythonVersion: '3.11'
  nodeVersion: '18.x'

stages:
  - stage: Backend_Build_and_Test
    displayName: 'Backend Build and Test'
    jobs:
      - job: Backend
        displayName: 'Python Backend'
        steps:
          - task: UsePythonVersion@0
            inputs:
              versionSpec: '$(pythonVersion)'
            displayName: 'Use Python $(pythonVersion)'

          - script: |
              python -m pip install --upgrade pip
              pip install -r requirements.txt
            displayName: 'Install Python dependencies'

          - script: |
              cd backend
              pytest --junitxml=test-results.xml --cov=components --cov-report=xml --cov-report=html
            displayName: 'Run Python tests'
            continueOnError: true

          - task: PublishTestResults@2
            inputs:
              testResultsFiles: '**/test-results.xml'
              testRunTitle: 'Python Tests'
            displayName: 'Publish test results'

          - task: PublishCodeCoverageResults@1
            inputs:
              codeCoverageTool: 'Cobertura'
              summaryFileLocation: '$(System.DefaultWorkingDirectory)/coverage.xml'
            displayName: 'Publish code coverage'

  - stage: Frontend_Build_and_Test
    displayName: 'Frontend Build and Test'
    jobs:
      - job: Frontend
        displayName: 'React Frontend'
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: '$(nodeVersion)'
            displayName: 'Use Node.js $(nodeVersion)'

          - script: |
              cd frontend
              npm ci
            displayName: 'Install Node dependencies'

          - script: |
              cd frontend
              npm run build
            displayName: 'Build React app'

          - script: |
              cd frontend
              npm test -- --coverage --watchAll=false
            displayName: 'Run React tests'
            continueOnError: true

          - task: PublishTestResults@2
            inputs:
              testResultsFiles: '**/junit.xml'
              testRunTitle: 'React Tests'
            displayName: 'Publish test results'

  - stage: Security_Scan
    displayName: 'Security Scanning'
    dependsOn: []
    jobs:
      - job: Security
        displayName: 'Security Checks'
        steps:
          - task: UsePythonVersion@0
            inputs:
              versionSpec: '$(pythonVersion)'
          
          - script: |
              pip install safety
              safety check --json
            displayName: 'Python security scan'
            continueOnError: true

          - task: NodeTool@0
            inputs:
              versionSpec: '$(nodeVersion)'
          
          - script: |
              cd frontend
              npm audit --audit-level=high
            displayName: 'Node security audit'
            continueOnError: true
```

### Step 3: Commit Pipeline Configuration

```powershell
# Add pipeline file
git add azure-pipelines.yml
git commit -m "Add Azure DevOps CI/CD pipeline"
git push origin main

# Pipeline will automatically trigger on next commit
```

### Step 4: Monitor Pipeline

1. Go to **Pipelines** → **Pipelines**
2. Click on your pipeline run
3. Monitor stages and jobs
4. Review test results and coverage
5. Fix any failures and push again

---

## Best Practices

### 1. .gitignore Configuration

Ensure sensitive files are not committed:

```gitignore
# Environment variables (CRITICAL - never commit!)
.env
.env.local
.env.production

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.venv/
venv/
.pytest_cache/

# Node
node_modules/
npm-debug.log*
build/
dist/

# IDE
.vscode/settings.json
.idea/
*.swp
*.swo

# Logs
*.log
*.log.*

# Database
state_db.json
*.db
*.sqlite

# FAISS indices (large files - consider LFS)
*.index
*.pkl
embedding_cache.json

# OS
.DS_Store
Thumbs.db

# Azure DevOps
.azure-pipelines/
```

### 2. Commit Message Standards

Use conventional commits:

```
feat: Add RAG caching for improved performance
fix: Resolve Azure OpenAI 404 error on embedding calls
docs: Update setup guide with Azure DevOps instructions
refactor: Extract ServiceNow API calls to separate module
test: Add unit tests for wiki RAG functionality
chore: Update dependencies to latest versions
```

### 3. Pull Request Template

Create `.azuredevops/pull_request_template.md`:

```markdown
## Description
<!-- Brief description of changes -->

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Manual testing completed
- [ ] All tests passing

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Dependent changes merged

## Related Work Items
<!-- Link Azure DevOps work items -->
Fixes #123
Relates to #456
```

### 4. Protect Sensitive Data

**Never commit:**
- API keys, passwords, tokens in `.env`
- Azure OpenAI credentials
- ServiceNow passwords
- Database connection strings
- SSH keys or certificates

**Instead:**
- Use Azure Key Vault for secrets
- Reference secrets in pipelines via Variable Groups
- Document required env vars in `.env.example`:

```bash
# .env.example (safe to commit)
AZURE_OPENAI_ENDPOINT=your-endpoint-here
AZURE_OPENAI_API_KEY=your-key-here
SERVICENOW_INSTANCE=your-instance-here
SERVICENOW_USERNAME=your-username-here
SERVICENOW_PASSWORD=your-password-here
```

### 5. Large File Handling

If you have large FAISS indices:

```powershell
# Install Git LFS
git lfs install

# Track large files
git lfs track "*.index"
git lfs track "*.pkl"
git lfs track "code_embeddings.json"

# Commit .gitattributes
git add .gitattributes
git commit -m "Configure Git LFS for large files"
git push
```

---

## Common Commands

### Daily Workflow

```powershell
# Start of day - update your branch
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/my-feature

# Work and commit
git add .
git commit -m "feat: Add new feature"

# Push to Azure DevOps
git push -u origin feature/my-feature

# Update branch with latest develop
git checkout develop
git pull origin develop
git checkout feature/my-feature
git merge develop

# Create Pull Request via web portal
```

### Useful Git Commands

```powershell
# View all branches (local and remote)
git branch -a

# Switch branches
git checkout branch-name

# Delete local branch
git branch -d feature/old-feature

# Delete remote branch
git push origin --delete feature/old-feature

# View commit history
git log --oneline --graph --all

# Undo last commit (keep changes)
git reset HEAD~1

# Discard local changes
git checkout -- .

# Stash changes
git stash
git stash pop

# View remote URL
git remote -v

# Change remote URL
git remote set-url origin https://new-url
```

### Team Collaboration

```powershell
# Fetch all remote branches
git fetch origin

# Checkout teammate's branch
git checkout -b feature/teammate-branch origin/feature/teammate-branch

# View who changed what
git blame filename.py

# Compare branches
git diff main..develop

# Search commit messages
git log --grep="authentication"

# Find when a bug was introduced
git bisect start
git bisect bad  # Current version has bug
git bisect good v1.0.0  # This version was good
# Git will checkout commits to test
```

---

## Troubleshooting

### Issue 1: Authentication Failed

**Error:**
```
fatal: Authentication failed for 'https://dev.azure.com/...'
```

**Solutions:**

```powershell
# Option 1: Clear cached credentials
git credential reject
# Enter URL when prompted

# Option 2: Use Personal Access Token
# Create PAT in Azure DevOps, then:
git remote set-url origin https://PAT@dev.azure.com/your-org/project/_git/repo

# Option 3: Re-configure credential manager
git config --global credential.helper wincred
```

---

### Issue 2: Push Rejected - Updates Were Rejected

**Error:**
```
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs
```

**Solutions:**

```powershell
# Option 1: Pull first (recommended)
git pull origin main --rebase
git push origin main

# Option 2: Force push (DANGEROUS - only if you're sure)
git push origin main --force

# Option 3: Create new branch and PR instead
git checkout -b feature/my-changes
git push -u origin feature/my-changes
```

---

### Issue 3: Large File Push Failed

**Error:**
```
remote: error: File large-file.index is 123.45 MB; this exceeds Azure DevOps' file size limit of 100.00 MB
```

**Solutions:**

```powershell
# Install and configure Git LFS
git lfs install
git lfs track "*.index"
git add .gitattributes
git commit -m "Add Git LFS tracking"

# Remove file from history
git rm --cached large-file.index
git commit -m "Remove large file from tracking"

# Re-add with LFS
git add large-file.index
git commit -m "Add large file via LFS"
git push
```

---

### Issue 4: Branch Policies Blocking Push

**Error:**
```
remote: TF402455: Pushes to this branch are not permitted; you must use a pull request to update this branch.
```

**Solution:**
This is expected! Don't push directly to protected branches.

```powershell
# Create feature branch
git checkout -b feature/my-fix

# Push feature branch
git push -u origin feature/my-fix

# Then create Pull Request in web portal:
# Repos → Pull Requests → New Pull Request
```

---

### Issue 5: Merge Conflicts

**Error:**
```
CONFLICT (content): Merge conflict in file.py
Automatic merge failed; fix conflicts and then commit the result.
```

**Solutions:**

```powershell
# View conflicted files
git status

# Option 1: Use VS Code to resolve
code .  # Opens VS Code
# Use Source Control view to resolve conflicts

# Option 2: Manual resolution
# Edit files to remove conflict markers (<<<<<<<, =======, >>>>>>>)
git add resolved-file.py
git commit -m "Resolve merge conflict"

# Option 3: Abort merge
git merge --abort
```

---

### Issue 6: Wrong Credentials Cached

**Error:** Using wrong Azure DevOps account

**Solutions:**

```powershell
# Windows Credential Manager
# 1. Open Control Panel → Credential Manager
# 2. Windows Credentials → Generic Credentials
# 3. Find git:https://dev.azure.com
# 4. Remove or Edit

# Or via command line:
git credential-manager clear
# Or
git credential reject
# Enter the URL when prompted
```

---

### Issue 7: SSL Certificate Errors

**Error:**
```
SSL certificate problem: unable to get local issuer certificate
```

**Solutions:**

```powershell
# Temporary fix (NOT recommended for production)
git config --global http.sslVerify false

# Better: Fix certificate
# Get your company's SSL certificate and:
git config --global http.sslCAInfo C:/path/to/certificate.crt

# Or update Git
# Download latest Git for Windows from https://git-scm.com/
```

---

## Quick Reference Card

```
╔══════════════════════════════════════════════════════════════════╗
║              AZURE DEVOPS GIT QUICK REFERENCE                    ║
╠══════════════════════════════════════════════════════════════════╣
║ INITIAL SETUP                                                     ║
║   git remote add origin https://dev.azure.com/org/proj/_git/repo  ║
║   git push -u origin --all                                        ║
║                                                                   ║
║ DAILY WORKFLOW                                                    ║
║   git checkout develop                                            ║
║   git pull origin develop                                         ║
║   git checkout -b feature/my-feature                              ║
║   # ... make changes ...                                          ║
║   git add .                                                       ║
║   git commit -m "feat: Description"                               ║
║   git push -u origin feature/my-feature                           ║
║   # Create PR in web portal                                       ║
║                                                                   ║
║ SYNC WITH REMOTE                                                  ║
║   git fetch origin                                                ║
║   git pull origin main                                            ║
║                                                                   ║
║ BRANCH MANAGEMENT                                                 ║
║   git branch -a              # List all branches                  ║
║   git checkout -b name       # Create new branch                  ║
║   git branch -d name         # Delete local branch                ║
║   git push origin --delete   # Delete remote branch               ║
║                                                                   ║
║ TROUBLESHOOTING                                                   ║
║   git status                 # Check status                       ║
║   git log --oneline          # View history                       ║
║   git remote -v              # Check remotes                      ║
║   git credential reject      # Clear credentials                  ║
║                                                                   ║
║ AZURE DEVOPS URLS                                                 ║
║   Portal: https://dev.azure.com/your-org                          ║
║   Project: https://dev.azure.com/your-org/SnowChat                ║
║   Repos: https://dev.azure.com/your-org/SnowChat/_git/snowchat    ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## Next Steps

After migration is complete:

1. **Update Team Documentation**
   - Update README.md with Azure DevOps clone instructions
   - Share this guide with team members
   - Add Azure DevOps links to setup guides

2. **Configure Work Items**
   - Create project backlog
   - Define sprints and iterations
   - Link commits to work items

3. **Set Up Release Pipeline**
   - Create release pipeline for deployments
   - Configure environments (Dev, Test, Prod)
   - Automate deployments

4. **Enable Monitoring**
   - Set up Application Insights
   - Configure pipeline notifications
   - Create dashboard for team visibility

5. **Train Team**
   - Walkthrough of Azure DevOps features
   - Git workflow training
   - Code review best practices

---

## Support & Resources

### Azure DevOps Documentation
- **Getting Started:** https://docs.microsoft.com/azure/devops/
- **Azure Repos:** https://docs.microsoft.com/azure/devops/repos/
- **Azure Pipelines:** https://docs.microsoft.com/azure/devops/pipelines/
- **Git Tutorial:** https://docs.microsoft.com/azure/devops/repos/git/

### Git Resources
- **Git Documentation:** https://git-scm.com/doc
- **Pro Git Book:** https://git-scm.com/book/en/v2
- **Git Cheat Sheet:** https://training.github.com/downloads/github-git-cheat-sheet.pdf

### Internal Resources
- **Team Lead:** ____________________
- **Azure DevOps Admin:** ____________________
- **Slack/Teams Channel:** ____________________

---

**Migration Complete! Your code is now in Azure DevOps! 🎉**

*Last updated: March 27, 2026*
