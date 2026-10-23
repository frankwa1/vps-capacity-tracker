@echo off
setlocal
cd /d "%~dp0"
where nvm >nul 2>&1 && call nvm use 22.14.0
if not exist "node_modules\" call npm install
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

powershell -NoProfile -Command "$startup = [Environment]::GetFolderPath('Startup'); $ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut((Join-Path $startup 'VPS Capacity Tracker.lnk')); $lnk.TargetPath = 'wscript.exe'; $lnk.Arguments = '\"%~dp0run-host.vbs\"'; $lnk.WorkingDirectory = '%~dp0'; $lnk.WindowStyle = 7; $lnk.Save()"
if errorlevel 1 (
  echo Could not add the Startup shortcut. The app can still run from this folder.
) else (
  echo Added Startup shortcut: VPS Capacity Tracker
)

netstat -ano | findstr ":8787" | findstr "LISTENING" >nul
if errorlevel 1 (
  start "" wscript.exe "%~dp0run-host.vbs"
  timeout /t 2 /nobreak >nul
)

powershell -NoProfile -Command "$s = Join-Path $env:USERPROFILE 'Desktop\VPS Capacity Tracker.url'; Set-Content -Path $s -Value \"[InternetShortcut]`r`nURL=http://127.0.0.1:8787/\""

echo.
echo Open this URL anytime (no npm run dev):
echo   http://127.0.0.1:8787/
echo A desktop shortcut was added. The host starts when you sign in to Windows (Startup folder).
start "" "http://127.0.0.1:8787/"
pause
