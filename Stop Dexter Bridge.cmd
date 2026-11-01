@echo off
setlocal
cd /d "%~dp0"

if not exist "bin\dexter-mcp.mjs" (
  echo Run this file from the Dexter Write project folder.
  pause
  exit /b 1
)

node bin\dexter-mcp.mjs --stop
pause
