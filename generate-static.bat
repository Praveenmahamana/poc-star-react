@echo off
echo ============================================
echo  InsightsDB - Generate Static Client HTML
echo ============================================
echo.
echo Step 1/2: Building app...
call npm run build
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: Build failed. Check errors above.
  pause
  exit /b 1
)

echo.
echo Step 2/2: Generating static HTML...
call npm run export:static
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: Static export failed. Check errors above.
  pause
  exit /b 1
)

echo.
echo Done! Open dashboard-client.html in any browser.
echo.
pause
