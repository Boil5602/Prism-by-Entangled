using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace PrismMusicPoc;

/// <summary>
/// Three WebView2 tiles (Spotify / Apple Music / Pandora), one persistent
/// profile each, every EME / media-element / Media Session / CDP-Media event
/// logged to %LOCALAPPDATA%\Prism-poc-music\logs\&lt;service&gt;.jsonl. No solver,
/// no veil, no orchestration - a measurement rig only.
/// </summary>
public partial class MainWindow : Window
{
    private sealed class Tile
    {
        public required string Id;
        public required string Name;
        public required string Url;
        public required WebView2 View;
        public required PocLog Log;
        public required TextBlock Status;
        public string LastEme = "eme: not probed yet";
        public string LastMs = "";
        public readonly TaskCompletionSource<bool> FirstLoad = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public CoreWebView2? Core => View.CoreWebView2;
    }

    private readonly List<Tile> _tiles = new();
    private readonly bool _headless;
    private static readonly string LoggerJs = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "media-logger.js"));
    private static readonly string ProbeJs = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "eme-probe.js"));
    private static readonly string[] MediaEvents =
        { "Media.playersCreated", "Media.playerEventsAdded", "Media.playerPropertiesChanged", "Media.playerErrorsRaised", "Media.playerMessagesLogged" };

    public MainWindow(bool headless, (string id, string name, string url)[]? services = null)
    {
        InitializeComponent();
        _headless = headless;
        if (headless)
        {
            // parked off every monitor; a real HWND so WebView2 initialises, never on screen
            Left = -32000; Top = -32000; Width = 1400; Height = 900;
            ShowInTaskbar = false; ShowActivated = false;
        }
        else
        {
            Left = 40; Top = 40;
        }
        var i = 0;
        foreach (var (id, name, url) in services ?? App.Services)
        {
            var view = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(0x14, 0x17, 0x1C), Margin = new Thickness(2, 0, 2, 0) };
            Grid.SetColumn(view, i);
            Tiles.Children.Add(view);
            var status = (TextBlock)FindName("Status" + i)!;
            _tiles.Add(new Tile { Id = id, Name = name, Url = url, View = view, Log = new PocLog(id), Status = status });
            i++;
        }
        Loaded += async (_, _) => { foreach (var t in _tiles) await InitAsync(t); };
    }

    // ---------------------------------------------------------------- init
    private async Task InitAsync(Tile t)
    {
        try
        {
            var profile = Path.Combine(App.DataRoot, t.Id);
            // Default options + default UA: the host's own configuration (SurfaceManager.AttachViewAsync).
            var env = await CoreWebView2Environment.CreateAsync(null, profile, new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = App.ExtraBrowserArgs });
            await t.View.EnsureCoreWebView2Async(env);
            var core = t.Core!;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsPinchZoomEnabled = false;
            t.Log.Write("env", new { webview2 = env.BrowserVersionString, profile, userAgent = core.Settings.UserAgent, headless = _headless, harness = "PrismMusicPoc" });

            await core.AddScriptToExecuteOnDocumentCreatedAsync(LoggerJs);

            core.WebMessageReceived += (_, e) =>
            {
                string? json = null;
                try { json = e.TryGetWebMessageAsString(); } catch { }
                if (json is null) return;
                try
                {
                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;
                    if (root.TryGetProperty("type", out var ty) && ty.GetString() == "poc")
                    {
                        var kind = root.GetProperty("kind").GetString() ?? "?";
                        t.Log.Write("page." + kind, root);
                        if (kind == "mediaSession.state") { t.LastMs = Compact(root.GetProperty("data")); Paint(t); }
                        if (kind is "rmksa" or "createMediaKeys" or "media.error" or "media.playing" or "session.keystatuseschange") Paint(t, kind + " " + Compact(root.GetProperty("data")));
                    }
                    else t.Log.Write("page.other", root);
                }
                catch { t.Log.Write("page.raw", json); }
            };

            // CDP Media domain: decoder names, decrypting-demuxer flags, player errors - the
            // ground truth for "is DRM audio actually being decoded".
            foreach (var ev in MediaEvents)
            {
                var name = ev;
                core.GetDevToolsProtocolEventReceiver(ev).DevToolsProtocolEventReceived += (_, e) =>
                {
                    try { using var d = JsonDocument.Parse(e.ParameterObjectAsJson); t.Log.Write("cdp." + name, d.RootElement); } catch { }
                };
            }
            core.GetDevToolsProtocolEventReceiver("Log.entryAdded").DevToolsProtocolEventReceived += (_, e) =>
            {
                try
                {
                    using var d = JsonDocument.Parse(e.ParameterObjectAsJson);
                    var entry = d.RootElement.GetProperty("entry");
                    var level = entry.GetProperty("level").GetString();
                    if (level is "error" or "warning") t.Log.Write("cdp.log", new { level, source = entry.GetProperty("source").GetString(), text = entry.GetProperty("text").GetString(), url = entry.TryGetProperty("url", out var u) ? u.GetString() : null });
                }
                catch { }
            };
            core.GetDevToolsProtocolEventReceiver("Runtime.consoleAPICalled").DevToolsProtocolEventReceived += (_, e) =>
            {
                try
                {
                    using var d = JsonDocument.Parse(e.ParameterObjectAsJson);
                    var type = d.RootElement.GetProperty("type").GetString();
                    if (type is not ("error" or "warning" or "assert")) return;
                    var parts = new List<string>();
                    foreach (var a in d.RootElement.GetProperty("args").EnumerateArray())
                    {
                        if (a.TryGetProperty("value", out var v)) parts.Add(v.ToString());
                        else if (a.TryGetProperty("description", out var ds)) parts.Add(ds.GetString() ?? "");
                    }
                    var text = string.Join(" ", parts);
                    t.Log.Write("cdp.console", new { type, text = text.Length > 600 ? text[..600] : text });
                }
                catch { }
            };
            await core.CallDevToolsProtocolMethodAsync("Media.enable", "{}");
            await core.CallDevToolsProtocolMethodAsync("Log.enable", "{}");
            await core.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}");

            core.NavigationStarting += (_, e) => t.Log.Write("nav.starting", new { uri = e.Uri, redirect = e.IsRedirected, top = !e.IsUserInitiated ? "auto" : "user" });
            core.NavigationCompleted += (_, e) =>
            {
                t.Log.Write("nav.completed", new { success = e.IsSuccess, status = e.HttpStatusCode, error = e.WebErrorStatus.ToString(), url = core.Source });
                t.FirstLoad.TrySetResult(true);
                Paint(t);
            };
            core.SourceChanged += (_, _) => Paint(t);
            core.ProcessFailed += (_, e) => t.Log.Write("process.failed", new { kind = e.ProcessFailedKind.ToString(), reason = e.Reason.ToString(), exit = e.ExitCode, desc = e.ProcessDescription });
            core.PermissionRequested += (_, e) => t.Log.Write("permission", new { kind = e.PermissionKind.ToString(), uri = e.Uri });
            core.NewWindowRequested += (_, e) => HandleNewWindow(t, env, e);

            core.Navigate(t.Url);
        }
        catch (Exception ex)
        {
            t.Log.Write("harness.error", ex.ToString());
            t.Status.Text = $"{t.Id}: WebView2 init failed - {ex.Message}";
            t.FirstLoad.TrySetResult(false);
        }
    }

    /// <summary>Sign-in popups (Google / Apple ID) open in a child window on the SAME
    /// profile so the session lands in the tile (the host does the same, §10/§30).
    /// The child is logged but carries no page observer - see the report's surface
    /// inventory for why that gap matters in the host.</summary>
    private void HandleNewWindow(Tile t, CoreWebView2Environment env, CoreWebView2NewWindowRequestedEventArgs e)
    {
        t.Log.Write("newWindow", new { uri = e.Uri, userInitiated = e.IsUserInitiated });
        if (_headless) { e.Handled = true; return; }
        var deferral = e.GetDeferral();
        e.Handled = true;
        var popupView = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(0x14, 0x17, 0x1C) };
        var win = new Window { Title = $"{t.Name} - popup ({e.Uri})", Width = 720, Height = 820, Content = popupView, Owner = this, Background = Background };
        win.Show();
        _ = Task.Run(async () =>
        {
            await Dispatcher.InvokeAsync(async () =>
            {
                try
                {
                    await popupView.EnsureCoreWebView2Async(env);
                    var pc = popupView.CoreWebView2;
                    pc.WindowCloseRequested += (_, _) => win.Close();
                    pc.NavigationCompleted += (_, _) => t.Log.Write("popup.nav", new { url = pc.Source });
                    e.NewWindow = pc;
                }
                catch (Exception ex) { t.Log.Write("popup.error", ex.Message); }
                finally { deferral.Complete(); }
            });
        });
    }

    // ---------------------------------------------------------------- probe
    /// <summary>Loads eme-probe.js into the page and awaits the matrix through CDP
    /// Runtime.evaluate (awaitPromise), so the result comes back as one JSON value.</summary>
    private async Task<JsonElement?> RunEmeAsync(Tile t)
    {
        var core = t.Core;
        if (core is null) return null;
        try
        {
            await core.ExecuteScriptAsync(ProbeJs);
            var raw = await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate", JsonSerializer.Serialize(new
            {
                expression = "window.__prismRunEmeProbe()", awaitPromise = true, returnByValue = true, timeout = 180000,
            }));
            using var doc = JsonDocument.Parse(raw);
            var result = doc.RootElement.GetProperty("result");
            if (result.TryGetProperty("value", out var value))
            {
                var clone = value.Clone();
                var path = Path.Combine(App.LogDir, t.Id + ".eme.json");
                File.WriteAllText(path, JsonSerializer.Serialize(clone, new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
                var summary = Summarize(clone);
                t.Log.Write("eme.matrix", new { file = path, summary });
                t.LastEme = "eme: " + summary;
                Paint(t);
                return clone;
            }
            t.Log.Write("eme.error", raw);
            t.LastEme = "eme: evaluate returned no value (see log)";
        }
        catch (Exception ex)
        {
            t.Log.Write("eme.error", ex.ToString());
            t.LastEme = "eme: failed - " + ex.Message;
        }
        Paint(t);
        return null;
    }

    /// <summary>One line per key system: which audio-only robustness values were granted for
    /// AAC, and the first error name for the rejected ones.</summary>
    public static string Summarize(JsonElement matrix)
    {
        var sb = new StringBuilder();
        var byKs = new Dictionary<string, List<string>>();
        foreach (var row in matrix.GetProperty("rows").EnumerateArray())
        {
            var label = row.GetProperty("label").GetString() ?? "";
            if (!label.StartsWith("audio-only audio/mp4; codecs=\"mp4a.40.2\" robustness=", StringComparison.Ordinal)) continue;
            var ks = row.GetProperty("keySystem").GetString() ?? "";
            var r = label.Substring(label.IndexOf("robustness=", StringComparison.Ordinal) + 11).Trim('"');
            var ok = row.GetProperty("ok").GetBoolean();
            string cell;
            if (ok)
            {
                var cmk = row.TryGetProperty("createMediaKeys", out var c) ? (c.ValueKind == JsonValueKind.String ? c.GetString() : c.GetProperty("name").GetString()) : "?";
                cell = $"{(r == "" ? "''" : r)}:granted/{cmk}";
            }
            else cell = $"{(r == "" ? "''" : r)}:{row.GetProperty("error").GetProperty("name").GetString()}";
            if (!byKs.TryGetValue(ks, out var list)) byKs[ks] = list = new List<string>();
            list.Add(cell);
        }
        foreach (var (ks, cells) in byKs) sb.Append(ks.Replace("com.", "")).Append(" [").Append(string.Join(" ", cells)).Append("] ");
        return sb.ToString().TrimEnd();
    }

    /// <summary>Unattended run: every service loads, settles, gets probed, and is watched
    /// for a while so pre-login media/EME activity lands in the log; then a summary.</summary>
    public async Task RunProbeSequenceAsync(string[] args)
    {
        var settleMs = 5000; var watchMs = 20000;
        foreach (var a in args)
        {
            if (a.StartsWith("--settle=", StringComparison.Ordinal)) settleMs = int.Parse(a[9..]);
            if (a.StartsWith("--watch=", StringComparison.Ordinal)) watchMs = int.Parse(a[8..]);
        }
        var summary = new StringBuilder();
        summary.AppendLine($"Prism music POC - unattended probe {DateTime.Now:O}");
        summary.AppendLine($"WebView2 runtime: {SafeVersion()}");
        foreach (var t in _tiles)
        {
            var loaded = await Task.WhenAny(t.FirstLoad.Task, Task.Delay(45000)) == t.FirstLoad.Task && t.FirstLoad.Task.Result;
            summary.AppendLine($"{t.Id}: first load {(loaded ? "ok" : "TIMEOUT/FAILED")} url={t.Core?.Source}");
        }
        await Task.Delay(settleMs);
        foreach (var t in _tiles)
        {
            var m = await RunEmeAsync(t);
            summary.AppendLine($"{t.Id}: {(m is null ? "probe failed (see " + t.Id + ".jsonl)" : t.LastEme)}");
        }
        await Task.Delay(watchMs);
        foreach (var t in _tiles)
        {
            summary.AppendLine($"{t.Id}: final url={t.Core?.Source} mediaSession={(t.LastMs == "" ? "(none observed)" : t.LastMs)}");
        }
        File.WriteAllText(Path.Combine(App.LogDir, "probe-summary.txt"), summary.ToString(), Encoding.UTF8);
        Console.WriteLine(summary.ToString());
    }

    /// <summary>Hidden-surface measurement: the same page, resized through the sizes a hidden facet might
    /// take. Each phase is marked in the log; ticks carry currentTime + wall clock so the advance rate per
    /// phase is computable (1.0 = playing normally, 0 = frozen).</summary>
    public async Task RunHiddenTestAsync()
    {
        foreach (var t in _tiles) await Task.WhenAny(t.FirstLoad.Task, Task.Delay(30000));
        // the control-muted variant: the host's page-invisible mute (CoreWebView2.IsMuted), element unmuted
        await Dispatcher.InvokeAsync(() => { foreach (var t in _tiles) if (t.Id == "hidden-control-muted" && t.Core is { } c) c.IsMuted = true; });
        async Task Phase(string name, Action<Tile> apply, int ms)
        {
            await Dispatcher.InvokeAsync(() => { foreach (var t in _tiles) apply(t); });
            foreach (var t in _tiles) t.Log.Write("harness.phase", new { name });
            await Task.Delay(ms);
        }
        await Phase("visible", _ => { }, 8000);
        await Phase("size-0x0", t => { t.View.Width = 0; t.View.Height = 0; }, 12000);
        await Phase("size-1x1", t => { t.View.Width = 1; t.View.Height = 1; }, 12000);
        await Phase("collapsed", t => { t.View.Width = double.NaN; t.View.Height = double.NaN; t.View.Visibility = Visibility.Collapsed; }, 12000);
        await Phase("size-1x1-offcanvas", t => { t.View.Visibility = Visibility.Visible; t.View.Width = 1; t.View.Height = 1; t.View.Margin = new Thickness(-4000, -4000, 0, 0); }, 12000);
        await Phase("visible-again", t => { t.View.Margin = new Thickness(2, 0, 2, 0); t.View.Width = double.NaN; t.View.Height = double.NaN; }, 8000);
        foreach (var t in _tiles) t.Log.Write("harness.phase", new { name = "end" });
    }

    private static string SafeVersion()
    {
        try { return CoreWebView2Environment.GetAvailableBrowserVersionString(); } catch (Exception ex) { return "unavailable: " + ex.Message; }
    }

    // ---------------------------------------------------------------- ui
    private static string Compact(JsonElement e)
    {
        var s = e.GetRawText();
        return s.Length > 220 ? s[..220] + "..." : s;
    }

    private void Paint(Tile t, string? last = null)
    {
        Dispatcher.InvokeAsync(() =>
        {
            var url = ""; try { url = t.Core?.Source ?? ""; } catch { }
            t.Status.Text = $"{t.Id}: {url}\n   {t.LastEme}\n   mediaSession: {(t.LastMs == "" ? "(none yet)" : t.LastMs)}{(last is null ? "" : "\n   last: " + last)}";
        });
    }

    private void Hero_Click(object sender, RoutedEventArgs e)
    {
        var who = (sender as Button)?.Tag as string ?? "";
        Col0.Width = new GridLength(who == "spotify" ? 3 : 1, GridUnitType.Star);
        Col1.Width = new GridLength(who == "apple-music" ? 3 : 1, GridUnitType.Star);
        Col2.Width = new GridLength(who == "pandora" ? 3 : 1, GridUnitType.Star);
        HeroLabel.Text = who == "" ? "equal thirds" : $"hero: {who}";
    }

    /// <summary>§32 placement model: music facets are hidden-only. Collapsing the control
    /// (document.visibilityState -> hidden, no pixels) while the log's timeupdate heartbeat
    /// keeps arriving is the evidence that audio survives a hidden surface.</summary>
    private void Hide_Click(object sender, RoutedEventArgs e)
    {
        var who = (sender as Button)?.Tag as string ?? "";
        var t = _tiles.FirstOrDefault(x => x.Id == who);
        if (t is null) return;
        var hidden = t.View.Visibility == Visibility.Collapsed;
        t.View.Visibility = hidden ? Visibility.Visible : Visibility.Collapsed;
        t.Log.Write("harness.visibility", new { visible = hidden });
        Paint(t, hidden ? "shown again" : "HIDDEN (Visibility.Collapsed) - watch for media.timeupdate lines");
    }

    private async void Probe_Click(object sender, RoutedEventArgs e)
    {
        foreach (var t in _tiles) await RunEmeAsync(t);
    }

    private void Logs_Click(object sender, RoutedEventArgs e)
    {
        try { Process.Start(new ProcessStartInfo(App.LogDir) { UseShellExecute = true }); } catch { }
    }
}
