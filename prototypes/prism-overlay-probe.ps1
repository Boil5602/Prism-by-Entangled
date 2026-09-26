<#
  Prism overlay probe - Windows prototype of spec sections 26/27 for NATIVE apps.

  Transparent, click-through, always-on-top layers - ONE PER MONITOR. Invisible
  until any visible window exposes an ad marker in its accessibility (UI
  Automation) tree; then intermission art covers THE AD'S OWN RECTANGLE:
  a small display ad gets a small art patch (section 27 partial veil), a video
  ad break gets its player region, and only a genuinely large ad region gets
  the full screen. Uncovers the moment the marker is gone. Observe-only:
  nothing is clicked, no input is synthesized, protected pixels are never read.

  Run (Windows PowerShell, STA):
    powershell -STA -ExecutionPolicy Bypass -File prototypes\prism-overlay-probe.ps1           # watch + overlay
    powershell -STA -ExecutionPolicy Bypass -File prototypes\prism-overlay-probe.ps1 -Demo     # 6s cover demo first, then watch
    powershell -STA -ExecutionPolicy Bypass -File prototypes\prism-overlay-probe.ps1 -Dump     # print what each window exposes, no overlay
    powershell -STA -ExecutionPolicy Bypass -File prototypes\prism-overlay-probe.ps1 -DemoOnly # 6s demo then exit (smoke test)

  Ctrl+C in this console stops it. The overlay never takes focus and never eats a click.
#>
param(
  [switch]$Demo,
  [switch]$DemoOnly,
  [switch]$Dump,
  [int]$ScanMs = 500,
  [string]$Rules = "$PSScriptRoot\prism-overlay-rules.json",
  [string]$LogFile = "$env:TEMP\prism-overlay-events.jsonl"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PrismWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  public const int GWL_EXSTYLE = -20;
  public const int WS_EX_TRANSPARENT = 0x20;
  public const int WS_EX_NOACTIVATE  = 0x08000000;
  public const int WS_EX_TOOLWINDOW  = 0x80;
  public static List<IntPtr> TopWindows() {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { if (IsWindowVisible(h) && !IsIconic(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
"@

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PrismAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { int NotImpl1(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice dev); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { int Activate(ref Guid iid, int clsCtx, IntPtr pars, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 { int NotImpl1(); int NotImpl2(); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { int GetCount(out int count); int GetSession(int i, out IAudioSessionControl s); }
  [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl { int NotImpl1(); }
  [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int NotImpl0(); int NotImpl1(); int NotImpl2(); int NotImpl3(); int NotImpl4();
    int NotImpl5(); int NotImpl6(); int NotImpl7(); int NotImpl8();
    int GetProcessId(out uint pid);
  }
  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume { int SetMasterVolume(float level, ref Guid ctx); int GetMasterVolume(out float level); int SetMute(bool mute, ref Guid ctx); int GetMute(out bool mute); }
  public static void MutePids(uint[] pids, bool mute) {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
    var iid = typeof(IAudioSessionManager2).GUID; object o;
    dev.Activate(ref iid, 1, IntPtr.Zero, out o);
    var mgr = (IAudioSessionManager2)o;
    IAudioSessionEnumerator sess; mgr.GetSessionEnumerator(out sess);
    int n; sess.GetCount(out n);
    var g = Guid.Empty;
    for (int i = 0; i < n; i++) {
      IAudioSessionControl c; sess.GetSession(i, out c);
      var c2 = c as IAudioSessionControl2; if (c2 == null) continue;
      uint pid; c2.GetProcessId(out pid);
      bool hit = false; foreach (var p in pids) if (p == pid) { hit = true; break; }
      if (!hit) continue;
      var v = c as ISimpleAudioVolume; if (v != null) v.SetMute(mute, ref g);
    }
  }
}
"@

function Set-AppMute([string]$exe, [bool]$mute) {
  # Mute every audio session of the app's process tree (Chrome plays audio in a helper process).
  try {
    $pids = @(Get-Process -Name $exe -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
    if ($pids.Count) { [PrismAudio]::MutePids($pids, $mute) }
  } catch { }
}

Add-Type -Name WP -Namespace P2 -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);'
function Get-ExeName([IntPtr]$h) {
  try { $p = [uint32]0; [void][P2.WP]::GetWindowThreadProcessId($h, [ref]$p); (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName } catch { $null }
}

function Get-Title([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [void][PrismWin]::GetWindowText($h, $sb, 512)
  $sb.ToString()
}

$SkipTitles = 'prism-overlay-probe|Windows PowerShell|PowerShell 7|Program Manager|Windows Input Experience|Task Switching|^$'
function Get-CandidateWindows([int]$max = 10) {
  $out = @()
  foreach ($h in [PrismWin]::TopWindows()) {
    $t = Get-Title $h
    if ($t -match $SkipTitles) { continue }
    $out += ,@{ Handle = $h; Title = $t }
    if ($out.Count -ge $max) { break }
  }
  $out
}

# Same badge rule as the tile adapters: the WHOLE text is the marker.
# (dot separators via char codes so this file stays pure ASCII)
$sep = [string][char]0xB7 + [string][char]0x2022
$AdRegex   = [regex]("^(ad|advertisement|advertisement\(s\)|ad\s*\d+\s*of\s*\d+|ad\s*break|sponsored)([\s" + $sep + ":|-]+[\d:]+.*)?$")
$SkipRegex = [regex]'^\s*skip(\s+(ad|ads|intro|recap))?\s*$'
$CloseRegex = [regex]('^\s*(x|' + [string][char]0x2715 + '|' + [string][char]0x00D7 + '|close(\s+ad)?|dismiss)\s*$')

# Per-app rules (optional JSON): { "apps": [ { "titleMatch": "...", "adRegex": "...", "ignore": false } ] }
# Marker rules stay data, reviewable, and per-app - the same posture as tile adapters.
$AppRules = @()
if (Test-Path $Rules) {
  try { $AppRules = (Get-Content $Rules -Raw | ConvertFrom-Json).apps } catch { Write-Host "rules file unreadable: $Rules" -ForegroundColor Yellow }
}
function Get-RuleFor([string]$title) {
  foreach ($r in $AppRules) { if ($title -match $r.titleMatch) { return $r } }
  $null
}
function Write-Event([hashtable]$ev) {
  $ev.ts = (Get-Date).ToString("o")
  try { Add-Content -Path $LogFile -Value ($ev | ConvertTo-Json -Compress) } catch { }
}

function Get-AdElements([IntPtr]$hwnd, [int]$max = 800) {
  # Observe-only UIA read. One pass over the window: ad/skip/close markers by
  # name; creative-sized rects by geometry. A display ad's badge is tiny and
  # its DOM parents are often not exposed, so the badge SNAPS to the largest
  # creative-sized element it is attached to - that is the ad unit.
  $hits = @(); $texts = New-Object System.Collections.Generic.List[string]
  $script:__skipSeen = $false; $script:__skipRect = $null; $script:__closeRect = $null
  try {
    $el = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($null -eq $el) { return @{ Hits = $hits; Texts = $texts; SkipSeen = $false; SkipRect = $null; CloseRect = $null } }
    $winRect = $el.Current.BoundingRectangle
    $winArea = [double][Math]::Max(1, $winRect.Width * $winRect.Height)
    $found = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $n = [Math]::Min($found.Count, $max)
    $markers = @(); $creatives = @()
    for ($i = 0; $i -lt $n; $i++) {
      $c = $found[$i].Current
      $r = $c.BoundingRectangle
      $name = $c.Name
      if ($name) {
        $name = $name.Trim(); $texts.Add($name)
        if ($name.Length -le 40 -and $SkipRegex.IsMatch($name.ToLower())) {
          $script:__skipSeen = $true
          if (-not $r.IsEmpty -and $r.Width -gt 0) { $script:__skipRect = $r }
        }
        if ($name.Length -le 20 -and $CloseRegex.IsMatch($name.ToLower()) -and -not $r.IsEmpty -and $r.Width -gt 0 -and $r.Width -lt 120) { $script:__closeRect = $r }
        if ($name.Length -le 40 -and $AdRegex.IsMatch($name.ToLower())) {
          if (-not $c.IsOffscreen -and -not $r.IsEmpty -and $r.Width -gt 0) { $markers += ,@{ Name = $name; Rect = $r } }
        }
      }
      # creative-sized geometry (IAB-ish bounds; never a page-scale block)
      if (-not $r.IsEmpty -and $r.Width -ge 100 -and $r.Width -le 1100 -and $r.Height -ge 40 -and $r.Height -le 800 -and (($r.Width * $r.Height) -le ($winArea * 0.35))) {
        $tn = $c.ControlType.ProgrammaticName
        if ($tn -match 'Image|Hyperlink|Group|Pane|Custom') { $creatives += ,@{ Rect = $r } }
      }
    }
    foreach ($m in $markers) {
      $mr = $m.Rect
      $mx = $mr.X + $mr.Width / 2; $my = $mr.Y + $mr.Height / 2
      # The ad unit is the SMALLEST creative the badge sits INSIDE (or touches
      # within 12px). Neighbors never match; no guess beats a wrong grab.
      $best = $null; $bestArea = [double]::MaxValue
      foreach ($cd in $creatives) {
        $cr = $cd.Rect
        $inside = ($mx -ge $cr.X -and $mx -le $cr.X + $cr.Width -and $my -ge $cr.Y -and $my -le $cr.Y + $cr.Height)
        if (-not $inside) {
          $gx = [Math]::Max(0, [Math]::Max($cr.X - ($mr.X + $mr.Width), $mr.X - ($cr.X + $cr.Width)))
          $gy = [Math]::Max(0, [Math]::Max($cr.Y - ($mr.Y + $mr.Height), $mr.Y - ($cr.Y + $cr.Height)))
          if (($gx + $gy) -gt 12) { continue }
        }
        $a = $cr.Width * $cr.Height
        if ($a -lt $bestArea) { $bestArea = $a; $best = $cr }
      }
      if ($best) {
        $rect = [System.Windows.Rect]::new($best.X, $best.Y, $best.Width, $best.Height)
      } else {
        $rect = [System.Windows.Rect]::new($mr.X, $mr.Y, $mr.Width, $mr.Height)
      }
      $hits += ,@{ Marker = $m.Name; Rect = $rect; MarkerRect = $mr; WinRect = $winRect }
    }
  } catch { }
  @{ Hits = $hits; Texts = $texts; SkipSeen = $script:__skipSeen; SkipRect = $script:__skipRect; CloseRect = $script:__closeRect }
}

if ($Dump) {
  Write-Host "Dumping every candidate window's exposed text every 3s (Ctrl+C to stop)." -ForegroundColor Yellow
  while ($true) {
    Start-Sleep -Seconds 3
    foreach ($w in Get-CandidateWindows) {
      $r = Get-AdElements $w.Handle
      if (-not $r.Texts.Count) { continue }
      Write-Host ("--- [{0}] {1} nodes" -f $w.Title, $r.Texts.Count) -ForegroundColor Cyan
      $r.Texts | Where-Object { $_.Length -le 60 } | Select-Object -First 30 | ForEach-Object {
        $mark = ""
        if ($AdRegex.IsMatch($_.ToLower())) { $mark = "  <== AD MARKER" } elseif ($SkipRegex.IsMatch($_.ToLower())) { $mark = "  <== SKIP" }
        Write-Host ("   | {0}{1}" -f $_, $mark)
      }
    }
  }
  return
}

# ---------------- intermission art (bundled cosmos pack: NASA imagery, public domain) ----------------
$packDir = Join-Path $PSScriptRoot "..\shells\android\app\src\main\assets\packs\cosmos"
$art = @(); if (Test-Path $packDir) { $art = Get-ChildItem $packDir -Filter *.jpg | ForEach-Object { $_.FullName } }

$gfxDpi = ([System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)).DpiX
$scale = $gfxDpi / 96.0

# ---------------- one layer per monitor, patches drawn on a canvas ----------------
$overlays = @()
foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
  [xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ShowActivated="False" IsHitTestVisible="False">
  <Canvas Name="Patches"/>
</Window>
"@
  $reader = New-Object System.Xml.XmlNodeReader $xaml
  $win = [Windows.Markup.XamlReader]::Load($reader)
  $b = $screen.Bounds
  $win.Left = $b.X / $scale; $win.Top = $b.Y / $scale
  $win.Width = $b.Width / $scale; $win.Height = $b.Height / $scale
  $win.Add_SourceInitialized({
    param($s, $e)
    $h = (New-Object System.Windows.Interop.WindowInteropHelper($s)).Handle
    $ex = [PrismWin]::GetWindowLong($h, [PrismWin]::GWL_EXSTYLE)
    [void][PrismWin]::SetWindowLong($h, [PrismWin]::GWL_EXSTYLE, $ex -bor [PrismWin]::WS_EX_TRANSPARENT -bor [PrismWin]::WS_EX_NOACTIVATE -bor [PrismWin]::WS_EX_TOOLWINDOW)
  }.GetNewClosure())
  $overlays += ,@{ Win = $win; Bounds = $b; Canvas = $win.FindName("Patches"); Patch = $null; Rect = $null; Miss = 0; MutedExe = $null }
}

function New-Patch([double]$x, [double]$y, [double]$w, [double]$h, [string]$label, $hole) {
  $border = New-Object System.Windows.Controls.Border
  $border.CornerRadius = New-Object System.Windows.CornerRadius(6)
  $border.ClipToBounds = $true
  if ($hole -and $hole.Count) {
    # the ad's own escape hatch (Skip / X) stays visible and reachable (section 26 pass-through)
    $geo = [System.Windows.Media.Geometry](New-Object System.Windows.Media.RectangleGeometry([System.Windows.Rect]::new(0, 0, $w, $h)))
    foreach ($ho in $hole) {
      $cut = New-Object System.Windows.Media.RectangleGeometry([System.Windows.Rect]::new($ho.X, $ho.Y, $ho.W, $ho.H), 6, 6)
      $geo = New-Object System.Windows.Media.CombinedGeometry([System.Windows.Media.GeometryCombineMode]::Exclude, $geo, $cut)
    }
    $border.Clip = $geo
  }
  $border.Width = $w; $border.Height = $h
  [System.Windows.Controls.Canvas]::SetLeft($border, $x)
  [System.Windows.Controls.Canvas]::SetTop($border, $y)
  $grid = New-Object System.Windows.Controls.Grid
  $bg = New-Object System.Windows.Media.LinearGradientBrush
  $bg.StartPoint = "0,0"; $bg.EndPoint = "1,1"
  $bg.GradientStops.Add((New-Object System.Windows.Media.GradientStop("#FF141B33", 0)))
  $bg.GradientStops.Add((New-Object System.Windows.Media.GradientStop("#FF05070F", 1)))
  $grid.Background = $bg
  if ($art.Count) {
    $img = New-Object System.Windows.Controls.Image
    $img.Stretch = [System.Windows.Media.Stretch]::UniformToFill
    $img.Source = New-Object System.Windows.Media.Imaging.BitmapImage([Uri]($art | Get-Random))
    $grid.Children.Add($img) | Out-Null
  }
  if ($w -ge 260 -and $h -ge 120) {
    $tb = New-Object System.Windows.Controls.TextBlock
    $tb.Text = ([string][char]0x25D0) + " intermission"
    $tb.FontSize = [Math]::Max(12, [Math]::Min(20, $w / 22))
    $tb.Foreground = "#D7DCE3"; $tb.HorizontalAlignment = "Center"; $tb.VerticalAlignment = "Bottom"
    $tb.Margin = New-Object System.Windows.Thickness(0, 0, 0, 8)
    $grid.Children.Add($tb) | Out-Null
  }
  $border.Child = $grid
  $border.Opacity = 0
  $a = New-Object System.Windows.Media.Animation.DoubleAnimation(1.0, [TimeSpan]::FromMilliseconds(400))
  $border.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $a)
  $border
}

$state = @{ hits = @{}; demoLeft = 0 }
if ($Demo -or $DemoOnly) { $state.demoLeft = [Math]::Max(2, [int](6000 / $ScanMs)) }
$script:IsDemoOnly = [bool]$DemoOnly

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds($ScanMs)
$timer.Add_Tick({
  if ($state.demoLeft -gt 0) {
    $state.demoLeft--
    foreach ($ov in $overlays) {
      if ($ov.Canvas.Children.Count -eq 0) {
        # demo: one large patch and one small "display ad" patch per monitor
        $W = $ov.Win.Width; $H = $ov.Win.Height
        $ov.Canvas.Children.Add((New-Patch ($W*0.15) ($H*0.15) ($W*0.55) ($H*0.55) "")) | Out-Null
        $ov.Canvas.Children.Add((New-Patch ($W*0.76) ($H*0.18) 192 96 "")) | Out-Null
      }
    }
    if ($state.demoLeft -eq 0) {
      foreach ($ov in $overlays) { $ov.Canvas.Children.Clear() }
      Write-Host "DEMO done - now watching every window for ad markers" -ForegroundColor Yellow
      if ($script:IsDemoOnly) { foreach ($ov in $overlays) { $ov.Win.Close() } }
    }
    return
  }
  $allHits = @()
  foreach ($w in Get-CandidateWindows) {
    $rule = Get-RuleFor $w.Title
    if ($rule -and $rule.ignore) { continue }
    $res = Get-AdElements $w.Handle
    if ($rule -and $rule.adRegex) {
      # per-app override re-filters the generic hits by the app's own marker rule
      $rx = [regex]$rule.adRegex
      $res.Hits = @($res.Hits | Where-Object { $rx.IsMatch($_.Marker.ToLower()) })
    }
    # Classify: a countdown or a Skip control means a VIDEO break (big cover,
    # muted); a bare AD badge is a DISPLAY ad (its own unit gets a patch, the
    # X stays visible, nothing is muted, never full-bleed).
    foreach ($hh in $res.Hits) { $hh.Video = [bool]($res.SkipSeen -or ($hh.Marker -match '\d')) }
    $key = $w.Handle.ToString()
    if ($res.Hits.Count) {
      $state.hits[$key] = [int]$state.hits[$key] + 1
      if ($state.hits[$key] -ge 2) {  # cover-slow: two consecutive sightings
        $exe = Get-ExeName $w.Handle
        foreach ($hh in $res.Hits) { $hh.SkipRect = $res.SkipRect; $hh.SkipSeen = $res.SkipSeen; $hh.CloseRect = $res.CloseRect; $hh.Exe = $exe; $allHits += ,$hh }
        Write-Host ("{0} AD in [{1}]: '{2}' at {3}x{4}" -f (Get-Date -Format HH:mm:ss), $w.Title, $res.Hits[0].Marker, [int]$res.Hits[0].Rect.Width, [int]$res.Hits[0].Rect.Height) -ForegroundColor Green
        Write-Event @{ event = "ad-break"; app = $w.Title; marker = $res.Hits[0].Marker; w = [int]$res.Hits[0].Rect.Width; h = [int]$res.Hits[0].Rect.Height }
      }
    } else { $state.hits[$key] = 0 }
  }
  foreach ($ov in $overlays) {
    # Patch SESSIONS: each ad on this monitor gets its own patch that stays put
    # (same art) for that ad's lifetime and lifts after two missed scans.
    if ($null -eq $ov.Sessions) { $ov.Sessions = @{} }
    $desired = @()
    foreach ($hh in $allHits) {
      # THE AD, never the window (nor the page):
      $r = $hh.Rect
      $winArea = [double]([Math]::Max(1, $hh.WinRect.Width * $hh.WinRect.Height))
      if ($hh.Video -and $hh.SkipRect) {
        # a video ad: badge sits bottom-left, Skip bottom-right - the player box
        # spans them; height from 16:9 of that width.
        $mr = $hh.MarkerRect; $sr = $hh.SkipRect
        $x1 = [Math]::Min($mr.X, $sr.X)
        $x2 = [Math]::Max($mr.X + $mr.Width, $sr.X + $sr.Width)
        $bw = [Math]::Max(320.0, $x2 - $x1)
        $bh = $bw * 9.0 / 16.0
        $bot = [Math]::Max($mr.Y + $mr.Height, $sr.Y + $sr.Height)
        $r = [System.Windows.Rect]::new($x1, [Math]::Max($hh.WinRect.Y, $bot - $bh), $bw, [Math]::Min($bh, $bot - $hh.WinRect.Y))
      } elseif (($r.Width * $r.Height) -gt ($winArea * 0.5)) {
        # never more than half the window, whatever the tree said
        $mr = $hh.MarkerRect
        $r = [System.Windows.Rect]::new($mr.X, $mr.Y, $mr.Width, $mr.Height)
      }
      $ix = [Math]::Max($r.X, $ov.Bounds.X); $iy = [Math]::Max($r.Y, $ov.Bounds.Y)
      $ix2 = [Math]::Min($r.X + $r.Width, $ov.Bounds.X + $ov.Bounds.Width)
      $iy2 = [Math]::Min($r.Y + $r.Height, $ov.Bounds.Y + $ov.Bounds.Height)
      if ($ix2 -le $ix -or $iy2 -le $iy) { continue }
      $w = @{ X = ($ix - $ov.Bounds.X) / $scale; Y = ($iy - $ov.Bounds.Y) / $scale; W = ($ix2 - $ix) / $scale; H = ($iy2 - $iy) / $scale; Exe = $hh.Exe; Video = $hh.Video; Id = ($hh.Exe + '|' + $hh.Marker) }
      $w.Holes = @()
      foreach ($esc in @($hh.SkipRect, $hh.CloseRect)) {
        if ($null -eq $esc) { continue }
        $hx = ($esc.X - $ov.Bounds.X) / $scale - $w.X - 8; $hy = ($esc.Y - $ov.Bounds.Y) / $scale - $w.Y - 8
        $hw = $esc.Width / $scale + 16; $hh2 = $esc.Height / $scale + 16
        if ($hx -gt -1 -and $hy -gt -1 -and $hw -gt 0) { $w.Holes += ,@{ X = [Math]::Max(0, $hx); Y = [Math]::Max(0, $hy); W = $hw; H = $hh2 } }
      }
      $desired += ,$w
    }
    $matched = @{}
    foreach ($w in $desired) {
      $best = $null
      foreach ($k in @($ov.Sessions.Keys)) {
        if ($matched[$k]) { continue }
        $sess = $ov.Sessions[$k]
        $ox = [Math]::Max($w.X, $sess.Rect.X); $oy = [Math]::Max($w.Y, $sess.Rect.Y)
        $ox2 = [Math]::Min($w.X + $w.W, $sess.Rect.X + $sess.Rect.W); $oy2 = [Math]::Min($w.Y + $w.H, $sess.Rect.Y + $sess.Rect.H)
        if ($ox2 -gt $ox -and $oy2 -gt $oy) {
          $inter = ($ox2 - $ox) * ($oy2 - $oy)
          if ($inter -gt 0.5 * $w.W * $w.H) { $best = $k; break }
        }
      }
      if (-not $best) {
        foreach ($k in @($ov.Sessions.Keys)) { if (-not $matched[$k] -and $ov.Sessions[$k].Rect.Id -eq $w.Id) { $best = $k; break } }
      }
      if ($best) {
        $matched[$best] = $true
        $sess = $ov.Sessions[$best]; $sess.Miss = 0
        $delta = [Math]::Abs($w.X - $sess.Rect.X) + [Math]::Abs($w.Y - $sess.Rect.Y)
        if ($delta -gt 40) {
          # in motion: art off rather than art trailing; it returns when things settle
          $sess.Patch.Visibility = [System.Windows.Visibility]::Hidden
          $sess.Rect = $w
          continue
        }
        if ($sess.Patch.Visibility -ne [System.Windows.Visibility]::Visible) { $sess.Patch.Visibility = [System.Windows.Visibility]::Visible }
        if ([Math]::Abs($w.X - $sess.Rect.X) -gt 2 -or [Math]::Abs($w.Y - $sess.Rect.Y) -gt 2 -or [Math]::Abs($w.W - $sess.Rect.W) -gt 2 -or [Math]::Abs($w.H - $sess.Rect.H) -gt 2) {
          # the ad moved (window dragged, page scrolled): the art moves with it
          [System.Windows.Controls.Canvas]::SetLeft($sess.Patch, $w.X)
          [System.Windows.Controls.Canvas]::SetTop($sess.Patch, $w.Y)
          $sess.Patch.Width = $w.W; $sess.Patch.Height = $w.H
          if ($w.Holes -and $w.Holes.Count) {
            $geo = [System.Windows.Media.Geometry](New-Object System.Windows.Media.RectangleGeometry([System.Windows.Rect]::new(0, 0, $w.W, $w.H)))
            foreach ($ho in $w.Holes) {
              $cut = New-Object System.Windows.Media.RectangleGeometry([System.Windows.Rect]::new($ho.X, $ho.Y, $ho.W, $ho.H), 6, 6)
              $geo = New-Object System.Windows.Media.CombinedGeometry([System.Windows.Media.GeometryCombineMode]::Exclude, $geo, $cut)
            }
            $sess.Patch.Clip = $geo
          } else { $sess.Patch.Clip = $null }
          $sess.Rect = $w
        }
      }
      else {
        $patch = New-Patch $w.X $w.Y $w.W $w.H "" $w.Holes
        $ov.Canvas.Children.Add($patch) | Out-Null
        $key = [string][Guid]::NewGuid()
        $muted = $false
        if ($w.Video -and $w.Exe) { Set-AppMute $w.Exe $true; $muted = $true }
        $ov.Sessions[$key] = @{ Patch = $patch; Rect = $w; Miss = 0; Muted = $muted; Exe = $w.Exe }
        $matched[$key] = $true
        Write-Event @{ event = "cover"; video = $w.Video; w = [int]$w.W; h = [int]$w.H }
      }
    }
    $gone = @()
    foreach ($k in @($ov.Sessions.Keys)) {
      if ($matched[$k]) { continue }
      $ov.Sessions[$k].Miss++
      if ($ov.Sessions[$k].Miss -ge 2) { $gone += $k }
    }
    foreach ($k in $gone) {
      $sess = $ov.Sessions[$k]
      $ov.Canvas.Children.Remove($sess.Patch)
      if ($sess.Muted -and $sess.Exe) { Set-AppMute $sess.Exe $false }
      $ov.Sessions.Remove($k)
      Write-Event @{ event = "uncover" }
    }
  }
})

Write-Host ("Prism overlay probe: {0} monitor layer(s) up (click-through, no focus). Watching all windows. Ctrl+C stops." -f $overlays.Count) -ForegroundColor Cyan
$timer.Start()
foreach ($ov in ($overlays | Select-Object -Skip 1)) { $ov.Win.Show() }
[void]$overlays[0].Win.ShowDialog()
