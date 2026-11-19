@echo off
cd /d "%~dp0"
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer, then open this launcher again.
  pause
  exit /b 1
)
node server.js --open
if errorlevel 1 pause
