using System.Diagnostics;

namespace PrismHost;

/// <summary>
/// Boot marks (2026-10-26, "Startup took about two minutes from launch to brain ready, with nothing logged in between"): one line per step of
/// the start, written straight to host.log without the store (the window's LogLine needs the store, so the constructor's first steps had no
/// voice). Each line says how long since the previous mark and since the process began; the slow step is the one with the big number.
/// </summary>
internal static class BootTrace
{
    private static readonly Stopwatch Sw = Stopwatch.StartNew();
    private static readonly object Gate = new();
    private static long _last;
    private static readonly DateTime Started = Process.GetCurrentProcess().StartTime;

    public static void Note(string step)
    {
        try
        {
            lock (Gate)
            {
                var now = Sw.ElapsedMilliseconds;
                var line = DateTime.Now.ToString("HH:mm:ss.fff") + " boot: " + step + " +" + (now - _last) + " ms, " + (int)(DateTime.Now - Started).TotalMilliseconds + " ms since the process started";
                _last = now;
                Directory.CreateDirectory(HostPaths.Diagnostics);
                File.AppendAllText(Path.Combine(HostPaths.Diagnostics, "host.log"), PrismHost.Diagnostics.Redact.Line(line) + "\n");
            }
        }
        catch { /* a mark that cannot be written is nothing */ }
    }
}
