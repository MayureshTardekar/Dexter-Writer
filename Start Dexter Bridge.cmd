@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from https://nodejs.org
  pause
  exit /b 1
)

if not exist "bin\dexter-mcp.mjs" (
  echo Run this file from the Dexter Write project folder.
  pause
  exit /b 1
)

start "Dexter Write Bridge" /min cmd /c "node bin\dexter-mcp.mjs --daemon"
timeout /t 2 /nobreak >nul
start "" "https://dexter-writer.vercel.app"
exit /b 0
