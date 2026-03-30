@echo off
REM Initialize git repository and push to GitHub
cd /d "C:\Users\SG0705233\OneDrive - Sabre\Desktop\projects\insightsDB\dashboard-react"

echo ============================================
echo  InsightsDB Dashboard - Git Push to GitHub
echo ============================================
echo.

echo [1/6] Initializing git repository...
git init
if %ERRORLEVEL% neq 0 ( echo ERROR: git init failed & pause & exit /b 1 )

echo.
echo [2/6] Adding remote origin...
git remote remove origin 2>nul
git remote add origin https://github.com/Praveenmahamana/poc-star-react.git

echo.
echo [3/6] Staging all files...
git add .
if %ERRORLEVEL% neq 0 ( echo ERROR: git add failed & pause & exit /b 1 )

echo.
echo [4/6] Creating commit...
git commit -m "Initial commit: InsightsDB React dashboard - Network tab, OD detail modal, QSI charts, Flight/Itinerary reports, Preferences tab, workset dropdown, standalone HTML export" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
if %ERRORLEVEL% neq 0 ( echo ERROR: git commit failed & pause & exit /b 1 )

echo.
echo [5/6] Setting branch to main...
git branch -M main

echo.
echo [6/6] Pushing to GitHub...
git push -u origin main
if %ERRORLEVEL% neq 0 (
    echo.
    echo Push failed - trying force push ^(remote may have existing content^)...
    git push -u origin main --force
    if %ERRORLEVEL% neq 0 (
        echo.
        echo ERROR: Push failed. Make sure you have push access to:
        echo   https://github.com/Praveenmahamana/poc-star-react
        echo.
        echo If prompted for credentials, enter your GitHub username
        echo and a Personal Access Token ^(not your password^).
        echo Generate one at: https://github.com/settings/tokens
        pause
        exit /b 1
    )
)

echo.
echo ============================================
echo  SUCCESS! Code pushed to GitHub.
echo  https://github.com/Praveenmahamana/poc-star-react
echo ============================================
pause

