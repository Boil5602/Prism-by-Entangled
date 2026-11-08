namespace PrismHost;

/// <summary>
/// The window's own thread, watched for stalls (2026-09-28): a tick every 100 ms on the UI thread; one that comes late by more than a third of
/// a second means the thread was busy and clicks were waiting, and host.log says so - - among the lines that name what ran.
/// Diagnostics only; it changes nothing.
///
/// A long freeze caught while it lasts (2026-11-06: the window stood still 19.5 s at 20:41 and 12.6 s at 04:13, and the log could only say
/// so afterwards): on a developer's build (PRISM_DEV_SHOT=1) a background thread notices when the tick has not run for StallDumpMs and has
/// the runtime's own createdump write the process as it stands - the UI thread's stack shows what held it (dotnet-dump analyze, clrstack).
/// One dump in StallDumpEveryH hours at most, the older ones removed, and never on a household's install.
/// </summary>
public sealed partial class MainWindow
{
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _stallWatch;   // held: a timer nobody holds is collected and never fires
    private const int StallTickMs = 100, StallLogMs = 350;
    private const int StallDumpMs = 8000, StallDumpEveryH = 12;
    private static long s_stallTickAt = System.Environment.TickCount64;

    private void StartStallWatch()
    {
        _stallWatch = DispatcherQueue.CreateTimer();
        _stallWatch.Interval = TimeSpan.FromMilliseconds(StallTickMs);
        _stallWatch.IsRepeating = true;
        var last = Environment.TickCount64;
        _stallWatch.Tick += (_, __) =>
        {
            var now = Environment.TickCount64;
            var late = now - last - StallTickMs;
            last = now;
            System.Threading.Volatile.Write(ref s_stallTickAt, now);
            if (late >= StallLogMs) LogLine($"ui stall {late} ms");
        };
        _stallWatch.Start();
        if (Environment.GetEnvironmentVariable("PRISM_DEV_SHOT") == "1") StartStallDumpWatch();
    }

    private void StartStallDumpWatch()
    {
        var t = new System.Threading.Thread(() =>
        {
            var dumpedThisFreeze = false;
            while (true)
            {
                System.Threading.Thread.Sleep(1000);
                var gap = Environment.TickCount64 - System.Threading.Volatile.Read(ref s_stallTickAt);
                if (gap < 1000) { dumpedThisFreeze = false; continue; }
                if (gap < StallDumpMs || dumpedThisFreeze) continue;
                dumpedThisFreeze = true;
                try { StallDump(gap); } catch (Exception ex) { LogLine("stall dump failed: " + ex.GetType().Name + " " + ex.Message); }
            }
        }) { IsBackground = true, Name = "stall-dump" };
        t.Start();
    }

    private void StallDump(long gapMs)
    {
        var dir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Prism", "diagnostics", "stalls");
        System.IO.Directory.CreateDirectory(dir);
        var old = new System.IO.DirectoryInfo(dir).GetFiles("stall-*.dmp").OrderByDescending(f => f.LastWriteTimeUtc).ToList();
        if (old.Count > 0 && DateTime.UtcNow - old[0].LastWriteTimeUtc < TimeSpan.FromHours(StallDumpEveryH))
        {
            LogLine($"ui frozen {gapMs} ms - no dump (one in {StallDumpEveryH} h)");
            return;
        }
        foreach (var f in old.Skip(1)) { try { f.Delete(); } catch { } }   // the newest kept beside the one being made
        var tool = System.IO.Path.Combine(AppContext.BaseDirectory, "createdump.exe");
        if (!System.IO.File.Exists(tool)) { LogLine($"ui frozen {gapMs} ms - no createdump beside the app"); return; }
        var path = System.IO.Path.Combine(dir, "stall-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".dmp");
        var pid = Environment.ProcessId;
        LogLine($"ui frozen {gapMs} ms - writing {path}");
        using var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(tool, $"--withheap -f \"{path}\" {pid}") { UseShellExecute = false, CreateNoWindow = true });
        p?.WaitForExit(120_000);
        LogLine($"ui frozen: dump {(System.IO.File.Exists(path) ? "written" : "NOT written")} ({(System.IO.File.Exists(path) ? new System.IO.FileInfo(path).Length / 1_000_000 : 0)} MB)");
    }
}
