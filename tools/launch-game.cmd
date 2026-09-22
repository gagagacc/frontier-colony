@echo off
rem ============================================================
rem  Launcher: prefer the project-local electron, fall back to npx.
rem  The desktop shortcut calls this through tools\launch-hidden.vbs
rem  so no console window flashes on screen.
rem  (ASCII only -- batch files are read in the OEM codepage.)
rem ============================================================
setlocal
cd /d "%~dp0.."

set "ELECTRON=node_modules\electron\dist\electron.exe"
if exist "%ELECTRON%" (
  start "" "%ELECTRON%" .
  exit /b 0
)

where npx >nul 2>nul
if errorlevel 1 (
  echo [ERROR] electron not found, and npx is missing too.
  echo         Run "npm install" in the project folder first.
  pause
  exit /b 1
)

start "" cmd /c "npx electron ."
exit /b 0
