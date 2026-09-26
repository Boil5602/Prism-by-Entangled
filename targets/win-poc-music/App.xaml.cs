using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;

namespace PrismMusicPoc;

/// <summary>
/// Widevine-audio POC harness (docs/reports/music-webview2-poc.md).
///
///   PrismMusicPoc                 interactive: three WebView2 tiles (Spotify, Apple
///                                 Music, Pandora), one persistent profile each under
///                                 %LOCALAPPDATA%\Prism-poc-music\&lt;service&gt;; the human
///                                 signs in and presses play; everything EME / media /
///                                 Media Session is logged to ...\logs\&lt;service&gt;.jsonl
///   PrismMusicPoc --probe         unattended: off-screen window, loads each service,
///                                 runs the EME audio-only matrix, logs, exits
///   PrismMusicPoc --selftest      the observer + CDP Media domain against a local page
///   PrismMusicPoc --edge-headless runs the same matrix in msedge --headless=new (the
///                                 hand-off comparison), writes logs\edge-headless.json
///   PrismMusicPoc --handoff X     launches Edge as an app window on service X with its
///                                 own user-data-dir (the §29 hand-off shape)
/// </summary>
public partial class App : Application
{
    public static readonly string DataRoot =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Prism-poc-music");
    public static readonly string LogDir = Path.Combine(DataRoot, "logs");
    /// <summary>Extra Chromium switches for the current mode; empty = the host's configuration (default options).</summary>
    public static string ExtraBrowserArgs = "";

    public static readonly (string id, string name, string url)[] Services =
    {
        ("spotify",     "Spotify",     "https://open.spotify.com/"),
        ("apple-music", "Apple Music", "https://music.apple.com/"),
        ("pandora",     "Pandora",     "https://www.pandora.com/"),
    };

    public static readonly string PocLogPath = Path.Combine(DataRoot, "poc.log");
    private const string Usage = "PrismMusicPoc --run | --probe [--settle=ms --watch=ms] | --selftest | --edge-headless [--budget=ms] | --handoff <spotify|apple-music|pandora>";

    /// <summary>Harness-level log: stdout + %LOCALAPPDATA%\Prism-poc-music\poc.log. The harness
    /// never shows a dialog - every failure lands here and the process exits non-zero.</summary>
    public static void Say(string line)
    {
        var text = $"{DateTime.Now:O} {line}";
        try { Console.WriteLine(text); } catch { }
        try { File.AppendAllText(PocLogPath, text + Environment.NewLine, Encoding.UTF8); } catch { }
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Directory.CreateDirectory(LogDir);
        var args = e.Args;
        var mode = args.Length > 0 ? args[0] : "--help";
        try
        {
            switch (mode)
            {
                case "--run":
                {
                    // the only windowed mode: the deliverable the USER launches deliberately
                    Say("run: interactive window (three tiles)");
                    var w = new MainWindow(headless: false);
                    w.Closed += (_, _) => Shutdown(0);
                    w.Show();
                    break;
                }
                case "--probe":
                {
                    Say("probe: off-screen WebView2, three services");
                    var w = new MainWindow(headless: true);
                    w.Show();
                    await w.RunProbeSequenceAsync(args.Skip(1).ToArray());
                    w.Close();
                    Shutdown(0);
                    break;
                }
                case "--selftest":
                {
                    // the harness observing its own local page: proves the observer + CDP Media
                    // domain deliver in this runtime (clear-key EME round trip + a WAV pipeline)
                    Say("selftest: off-screen WebView2 on the loopback page");
                    using var server = new LocalServer(AppContext.BaseDirectory);
                    var w = new MainWindow(headless: true, services: new[] { ("selftest", "Self-test", server.BaseUrl + "selftest.html") });
                    w.Show();
                    await w.RunProbeSequenceAsync(new[] { "--settle=2000", "--watch=6000" });
                    w.Close();
                    Shutdown(0);
                    break;
                }
                case "--hidden-test":
                {
                    // section 32 hidden facets: does a WebView2 keep advancing media at 0x0 and at 1x1? Off-screen window,
                    // a 60 s muted WAV; the log's tick lines (currentTime vs wall clock) per phase are the measurement.
                    Say("hidden-test: off-screen WebView2, phases visible -> 0x0 -> 1x1 -> collapsed -> visible");
                    ExtraBrowserArgs = "--autoplay-policy=no-user-gesture-required";   // measures hidden-state playback, not autoplay: no human gesture exists off-screen
                    using var server = new LocalServer(AppContext.BaseDirectory);
                    // three variants: a muted element (Chromium may background-pause muted media), an unmuted element with the
                    // CONTROL muted (the host's §3 mute path), and an unmuted quiet element (the audible case)
                    var w = new MainWindow(headless: true, services: new[]
                    {
                        ("hidden-muted-element", "Hidden test (muted element)", server.BaseUrl + "hiddentest.html"),
                        ("hidden-control-muted", "Hidden test (control IsMuted)", server.BaseUrl + "hiddentest.html?unmuted=1"),
                        ("hidden-audible", "Hidden test (audible, quiet)", server.BaseUrl + "hiddentest.html?unmuted=1&vol=0.02"),
                    });
                    w.Show();
                    await w.RunHiddenTestAsync();
                    w.Close();
                    Shutdown(0);
                    break;
                }
                case "--edge-headless":
                    Say("edge-headless: msedge --headless=new on the loopback probe page");
                    await EdgeHeadless.RunAsync(args.Skip(1).ToArray());
                    Shutdown(0);
                    break;
                case "--handoff":
                {
                    var svc = Services.FirstOrDefault(s => s.id == (args.Length > 1 ? args[1] : ""));
                    if (svc.id is null) { Say("usage: " + Usage); Shutdown(2); break; }
                    EdgeHeadless.LaunchHandoff(svc.id, svc.url);
                    Shutdown(0);
                    break;
                }
                default:
                    Say("usage: " + Usage + "  (logs: " + LogDir + ")");
                    Shutdown(mode is "--help" or "-h" or "/?" ? 0 : 2);
                    break;
            }
        }
        catch (Exception ex)
        {
            Say("FAILED " + mode + ": " + ex);
            Shutdown(1);
        }
    }
}

/// <summary>One JSONL log per service plus a human summary line stream.</summary>
public sealed class PocLog
{
    private readonly string _path;
    private readonly object _gate = new();
    public PocLog(string service) { _path = Path.Combine(App.LogDir, service + ".jsonl"); }

    public void Write(string kind, object data)
    {
        var line = JsonSerializer.Serialize(new { at = DateTime.Now.ToString("O"), kind, data });
        lock (_gate) File.AppendAllText(_path, line + "\n", Encoding.UTF8);
    }
    public void Raw(string jsonLine)
    {
        lock (_gate) File.AppendAllText(_path, jsonLine + "\n", Encoding.UTF8);
    }
}

public static class EdgeHeadless
{
    public static string? FindEdge()
    {
        foreach (var p in new[]
        {
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
        }) if (File.Exists(p)) return p;
        return null;
    }

    /// <summary>Runs probe.html in headless Edge (a throwaway user-data-dir under the POC
    /// root so the run never touches the user's Edge profile) and stores the JSON.</summary>
    public static async Task RunAsync(string[] extra)
    {
        var edge = FindEdge() ?? throw new InvalidOperationException("msedge.exe not found");
        using var server = new LocalServer(AppContext.BaseDirectory);
        var udd = Path.Combine(App.DataRoot, "edge-headless-profile");
        Directory.CreateDirectory(udd);
        var psi = new ProcessStartInfo(edge)
        {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true,
        };
        foreach (var a in new[]
        {
            "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
            $"--user-data-dir={udd}", "--dump-dom", server.BaseUrl + "probe.html",
        }) psi.ArgumentList.Add(a);
        App.Say("edge-headless: " + edge + " " + string.Join(" ", psi.ArgumentList));
        var t0 = DateTime.Now;
        using var p = Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEndAsync();
        var stderr = p.StandardError.ReadToEndAsync();
        var exited = p.WaitForExitAsync();
        await Task.WhenAny(exited, Task.Delay(120000));
        if (!p.HasExited) { App.Say("edge-headless: timeout, killing msedge"); try { p.Kill(true); } catch { } }
        var dom = await stdout;
        var err = await stderr;
        // the page POSTs its JSON to the loopback server; the DOM dump is the fallback
        var json = server.Result;
        var source = "posted";
        if (json is null)
        {
            var i = dom.IndexOf("PRISM-EME-BEGIN", StringComparison.Ordinal);
            var j = i < 0 ? -1 : dom.IndexOf("PRISM-EME-END", i, StringComparison.Ordinal);
            json = (i >= 0 && j > i) ? System.Net.WebUtility.HtmlDecode(dom.Substring(i + "PRISM-EME-BEGIN".Length, j - i - "PRISM-EME-BEGIN".Length).Trim()) : null;
            source = json is null ? "none" : "dump-dom";
        }
        JsonElement? result = null;
        try { if (json is not null) result = JsonDocument.Parse(json).RootElement.Clone(); }
        catch (Exception ex) { App.Say("edge-headless: result did not parse: " + ex.Message); }
        var outPath = Path.Combine(App.LogDir, "edge-headless.json");
        var wrapper = new
        {
            at = t0.ToString("O"), edge, args = psi.ArgumentList, exitCode = p.HasExited ? p.ExitCode : -1,
            durationMs = (DateTime.Now - t0).TotalMilliseconds, resultSource = source,
            stderr = err.Length > 4000 ? err[..4000] : err,
            result,
            domIfNoResult = result is null ? dom : null,
        };
        File.WriteAllText(outPath, JsonSerializer.Serialize(wrapper, new JsonSerializerOptions { WriteIndented = true }));
        App.Say($"edge-headless: exit={wrapper.exitCode} result={source} rows={(result is { } r && r.TryGetProperty("rows", out var rows) ? rows.GetArrayLength() : 0)} -> {outPath}");
        if (result is null) throw new InvalidOperationException("edge-headless produced no result (see " + outPath + ")");
    }

    /// <summary>The §29 hand-off shape: Edge as an installed-app window, its own profile
    /// under the POC root (never the user's daily Edge profile).</summary>
    public static void LaunchHandoff(string service, string url)
    {
        var edge = FindEdge() ?? throw new InvalidOperationException("msedge.exe not found");
        var udd = Path.Combine(App.DataRoot, "edge-" + service);
        Directory.CreateDirectory(udd);
        var psi = new ProcessStartInfo(edge) { UseShellExecute = false };
        foreach (var a in new[] { $"--user-data-dir={udd}", "--no-first-run", "--no-default-browser-check", $"--app={url}" })
            psi.ArgumentList.Add(a);
        Process.Start(psi);
        File.AppendAllText(Path.Combine(App.LogDir, "handoff.log"), $"{DateTime.Now:O} launched {service} {url} udd={udd}\n");
    }
}
