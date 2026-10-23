@echo off
cd /d "%~dp0"
schtasks /Delete /TN "VPS Capacity Tracker" /F >nul 2>&1
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\VPS Capacity Tracker.lnk" >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do taskkill /PID %%p /F >nul 2>&1
del /q "%USERPROFILE%\Desktop\VPS Capacity Tracker.url" >nul 2>&1
echo Capacity Tracker host stopped and Startup shortcut removed.
pause
