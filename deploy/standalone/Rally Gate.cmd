@echo off
title Rally Gate - close this window to stop the server
"%~dp0node.exe" "%~dp0app\start.js"
rem Keeps a startup error (port in use, ...) readable instead of the window vanishing.
if errorlevel 1 pause
