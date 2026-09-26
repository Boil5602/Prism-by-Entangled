@echo off
rem Prism overlay watch - transparent §26/§27 layer over every monitor.
powershell -STA -NoProfile -ExecutionPolicy Bypass -File "%~dp0prism-overlay-probe.ps1" %*
