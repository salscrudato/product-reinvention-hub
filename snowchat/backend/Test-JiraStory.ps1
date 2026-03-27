param(
    [string]$IssueKey = "IN-4",
    [string]$Query,
    [switch]$VerboseMode,
    [switch]$SkipToolFetch,
    [switch]$SkipToolSummarize,
    [string]$UserQuestion = "",
    [int]$MaxResults = 3,
    [string]$PythonExecutable
)

$script:LogPrefix = "[Test-JiraStory]"
function Write-Log {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::Gray
    )
    $timestamp = (Get-Date).ToString("s")
    Write-Host "$timestamp $LogPrefix $Message" -ForegroundColor $Color
}

function Invoke-JiraToolPython {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("fetch","summarize")][string]$Mode,
        [string]$IssueKey,
        [string]$Query,
        [string]$UserQuestion,
        [int]$MaxResults,
        [string]$PythonExecutable
    )

    $pythonExe = if ($PythonExecutable) { $PythonExecutable } elseif ($env:PYTHON) { $env:PYTHON } else { "python" }
    Write-Log "Invoking Python tool '$Mode' using $pythonExe" ([ConsoleColor]::Cyan)

    try {
        Set-Item -Path Env:TEST_JIRA_MODE -Value $Mode
        if ($IssueKey) { Set-Item -Path Env:TEST_JIRA_ISSUE_KEY -Value $IssueKey } else { Remove-Item Env:TEST_JIRA_ISSUE_KEY -ErrorAction SilentlyContinue }
        if ($Query) { Set-Item -Path Env:TEST_JIRA_QUERY -Value $Query } else { Remove-Item Env:TEST_JIRA_QUERY -ErrorAction SilentlyContinue }
        if ($UserQuestion) { Set-Item -Path Env:TEST_JIRA_USER_QUESTION -Value $UserQuestion } else { Remove-Item Env:TEST_JIRA_USER_QUESTION -ErrorAction SilentlyContinue }
        Set-Item -Path Env:TEST_JIRA_MAX_RESULTS -Value $MaxResults

        $pyCode = @"
import os, json, sys
sys.path.insert(0, r"$PSScriptRoot")
from components.jira_tools import jira_fetch_user_story, jira_summarize_user_story

mode = os.getenv('TEST_JIRA_MODE')
issue_key = os.getenv('TEST_JIRA_ISSUE_KEY') or None
query = os.getenv('TEST_JIRA_QUERY') or None
user_question = os.getenv('TEST_JIRA_USER_QUESTION') or None
max_results_env = os.getenv('TEST_JIRA_MAX_RESULTS')
try:
    max_results = int(max_results_env) if max_results_env else 3
except ValueError:
    max_results = 3

result = {}
if mode == 'fetch':
    result = jira_fetch_user_story(issue_key=issue_key, query=query, max_results=max_results)
elif mode == 'summarize':
    result = jira_summarize_user_story(issue_key=issue_key, query=query, user_question=user_question)
else:
    result = {"error": f"Unknown mode {mode}"}

print(json.dumps(result, indent=2, default=str))
"@

        $pyOutputLines = $pyCode | & $pythonExe -
        $pyRaw = ($pyOutputLines | Out-String).Trim()
        if ($VerboseMode) {
            Write-Log "Python raw output:`n$pyRaw" ([ConsoleColor]::DarkGray)
        }
        $parsed = $null
        try {
            if ($pyRaw) {
                $parsed = $pyRaw | ConvertFrom-Json -ErrorAction Stop
            }
        } catch {
            Write-Log "Failed to parse Python output as JSON: $($_.Exception.Message)" ([ConsoleColor]::DarkYellow)
        }
        return [PSCustomObject]@{
            Raw   = $pyRaw
            Json  = $parsed
        }
    } catch {
        Write-Log "Python execution failed: $($_.Exception.Message)" ([ConsoleColor]::Red)
        throw
    } finally {
        Remove-Item Env:TEST_JIRA_MODE -ErrorAction SilentlyContinue
        Remove-Item Env:TEST_JIRA_ISSUE_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:TEST_JIRA_QUERY -ErrorAction SilentlyContinue
        Remove-Item Env:TEST_JIRA_USER_QUESTION -ErrorAction SilentlyContinue
        Remove-Item Env:TEST_JIRA_MAX_RESULTS -ErrorAction SilentlyContinue
    }
}

function Import-DotEnv {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )
    Write-Log "Importing dotenv file from $Path" ([ConsoleColor]::Cyan)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "DotEnv file not found at $Path"
    }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) {
            return
        }
        $pair = $line -split '=', 2
        if ($pair.Count -ne 2) {
            Write-Log "Skipping invalid line: $_" ([ConsoleColor]::DarkYellow)
            return
        }
        $key = $pair[0].Trim()
        $value = $pair[1].Trim().Trim('"')
        if ($key) {
            Set-Item -Path "Env:$key" -Value $value
            if ($VerboseMode) {
                Write-Log "Loaded env var $key" ([ConsoleColor]::DarkGray)
            }
        }
    }
}

$envFile = Join-Path -Path $PSScriptRoot -ChildPath ".env"
Import-DotEnv -Path $envFile

if (-not $env:JIRA_INSTANCE -and $env:JIRA_API_BASE) {
    $env:JIRA_INSTANCE = $env:JIRA_API_BASE -replace '/rest/api/3$', ''
}

if (-not $env:JIRA_API_BASE) {
    if (-not $env:JIRA_INSTANCE) {
        throw "JIRA_INSTANCE or JIRA_API_BASE must be set in .env"
    }
    $env:JIRA_API_BASE = ("{0}/rest/api/3" -f $env:JIRA_INSTANCE.TrimEnd('/'))
    Write-Log "Derived JIRA_API_BASE = $($env:JIRA_API_BASE)" ([ConsoleColor]::DarkGray)
}

if (-not $env:JIRA_EMAIL -and $env:CONFLUENCE_EMAIL) {
    $env:JIRA_EMAIL = $env:CONFLUENCE_EMAIL
    Write-Log "Falling back to CONFLUENCE_EMAIL for JIRA_EMAIL" ([ConsoleColor]::DarkYellow)
}

if (-not $env:JIRA_API_TOKEN -and $env:CONFLUENCE_API_TOKEN) {
    $env:JIRA_API_TOKEN = $env:CONFLUENCE_API_TOKEN
    Write-Log "Falling back to CONFLUENCE_API_TOKEN for JIRA_API_TOKEN" ([ConsoleColor]::DarkYellow)
}

if (-not $env:JIRA_EMAIL) {
    throw "JIRA_EMAIL is not defined. Add it to backend/.env."
}
if (-not $env:JIRA_API_TOKEN) {
    throw "JIRA_API_TOKEN is not defined. Add it to backend/.env (or CONFLUENCE_API_TOKEN)."
}

$authHeader = "Basic " + [Convert]::ToBase64String(
    [Text.Encoding]::ASCII.GetBytes("$($env:JIRA_EMAIL):$($env:JIRA_API_TOKEN)")
)

function Invoke-JiraGet {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [hashtable]$Query
    )
    $uriBuilder = [System.UriBuilder]::new("$($env:JIRA_API_BASE.TrimEnd('/'))/$Path")
    if ($Query) {
        $queryString = ($Query.GetEnumerator() | ForEach-Object {
            [Uri]::EscapeDataString($_.Key) + '=' + [Uri]::EscapeDataString([string]$_.Value)
        }) -join '&'
        $uriBuilder.Query = $queryString
    }
    $uri = $uriBuilder.Uri.AbsoluteUri
    Write-Log "GET $uri" ([ConsoleColor]::DarkGray)
    if ($Query -and $VerboseMode) {
        Write-Log ("Query params: " + ($Query.GetEnumerator() | Sort-Object Key | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }) -join ', ') ([ConsoleColor]::DarkGray)
    }
    try {
        Invoke-RestMethod -Uri $uri -Headers @{ Authorization = $authHeader; Accept = "application/json" } -Method Get -ErrorAction Stop
    } catch {
        Write-Log "Request failed: $($_.Exception.Message)" ([ConsoleColor]::Red)
        if ($_.Exception.Response) {
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $body = $reader.ReadToEnd()
                Write-Log "Response body: $body" ([ConsoleColor]::Red)
            } catch {
                Write-Log "Unable to read error response body." ([ConsoleColor]::DarkRed)
            }
        }
        throw
    }
}

if ($Query) {
    $project = if ($env:JIRA_DEFAULT_PROJECT) { "project = `{0}` AND " -f $env:JIRA_DEFAULT_PROJECT } else { "" }
    $jql = "${project}text ~ '" + ($Query.Replace("'", "''")) + "' ORDER BY updated DESC"
    Write-Log "Searching JIRA with JQL: $jql" ([ConsoleColor]::Cyan)
    $searchResult = Invoke-JiraGet -Path "search" -Query @{ jql = $jql; maxResults = 5; fields = "summary,status,priority,assignee,reporter" }
    if (-not $searchResult.issues) {
        Write-Log "No issues matched the query." ([ConsoleColor]::Yellow)
        return
    }
    $firstIssue = $searchResult.issues[0]
    $IssueKey = $firstIssue.key
    Write-Log ("Using first match: Key={0}, Summary={1}" -f $firstIssue.key, $firstIssue.fields.summary) ([ConsoleColor]::Yellow)
}

if (-not $IssueKey) {
    throw "Specify -IssueKey or -Query to select an issue."
}

Write-Log "Fetching issue $IssueKey ..." ([ConsoleColor]::Cyan)
$issue = Invoke-JiraGet -Path "issue/$IssueKey" -Query @{ fields = "summary,status,priority,assignee,reporter,created,updated,description" }

$summary = [PSCustomObject]@{
    Key        = $issue.key
    Summary    = $issue.fields.summary
    Status     = $issue.fields.status.name
    Priority   = $issue.fields.priority.name
    Assignee   = $issue.fields.assignee.displayName
    Reporter   = $issue.fields.reporter.displayName
    Created    = $issue.fields.created
    Updated    = $issue.fields.updated
}

Write-Log "Issue overview:" ([ConsoleColor]::Green)
$summary | Format-Table -AutoSize

if ($issue.fields.description.content) {
    Write-Log "Description preview (raw ADF JSON):" ([ConsoleColor]::Green)
    ($issue.fields.description.content | ConvertTo-Json -Depth 6)
} else {
    Write-Log "No description content found." ([ConsoleColor]::DarkYellow)
}

$resolvedIssueKey = $IssueKey

if (-not $SkipToolFetch) {
    Write-Log "Running jira_fetch_user_story tool..." ([ConsoleColor]::Green)
    $toolFetchResult = Invoke-JiraToolPython -Mode "fetch" -IssueKey $resolvedIssueKey -Query $Query -UserQuestion $UserQuestion -MaxResults $MaxResults -PythonExecutable $PythonExecutable
    if ($toolFetchResult.Json) {
        Write-Log "jira_fetch_user_story output:" ([ConsoleColor]::Green)
        $toolFetchResult.Json | ConvertTo-Json -Depth 6
    } elseif ($toolFetchResult.Raw) {
        Write-Log "jira_fetch_user_story raw output:" ([ConsoleColor]::DarkYellow)
        Write-Host $toolFetchResult.Raw
    } else {
        Write-Log "jira_fetch_user_story returned no data." ([ConsoleColor]::DarkYellow)
    }
}

if (-not $SkipToolSummarize) {
    Write-Log "Running jira_summarize_user_story tool..." ([ConsoleColor]::Green)
    $toolSummaryResult = Invoke-JiraToolPython -Mode "summarize" -IssueKey $resolvedIssueKey -Query $Query -UserQuestion $UserQuestion -MaxResults $MaxResults -PythonExecutable $PythonExecutable
    if ($toolSummaryResult.Json) {
        Write-Log "jira_summarize_user_story output:" ([ConsoleColor]::Green)
        $toolSummaryResult.Json | ConvertTo-Json -Depth 6
    } elseif ($toolSummaryResult.Raw) {
        Write-Log "jira_summarize_user_story raw output:" ([ConsoleColor]::DarkYellow)
        Write-Host $toolSummaryResult.Raw
    } else {
        Write-Log "jira_summarize_user_story returned no data." ([ConsoleColor]::DarkYellow)
    }
}
