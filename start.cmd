@echo off
cd /d "%~dp0"
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:8787/"
  exit /b 0
)
if not exist "dist\index.html" (
  where nvm >nul 2>&1 && call nvm use 22.14.0
  if not exist "node_modules\" call npm install
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
start "" wscript.exe "%~dp0run-host.vbs"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787/"
