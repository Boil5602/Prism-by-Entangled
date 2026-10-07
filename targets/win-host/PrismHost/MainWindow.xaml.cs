using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using PrismHost.Brain;
using PrismHost.Channel;
using PrismHost.Core;
using PrismHost.Device;
using PrismHost.Storage;
using PrismHost.Services;
using PrismHost.Services.Audio;
using PrismHost.Surfaces;
using Windows.System;

namespace PrismHost;

/// <summary>
/// M1 host window (win-host-spec §13): boot snapshots → brain init → core
/// drives the seam. The dispatch below EXECUTES commands; every decision
/// (when to freeze, when to reveal, layout rects) arrives from core.
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly StoreService _store;
    private readonly SurfaceManager _surfaces;
    private readonly BrainHost _brain;
    private readonly PosterService _posters;
    /// <summary>§6 device-local remote API listener (started once core is up; core answers every request).</summary>
    private RemoteServer? _remote;
    /// <summary>§32 Layer 1: the loopback FFT visualizations render from (idle until one is active).</summary>
    private readonly WasapiLoopbackFft _fft;
    /// <summary>§6a: a prism:// route arrived (from the phone, a held remote key, or core) - the UI router (rail / editors) subscribes; the default handler logs it.</summary>
    public event Action<string, string, string?>? UiRouteRequested;
    private readonly List<HostCatalogEntry> _catalog = new();
    private Grid? _picker;
    private Grid? _arrange;
    private Grid? _controls;
    private bool _inited;
    private double _w, _h;

    public MainWindow()
    {
        InitializeComponent();
        InitDevShot();   InitFrameSampler();   InitBreakWatch();   InitAdDebugSoon();   // the break watch reads YouTube TV breaks off the picture (MainWindow.BreakWatch.cs); dev only: YouTube TV frames for the logo watch (MainWindow.FrameSampler.cs)   // PRISM_DEV_SHOT=1 only: XAML captures on request (MainWindow.DevShot.cs)
        ShowInstalledNoteIfAny();   // the first-run note: where Prism now lives, and that the downloaded folder can go (2026-10-06)
        InitReportFlag();   // the report flag in the top-right corner, on both players (docs/features/report-flag.md, 2026-10-06)
        InitBootCover();   // the Video player last on: a dark cover until Watch is drawn - never a service's home page (2026-09-24)
        InitPlaybackDoctor();   // says so on the wall when core reopens a failed video (MainWindow.PlaybackDoctor.cs)
        // the Prism mark (2026-09-09): on the grip at the top, and as the window's icon for the taskbar and Alt+Tab
        try
        {
            var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "prism-icon.png");
            if (File.Exists(icon)) GripIcon.Source = new BitmapImage(new Uri(icon));
            var ico = Path.Combine(AppContext.BaseDirectory, "Assets", "prism.ico");
            if (File.Exists(ico)) AppWindow.SetIcon(ico);
        }
        catch { /* a missing mark is a plain grip, never a failed start */ }
        Title = HostPaths.IsOverridden ? "Prism — fresh run (" + HostPaths.DataDir + ")" : "Prism — M1";

        _store = new StoreService(HostPaths.DataDir, saveDelayMs: 4_000);   // saves coalesced off the UI thread (2026-09-28: a burst of lookups froze the window); four seconds since 2026-10-03 (perf.log: the whole store written 20 times a minute)
        // ... and written before a crash takes them (2026-09-28 review: the fail-fast the host has died of never runs ProcessExit)
        Application.Current.UnhandledException += (_, __) => { try { _store.Flush(); } catch { } };   // PRISM_DATA_DIR moves the whole host (store, profiles, prefs, log) for a from-scratch run
        if (HostPaths.LastStartNote is { } startNote) { LogLine("start: " + startNote); SetPill("Prism · " + startNote); }
        _surfaces = new SurfaceManager(TileCanvas, _store, new ArtService(_store),
            // the event is redacted before the cut too: a cut could strand part of a secret past the redactor's shapes (2026-09-30 review)
            forwardEvent: (_, eventJson) => { PerfNoteEvent(eventJson); LogRaw("-> " + PrismHost.Diagnostics.LogCompact.Event(PrismHost.Diagnostics.Redact.Line(eventJson))); NoteAmbientEvent(eventJson); NoteNavigated(eventJson); _brain?.Call(HostCalls.Event, eventJson); NoteSessionEvent(eventJson); },
            onStatus: SetStatus);
        _surfaces.EmeResult += OnEmeResult;
        _surfaces.SetWallVolume(HostPrefs.GetDouble("wallVolume", 1.0));   // B-176: the wall's volume, remembered on this machine
        _fft = new WasapiLoopbackFft(LogLine);
        _surfaces.AudioSource = _fft;
        _surfaces.AudioTarget = r => _fft.SetTargetResolver(r);   // B-152: the stage's source, not the machine
        _surfaces.CoverageChanged += () => RootGrid.DispatcherQueue.TryEnqueue(() => { if (_controls is not null) { ToggleControls(); ToggleControls(); } });
        _surfaces.FullscreenRequested += tid => RootGrid.DispatcherQueue.TryEnqueue(() => ToggleScreenFullscreen(tid));
        _surfaces.HostKey += key => RootGrid.DispatcherQueue.TryEnqueue(() => OnHostKey(key));
        _surfaces.PageInteraction += tid => RootGrid.DispatcherQueue.TryEnqueue(() => { var t = ShowStageBarAsync(); });   // a tap on the video wall shows the stage bar
        // the Video player's break card (2026-09-23): Watch opens the Watch page over the break; from Watch's corner it returns to the video
        _surfaces.BreakWatchFor = _ => WatchGrip.Visibility == Visibility.Visible;
        // the wall shot's stand-in for a protected frame: the title's own picture, as its service shows it (core names it; an https image only)
        _surfaces.TitleArtFor = async tid =>
        {
            try
            {
                var j = System.Text.Json.Nodes.JsonNode.Parse(await ModelCallAsync("videoArtOf", tid) ?? "null") as System.Text.Json.Nodes.JsonObject;
                var url = j?["art"]?.GetValue<string>();
                if (url is null || !url.StartsWith("https://", StringComparison.Ordinal)) return null;
                return await Http.GetByteArrayAsync(url);
            }
            catch { return null; }
        };
        _surfaces.BreakWatchPressed += tid => RootGrid.DispatcherQueue.TryEnqueue(async () => { if (VideoHubOpen) CloseVideoHub(); else { HideStageBar(); await ShowVideoHubAsync(); } });
        _surfaces.ShieldPressed += tid => RootGrid.DispatcherQueue.TryEnqueue(async () => { if (await MvShieldPressedAsync(tid)) return; if (VideoHubOpen) CloseVideoHub(); else { var t = ShowStageBarAsync(); } });   // multiview: a press on a small window brings it to the big place   // a press on the stage: the bar; on the corner: back to the stage
        // a tap lifts the curtain - but not the second half of the double-click that raised it (2026-10-06, "I double clicked big door prize, and it
        // originally shows the apple page for the show": the curtain went up and came down 21 ms later on that second press)
        StageCurtain.PointerPressed += (_, __) => { if ((DateTime.UtcNow - _curtainUpAt).TotalMilliseconds > 700) HideStageCurtain(); };                                                          // a tap lifts the curtain                      // Esc/F8/F10/F11 from a focused page
        _surfaces.SlotContextMenu += (tid, pt) => RootGrid.DispatcherQueue.TryEnqueue(() => ShowSlotContextMenu(tid, pt));
        WireTiles();                                                                                                 // §6 micro-facets: the tiles.prism pages read/edit through core
        // concept-scenes §5: a single tap where the placement claimed it - core resolves the verb (tapItem), never the host
        _surfaces.ItemTapped += tid => RootGrid.DispatcherQueue.TryEnqueue(() => { _brain.Call(HostCalls.TapItem, tid); _ = ShowStageBarAsync(); });   // the stage bar rides a tap on the video wall
        _surfaces.PanStarted += OnPanStarted;                                                                        // Pan tool: raised on the UI thread
        _surfaces.PanMoved += OnPanMoved;
        _surfaces.PanEnded += OnPanEnded;
        _surfaces.PanWheel += OnPanWheel;
        _surfaces.SourceChanged += (tid, url) => RootGrid.DispatcherQueue.TryEnqueue(() => SyncViewfinderAddress(tid, url));   // the configure dock's address follows the page
        // §30: the shell asks core before honoring any popup; core's decision (functional sign-in, same-site, your allow-list) is the only one
        _surfaces.PopupDecider = (pageUrl, popupUrl, userInitiated) =>
            _brain.EvalAsync("PrismRuntime.popupDecision(" + JsonSerializer.Serialize(pageUrl) + "," + JsonSerializer.Serialize(popupUrl) + "," + (userInitiated ? "true" : "false") + ")");
        // §32 floating facets: the shell reports a drag/resize end and each chrome tap; core decides and persists
        _surfaces.FloatChanged += (tid, x, y, w, h) =>
        {
            var (cw, ch) = _surfaces.CanvasSize;
            if (cw < 1 || ch < 1) return;
            _brain.Call(HostCalls.UpdateTile, tid, JsonSerializer.Serialize(new { @float = new { x = x / cw, y = y / ch, w = w / cw, h = h / ch } }));
        };
        _surfaces.DrmFailed += tid => DispatcherQueue.TryEnqueue(() => _ = OnDrmFailedAsync(tid));   // 2026-09-24: repaired at the first sign
        _surfaces.TileCommand += (tid, cmd) =>
        {
            switch (cmd)
            {
                case "face:page": _brain.Call(HostCalls.UpdateTile, tid, "{\"float\":{\"face\":\"page\"}}"); break;
                case "face:control": _brain.Call(HostCalls.UpdateTile, tid, "{\"float\":{\"face\":\"control\"}}"); break;
                case "mv:remove": _ = MvRemoveWindowAsync(tid); break;   // multiview's X (2026-09-24)
                case "dock":
                    // a multiview window is never docked into the wall - that took it away (2026-09-28: window 2 went three times while titles were
                    // dropped onto it); its X removes it
                    if (IsMultiviewWindow(tid)) { LogLine("dock ignored for multiview window " + tid); break; }
                    _brain.Call(HostCalls.UpdateTile, tid, "{\"kind\":null}"); break;
                case "hide": _brain.Call(HostCalls.UpdateTile, tid, "{\"float\":{\"hidden\":true}}"); SetPill("Prism · " + tid + " is hidden. Prism menu → Floating facets brings it back"); break;
                default: if (!MvAllCommand(cmd)) _brain.Call(HostCalls.TileCommand, tid, cmd); break;   // play | pause | next | prev | mute | unmute - the §6 path; Shift on a multiview window's play: all of them
            }
        };
        RestoreWindowBounds();                            // furniture remembers where it stood
        _brain = new BrainHost(TileCanvas, _store, OnCommand, SetStatus);
        StartGpuWatch();   // a graphics driver reset: playing video pages load again (2026-09-28)
        StartPerfWatch();  // the wall's cost once a minute to diagnostics/perf.log (2026-10-03)
        StartStallWatch();   // host.log names every moment the window stopped taking clicks (2026-09-28)
        // every press the window gets, and what it landed on - even one a control handled (2026-09-28, "its not frozen but it wont accept any clicks,
        // I see no reason for it": no press was logged at all, so where they went could not be told); a press on a web page never reaches here
        RootGrid.AddHandler(UIElement.PointerPressedEvent, new Microsoft.UI.Xaml.Input.PointerEventHandler((_, e) =>
        {
            try { var pt = e.GetCurrentPoint(RootGrid).Position; LogLine("press at " + (int)pt.X + "," + (int)pt.Y + " on " + (e.OriginalSource?.GetType().Name ?? "?") + ((e.OriginalSource as FrameworkElement)?.Name is { Length: > 0 } nm ? " " + nm : "")); } catch { }
        }), true);
        _brain.OnCall = (fn, json) => { if (fn != "event" && fn != "resolve") LogLine("call " + json); };   // every host→core call in host.log (file only; events are the "->" lines, resolve is the art request lane)
        _brain.OnReady += TryInit;
        _posters = new PosterService(_store, _brain);
        LoadCatalog();

        // Snapshot pass on close, so restart lands on real pixels (§18/§8).
        var closing = false;
        Closed += async (_, e) =>
        {
            if (closing) return;
            closing = true;
            e.Handled = true;
            LogLine("window: Closed fired");
            SaveWindowBounds();
            try { _store.Flush(); } catch { }   // saves are coalesced: what is pending goes to disk before anything else can go wrong
            try { await _surfaces.FreezeAllAsync(); } catch { }
            // 2026-09-08: the wall died twice as a stowed exception (0xc000027b) because a now-playing timer ticked into the
            // tree while the window tore down; every timer that draws stops first, and the close itself is enqueued rather
            // than called from inside the handled Closed (a Close() from inside was ignored and the wall lived on headless)
            try { _surfaces.StopTimers(); _stallWatch?.Stop(); _breakWatch?.Stop(); SaveBreakWatches(); } catch { }
            try { _remote?.Dispose(); _fft.Dispose(); _surfaces.SessionMute.Dispose(); } catch { }
            DispatcherQueue.TryEnqueue(Close);
        };

        RootGrid.Loaded += async (_, __) =>
        {
            _surfaces.ShowBootSnapshots();                    // last dashboard in real pixels (§8/§16)
            WireMenuGrip();                                   // top-center app menu (F10) + F11 wall full screen
            var probe = new KeyboardAccelerator { Key = VirtualKey.F9, Modifiers = VirtualKeyModifiers.Control };
            probe.Invoked += async (_, e) => { e.Handled = true; await ProbeAllAsync(); };
            RootGrid.KeyboardAccelerators.Add(probe);
            var picker = new KeyboardAccelerator { Key = VirtualKey.N, Modifiers = VirtualKeyModifiers.Control };
            picker.Invoked += (_, e) => { e.Handled = true; TogglePicker(); };
            RootGrid.KeyboardAccelerators.Add(picker);
            var esc = new KeyboardAccelerator { Key = VirtualKey.Escape };
            esc.Invoked += (_, e) => { if (EscapePressed()) e.Handled = true; };   // same chain as Esc arriving from a page
            // the stage keys at the host's own level (2026-09-21): with a title on the stage and no page or control holding focus,
            // Space / the arrows / Enter drive the stage as they do from the page's prelude (the Watch page handles its own)
            RootGrid.PreviewKeyDown += (_, e) =>
            {
                if (WatchGrip.Visibility != Visibility.Visible || VideoHubOpen || _asSession) return;
                var focused = FocusManager.GetFocusedElement(RootGrid.XamlRoot);
                if (focused is Control && focused is not Microsoft.UI.Xaml.Controls.WebView2) return;   // a control of Prism's own has the key
                var key = e.Key switch { VirtualKey.Space => "Space", VirtualKey.Left => "ArrowLeft", VirtualKey.Right => "ArrowRight", VirtualKey.Up => "ArrowUp", VirtualKey.Down => "ArrowDown", VirtualKey.Enter => "Enter", _ => null };
                if (key is null) return;
                e.Handled = true;
                OnHostKey(key);
            };
            var arrange = new KeyboardAccelerator { Key = VirtualKey.A, Modifiers = VirtualKeyModifiers.Control };
            arrange.Invoked += (_, e) => { e.Handled = true; ToggleArrange(); };
            RootGrid.KeyboardAccelerators.Add(arrange);
            // the status pill no longer opens the veil Control Center (2026-09-24, "some useless menu stuck on the screen with Prism - veils and a lot
            // of services listed"): a press on the status line had opened it; it stays in the Prism menu (Veils, Control Center...)
            // Ctrl+1..9: maximize that slot to the window / restore (doc order)
            for (var digit = 1; digit <= 9; digit++)
            {
                var n = digit;
                var acc = new KeyboardAccelerator { Key = (VirtualKey)((int)VirtualKey.Number0 + n), Modifiers = VirtualKeyModifiers.Control };
                acc.Invoked += (_, e) => { e.Handled = true; ToggleTileFullscreen(n - 1); };
                RootGrid.KeyboardAccelerators.Add(acc);
            }
            var shot = new KeyboardAccelerator { Key = VirtualKey.S, Modifiers = VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift };
            shot.Invoked += async (_, e2) => { e2.Handled = true; await CaptureWallShotAsync(); };
            RootGrid.KeyboardAccelerators.Add(shot);
            RootGrid.KeyboardAccelerators.Add(esc);
            try { await _brain.StartAsync(); }
            catch (Exception ex) { SetStatus("brain start failed: " + ex.Message); }
        };
    }

    private void TileCanvas_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        _w = e.NewSize.Width;
        _h = e.NewSize.Height;
        if (_inited) _brain.Call(HostCalls.Resize, _w, _h);
        else TryInit();
        RelayoutAppWindowBar();   // B-196: the inline app window's bar follows the new size
    }

    /// <summary>A new device's wall: nothing on it (2026-09-29; it was a demo of two services, up under the welcome page). The players the
    /// welcome page makes take the wall over.</summary>
    private static string FirstRunDocJson() =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Assets", "first-run-dashboard.json"));

    private void TryInit()
    {
        if (_inited || !_brain.Ready || _w <= 0 || _h <= 0) return;
        _inited = true;
        var stored = _store.Get("dashboard");
        var doc = stored ?? FirstRunDocJson();
        SetStatus($"boot doc: {(stored is null ? "EMPTY (a new device: the store had no dashboard)" : "store")} · {_store.StorePath} · exists={File.Exists(_store.StorePath)}");
        var options = InitOptionsJson();
        _brain.Call(HostCalls.Init, doc, _w, _h, options);
        SetStatus($"core init ({_w:0}x{_h:0})");
        StartRemote();
        // §28: core's first check runs soon after boot; a release ready (or staged) is said once on the status line (2026-10-05)
        _ = Task.Delay(TimeSpan.FromSeconds(75)).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(async () => { await PollUpdateStatusAsync(); RefreshUpdateNotice(); }));
        // win-host-spec §5 launched Edge windows: warn when a hand-off would run without the veil extension (B-24: no hand-off exists yet → reported only)
        var handoff = HandoffCheck.Verify(_store.Root);
        LogLine("handoff check: " + handoff);
        if (HandoffCheck.Warning(handoff) is { } warn) SetStatus(warn);
        try
        {
            using var o = JsonDocument.Parse(options);
            var armed = _armedAdapters;
            armed.Clear();
            foreach (var a in o.RootElement.GetProperty("adapters").EnumerateObject())
                if (a.Value.TryGetProperty("js", out _)) armed.Add(a.Name);
            // §30 asks for QUIET proof the engine is armed. Naming eight adapters
            // across the bottom of a wall is not quiet; a count is, and the list
            // is one hover away.
            // 2026-09-08: the count is the log's, not the wall's ("Prism veil armed (8) in the bottom right, I don't see the need")
            LogLine(armed.Count > 0 ? $"veil armed ({armed.Count}): {string.Join(", ", armed)}" : "no detection adapters loaded");
        }
        catch { SetPill("Prism"); }
        // scene-model-spec §7: the one-shot first-boot migration (MainWindow.Migration.cs) - runs only while the
        // store has a `dashboard` and no `scene-model:migration` marker; writes new scene-model:* keys only
        _ = RunFirstBootMigrationAsync();
    }

    /// <summary>§6: the remote API listener. Bytes only - core routes and authenticates (pairing tokens); the
    /// boot-time mint is onlyIfUnpaired so a frame with phones paired never mints a token per boot.</summary>
    private void StartRemote()
    {
        if (_remote is not null) return;
        try
        {
            _remote = new RemoteServer(8471, (id, json) => RootGrid.DispatcherQueue.TryEnqueue(() => _brain.Call(HostCalls.Http, id, json)), LogLine);
            // the routes the host answers itself take a paired phone's token only (2026-10-05 review): core's own record of the pairings, read at each ask
            _remote.TokenOk = t =>
            {
                try
                {
                    var raw = _store.Get("remote:tokens");
                    if (raw is null || System.Text.Json.Nodes.JsonNode.Parse(raw) is not System.Text.Json.Nodes.JsonArray list) return false;
                    foreach (var d in list) if (d is System.Text.Json.Nodes.JsonObject o && o["token"]?.GetValue<string>() == t) return true;
                }
                catch { }
                return false;
            };
            // private listening (Services/ListenStream.cs, 2026-10-03): the ticket redeemed with core, the shared browser's sound, the wall quiet
            _remote.Listen = new Services.ListenStream(
                redeem: t =>
                {
                    // the server answers on its own thread; the brain is asked on the UI thread
                    var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                    RootGrid.DispatcherQueue.TryEnqueue(async () => { try { var r = await ModelCallAsync(HostCalls.RedeemStreamTicket, t); tcs.TrySetResult(r is null || r == "null" ? "" : r.Trim('"')); } catch (Exception ex) { LogLine("listen: redeem " + ex.Message); tcs.TrySetResult(""); } });
                    return tcs.Task;
                },
                browserPid: () => _surfaces.AnyBrowserPid(),
                listeners: OnListeners, log: LogLine);
            // each phone's own window (2026-10-06): the windows phones listen to are tapped in their pages, their samples to the stream
            _remote.Listen.TapsWanted += want => RootGrid.DispatcherQueue.TryEnqueue(() => _surfaces.SetTaps(want));
            _surfaces.TapFrames += (id, pcm) => _remote?.Listen?.OnTap(id, pcm);
            var tapLook = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
            tapLook.Tick += (_, __) => { if ((_remote?.Listen?.Count ?? 0) > 0) _surfaces.RefreshTaps(); };
            tapLook.Start();
            LogLine("remote API listening at " + _remote.BaseUrl());
            _brain.Call(HostCalls.MintPairing, _remote.BaseUrl(), true);
        }
        catch (System.Net.Sockets.SocketException ex) when (ex.SocketErrorCode == System.Net.Sockets.SocketError.AddressAlreadyInUse && _remoteRetries < 30)
        {
            // the port still held by the process before this one (a phone's stream outliving it, 2026-10-05: the phone had no PC until the next
            // restart): tried again every second for half a minute, then given up with the message
            _remoteRetries++;
            if (_remoteRetries == 1) LogLine("remote API: port 8471 still in use, waiting for it");
            var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            t.Tick += (_, __) => { t.Stop(); StartRemote(); };
            t.Start();
        }
        catch (Exception ex) { SetStatus("remote API not started: " + ex.Message); }
    }
    private int _remoteRetries;

    /// <summary>
    /// concept-scenes §5: core resolved a single tap - on the wall or from the
    /// phone (§6 parity). The host reports what happened and changes nothing:
    /// the audio move and any promotion already ran through core's own seams.
    /// </summary>
    private void OnTapResult(string id, string action, string did, string? audio, string? error)
    {
        LogLine($"tap {id} → {action}/{did}{(audio is null ? "" : " audio=" + audio)}{(error is null ? "" : " error=" + error)}");
        var name = _model.ActiveScene is { } sid && _model.Scene(sid) is { } sc && sc.Assign.TryGetValue(id, out var fid) && _model.Facet(fid) is { } f
            ? (_model.App(f.App)?.Name ?? f.Label) : id;
        SetPill(did switch
        {
            "audio" => "Prism · sound: " + name,
            "audio+promote" => "Prism · sound: " + name + " · full page",
            "promote" => "Prism · " + name + " · full page",
            _ when audio == "already-owner" => "Prism · sound is already on " + name,
            _ when audio == "peeking" => "Prism · " + name + " is refreshing its still - tap again in a moment",
            _ when error == "unavailable" => "Prism · " + name + " cannot be opened full page",
            _ => "Prism · " + name,
        });
    }

    /// <summary>§6a a route arrived: the UI router handles it; until one subscribes the pill names it (so a phone tap is never silent).</summary>
    private void OnUiRoute(string route, string source, string? id)
    {
        LogLine($"ui.route {route} ({source}{(id is null ? "" : " " + id)})");
        if (UiRouteRequested is { } h) h(route, source, id);
        else SetPill("Prism · " + route.Replace("prism://", "") + " (" + source + ")");
    }

    /// <summary>For the host's own UI (rail, editors, sheets): report a route it opened so the flight recorder shows one shape for every deep link.</summary>
    public void ReportUiRoute(string route, string source) => _brain.Call(HostCalls.UiRoute, route, source);

    // ------------------------------------------------------------- channel
    private void OnCommand(string json)
    {
        RootGrid.DispatcherQueue.TryEnqueue(() =>
        {
            var msg = ChannelParser.Parse(json);
            if (msg is null) { SetStatus("channel: unparseable message"); return; }
            LogOp(msg);
            switch (ChannelParser.Route(msg))
            {
                case CommandRoute.Execute:
                    Execute(msg);
                    break;
                case CommandRoute.StubIgnore:
                    SetStatus($"stub op {msg.Op} (post-M1)");
                    break;
                case CommandRoute.StubResolveUnsupported:
                    _brain.Call(HostCalls.Resolve, msg.RequestId!.Value, null, "unsupported: not implemented in M1");
                    SetStatus($"stub request {msg.Op} → unsupported");
                    break;
                case CommandRoute.Unknown:
                    SetStatus($"CHANNEL DRIFT: unknown op {msg.Op} — regenerate Channel.g.cs");
                    break;
            }
        });
    }

    private void Execute(CommandMessage m)
    {
        var id = m.GetString("id") ?? "";
        switch (m.Op)
        {
            // Per-surface ordering is normative (drivers.ts): navigate must not
            // outrun create's async WebView2 init — every op for a surface
            // chains onto that surface's previous op.
            case Ops.SurfaceCreate: Chain(id, () => _surfaces.CreateAsync(m)); break;
            case Ops.SurfaceDestroy: Chain(id, () => { _surfaces.Destroy(id); return Task.CompletedTask; }); break;
            case Ops.ProfileMigrate: Chain("profiles", () => ProfileMigrateAsync(m)); break;
            case Ops.SurfaceTypeText: Chain(id, () => _surfaces.TypeTextAsync(id, m.GetString("text") ?? "")); break;   // the phone keyboard (2026-10-03)
            case Ops.SurfaceSendKey: Chain(id, () => _surfaces.SendKeyAsync(id, m.GetString("key") ?? "")); break;   // one browser, many sign-ins (MainWindow.ProfileMove, 2026-10-03)
            case Ops.SurfaceNavigate: Chain(id, () => { _surfaces.Navigate(id, m.GetString("url") ?? "about:blank"); return Task.CompletedTask; }); break;
            case Ops.SurfaceInject: Chain(id, () => _surfaces.InjectAsync(id, m.GetString("css"), m.GetString("js"))); break;
            case Ops.SurfaceFreeze: Chain(id, () => _surfaces.FreezeAsync(id)); break;
            case Ops.SurfaceReveal:
                Chain(id, () => { _surfaces.Reveal(id, m.GetNumber("durationMs", 220)); return Task.CompletedTask; });
                ScheduleEmeProbe(id);
                break;
            case Ops.SurfaceSuspend: Chain(id, () => { _surfaces.Suspend(id); return Task.CompletedTask; }); break;
            case Ops.SurfaceResume: Chain(id, () => _surfaces.ResumeAsync(id)); break;
            // §25 living previews: core brackets one peek; the host holds the still across it (§16) and never runs two.
            case Ops.SurfaceSetPeek: Chain(id, () => { _surfaces.SetPeek(id, m.GetBool("peeking")); return Task.CompletedTask; }); break;
            case Ops.SurfaceSetMuted: Chain(id, () => { _surfaces.SetMuted(id, m.GetBool("muted")); return Task.CompletedTask; }); break;
            case Ops.SurfaceHover: Chain(id, () => _surfaces.HoverAsync(id, m.GetNumber("x", 0), m.GetNumber("y", 0))); break;
            case Ops.SurfaceScrub: Chain(id, () => _surfaces.ScrubAsync(id, m.GetNumber("x", 0), m.GetNumber("y", 0), m.GetBool("press", true))); break;   // the slider's seek on a service's own scrubber
            case Ops.SurfaceSetViewport: Chain(id, () => _surfaces.SetViewportAsync(id, m.GetNumber("w", 0), m.GetNumber("h", 0))); break;   // awaited: core's framing inject follows it
            case Ops.SurfaceSetNowPlaying: Chain(id, () => { _surfaces.SetNowPlaying(id, m.GetString("json") ?? "null"); return Task.CompletedTask; }); break;   // §32 the player control's state
            case Ops.SurfaceSetChrome: Chain(id, () => { _surfaces.SetChrome(id, m.GetString("kind") ?? "slot", m.GetString("face") ?? "page", m.GetBool("hidden")); return Task.CompletedTask; }); break;   // §32 floating chrome
            case Ops.SurfaceSetRect: if (m.GetRect("rect") is { } r) Chain(id, () => { _surfaces.SetRect(id, r); return Task.CompletedTask; }); break;
            case Ops.SurfaceSetOpacity: Chain(id, () => { _surfaces.SetOpacity(id, m.GetNumber("opacity", 1)); return Task.CompletedTask; }); break;
            case Ops.SurfaceShowIntermission: Chain(id, () => { _surfaces.ShowIntermission(id, m.GetString("source") ?? "", m.GetString("look")); return Task.CompletedTask; }); LogLine("intermission: " + id); break;   // the cover itself says so on the window; the status line never shows a tile's internal name (2026-09-29)
            case Ops.SurfaceHideIntermission: Chain(id, () => { _surfaces.HideIntermission(id); return Task.CompletedTask; }); break;
            case Ops.SurfaceSetIntermissionSkip: Chain(id, () => { _surfaces.SetIntermissionSkip(id, m.GetBool("available"), m.GetString("target")); return Task.CompletedTask; }); break;
            case Ops.SurfaceSetAdInfo: Chain(id, () => { _surfaces.SetAdInfo(id, m.GetString("count") ?? "", m.GetNumber("remaining", -1)); return Task.CompletedTask; }); break;
            case Ops.SurfaceSetZ: Chain(id, () => { _surfaces.SetZ(id, m.GetNumber("z")); return Task.CompletedTask; }); break;
            // §32 visualization surfaces + reveal/collapse presence (SM-4)
            case Ops.SurfaceCreateVisualization:
                // the visual follows the music (B-136/B-138): core recreates a stage for its new source; the chrome sync that
                // rebuilds transport, block and Quick play for it ran only after an apply, a route or a resize - run it now,
                // and again once the rect has landed
                Chain(id, () => { _surfaces.CreateVisualization(m); return Task.CompletedTask; });
                _ = SyncVisualizationsAsync();
                _ = Task.Delay(600).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = SyncVisualizationsAsync()));
                break;
            case Ops.SurfaceSetVisualizationFeed: Chain(id, () => { _surfaces.SetVisualizationFeed(id, m.GetString("json") ?? "null"); return Task.CompletedTask; }); break;
            case Ops.SurfaceSetPresence: if (m.GetRect("rect") is { } pr) Chain(id, () => { _surfaces.SetPresence(id, m.GetString("presence") ?? "hidden", pr, m.GetNumber("durationMs", 220)); return Task.CompletedTask; }); break;
            // §6a deep links + §6 remote lane
            case Ops.UiRoute: OnUiRoute(m.GetString("route") ?? "", m.GetString("source") ?? "core", m.GetString("id")); break;
            case Ops.UiTapResult: OnTapResult(id, m.GetString("action") ?? "promote", m.GetString("did") ?? "none", m.GetString("audio"), m.GetString("error")); break;
            // a pick from the phone (2026-10-05): the Watch screen out of the way and the curtain up, as a card pressed here does
            case Ops.UiPrivateMute: _surfaces.PrivateDeviceMute(m.GetBool("on")); break;   // the phone's "mute Prism on the PC while this phone listens" (2026-10-05)
            case Ops.UiListenRoutes: _remote?.Listen?.SetRoutes(m.GetString("json") ?? "{}"); break;   // each phone's window (2026-10-06)
            case Ops.UiBreakWatch: HostPrefs.Set("video.breakWatch", m.GetBool("on")); LogLine("break watch: " + (m.GetBool("on") ? "on" : "off") + " (the phone)"); break;   // the phone's switch (2026-10-07)
            case Ops.UiVideoPick: { var vt = m.GetString("title") ?? ""; var vs = m.GetString("service") ?? ""; LogLine("video pick from the phone: " + vt + " on " + vs); if (PickLeavesWatch(vt)) { CloseVideoHub(); ShowStageCurtain(vt, vs, m.GetString("poster")); } break; }
            case Ops.HttpResponse: _remote?.OnResponse((int)m.GetNumber("requestId"), (int)m.GetNumber("status", 500), m.GetString("body") ?? "", m.GetString("contentType") ?? "application/json"); break;
            case Ops.RemotePairing: LogLine("pairing url minted (token withheld from status)"); OnPairingMinted(m.GetString("url") ?? ""); break;   // the QR card when the menu asked (MainWindow.PairPhone)
            case Ops.RemotePaired: SetPill("Prism · phone paired"); ClosePairCard(); break;
            case Ops.RemotePairedCount: SetStatus($"remote: {m.GetNumber("n"):0} phone(s) paired"); break;
            case Ops.StoreSet:
                var storedKey = m.GetString("key") ?? "";
                var storedValue = m.GetString("value") ?? "";
                _store.Set(storedKey, storedValue);
                PerfNoteSet(storedKey, storedValue.Length);   // perf.log: which keys are set most, and how big (2026-10-03)
                OnTilesKeyStored(storedKey);   // §6 micro-facets: a phone's edit reaches the wall page too
                break;
            case Ops.NetFetchStatic: _ = FetchStaticAsync(m); break;
            case Ops.NetFetchKeyed: _ = FetchKeyedAsync(m); break;
            // §28 updates (Services/Updates.cs, 2026-10-05): the signed manifest at the configured address; a release downloaded, verified and staged
            case Ops.UpdateFetchManifest: _ = UpdateFetchAsync(m); break;
            case Ops.UpdateApply: _ = UpdateApplyAsync(m); break;
            case Ops.SurfaceVeilImagery: AnswerVeilImagery(m); break;
            case Ops.SurfaceEvaluate: _ = AnswerEvaluateAsync(m); break;   // a small read of a page, answered (the playback doctor, 2026-09-23)
            case Ops.RuntimeError: SetStatus("core error: " + (m.GetString("message") ?? "?")); break;
            default: SetStatus($"M1 op {m.Op} not wired"); break;
        }
    }

    private readonly Dictionary<string, Task> _perSurface = new();

    /// <summary>Queue an op onto its surface's chain (ordered per surface, §23 drivers contract).</summary>
    private void Chain(string id, Func<Task> op)
    {
        var prev = _perSurface.TryGetValue(id, out var t) ? t : Task.CompletedTask;
        _perSurface[id] = Run(prev, op);
    }

    private async Task Run(Task prev, Func<Task> op)
    {
        try { await prev; } catch { /* already reported */ }
        try { await op(); }
        catch (Exception ex) { SetStatus("seam op failed: " + ex.Message); }
    }

    // §19/§22 + §28/§31: fetch EXACTLY the URL core hands us - https only, no
    // query string, no identifiers, no headers beyond the defaults. Serves
    // update manifests and poster resolution; core decides what to ask for.
    private static readonly HttpClient Http = MakeHttp();
    /// <summary>Wikimedia asks every client to name itself (a product name, no person in it); the default client sent nothing.</summary>
    private static HttpClient MakeHttp()
    {
        var h = new HttpClient();
        try { h.DefaultRequestHeaders.UserAgent.ParseAdd("Prism/0.1"); h.DefaultRequestHeaders.UserAgent.ParseAdd("(open-source dashboard; no identifiers)"); } catch { }
        return h;
    }

    /// <summary>§4a lenses: the person's OWN keyed call (their TMDB key) - the address and headers exactly as core built them; the
    /// headers are never logged, the answer goes back to core alone. https only.</summary>
    private async Task UpdateFetchAsync(CommandMessage m)
    {
        var rid = m.RequestId; if (rid is null) return;
        try { var text = await Services.Updates.FetchManifestAsync(m.GetString("url") ?? "", LogLine); _brain.Call(HostCalls.Resolve, rid.Value, JsonSerializer.Serialize(text), null); LogLine("updates: manifest read and verified"); }
        catch (Exception ex) { LogLine("updates: " + ex.Message); _brain.Call(HostCalls.Resolve, rid.Value, null, ex.Message); }
    }
    private async Task UpdateApplyAsync(CommandMessage m)
    {
        var rid = m.RequestId; if (rid is null) return;
        try
        {
            var release = m.Payload.TryGetProperty("release", out var r) && r.ValueKind == JsonValueKind.Object ? JsonNode.Parse(r.GetRawText()) as JsonObject : null;
            if (release is null) { _brain.Call(HostCalls.Resolve, rid.Value, null, "no release"); return; }
            // off the window's thread (2026-10-06, "When I check and run an install on the Updates screen, it freezes up the Updates modal window until the
            // download is complete"): the download, the hashing and the copies are the thread pool's; the status line is set back on the window's
            var result = await Task.Run(() => Services.Updates.ApplyAsync(release, LogLine, s => RootGrid.DispatcherQueue.TryEnqueue(() => SetPill("Prism · " + s))));
            _brain.Call(HostCalls.Resolve, rid.Value, JsonSerializer.Serialize(result), null);
            if (result == "staged") RefreshUpdateNotice();
        }
        catch (Exception ex) { LogLine("updates: apply " + ex.Message); _brain.Call(HostCalls.Resolve, rid.Value, JsonSerializer.Serialize("failed"), null); }
    }
    private async Task FetchKeyedAsync(CommandMessage m)
    {
        var rid = m.RequestId;
        if (rid is null) return;
        var url = m.GetString("url") ?? "";
        try
        {
            if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("fetchKeyed takes https addresses only");
            // a write under the person's key (a TMDB rating, 2026-10-03): the method and the JSON body core gave; GET otherwise
            var method = m.GetString("method") is { Length: > 0 } mm ? new HttpMethod(mm.ToUpperInvariant()) : HttpMethod.Get;
            using var req = new HttpRequestMessage(method, url);
            if (m.GetString("body") is { } bodyText && method != HttpMethod.Get) req.Content = new StringContent(bodyText, System.Text.Encoding.UTF8, "application/json");
            try
            {
                var headers = JsonNode.Parse(m.GetString("headers") ?? "{}") as JsonObject;
                if (headers is not null) foreach (var kv in headers) if (kv.Value is not null) req.Headers.TryAddWithoutValidation(kv.Key, kv.Value.GetValue<string>());
            }
            catch { }
            using var res = await Http.SendAsync(req);
            var text = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode) throw new InvalidOperationException("HTTP " + (int)res.StatusCode);
            _brain.Call(HostCalls.Resolve, rid.Value, JsonSerializer.Serialize(text), null);
        }
        catch (Exception ex)
        {
            LogLine("fetchKeyed failed: " + ex.GetType().Name + ": " + ex.Message);   // the status, never the key or the address
            _brain.Call(HostCalls.Resolve, rid.Value, null, "fetchKeyed: " + ex.Message);   // the message names the status, never the key
        }
    }

    private async Task FetchStaticAsync(CommandMessage m)
    {
        var rid = m.RequestId;
        if (rid is null) return;
        var url = m.GetString("url") ?? "";
        try
        {
            if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || url.Contains('?') || url.Contains('#'))
                throw new InvalidOperationException("fetchStatic takes unparameterized https URLs only (§19/§22)");
            var text = await Http.GetStringAsync(url);
            _brain.Call(HostCalls.Resolve, rid.Value, JsonSerializer.Serialize(text), null);
        }
        catch (Exception ex)
        {
            LogLine("fetchStatic failed: " + ex.GetType().Name + ": " + ex.Message + " (" + url + ")");   // the lens sources' refusals (a rate limit) were invisible (2026-09-22)
            _brain.Call(HostCalls.Resolve, rid.Value, null, "fetchStatic: " + ex.Message);
        }
    }

    // --------------------------------------------------------- diagnostics
    private readonly HashSet<string> _probed = new();

    /// <summary>EME robustness per tile for the M1 report (§12) — once, shortly
    /// after the tile's first reveal so the page is settled. Diagnostics only.</summary>
    private void ScheduleEmeProbe(string id)
    {
        if (!_probed.Add(id)) return;
        var timer = RootGrid.DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(12);
        timer.IsRepeating = false;
        timer.Tick += async (_, __) => { try { await _surfaces.ProbeEmeAsync(id); } catch { } };
        timer.Start();
    }

    private async Task ProbeAllAsync()
    {
        SetStatus("EME probe…");
        foreach (var id in _surfaces.LiveTileIds()) await _surfaces.ProbeEmeAsync(id);
    }

    private void OnEmeResult(string id, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var pr = doc.RootElement.GetProperty("playready").GetString();
            var wv = doc.RootElement.GetProperty("widevine").GetString();
            var line = $"{id}: PlayReady={Label(pr)} Widevine={wv}";
            SetStatus(line);
            var diag = Path.Combine(_store.Root, "diagnostics");
            Directory.CreateDirectory(diag);
            File.AppendAllText(Path.Combine(diag, "eme.log"), PrismHost.Diagnostics.Redact.Line($"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {line}") + "\n");   // B-91/22: redacted AT the write
        }
        catch { }
    }

    private static string Label(string? raw) => raw switch
    {
        "3000" => "HW_SECURE_ALL(3000)",
        "2000" => "SW_SECURE_DECODE(2000)",
        null or "" => "rejected",
        _ => raw,
    };

    /// <summary>Channel trace (diagnostics only): every op, no payload bodies.</summary>
    private void LogOp(CommandMessage m)
    {
        try { AppendHostLog($"<- {m.Op}{(m.RequestId is { } r ? $" #{r}" : "")} {m.GetString("id") ?? ""}{OpDetail(m)}"); }
        catch { }
    }

    private static readonly object _hostLogLock = new();
    private static int _hostLogWrites;
    private static string? _hostLogDirMade;
    /// <summary>
    /// The one write to host.log: redacted at the write (B-91/22, never scrubbed after), one writer at a time (events arrive off the UI
    /// thread), and the log rotated in place past 64 MB (2026-09-30: a thirteen-hour run left a two-gigabyte log, rotation having run only
    /// at the start). Event bodies are compacted before they get here (LogCompact).
    /// </summary>
    private void AppendHostLog(string text)
    {
        var diag = Path.Combine(_store.Root, "diagnostics");
        lock (_hostLogLock)
        {
            if (_hostLogDirMade != diag) { Directory.CreateDirectory(diag); _hostLogDirMade = diag; }
            if (++_hostLogWrites % 500 == 0) HostPaths.RotateHostLog();
            File.AppendAllText(Path.Combine(diag, "host.log"), PrismHost.Diagnostics.Redact.Line($"{DateTime.Now:HH:mm:ss.fff} {text}") + "\n");
        }
    }

    /// <summary>The fields worth a flight-recorder glance per op (every op is logged; these add the one value that explains it).</summary>
    private static string OpDetail(CommandMessage m) => m.Op switch
    {
        Ops.SurfaceSetMuted => " muted=" + m.GetBool("muted"),
        Ops.SurfaceCreate => (m.GetString("kind") is { } k ? " kind=" + k : "") + (m.GetBool("placeholder") ? " placeholder" : ""),
        Ops.SurfaceCreateVisualization => $" style={m.GetString("style")} source={m.GetString("source")} artwork={m.GetString("artwork")}" + (m.GetBool("spill") ? " spill" : ""),
        Ops.SurfaceSetPresence => $" presence={m.GetString("presence")}",
        Ops.SurfaceSetChrome => $" {m.GetString("kind")}/{m.GetString("face")}{(m.GetBool("hidden") ? " hidden" : "")}",
        Ops.SurfaceSetZ => $" z={m.GetNumber("z"):0}",
        // 2026-09-16: a one-shot script that drives one of Prism's own page hooks (__prismMusicPlay / __prismMusicCmd / a resume press)
        // names itself - the boot-time "who unmuted Apple" question could not be answered from bare inject lines
        Ops.SurfaceInject => m.GetString("js") is { } js && js.Contains("__prism") && js.Length < 400 ? " " + js.Replace("\n", " ").Substring(0, Math.Min(90, js.Length)) : "",
        Ops.UiRoute => $" {m.GetString("route")} ({m.GetString("source")})",
        Ops.HttpResponse => $" #{m.GetNumber("requestId"):0} {m.GetNumber("status"):0}",
        _ => "",
    };

    // ------------------------------------------------ §31 picker (host)
    private sealed record HostCatalogEntry(string Id, string Name, string Adapter, string Url, string Badge, string Json);

    /// <summary>Adapters and catalog entries: the ones Prism ships and the ones added on this device (the data folder's adapters/ and
    /// catalog/). Read at the start; a newer added adapter stands over a shipped one (PrismHost.Core.AdapterFiles).</summary>
    internal static readonly PrismHost.Core.AdapterFiles Sources = new(Path.Combine(AppContext.BaseDirectory, "Assets"), HostPaths.DataDir);

    private void LoadCatalog()
    {
        try
        {
            // the shipped catalog and the entries added on this device (AdapterFiles: the data folder's catalog/)
            foreach (var note in Sources.Notes) LogLine("adapters: " + note);
            foreach (var entry in Sources.Catalog.Values.OrderBy(e => e.Name, StringComparer.OrdinalIgnoreCase))
            {
                var json = File.ReadAllText(entry.Path);
                using var doc = JsonDocument.Parse(json);
                var r = doc.RootElement;
                string Str(string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
                var tier = r.TryGetProperty("drm", out var d) && d.TryGetProperty("windows-host", out var t) ? t.GetString() : null;
                var badge = tier switch { "hardware" => "4K embedded", "software" => "1080p embedded", "none" => "no DRM", _ => "" };
                _catalog.Add(new HostCatalogEntry(Str("id"), Str("name"), Str("adapter"), Str("url"), badge, json));
            }
        }
        catch (Exception ex) { SetStatus("catalog load failed: " + ex.Message); }
    }

    /// <summary>Ctrl+N / menu: add a catalog tile to the wall.</summary>
    private void TogglePicker()
    {
        if (_picker is not null) { ClosePicker(); return; }
        ShowCatalog("Add a tile - catalog picks go through core's pickerTile. Esc closes.", AddPick);
    }

    private void ClosePicker()
    {
        if (_picker is null) return;
        RootGrid.Children.Remove(_picker);
        _picker = null;
    }

    /// <summary>The catalog poster grid (§31 step 1) with a caller-chosen action:
    /// add a tile (Ctrl+N) or make an existing slot this pick (Configure slot).</summary>
    private void ShowCatalog(string hint, Action<HostCatalogEntry> onPick, int zIndex = 0)
    {
        ClosePicker();
        var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xEE, 0x0F, 0x12, 0x16)) };
        if (zIndex > 0) Canvas.SetZIndex(overlay, zIndex);
        var column = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Spacing = 16 };
        column.Children.Add(new TextBlock
        {
            Text = hint,
            Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xC0, 0xC8, 0xD2)),
            FontSize = 13,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
        Button? first = null;
        foreach (var entry in _catalog)
        {
            var placeholder = new Border
            {
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x2A, 0x2F, 0x38)),
                Child = new TextBlock
                {
                    Text = entry.Name,
                    FontSize = 18,
                    FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xF2, 0xF4, 0xF7)),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                },
            };
            var img = new Image { Stretch = Stretch.UniformToFill };
            var poster = new Grid { Width = 210, Height = 120 };
            poster.Children.Add(placeholder);
            poster.Children.Add(img);
            var caption = new TextBlock
            {
                Text = entry.Badge.Length > 0 ? entry.Name + "   " + entry.Badge : entry.Name,
                FontSize = 12,
                HorizontalAlignment = HorizontalAlignment.Center,
                Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xC0, 0xC8, 0xD2)),
            };
            var cell = new StackPanel { Spacing = 6 };
            cell.Children.Add(poster);
            cell.Children.Add(caption);
            var btn = new Button { Content = cell, Padding = new Thickness(6) };
            var captured = entry;
            btn.Click += (_, __) => onPick(captured);
            first ??= btn;
            row.Children.Add(btn);
            _ = LoadPosterIntoAsync(captured, img, placeholder);
        }
        column.Children.Add(row);
        overlay.Children.Add(column);
        RootGrid.Children.Add(overlay);
        _picker = overlay;
        first?.Focus(FocusState.Programmatic);
    }

    private async Task LoadPosterIntoAsync(HostCatalogEntry entry, Image img, Border placeholder)
    {
        try
        {
            var info = await _posters.GetAsync(entry.Id, entry.Name, entry.Url);
            RootGrid.DispatcherQueue.TryEnqueue(() =>
            {
                if (info.ImagePath is { } path) { try { img.Source = new BitmapImage(new Uri(path)); } catch { } }
                else if (info.BackgroundColor is { } bg && bg.Length == 7 && bg[0] == '#')
                {
                    placeholder.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255,
                        Convert.ToByte(bg.Substring(1, 2), 16), Convert.ToByte(bg.Substring(3, 2), 16), Convert.ToByte(bg.Substring(5, 2), 16)));
                }
            });
        }
        catch { /* wordmark placeholder stays */ }
    }

    private void AddPick(HostCatalogEntry entry)
    {
        try
        {
            // dedupe the tile id against the CURRENT doc (presentation nicety;
            // core still enforces and reports duplicates)
            var taken = new HashSet<string>();
            try
            {
                var docJson = _store.Get("dashboard")
                              ?? FirstRunDocJson();
                using var doc = JsonDocument.Parse(docJson);
                foreach (var t in doc.RootElement.GetProperty("tiles").EnumerateArray())
                    if (t.TryGetProperty("id", out var idEl) && idEl.GetString() is { } tid) taken.Add(tid);
            }
            catch { }
            var tileId = entry.Id;
            for (var n = 2; taken.Contains(tileId); n++) tileId = entry.Id + "-" + n;

            _brain.Call(HostCalls.AddCatalogTile, entry.Json, JsonSerializer.Serialize(new { tileId }), SelectorTableJson(entry.Adapter));
            SetStatus("adding " + entry.Name + " (" + tileId + ")");
        }
        catch (Exception ex) { SetStatus("add failed: " + ex.Message); }
        ClosePicker();
    }

    /// <summary>The adapter's named-selector table (spec 31 presets resolve against it), or null.</summary>
    private static string? SelectorTableJson(string adapter)
    {
        try
        {
            if (adapter.Length == 0) return null;
            var ap = (Sources.AdapterPath(adapter) ?? "");
            if (!File.Exists(ap)) return null;
            using var ad = JsonDocument.Parse(File.ReadAllText(ap));
            return ad.RootElement.TryGetProperty("selectors", out var sel) ? sel.GetRawText() : null;
        }
        catch { return null; }
    }

    /// <summary>Init options: the bundled adapter specs (spec 5 - data, not
    /// code, shipped from prism-adapters as assets). Core owns injection.</summary>
    private static string InitOptionsJson()
    {
        var adapters = new Dictionary<string, JsonElement>();
        try
        {
            // the shipped adapters and the ones added on this device (AdapterFiles: the data folder's adapters/), one file a name
            foreach (var e in Sources.Adapters.Values)
                adapters[e.Name] = JsonDocument.Parse(File.ReadAllText(e.Path)).RootElement.Clone();
        }
        catch { }
        var cosmeticSources = new List<object>();
        try
        {
            var cdir = Path.Combine(AppContext.BaseDirectory, "Assets", "cosmetic");
            if (Directory.Exists(cdir))
                foreach (var file in Directory.GetFiles(cdir, "*.txt"))
                    cosmeticSources.Add(new
                    {
                        attribution = new
                        {
                            name = "Prism baseline",
                            maintainer = "PRISM by Entangled (prism-adapters)",
                            url = "https://github.com/Boil5602/Prism-by-Entangled",
                            license = "GPL-3.0-or-later",
                            syncedAt = File.GetLastWriteTimeUtc(file).ToString("yyyy-MM-dd"),
                        },
                        text = File.ReadAllText(file),
                    });
        }
        catch { }
        // win-host-spec §4 + dashboard-schema §18/§25: the device profile. The host
        // MEASURES (installed RAM) and core decides - maxLiveTiles is what puts a
        // non-playing video slot into `warm`, which is what makes a §25 peek possible
        // at all, and previewBudget floors the peek cadence + caps concurrent decode.
        var budget = JsonDocument.Parse(DeviceBudget.OptionsFragmentJson(DeviceBudget.PhysicalMemoryBytes())).RootElement;
        // §28: the update check, at the configured address, for the configured channel (Services/Updates.cs); off when the person turned it off
        // the checker runs whether or not checks are on, so Check now works and the schedule can be changed without a restart (2026-10-06)
        object? update = new { currentVersion = Services.Updates.CurrentVersion, manifestUrl = Services.Updates.Url, channel = Services.Updates.Channel, schedule = Services.Updates.Schedule, enabled = Services.Updates.Enabled };
        return JsonSerializer.Serialize(new
        {
            adapters,
            cosmeticSources,
            maxLiveTiles = budget.GetProperty("maxLiveTiles").GetInt32(),
            previewBudget = budget.GetProperty("previewBudget").Clone(),
            update,
        });
    }

    private void LogRaw(string line)
    {
        try { AppendHostLog(line); }
        catch { }
    }

    // ------------------------------------------------- arrange mode (M2 v0)
    // Ctrl+A: pick the hero (the SEC8 solver reflows everything around it),
    // grow/shrink the hero, remove tiles. Every action is a core call -
    // promoteHero / setHeroSize / removeTile; the host renders buttons.
    private string CurrentDocJson() =>
        _store.Get("dashboard")
        ?? FirstRunDocJson();

    private async void ToggleArrange()
    {
        if (_arrange is not null)
        {
            RootGrid.Children.Remove(_arrange);
            _arrange = null;
            return;
        }
        if (_picker is not null) TogglePicker();

        // CORE is the single source of the effective layout: getState() folds
        // the persisted hero OVERRIDE in (the stored doc alone showed the
        // original hero - stale panel, reported 2026-08-31). Shared with the
        // app menu's Tiles submenu (MainWindow.Menu.cs).
        var wall = await ReadWallStateAsync();
        var hero = wall.Hero; var heroSize = wall.HeroSize;
        var tiles = wall.Tiles.Select(t => t.Id).ToList();
        if (tiles.Count == 0) { SetStatus("arrange: no tiles readable"); return; }

        var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xEE, 0x0F, 0x12, 0x16)) };
        var column = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Spacing = 10, MinWidth = 420 };
        column.Children.Add(new TextBlock
        {
            Text = "Arrange: Hero reflows the wall around a tile and the slider sizes it. Esc closes.",
            Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xC0, 0xC8, 0xD2)),
            FontSize = 13, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 6),
        });
        foreach (var id in tiles)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
            row.Children.Add(new TextBlock
            {
                Text = id + (id == hero ? "   HERO" : ""),
                Width = 220, VerticalAlignment = VerticalAlignment.Center, FontSize = 14,
                Foreground = new SolidColorBrush(id == hero
                    ? Windows.UI.Color.FromArgb(255, 0xF0, 0xA8, 0x3C)
                    : Windows.UI.Color.FromArgb(255, 0xF2, 0xF4, 0xF7)),
            });
            var tileId = id;
            if (id != hero)
            {
                var heroBtn = new Button { Content = "Make hero", Padding = new Thickness(10, 5, 10, 5) };
                heroBtn.Click += (_, __) => ArrangeAction(() => _brain.Call(HostCalls.PromoteHero, tileId));
                row.Children.Add(heroBtn);
            }
            var rm = new Button
            {
                Content = "Remove", Padding = new Thickness(10, 5, 10, 5),
                Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xD0, 0x6A, 0x5A)),
            };
            rm.Click += (_, __) => ArrangeAction(() => _brain.Call(HostCalls.RemoveTile, tileId));
            row.Children.Add(rm);
            column.Children.Add(row);
        }
        var sliderRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, 8, 0, 0) };
        sliderRow.Children.Add(new TextBlock
        {
            Text = "Hero size", VerticalAlignment = VerticalAlignment.Center,
            Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xC0, 0xC8, 0xD2)),
        });
        var slider = new Slider { Minimum = 30, Maximum = 85, Value = heroSize * 100, Width = 260, StepFrequency = 1 };
        slider.ValueChanged += (_, e) => _brain.Call(HostCalls.SetHeroSize, e.NewValue / 100.0, true);
        sliderRow.Children.Add(slider);
        column.Children.Add(sliderRow);
        overlay.Children.Add(column);
        RootGrid.Children.Add(overlay);
        _arrange = overlay;
    }

    /// <summary>Run a core call, then rebuild the panel once core has re-persisted.</summary>
    private void ArrangeAction(Action call)
    {
        call();
        var t = RootGrid.DispatcherQueue.CreateTimer();
        t.Interval = TimeSpan.FromMilliseconds(500);
        t.IsRepeating = false;
        t.Tick += (_, __) => { if (_arrange is not null) { ToggleArrange(); ToggleArrange(); } };
        t.Start();
    }

    // Host presentation state: the window's last bounds (store key host.window).
    private void RestoreWindowBounds()
    {
        try
        {
            var j = _store.Get("host.window");
            if (j is null) { LogLine("window: no saved bounds - default placement"); RestoreWallFullscreen(); return; }
            using var d = JsonDocument.Parse(j);
            var r = d.RootElement;
            var x = r.GetProperty("x").GetInt32();
            var y = r.GetProperty("y").GetInt32();
            var w = Math.Max(600, r.GetProperty("w").GetInt32());
            var h = Math.Max(400, r.GetProperty("h").GetInt32());
            // Only where a person can reach it: a rect saved on a monitor that is
            // no longer connected (seen 2026-09-02, y = -1432) restored a window
            // nobody could raise. The -32000 minimized sentinel is the same rule.
            // 2026-09-14: DisplayArea.FindAll() threw "ClassFactory cannot supply requested class" here, in the window's
            // constructor, on EVERY boot since the check arrived (2026-09-02) - and the catch below swallowed it, so no
            // window had been restored since ("loses its location / size every time you close/reopen it"). The Win32
            // monitor list needs no windowing runtime; the WinAppSDK one is tried first and stands in when it answers.
            IEnumerable<WindowPlacement.Rect> displays;
            try
            {
                displays = Microsoft.UI.Windowing.DisplayArea.FindAll()
                    .Select(d => new WindowPlacement.Rect(d.OuterBounds.X, d.OuterBounds.Y, d.OuterBounds.Width, d.OuterBounds.Height)).ToList();
            }
            catch (Exception ex)
            {
                LogLine("window: DisplayArea.FindAll failed (" + ex.Message + ") - Win32 monitor list");
                displays = WindowPlacement.Win32Monitors();
            }
            if (!WindowPlacement.IsReachable(new WindowPlacement.Rect(x, y, w, h), displays))
            {
                LogLine($"window: saved bounds {x},{y} {w}x{h} are on no connected display - default placement");
                RestoreWallFullscreen();
                return;
            }
            AppWindow.MoveAndResize(new Windows.Graphics.RectInt32(x, y, w, h));
            LogLine($"window: restored bounds {x},{y} {w}x{h}");
            RestoreWallFullscreen();
        }
        catch (Exception ex) { LogLine("window: restore failed: " + ex.Message); }
    }

    /// <summary>The wall was full screen (F11) when it closed: come back that way, over the restored windowed bounds.</summary>
    private void RestoreWallFullscreen()
    {
        try { if (HostPrefs.GetBool("wallFullScreen", false) && !_wallFs) ToggleWallFullscreen(); } catch { }
    }

    private void SaveWindowBounds()
    {
        try
        {
            var p = AppWindow.Position;
            var sz = AppWindow.Size;
            // Windows parks a minimized window at -32000,-32000 (600x400): never
            // remember that, or the next launch opens off-screen (seen 2026-08-31)
            // 2026-09-14: "the Prism window loses its location / size every time you close/reopen it" - a close while the
            // wall (F11) or a screen was full screen saved the MONITOR's rect as the window's, and the mode itself was
            // forgotten. Full screen keeps the last windowed bounds and remembers that it was full screen; the boot puts
            // the mode back (RestoreWindowBounds).
            var fs = _wallFs || _screenFsTile is not null;
            HostPrefs.Set("wallFullScreen", _wallFs);
            if (fs) { LogLine("window: full screen at close - windowed bounds kept, wallFullScreen=" + _wallFs); return; }
            if (OffScreen(p.X, p.Y) || sz.Width < 300 || sz.Height < 200) return;
            _store.Set("host.window", JsonSerializer.Serialize(new { x = p.X, y = p.Y, w = sz.Width, h = sz.Height }));
            LogLine($"window: saved bounds {p.X},{p.Y} {sz.Width}x{sz.Height}");
        }
        catch { }
    }

    private static bool OffScreen(int x, int y) => WindowPlacement.IsMinimizedSentinel(x, y);

    /// <summary>§27 imagery: art the PAGE can load - the tiles map
    /// https://prism-art.local/ onto the local art cache (SurfaceManager).</summary>
    /// <summary>surface.evaluate: the page's answer (WebView2's JSON of the expression's value) to core; an error answers null with the reason.</summary>
    private async Task AnswerEvaluateAsync(CommandMessage m)
    {
        if (m.RequestId is not { } rid) return;
        var id = m.GetString("id") ?? ""; var js = m.GetString("js") ?? "";
        var r = await _surfaces.EvalOnTileAsync(id, js);
        if (r is not null && r.StartsWith("__prism_eval_error")) _brain.Call(HostCalls.Resolve, rid, null, r);
        else _brain.Call(HostCalls.Resolve, rid, r, null);
    }

    private void AnswerVeilImagery(CommandMessage m)
    {
        if (m.RequestId is not { } rid) return;
        try
        {
            var dir = Path.Combine(_store.Root, "art");
            var urls = Directory.Exists(dir)
                ? Directory.GetFiles(dir, "*.jpg").Select(f => "https://prism-art.local/" + Path.GetFileName(f)).ToArray()
                : Array.Empty<string>();
            _brain.Call(HostCalls.Resolve, rid, JsonSerializer.Serialize(urls), null);
        }
        catch (Exception ex)
        {
            _brain.Call(HostCalls.Resolve, rid, null, "veilImagery: " + ex.Message);
        }
    }

    // -------------------------------------------- Prism Control Center
    // The pill opens wall-wide veil controls (spec 26/30): every slot's
    // cover state, per-slot Show ad / Re-veil, and all-slots-at-once.
    private void ToggleControls()
    {
        if (_controls is not null)
        {
            RootGrid.Children.Remove(_controls);
            _controls = null;
            return;
        }
        var panel = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 10, 34),
            Spacing = 6,
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF2, 0x14, 0x17, 0x1C)),
        };
        panel.Children.Add(new TextBlock
        {
            Text = "Prism veils", FontSize = 12, Margin = new Thickness(12, 10, 12, 2),
            Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xF0, 0xA8, 0x3C)),
        });
        var any = false;
        // the windows on the wall only - not the services' hidden work and lookup pages (app:<id>:work / :lookup)
        foreach (var (id, covered, peeked) in _surfaces.VeilStates().Where(v => !v.Id.StartsWith("app:", StringComparison.Ordinal)).OrderBy(v => v.Id))
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(12, 0, 12, 0) };
            row.Children.Add(new TextBlock
            {
                Text = id + (covered ? (peeked ? "  (ad shown)" : "  (veiled)") : ""),
                Width = 190, VerticalAlignment = VerticalAlignment.Center, FontSize = 13,
                Foreground = new SolidColorBrush(covered
                    ? Windows.UI.Color.FromArgb(255, 0xF0, 0xA8, 0x3C)
                    : Windows.UI.Color.FromArgb(255, 0xC0, 0xC8, 0xD2)),
            });
            var fsId = id;
            var slotBtn = new Button { Content = "Fill slot", Padding = new Thickness(10, 4, 10, 4) };
            slotBtn.Click += (_, __) => { _ = _surfaces.RequestPlayerFullscreenAsync(fsId); ToggleControls(); };
            row.Children.Add(slotBtn);
            var screenBtn = new Button { Content = "Full Screen", Padding = new Thickness(10, 4, 10, 4) };
            screenBtn.Click += (_, __) => { ToggleScreenFullscreen(fsId); ToggleControls(); };
            row.Children.Add(screenBtn);
            if (covered)
            {
                any = true;
                var tid = id;
                var btn = new Button { Content = peeked ? "Re-veil" : "Show ad 15s", Padding = new Thickness(10, 4, 10, 4) };
                btn.Click += (_, __) => _surfaces.TogglePeek(tid);
                row.Children.Add(btn);
            }
            panel.Children.Add(row);
        }
        var reportBtn = new Button
        {
            Content = "\u2691 Report an ad",
            Margin = new Thickness(12, 6, 12, 0),
            Padding = new Thickness(10, 4, 10, 4),
            Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xF0, 0xA8, 0x3C)),
        };
        reportBtn.Click += (_, __) => { ToggleControls(); StartReportPick(); };
        panel.Children.Add(reportBtn);
        var global = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(12, 6, 12, 12) };
        var showAll = new Button { Content = "Show all ads", Padding = new Thickness(10, 4, 10, 4), IsEnabled = any };
        showAll.Click += (_, __) => { foreach (var v in _surfaces.VeilStates()) if (v.Covered && !v.Peeked) _surfaces.TogglePeek(v.Id); };
        var veilAll = new Button { Content = "Re-veil all", Padding = new Thickness(10, 4, 10, 4), IsEnabled = any };
        veilAll.Click += (_, __) => { foreach (var v in _surfaces.VeilStates()) if (v.Covered && v.Peeked) _surfaces.TogglePeek(v.Id); };
        global.Children.Add(showAll);
        global.Children.Add(veilAll);
        panel.Children.Add(global);
        RootGrid.Children.Add(panel);
        _controls = new Grid();          // sentinel for esc/toggle bookkeeping
        _controls.Children.Clear();
        RootGrid.Children.Remove(panel);
        var host = new Grid();
        host.Children.Add(panel);
        RootGrid.Children.Add(host);
        _controls = host;
    }

    // ------------------------------------------------ one-button ad report
    // The wall-wide equivalent of the extension's report chip: pick the slot
    // showing the ad; the host probes THAT tile (which known ad signals
    // exist/are visible, player containers, iframe hosts - no titles, no body
    // text, no account) and sends it to the prism-reports inbox. Clicking a
    // labeled slot IS the consent; Esc cancels.
    private const string ReportProbeJs = @"
(function () {
  function vis(e) { return !!(e && e.offsetWidth > 0 && e.offsetHeight > 0); }
  var sig = {};
  var probes = {
    'yt-ad-showing': '.html5-video-player.ad-showing, .html5-video-player.ad-interrupting',
    'yt-ad-module': '.video-ads.ytp-ad-module > *',
    'yt-feed-ad': 'ytd-display-ad-renderer,ytd-in-feed-ad-layout-renderer,ytd-ad-slot-renderer',
    'hulu-adbar': '.AdUnitView__adBar',
    'hulu-vpaid': '.AdPlayer:not(.AdPlayer--hidden)',
    'peacock-break': ""[class*='adBreakActive']"",
    'paramount-panel': ""[class*='ad-info-manager']"",
    'twitch-ad': ""[data-a-target='video-ad-label'],[data-a-target='video-ad-countdown']"",
    'twitch-front-ad': ""[aria-label='Pause Ad'],[aria-label='Unmute Ad'],[aria-label^='Leave feedback for this Ad']"",
    'ima-iframe': ""iframe[src*='imasdk.googleapis.com']"",
    'gpt-slot': ""div[id^='div-gpt-ad'],ins.adsbygoogle"",
    'prism-veil-cover': '[data-prism-veil-cover]',
  };
  for (var k in probes) {
    try {
      var els = document.querySelectorAll(probes[k]);
      var visible = 0;
      for (var i = 0; i < els.length; i++) if (vis(els[i])) visible++;
      if (els.length) sig[k] = els.length + '/' + visible + ' visible';
    } catch (e) { sig[k] = 'selector error'; }
  }
  var frames = [];
  var ifr = document.querySelectorAll('iframe');
  for (var j = 0; j < ifr.length && frames.length < 8; j++) {
    if (!vis(ifr[j])) continue;
    try { frames.push(new URL(ifr[j].src).host + ' ' + ifr[j].offsetWidth + 'x' + ifr[j].offsetHeight); } catch (e) {}
  }
  var players = [];
  ['.html5-video-player', '.Player__container', '#mainContainer', '.aa-player-skin', '.video-player'].forEach(function (c) {
    var e = document.querySelector(c);
    if (e) players.push(c + ' ' + (vis(e) ? 'VIS' : 'hid') + ' cls=' + String(e.className).slice(0, 100));
  });
  return JSON.stringify({ signals: sig, iframes: frames, players: players,
    videos: document.querySelectorAll('video').length });
})()";

    private static readonly HttpClient ReportHttp = new();

    private void StartReportPick()
    {
        // the WHOLE slot is the click target - clicking "the ad" IS clicking
        // the slot (first cut had corner chips only; a click on the ad itself
        // reached the live page and opened its link)
        StartSlotPick(
            "Click the slot showing the ad - Esc cancels",
            _surfaces.VeilStates().Select(v => v.Id),
            id => "\u2691 Report the ad in " + id + "\n(you see what is sent before anything goes)",
            id => ShowReportPanel(id));
    }

    /// <summary>Ctrl+digit: tile N (doc order) to full window / back.</summary>
    private void ToggleTileFullscreen(int index)
    {
        try
        {
            using var doc = JsonDocument.Parse(CurrentDocJson());
            var tiles = doc.RootElement.GetProperty("tiles").EnumerateArray()
                .Select(t => t.GetProperty("id").GetString()!).ToList();
            if (index < 0 || index >= tiles.Count) return;
            _brain.Call(HostCalls.ToggleFullscreen, tiles[index]);
            SetStatus("fullscreen toggle: " + tiles[index]);
        }
        catch (Exception ex) { SetStatus("fullscreen: " + ex.Message); }
    }

    /// <summary>The report as the panel described it (MainWindow.ReportPanel): the site's domain, the ad's details in the window (the probe's ad signs
    /// and player), the kind, the note, Prism's version - and the full page address and the embedded players' addresses only with the box ticked.</summary>
    private async Task SendReportAsync(string tileId, string site, string url, JsonElement? probe, string? probeNote, string kind, string note, bool full)
    {
        SetPill("Prism \u00b7 sending the report\u2026");
        try
        {
            var ver = AppVersion.Text;
            var diag = new Dictionary<string, object?> { ["source"] = "prism-host report", ["tile"] = tileId };
            if (probeNote is not null) diag["probe"] = probeNote;
            if (probe is { } pj)
            {
                if (pj.TryGetProperty("signals", out var sg)) diag["signals"] = sg;
                if (pj.TryGetProperty("players", out var pl)) diag["players"] = pl;
                if (pj.TryGetProperty("videos", out var vc)) diag["videos"] = vc;
                if (full && pj.TryGetProperty("iframes", out var fr)) diag["iframes"] = fr;   // the embedded players' addresses: only with the box ticked
            }
            var payload = new Dictionary<string, object?>
            {
                ["v"] = 1,
                ["site"] = site.Length > 0 ? site : "prism-host",
                ["kind"] = kind,
                ["veil"] = ("host " + ver).Length <= 16 ? "host " + ver : ver,
                ["target"] = new { tag = "TILE", id = tileId, cls = "", text = "", w = 0, h = 0, kids = 0 },
                ["chain"] = Array.Empty<object>(),
                ["diag"] = diag,
            };
            if (note.Length > 0) payload["note"] = note.Length > 280 ? note.Substring(0, 280) : note;
            if (full) payload["url"] = url.Length > 200 ? url.Substring(0, 200) : url;
            var res = await ReportHttp.PostAsync("https://reports.entangled.world/v1/report",   // Entangled's address for the inbox (2026-09-26)
                new StringContent(JsonSerializer.Serialize(payload), System.Text.Encoding.UTF8, "application/json"));
            SetPill(res.IsSuccessStatusCode
                ? "Prism \u00b7 \u2713 report sent. Thank you."
                : "Prism \u00b7 the report didn't send (http " + (int)res.StatusCode + ")");
        }
        catch (Exception ex)
        {
            SetPill("Prism \u00b7 the report didn't send: " + ex.Message);
        }
    }

    /// <summary>Ctrl+Shift+S: Prism's own wall shot - DRM-black frames come
    /// out as the tile's poster on the substrate instead of black.</summary>
    private async Task CaptureWallShotAsync()
    {
        try
        {
            // the shot is the wall as it looks: the windows, then Prism's own chrome above the canvas (the stage bar, the grips, the menus,
            // an open pop-up) - never the status pill that reports the shot itself (2026-09-23)
            var path = await _surfaces.CaptureWallAsync(async (wall, cw, ch) =>
            {
                foreach (var child in RootGrid.Children.ToList())
                    if (!ReferenceEquals(child, TileCanvas) && !ReferenceEquals(child, PillBorder)) await _surfaces.BlendElementAsync(wall, cw, ch, child);
                foreach (var popup in Microsoft.UI.Xaml.Media.VisualTreeHelper.GetOpenPopupsForXamlRoot(RootGrid.XamlRoot))
                    if (popup.Child is UIElement pc) await _surfaces.BlendElementAsync(wall, cw, ch, pc);
            });
            if (path is null) { SetPill("Prism · capture failed"); return; }
            try
            {
                var file = await Windows.Storage.StorageFile.GetFileFromPathAsync(path);
                var pkg = new Windows.ApplicationModel.DataTransfer.DataPackage();
                pkg.SetBitmap(Windows.Storage.Streams.RandomAccessStreamReference.CreateFromFile(file));
                Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(pkg);
            }
            catch { /* clipboard is a bonus; the file is the deliverable */ }
            SetPill("Prism · wall shot saved: " + System.IO.Path.GetFileName(path) + " (and on the clipboard)");
        }
        catch (Exception ex) { SetPill("Prism · capture failed: " + ex.Message); }
    }

    private string? _screenFsTile;

    /// <summary>Full Screen: the tile across the ENTIRE monitor - core
    /// maximizes the tile to the window and the window drops its chrome
    /// (fullscreen presenter). Toggling the same tile restores both.</summary>
    private void ToggleScreenFullscreen(string tileId)
    {
        _brain.Call(HostCalls.ToggleFullscreen, tileId);
        try
        {
            if (_screenFsTile == tileId)
            {
                // an F11 wall full screen underneath keeps its chrome dropped
                if (!_wallFs) AppWindow.SetPresenter(Microsoft.UI.Windowing.AppWindowPresenterKind.Overlapped);
                _screenFsTile = null;
            }
            else
            {
                AppWindow.SetPresenter(Microsoft.UI.Windowing.AppWindowPresenterKind.FullScreen);
                _screenFsTile = tileId;
            }
        }
        catch { /* presenter is chrome; the tile maximize already happened */ }
    }

    /// <summary>The pill is transient (2026-09-08: "Don't need Prism in the bottom right corner"): a message shows for six seconds, then the corner is clear; a bare "Prism" never shows.</summary>
    private DispatcherTimer? _pillHide;
    private void SetPill(string text) => SetPill(text, hold: false);
    /// <summary>The status feed (2026-09-18): a line at the top that stands six seconds and slowly fades; a held line (work in hand) stands until the next line.</summary>
    private void SetPill(string text, bool hold) =>
        RootGrid.DispatcherQueue.TryEnqueue(() =>
        {
            PillLine.Text = text;
            // a line of its own takes the status line: an offer's button goes with the offer's words (2026-10-06)
            if (_pillAction is not null && text != _pillActionFor) { PillRow.Children.Remove(_pillAction); _pillAction = null; _pillActionFor = null; }
            var idle = string.IsNullOrWhiteSpace(text) || text.Trim() == "Prism";
            _pillFade?.Stop(); _pillFade = null;
            PillBorder.Opacity = 1;
            PillBorder.Visibility = idle ? Visibility.Collapsed : Visibility.Visible;
            _pillHide ??= new DispatcherTimer { Interval = TimeSpan.FromSeconds(6) };
            _pillHide.Tick -= PillHideTick; _pillHide.Tick += PillHideTick;
            _pillHide.Stop();
            if (hold) _pillHeld = idle ? null : text;
            if (!idle && !hold) _pillHide.Start();
        });
    /// <summary>The work is done: the held line is released, and the given line (the outcome) shows and fades.</summary>
    private void ReleasePill(string outcome) { _pillHeld = null; SetPill(outcome); }
    private Microsoft.UI.Xaml.Media.Animation.Storyboard? _pillFade;
    /// <summary>The feed's held line while work is in hand (set by the transport beat); any other line yields back to it when its six seconds are up.</summary>
    private string? _pillHeld;
    private void PillHideTick(object? sender, object e)
    {
        _pillHide?.Stop();
        // 2026-09-18: "the pill appears and fades well before the process is completed" - a passing line (a press's own words)
        // had taken the timer with it; while work is in hand the held line comes back instead of the fade
        if (_pillHeld is { Length: > 0 } held) { SetPill(held, hold: true); return; }
        try
        {
            var anim = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { From = 1, To = 0, Duration = new Duration(TimeSpan.FromMilliseconds(1600)), EnableDependentAnimation = true };
            Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(anim, PillBorder);
            Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(anim, "Opacity");
            var sb = new Microsoft.UI.Xaml.Media.Animation.Storyboard();
            sb.Children.Add(anim);
            sb.Completed += (_, __) => { if (_pillFade == sb) { PillBorder.Visibility = Visibility.Collapsed; PillBorder.Opacity = 1; _pillFade = null; } };
            _pillFade = sb;
            sb.Begin();
        }
        catch { PillBorder.Visibility = Visibility.Collapsed; }
    }

    /// <summary>host.log only - for high-volume or untrusted text (page titles, call JSON) that must never reach a TextBlock.</summary>
    private void LogLine(string text)
    {
        try { AppendHostLog(text); }
        catch { }
    }

    private void SetStatus(string text)
    {
        try { AppendHostLog(text); }   // the status line is the fourth writer to host.log: through the one lock (it had raced the others, and a line in three lost - firstchance.log, 2026-09-30)
        catch { }
        RootGrid.DispatcherQueue.TryEnqueue(() => StatusLine.Text = text);
    }
}
