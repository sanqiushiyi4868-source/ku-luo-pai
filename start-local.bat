@echo off
cd /d "%~dp0"
set PORT=4173

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Please install Python or open this folder with another local web server.
  pause
  exit /b 1
)

start "Clow Cards Local Server" /min python -m http.server %PORT% --bind 127.0.0.1
timeout /t 2 >nul
start "" "http://127.0.0.1:%PORT%/"
