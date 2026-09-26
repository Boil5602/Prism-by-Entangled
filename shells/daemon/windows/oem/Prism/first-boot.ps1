<#
  Prism kiosk - first boot (runs once, elevated, as the auto-logged-on "prism"
  user, from autounattend.xml FirstLogonCommands). Idempotent: safe to re-run
  from a maintenance session (Ctrl+Alt+Del -> Task Manager -> Run new task ->
  powershell -File C:\Prism\first-boot.ps1).

  1. Unpack the bundled Node runtime
  2. Apply Windows + Edge policies (policies.ps1) - no ads, no prompts, no
     mid-evening reboots, no telemetry beyond what Pro allows
  3. Auto-logon forever + the Prism launcher as this user's shell (no
     explorer, no desktop, no taskbar)
  4. Power: never sleep, never blank; firewall rule for the remote API
  5. Reboot into the dashboard
#>
$ErrorActionPreference = "Continue"
$Root = "C:\Prism"
$Log  = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $Log | Out-Null
Start-Transcript -Path (Join-Path $Log ("first-boot-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")) -Force | Out-Null

function Step($msg) { Write-Host ("`n== " + $msg) -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. Node
Step "Node runtime"
$nodeZip = Get-ChildItem (Join-Path $Root "node") -Filter "node-*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
$nodeExe = Join-Path $Root "node\node.exe"
if (-not (Test-Path $nodeExe) -and $nodeZip) {
  $tmp = Join-Path $env:TEMP "prism-node"
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Expand-Archive -Path $nodeZip.FullName -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  Copy-Item -Path (Join-Path $inner.FullName "*") -Destination (Join-Path $Root "node") -Recurse -Force
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
if (Test-Path $nodeExe) { & $nodeExe --version } else { Write-Warning "node.exe missing - the launcher will fail until C:\Prism\node\node.exe exists" }

# ---------------------------------------------------------------- 2. Policies
Step "Windows + Edge policies"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "policies.ps1")

# ---------------------------------------------------------------- 3. Auto-logon + shell
Step "Auto-logon and custom shell"
$wl = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty $wl -Name AutoAdminLogon -Value "1" -Type String
Set-ItemProperty $wl -Name DefaultUserName -Value "prism" -Type String
Set-ItemProperty $wl -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String
Set-ItemProperty $wl -Name DefaultPassword -Value "" -Type String
Remove-ItemProperty $wl -Name AutoLogonCount -ErrorAction SilentlyContinue
# A blank-password local account is console-only (Windows refuses it for
# network logon while LimitBlankPasswordUse=1, the default) - exactly the
# property we want: auto-logon at the wall, no remote logon with no password.
Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa" -Name LimitBlankPasswordUse -Value 1 -Type DWord
# The Prism launcher replaces explorer.exe for THIS user only (per-user
# Winlogon\Shell). Other accounts - a maintenance admin, if you add one - keep
# the normal desktop. The machine-wide Shell stays stock.
$userWl = "HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
New-Item -Path $userWl -Force | Out-Null
Set-ItemProperty $userWl -Name Shell -Value (Join-Path $Root "prism-shell.cmd") -Type String
Set-ItemProperty $wl -Name Shell -Value "explorer.exe" -Type String
# If the launcher ever dies, Winlogon restarts the shell rather than leaving a blank screen.
Set-ItemProperty $wl -Name AutoRestartShell -Value 1 -Type DWord

# ---------------------------------------------------------------- 4. Power + network
Step "Power plan: never sleep, never blank"
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /hibernate off
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
# Fast startup off: it skips the clean boot that keeps Edge profiles healthy.
Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" -Name HiberbootEnabled -Value 0 -Type DWord

Step "Firewall: remote API (:8471) on private networks"
netsh advfirewall firewall delete rule name="Prism remote API" | Out-Null
netsh advfirewall firewall add rule name="Prism remote API" dir=in action=allow protocol=TCP localport=8471 profile=private,domain | Out-Null
# Treat the current network as private so the phone remote can reach the frame.
Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq "Public" } | ForEach-Object {
  try { Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private } catch {}
}

# ---------------------------------------------------------------- 5. Done
Step "Marking first boot complete"
Set-Content -Path (Join-Path $Root "first-boot.done") -Value (Get-Date -Format o)
Stop-Transcript | Out-Null
shutdown.exe /r /t 5 /c "Prism: rebooting into the dashboard"
