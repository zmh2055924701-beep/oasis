@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 22.13 or newer first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
echo Registering Oasis with DSH...
node scriptssetup-dsh.mjs
if errorlevel 1 (
  echo setup-dsh failed.
  pause
  exit /b 1
)
echo Done. Restart DSH, then open Settings -> Oasis.
pause
