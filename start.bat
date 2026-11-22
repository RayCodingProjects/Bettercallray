@echo off
rem Starts a local web server for TrueFrame and opens it in your browser.
rem Serving over http://localhost lets the browser cache the neural models between visits.
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. You can still open index.html directly in your browser,
  echo but the neural models will be re-downloaded more often.
  start "" "%~dp0index.html"
  exit /b
)
start "" http://localhost:8000/
python -m http.server 8000 --bind 127.0.0.1
