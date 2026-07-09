Write-Host "Running typecheck..." -ForegroundColor Cyan
pnpm typecheck
if ($LASTEXITCODE -ne 0) {
    Write-Host "Typecheck failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Running lint..." -ForegroundColor Cyan
pnpm lint
if ($LASTEXITCODE -ne 0) {
    Write-Host "Lint failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Running tests..." -ForegroundColor Cyan
pnpm test:unit
if ($LASTEXITCODE -ne 0) {
    Write-Host "Tests failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Running build..." -ForegroundColor Cyan
pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "All checks passed!" -ForegroundColor Green
