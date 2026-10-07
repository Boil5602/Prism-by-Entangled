using System.Diagnostics;

namespace PrismHost;

/// <summary>
/// Where this host keeps everything: store.json, the per-App WebView2 profiles
/// (the sessions, never wiped - spec section 10), host-prefs.json and the
/// diagnostics folder. Default: %LOCALAPPDATA%\Prism. PRISM_DATA_DIR points
/// the whole host somewhere else for a from-scratch run - a fresh store, fresh
/// profiles (so every sign-in is a real sign-in), its own host.log - without
/// touching the household's real data. scripts/run-fresh.ps1 sets it.
///
/// Reset to defaults / Restore a backup work the same way and honour section
/// 10 by MOVING, never deleting: a request file is written, the host restarts,
/// and the next start (before any WebView2 has opened a profile, so nothing is
/// locked) moves the whole folder aside as &lt;folder&gt;-backup-&lt;stamp&gt; and
/// starts empty - or moves a chosen backup back in, parking the current data
/// the same way. A move that fails leaves everything where it was.
/// </summary>
internal static class HostPaths
{
    public const string ResetRequest = "reset.pending";
    public const string RestoreRequest = "restore.pending";

    public static readonly string DataDir = ResolveDataDir();

    public static string Diagnostics => Path.Combine(DataDir, "diagnostics");
    /// <summary>host.log grows with every report the wall makes and was never rotated (1.09 GB on 2026-09-22, B-268): at boot, a log past
    /// 64 MB is kept once as host.log.prev (the previous one replaced) and a fresh one begins. Nothing else in diagnostics is touched.
    /// Called at the start and, since 2026-09-30, every so many lines while the host runs (MainWindow.AppendHostLog): a long run's log
    /// had reached two gigabytes. The host's own diagnostics folder is the store's root, the same folder this class names.</summary>
    public static void RotateHostLog()
    {
        try
        {
            var log = Path.Combine(Diagnostics, "host.log");
            if (!File.Exists(log) || new FileInfo(log).Length < 64L * 1024 * 1024) return;
            var prev = Path.Combine(Diagnostics, "host.log.prev");
            if (File.Exists(prev)) File.Delete(prev);
            File.Move(log, prev);
        }
        catch { /* a locked or missing log is left as it is */ }
    }

    /// <summary>True when this run was pointed away from the default folder (shown in the window title).</summary>
    public static bool IsOverridden => Environment.GetEnvironmentVariable("PRISM_DATA_DIR") is { Length: > 0 };

    /// <summary>What the last start did about a pending reset / restore, for the log and the About page.</summary>
    public static string? LastStartNote { get; private set; }

    private static string ResolveDataDir()
    {
        var env = Environment.GetEnvironmentVariable("PRISM_DATA_DIR");
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Prism");
        if (!string.IsNullOrWhiteSpace(env))
        {
            try { dir = Path.GetFullPath(env.Trim()); } catch { /* keep the default */ }
        }
        try { ApplyPending(dir); } catch (Exception ex) { LastStartNote = "reset/restore failed: " + ex.Message + " - data left where it was"; }
        return dir;
    }

    /// <summary>The backup folders beside the data folder (newest first): &lt;folder&gt;-backup-&lt;stamp&gt;.</summary>
    public static IReadOnlyList<string> Backups()
    {
        try
        {
            var parent = Path.GetDirectoryName(DataDir);
            var name = Path.GetFileName(DataDir);
            if (parent is null) return Array.Empty<string>();
            return Directory.GetDirectories(parent, name + "-backup-*").OrderByDescending(p => p).ToList();
        }
        catch { return Array.Empty<string>(); }
    }

    /// <summary>Ask the next start to move the current data aside and begin empty.</summary>
    public static void RequestReset() => File.WriteAllText(Path.Combine(DataDir, ResetRequest), DateTime.Now.ToString("o"));

    /// <summary>Ask the next start to park the current data and bring this backup back.</summary>
    public static void RequestRestore(string backupDir) => File.WriteAllText(Path.Combine(DataDir, RestoreRequest), backupDir);

    /// <summary>Start a new host and leave; the new one applies the request before it opens anything.</summary>
    public static void Restart()
    {
        var exe = Environment.ProcessPath;
        if (exe is null) return;
        var psi = new ProcessStartInfo(exe) { UseShellExecute = true };
        Process.Start(psi);
        Environment.Exit(0);
    }

    private static void ApplyPending(string dir)
    {
        var reset = Path.Combine(dir, ResetRequest);
        var restore = Path.Combine(dir, RestoreRequest);
        var wantReset = File.Exists(reset);
        var wantRestore = File.Exists(restore) ? File.ReadAllText(restore).Trim() : null;
        if (!wantReset && wantRestore is null) return;

        // the previous instance may still be closing its WebViews: give it a moment, never fight it
        var me = Environment.ProcessId;
        for (var i = 0; i < 40; i++)
        {
            if (!Process.GetProcessesByName("PrismHost").Any(p => p.Id != me)) break;
            Thread.Sleep(250);
        }

        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmm");
        var parked = dir + "-backup-" + stamp;
        for (var n = 2; Directory.Exists(parked); n++) parked = dir + "-backup-" + stamp + "-" + n;

        // the request file must not travel with the parked data (it would fire again on a restore)
        try { File.Delete(reset); } catch { }
        try { File.Delete(restore); } catch { }

        if (wantRestore is not null && !Directory.Exists(wantRestore))
        {
            LastStartNote = "restore: " + wantRestore + " is not there - nothing changed";
            return;
        }

        // the move itself is tried for up to twenty seconds (2026-10-05: WebView2's browser processes outlive the host by a few seconds and
        // hold the profile folder; the first try failed with "Access to the path is denied" and the reset did nothing)
        Exception? last = null;
        for (var i = 0; i < 80; i++)
        {
            try { Directory.Move(dir, parked); last = null; break; }   // everything, sessions included, kept whole
            catch (IOException ex) { last = ex; Thread.Sleep(250); }
            catch (UnauthorizedAccessException ex) { last = ex; Thread.Sleep(250); }
        }
        if (last is not null) throw last;
        if (wantRestore is not null) Directory.Move(wantRestore, dir);
        else Directory.CreateDirectory(dir);

        Directory.CreateDirectory(Path.Combine(dir, "diagnostics"));
        LastStartNote = wantRestore is not null
            ? "restored " + Path.GetFileName(wantRestore) + "; the data it replaced is parked at " + Path.GetFileName(parked)
            : "reset to defaults; the previous data is parked at " + Path.GetFileName(parked) + " (nothing deleted)";
        File.AppendAllText(Path.Combine(dir, "diagnostics", "host.log"), PrismHost.Diagnostics.Redact.Line(DateTime.Now.ToString("HH:mm:ss.fff") + " " + LastStartNote) + "\n");   // B-91: every log write is redacted
    }
}
