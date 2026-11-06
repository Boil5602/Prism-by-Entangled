# The PC's own mute (the default playback device), for the break-watch sampler's nights (2026-11-04). Windows PowerShell 5.1 (powershell.exe):
# PowerShell 7 cannot call the COM interface's methods directly. The capture Prism's meters read is before the endpoint, so a muted PC still
# records every window's level.
#   powershell -NoProfile -File scripts\breakwatch\pc-mute.ps1 get|on|off     prints the state after: muted / unmuted
param([Parameter(Mandatory = $true)][ValidateSet("get", "on", "off")] [string]$Do)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  // the eleven methods before SetMute, in the interface's own order (Register/UnregisterControlChangeNotify, GetChannelCount, Set/Get master and channel levels)
  int f(); int g(); int h(); int i(); int j(); int k(); int l(); int m(); int n(); int o(); int p();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid ctx);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
public static class PcMute {
  static IAudioEndpointVolume Vol() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d));
    var iid = typeof(IAudioEndpointVolume).GUID; object o; Marshal.ThrowExceptionForHR(d.Activate(ref iid, 23, IntPtr.Zero, out o)); return (IAudioEndpointVolume)o;
  }
  public static bool Get() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
  public static void Set(bool on) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Vol().SetMute(on, ref g)); }
}
"@
if ($Do -eq "on") { [PcMute]::Set($true) } elseif ($Do -eq "off") { [PcMute]::Set($false) }
if ([PcMute]::Get()) { "muted" } else { "unmuted" }
