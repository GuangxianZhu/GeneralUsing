@echo off
setlocal
cd /d "%~dp0"

echo [1/2] Checking main for updates...
git pull --ff-only origin main
if errorlevel 1 echo   git pull failed. Continuing with the local copy.

set "TARGET="
if exist "sync-target.txt" set /p TARGET=<"sync-target.txt"
if not defined TARGET set /p TARGET=Workspace folder (e.g. C:\work\investigation):
if not defined TARGET goto :notarget
if not exist "%TARGET%\" mkdir "%TARGET%"
>"sync-target.txt" echo %TARGET%

echo [2/2] Installing into %TARGET%\.github
if not exist "%TARGET%\.github\prompts\" mkdir "%TARGET%\.github\prompts"
copy /y "dot-github\copilot-instructions.md" "%TARGET%\.github\" >nul
xcopy /y /q "dot-github\prompts\*" "%TARGET%\.github\prompts\" >nul
if exist "%TARGET%\.github\source-map.md" (
  echo   source-map.md already exists - kept as is.
) else (
  copy "dot-github\source-map.md" "%TARGET%\.github\" >nul
  echo   source-map.md created - fill in the real locations.
)
if not exist "%TARGET%\work\" mkdir "%TARGET%\work"

echo Done. Open %TARGET% in VS Code.
pause
exit /b 0

:notarget
echo No workspace folder given.
pause
exit /b 1
