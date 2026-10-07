using System.Runtime.InteropServices;

namespace PrismHost;

/// <summary>
/// The graphics driver's resets, told to core (2026-09-28, "my prism video is blank now": the NVIDIA driver reset - Windows logged nvlddmkm event
/// 153 - and Netflix's hardware-protected video stayed black while its page went on playing; a reload of the page brought it back). Every 15
/// seconds the System log is asked whether a display driver logged anything in the last 20 seconds (nvlddmkm, amdkmdag, igfx, Display); if so, core
/// hears "gpu-reset" and loads each playing video page again (at most once a minute). Read-only, local: the log never leaves the machine.
/// </summary>
public sealed partial class MainWindow
{
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _gpuWatch;   // held: a timer nobody holds is collected and never fires

    private void StartGpuWatch()
    {
        _gpuWatch = DispatcherQueue.CreateTimer();
        _gpuWatch.Interval = TimeSpan.FromSeconds(15);
        _gpuWatch.IsRepeating = true;
        var busy = false;
        _gpuWatch.Tick += async (_, __) =>
        {
            if (busy) return;
            busy = true;
            bool reset;
            // off the UI thread: the log query takes a few hundred milliseconds, which on the UI thread would hitch the page every 15 seconds
            try { reset = await Task.Run(() => DisplayDriverLoggedLately(20_000)); } catch { reset = false; } finally { busy = false; }
            if (!reset) return;
            LogLine("gpu: the display driver logged a reset - playing video pages will load again");
            try { _brain?.Call(PrismHost.Channel.HostCalls.Event, "{\"type\":\"gpu-reset\",\"id\":\"host\"}"); } catch { }
        };
        _gpuWatch.Start();
    }

    private const string GpuQuery = "*[System[(Provider[@Name='nvlddmkm'] or Provider[@Name='amdkmdag'] or Provider[@Name='igfx'] or Provider[@Name='Display']) and TimeCreated[timediff(@SystemTime) <= {0}]]]";

    /// <summary>Did a display driver write to the System log in the last <paramref name="ms"/> milliseconds?</summary>
    private static bool DisplayDriverLoggedLately(int ms)
    {
        var q = EvtQuery(IntPtr.Zero, "System", string.Format(GpuQuery, ms), EvtQueryChannelPath | EvtQueryReverseDirection);
        if (q == IntPtr.Zero) return false;
        try
        {
            var events = new IntPtr[1];
            if (!EvtNext(q, 1, events, 0, 0, out var got) || got == 0) return false;
            EvtClose(events[0]);
            return true;
        }
        finally { EvtClose(q); }
    }

    private const int EvtQueryChannelPath = 0x1, EvtQueryReverseDirection = 0x200;
    [DllImport("wevtapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr EvtQuery(IntPtr session, string path, string query, int flags);
    [DllImport("wevtapi.dll", SetLastError = true)] private static extern bool EvtNext(IntPtr resultSet, int eventArraySize, [Out] IntPtr[] eventArray, int timeout, int flags, out int returned);
    [DllImport("wevtapi.dll")] private static extern bool EvtClose(IntPtr handle);
}
