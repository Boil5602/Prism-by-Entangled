<#
  Prism kiosk launcher - the process Windows runs INSTEAD of explorer.exe for
  the "prism" user. Supervises the daemon: waits for the network, starts it,
  restarts it if it ever exits, logs everything under C:\Prism\logs.

  Maintenance from the wall: Ctrl+Alt+Del -> Task Manager -> File -> Run new
  task -> "explorer.exe" gives a normal desktop for this session only; the
  next boot is kiosk again. No chord is wired into this script on purpose -
  a keyboard on the frame should not be able to escape the dashboard.
#>
$ErrorActionPreference = "Continue"
$Root = "C:\Prism"
$Log  = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $Log | Out-Null
$node      = Join-Path $Root "node\node.exe"
$daemon    = Join-Path $Root "shells\daemon\dist\prism-daemon.mjs"
$dashboard = Join-Path $Root "dashboard.json"
$data      = Join-Path $Root "data"
$edge      = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1

function Log($m) { Add-Content -Path (Join-Path $Log "shell.log") -Value ("[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $m) }
Log "launcher start (node=$node edge=$edge)"

# The dashboard file is the user's: ship the default once, never overwrite it.
if (-not (Test-Path $dashboard)) {
  Copy-Item (Join-Path $Root "shells\android\app\src\main\assets\dashboard.json") $dashboard -ErrorAction SilentlyContinue
}

# Wait (bounded) for a network - the remote API and web tiles need one, and the
# daemon prints its pairing URL from the first non-loopback address.
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1
  if ($ip) { break }
  Start-Sleep -Seconds 2
}

# Screen geometry: the daemon's virtual wall is the primary display.
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$w = $screen.Width; $h = $screen.Height

$backoff = 3
while ($true) {
  $args = @($daemon, "--dashboard", $dashboard, "--data-dir", $data, "--width", $w, "--height", $h, "--origin-x", 0, "--origin-y", 0)
  if ($edge) { $args += @("--browser", $edge) }
  Log ("starting daemon: " + ($args -join " "))
  $out = Join-Path $Log ("daemon-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
  $p = Start-Process -FilePath $node -ArgumentList $args -WorkingDirectory $Root -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError ($out + ".err")
  $started = Get-Date
  $p.WaitForExit()
  $ran = ((Get-Date) - $started).TotalSeconds
  Log ("daemon exited code=" + $p.ExitCode + " after " + [int]$ran + "s")
  # Keep only the last 20 daemon logs.
  Get-ChildItem $Log -Filter "daemon-*" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 40 | Remove-Item -Force -ErrorAction SilentlyContinue
  # Crash loop protection: quick exits back off (up to 60 s); a long run resets.
  if ($ran -gt 120) { $backoff = 3 } else { $backoff = [Math]::Min(60, $backoff * 2) }
  Start-Sleep -Seconds $backoff
}
