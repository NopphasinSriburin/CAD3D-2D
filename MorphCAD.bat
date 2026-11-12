@echo off
rem Double-click to start MorphCAD: installs dependencies on first run, builds, serves and opens the browser.
chcp 65001 >nul
title MorphCAD
cd /d "%~dp0"
if not exist "node_modules\vite" (
  echo First run: installing dependencies...
  call npm install
)
node scripts\launch.mjs %*
if errorlevel 1 pause
