<#
.SYNOPSIS
  Prism for Windows - kiosk profile installer (win-host-spec §8 / §5).

.DESCRIPTION
  Idempotent. Steps:
    1. Evergreen WebView2 runtime present (never Fixed - it lacks PlayReady, §2/§11).
    2. The data folder %LOCALAPPDATA%\Prism exists (profiles are never touched - §10).
    3. Edge hand-off profile: the Prism veil extension installed and verified in the
       user-data-dir a §29 hand-off window runs in (%LOCALAPPDATA%\Prism\edge-handoff),
       so a hand-off can never silently mean "ads came back" (win-host-spec §5).
       TODO(B-24): the host has no Edge hand-off path yet (no Media.launch / --app=
       window exists) - this step reports HandoffNotPresent and does nothing else until
       the hand-off lands. When it does: launch msedge once with
         --user-data-dir=<handoff> --load-extension=<repo>\prototypes\prism-veil-extension
       (or install the store build), then re-run with -Verify. The check itself mirrors
       Services/HandoffCheck.cs (Preferences -> extensions.settings, state 1 = enabled).

.PARAMETER Verify
  Only report; change nothing.
#>
[CmdletBinding()]
param(
    [switch] $Verify
)

$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'Prism'
$handoff = Join-Path $root 'edge-handoff'
$HandoffImplemented = $false   # keep in step with HandoffCheck.HandoffImplemented (B-24)

function Step($name, $status, $detail) { '{0,-34} {1,-20} {2}' -f $name, $status, $detail }

# 1. Evergreen WebView2 runtime
$wv2 = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
) | Where-Object { Test-Path $_ } | ForEach-Object { (Get-ItemProperty $_).pv } | Select-Object -First 1
if ($wv2) { Step 'WebView2 Evergreen runtime' 'ok' $wv2 } else { Step 'WebView2 Evergreen runtime' 'MISSING' 'install from https://developer.microsoft.com/microsoft-edge/webview2/ (Evergreen bootstrapper)' }

# 2. data folder (never wiped, never re-created over existing data)
if (-not (Test-Path $root)) { if (-not $Verify) { New-Item -ItemType Directory -Path $root | Out-Null; Step 'Data folder' 'created' $root } else { Step 'Data folder' 'absent' $root } }
else { Step 'Data folder' 'ok' $root }

# 3. Edge hand-off profile + veil extension
function Get-HandoffStatus($udd) {
    if (-not $HandoffImplemented) { return 'HandoffNotPresent' }
    $prefs = Join-Path $udd 'Default\Preferences'
    if (-not (Test-Path $prefs)) { return 'ProfileMissing' }
    try {
        $j = Get-Content $prefs -Raw | ConvertFrom-Json
        $settings = $j.extensions.settings
        if (-not $settings) { return 'ExtensionMissing' }
        foreach ($p in $settings.PSObject.Properties) {
            $name = $p.Value.manifest.name
            $known = ($p.Name -eq 'prism-veil') -or ($name -match 'Prism' -and $name -match 'Veil')
            if ($known -and ($p.Value.state -eq 1 -or $null -eq $p.Value.state)) { return 'Verified' }
        }
        return 'ExtensionMissing'
    } catch { return 'ExtensionMissing' }
}
$hs = Get-HandoffStatus $handoff
switch ($hs) {
    'HandoffNotPresent' { Step 'Edge hand-off + veil extension' 'not applicable' 'the host has no Edge hand-off yet (B-24); nothing to install or verify' }
    'ProfileMissing'    { Step 'Edge hand-off + veil extension' 'PROFILE MISSING' "run Edge once with --user-data-dir=$handoff --load-extension=<repo>\prototypes\prism-veil-extension, then -Verify" }
    'ExtensionMissing'  { Step 'Edge hand-off + veil extension' 'EXTENSION MISSING' 'a hand-off window would show ads unveiled - install the Prism veil extension in that profile' }
    'Verified'          { Step 'Edge hand-off + veil extension' 'ok' $handoff }
}

if ($hs -in @('ProfileMissing', 'ExtensionMissing')) { exit 2 }
exit 0
