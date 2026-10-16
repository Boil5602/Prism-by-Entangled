using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;

namespace PrismHost.Surfaces;

/// <summary>
/// A parked page (2026-10-16, "Are there any APIs ... we could be using to improve the app performance, without negatively impacting the user"):
/// a hidden reader or an idle music page is parked by the browser's own levers, never by slowing its page. The doze had been the DevTools CPU
/// throttle at 8x, and measured live it cost more than it saved: each throttled page with work of its own held a full core (four music pages at
/// 6.3% of a 16-core machine each, from the minute they parked; woken, 0 to 11% of one core). Parked now means:
/// - the page's memory target is Low (WebView2's MemoryUsageTargetLevel: Chromium trims its caches and may page out what it keeps), Normal again
///   on the wake, before any script reaches it;
/// - a renderer process that draws only parked pages runs at below-normal priority with Windows' efficiency mode (EcoQoS), so a library read
///   never takes time from a window being watched. A renderer shared with anything else (a window on screen, a page awake, a frame no surface
///   owns) is left as it is.
/// The page itself is untouched: visible to its own scripts, its timers at their own pace, nothing frozen (B-371: a page once frozen through the
/// lifecycle never came back).
/// </summary>
public sealed partial class SurfaceManager
{
    /// <summary>Renderer processes eased by Prism, with the surfaces they drew when eased.</summary>
    private readonly Dictionary<uint, string[]> _easedRenderers = new();

    private static void ParkMemory(Tile t, bool parked)
    {
        try
        {
            if (t.View?.CoreWebView2 is { } core)
                core.MemoryUsageTargetLevel = parked ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal;
        }
        catch { }
    }

    /// <summary>A page waking: every renderer eased for it back to normal at once, before its first script.</summary>
    private void UneaseFor(Tile t)
    {
        foreach (var (pid, ids) in _easedRenderers.ToArray())
            if (ids.Contains(t.Id)) { Ease(pid, false); _easedRenderers.Remove(pid); }
    }

    /// <summary>Every renderer that draws only parked pages eased; any other renderer Prism eased before put back.</summary>
    private async Task EaseRenderersAsync()
    {
        var parked = _tiles.Values.Where(x => x.Dozing).Select(x => x.Id).ToHashSet();
        var want = new Dictionary<uint, string[]>();
        if (parked.Count > 0)
        {
            var byFrame = new Dictionary<uint, string>();
            foreach (var x in _tiles.Values.ToArray()) { try { if (x.View?.CoreWebView2 is { } c) byFrame[c.FrameId] = x.Id; } catch { } }
            var seenBrowser = new HashSet<uint>();
            foreach (var x in _tiles.Values.ToArray())
            {
                if (x.Env is null) continue;
                uint bpid; try { bpid = x.View?.CoreWebView2?.BrowserProcessId ?? 0; } catch { continue; }
                if (bpid == 0 || !seenBrowser.Add(bpid)) continue;
                IReadOnlyList<CoreWebView2ProcessExtendedInfo> infos;
                try { infos = await x.Env.GetProcessExtendedInfosAsync(); } catch { continue; }
                foreach (var i in infos)
                {
                    if (i.ProcessInfo.Kind != CoreWebView2ProcessKind.Renderer) continue;
                    var ids = new HashSet<string>();
                    var unknown = false;
                    try
                    {
                        foreach (var f in i.AssociatedFrameInfos ?? Array.Empty<CoreWebView2FrameInfo>())
                        {
                            // a frame belongs to the surface whose main frame it sits under
                            var top = f;
                            for (var n = 0; top.ParentFrameInfo is { } p && n < 32; n++) top = p;
                            if (byFrame.TryGetValue(top.FrameId, out var id)) ids.Add(id); else unknown = true;
                        }
                    }
                    catch { unknown = true; }
                    if (!unknown && ids.Count > 0 && ids.All(parked.Contains)) want[(uint)i.ProcessInfo.ProcessId] = ids.ToArray();
                }
            }
        }
        foreach (var pid in _easedRenderers.Keys.ToArray())
            if (!want.ContainsKey(pid)) { Ease(pid, false); _easedRenderers.Remove(pid); }
        foreach (var (pid, ids) in want)
        {
            if (_easedRenderers.ContainsKey(pid)) { _easedRenderers[pid] = ids; continue; }
            if (Ease(pid, true)) { _easedRenderers[pid] = ids; _onStatus("renderer eased: " + pid + " (" + string.Join(", ", ids) + ")"); }
        }
    }

    /// <summary>Below-normal priority and efficiency mode on (or the system's own handling and normal priority back).</summary>
    private static bool Ease(uint pid, bool on)
    {
        var h = OpenProcess(ProcessSetInformation, false, pid);
        if (h == IntPtr.Zero) return false;
        try
        {
            var s = new PowerThrottlingState { Version = 1, ControlMask = on ? ThrottleExecutionSpeed : 0, StateMask = on ? ThrottleExecutionSpeed : 0 };
            var a = SetProcessInformation(h, ProcessPowerThrottling, ref s, (uint)Marshal.SizeOf<PowerThrottlingState>());
            var b = SetPriorityClass(h, on ? BelowNormalPriorityClass : NormalPriorityClass);
            return a || b;
        }
        finally { CloseHandle(h); }
    }

    private const uint ProcessSetInformation = 0x0200;
    private const int ProcessPowerThrottling = 4;
    private const uint ThrottleExecutionSpeed = 0x1;
    private const uint NormalPriorityClass = 0x20, BelowNormalPriorityClass = 0x4000;

    [StructLayout(LayoutKind.Sequential)]
    private struct PowerThrottlingState { public uint Version, ControlMask, StateMask; }

    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetProcessInformation(IntPtr process, int infoClass, ref PowerThrottlingState info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetPriorityClass(IntPtr process, uint priorityClass);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
}
