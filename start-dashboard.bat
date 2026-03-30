@echo off
echo Starting InsightsDB Dashboard...
echo.
cd /d "%~dp0"
if not exist "dist\\index.html" (
  echo dist\\index.html not found. Attempting one-time build...
  call npm run build
  if %ERRORLEVEL% neq 0 (
    echo.
    echo Build failed. Close open files under OneDrive, then rerun this script.
    pause
    exit /b 1
  )
)
echo Dashboard URL: http://127.0.0.1:4173
npm run start:stable
pause
