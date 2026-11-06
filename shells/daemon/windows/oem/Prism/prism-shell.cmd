@echo off
rem Prism kiosk shell. This file IS the Windows shell for the "prism" user
rem (HKCU\...\Winlogon\Shell) - no explorer, no desktop. It just hands off to
rem the PowerShell launcher, which supervises the daemon.
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Prism\prism-shell.ps1"
