namespace PrismHost.Core;

/// <summary>
/// Where the host window may be restored (store key <c>host.window</c>).
///
/// A saved rect is only trusted when a person could actually reach it: at
/// least <see cref="MinVisible"/> px of it, in both axes, lies on a display
/// that is connected NOW. Seen 2026-09-02: a rect saved on a monitor mounted
/// above the primary (y = −1432) was restored after that monitor was gone,
/// so the window existed, ran scenes, answered the remote - and could not be
/// clicked, Alt-Tabbed or taskbar-raised into view. The −32000 minimized
/// sentinel was already refused; this is the general rule it was a special
/// case of.
/// </summary>
public static class WindowPlacement
{
    public readonly record struct Rect(int X, int Y, int W, int H)
    {
        public int Right => X + W;
        public int Bottom => Y + H;
    }

    /// <summary>How much of the window must be on a display to count as reachable (a title bar's worth, and some).</summary>
    public const int MinVisible = 200;

    /// <summary>Windows parks a minimized window at −32000,−32000; never a real placement.</summary>
    public static bool IsMinimizedSentinel(int x, int y) => x <= -20000 || y <= -20000;

    /// <summary>True when the saved rect overlaps some connected display by at least MinVisible × MinVisible px.</summary>
    /// <summary>Every monitor's bounds through Win32 (EnumDisplayMonitors): needs no windowing runtime, so it answers in a
    /// window's constructor where WinAppSDK's DisplayArea.FindAll() threw (2026-09-14). Empty on failure.</summary>
    public static List<Rect> Win32Monitors()
    {
        var list = new List<Rect>();
        try
        {
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr hdc, ref NativeRect r, IntPtr data) =>
            {
                list.Add(new Rect(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top));
                return true;
            }, IntPtr.Zero);
        }
        catch { }
        return list;
    }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct NativeRect { public int Left, Top, Right, Bottom; }
    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref NativeRect lprcMonitor, IntPtr dwData);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);

    public static bool IsReachable(Rect saved, IEnumerable<Rect> displays)
    {
        if (IsMinimizedSentinel(saved.X, saved.Y) || saved.W <= 0 || saved.H <= 0) return false;
        foreach (var d in displays)
        {
            var w = Math.Min(saved.Right, d.Right) - Math.Max(saved.X, d.X);
            var h = Math.Min(saved.Bottom, d.Bottom) - Math.Max(saved.Y, d.Y);
            if (w >= MinVisible && h >= MinVisible) return true;
        }
        return false;
    }
}
