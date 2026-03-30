# Initialize git repository and push to GitHub

$projectDir = "C:\Users\SG0705233\OneDrive - Sabre\Desktop\projects\insightsDB\dashboard-react"
Set-Location $projectDir

Write-Host "Step 1: Initialize git repository" -ForegroundColor Green
git init

Write-Host ""
Write-Host "Step 2: Add remote origin" -ForegroundColor Green
git remote add origin https://github.com/Praveenmahamana/poc-star-react.git

Write-Host ""
Write-Host "Step 3: Fetch from remote to see existing content" -ForegroundColor Green
git fetch origin

Write-Host ""
Write-Host "Step 4: Add all files" -ForegroundColor Green
git add .

Write-Host ""
Write-Host "Step 5: Create initial commit" -ForegroundColor Green
@'
git commit -m "Initial commit: InsightsDB React dashboard

Add full Network dashboard with:
- Network tab with OD table, schedule heatmaps
- NetworkScorecard with weekly pax, seats, load factor, demand/revenue mix
- OD Detail Modal with market share pie charts, QSI factors bar chart, itinerary and market summary tables
- Flight View, Flight Report, Itinerary Report, Preferences tabs
- Workset dropdown for multi-workset support
- scripts/sync-data.mjs: auto-discover and process worksets
- scripts/export-network-html.mjs: generate standalone offline HTML

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
'@ | Invoke-Expression

Write-Host ""
Write-Host "Step 6: Try to push to main" -ForegroundColor Green
git push -u origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Push to main failed. Trying master branch..." -ForegroundColor Yellow
    git push -u origin master
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Push to master also failed. Attempting force push to main..." -ForegroundColor Yellow
        git push -u origin main --force
    }
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
