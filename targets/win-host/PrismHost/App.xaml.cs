using System.IO;
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;

namespace PrismHost;

public partial class App : Application
{
    private Window? _window;
    [ThreadStatic] private static bool _inFirstChance;

    public App()
    {
        InitializeComponent();
        // A stowed XAML exception kills the process with only a WER offset to show
        // for it; write the managed exception first so host.log can say why.
        // 2026-09-07: the host died on a fail-fast in combase (E_INVALID_STATE) with no managed report, seven times
        // in an hour. Every managed exception is first-chance before XAML turns one into a fail-fast: the last few
        // with their top frames name the call. Throttled, capped, diagnostics only.
        var fcLock = new object(); var fcCount = 0;
        // 2026-10-07, a friend's first start: PrismHost.exe 0.26.26 died in coreclr with 0xc00000fd, a stack overflow. On a new PC the data
        // folder does not exist yet, so the log write below threw, its own exception came back into this handler, which threw again, until
        // the stack ran out - before any window. The folder is made first, and the handler never re-enters itself.
        try { Directory.CreateDirectory(HostPaths.Diagnostics); } catch { }
        try   // one run's worth at a time: the file only ever grew (72 MB on 2026-09-28)
        {
            var fcPath = Path.Combine(HostPaths.Diagnostics, "firstchance.log");
            if (File.Exists(fcPath) && new FileInfo(fcPath).Length > 4_000_000) File.Move(fcPath, fcPath + ".prev", overwrite: true);
        }
        catch { }
        AppDomain.CurrentDomain.FirstChanceException += (_, fe) =>
        {
            if (_inFirstChance) return;   // an exception thrown while logging one is never logged: it would come straight back here
            _inFirstChance = true;
            try
            {
                if (fcCount > 600) return;
                var ex = fe.Exception;
                var frames = Environment.StackTrace.Split('\n');   // the live stack at the throw - ex.StackTrace holds only the throw site at first chance
                var top = string.Join(" | ", frames.Select(f => f.Trim()).Where(f => f.Contains("PrismHost")).Take(3).DefaultIfEmpty(frames.FirstOrDefault()?.Trim() ?? ""));
                var line = $"{DateTime.Now:HH:mm:ss.fff} first-chance {ex.GetType().Name} 0x{ex.HResult:X8}: {ex.Message.Replace('\n', ' ')} @ {top}";
                lock (fcLock) { fcCount++; File.AppendAllText(Path.Combine(HostPaths.Diagnostics, "firstchance.log"), PrismHost.Diagnostics.Redact.Line(line) + "\n"); }
            }
            catch { }
            finally { _inFirstChance = false; }
        };
        UnhandledException += (_, e) =>
        {
            try
            {
                var diag = HostPaths.Diagnostics;
                Directory.CreateDirectory(diag);
                File.AppendAllText(Path.Combine(diag, "host.log"), PrismHost.Diagnostics.Redact.Line($"{DateTime.Now:HH:mm:ss.fff} UNHANDLED {e.Message}\n{e.Exception}") + "\n");   // B-91/22: an exception message can carry a request
            }
            catch { }
        };
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        HostPaths.RotateHostLog();
        // §28 (Services/Updates.cs, 2026-10-05): a newer version staged under the data folder runs instead of this one - the person's
        // shortcut keeps pointing at the first unpacked folder, and that exe hands off
        // the fixed install folder (2026-10-06, Services/Updates.AtStart): a staged update installs itself, a copy run from elsewhere installs
        // itself or hands off to the installed one - before anything opens
        if (Services.Updates.AtStart(line => { try { File.AppendAllText(Path.Combine(HostPaths.DataDir, "diagnostics", "host.log"), PrismHost.Diagnostics.Redact.Line(DateTime.Now.ToString("HH:mm:ss.fff") + " " + line) + "\n"); } catch { } })) { Exit(); return; }   // B-91: every log write is redacted
        _ = Task.Run(Services.ArtCache.Prune);   // the kept card pictures stay within their size (Services/ArtCache)   // B-268: a log past 64 MB kept once as host.log.prev, before this run's first line
        // Evergreen-only (win-host-spec §2/§11 — Fixed lacks PlayReady): the
        // check asks for the machine-wide Evergreen runtime and FAILS LOUDLY
        // when it is absent. We never point at a Fixed folder, so a Fixed-only
        // machine fails here by construction.
        string version;
        try
        {
            version = CoreWebView2Environment.GetAvailableBrowserVersionString(null);
        }
        catch (Exception ex)
        {
            Fail("Prism requires the Microsoft Edge WebView2 EVERGREEN runtime.\n\n" +
                 "It was not found on this machine (a Fixed Version runtime does not count — " +
                 "it lacks PlayReady DRM).\n\nInstall it from https://developer.microsoft.com/microsoft-edge/webview2/ and start Prism again.\n\n" +
                 "Detail: " + ex.Message);
            return;
        }
        if (string.IsNullOrWhiteSpace(version))
        {
            Fail("WebView2 Evergreen runtime reported no version — refusing to start (win-host-spec §11).");
            return;
        }

        _window = new MainWindow();
        _window.Activate();
    }

    private static void Fail(string message)
    {
        _ = MessageBoxW(IntPtr.Zero, message, "Prism cannot start", 0x00000010 /* MB_ICONERROR */);
        Environment.Exit(1);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);
}
