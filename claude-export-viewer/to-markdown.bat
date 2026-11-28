@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo [1/3] Checking main for updates...
git pull --ff-only origin main
if errorlevel 1 echo   git pull failed. Continuing with the local copy.

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python not found. Install it from https://www.python.org/ and try again.
  pause
  exit /b 1
)

set "SRC=%~1"
if not defined SRC set /p SRC=Drag the export zip here and press Enter: 
if not defined SRC goto :nosrc
set "SRC=%SRC:"=%"
if not exist "%SRC%" goto :nosrc

echo [2/3] Converting "%SRC%" ...
%PY% "%~dp0to_markdown.py" "%SRC%"
if errorlevel 1 (
  echo Conversion failed.
  pause
  exit /b 1
)

echo [3/3] Done. Output is in the claude-markdown folder next to the zip.
for %%I in ("%SRC%") do start "" "%%~dpIclaude-markdown"
pause
exit /b 0

:nosrc
echo File not found: %SRC%
pause
exit /b 1
