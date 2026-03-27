# Azure DevOps Migration Script
# Run this after you have your Azure DevOps repository URL

# ============================================================================
# CONFIGURATION - UPDATE THESE VALUES WITH YOUR AZURE DEVOPS INFORMATION
# ============================================================================

$AZURE_DEVOPS_ORG = "your-organization"          # Your Azure DevOps organization name
$AZURE_DEVOPS_PROJECT = "SnowChat"               # Your project name
$AZURE_DEVOPS_REPO = "snowchat"                  # Your repository name

# Construct the repository URL
$REPO_URL = "https://$AZURE_DEVOPS_ORG@dev.azure.com/$AZURE_DEVOPS_ORG/$AZURE_DEVOPS_PROJECT/_git/$AZURE_DEVOPS_REPO"

# ============================================================================
# CONFIGURATION CHECK
# ============================================================================

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Azure DevOps Migration Script" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

if ($AZURE_DEVOPS_ORG -eq "your-organization") {
    Write-Host "ERROR: Please update the configuration section at the top of this script!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Open this file in a text editor and update:" -ForegroundColor Yellow
    Write-Host "  - AZURE_DEVOPS_ORG" -ForegroundColor Yellow
    Write-Host "  - AZURE_DEVOPS_PROJECT" -ForegroundColor Yellow
    Write-Host "  - AZURE_DEVOPS_REPO" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "Configuration:" -ForegroundColor Green
Write-Host "  Organization: $AZURE_DEVOPS_ORG"
Write-Host "  Project: $AZURE_DEVOPS_PROJECT"
Write-Host "  Repository: $AZURE_DEVOPS_REPO"
Write-Host "  URL: $REPO_URL"
Write-Host ""

# ============================================================================
# PRE-FLIGHT CHECKS
# ============================================================================

Write-Host "Running pre-flight checks..." -ForegroundColor Yellow

# Check if Git is installed
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host "ERROR: Git is not installed or not in PATH!" -ForegroundColor Red
    Write-Host "Please install Git from: https://git-scm.com/downloads" -ForegroundColor Yellow
    exit 1
}
Write-Host "  ✓ Git installed: $(git --version)" -ForegroundColor Green

# Check if we're in a Git repository
$isGitRepo = Test-Path .git
if (-not $isGitRepo) {
    Write-Host "ERROR: Current directory is not a Git repository!" -ForegroundColor Red
    Write-Host "Please run this script from the root of your snowchat repository." -ForegroundColor Yellow
    exit 1
}
Write-Host "  ✓ Git repository detected" -ForegroundColor Green

# Check for uncommitted changes
$status = git status --porcelain
if ($status) {
    Write-Host "WARNING: You have uncommitted changes!" -ForegroundColor Yellow
    Write-Host ""
    git status --short
    Write-Host ""
    $response = Read-Host "Do you want to commit these changes now? (y/n)"
    
    if ($response -eq 'y' -or $response -eq 'Y') {
        Write-Host "Committing changes..." -ForegroundColor Yellow
        git add .
        $commitMsg = Read-Host "Enter commit message (or press Enter for default)"
        if ([string]::IsNullOrWhiteSpace($commitMsg)) {
            $commitMsg = "Prepare for Azure DevOps migration"
        }
        git commit -m $commitMsg
        Write-Host "  ✓ Changes committed" -ForegroundColor Green
    } else {
        Write-Host "Please commit or stash your changes before continuing." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "  ✓ No uncommitted changes" -ForegroundColor Green
}

Write-Host ""

# ============================================================================
# MIGRATION OPTIONS
# ============================================================================

Write-Host "Migration Options:" -ForegroundColor Cyan
Write-Host "1. Replace existing remote (clean migration)"
Write-Host "2. Add Azure DevOps as additional remote (keep existing)"
Write-Host ""
$choice = Read-Host "Enter your choice (1 or 2)"

Write-Host ""

# ============================================================================
# PERFORM MIGRATION
# ============================================================================

try {
    if ($choice -eq "1") {
        Write-Host "Option 1: Replacing existing remote with Azure DevOps..." -ForegroundColor Yellow
        
        # Show current remotes
        Write-Host ""
        Write-Host "Current remotes:" -ForegroundColor Cyan
        git remote -v
        Write-Host ""
        
        $confirm = Read-Host "Are you sure you want to replace the 'origin' remote? (yes/no)"
        if ($confirm -ne "yes") {
            Write-Host "Migration cancelled." -ForegroundColor Yellow
            exit 0
        }
        
        # Remove existing origin
        Write-Host "Removing existing 'origin' remote..." -ForegroundColor Yellow
        git remote remove origin 2>$null
        
        # Add Azure DevOps as origin
        Write-Host "Adding Azure DevOps as 'origin'..." -ForegroundColor Yellow
        git remote add origin $REPO_URL
        
        Write-Host "  ✓ Remote configured" -ForegroundColor Green
        
    } elseif ($choice -eq "2") {
        Write-Host "Option 2: Adding Azure DevOps as additional remote..." -ForegroundColor Yellow
        
        # Add Azure DevOps as 'azure'
        Write-Host "Adding Azure DevOps as 'azure' remote..." -ForegroundColor Yellow
        git remote add azure $REPO_URL 2>$null
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Note: 'azure' remote already exists, updating URL..." -ForegroundColor Yellow
            git remote set-url azure $REPO_URL
        }
        
        Write-Host "  ✓ Remote configured" -ForegroundColor Green
        
    } else {
        Write-Host "Invalid choice. Exiting." -ForegroundColor Red
        exit 1
    }
    
    # Show updated remotes
    Write-Host ""
    Write-Host "Updated remotes:" -ForegroundColor Cyan
    git remote -v
    Write-Host ""
    
    # ============================================================================
    # PUSH TO AZURE DEVOPS
    # ============================================================================
    
    $remoteName = if ($choice -eq "1") { "origin" } else { "azure" }
    
    Write-Host "Ready to push to Azure DevOps!" -ForegroundColor Green
    Write-Host ""
    Write-Host "The following command will be executed:" -ForegroundColor Cyan
    Write-Host "  git push -u $remoteName --all" -ForegroundColor White
    Write-Host "  git push -u $remoteName --tags" -ForegroundColor White
    Write-Host ""
    
    $pushNow = Read-Host "Push now? (y/n)"
    
    if ($pushNow -eq 'y' -or $pushNow -eq 'Y') {
        Write-Host ""
        Write-Host "Pushing to Azure DevOps..." -ForegroundColor Yellow
        Write-Host "You may be prompted for credentials..." -ForegroundColor Yellow
        Write-Host ""
        
        # Push all branches
        git push -u $remoteName --all
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ Branches pushed successfully" -ForegroundColor Green
            
            # Push tags
            Write-Host "Pushing tags..." -ForegroundColor Yellow
            git push -u $remoteName --tags
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  ✓ Tags pushed successfully" -ForegroundColor Green
            }
        } else {
            Write-Host "  ✗ Push failed. See error above." -ForegroundColor Red
            Write-Host ""
            Write-Host "Common issues:" -ForegroundColor Yellow
            Write-Host "  - Authentication failed: Create a Personal Access Token in Azure DevOps" -ForegroundColor Yellow
            Write-Host "  - Repository doesn't exist: Create it in Azure DevOps first" -ForegroundColor Yellow
            Write-Host "  - Network issues: Check your connection and firewall" -ForegroundColor Yellow
            exit 1
        }
    } else {
        Write-Host ""
        Write-Host "Push skipped. You can push later using:" -ForegroundColor Yellow
        Write-Host "  git push -u $remoteName --all" -ForegroundColor White
        Write-Host "  git push -u $remoteName --tags" -ForegroundColor White
    }
    
    # ============================================================================
    # SUCCESS
    # ============================================================================
    
    Write-Host ""
    Write-Host "================================" -ForegroundColor Green
    Write-Host "Migration Complete! ✓" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "  1. Verify your code in Azure DevOps web portal:"
    Write-Host "     https://dev.azure.com/$AZURE_DEVOPS_ORG/$AZURE_DEVOPS_PROJECT/_git/$AZURE_DEVOPS_REPO"
    Write-Host ""
    Write-Host "  2. Set up branch policies (recommended):"
    Write-Host "     - Navigate to Repos → Branches"
    Write-Host "     - Configure policies for main and develop branches"
    Write-Host ""
    Write-Host "  3. Invite team members:"
    Write-Host "     - Go to Project Settings → Teams"
    Write-Host "     - Add team members with appropriate permissions"
    Write-Host ""
    Write-Host "  4. Configure CI/CD pipeline (optional):"
    Write-Host "     - See AZURE_DEVOPS_MIGRATION_GUIDE.md for details"
    Write-Host ""
    Write-Host "For detailed instructions, see: AZURE_DEVOPS_MIGRATION_GUIDE.md" -ForegroundColor Yellow
    Write-Host ""
    
} catch {
    Write-Host ""
    Write-Host "ERROR: An unexpected error occurred!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Please check the error and try again, or migrate manually following:" -ForegroundColor Yellow
    Write-Host "  AZURE_DEVOPS_MIGRATION_GUIDE.md" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
