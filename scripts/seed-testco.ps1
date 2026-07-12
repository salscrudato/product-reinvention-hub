# seed-testco.ps1
# Reads Cosmos credentials from the Azure App Service config and seeds a "testco" test company.
# Run from repo root in any PowerShell terminal where `az` is authenticated.
#
#   .\scripts\seed-testco.ps1
#   .\scripts\seed-testco.ps1 -Tenant mytenant -AdminUser myadmin -AdminPass "S3cur3!"
#
# Prerequisites: az CLI logged in (`az login` or device code); pnpm available.

param(
  [string]$AppName   = "app-prodhub-dev",
  [string]$Rg        = "rg-prodhub-dev",
  [string]$Tenant    = "testco",
  [string]$AdminUser = "testadmin",
  [string]$AdminPass = "",          # defaults to AdminUser value if omitted
  [string]$AdminEmail= "",          # defaults to AdminUser@Tenant.local
  [string]$AdminName = "Test Admin",
  [string]$TenantName= "Test Company"
)

$az = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"

Write-Host "Fetching App Service config from $AppName …"
$raw     = & $az webapp config appsettings list --name $AppName --resource-group $Rg -o json 2>&1
$settings = $raw | ConvertFrom-Json
$cfg = @{}
foreach ($s in $settings) { $cfg[$s.name] = $s.value }

$missing = @('COSMOS_ENDPOINT','COSMOS_KEY') | Where-Object { -not $cfg.ContainsKey($_) }
if ($missing.Count -gt 0) {
  Write-Error "Missing required App Service settings: $($missing -join ', '). Ensure az is logged in and you have access to $AppName."
  exit 1
}

$env:COSMOS_ENDPOINT     = $cfg['COSMOS_ENDPOINT']
$env:COSMOS_KEY          = $cfg['COSMOS_KEY']
$env:COSMOS_DB           = if ($cfg['COSMOS_DB']) { $cfg['COSMOS_DB'] } else { 'prodhub' }
$env:COSMOS_TENANT       = $Tenant
$env:ADMIN_USER          = $AdminUser
$env:ADMIN_PASS          = if ($AdminPass) { $AdminPass } else { $AdminUser }
$env:ADMIN_EMAIL         = if ($AdminEmail) { $AdminEmail } else { "$AdminUser@$Tenant.local" }
$env:ADMIN_NAME          = $AdminName
$env:ADMIN_ROLE          = "ADMIN"
$env:TENANT_NAME         = $TenantName

Write-Host ""
Write-Host "Step 1 — creating tenant '$Tenant' + admin user '$AdminUser' …"
pnpm tsx scripts/create-tenant.ts
if ($LASTEXITCODE -ne 0) { Write-Error "create-tenant.ts failed"; exit 1 }

Write-Host ""
Write-Host "Step 2 — seeding PH/PA/GL reference products for tenant '$Tenant' …"
$env:NODE_PATH = "server/node_modules"
pnpm tsx scripts/migrate-to-cosmos.ts
if ($LASTEXITCODE -ne 0) { Write-Error "migrate-to-cosmos.ts failed"; exit 1 }

Write-Host ""
Write-Host "Done. Log in at the app with:"
Write-Host "  username: $AdminUser"
Write-Host "  password: $(if ($AdminPass) { '(what you passed as -AdminPass)' } else { $AdminUser + '  <- change this!' })"
Write-Host "  tenant:   $Tenant"
