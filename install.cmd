@echo off
cd /d "%~dp0"
echo.
echo  dsh-study-coach installer
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [!] node not found.
  echo      Install DSH first - this plugin runs inside DSH.
  echo.
  pause
  exit /b 1
)

node install.mjs
if errorlevel 1 (
  echo.
  echo  Something went wrong. Send the lines above to the author.
)

echo.
pause
