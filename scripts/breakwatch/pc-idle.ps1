# Minutes since the last keyboard or mouse input on this PC's session (GetLastInputInfo), for the break-watch sampler's idle runs
# (2026-11-05). Run in the person's own session (the scheduled task is interactive-only); another session sees its own input only.
#   powershell -NoProfile -File scripts\breakwatch\pc-idle.ps1      prints whole minutes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PcIdle {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static double Minutes() {
    var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i);
    if (!GetLastInputInfo(ref i)) return -1;
    return unchecked((uint)Environment.TickCount - i.dwTime) / 60000.0;
  }
}
"@
[Math]::Floor([PcIdle]::Minutes())
