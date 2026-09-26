# Run the Windows host FROM SCRATCH: a brand-new data folder (empty store, fresh per-App
# profiles so every sign-in is a real sign-in, its own host.log), without touching
# %LOCALAPPDATA%\Prism - the household's real store and sessions stay exactly as they are.
#
#   pwsh scripts/run-fresh.ps1                # new folder %LOCALAPPDATA%\Prism-fresh-<stamp>
#   pwsh scripts/run-fresh.ps1 -Reuse         # the most recent fresh folder again (continue a run)
#   pwsh scripts/run-fresh.ps1 -Dir D:\x      # an explicit folder
#   pwsh scripts/run-fresh.ps1 -Capture       # also PRISM_DEV_SHOT=1 (XAML captures on request)
#
# The host reads PRISM_DATA_DIR (targets/win-host/PrismHost/HostPaths.cs). The window title
# says "fresh run" and names the folder so it can never be mistaken for the real wall.
param([string]$Dir, [switch]$Reuse, [switch]$Capture)
$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "..\targets\win-host\PrismHost\bin\x64\Debug\net8.0-windows10.0.19041.0\win-x64\PrismHost.exe"
if (-not (Test-Path $exe)) { throw "host not built: run node scripts/verify.mjs first ($exe)" }
if (-not $Dir) {
  if ($Reuse) {
    $last = Get-ChildItem $env:LOCALAPPDATA -Directory -Filter "Prism-fresh-*" | Where-Object { $_.Name -notlike "*-backup-*" } | Sort-Object Name -Descending | Select-Object -First 1   # a parked backup is not a run
    if (-not $last) { throw "no fresh folder to reuse" }
    $Dir = $last.FullName
  } else {
    $Dir = Join-Path $env:LOCALAPPDATA ("Prism-fresh-" + (Get-Date -Format "yyyyMMdd-HHmm"))
  }
}
New-Item -ItemType Directory -Force $Dir | Out-Null
if (Get-Process PrismHost -ErrorAction SilentlyContinue) { throw "PrismHost is already running - close it first (two hosts would fight over the audio and the window)" }
$envs = @{ PRISM_DATA_DIR = $Dir }
if ($Capture) { $envs.PRISM_DEV_SHOT = "1" }
Start-Process $exe -Environment $envs
"fresh run -> $Dir"
"  store:      $Dir\store.json (created on first save)"
"  log:        $Dir\diagnostics\host.log"
"  real store: $env:LOCALAPPDATA\Prism (untouched)"
