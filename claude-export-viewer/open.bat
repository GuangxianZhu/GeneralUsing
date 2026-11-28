@echo off
setlocal
cd /d "%~dp0"

echo [1/2] Checking main for updates...
git pull --ff-only origin main
if errorlevel 1 echo   git pull failed. Continuing with the local copy.

echo [2/2] Opening viewer...
start "" "%~dp0index.html"
exit /b 0
