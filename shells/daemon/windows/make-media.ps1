<#
.SYNOPSIS
  Build a Prism kiosk USB installer from a stock Windows 11 ISO.

.DESCRIPTION
  Produces a bootable stick that installs Windows 11 Pro unattended and boots
  straight into the Prism dashboard - no OOBE, no login, no desktop.

  The stick = the ISO's files + autounattend.xml at the root + our payload
  under sources\$OEM$\$1\Prism (Windows copies that to C:\Prism during setup):
    C:\Prism\first-boot.ps1, policies.ps1, prism-shell.cmd/.ps1
    C:\Prism\node\node-*.zip                     (Node runtime, unpacked on first boot)
    C:\Prism\shells\daemon\dist\prism-daemon.mjs  (the daemon, single-file bundle)
    C:\Prism\shells\android\app\src\main\assets\ (adapters, blocklists, packs, remote.html)

  The USB is formatted FAT32 (UEFI needs it); install.wim is split into .swm
  parts with DISM when it exceeds FAT32's 4 GB file limit.

.PARAMETER Iso        Path to a Windows 11 ISO (any edition media that contains "Windows 11 Pro").
.PARAMETER Usb        Drive letter of the USB stick to WIPE, e.g. E:
.PARAMETER TimeZone   Windows time-zone id for the frame (default: this PC's).
.PARAMETER NodeVersion Node LTS version to bundle (default 22.12.0).
.PARAMETER StageOnly  Build the payload into .\stage without touching a USB (for inspection / CI).

.EXAMPLE
  .\make-media.ps1 -Iso "$HOME\Downloads\Win11_24H2_English_x64.iso" -Usb E:
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Iso,
  [string] $Usb,
  [string] $TimeZone = (Get-TimeZone).Id,
  [string] $NodeVersion = "22.12.0",
  [switch] $StageOnly
)
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Resolve-Path (Join-Path $Here "..\..\..")
$Stage = Join-Path $Here "stage"

if (-not $StageOnly -and -not $Usb) { throw "Pass -Usb <letter:> or -StageOnly" }
if (-not (Test-Path $Iso)) { throw "ISO not found: $Iso" }

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. Build the daemon bundle
Step "Building the daemon (single-file bundle)"
Push-Location $Repo
try {
  npm run build --workspace shells/daemon | Out-Host
  $bundleDir = Join-Path $Stage "Prism\shells\daemon\dist"
  New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null
  npx esbuild shells/daemon/dist/main.js --bundle --platform=node --format=esm --target=node22 `
    --outfile="$bundleDir\prism-daemon.mjs" `
    --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" | Out-Host
} finally { Pop-Location }

# ---------------------------------------------------------------- 2. Payload
Step "Staging payload"
$P = Join-Path $Stage "Prism"
Copy-Item (Join-Path $Here "oem\Prism\*") $P -Recurse -Force
$assetsSrc = Join-Path $Repo "shells\android\app\src\main\assets"
$assetsDst = Join-Path $P "shells\android\app\src\main\assets"
New-Item -ItemType Directory -Force -Path $assetsDst | Out-Null
Copy-Item (Join-Path $assetsSrc "*") $assetsDst -Recurse -Force

Step "Node $NodeVersion runtime"
$nodeDir = Join-Path $P "node"; New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
$nodeZip = Join-Path $nodeDir "node-v$NodeVersion-win-x64.zip"
if (-not (Test-Path $nodeZip)) {
  $url = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
  Write-Host "downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $nodeZip -UseBasicParsing
  # verify against the official SHASUMS
  $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
  $want = ($sums -split "`n" | Where-Object { $_ -like "*node-v$NodeVersion-win-x64.zip" }) -split "\s+" | Select-Object -First 1
  $have = (Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLower()
  if ($want -and $want -ne $have) { Remove-Item $nodeZip; throw "Node download checksum mismatch" }
}

Step "autounattend.xml (time zone: $TimeZone)"
$xml = Get-Content (Join-Path $Here "autounattend.xml") -Raw
$xml = $xml.Replace("__TIMEZONE__", $TimeZone)
Set-Content -Path (Join-Path $Stage "autounattend.xml") -Value $xml -Encoding UTF8

if ($StageOnly) { Write-Host "`nStaged at $Stage"; exit 0 }

# ---------------------------------------------------------------- 3. USB
$Usb = $Usb.TrimEnd("\").ToUpper(); if ($Usb.Length -eq 1) { $Usb += ":" }
$disk = Get-Partition -DriveLetter $Usb[0] | Get-Disk
if ($disk.BusType -ne "USB") { throw "$Usb is not a USB device (bus: $($disk.BusType)) - refusing to wipe it" }
Write-Host "`nThis will ERASE $Usb ($([math]::Round($disk.Size/1GB)) GB, $($disk.FriendlyName))." -ForegroundColor Yellow
if ((Read-Host "Type YES to continue") -ne "YES") { exit 1 }

Step "Formatting $Usb as FAT32 (UEFI-bootable)"
Clear-Disk -Number $disk.Number -RemoveData -RemoveOEM -Confirm:$false
Initialize-Disk -Number $disk.Number -PartitionStyle GPT
$part = New-Partition -DiskNumber $disk.Number -UseMaximumSize -DriveLetter $Usb[0]
Format-Volume -Partition $part -FileSystem FAT32 -NewFileSystemLabel "PRISM" -Confirm:$false | Out-Null

Step "Copying Windows setup files"
$mount = Mount-DiskImage -ImagePath (Resolve-Path $Iso) -PassThru
$isoLetter = ($mount | Get-Volume).DriveLetter + ":"
try {
  robocopy "$isoLetter\" "$Usb\" /E /XF install.wim /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  $wim = "$isoLetter\sources\install.wim"
  if ((Get-Item $wim).Length -gt 4GB) {
    Step "install.wim > 4 GB: splitting for FAT32"
    dism /Split-Image /ImageFile:$wim /SWMFile:"$Usb\sources\install.swm" /FileSize:3800 | Out-Host
  } else {
    Copy-Item $wim "$Usb\sources\install.wim"
  }
} finally { Dismount-DiskImage -ImagePath (Resolve-Path $Iso) | Out-Null }

Step "Adding Prism payload"
Copy-Item (Join-Path $Stage "autounattend.xml") "$Usb\autounattend.xml" -Force
$oem = "$Usb\sources\`$OEM`$\`$1"
New-Item -ItemType Directory -Force -Path $oem | Out-Null
robocopy (Join-Path $Stage "Prism") "$oem\Prism" /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null

Write-Host "`nDone. Boot the target from $Usb (UEFI). It will wipe disk 0, install, and come up as a Prism frame with no interaction." -ForegroundColor Green
