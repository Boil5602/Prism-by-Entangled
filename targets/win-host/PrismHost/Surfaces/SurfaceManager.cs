using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using System.Runtime.InteropServices.WindowsRuntime;
using Microsoft.Web.WebView2.Core;
using PrismHost.Channel;
using PrismHost.Services;
using PrismHost.Storage;
using PrismHost.Tiles;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace PrismHost.Surfaces;

/// <summary>
/// What a web surface is on this wall (win-host-spec §5 coverage invariant: the
/// §26/§27/§30 engine attaches to EVERY kind through one seam, AttachEngineAsync).
/// </summary>
public enum SurfaceKind
{
    /// <summary>A slot facet: the wall partition, veils + scenery above it.</summary>
    Slot,
    /// <summary>A floating facet: above slots (z 30), below veils / takeovers / popups / the pill.</summary>
    Floating,
    /// <summary>A hidden facet (§32 music): alive off-canvas at full size, audio only; intermission is audio intermission.</summary>
    Hidden,
    /// <summary>A §30 allowed popup child (sign-in / payment) in its opener's profile, in a sheet over the wall.</summary>
    Popup,
    /// <summary>A §32 visualization: host-rendered, audio-reactive, no web view (no engine to attach - nothing to veil).</summary>
    Visualization,
    /// <summary>B-41 an App setup / facet-preview surface: full window in the App's profile, outside the wall (z 900), destroyed on close.</summary>
    Preview,
}

/// <summary>
/// Driver seam v1 (win-host-spec §3) — the M1 surface ops. The host EXECUTES;
/// readiness, lifecycle and reveal timing are core's decisions arriving as
/// commands. Each tile is a Canvas child:
///
///   Grid container
///   ├─ WebView2 (created hidden under the overlay; dark DefaultBackgroundColor)
///   └─ overlay Grid = dark substrate Border + snapshot Image (§16)
///
/// The overlay is the composition-layer skeleton: opaque from create, shows
/// the persisted snapshot when one exists, and `reveal` crossfades it away.
/// `freeze` captures (CapturePreviewAsync), persists the snapshot, and shows
/// it instantly. DRM-black captures are discarded in favour of the last good
/// snapshot (§4: never a black rectangle on the wall).
/// </summary>
public sealed partial class SurfaceManager
{
    private sealed class Tile
    {
        public required string Id;
        public required string Profile;
        public required Grid Container;
        /// <summary>Unclipped host for the WebView (zoom lays it out at rect/zoom, possibly larger than the slot).</summary>
        public required Canvas ViewHost;
        public required Grid Overlay;
        public required Image SnapImage;
        /// <summary>The stage shield (2026-09-21): a transparent, hit-testable plate over the page while its player is in fullscreen,
        /// so the page never sees the pointer - a pointer move is what wakes every service's own chrome, and the wall's is the
        /// only chrome on the stage ("suppress or supersede the player controls for all of the other video services"). Its
        /// moves and presses reach the host as the page's would (the stage bar rides them; a press returns from the corner).</summary>
        public Border? Shield;
        public SurfaceKind Kind = SurfaceKind.Slot;
        /// <summary>Popups: the tile that opened this one (closes with it; inherits its mute).</summary>
        public string? Opener;
        public Grid? PopupPanel;
        public string? PopupUrl;
        /// <summary>§32 hidden presence: laid out at its rect but parked off-canvas (Chromium keeps it visible → media keeps playing, measured 2026-09-01).</summary>
        public bool HiddenPresence;
        /// <summary>Readers dark (2026-10-03): when a script, a navigation or a pointer last reached this hidden reader, and whether its page is frozen between reads.</summary>
        public DateTime LastTouched = DateTime.UtcNow;
        public bool Dozing;
        /// <summary>B-159: the inline app window (presence "window") stays where core put it - the title bar does not drag; the grip may still resize.</summary>
        public bool Pinned;
        /// <summary>§32 visualization surface: the renderer host and its feed.</summary>
        public Visualization.VisualizationHost? Viz;
        /// <summary>B-221: core's last feed for this visualization, so a mirror opened later starts from it.</summary>
        public string? LastFeed;
        public WebView2? View;
        public CoreWebView2Environment? Env;
        /// <summary>B-152: the browser process behind this surface, cached on the UI thread when the core comes up - the FFT's watch reads it from its own thread (a XAML control cannot be read there).</summary>
        public volatile uint BrowserPid;
        public string InjectedJs = "";
        public string InjectedCss = "";
        public string? DocCssKey;
        public string? DocCssScriptId;   // the adapter CSS kept as a document-created script (KeepCssAtDocumentStartAsync)
        public bool Muted;
        /// <summary>surface.setViewport: the CSS layout viewport the page is laid out at (null = the rect).</summary>
        public (double W, double H)? Viewport;
        /// <summary>DevTools overrides currently applied (so 1× knows to clear them).</summary>
        public bool LayoutOverride, RasterOverride;
        /// <summary>Viewport applies run one at a time per tile (rapid +/− steps must not interleave their DevTools calls).</summary>
        public readonly SemaphoreSlim ViewportGate = new(1, 1);
        /// <summary>Slot tool: "select" (the pointer reaches the page) or "pan" (drag scrolls the page).</summary>
        public string Tool = "select";
        public CursorGrid? PanCatcher;
        /// <summary>concept-scenes §5: Prism owns the single tap here (tapAction audio|both) - the page keeps everything else.</summary>
        public CursorGrid? TapCatcher;
        public ChannelRect Rect;
        public Grid? Intermission;
        public Image? IntermissionArt;
        public Button? SkipChip;
        public Button? PeekChip;
        public TextBlock? Caption;
        public TextBlock? CountText;
        public bool Covered;
        /// <summary>How core asked this break to look (Watch settings' Video ads): veil draws the scenery, mute and show leave the picture up.</summary>
        public string Look = "veil";
        public bool Peeked;
        // spec 26 card corner (concept-scenes 3.2): the provenance of the image
        // on screen right now, read from the local pack manifest - never a lookup.
        public TextBlock? ArtLine;          // on the card: title (with creator) + credit + licence
        public TextBlock? ArtChip;          // minimal mode: the credit alone, bottom corner
        public Border? ArtChipHost;
        public Border? Card;
        public Button? MinimalChip;         // one tap toggles minimal (spec 26 "card minimize")
        public Button? FillChip;
        public Button? WatchChip;           // the Video player's break: Watch / Return to video (2026-09-23)
        public ArtAttribution? ArtInfo;
        public bool CardMinimal;
        public string? AdTimeLeft;          // "1:23 left" while the service says, for the collapsed icon
        public Microsoft.UI.Dispatching.DispatcherQueueTimer? PeekTimer;
        public int PeekRemaining;
        public Border[] SubSlabs = Array.Empty<Border>();
        public Image[] ArtSlabs = Array.Empty<Image>();
        public Border? SkipRing;
        public string? SkipTarget;
        public Microsoft.UI.Dispatching.DispatcherQueueTimer? SkipHoleTimer;
        // spec 33 an empty slot: a shape and a place, no web view
        public bool Placeholder;
        public Grid? PlaceholderGrid;
        // spec 32 floating chrome + the Now Playing control (all null on a wall slot)
        public string Face = "control";
        public Grid? FloatBar, ControlFace;
        public Border? FloatGrip, FloatBorder;
        public Button? FaceBtn;
        /// <summary>The page's player is in its own fullscreen (the top layer): laid out at the rect's size while it is (2026-09-24).</summary>
        public bool InFullscreen;
        /// <summary>Multiview's X on the bar (2026-09-24): shown only while the window is a multiview window.</summary>
        public Button? CloseBtn;
        /// <summary>Multiview's X in the window's own top right corner, above the veil (SyncCornerX).</summary>
        public Button? CornerX;
        public FontIcon? FaceIcon, NpPlayIcon, NpMuteIcon;
        public TextBlock? NpTitle, NpArtist, NpTime;
        public Image? NpArt;
        public Border? NpArtHost;
        public ProgressBar? NpBar;
        public string? NpArtUrl;
        public bool NpPlaying;
        public double NpPos, NpDur;
        public long NpAt;
        public Microsoft.UI.Dispatching.DispatcherQueueTimer? NpTimer;
    }

    private readonly Canvas _canvas;
    private readonly StoreService _store;
    private readonly ArtService _art;
    /// <summary>The section 27 imagery cache (the CC0 pool and the packs): the music block draws a break poster from it (2026-09-14).</summary>
    public ArtService Art => _art;
    private readonly Action<string, string> _forwardEvent;   // (id, eventJsonWithoutId → sent with id)
    private readonly Action<string> _onStatus;
    private readonly Dictionary<string, Tile> _tiles = new();
    private readonly Dictionary<string, (ChannelRect rect, string snap)> _bootCache = new();

    private const string DarkHex = "#14171C";
    private static readonly Windows.UI.Color Dark = Windows.UI.Color.FromArgb(255, 0x14, 0x17, 0x1C);

    public SurfaceManager(Canvas canvas, StoreService store, ArtService art, Action<string, string> forwardEvent, Action<string> onStatus)
    {
        _canvas = canvas;
        _store = store;
        _art = art;
        _forwardEvent = forwardEvent;
        _onStatus = onStatus;
        SessionMute = new(m => _onStatus("audio " + m));
        // B-191 (2026-09-09): "When I mute it, the background visuals stop animating" - a mute while the source was idle found no
        // session to duck, so the WebView2 mute stayed as the fallback; when the music came back its new session was ducked at
        // birth but the tab mute never lifted, the renderer put out silence, and the loopback fed the stage nothing. A late duck
        // lifts the tab mute exactly as an immediate one does.
        SessionMute.Ducked += pid => _canvas.DispatcherQueue.TryEnqueue(() =>
        {
            foreach (var t in _tiles.Values)
                // 2026-10-04: no duck, no lift (one browser for every service)
                if (false && t.BrowserPid == pid && t.Muted && t.Kind == SurfaceKind.Hidden && t.View?.CoreWebView2 is { IsMuted: true } c) { c.IsMuted = false; _onStatus($"mute {t.Id}: session ducked late - WebView2 mute lifted, the loopback hears it"); }
        });
        LoadBootCache();
        // B-198 (2026-09-14): a page's own timers are not trusted to keep running - Pandora's first pause cleared the
        // injected script's intervals (the now-playing scan ran 60 times and never again, while a timer armed later ran
        // on), so the wall said playing for ten minutes after the tuner said Play. The host beats every live page once
        // a second; a scan whose own timer has vanished runs from the beat (see __prismBeat in the injected script).
        _beat = _canvas.DispatcherQueue.CreateTimer();
        _beat.Interval = TimeSpan.FromSeconds(1);
        _beat.Tick += (s, e) =>
        {
            var a0 = GC.GetTotalAllocatedBytes(false);
            var n = 0;
            foreach (var t in _tiles.Values)
                if (t.View?.CoreWebView2 is { } c) { n++; try { var op = c.ExecuteScriptAsync("window.__prismBeat&&window.__prismBeat()"); } catch { } }
            BeatAlloc += GC.GetTotalAllocatedBytes(false) - a0; BeatCalls += n;
        };
        _beat.Start();
    }

    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _beat;
    /// <summary>(2026-10-03, perf) what the beat's own script calls allocate, and how many, for perf.log.</summary>
    public long BeatAlloc, BeatCalls;

    // ---------------------------------------------------------------- boot
    /// <summary>§8/§16 boot: last snapshots at last rects, before core wakes.</summary>
    public void ShowBootSnapshots()
    {
        foreach (var (id, entry) in _bootCache)
        {
            if (!File.Exists(entry.snap)) continue;
            var tile = GetOrCreateVisual(id);
            ApplyRect(tile, entry.rect);
            TrySetImage(tile.SnapImage, entry.snap);
            tile.Overlay.Opacity = 1;
        }
    }

    private void LoadBootCache()
    {
        try
        {
            var json = _store.Get("host.boot");
            if (json is null) return;
            using var doc = JsonDocument.Parse(json);
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                var id = el.GetProperty("id").GetString()!;
                var r = new ChannelRect(el.GetProperty("x").GetDouble(), el.GetProperty("y").GetDouble(),
                                        el.GetProperty("w").GetDouble(), el.GetProperty("h").GetDouble());
                _bootCache[id] = (r, el.GetProperty("snap").GetString() ?? _store.SnapshotPath(id));
            }
        }
        catch { /* presentation cache only — §10 data is elsewhere */ }
    }

    private void SaveBootCache()
    {
        var rows = _bootCache.Select(kv => new
        {
            id = kv.Key, x = kv.Value.rect.X, y = kv.Value.rect.Y, w = kv.Value.rect.W, h = kv.Value.rect.H,
            snap = kv.Value.snap,
        });
        _store.Set("host.boot", JsonSerializer.Serialize(rows));
    }

    // ---------------------------------------------------------------- seam
    public async Task CreateAsync(CommandMessage cmd)
    {
        var id = cmd.GetString("id")!;
        var profile = cmd.GetString("profile") ?? id;
        var tile = GetOrCreateVisual(id);
        tile.Profile = profile;
        tile.Kind = (cmd.GetString("kind") ?? "slot") switch { "hidden" => SurfaceKind.Hidden, "floating" => SurfaceKind.Floating, "preview" => SurfaceKind.Preview, _ => SurfaceKind.Slot };
        if (tile.Kind == SurfaceKind.Hidden) tile.HiddenPresence = true;
        if (tile.Kind == SurfaceKind.Preview)
        {
            // full window until core (or the setup UI) says otherwise; never in the boot cache (Persistable)
            ApplyRect(tile, new ChannelRect(0, 0, Math.Max(1, _canvas.ActualWidth), Math.Max(1, _canvas.ActualHeight)));
            Canvas.SetZIndex(tile.Container, 900);
            _canvas.SizeChanged += (_, __) => { if (tile.Kind == SurfaceKind.Preview && _tiles.ContainsKey(tile.Id) && tile.Rect.X == 0 && tile.Rect.Y == 0) ApplyRect(tile, new ChannelRect(0, 0, Math.Max(1, _canvas.ActualWidth), Math.Max(1, _canvas.ActualHeight))); };
        }
        tile.Overlay.Opacity = 1;                                     // starts hidden (§16)
        if (cmd.GetBool("placeholder")) { BuildPlaceholder(tile, cmd.GetString("label") ?? ""); return; }   // §33: no web view, no session
        // pages nobody sees are made one at a time, a beat apart (2026-09-29, host.log 'ui stall': the boot made the music sources and the
        // services' reading pages together with the screen, and the window stopped taking clicks for a second or more); a page a person
        // sees is made at once. Each surface's later commands wait on its own chain, so nothing reaches a page before it exists.
        if (tile.Kind == SurfaceKind.Hidden)
        {
            await HiddenAttach.WaitAsync();
            try { if (_tiles.ContainsKey(tile.Id)) { await AttachEngineAsync(tile); await Task.Delay(300); } }
            finally { HiddenAttach.Release(); }
            return;
        }
        await AttachEngineAsync(tile);
    }
    private static readonly SemaphoreSlim HiddenAttach = new(1, 1);

    /// <summary>§32 visualization surface: no web view, no session - a host-rendered, audio-reactive
    /// panel fed by core's music state (surface.setVisualizationFeed) and the host's own loopback FFT.
    /// Placed / stacked / removed like any surface. Idles dark until its source plays.</summary>
    public void CreateVisualization(CommandMessage cmd)
    {
        var id = cmd.GetString("id")!;
        var tile = GetOrCreateVisual(id);
        tile.Kind = SurfaceKind.Visualization;
        tile.Overlay.Opacity = 1;
        tile.Viz = new Visualization.VisualizationHost(cmd.GetString("style") ?? "spectrum", cmd.GetString("source") ?? "", cmd.GetString("artwork") ?? "off", AudioSource, spill: cmd.GetBool("spill"));
        tile.Container.Children.Insert(Math.Min(1, tile.Container.Children.Count), tile.Viz);   // above the (empty) view host, below the overlay
        _onStatus($"visualization {id}: {tile.Viz.Style} <- {tile.Viz.Source}");
        VisualizationCreated?.Invoke(id);   // B-221: a mirror follows a restyle
        // B-152: the FFT listens to the source's own browser process, not the machine (resolved live: a recycle changes it)
        {
            var src = tile.Viz.Source;
            AudioTarget?.Invoke(src.Length > 0 ? () => Get(src) is { BrowserPid: > 0 } t ? t.BrowserPid : null : null);
        }
    }

    /// <summary>The FFT feed visualizations render from (win-host-spec §6 WASAPI loopback); null = bands stay at zero.</summary>
    public Visualization.IVisualizationAudioSource? AudioSource { get; set; }
    /// <summary>B-152: tells the capture whose browser process to listen to (a resolver, read from the capture's own thread); null = the device.</summary>
    public Action<Func<uint?>?>? AudioTarget { get; set; }

    public void SetVisualizationFeed(string id, string json)
    {
        if (Get(id) is { Viz: { } viz } t) { t.LastFeed = json; viz.SetFeed(json); FeedMirror?.Invoke(id, json); }
    }

    /// <summary>B-221: the mini player mirrors a stage - every feed the stage gets, and a rebuild when its visual changes.</summary>
    public Action<string, string>? FeedMirror;
    public Action<string>? VisualizationCreated;
    /// <summary>What a stage draws right now (style, source, artwork mode, spill, the last feed), or null when it is no visualization.</summary>
    public (string Style, string Source, string Artwork, bool Spill, string? Feed)? VisualizationSpec(string id)
        => Get(id) is { Viz: { } v } t ? (v.Style, v.Source, v.ArtworkMode, v.Spill, t.LastFeed) : null;

    /// <summary>§33 an empty slot: dark substrate, its shape, and "choose an app" - a click opens the slot menu.</summary>
    private void BuildPlaceholder(Tile tile, string label)
    {
        tile.Placeholder = true;
        if (tile.PlaceholderGrid is not null) return;
        var amber = Windows.UI.Color.FromArgb(255, 0xF2, 0xB1, 0x4C);
        var g = new CursorGrid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x14, 0x15, 0x1C)) };
        g.UseCursor(Microsoft.UI.Input.InputSystemCursorShape.Hand);
        g.Children.Add(new Border
        {
            BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x70, 0xF2, 0xB1, 0x4C)),
            BorderThickness = new Thickness(1),
            Margin = new Thickness(8),
            CornerRadius = new CornerRadius(6),
            IsHitTestVisible = false,
        });
        var col = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Spacing = 4, IsHitTestVisible = false };
        col.Children.Add(new TextBlock { Text = "＋", FontSize = 36, Foreground = new SolidColorBrush(amber), HorizontalAlignment = HorizontalAlignment.Center });
        col.Children.Add(new TextBlock
        {
            Text = "Empty slot" + (label.Length > 0 ? "  ·  " + label : ""),
            FontSize = 15,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xEC, 0xEC, 0xF0)),
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        col.Children.Add(new TextBlock { Text = "Click to choose an app", FontSize = 12, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x9A, 0x9C, 0xA8)), HorizontalAlignment = HorizontalAlignment.Center });
        g.Children.Add(col);
        g.PointerPressed += (s, e) =>
        {
            e.Handled = true;
            try { SlotContextMenu?.Invoke(tile.Id, g.TransformToVisual(_canvas).TransformPoint(e.GetCurrentPoint(g).Position)); } catch { }
        };
        tile.PlaceholderGrid = g;
        tile.Container.Children.Insert(Math.Min(1, tile.Container.Children.Count), g);   // above the (empty) view host, below the overlay
    }

    /// <summary>
    /// THE engine-attach seam (win-host-spec §5 coverage invariant): every web
    /// surface this app creates - slot, floating, hidden, popup child (and any
    /// surface Agent 2 pops out for App setup / picker previews, which reuse
    /// these tiles) - is a Tile that comes through here. It is the only place a
    /// WebView2 is constructed, so the §26/§27/§30 engine (TileBootstrapJs at
    /// document-created, events to core, the inject path, the popup doctrine,
    /// the composition overlay, page-invisible mute, fullscreen auto-grant)
    /// cannot be skipped by a new surface type. scripts/verify-surface-coverage.mjs
    /// asserts exactly this.
    /// </summary>
    /// <summary>The profile folders whose DRM-disable record was looked at in this run (once each, before its browser starts).</summary>
    private static readonly HashSet<string> DrmCleared = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Removes Chromium's media.hardware_secure_decryption record from a profile's Local State (PlayReady turned off after a failure).</summary>
    private void ClearDrmDisable(string profileDir)
    {
        try
        {
            var path = System.IO.Path.Combine(profileDir, "EBWebView", "Local State");
            if (!System.IO.File.Exists(path)) return;
            var text = System.IO.File.ReadAllText(path);
            if (!text.Contains("hardware_secure_decryption")) return;
            if (System.Text.Json.Nodes.JsonNode.Parse(text) is not System.Text.Json.Nodes.JsonObject root) return;
            if (root["media"] is not System.Text.Json.Nodes.JsonObject media || !media.ContainsKey("hardware_secure_decryption")) return;
            media.Remove("hardware_secure_decryption");
            System.IO.File.WriteAllText(path, root.ToJsonString(), new System.Text.UTF8Encoding(false));
            _onStatus("drm repair: cleared the PlayReady-disabled record in " + profileDir);
        }
        catch (Exception ex) { _onStatus("drm repair: " + profileDir + ": " + ex.Message); }
    }
    /// <summary>A page's player reported that no protected-video system is available (Disney+'s DRM_NO_SUPPORTED_KEY_SYSTEM).</summary>
    public event Action<string>? DrmFailed;

    private async Task AttachEngineAsync(Tile tile)
    {
        // B-152 (2026-09-08): the soundscape's page synthesizes with Web Audio and nobody ever clicks it - Chromium's autoplay
        // policy kept its AudioContext suspended (every time it "worked" an injected probe had resumed it). Its own profile
        // gets the policy relaxed; the services' profiles are untouched.
        var envOptions = new CoreWebView2EnvironmentOptions();
        // 2026-09-14: every profile, not only the soundscape's. A wall is not a browser: after a host restart Pandora's
        // page sat on its "press play" screen - the station URL navigated, the face said playing, but its browser
        // never produced an audio session ("restored at 0 session(s)" on every unmute) because no human had ever
        // clicked inside that fresh WebView2 and Chromium's autoplay policy blocked the first play. The wall's own
        // transport is the person's gesture; a synthetic click on the page's Play does not count as one.
        // 2026-09-24 ("disney worked in multiview yesterday fine"): after one failure of the hardware-backed decryptor Chromium wrote
        // media.hardware_secure_decryption.disabled_times into the Disney+ profile's Local State and from then on refused PlayReady to every
        // Disney+ page (DRM_NO_SUPPORTED_KEY_SYSTEM). The fallback is off - a failure stays one failure - and a record already written is
        // cleared before the profile's browser starts.
        envOptions.AdditionalBrowserArguments = "--autoplay-policy=no-user-gesture-required --disable-features=HardwareSecureDecryptionFallback";
        if (tile.Env is null)
        {
            var dir = _store.ProfileDir(tile.Profile);
            if (DrmCleared.Add(dir)) ClearDrmDisable(dir);
        }
        tile.Env ??= await CoreWebView2Environment.CreateWithOptionsAsync(
            null, _store.ProfileDir(tile.Profile), envOptions);

        var view = new WebView2
        {
            DefaultBackgroundColor = Dark,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        tile.ViewHost.Children.Add(view);
        tile.View = view;

        await view.EnsureCoreWebView2Async(tile.Env);
        var core = view.CoreWebView2;
        tile.BrowserPid = core.BrowserProcessId;   // B-152
        SessionMute.Track(tile.BrowserPid);          // B-176: the wall's volume reaches this browser too
        core.Settings.IsStatusBarEnabled = false;
        // the browser's own password manager (2026-10-03, "The password manager ... seems like it could work well"): Chromium remembers a sign-in
        // after the first and offers it next time, encrypted to the Windows account the way Edge does; Prism never sees it. One profile now, so
        // one saved Apple password serves Apple TV and Apple Music.
        core.Settings.IsPasswordAutosaveEnabled = true;
        core.Settings.IsGeneralAutofillEnabled = true;
        // Prism owns page zoom (surface.setViewport). WebView2's own zoom
        // (Ctrl+wheel / Ctrl+plus reaching the page) would silently rescale CSS
        // px against view px and break every layout/region calculation -
        // peacock sat at 110% after one stray Ctrl+wheel (2026-08-31).
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsPinchZoomEnabled = false;
        // B-125 (2026-09-07): a wall never asks a room whether to leave a site. The page's own script dialogs
        // are answered here, not shown: beforeunload (a music page mid-playback raises it on any navigation)
        // is accepted - Prism's navigations are deliberate; alert and confirm are accepted as OK so no page
        // flow stalls on a modal nobody can reach; a prompt has no answer and is cancelled. Each is logged.
        core.Settings.AreDefaultScriptDialogsEnabled = false;
        core.ScriptDialogOpening += (_, e) =>
        {
            var kind = e.Kind;
            if (kind != CoreWebView2ScriptDialogKind.Prompt) e.Accept();
            _onStatus($"script dialog {kind} {(kind == CoreWebView2ScriptDialogKind.Prompt ? "cancelled" : "accepted")}: {tile.Id}");
        };
        core.IsMuted = tile.Muted;                                   // §3 page-invisible mute; a popup inherits its opener's
        _onStatus($"engine {tile.Id}: attached, muted={tile.Muted}, browser {core.BrowserProcessId}");
        // Chromium's own audible signal, muted or not (IsDocumentPlayingAudio stays true under IsMuted): a diagnostic
        // line so a page whose media the bootstrap cannot see still shows as playing in host.log (2026-09-16).
        core.IsDocumentPlayingAudioChanged += (_, __) => _onStatus($"audible {tile.Id}: {core.IsDocumentPlayingAudio} muted={core.IsMuted}");
        ApplyViewport(tile);
        // §26 presentation keeping: element fullscreen is auto-granted (WebView2 fills the surface's rect with
        // the fullscreen element); core learns the state and decides any promotion (B-21).
        core.ContainsFullScreenElementChanged += (_, __) =>
        {
            var contains = core.ContainsFullScreenElement;
            _onStatus($"fullscreen element {(contains ? "entered" : "left")}: {tile.Id}");
            // a fullscreen player sits in the page's top layer, outside the body's fit-to-rect scale: on a page laid out wider than its rect
            // it drew at the layout's size and showed only its top-left - "why is the video so zoomed in", and Hulu's captions, at the
            // player's bottom, fell off the window (2026-09-24). While the player is fullscreen the page is laid out at the rect's own size.
            if (tile.InFullscreen != contains) { tile.InFullscreen = contains; ApplyViewport(tile); }
            if (tile.Shield is { } sh) sh.Visibility = contains && tile.Kind != SurfaceKind.Hidden ? Visibility.Visible : Visibility.Collapsed;   // the stage shield follows the player's fullscreen
            _forwardEvent(tile.Id, JsonSerializer.Serialize(new { type = SurfaceEvents.FullscreenElement, id = tile.Id, contains }));
        };
        if (tile.Kind == SurfaceKind.Popup)
        {
            core.WindowCloseRequested += (_, __) => ClosePopup(tile);                 // the flow closes itself when done
            core.NavigationCompleted += (_, e) => { if (e.IsSuccess) Reveal(tile.Id, 150); };   // a popup's page shows as soon as it painted (§16 substrate until then)
        }
        try
        {
            // §27: locally-served veil imagery - never fetched at render time
            core.SetVirtualHostNameToFolderMapping("prism-art.local",
                Path.Combine(_store.Root, "art"), CoreWebView2HostResourceAccessKind.Allow);
            // docs/concept-scenes.md §6: the first-party micro-facets (chores, timer),
            // served from the app's own Assets/tiles. Zero network by construction -
            // there is nothing in that folder but the pages, their stylesheet, their
            // script and the §24 chime. The engine below attaches to these surfaces
            // exactly as to any other: a Prism page is not an exception (win-host-spec §5).
            core.SetVirtualHostNameToFolderMapping(TilesBridge.HostName, TilesRoot, CoreWebView2HostResourceAccessKind.Allow);
            // The folder mapping serves files, not directories, so the charter's
            // https://tiles.prism/chores/ would 404 on its own. Resolve a trailing
            // slash to that folder's index.html and let everything else fall through.
            core.AddWebResourceRequestedFilter("https://" + TilesBridge.HostName + "/*/", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) => ServeTilesIndex(tile, e);
        }
        catch { }

        await core.AddScriptToExecuteOnDocumentCreatedAsync(TileBootstrapJs);
        // the reading pages play nothing (2026-09-25, "Why was my netflix video black until I just brought focus to the Prism window?"): the hidden
        // work page reading Animal Control's episodes sat on Netflix's show page, whose preview started - and asked PlayReady 3000 for a second
        // hardware-protected session while the screen held one (host.log 15:26:05); the screen's picture went black until the window was redrawn.
        // A page Prism only reads (app:<id>:lookup, app:<id>:work) is refused DRM and has any video paused before it plays, from its first line
        if (tile.Id.EndsWith(":lookup", StringComparison.Ordinal) || tile.Id.EndsWith(":work", StringComparison.Ordinal))
            await core.AddScriptToExecuteOnDocumentCreatedAsync(ReaderQuietJs);

        core.WebMessageReceived += (_, e) =>
        {
            string? json = null;
            try { json = e.TryGetWebMessageAsString(); } catch { }
            if (json is null) return;
            if (TryTap(tile.Id, json)) return;   // a window's tap for a listening phone (SurfaceManager.Tap): the host's, never core's
            if (json.Contains("\"eme\"")) { EmeResult?.Invoke(tile.Id, json); return; }   // diagnostics, not a SurfaceEvent
            if (json.Contains("\"prism-eme\""))                                            // the page's own key-system asks and grants: logged, never core's
            {
                _onStatus("page eme " + tile.Id + ": " + json.Replace("\"type\":\"prism-eme\",", ""));
                return;
            }
            if (json.Contains("\"prism-console\""))                                        // the page's console errors: logged, never core's
            {
                try
                {
                    using var d = JsonDocument.Parse(json);
                    var text = d.RootElement.GetProperty("text").GetString() ?? "";
                    _onStatus("page console " + tile.Id + ": " + text);
                    if (text.Contains("DRM_NO_SUPPORTED_KEY_SYSTEM")) DrmFailed?.Invoke(tile.Id);   // the repair: retried at once (MainWindow)
                }
                catch { }
                return;
            }
            if (json.Contains("\"prism-hostkey\""))                                        // the host's own keys, from a focused page
            {
                try { using var d = JsonDocument.Parse(json); HostKey?.Invoke(d.RootElement.GetProperty("key").GetString() ?? ""); } catch { }
                return;
            }
            // §6 micro-facets: only a page THIS shell serves at tiles.prism may
            // reach the store, and only the two documents TilesBridge names. A
            // third-party page posting the same shape is ignored here.
            if (TilesBridge.TryParse(json) is { } tilesRequest)
            {
                if (TilesBridge.IsTilesOrigin(SourceOf(tile.Id))) TilesRequested?.Invoke(tile.Id, tilesRequest);
                else _onStatus($"tiles bridge refused: {tile.Id} is not a tiles.prism page");
                return;
            }
            // A popup has no document in core's refresh tracker, so its first paint never comes back as a
            // surface.reveal: the host lifts the §16 substrate itself (the sheet stayed dark, 2026-09-16).
            if (tile.Kind == SurfaceKind.Popup && json.Contains("\"first-paint\"")) Fade(tile.Overlay, from: tile.Overlay.Opacity, to: 0, 220);
            if (json.Contains("\"interaction\"")) PageInteraction?.Invoke(tile.Id);   // a tap or a key on the page itself (the stage bar rides it, 2026-09-20)
            if (json.Contains("\"pointer-move\"")) { PageInteraction?.Invoke(tile.Id); return; }   // a pointer moving over the page: the bar, and nothing for core (a move is not the person leaving)
            if (json.Contains("\"ad-break\"") && PageAdBreak(tile.Id, json)) return;
            ForwardWithId(tile.Id, json);
        };
        // The page's own context menu is replaced by Prism's slot menu (tools +
        // slot actions), at the pointer, in window coordinates.
        core.ContextMenuRequested += (_, e) =>
        {
            e.Handled = true;
            try
            {
                var p = view.TransformToVisual(_canvas).TransformPoint(new Windows.Foundation.Point(e.Location.X, e.Location.Y));
                SlotContextMenu?.Invoke(tile.Id, p);
            }
            catch { }
        };
        // Spec 30: a popup is CODE - intercepted unexecuted. v0 blocks and
        // logs the destination host (the ledger + deliberate-open arrive with
        // the Control Center's popup panel); nothing is ever opened silently.
        core.ProcessFailed += (_, e) =>
            _onStatus($"RENDERER FAILED ({tile.Id}): {e.ProcessFailedKind}");
        core.NewWindowRequested += (sender, e) =>
        {
            // Spec 30: a popup is CODE. Core decides (functional sign-in / payment
            // popups, same-site, your allow-list); an allowed one opens as a real
            // child web view in the SAME profile with its opener intact, so Apple's /
            // Google's / Microsoft's sign-in flows complete. Everything else is
            // intercepted unexecuted and logged. Nothing is ever opened silently.
            if (tile.Kind == SurfaceKind.Popup)
            {
                e.Handled = true;                                                     // §30 backstop: no popup chains
                _onStatus($"popup chain intercepted ({tile.Id})");
                return;
            }
            var deferral = e.GetDeferral();
            e.Handled = true;
            _ = HandleNewWindowAsync(tile, core, e, deferral);
        };
        core.NavigationCompleted += async (_, e) =>
        {
            // A navigation superseded by another (a site that redirects on arrival:
            // peacocktv.com → /watch/home) completes as a cancel - not a failed load.
            // The one that replaces it reports its own completion (§16 readiness).
            if (!e.IsSuccess && e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
            // a fresh document: the in-page half of zoom-out first, so core's
            // framing (injected on load-finished) composes with it
            if (tile.LayoutOverride) { try { await core.ExecuteScriptAsync(BodyZoomJs(LayoutOf(tile.Id).Fit)); } catch { } }
            if (tile.HiddenPresence) await DecorAsync(tile, true);   // a fresh document on a hidden surface: its decorative loops paused (2026-10-03)
            _forwardEvent(tile.Id, JsonSerializer.Serialize(new { type = SurfaceEvents.LoadFinished, id = tile.Id, ok = e.IsSuccess }));
        };
        core.SourceChanged += (_, __) =>
        {
            _forwardEvent(tile.Id, JsonSerializer.Serialize(new { type = SurfaceEvents.Navigated, id = tile.Id, url = core.Source }));
            try { SourceChanged?.Invoke(tile.Id, core.Source); } catch { }
        };
    }

    /// <summary>The page a tile shows moved (full or same-document navigation) - the configure dock keeps its address box in step.</summary>
    public event Action<string, string>? SourceChanged;

    public void Navigate(string id, string url)
    {
        // §6 micro-facets: a tiles.prism directory URL loads its index.html (the folder mapping serves files only).
        if (Get(id) is { } t && t.View?.CoreWebView2 is { } core) { _ = WakeAsync(t); core.Navigate(TilesBridge.DocumentUrl(url)); }
    }

    // ---- readers dark (2026-10-03, "How can you avoid burning gpu with those background pages"): a hidden reader page - a service's lookup or
    // work page, kind "hidden" - that nothing has touched for a while is frozen in place through Chromium's page lifecycle (scripts, timers,
    // animation and media stop; the layout stands, so the page keeps the shape the adapters read), and woken before any script, navigation or
    // pointer reaches it. The music player's hidden presence is a slot facet, not a reader: untouched. Behind a switch, off until measured.
    public bool ReadersDark { get; set; }
    public static readonly TimeSpan ReaderIdle = TimeSpan.FromSeconds(90);
    // a reader is core's own page for a service ("app:<service>:lookup", "app:<service>:work", "app:prism-scores:work"); a music player's facet
    // is kind "hidden" too and plays while hidden - never a reader
    private bool IsReader(Tile t) => t.Kind == SurfaceKind.Hidden && t.Id.StartsWith("app:", StringComparison.Ordinal);
    // a music player's hidden facet (2026-10-03, the one browser's split: Apple Music 430 MB, Spotify 216, Amazon 160, Pandora 147 idle): parked
    // the same way once it has not played and nothing has touched it for ten minutes - a pick wakes it before the first script reaches it
    private bool IsMusicFacet(Tile t) => t.Kind == SurfaceKind.Hidden && !t.Id.StartsWith("app:", StringComparison.Ordinal);
    public static readonly TimeSpan MusicIdle = TimeSpan.FromMinutes(10);
    /// <summary>A page that may be frozen while idle: a reader, or a music facet that is not playing.</summary>
    private bool IsParkable(Tile t) => IsReader(t) || IsMusicFacet(t);
    /// <summary>A reader about to be used: its page active again (a frozen page answers no script).</summary>
    private async Task WakeAsync(Tile t)
    {
        t.LastTouched = DateTime.UtcNow;
        if (!t.Dozing) return;
        t.Dozing = false;
        try
        {
            if (t.View?.CoreWebView2 is { } core) await core.CallDevToolsProtocolMethodAsync("Page.setWebLifecycleState", "{\"state\":\"active\"}");
            _onStatus("reader woke: " + t.Id);
            // a music page's player needs a moment after the thaw before a play lands (2026-10-04: the first play after a wake did nothing)
            if (IsMusicFacet(t)) await Task.Delay(400);
        }
        catch (Exception ex) { _onStatus("reader wake " + t.Id + ": " + ex.Message); }
    }
    /// <summary>Every idle reader frozen (called on a timer while the switch is on); with the switch off, every dozing reader woken.</summary>
    public async Task DozeIdleReadersAsync()
    {
        foreach (var t in _tiles.Values.ToArray())
        {
            if (!IsParkable(t) || t.View?.CoreWebView2 is not { } core) continue;
            if (!ReadersDark) { if (t.Dozing) await WakeAsync(t); continue; }
            if (t.Dozing) continue;
            var music = IsMusicFacet(t);
            if (music && (t.NpPlaying || DateTime.UtcNow - t.LastTouched < MusicIdle)) continue;
            if (!music && DateTime.UtcNow - t.LastTouched < ReaderIdle) continue;
            try { await core.CallDevToolsProtocolMethodAsync("Page.setWebLifecycleState", "{\"state\":\"frozen\"}"); t.Dozing = true; _onStatus((music ? "music parked: " : "reader dozing: ") + t.Id); }
            catch (Exception ex) { _onStatus("reader doze " + t.Id + ": " + ex.Message); }
        }
    }
    /// <summary>How many readers doze now (perf.log).</summary>
    public int DozingCount => _tiles.Values.Count(t => t.Dozing);
    /// <summary>A music page reporting playing right now (the Quick play choice "after this track" needs one).</summary>
    public bool AnyMusicPlaying() => _tiles.Values.Any(t => IsMusicFacet(t) && t.NpPlaying);

    public async Task InjectAsync(string id, string? css, string? js)
    {
        var tile = Get(id);
        if (tile?.View?.CoreWebView2 is not { } core) return;
        if (IsParkable(tile)) await WakeAsync(tile);
        if (css is not null)
        {
            tile.InjectedCss = css;
            var styleJs = "(function(){var s=document.getElementById('__prism-style')||document.createElement('style');" +
                          "s.id='__prism-style';s.textContent=" + JsonSerializer.Serialize(css) + ";" +
                          "(document.head||document.documentElement).appendChild(s);})();";
            await core.ExecuteScriptAsync(styleJs);
            await KeepCssAtDocumentStartAsync(tile, core, css);
        }
        if (js is not null)
        {
            // execute NOW only - re-injection on SPA navigation is core's call
            // (spec 5/23); persisting every inject piled one-shot pause
            // injections onto reloads and overwrote adapter payloads
            tile.InjectedJs = js;
            await core.ExecuteScriptAsync(js);
        }
    }

    /// <summary>
    /// The adapter's CSS from a page's first line (2026-10-07, "Still saw youtube pages on windows 2, 4, 5 while loading"): core injects it
    /// once a page has painted, and YouTube TV loads a whole new page for /live and again for /watch after the window was revealed - each
    /// drew its guide for a few hundred milliseconds before the CSS came. The CSS core last sent is kept as a document-created script, so
    /// every new page of the same site has it before it draws; a page on another site (a sign-in) never gets it. Core's own inject still
    /// fills the same style element, so nothing is doubled.
    /// </summary>
    private async Task KeepCssAtDocumentStartAsync(Tile tile, CoreWebView2 core, string css)
    {
        string host;
        try { host = new Uri(core.Source).Host; } catch { return; }
        var key = host + "\n" + css;
        if (tile.DocCssKey == key) return;
        tile.DocCssKey = key;
        if (tile.DocCssScriptId is { } old) { try { core.RemoveScriptToExecuteOnDocumentCreated(old); } catch { } tile.DocCssScriptId = null; }
        var js = "(function(){try{if(location.hostname!==" + JsonSerializer.Serialize(host) + ")return;var css=" + JsonSerializer.Serialize(css) + ";" +
                 "function put(){var r=document.head||document.documentElement;if(!r)return false;var s=document.getElementById('__prism-style')||document.createElement('style');" +
                 "s.id='__prism-style';s.textContent=css;if(!s.parentNode)r.appendChild(s);return true;}" +
                 "if(!put())document.addEventListener('readystatechange',function f(){if(put())document.removeEventListener('readystatechange',f);});}catch(e){}})();";
        try { tile.DocCssScriptId = await core.AddScriptToExecuteOnDocumentCreatedAsync(js); } catch { }
    }

    /// <summary>
    /// §25 <c>surface.setPeek</c>: core brackets one living-preview revival.
    /// The host does not schedule peeks - it only keeps §16 across this one:
    /// the still stays up (Resume already raises the overlay) and a freeze
    /// that arrives before the peek's reveal keeps the last still instead of
    /// capturing a half-loaded page. A second concurrent peek is refused and
    /// reported: peak cost is exactly one extra renderer (§18).
    /// </summary>
    public void SetPeek(string id, bool peeking)
    {
        if (!peeking) { _peek.End(id); return; }
        if (_peek.Begin(id)) { _onStatus($"peek {id}: revive → capture → demote (muted, still held)"); return; }
        _onStatus($"peek {id} refused: {_peek.Peeking} is already peeking (§18: one extra renderer, never two)");
    }

    private readonly PeekState _peek = new();

    /// <summary>§25: the surface currently mid-peek, for state/diagnostics.</summary>
    public string? PeekingSurface => _peek.Peeking;

    public async Task FreezeAsync(string id)
    {
        var tile = Get(id);
        if (tile is null || !Persistable(tile)) return;
        if (!_peek.MayReplaceStill(id))
        {
            // §25 PEEK_TIMEOUT_MS abort: the revival never reached readiness,
            // so there is nothing worth showing - keep the last still (§16).
            _onStatus($"peek {id} aborted before readiness - keeping the last still");
            TrySetImage(tile.SnapImage, _store.SnapshotPath(id));
            tile.Overlay.Opacity = 1;
            return;
        }
        if (tile.View?.CoreWebView2 is { } core)
        {
            try
            {
                using var mem = new InMemoryRandomAccessStream();
                await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, mem);
                mem.Seek(0);
                if (await LooksBlackAsync(mem) && File.Exists(_store.SnapshotPath(id)))
                {
                    _onStatus($"freeze {id}: DRM-black capture — keeping last good snapshot");
                }
                else
                {
                    mem.Seek(0);
                    using var file = File.Create(_store.SnapshotPath(id));
                    await mem.AsStreamForRead().CopyToAsync(file);
                }
            }
            catch (Exception ex) { _onStatus($"freeze {id} capture failed: {ex.Message}"); }
        }
        TrySetImage(tile.SnapImage, _store.SnapshotPath(id));
        tile.Overlay.Opacity = 1;                                     // frozen pixels shown instantly
        _bootCache[id] = (tile.Rect, _store.SnapshotPath(id));
        SaveBootCache();
    }

    public void Reveal(string id, double durationMs)
    {
        var tile = Get(id);
        if (tile is null) return;
        if (tile.Dozing) _ = WakeAsync(tile);   // a parked page about to be seen is live first
        _peek.NoteReveal(id);        // §25: fresh pixels reached readiness - this peek's capture is legitimate
        Fade(tile.Overlay, from: tile.Overlay.Opacity, to: 0, durationMs);
    }

    /// <summary>Kinds whose pixels belong in the boot cache / snapshot store (§18): popups, hidden and
    /// visualization surfaces are never a "last dashboard" picture.</summary>
    private static bool Persistable(Tile t) => t.Kind is SurfaceKind.Slot or SurfaceKind.Floating;

    public void Suspend(string id)
    {
        ClosePopupsOf(id);                                            // a popup never outlives its opener's renderer
        var tile = Get(id);
        if (tile?.View is not { } view) return;                       // core called freeze first — pixels are up
        tile.ViewHost.Children.Remove(view);
        try { view.Close(); } catch { }
        tile.View = null;
    }

    public async Task ResumeAsync(string id)
    {
        var tile = Get(id);
        if (tile is null || tile.View is not null) return;
        tile.Overlay.Opacity = 1;
        await AttachEngineAsync(tile);                                // same profile, same env (§10)
    }

    /// <summary>B-152: hidden music sources are muted at their audio session so the stage's loopback still hears them; the WebView2 mute is the fallback.</summary>
    /// <summary>Constructed in the constructor so its diagnostics reach host.log through _onStatus (they were dropped - a no-op logger - until 2026-09-13: no way to see what level the soundscape's session was set to).</summary>
    public Services.Audio.SessionMuter SessionMute { get; }

    /// <summary>The shared browser's process (private listening captures its sound): the screen's when it has one, else any page's; 0 with none.</summary>
    public uint AnyBrowserPid()
    {
        var screen = _tiles.Values.FirstOrDefault(t => t.Kind != SurfaceKind.Hidden && t.BrowserPid > 0);
        return screen?.BrowserPid ?? _tiles.Values.FirstOrDefault(t => t.BrowserPid > 0)?.BrowserPid ?? 0;
    }

    /// <summary>B-176: the wall's one volume - every page's Windows audio session sits at this level (the mute's duck stays below it).</summary>
    public double WallVolume => SessionMute.Volume;
    public void SetWallVolume(double v)
    {
        SessionMute.Volume = (float)v;
        if (PrivateVolume(v)) return;   // a phone listens: the device's volume (the sessions stay at full level for the loopback)
        foreach (var t in _tiles.Values.ToArray()) if (t.BrowserPid > 0) SessionMute.Track(t.BrowserPid);
    }

    public void SetMuted(string id, bool muted)
    {
        var tile = Get(id);
        if (tile is null) return;
        if (!muted && !_private) _soundTile = id;   // the window given the sound (the one page a phone will hear)
        if (PrivateMute(tile, muted)) return;   // a phone listens: the device's mute, the page left audible for it (SurfaceManager.PrivateListening)
        tile.Muted = muted;
        if (tile.View?.CoreWebView2 is { } core)
        {
            // B-199 (2026-09-14): a soundscape surface is muted at its own WebView2 only. Every soundscape shares the
            // prism-ambient profile's one browser process, so the session duck below is process-wide: restoring one
            // soundscape restored them all (Pandora's bees came back under Spotify's river). The loopback need not
            // hear a soundscape, so nothing is lost.
            // B-256 (2026-09-21): the session duck is process-wide, and a hidden SEARCH / LIST surface (app:<id>:lookup) shares
            // its service's profile - and so its browser process - with the screen playing that service (an App preview surface app:<id>:preview the same): ducking it had
            // silenced the episode ("no sound", the screen's session born at volume 0.001). Those surfaces play nothing the
            // stage must hear, so the WebView2 mute alone keeps them quiet, like a soundscape.
            // 2026-10-04: the session duck is gone. It was process-wide, and every service now shares ONE browser process (one browser, many
            // sign-ins), so muting Spotify's parked page ducked Apple Music's session beside it - the room and the phone both went silent.
            // A hidden music page is muted at its own WebView2 alone, like a soundscape; the visualizer hears what the room hears.
            if (false && tile.Kind == SurfaceKind.Hidden && tile.BrowserPid > 0 && !id.StartsWith("ambient:", StringComparison.Ordinal) && !id.EndsWith(":lookup", StringComparison.Ordinal) && !id.EndsWith(":work", StringComparison.Ordinal))
            {
                core.IsMuted = muted;
            }
            else core.IsMuted = muted;
            _onStatus($"mute {id}: IsMuted now {core.IsMuted}");
        }
        else _onStatus($"mute {id}: recorded {muted} (no engine yet)");
        foreach (var pt in PopupTiles.Where(t => t.Opener == id))     // §3: a popup is audibly part of its opener
        {
            pt.Muted = muted;
            if (pt.View?.CoreWebView2 is { } pc) pc.IsMuted = muted;
        }
    }

    // ---------------------------------------------------------------- the picture-in-picture corner (2026-09-21)
    // "While Watch is up, can we keep a mini PIP window of what is playing on the screen in the top right corner?" - the
    // screen's surface itself, moved and shrunk into the corner (its page and its player untouched, audio on), raised above the
    // other tiles, and put back where it was when the menu closes. A rect or z core sets meanwhile is kept for the return.
    private readonly Dictionary<string, (ChannelRect rect, int z, (double W, double H)? viewport)> _pip = new();
    /// <summary>The reading pages' first line: no DRM sessions, and no video playing (see where it is added). Prism's own browser views only.
    /// window.__prismReading marks the page as one no person sees (2026-10-06): an adapter may scroll it to load what it reads (YouTube TV's lazy shelf pictures).</summary>
    private const string ReaderQuietJs = "(function(){try{window.__prismReading=true;var no=function(n){return Promise.reject(new DOMException(\"a reading page plays nothing\",n));};try{Object.defineProperty(Navigator.prototype,\"requestMediaKeySystemAccess\",{value:function(){return no(\"NotSupportedError\");},configurable:false,writable:false});}catch(e){}var P=HTMLMediaElement.prototype;try{Object.defineProperty(P,\"play\",{value:function(){try{this.muted=true;this.pause();}catch(e){}return no(\"NotAllowedError\");},configurable:false,writable:false});}catch(e){}document.addEventListener(\"play\",function(e){try{var m=e.target;m.muted=true;m.pause();}catch(x){}},true);}catch(e){}})();";

    public void BeginPip(string id, ChannelRect corner)
    {
        if (Get(id) is not { } t) return;
        if (!_pip.ContainsKey(id)) _pip[id] = (t.Rect, Canvas.GetZIndex(t.Container), t.Viewport);
        // the page keeps its full size in Watch's corner and is only drawn smaller (2026-09-23, "any time I go into watch and come back, it goes
        // down" to 480p): a player sizes its stream to its window - Peacock's fell to 540p for the corner and climbed back slowly
        // ... at the corner's own shape, as large as fits the canvas (2026-09-23, "the mini window in paramount on the watch screen shows an incredible
        // zoomed in unintelligeble video"): the full width at a 16:9 corner was taller than the wall, so the fit fell to the in-page body scale,
        // which Paramount+'s fixed-position player ignores - its video drew at full size inside the corner. Fitting the canvas keeps the plain XAML scale.
        // ... and every screen in Watch at the wall's own size, whatever its size on the wall (2026-09-25, "Captions are gigantic on the tiny screens
        // in Watch"): a small window's page had kept its small layout, where a service's captions keep their least size, and was drawn smaller
        // again. Laid out large and drawn small, the captions keep their proportion; the window's own layout comes back when Watch closes
        if (corner.H > 0 && corner.W > 0)
        {
            var aspect = corner.W / corner.H;
            var ch = Math.Max(1, _canvas.ActualHeight); var cw = Math.Max(1, _canvas.ActualWidth);
            var w = Math.Min(cw, Math.Floor(ch * aspect));
            t.Viewport = (w, Math.Floor(w / aspect));
        }
        ApplyRect(t, corner);
        Canvas.SetZIndex(t.Container, 910);
        SyncBreakCard(t);
        SyncCornerX(t);
    }
    public void EndPip(string id)
    {
        if (!_pip.Remove(id, out var was) || Get(id) is not { } t) return;
        t.Viewport = was.viewport;
        ApplyRect(t, was.rect);
        Canvas.SetZIndex(t.Container, was.z);
        SyncBreakCard(t);
        SyncCornerX(t);
    }
    public bool InPip(string id) => _pip.ContainsKey(id);

    /// <summary>The window's break is the Video player's (the host answers): Watch in place of Fill slot and Minimize.</summary>
    public Func<string, bool>? BreakWatchFor;
    /// <summary>Watch / Return to video pressed on a break (or the break tapped in Watch's corner).</summary>
    public event Action<string>? BreakWatchPressed;
    /// <summary>The person said the break watch's cover is wrong (the card's Not an ad).</summary>
    public event Action<string>? NotAnAdPressed;
    private readonly Dictionary<string, Button> _notAdButtons = new();
    /// <summary>The card's Not an ad, shown while the break watch's own cover is up.</summary>
    public void SetNotAnAd(string id, bool on)
    {
        if (on) _notAdWanted.Add(id); else _notAdWanted.Remove(id);   // the cover may be built after the call: applied when it is
        var v = on ? Visibility.Visible : Visibility.Collapsed;
        if (_notAdButtons.TryGetValue(id, out var b)) b.Visibility = v;
        if (_notAdPills.TryGetValue(id, out var pill)) pill.Visibility = v;
        if (_mutedStrips.TryGetValue(id, out var ms)) ms.NotAd.Visibility = v;
    }
    private readonly HashSet<string> _notAdWanted = new();
    private readonly Dictionary<string, Button> _notAdPills = new();
    private static readonly SolidColorBrush ClearHit = new(Windows.UI.Color.FromArgb(0, 0, 0, 0));
    private void SyncBreakCard(Tile t)
    {
        if (t.Intermission is null) return;
        var vp = BreakWatchFor?.Invoke(t.Id) == true;
        var corner = _pip.ContainsKey(t.Id);
        if (t.FillChip is { } f) f.Visibility = vp ? Visibility.Collapsed : Visibility.Visible;
        if (t.MinimalChip is { } m) m.Visibility = Visibility.Visible;
        // 2026-09-23 ("Can we take Watch off of the intermission banner? Since it's available in the controls"): the card no longer offers Watch;
        // with Watch open and the screen in its corner it still offers the way back, Return to video
        if (t.WatchChip is { } w) { w.Visibility = vp && corner ? Visibility.Visible : Visibility.Collapsed; w.Content = "Return to video"; }
        // 2026-09-23 ("Can we collapse the intermission banner into the intermission icon? Let them click to expand it. Leave it expanded for as
        // long as that ad is up. Otherwise default to collapsed when an ad comes up"): the Video player's breaks start collapsed (ShowIntermission)
        t.Intermission.Background = vp && corner ? ClearHit : null;   // hits pass through to the page, except in the corner
    }

    public void SetRect(string id, ChannelRect rect)
    {
        var tile = Get(id);
        if (tile is null) return;
        if (tile.Dozing && tile.Kind != SurfaceKind.Hidden) _ = WakeAsync(tile);
        if (_pip.TryGetValue(id, out var pip)) _pip[id] = (rect, pip.z, pip.viewport);   // in the corner: the wall's rect waits for the return
        else ApplyRect(tile, rect);
        if (!Persistable(tile)) return;
        if (_bootCache.TryGetValue(id, out var e)) _bootCache[id] = (rect, e.snap);
        else _bootCache[id] = (rect, _store.SnapshotPath(id));
        SaveBootCache();
    }

    public void SetOpacity(string id, double opacity) { if (Get(id) is { } t) t.Container.Opacity = opacity; }
    public void SetZ(string id, double z) { if (_pip.TryGetValue(id, out var pip)) { _pip[id] = (pip.rect, (int)z, pip.viewport); return; } if (Get(id) is { } t) Canvas.SetZIndex(t.Container, (int)z); }

    public void Destroy(string id)
    {
        // The boot cache is presentation only (never §10 data): a destroyed
        // tile's snapshot must not repaint at the next launch as a ghost of a
        // dashboard that no longer exists (the lingering hulu strip, 2026-08-31).
        if (_bootCache.Remove(id))
        {
            SaveBootCache();
            try { File.Delete(_store.SnapshotPath(id)); } catch { }
        }
        ClosePopupsOf(id);                                            // popups close with their opener (B-22)
        _pip.Remove(id);
        if (!_tiles.Remove(id, out var tile)) return;
        if (tile.Kind == SurfaceKind.Popup) { ClosePopup(tile); return; }
        tile.Viz?.Dispose();
        try { tile.View?.Close(); } catch { }
        _canvas.Children.Remove(tile.Container);
    }

    // ------------------------------------------------------- §32 presence
    /// <summary>surface.setPresence: "hidden" parks the surface off-canvas at full size (audio and the
    /// page's own player keep running - the renderer is never touched); "panel" / "hero" bring it onto
    /// the wall at rect with a §16 fade. The surface is resized and moved, never recreated.</summary>
    public void SetPresence(string id, string presence, ChannelRect rect, double durationMs)
    {
        var t = Get(id);
        if (t is null) return;
        if (presence == "hidden")
        {
            ClosePopupsOf(id);                                        // an app collapsing to the background takes its sheet with it (the orphaned sheet after Done, 2026-09-16)
            Fade(t.Container, t.Container.Opacity, 0, durationMs);
            var timer = _canvas.DispatcherQueue.CreateTimer();
            timer.Interval = TimeSpan.FromMilliseconds(Math.Max(0, durationMs));
            timer.IsRepeating = false;
            timer.Tick += (_, __) => { PlaceHidden(t, true); t.Container.Opacity = 1; t.Pinned = false; if (t.FloatBar is not null) t.FloatBar.Visibility = Visibility.Visible; };
            timer.Start();
            _onStatus($"presence {id}: hidden");
            return;
        }
        t.Container.Opacity = 0;
        t.Pinned = presence == "window";   // B-159
        // B-167 (2026-09-08): the inline app window carries Prism's own bar above it - the floating title bar (drag handle, face,
        // dock, hide) only took space over the page's top, so it stays out; the corner grip still resizes
        if (t.FloatBar is not null) t.FloatBar.Visibility = t.Pinned ? Visibility.Collapsed : Visibility.Visible;
        PlaceHidden(t, false);
        ApplyRect(t, rect);
        Fade(t.Container, 0, 1, durationMs);
        _onStatus($"presence {id}: {presence} at {rect.W:0}x{rect.H:0}");
    }

    /// <summary>Hidden presence = the container keeps its rect but sits left of the canvas. Measured
    /// (targets/win-poc-music --hidden-test, 2026-09-01): a Collapsed / 0x0 WebView2 flips the document to
    /// visibilityState "hidden" and Chromium pauses muted-element media there; an off-canvas surface stays
    /// "visible" and every variant keeps advancing at 1.0x.</summary>
    private void PlaceHidden(Tile t, bool hidden)
    {
        var was = t.HiddenPresence;
        t.HiddenPresence = hidden;
        t.Container.Visibility = Visibility.Visible;
        ApplyRect(t, t.Rect);
        if (was != hidden) _ = DecorAsync(t, hidden);
    }

    /// <summary>
    /// Decorative video on a surface nobody sees (2026-10-03, "How can you avoid burning gpu with those background pages"): Apple Music's home
    /// page loops two muted animated-artwork videos, one 1662 by 2216 pixels, while parked hidden under the Video player - its profile's GPU
    /// process decoding at 13% for nobody. A page action: on a surface entering hidden presence every muted, looping video is paused, new
    /// ones too as they appear (a mutation observer and the play event); on its way back to the screen the ones Prism paused play again.
    /// Sound is never touched: a video with its sound on is the surface's own business (the music player's hidden presence plays).
    /// </summary>
    private const string DecorJs = "(function(on){var W=window;if(!W.__prismDecor){W.__prismDecor=function(on){W.__prismDecorOn=on;var vs=document.querySelectorAll('video');for(var i=0;i<vs.length;i++){var v=vs[i];try{if(on){if(v.muted&&v.loop&&!v.paused){v.pause();v.__prismDecorPaused=true;}}else if(v.__prismDecorPaused){v.__prismDecorPaused=false;var p=v.play();if(p&&p.catch)p.catch(function(){});}}catch(e){}}};document.addEventListener('play',function(e){var v=e.target;if(W.__prismDecorOn&&v&&v.tagName==='VIDEO'&&v.muted&&v.loop){try{v.pause();v.__prismDecorPaused=true;}catch(e2){}}},true);try{new MutationObserver(function(){if(W.__prismDecorOn)W.__prismDecor(true);}).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}}W.__prismDecor(on);return document.querySelectorAll('video').length;})(";
    private async Task DecorAsync(Tile t, bool hidden)
    {
        try
        {
            if (t.View?.CoreWebView2 is not { } core) return;
            var n = await core.ExecuteScriptAsync(DecorJs + (hidden ? "true" : "false") + ")");
            if (hidden && n != "0") _onStatus("decor paused on hidden " + t.Id + " (" + n + " video element(s))");
        }
        catch (Exception ex) { _onStatus("decor " + t.Id + ": " + ex.Message); }
    }

    // ------------------------------------------------------- intermission
    // Spec 26 rendering, host-owned (win-host-spec 5): full-bleed art (or the
    // dark substrate when no art is cached) ABOVE the tile, hit-testing
    // passing through everywhere except the Skip chip. Core decides WHEN
    // (cover-slow / uncover-fast / safety timeout live in core, not here).
    public void ShowIntermission(string id, string source, string? look = null)
    {
        var tile = Get(id);
        if (tile is null) return;
        tile.Look = look is "mute" or "show" ? look : "veil";
        if (tile.Kind == SurfaceKind.Hidden)
        {
            // win-host-spec §5 hidden facets: no visual surface, so intermission is AUDIO intermission - core
            // already muted the surface page-invisibly on the break signal (cover-slow) and unmutes on the end
            // signal (uncover-fast); ambient soundscapes are opt-in and ship with the §26 packs (none bundled yet).
            tile.Covered = true;
            _onStatus($"audio intermission: {id} (muted by core; no scenery on a hidden surface)");
            CoverageChanged?.Invoke();
            return;
        }
        if (tile.Intermission is null)
        {
            var g = new Grid { Opacity = 0 };                       // Background null: hits pass through
            // The veil ground in FOUR slabs so a real cutout can expose the
            // player's own Skip button (spec 26: the hole is the skip path -
            // extension parity, video.js cuts the same hole with clip-path).
            var subSlabs = new Border[4];
            var artSlabs = new Image[4];
            for (var si = 0; si < 4; si++)
            {
                subSlabs[si] = new Border { Background = new SolidColorBrush(Dark), IsHitTestVisible = false };
                artSlabs[si] = new Image { Stretch = Stretch.UniformToFill, IsHitTestVisible = false };
                if (si > 0)
                {
                    subSlabs[si].Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, 0, 0) };
                    artSlabs[si].Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, 0, 0) };
                }
            }
            var art = artSlabs[0];
            // The HUD is the extension's card (video.js buildCover), not
            // corner chips: one centered panel - glyph + title, the promise
            // line, the break clock, then the actions - on a translucent
            // dark rounded ground so it reads over any art (WCAG AA).
            var amber = Windows.UI.Color.FromArgb(255, 0xF0, 0xA8, 0x3C);
            var ink = Windows.UI.Color.FromArgb(255, 0x0A, 0x0C, 0x0F);
            var bright = Windows.UI.Color.FromArgb(255, 0xD7, 0xDC, 0xE3);
            var dim = Windows.UI.Color.FromArgb(255, 0x9A, 0xA4, 0xB2);
            var caption = new TextBlock
            {
                Text = "◐  Intermission",
                FontSize = 26,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                Foreground = new SolidColorBrush(amber),
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
            };
            var sub = new TextBlock
            {
                Text = "Your show returns after the break",
                FontSize = 15,
                Foreground = new SolidColorBrush(bright),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 6, 0, 0),
            };
            var time = new TextBlock
            {
                FontSize = 18,
                Foreground = new SolidColorBrush(bright),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 10, 0, 0),
                Visibility = Visibility.Collapsed,
            };
            var count = new TextBlock
            {
                FontSize = 14,
                Foreground = new SolidColorBrush(dim),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 4, 0, 0),
                Visibility = Visibility.Collapsed,
            };
            var skip = new Button
            {
                Content = "Skip ▸",
                Visibility = Visibility.Collapsed,
                Padding = new Thickness(20, 9, 20, 9),
                CornerRadius = new CornerRadius(9),
                Background = new SolidColorBrush(amber),
                Foreground = new SolidColorBrush(ink),
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                BorderThickness = new Thickness(0),
            };
            // A HUMAN tap on the chip is the only thing that ever reaches the
            // player's own skip control - core forwards it (spec 26).
            skip.Click += (_, __) => _forwardEvent(tile.Id,
                JsonSerializer.Serialize(new { type = SurfaceEvents.IntermissionSkip, id = tile.Id }));
            Button Outline(string label)
            {
                return new Button
                {
                    Content = label,
                    Padding = new Thickness(16, 8, 16, 8),
                    CornerRadius = new CornerRadius(9),
                    Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)),
                    Foreground = new SolidColorBrush(amber),
                    BorderBrush = new SolidColorBrush(amber),
                    BorderThickness = new Thickness(1.5),
                    FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                };
            }
            // Spec 26 peek-through, the agency guarantee: nothing is ever
            // unreachable. Timeboxed - counts down and re-veils itself.
            var peek = Outline("Show ad 15s");
            peek.Click += (_, __) => TogglePeek(tile.Id);
            // Slot-to-window fullscreen reachable on the card itself.
            // Fill slot: the player's OWN fullscreen control - WebView2
            // contains the fullscreen element to the tile, so the video
            // fills its slot. Full Screen: the tile across the entire
            // monitor (window presenter goes fullscreen too).
            var fillSlot = Outline("Fill slot");
            fillSlot.Click += (_, __) => _ = RequestPlayerFullscreenAsync(tile.Id);
            // No "Full Screen" on the veil: the veil stays the size of its slot.
            // The whole-monitor take-over lives on the slot menu (Full Screen),
            // where it is a deliberate choice about the slot, not the break.
            // Spec 26 "card minimize": one tap collapses the card to its corner
            // chip so the artwork breathes full-bleed; the attribution collapses
            // WITH it (to the credit alone) - it never disappears.
            var minimal = Outline("Minimize");
            minimal.Click += (_, __) => ToggleCardMinimal(tile.Id);
            // The Video player's break (2026-09-23, "Fill slot, makes no sense, remove it. Minimize also makes no sense ... Maybe a watch
            // button would be good here ... add a return to video button where the watch button was"): the screen already fills the
            // player, so Fill slot and Minimize give way to Watch - and, with Watch open and the screen in its corner, Return to video.
            var watch = Outline("Watch");
            watch.Visibility = Visibility.Collapsed;
            watch.Click += (_, __) => BreakWatchPressed?.Invoke(tile.Id);
            var actions = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 10,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 14, 0, 0),
            };
            actions.Children.Add(skip);
            actions.Children.Add(peek);
            actions.Children.Add(fillSlot);
            actions.Children.Add(minimal);
            actions.Children.Add(watch);
            // the break watch's own cover (YouTube TV, read off the picture) can be wrong: "Not an ad" lifts it and tells the watch (2026-10-06,
            // "Interrupting or blocking a live show makes me very nervous")
            var notAd = Outline("Not an ad");
            notAd.Visibility = _notAdWanted.Contains(tile.Id) ? Visibility.Visible : Visibility.Collapsed;
            notAd.Click += (_, __) => NotAnAdPressed?.Invoke(tile.Id);
            _notAdButtons[tile.Id] = notAd;
            actions.Children.Add(notAd);
            // Concept-scenes 3.2, the card corner: what this picture is, who made
            // it, who holds it and under what licence - every word out of the
            // local pack manifest (spec 19/22: attribution never reaches the network).
            var artLine = new TextBlock
            {
                FontSize = 11,
                Foreground = new SolidColorBrush(dim),
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 14, 0, 0),
                Visibility = Visibility.Collapsed,
                IsTextSelectionEnabled = true,
            };
            var stack = new StackPanel();
            stack.Children.Add(caption);
            stack.Children.Add(sub);
            stack.Children.Add(time);
            stack.Children.Add(count);
            stack.Children.Add(actions);
            stack.Children.Add(artLine);
            var card = new Border
            {
                Child = stack,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                CornerRadius = new CornerRadius(16),
                Padding = new Thickness(28, 18, 28, 18),
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x8c, 0x0A, 0x0C, 0x0F)),
                MaxWidth = 460,
            };
            foreach (var sb in subSlabs) g.Children.Add(sb);
            foreach (var im in artSlabs) g.Children.Add(im);
            var ring = new Border
            {
                BorderBrush = new SolidColorBrush(amber),
                BorderThickness = new Thickness(2),
                CornerRadius = new CornerRadius(8),
                IsHitTestVisible = false,
                Visibility = Visibility.Collapsed,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
            };
            g.Children.Add(ring);
            g.Children.Add(card);
            // The minimal-mode corner chip: the credit alone, and a tap to bring
            // the card back. Nothing about the image is ever hidden entirely.
            var artChip = new TextBlock
            {
                FontSize = 11,
                Foreground = new SolidColorBrush(bright),
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxWidth = 420,
            };
            var chipHost = new Border
            {
                Child = artChip,
                // collapsed, the card is its icon in the top-left corner, the mark in its gold (2026-09-23, "I prefer the intermission icon to keep
                // its gold color and to be displayed when collapsed in the top left corner")
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(14, 12, 0, 0),
                Padding = new Thickness(10, 5, 10, 5),
                CornerRadius = new CornerRadius(8),
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x8c, 0x0A, 0x0C, 0x0F)),
                Visibility = Visibility.Collapsed,
            };
            chipHost.Tapped += (_, e) => { e.Handled = true; ToggleCardMinimal(tile.Id); };
            g.Children.Add(chipHost);
            // Not an ad on the cover itself, in its bottom-left corner (2026-10-07, "So where is this button? I have full screen and no sign of
            // it" / "I should see it for each of the small windows too"): the card collapses to its icon on the Video player, so the card's own
            // button was out of sight; this one shows whenever the break watch put the cover up, on every window
            var notAdPill = new Button
            {
                Content = new TextBlock { Text = "Not an ad", FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(ink) },
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(12, 0, 0, 12),
                Padding = new Thickness(12, 6, 12, 6),
                CornerRadius = new CornerRadius(8),
                Background = new SolidColorBrush(amber),
                BorderThickness = new Thickness(0),
                Visibility = _notAdWanted.Contains(tile.Id) ? Visibility.Visible : Visibility.Collapsed,
            };
            MainWindow.OwnHover(notAdPill);
            ToolTipService.SetToolTip(notAdPill, "This is the show, not an ad: uncover it, and tell Prism it got this wrong");
            notAdPill.Click += (_, __) => NotAnAdPressed?.Invoke(tile.Id);
            _notAdPills[tile.Id] = notAdPill;
            g.Children.Add(notAdPill);
            tile.Container.Children.Add(g);                          // above snapshot overlay
            tile.Intermission = g;
            tile.IntermissionArt = art;
            tile.SkipChip = skip;
            tile.PeekChip = peek;
            tile.Caption = time;
            tile.CountText = count;
            tile.SubSlabs = subSlabs;
            tile.ArtSlabs = artSlabs;
            tile.SkipRing = ring;
            tile.ArtLine = artLine;
            tile.ArtChip = artChip;
            tile.MinimalChip = minimal;
            tile.FillChip = fillSlot;
            tile.WatchChip = watch;
            // in Watch's corner the whole break is the way back: a tap anywhere on it off the card returns to the video
            g.Tapped += (_, e) => { if (!ReferenceEquals(e.OriginalSource, g) || !_pip.ContainsKey(tile.Id) || BreakWatchFor?.Invoke(tile.Id) != true) return; e.Handled = true; BreakWatchPressed?.Invoke(tile.Id); };
            tile.Card = card;
            tile.ArtChipHost = chipHost;
        }
        // Concept-scenes 3: the pack the scene named decides the picture, and the
        // picture arrives WITH its provenance. A pack that shipped no bytes falls
        // back to the signed pool; neither means the dark substrate, never a
        // broken veil (spec 26).
        var pick = _art.Pick(source);
        tile.ArtInfo = pick?.Attribution;
        if (pick is not null) TrySetImage(tile.IntermissionArt!, pick.Path);
        ApplyArtAttribution(tile);
        for (var si = 1; si < tile.ArtSlabs.Length; si++) tile.ArtSlabs[si].Source = tile.ArtSlabs[0].Source;
        tile.Covered = true;
        if (BreakWatchFor?.Invoke(tile.Id) == true && !tile.CardMinimal) tile.CardMinimal = true;   // a new break on the Video player: collapsed to the icon
        tile.AdTimeLeft = null;
        ApplyArtAttribution(tile);
        SyncBreakCard(tile);
        _onStatus($"intermission up: {id} ({source}){(tile.ArtInfo is { } ai ? " · " + ai.Line : pick is not null ? " · pool art (no per-image provenance)" : " · no art: dark substrate")}");
        if (!tile.Peeked && !_adDebug && tile.Look == "veil") Fade(tile.Intermission, tile.Intermission.Opacity, 1, 400);   // ad debug: the state is kept, the cover not drawn
        if (_adDebug || tile.Look != "veil") { tile.Intermission.IsHitTestVisible = false; tile.Intermission.Opacity = 0; }
        SyncMutedStrip(tile);
        SyncAdDebug();
        SyncCornerX(tile);
        CoverageChanged?.Invoke();
    }

    /// <summary>
    /// Concept-scenes 3.2, the card corner. The card says title (with creator)
    /// + credit + licence; the minimal chip collapses that to the credit alone.
    /// Same rule as packages/core/src/imagery-pack.ts `cardAttribution`, which
    /// carries the fixtures. Pool art has no per-image record on the device, so
    /// the line says so rather than saying nothing.
    /// </summary>
    private static void ApplyArtAttribution(Tile tile)
    {
        var minimal = tile.CardMinimal;
        if (tile.MinimalChip is { } mc) mc.Content = minimal ? "Show card" : "Minimize";
        if (tile.Card is { } card) card.Visibility = minimal ? Visibility.Collapsed : Visibility.Visible;

        var line = tile.ArtInfo?.Line;
        if (tile.ArtLine is { } al)
        {
            al.Text = line ?? "";
            al.Visibility = line is null ? Visibility.Collapsed : Visibility.Visible;
        }
        var credit = tile.ArtInfo?.MinimalLine;
        // collapsed, the card is its icon: the mark, the ad's time left (when the service says), the picture's credit - a tap expands it
        var rest = (tile.AdTimeLeft is { Length: > 0 } left ? "  " + left : "") + (credit is not null ? "   " + credit : "");
        if (tile.ArtChip is { } ac)
        {
            ac.Inlines.Clear();
            ac.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "\u25D0", FontSize = 18, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xF2, 0xB1, 0x4C)) });
            if (rest.Length > 0) ac.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = rest, FontSize = 13 });
        }
        if (tile.ArtChipHost is { } ch) ch.Visibility = minimal && tile.Covered ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>Spec 26 "card minimize": one tap toggles; the artwork breathes
    /// full-bleed and the attribution collapses to the credit, never to nothing.</summary>
    public void ToggleCardMinimal(string id)
    {
        var tile = Get(id);
        if (tile?.Intermission is null) return;
        tile.CardMinimal = !tile.CardMinimal;
        ApplyArtAttribution(tile);
        _onStatus($"intermission card: {id} {(tile.CardMinimal ? "minimized" : "expanded")}");
    }

    /// <summary>The provenance of the image this tile's veil is showing, for the
    /// spec 6a context sheet (where `sourceUrl` is reachable). Null when the veil
    /// is down, or when the image came from the pool, which carries no per-image
    /// record on the device.</summary>
    public ArtAttribution? VeilAttribution(string id)
    {
        var tile = Get(id);
        return tile is { Covered: true } ? tile.ArtInfo : null;
    }

    /// <summary>Spec 26 peek: show the ad under this tile's veil until tapped
    /// again or the break ends. The veil is a choice being continuously made.</summary>
    private readonly Dictionary<string, Button> _peekBack = new();
    /// <summary>The peek's own way back: a chip in the window's top-left corner, above the faded cover.</summary>
    private Button PeekBackFor(Tile tile)
    {
        if (_peekBack.TryGetValue(tile.Id, out var b)) return b;
        b = new Button
        {
            Content = new TextBlock { Text = "Cover again", FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x14, 0x17, 0x1C)) },
            HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(12, 12, 0, 0), Padding = new Thickness(12, 6, 12, 6), CornerRadius = new CornerRadius(8),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(0),
            Visibility = Visibility.Collapsed,
        };
        MainWindow.OwnHover(b);
        var id = tile.Id;
        b.Click += (_, __) => { if (Get(id) is { Peeked: true }) TogglePeek(id); };
        tile.Container.Children.Add(b);
        _peekBack[tile.Id] = b;
        return b;
    }

    public void TogglePeek(string id)
    {
        var tile = Get(id);
        if (tile?.Intermission is not { } g) return;
        tile.Peeked = !tile.Peeked;
        tile.PeekTimer?.Stop();
        if (tile.Peeked)
        {
            // Timeboxed like the extension's Reveal 15s: counts down on the
            // chip and re-veils itself; a manual Re-veil or break end cancels.
            tile.PeekRemaining = 15;
            if (tile.PeekChip is { } c) c.Content = "Re-veil · 15s";
            if (tile.PeekTimer is null)
            {
                var t = _canvas.DispatcherQueue.CreateTimer();
                t.Interval = TimeSpan.FromSeconds(1);
                t.IsRepeating = true;
                var captured = tile;                     // one closure, attached once
                t.Tick += (_, __) =>
                {
                    if (!captured.Peeked || !captured.Covered) { t.Stop(); return; }
                    captured.PeekRemaining--;
                    if (captured.PeekRemaining <= 0) { t.Stop(); TogglePeek(captured.Id); return; }
                    if (captured.PeekChip is { } cc) cc.Content = "Re-veil · " + captured.PeekRemaining + "s";
                    if (_peekBack.TryGetValue(captured.Id, out var pb) && pb.Content is TextBlock pbt) pbt.Text = "Cover again \u00B7 " + captured.PeekRemaining + "s";
                };
                tile.PeekTimer = t;
            }
            tile.PeekTimer.Start();
        }
        else if (tile.PeekChip is { } chip)
        {
            chip.Content = "Show ad 15s";
        }
        if (tile.Covered && !_adDebug) Fade(g, g.Opacity, tile.Peeked ? 0 : 1, 150);
        // while peeked the overlay must not intercept the page
        g.IsHitTestVisible = !tile.Peeked;
        // the ad shown is heard too (2026-10-07, "I guess that was you muting the ad even though I said to show it for 15 s"): the window with
        // the sound is unmuted at its page for the peek, and muted again as the cover comes back
        if (tile.Id == _soundTile && tile.View?.CoreWebView2 is { } pcore) pcore.IsMuted = tile.Peeked ? false : tile.Muted;
        // ... and a small Cover again stays on the window through the peek ("can it also minimize to the icon so I can have a chance to bring
        // it back earlier?"): the cover itself is faded out and passes every press through, so the way back is its own chip
        var back = PeekBackFor(tile);
        back.Visibility = tile.Peeked && tile.Covered ? Visibility.Visible : Visibility.Collapsed;
        if (back.Content is TextBlock bt) bt.Text = "Cover again \u00B7 " + tile.PeekRemaining + "s";
        CoverageChanged?.Invoke();
    }

    /// <summary>surface.setZoom (§2 zoom, §31 viewfinder): page zoom the way
    /// browser zoom works. WinUI's WebView2 exposes no ZoomFactor, so the view
    /// is laid out at rect/zoom CSS px (innerWidth shrinks - responsive
    /// breakpoints respond, the page reflows) and drawn scaled by zoom.</summary>
    /// <summary>surface.setViewport: the page's CSS layout viewport (0×0 = the
    /// rect itself). The page lays out at w×h - any size - and is drawn scaled
    /// to fit the rect. WinUI's WebView2 has no zoom API, so two mechanisms
    /// share the contract:
    ///  · a viewport that fits inside the WINDOW: the view is laid out at w×h
    ///    (the Canvas host never clips it) and drawn with a XAML scale; a
    ///    DevTools raster-density override keeps an upscale crisp;
    ///  · a viewport larger than the window (a page laid out wider than the
    ///    slot - zoom-out): the view cannot exceed the window, so the layout
    ///    viewport is overridden through DevTools and &lt;body&gt; is scaled
    ///    in-page to fit - CSS transforms hit-test correctly, where the
    ///    protocol's own `scale` is not honoured here. html[data-prism-zoom]
    ///    carries that scale so core's framing script composes (focus.ts).</summary>
    public Task SetViewportAsync(string id, double w, double h)
    {
        if (Get(id) is not { } t) return Task.CompletedTask;
        // in Watch's corner the page keeps the corner's full-size layout (2026-09-25, "Enormous captions covering Window 2 from the watch screen"): core
        // sends a window its own small layout as multiview places it, and that had undone the corner's at once; it is kept for the return instead
        if (_pip.TryGetValue(id, out var pip)) { _pip[id] = (pip.rect, pip.z, w > 0 && h > 0 ? (w, h) : null); return Task.CompletedTask; }
        t.Viewport = w > 0 && h > 0 ? (w, h) : null;
        return t.View is { } v ? ApplyViewportAsync(t, v) : Task.CompletedTask;
    }

    /// <summary>What the page is laid out at right now: viewport, the fit scale
    /// into the rect, and whether the fit is an in-page body scale.</summary>
    public (double W, double H, double Fit, bool BodyScaled) LayoutOf(string id)
    {
        if (Get(id) is not { } t) return (0, 0, 1, false);
        if (t.Viewport is not { } vp || (t.InFullscreen && !_pip.ContainsKey(t.Id))) return (t.Rect.W, t.Rect.H, 1, false);   // a fullscreen player is laid out at the rect
        // width drives layout: the viewport's height follows the rect's aspect,
        // so the fit is exactly rect/width and the framed page fills the rect
        var w = Math.Max(1, vp.W);
        var h = LayoutHeight(t, w);
        return (w, h, t.Rect.W / w, !FitsWindow(w, h));
    }

    private static double LayoutHeight(Tile t, double w) => Math.Max(1, w * Math.Max(1, t.Rect.H) / Math.Max(1, t.Rect.W));

    private bool FitsWindow(double w, double h) =>
        w <= Math.Max(1, _canvas.ActualWidth) + 0.5 && h <= Math.Max(1, _canvas.ActualHeight) + 0.5;

    private void ApplyViewport(Tile tile)
    {
        if (tile.View is { } v) _ = ApplyViewportAsync(tile, v);
    }

    private async Task ApplyViewportAsync(Tile tile, WebView2 v)
    {
        await tile.ViewportGate.WaitAsync();
        try { await ApplyViewportCoreAsync(tile, v); }
        finally { tile.ViewportGate.Release(); }
    }

    private async Task ApplyViewportCoreAsync(Tile tile, WebView2 v)
    {
        var rw = Math.Max(1, tile.Rect.W);
        var rh = Math.Max(1, tile.Rect.H);
        var core = v.CoreWebView2;
        var mode = "rect";
        var cdp = "";
        // a fullscreen player lays out at its rect (the Hulu captions fit) - except in Watch's corner, where the rect is tiny and the page keeps the
        // corner's full-size layout, drawn small (2026-09-25, "Enormous captions covering Window 2 from the watch screen")
        if (tile.Viewport is not { } vp || (tile.InFullscreen && !_pip.ContainsKey(tile.Id)))
        {
            v.Width = rw;
            v.Height = rh;
            v.RenderTransform = null;
            if (core is null) return;
            try { if (tile.LayoutOverride || tile.RasterOverride) await core.CallDevToolsProtocolMethodAsync("Emulation.clearDeviceMetricsOverride", "{}"); } catch (Exception ex) { cdp = ex.Message; }
            tile.LayoutOverride = tile.RasterOverride = false;
            try { await core.ExecuteScriptAsync(BodyZoomJs(1)); } catch (Exception ex) { cdp += " js:" + ex.Message; }
        }
        else if (FitsWindow(vp.W, LayoutHeight(tile, vp.W)))
        {
            mode = "xaml";
            var lw = Math.Max(1, vp.W);
            var lh = LayoutHeight(tile, lw);               // the rect's aspect: fit is exact, the page fills the rect
            var fit = rw / lw;
            v.Width = lw;
            v.Height = lh;
            v.RenderTransformOrigin = new Windows.Foundation.Point(0, 0);
            v.RenderTransform = Math.Abs(fit - 1) < 0.001 ? null : new ScaleTransform { ScaleX = fit, ScaleY = fit };
            if (core is null) return;
            try
            {
                if (fit > 1.001)
                {
                    // raster density only (width/height 0 = no layout override) so the upscale stays crisp
                    var display = v.XamlRoot?.RasterizationScale ?? 1;
                    await core.CallDevToolsProtocolMethodAsync("Emulation.setDeviceMetricsOverride",
                        JsonSerializer.Serialize(new { width = 0, height = 0, deviceScaleFactor = display * fit, mobile = false }));
                    tile.LayoutOverride = false;
                    tile.RasterOverride = true;
                }
                else if (tile.LayoutOverride || tile.RasterOverride)
                {
                    await core.CallDevToolsProtocolMethodAsync("Emulation.clearDeviceMetricsOverride", "{}");
                    tile.LayoutOverride = tile.RasterOverride = false;
                }
            }
            catch (Exception ex) { cdp = ex.Message; }
            try { await core.ExecuteScriptAsync(BodyZoomJs(1)); } catch (Exception ex) { cdp += " js:" + ex.Message; }
        }
        else
        {
            // wider than the window: DevTools layout viewport + in-page body scale
            mode = "cdp";
            var lw = Math.Max(1, vp.W);
            var lh = LayoutHeight(tile, lw);               // the rect's aspect: fit is exact, the page fills the rect
            var fit = rw / lw;
            v.Width = rw;
            v.Height = rh;
            v.RenderTransform = null;
            if (core is null) return;
            try
            {
                // a raster-density override from an earlier zoom-in must go first:
                // WebView2 keeps it when the next override says 0, and the page then
                // lays out at width ÷ dpr (seen 2026-08-31: 2116 asked, 1411 got)
                if (tile.RasterOverride) await core.CallDevToolsProtocolMethodAsync("Emulation.clearDeviceMetricsOverride", "{}");
                var display = v.XamlRoot?.RasterizationScale ?? 1;
                await core.CallDevToolsProtocolMethodAsync("Emulation.setDeviceMetricsOverride", JsonSerializer.Serialize(new
                {
                    width = (int)Math.Round(lw),
                    height = (int)Math.Round(lh),
                    deviceScaleFactor = display,            // explicit: the display's own
                    mobile = false,
                }));
                tile.LayoutOverride = true;
                tile.RasterOverride = false;
            }
            catch (Exception ex) { cdp = ex.Message; }
            try { await core.ExecuteScriptAsync(BodyZoomJs(fit)); } catch (Exception ex) { cdp += " js:" + ex.Message; }
        }
        // diagnostics (host.log), off the awaited path so the seam chain is not delayed
        var summary = $"viewport {tile.Id}: rect {rw:0}x{rh:0} vp {(tile.Viewport is { } p ? $"{p.W:0}x{p.H:0}" : "-")} mode {mode} view {v.Width:0}x{v.Height:0}{(cdp.Length > 0 ? " cdp:" + cdp : "")}";
        _ = ProbeAsync(core, summary);
    }

    private async Task ProbeAsync(CoreWebView2 core, string summary)
    {
        try
        {
            await Task.Delay(600);
            var probe = await core.ExecuteScriptAsync(
                "innerWidth+'x'+innerHeight+' dpr='+devicePixelRatio+' body='+(document.body?document.body.style.transform:'-')+' attr='+document.documentElement.getAttribute('data-prism-zoom')+' html='+document.documentElement.style.transform");
            _onStatus(summary + " page " + probe);
        }
        catch { }
    }

    /// <summary>In-page half of zoom-out: scale &lt;body&gt; and mark the root so
    /// framing composes. Idempotent; re-run on every document (load).</summary>
    private static string BodyZoomJs(double z) => @"(function (z) {
  var r = document.documentElement;
  function apply() {
    var b = document.body; if (!b) return;
    if (z === 1) { b.style.transform = ''; b.style.transformOrigin = ''; }
    else { b.style.transformOrigin = '0 0'; b.style.transform = 'scale(' + z + ')'; }
  }
  if (z === 1) r.removeAttribute('data-prism-zoom'); else r.setAttribute('data-prism-zoom', String(z));
  if (document.body) apply(); else document.addEventListener('DOMContentLoaded', apply, { once: true });
})(" + z.ToString(System.Globalization.CultureInfo.InvariantCulture) + ")";

    /// <summary>The viewfinder's box, already in the view's own px (magnify
    /// undone), to a page rectangle in LAYOUT CSS px - the units focus.region
    /// persists. Which conversion applies depends on the zoom mechanism above.</summary>
    public (double X, double Y, double W, double H) RegionFromView(string id, double vx, double vy, double vw, double vh, double scrollX, double scrollY)
    {
        var (_, _, fit, bodyScaled) = LayoutOf(id);
        if (bodyScaled)
            // body-scale mode: view px = html px; layout px = (html + scroll) / fit
            return ((vx + scrollX) / fit, (vy + scrollY) / fit, vw / fit, vh / fit);
        // XAML mode: view px = layout px × fit; scroll is layout px
        return (vx / fit + scrollX, vy / fit + scrollY, vw / fit, vh / fit);
    }

    /// <summary>Prism's own keys pressed while a page had focus (Escape, F8, F10, F11).</summary>
    public event Action<string>? HostKey;
    /// <summary>A page's own report of a tap or a key on it (the prelude's 'interaction' post) - the WebView eats the pointer, so this is how the host knows.</summary>
    public event Action<string>? PageInteraction;
    /// <summary>A press on a tile's stage shield (the pointer never reaches the page on the stage).</summary>
    public event Action<string>? ShieldPressed;

    // ------------------------------------------------ §6 micro-facets (tiles.prism)

    /// <summary>Where the first-party pages live on disk: Assets/tiles, mapped to https://tiles.prism/.</summary>
    public static string TilesRoot => Path.Combine(AppContext.BaseDirectory, "Assets", "tiles");

    /// <summary>A tiles.prism page asked to read or edit its document (origin already checked). The window answers via core.</summary>
    public event Action<string, TilesBridge.Request>? TilesRequested;

    /// <summary>
    /// https://tiles.prism/chores/ → Assets/tiles/chores/index.html. The virtual
    /// host mapping serves files only; this is the directory default document,
    /// and nothing else. Paths are resolved and confined to TilesRoot, so a
    /// ../ in a URL cannot walk out of the folder.
    /// </summary>
    private void ServeTilesIndex(Tile tile, CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            if (tile.Env is not { } env) return;
            if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri)) return;
            if (!string.Equals(uri.Host, TilesBridge.HostName, StringComparison.OrdinalIgnoreCase)) return;
            if (!uri.AbsolutePath.EndsWith("/", StringComparison.Ordinal)) return;
            var rootFull = Path.GetFullPath(TilesRoot);
            var rel = Uri.UnescapeDataString(uri.AbsolutePath).Trim('/').Replace('/', Path.DirectorySeparatorChar);
            var file = Path.GetFullPath(Path.Combine(rootFull, rel, "index.html"));
            if (!file.StartsWith(rootFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) return;
            var stream = new MemoryStream(File.ReadAllBytes(file)).AsRandomAccessStream();
            e.Response = env.CreateWebResourceResponse(stream, 200, "OK",
                "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store");
        }
        catch { /* the mapping's own 404 is a better answer than a crash */ }
    }

    /// <summary>Push a document (or a refusal) to every live tiles.prism page, so a phone's edit lands on the wall at once.</summary>
    public void PostToTiles(string messageJson)
    {
        foreach (var tile in _tiles.Values)
        {
            if (tile.View?.CoreWebView2 is not { } core) continue;
            if (!TilesBridge.IsTilesOrigin(core.Source)) continue;
            try { core.PostWebMessageAsJson(messageJson); } catch { }
        }
    }

    /// <summary>Right-click on a slot: (tile id, point in window coordinates).</summary>
    public event Action<string, Windows.Foundation.Point>? SlotContextMenu;

    /// <summary>A Grid that can set the pointer cursor (ProtectedCursor is protected on UIElement).</summary>
    public sealed class CursorGrid : Grid
    {
        public void UseCursor(Microsoft.UI.Input.InputSystemCursorShape shape)
        {
            try { ProtectedCursor = Microsoft.UI.Input.InputSystemCursor.Create(shape); } catch { }
        }
    }

    public string ToolOf(string id) => Get(id)?.Tool ?? "select";

    /// <summary>Pan gesture, reported in view pixels of the slot; the window decides what
    /// a drag means for this tile (a framed region slides over the page; an unframed page scrolls).</summary>
    public event Action<string>? PanStarted;
    public event Action<string, double, double>? PanMoved;
    public event Action<string>? PanEnded;
    public event Action<string, int>? PanWheel;

    /// <summary>Scroll the page under a slot by a view-pixel delta (the hand's movement),
    /// converted to the page's own CSS pixels through the current fit.</summary>
    public Task ScrollTileAsync(string id, double dxView, double dyView)
    {
        var fit = Math.Max(0.01, LayoutOf(id).Fit);
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        return EvalOnTileAsync(id, $"window.scrollBy({(-dxView / fit).ToString(inv)},{(-dyView / fit).ToString(inv)})");
    }

    /// <summary>Slot tools. "select": the pointer reaches the page (default).
    /// "pan": a hand-cursor catcher over the page turns drags and the wheel into
    /// Pan* events for the window - useful for touch-hostile pages and for
    /// lining content up under a region.</summary>
    public void SetTool(string id, string tool)
    {
        if (Get(id) is not { } t) return;
        t.Tool = tool == "pan" ? "pan" : "select";
        if (t.Tool == "pan")
        {
            if (t.PanCatcher is not null) return;
            var catcher = new CursorGrid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)) };
            catcher.UseCursor(Microsoft.UI.Input.InputSystemCursorShape.Hand);
            Windows.Foundation.Point? last = null;
            catcher.PointerPressed += (s, e) =>
            {
                var pt = e.GetCurrentPoint(catcher);
                if (pt.Properties.IsRightButtonPressed)
                {
                    e.Handled = true;
                    try { SlotContextMenu?.Invoke(id, catcher.TransformToVisual(_canvas).TransformPoint(pt.Position)); } catch { }
                    return;
                }
                if (!pt.Properties.IsLeftButtonPressed) return;
                last = pt.Position;
                catcher.CapturePointer(e.Pointer);
                e.Handled = true;
                PanStarted?.Invoke(id);
            };
            catcher.PointerMoved += (s, e) =>
            {
                if (last is not { } l) return;
                var p = e.GetCurrentPoint(catcher).Position;
                var dx = p.X - l.X;
                var dy = p.Y - l.Y;
                last = p;
                if (dx != 0 || dy != 0) PanMoved?.Invoke(id, dx, dy);
                e.Handled = true;
            };
            void End(object s, PointerRoutedEventArgs e) { if (last is null) return; last = null; catcher.ReleasePointerCapture(e.Pointer); e.Handled = true; PanEnded?.Invoke(id); }
            catcher.PointerReleased += End;
            catcher.PointerCanceled += End;
            catcher.PointerCaptureLost += (s, e) => { if (last is null) return; last = null; PanEnded?.Invoke(id); };
            catcher.PointerWheelChanged += (s, e) =>
            {
                var delta = e.GetCurrentPoint(catcher).Properties.MouseWheelDelta;
                PanWheel?.Invoke(id, delta);
                e.Handled = true;
            };
            t.PanCatcher = catcher;
            t.Container.Children.Insert(Math.Min(1, t.Container.Children.Count), catcher);   // above the page, below the overlay
        }
        else if (t.PanCatcher is { } c)
        {
            t.Container.Children.Remove(c);
            t.PanCatcher = null;
        }
    }

    /// <summary>
    /// A HUMAN's single tap on a scene item whose placement claims it
    /// (docs/concept-scenes.md §5). The window asks core what it means
    /// (<c>tapItem</c>); the shell decides nothing.
    /// </summary>
    public event Action<string>? ItemTapped;

    /// <summary>
    /// concept-scenes §5: turn Prism's claim on the single tap on or off for a
    /// slot. Claimed only where the placement's standing instruction is
    /// <c>audio</c> or <c>both</c> — a tap there means "the sound comes here",
    /// not "play/pause this page". With <c>promote</c> (the §6a default) the
    /// pointer keeps reaching the page exactly as before, so nothing changes
    /// for scenes that never asked.
    ///
    /// Right-click and press-and-hold still raise the §6a context sheet in
    /// every mode — the catcher forwards them the way the pan catcher does.
    /// </summary>
    public void SetTapCatcher(string id, bool claimTap)
    {
        if (Get(id) is not { } t) return;
        if (claimTap)
        {
            if (t.TapCatcher is not null) return;
            var catcher = new CursorGrid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)) };
            catcher.UseCursor(Microsoft.UI.Input.InputSystemCursorShape.Hand);
            catcher.PointerPressed += (s, e) =>
            {
                var pt = e.GetCurrentPoint(catcher);
                e.Handled = true;
                if (pt.Properties.IsRightButtonPressed)
                {
                    try { SlotContextMenu?.Invoke(id, catcher.TransformToVisual(_canvas).TransformPoint(pt.Position)); } catch { }
                    return;
                }
                if (!pt.Properties.IsLeftButtonPressed && e.Pointer.PointerDeviceType == Microsoft.UI.Input.PointerDeviceType.Mouse) return;
                ItemTapped?.Invoke(id);   // touch contacts report no button; a mouse must be the left one
            };
            catcher.Holding += (s, e) =>
            {
                if (e.HoldingState != Microsoft.UI.Input.HoldingState.Started) return;
                e.Handled = true;
                try { SlotContextMenu?.Invoke(id, catcher.TransformToVisual(_canvas).TransformPoint(e.GetPosition(catcher))); } catch { }
            };
            t.TapCatcher = catcher;
            t.Container.Children.Insert(Math.Min(1, t.Container.Children.Count), catcher);   // above the page, below the overlay
        }
        else if (t.TapCatcher is { } tc)
        {
            t.Container.Children.Remove(tc);
            t.TapCatcher = null;
        }
    }

    // ------------------------------------------------ spec 32: floating chrome + the Now Playing control
    /// <summary>A floating facet was dragged or resized (pixels, canvas space); the window persists it as wall fractions through core.</summary>
    public event Action<string, double, double, double, double>? FloatChanged;
    /// <summary>A HUMAN tapped slot chrome: play|pause|next|prev|mute|unmute|face:page|face:control|dock. The window routes it; the shell decides nothing.</summary>
    public event Action<string, string>? TileCommand;

    public (double W, double H) CanvasSize => (_canvas.ActualWidth, _canvas.ActualHeight);

    private const double BarH = 30;

    /// <summary>surface.setChrome: a wall slot (no chrome) or a floating facet showing its control face or its page. `kind` is "slot" or "floating"; the pre-rename spelling "frame" is accepted as "slot" for one release (any non-"floating" kind is a slot).</summary>
    public void SetChrome(string id, string kind, string face, bool hidden = false)
    {
        if (Get(id) is not { } t) return;
        if (kind != "floating")
        {
            foreach (var el in new UIElement?[] { t.FloatBar, t.ControlFace, t.FloatGrip, t.FloatBorder })
                if (el is not null) t.Container.Children.Remove(el);
            t.FloatBar = null; t.ControlFace = null; t.FloatGrip = null; t.FloatBorder = null;
            t.NpTimer?.Stop();
            t.Container.Visibility = Visibility.Visible;
            return;
        }
        if (t.FloatBar is null) BuildFloatChrome(t);
        // hidden (§32): off the wall visually, alive and audible - parked off-canvas, never Collapsed
        // (Collapsed flips the page to visibilityState "hidden" and pauses muted media; see PlaceHidden)
        if (hidden != t.HiddenPresence) PlaceHidden(t, hidden);
        t.Face = face == "page" ? "page" : "control";
        t.ControlFace!.Visibility = t.Face == "control" && !t.Placeholder ? Visibility.Visible : Visibility.Collapsed;
        if (t.FaceIcon is not null) t.FaceIcon.Glyph = t.Face == "control" ? "" : "";
        if (t.FaceBtn is not null) ToolTipService.SetToolTip(t.FaceBtn, t.Face == "control" ? "Show the page to sign in, browse or pick music" : "Back to the player control");
    }

    /// <summary>Multiview's small windows (2026-09-23, "when my mouse is off the screen, i want them to disappear with the controls, and for the
    /// windows to just be the single accent line"): their bar and grip show with the stage's controls and go with them; the accent border stays.</summary>
    private readonly HashSet<string> _barsQuiet = new();
    /// <summary>Multiview windows: placed by core, never resized by hand - no grip at all ("the multiview video modals dont need to be resizable").</summary>
    private readonly HashSet<string> _noGrip = new();
    /// <summary>The floating windows that are multiview windows now: their bars carry the X.</summary>
    private readonly HashSet<string> _mvClose = new();
    public void SetMvClose(string id, bool on)
    {
        if (on) _mvClose.Add(id); else _mvClose.Remove(id);
        if (Get(id) is { } t) SyncCornerX(t);
    }
    /// <summary>
    /// Multiview's X in each window's top right corner (2026-09-25, "The X to clear the video from the preview window should still be present even
    /// if the veil is up on the video"): it had lived in the window's bar, which the veil covers, and the big screen wears no bar. Drawn above
    /// everything in the window, the veil included: shown while the controls are up, and all through a break. Not in Watch's corner, which has its own.
    /// </summary>
    private void SyncCornerX(Tile t)
    {
        // with the controls, also through a break (2026-10-06, "When an ad veil is up, the close X shows at the top right of the window, even if the
        // controls have been hidden ... The other Xs hide"): above the veil while the controls are up, gone with them
        var want = _mvClose.Contains(t.Id) && !_pip.ContainsKey(t.Id) && !_barsQuiet.Contains(t.Id);
        if (!want) { if (t.CornerX is { } old) old.Visibility = Visibility.Collapsed; return; }
        if (t.CornerX is null)
        {
            var x = new Button
            {
                Content = new FontIcon { Glyph = "\uE711", FontSize = 13, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xE8, 0xEC, 0xF2)) },
                Width = 34, Height = 34, Padding = new Thickness(0), CornerRadius = new CornerRadius(17), BorderThickness = new Thickness(0),
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xC8, 0x0B, 0x0D, 0x12)),
                HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 10, 10, 0),
            };
            ToolTipService.SetToolTip(x, "Clear this window. The ones after it move up.");
            var id = t.Id;
            x.Click += (_, __) => TileCommand?.Invoke(id, "mv:remove");
            Canvas.SetZIndex(x, 1000);   // over the page, its shield and the intermission card
            t.Container.Children.Add(x);
            t.CornerX = x;
        }
        t.CornerX.Visibility = Visibility.Visible;
    }
    public void SetFloatBarShown(string id, bool shown)
    {
        if (shown) _barsQuiet.Remove(id); else _barsQuiet.Add(id);
        _noGrip.Add(id);
        if (Get(id) is not { } t) return;
        if (t.FloatBar is not null) t.FloatBar.Visibility = shown ? Visibility.Visible : Visibility.Collapsed;
        if (t.FloatGrip is not null) t.FloatGrip.Visibility = Visibility.Collapsed;
        SyncCornerX(t);
    }

    private void BuildFloatChrome(Tile t)
    {
        var amber = Windows.UI.Color.FromArgb(255, 0xF2, 0xB1, 0x4C);
        var ink = Windows.UI.Color.FromArgb(255, 0xEC, 0xEC, 0xF0);
        var dim = Windows.UI.Color.FromArgb(255, 0x9A, 0x9C, 0xA8);
        var barBg = Windows.UI.Color.FromArgb(0xE6, 0x14, 0x15, 0x1C);
        var faceBg = Windows.UI.Color.FromArgb(255, 0x12, 0x13, 0x1A);
        var clear = Windows.UI.Color.FromArgb(0, 0, 0, 0);

        Button Icon(string glyph, string tip, Action click, double size = 16)
        {
            var icon = new FontIcon { Glyph = glyph, FontSize = size, Foreground = new SolidColorBrush(ink) };
            var b = new Button
            {
                Content = icon,
                Padding = new Thickness(8, 6, 8, 6),
                Background = new SolidColorBrush(clear),
                BorderThickness = new Thickness(0),
                VerticalAlignment = VerticalAlignment.Center,
            };
            ToolTipService.SetToolTip(b, tip);
            b.Click += (_, __) => click();
            return b;
        }

        // --- the bar: drag handle, the facet's name, face toggle, dock
        var bar = new CursorGrid { Height = BarH, VerticalAlignment = VerticalAlignment.Top, Background = new SolidColorBrush(barBg) };
        bar.UseCursor(Microsoft.UI.Input.InputSystemCursorShape.SizeAll);
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var name = new TextBlock
        {
            Text = "⋮⋮  " + Pretty(t.Id),
            Foreground = new SolidColorBrush(amber),
            FontSize = 12,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(10, 0, 0, 0),
            IsHitTestVisible = false,
        };
        bar.Children.Add(name);
        var faceBtn = Icon("", "Show the page", () => TileCommand?.Invoke(t.Id, t.Face == "control" ? "face:page" : "face:control"), 14);
        faceBtn.Padding = new Thickness(8, 4, 8, 4);
        Grid.SetColumn(faceBtn, 1);
        bar.Children.Add(faceBtn);
        var dock = Icon("", "Dock it back into the layout", () => TileCommand?.Invoke(t.Id, "dock"), 14);
        dock.Padding = new Thickness(8, 4, 10, 4);
        Grid.SetColumn(dock, 2);
        bar.Children.Add(dock);
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var hide = Icon("", "Hide this window. It keeps playing, and you can bring it back from Prism menu → Floating facets.", () => TileCommand?.Invoke(t.Id, "hide"), 14);
        hide.Padding = new Thickness(8, 4, 10, 4);
        Grid.SetColumn(hide, 3);
        bar.Children.Add(hide);
        // multiview's X (2026-09-24, "Give me a nice little X button to clear out each multiview window"): the window leaves multiview and
        // the ones after it move up a place; collapsed on any floating facet that is not a multiview window
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var closeX = Icon("\uE711", "Clear this window. The ones after it move up.", () => TileCommand?.Invoke(t.Id, "mv:remove"), 13);
        closeX.Padding = new Thickness(8, 4, 10, 4);
        closeX.Visibility = Visibility.Collapsed;   // the window's corner X instead (SyncCornerX), above the veil
        Grid.SetColumn(closeX, 4);
        bar.Children.Add(closeX);
        t.CloseBtn = closeX;
        t.FaceBtn = faceBtn;
        t.FaceIcon = (FontIcon)faceBtn.Content;

        Windows.Foundation.Point? dragStart = null; double startL = 0, startT = 0;
        bar.PointerPressed += (s, e) =>
        {
            var pt = e.GetCurrentPoint(_canvas);
            if (!pt.Properties.IsLeftButtonPressed) return;
            if (t.Pinned) return;   // B-159: the inline app window is stationary
            dragStart = pt.Position; startL = Canvas.GetLeft(t.Container); startT = Canvas.GetTop(t.Container);
            bar.CapturePointer(e.Pointer);
            e.Handled = true;
        };
        bar.PointerMoved += (s, e) =>
        {
            if (dragStart is not { } d) return;
            var p = e.GetCurrentPoint(_canvas).Position;
            Canvas.SetLeft(t.Container, Math.Max(0, Math.Min(_canvas.ActualWidth - t.Container.Width, startL + p.X - d.X)));
            Canvas.SetTop(t.Container, Math.Max(0, Math.Min(_canvas.ActualHeight - t.Container.Height, startT + p.Y - d.Y)));
            e.Handled = true;
        };
        void EndDrag(object s, PointerRoutedEventArgs e)
        {
            if (dragStart is null) return;
            dragStart = null;
            bar.ReleasePointerCapture(e.Pointer);
            e.Handled = true;
            FloatChanged?.Invoke(t.Id, Canvas.GetLeft(t.Container), Canvas.GetTop(t.Container), t.Container.Width, t.Container.Height);
        }
        bar.PointerReleased += EndDrag;
        bar.PointerCanceled += EndDrag;

        // --- the control face: art | title / artist / transport / progress - over the live page
        var face = new Grid { Background = new SolidColorBrush(faceBg), Margin = new Thickness(0, BarH, 0, 0) };
        face.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        face.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var art = new Image { Stretch = Stretch.UniformToFill };
        var artHost = new Border
        {
            Child = art,
            Width = 96, Height = 96,
            Margin = new Thickness(14, 12, 6, 12),
            VerticalAlignment = VerticalAlignment.Center,
            CornerRadius = new CornerRadius(8),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x22, 0x23, 0x2C)),
        };
        face.Children.Add(artHost);
        var col = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 6, 14, 6), Spacing = 2 };
        var title = new TextBlock { Text = "Nothing playing", Foreground = new SolidColorBrush(ink), FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1 };
        var artist = new TextBlock { Text = "", Foreground = new SolidColorBrush(dim), FontSize = 13, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1 };
        var transport = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, Margin = new Thickness(-8, 2, 0, 0) };
        transport.Children.Add(Icon("", "Previous", () => TileCommand?.Invoke(t.Id, "prev")));
        var playBtn = Icon("", "Play / pause", () => TileCommand?.Invoke(t.Id, t.NpPlaying ? "pause" : "play"), 22);
        transport.Children.Add(playBtn);
        transport.Children.Add(Icon("", "Next", () => TileCommand?.Invoke(t.Id, "next")));
        var time = new TextBlock { Text = "", Foreground = new SolidColorBrush(dim), FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) };
        transport.Children.Add(time);
        var muteBtn = Icon(t.Muted ? "" : "", "Mute / unmute this slot", () => TileCommand?.Invoke(t.Id, t.Muted ? "unmute" : "mute"));
        muteBtn.Margin = new Thickness(8, 0, 0, 0);
        transport.Children.Add(muteBtn);
        var bar2 = new ProgressBar { Minimum = 0, Maximum = 1, Value = 0, Height = 3, Foreground = new SolidColorBrush(amber), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x2A, 0x2B, 0x36)), Margin = new Thickness(0, 4, 0, 0), Visibility = Visibility.Collapsed };
        col.Children.Add(title);
        col.Children.Add(artist);
        col.Children.Add(transport);
        col.Children.Add(bar2);
        Grid.SetColumn(col, 1);
        face.Children.Add(col);
        t.ControlFace = face; t.NpArt = art; t.NpArtHost = artHost; t.NpTitle = title; t.NpArtist = artist; t.NpTime = time; t.NpBar = bar2;
        t.NpPlayIcon = (FontIcon)playBtn.Content; t.NpMuteIcon = (FontIcon)muteBtn.Content;

        // --- resize grip, bottom-right
        var grip = new Border
        {
            Width = 18, Height = 18,
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom,
            Background = new SolidColorBrush(clear),
            Child = new TextBlock { Text = "◢", FontSize = 11, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xA0, 0xF2, 0xB1, 0x4C)), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 3, 1), IsHitTestVisible = false },
        };
        Windows.Foundation.Point? sizeStart = null; double startW = 0, startH = 0;
        grip.PointerPressed += (s, e) =>
        {
            var pt = e.GetCurrentPoint(_canvas);
            if (!pt.Properties.IsLeftButtonPressed) return;
            sizeStart = pt.Position; startW = t.Container.Width; startH = t.Container.Height;
            grip.CapturePointer(e.Pointer);
            e.Handled = true;
        };
        grip.PointerMoved += (s, e) =>
        {
            if (sizeStart is not { } d) return;
            var p = e.GetCurrentPoint(_canvas).Position;
            t.Container.Width = Math.Max(160, Math.Min(_canvas.ActualWidth - Canvas.GetLeft(t.Container), startW + p.X - d.X));
            t.Container.Height = Math.Max(BarH + 40, Math.Min(_canvas.ActualHeight - Canvas.GetTop(t.Container), startH + p.Y - d.Y));
            LayoutFace(t);
            e.Handled = true;
        };
        void EndSize(object s, PointerRoutedEventArgs e)
        {
            if (sizeStart is null) return;
            sizeStart = null;
            grip.ReleasePointerCapture(e.Pointer);
            e.Handled = true;
            FloatChanged?.Invoke(t.Id, Canvas.GetLeft(t.Container), Canvas.GetTop(t.Container), t.Container.Width, t.Container.Height);
        }
        grip.PointerReleased += EndSize;
        grip.PointerCanceled += EndSize;

        var border = new Border { BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x90, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(1), IsHitTestVisible = false };

        t.FloatBar = bar; t.FloatGrip = grip; t.FloatBorder = border;
        if (_barsQuiet.Contains(t.Id)) bar.Visibility = Visibility.Collapsed;
        if (_noGrip.Contains(t.Id)) grip.Visibility = Visibility.Collapsed;
        t.Container.Children.Add(face);
        t.Container.Children.Add(bar);
        t.Container.Children.Add(grip);
        t.Container.Children.Add(border);
        t.Container.SizeChanged += (_, __) => LayoutFace(t);
        LayoutFace(t);
    }

    /// <summary>The art square follows the facet's height; a strip-thin facet hides it.</summary>
    private static void LayoutFace(Tile t)
    {
        if (t.NpArtHost is null) return;
        var h = t.Container.Height - BarH - 24;
        if (h < 44) { t.NpArtHost.Visibility = Visibility.Collapsed; return; }
        t.NpArtHost.Visibility = Visibility.Visible;
        var s = Math.Min(140, h);
        t.NpArtHost.Width = s; t.NpArtHost.Height = s;
    }

    private static string Pretty(string id)
    {
        var words = id.Split(new[] { '-', '_' }, StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i < words.Length; i++) if (words[i].Length > 0) words[i] = char.ToUpperInvariant(words[i][0]) + words[i][1..];
        return string.Join(' ', words);
    }

    /// <summary>surface.setNowPlaying: core's per-tile now-playing state (JSON object, or null) painted onto the control face.</summary>
    public void SetNowPlaying(string id, string json)
    {
        if (Get(id) is not { } t) return;
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "null" : json);
            var r = doc.RootElement;
            if (r.ValueKind != JsonValueKind.Object)
            {
                t.NpPlaying = false; t.NpPos = 0; t.NpDur = 0; t.NpArtUrl = null;
                if (t.NpTitle is not null) t.NpTitle.Text = "Nothing playing";
                if (t.NpArtist is not null) t.NpArtist.Text = "";
                if (t.NpArt is not null) t.NpArt.Source = null;
                if (t.NpPlayIcon is not null) t.NpPlayIcon.Glyph = "";
                t.NpTimer?.Stop();
                UpdateProgress(t);
                return;
            }
            t.NpPlaying = r.TryGetProperty("playing", out var p) && p.ValueKind == JsonValueKind.True;
            var title = NpStr(r, "title"); var artist = NpStr(r, "artist"); var art = NpStr(r, "artwork");
            t.NpPos = NpNum(r, "position"); t.NpDur = NpNum(r, "duration");
            t.NpAt = Environment.TickCount64;
            if (t.NpTitle is not null) t.NpTitle.Text = string.IsNullOrWhiteSpace(title) ? "Nothing playing" : title;
            if (t.NpArtist is not null) t.NpArtist.Text = artist ?? "";
            if (t.NpPlayIcon is not null) t.NpPlayIcon.Glyph = t.NpPlaying ? "" : "";
            if (t.NpMuteIcon is not null) t.NpMuteIcon.Glyph = t.Muted ? "" : "";
            if (t.NpArt is not null && art != t.NpArtUrl)
            {
                // the art the page itself offered (its CDN URL; no Prism identifier travels)
                t.NpArtUrl = art;
                try { t.NpArt.Source = string.IsNullOrEmpty(art) || !art.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? null : new BitmapImage(new Uri(art)); }
                catch { t.NpArt.Source = null; }
            }
            if (t.NpTimer is null)
            {
                t.NpTimer = _canvas.DispatcherQueue.CreateTimer();
                t.NpTimer.Interval = TimeSpan.FromSeconds(1);
                t.NpTimer.Tick += (_, __) => { try { UpdateProgress(t); } catch (Exception ex) { _onStatus("now-playing tick failed: " + ex.GetType().Name + " " + ex.HResult.ToString("X8")); } };   // a tick must never take the wall down (2026-09-08)
            }
            if (t.NpPlaying) t.NpTimer.Start(); else t.NpTimer.Stop();
            UpdateProgress(t);
        }
        catch { }
    }

    private static void UpdateProgress(Tile t)
    {
        if (t.NpBar is null) return;
        var pos = t.NpPos + (t.NpPlaying ? (Environment.TickCount64 - t.NpAt) / 1000.0 : 0);
        if (t.NpDur > 0)
        {
            t.NpBar.Visibility = Visibility.Visible;
            t.NpBar.Value = Math.Max(0, Math.Min(1, pos / t.NpDur));
            if (t.NpTime is not null) t.NpTime.Text = Clock(pos) + " / " + Clock(t.NpDur);
        }
        else
        {
            t.NpBar.Visibility = Visibility.Collapsed;
            if (t.NpTime is not null) t.NpTime.Text = t.NpPlaying && t.NpPos > 0 ? Clock(pos) : "";
        }
    }

    private static string Clock(double s)
    {
        if (!double.IsFinite(s) || s < 0) s = 0;
        var ts = TimeSpan.FromSeconds(s);
        return ts.TotalHours >= 1 ? ts.ToString(@"h\:mm\:ss") : ts.ToString(@"m\:ss");
    }

    private static string? NpStr(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static double NpNum(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

    // ------------------------------------------------ spec 30: popups - core decides, the shell opens or intercepts
    /// <summary>Asks core for the §30 decision: (openerPageUrl, popupUrl, userInitiated) → JSON {action, reason}. The shell never decides.</summary>
    public Func<string, string, bool, Task<string?>>? PopupDecider;

    private int _popupSeq;
    private IEnumerable<Tile> PopupTiles => _tiles.Values.Where(t => t.Kind == SurfaceKind.Popup);

    private async Task HandleNewWindowAsync(Tile tile, CoreWebView2 opener, CoreWebView2NewWindowRequestedEventArgs e, Windows.Foundation.Deferral deferral)
    {
        var dest = "?";
        try { dest = new Uri(e.Uri).Host; } catch { }
        try
        {
            string action = "intercept", reason = "no policy";
            if (PopupDecider is { } ask)
            {
                var raw = await ask(opener.Source ?? "", e.Uri ?? "", e.IsUserInitiated);
                if (raw is not null)
                {
                    try
                    {
                        string inner;
                        using (var outer = JsonDocument.Parse(raw))
                            inner = outer.RootElement.ValueKind == JsonValueKind.String ? outer.RootElement.GetString()! : raw;
                        using var d = JsonDocument.Parse(inner);
                        if (d.RootElement.ValueKind == JsonValueKind.Object)
                        {
                            action = d.RootElement.TryGetProperty("action", out var a) ? a.GetString() ?? action : action;
                            reason = d.RootElement.TryGetProperty("reason", out var r) ? r.GetString() ?? reason : reason;
                        }
                    }
                    catch { }
                }
            }
            if (action != "allow")
            {
                _onStatus($"popup intercepted ({tile.Id} -> {dest}: {reason})");
                return;
            }
            if (tile.Env is null) { _onStatus($"popup not opened ({tile.Id} -> {dest}): no profile environment"); return; }
            // The popup is a Tile of kind Popup: the SAME profile (the sign-in lands in the opener's session, §10),
            // the FULL engine through AttachEngineAsync (bootstrap, events to core, inject path, composition,
            // mute inheritance), tracked in _tiles so LiveTileIds / VeilStates / Control Center see it, closed
            // with its opener (B-20, B-22). Its container lives in a sheet over the wall, not in the canvas.
            var pid = $"{tile.Id}#popup-{++_popupSeq}";
            var pt = GetOrCreateVisual(pid);
            _canvas.Children.Remove(pt.Container);
            pt.Kind = SurfaceKind.Popup;
            pt.Opener = tile.Id;
            pt.Profile = tile.Profile;
            pt.Env = tile.Env;
            pt.Muted = tile.Muted;
            pt.PopupUrl = e.Uri;
            pt.PopupPanel = BuildPopupPanel(tile, dest, reason, pt);
            pt.Overlay.Opacity = 1;                                            // §16 substrate until the popup's first paint
            await AttachEngineAsync(pt);
            e.NewWindow = pt.View!.CoreWebView2;                               // opener relationship intact (window.opener / postMessage)
            _forwardEvent(pid, JsonSerializer.Serialize(new { type = SurfaceEvents.Popup, id = pid, opener = tile.Id, url = e.Uri, open = true }));
            _onStatus($"popup opened ({tile.Id} -> {dest}: {reason}) as {pid}");
        }
        catch (Exception ex)
        {
            _onStatus("popup failed (" + tile.Id + " -> " + dest + "): " + ex.Message);
        }
        finally
        {
            deferral.Complete();
        }
    }

    /// <summary>A modal-looking sheet over the wall: a bar naming the destination and why it opened, a close, the popup's web view.</summary>
    private Grid BuildPopupPanel(Tile tile, string dest, string reason, Tile pt)
    {
        var popup = pt.Container;
        var amber = Windows.UI.Color.FromArgb(255, 0xF2, 0xB1, 0x4C);
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x99, 0x0B, 0x0D, 0x12)) };
        void Size() { scrim.Width = Math.Max(1, _canvas.ActualWidth); scrim.Height = Math.Max(1, _canvas.ActualHeight); }
        Size();
        _canvas.SizeChanged += (_, __) => Size();
        Canvas.SetZIndex(scrim, 950);
        var sheet = new Grid
        {
            Width = Math.Min(620, Math.Max(360, _canvas.ActualWidth - 80)),
            Height = Math.Min(780, Math.Max(400, _canvas.ActualHeight - 80)),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x12, 0x13, 0x1A)),
            BorderBrush = new SolidColorBrush(amber),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(10),
        };
        sheet.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        sheet.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        var bar = new Grid { Height = 36, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x1A, 0x1B, 0x24)), Padding = new Thickness(12, 0, 4, 0) };
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        bar.Children.Add(new TextBlock
        {
            Text = dest + "   ·   opened by " + Pretty(tile.Id) + "   ·   " + reason,
            Foreground = new SolidColorBrush(amber),
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        // The close is a word AND a glyph, both amber: the glyph alone shipped as an empty string (a collapsed escape),
        // so the sheet had no visible way out (2026-09-16, Amazon Music's terms-of-use window). Esc closes it too.
        var closeFace = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        closeFace.Children.Add(new FontIcon { Glyph = ((char)0xE711).ToString(), FontSize = 12, Foreground = new SolidColorBrush(amber) });
        closeFace.Children.Add(new TextBlock { Text = "Close", FontSize = 12, Foreground = new SolidColorBrush(amber), VerticalAlignment = VerticalAlignment.Center });
        var close = new Button { Content = closeFace, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), Padding = new Thickness(10, 6, 10, 6) };
        ToolTipService.SetToolTip(close, "Close this window (Esc)");
        close.Click += (_, __) => { var pt = PopupTiles.FirstOrDefault(t => ReferenceEquals(t.PopupPanel, scrim)); if (pt is not null) ClosePopup(pt); };
        Grid.SetColumn(close, 1);
        bar.Children.Add(close);
        sheet.Children.Add(bar);
        Grid.SetRow(popup, 1);
        popup.HorizontalAlignment = HorizontalAlignment.Stretch;
        popup.VerticalAlignment = VerticalAlignment.Stretch;
        sheet.Children.Add(popup);
        // The web view is laid out from the tile's rect (ApplyViewport) and a popup has no slot: without a rect it
        // sat at 1x1 under the substrate and the sheet was a black box (2026-09-16). The rect follows the content row.
        void FitPopup(double w, double h) { pt.Rect = new ChannelRect(0, 0, Math.Max(1, w), Math.Max(1, h)); ApplyViewport(pt); }
        FitPopup(sheet.Width - 2, sheet.Height - 2 - bar.Height);
        popup.SizeChanged += (_, e) => FitPopup(e.NewSize.Width, e.NewSize.Height);
        scrim.Children.Add(sheet);
        _canvas.Children.Add(scrim);
        return scrim;
    }

    private void ClosePopup(Tile pt)
    {
        if (pt.Kind != SurfaceKind.Popup) return;
        var wasTracked = _tiles.Remove(pt.Id);
        if (pt.PopupPanel is { } panel) _canvas.Children.Remove(panel);
        pt.PopupPanel = null;
        try { pt.View?.Close(); } catch { }
        pt.View = null;
        if (wasTracked)
        {
            _forwardEvent(pt.Id, JsonSerializer.Serialize(new { type = SurfaceEvents.Popup, id = pt.Id, opener = pt.Opener ?? "", open = false }));
            _onStatus($"popup closed ({pt.Id})");
            CoverageChanged?.Invoke();
        }
    }

    /// <summary>Every popup an opener has: closed when the opener is destroyed or suspended.</summary>
    private void ClosePopupsOf(string openerId)
    {
        foreach (var pt in PopupTiles.Where(t => t.Opener == openerId).ToArray()) ClosePopup(pt);
    }

    /// <summary>Esc while a popup sheet is up closes the most recent one; true if one was closed.</summary>
    public bool CloseTopPopup()
    {
        var top = PopupTiles.LastOrDefault();
        if (top is null) return false;
        ClosePopup(top);
        return true;
    }

    /// <summary>Open popup surfaces (id, opener, url) - the Control Center / remote list them.</summary>
    public IEnumerable<(string Id, string Opener, string? Url)> Popups() => PopupTiles.Select(t => (t.Id, t.Opener ?? "", t.PopupUrl)).ToArray();

    // ---- the wall's cost (MainWindow.PerfWatch, 2026-10-03): which process draws which surface
    public sealed record PerfProc(uint Pid, string Kind, string[] Surfaces, uint BrowserPid, string Profile);
    /// <summary>Every WebView2 process of every browser the surfaces use, with the surfaces a renderer draws (by frame id).</summary>
    public async Task<List<PerfProc>> ProcessMapAsync()
    {
        var list = new List<PerfProc>();
        var byFrame = new Dictionary<uint, string>();
        foreach (var t in _tiles.Values.ToArray()) { try { if (t.View?.CoreWebView2 is { } c) byFrame[c.FrameId] = t.Id; } catch { } }
        var seenBrowser = new HashSet<uint>();
        foreach (var t in _tiles.Values.ToArray())
        {
            if (t.Env is null) continue;
            uint bpid; try { bpid = t.View?.CoreWebView2?.BrowserProcessId ?? 0; } catch { continue; }
            if (bpid == 0 || !seenBrowser.Add(bpid)) continue;
            IReadOnlyList<CoreWebView2ProcessExtendedInfo> infos;
            try { infos = await t.Env.GetProcessExtendedInfosAsync(); } catch { continue; }
            foreach (var i in infos)
            {
                var ids = new List<string>();
                try { foreach (var f in i.AssociatedFrameInfos ?? Array.Empty<CoreWebView2FrameInfo>()) if (byFrame.TryGetValue(f.FrameId, out var id) && !ids.Contains(id)) ids.Add(id); } catch { }
                list.Add(new PerfProc((uint)i.ProcessInfo.ProcessId, i.ProcessInfo.Kind.ToString(), ids.ToArray(), bpid, t.Profile));
            }
        }
        return list;
    }
    /// <summary>Every surface: its id, kind, whether it is parked hidden, and its page.</summary>
    public IEnumerable<(string Id, string Kind, bool Hidden, string? Url)> Describe()
    {
        foreach (var t in _tiles.Values.ToArray())
        {
            string? url = null; try { url = t.View?.CoreWebView2?.Source; } catch { }
            yield return (t.Id, t.Kind.ToString(), t.HiddenPresence, url);
        }
    }

    /// <summary>The kind of a surface (slot / floating / hidden / popup / visualization).</summary>
    public SurfaceKind? KindOf(string id) => Get(id)?.Kind;

    public string? SourceOf(string id) => Get(id)?.View?.CoreWebView2?.Source;

    public ChannelRect? RectOf(string id) => Get(id)?.Rect;

    /// <summary>Run a diagnostic script in a tile's page; raw ExecuteScript
    /// result (JSON-encoded) or null. Report probes only - never behavior.</summary>
    /// <summary>Keyboard focus onto a tile's page (the stage keys ride the page's prelude; the Watch page had taken focus with it, 2026-09-21).</summary>
    public void FocusTile(string id) { try { Get(id)?.View?.Focus(FocusState.Programmatic); } catch { } }

    /// <summary>A trusted pointer move over a hidden service page (2026-09-22): Chromium's own input, so the page's hover draws what a mouse over
    /// it would (Hulu's Continue Watching X). Only the wall's hidden lookup surfaces take it ("app:&lt;id&gt;:lookup"), and it is only ever a move.</summary>
    public async Task HoverAsync(string id, double x, double y)
    {
        if (Get(id) is { } ht && IsParkable(ht)) await WakeAsync(ht);
        if (!id.StartsWith("app:", StringComparison.Ordinal) || !(id.EndsWith(":lookup", StringComparison.Ordinal) || id.EndsWith(":work", StringComparison.Ordinal))) { _onStatus("hover refused: " + id + " is not a hidden lookup surface"); return; }
        var tile = Get(id);
        if (tile is null || tile.Kind != SurfaceKind.Hidden) { _onStatus("hover refused: " + id + " is not a hidden surface"); return; }
        if (tile.View?.CoreWebView2 is not { } core) return;
        var args = System.Text.Json.JsonSerializer.Serialize(new { type = "mouseMoved", x = Math.Max(0, x), y = Math.Max(0, y), button = "none" });
        try { await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", args); }
        catch (Exception ex) { _onStatus("hover " + id + ": " + ex.Message); }
    }

    /// <summary>surface.scrub (2026-09-23): one trusted press - move, down, up - at a page point on a service's own scrubber, the person's slider
    /// seek for a player that follows nothing else (Peacock). A video window on the wall only; logged every time.</summary>
    public async Task ScrubAsync(string id, double x, double y, bool press = true)
    {
        if (Get(id) is { } st && IsParkable(st)) await WakeAsync(st);
        var tile = Get(id);
        if (tile is null || tile.Kind == SurfaceKind.Hidden || tile.View?.CoreWebView2 is not { } core) { _onStatus("scrub refused: " + id); return; }
        try
        {
            foreach (var (type, btn, count) in press ? new[] { ("mouseMoved", "none", 0), ("mousePressed", "left", 1), ("mouseReleased", "left", 1) } : new[] { ("mouseMoved", "none", 0) })
                await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", System.Text.Json.JsonSerializer.Serialize(new { type, x = Math.Max(0, x), y = Math.Max(0, y), button = btn, clickCount = count }));
            if (press) _onStatus("scrub " + id + " at " + Math.Round(x) + "," + Math.Round(y));
        }
        catch (Exception ex) { _onStatus("scrub " + id + ": " + ex.Message); }
    }

    /// <summary>B-295/B-289 (2026-09-23): a window the Watch page (or a minimize) covered completely came back see-through - the big
    /// window showing through its frame - while its page drew on at 120 fps and its XAML state was unchanged; a move or a one-pixel resize
    /// did nothing. Hiding the view for one tick and showing it again re-links its picture (verified on the wall: window 3 back, playing on).
    /// Every window on the wall gets it; nothing reloads, and the tick is too short for a muted video to pause.</summary>
    public int Nudge(string? skip = null) => Nudge(skip is null ? null : new[] { skip });
    public int Nudge(IReadOnlyCollection<string>? skip)
    {
        var views = _tiles.Values.Where(t => (skip is null || !skip.Contains(t.Id)) && t.View is not null && !t.HiddenPresence && t.Kind != SurfaceKind.Hidden && t.Container.Visibility == Visibility.Visible).Select(t => t.View!).ToList();
        foreach (var v in views) v.Visibility = Visibility.Collapsed;
        _canvas.DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () => { foreach (var v in views) v.Visibility = Visibility.Visible; });
        _onStatus("nudge: " + views.Count + " window(s) re-linked");
        return views.Count;
    }

    /// <summary>The re-link once the covering page has left the screen (it is still composed for a moment after its removal - a re-link
    /// 18 ms after Watch closed found the windows still covered, 2026-09-23), and once more in case the composition was slow. <paramref name="skip"/>:
    /// a window that was never covered (the big one in Watch's corner) - re-linking it made Peacock put its own controls back up.</summary>
    public void NudgeSoon(string? skip = null) => NudgeSoon(skip is null ? null : new[] { skip });
    public void NudgeSoon(IReadOnlyCollection<string>? skip)
    {
        // the timers are held until they fire (2026-10-06, "I went back to full screen video, and only had 1 + 2. Transparent with borders for 3-5":
        // a timer nothing referenced could be collected before its tick - one close of Watch logged no re-link at all, the next only the first);
        // and a third, later one for the windows the layout moves again after the second
        foreach (var ms in new[] { 400, 1500, 3500 })
        {
            var timer = _canvas.DispatcherQueue.CreateTimer();
            timer.Interval = TimeSpan.FromMilliseconds(ms);
            timer.IsRepeating = false;
            lock (_nudgeTimers) _nudgeTimers.Add(timer);
            timer.Tick += (t, __) => { lock (_nudgeTimers) _nudgeTimers.Remove(t); Nudge(skip); };
            timer.Start();
        }
    }
    private readonly List<Microsoft.UI.Dispatching.DispatcherQueueTimer> _nudgeTimers = new();

    /// <summary>Dev only (eval id "revive <how> <id>"): B-295 experiments - "vis" hides the view for a tick; "parent" takes it out of its host and back.</summary>
    public string DevRevive(string how, string id)
    {
        if (Get(id) is not { } t || t.View is not { } v) return "no view " + id;
        if (how == "vis") { v.Visibility = Visibility.Collapsed; _canvas.DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () => v.Visibility = Visibility.Visible); return "vis toggled " + id; }
        if (how == "parent" && v.Parent is Panel host) { var i = host.Children.IndexOf(v); host.Children.Remove(v); host.Children.Insert(Math.Max(0, i), v); return "reparented " + id; }
        return "unknown " + how;
    }

    /// <summary>Dev only (eval id "tiles"): each surface's own XAML state - its frame and the view in it, and everything laid over the view
    /// (B-295: the page drew at 120 fps while its window showed nothing).</summary>
    public string DevDump()
    {
        var sb = new System.Text.StringBuilder();
        foreach (var t in _tiles.Values)
        {
            var c = t.Container;
            sb.Append(t.Id).Append(" kind=").Append(t.Kind).Append(" vis=").Append(c.Visibility).Append(" op=").Append(c.Opacity.ToString("0.##"))
              .Append(" at=").Append(Canvas.GetLeft(c).ToString("0")).Append(',').Append(Canvas.GetTop(c).ToString("0")).Append(' ').Append(c.ActualWidth.ToString("0")).Append('x').Append(c.ActualHeight.ToString("0"))
              .Append(" z=").Append(Canvas.GetZIndex(c)).Append(" hiddenPresence=").Append(t.HiddenPresence);
            if (t.View is { } v) sb.Append(" | view vis=").Append(v.Visibility).Append(" op=").Append(v.Opacity.ToString("0.##")).Append(' ').Append(v.ActualWidth.ToString("0")).Append('x').Append(v.ActualHeight.ToString("0")).Append(" in=").Append((v.Parent as FrameworkElement)?.GetType().Name ?? "none");
            else sb.Append(" | no view");
            sb.Append(" | kids:");
            foreach (var k in c.Children.OfType<FrameworkElement>()) sb.Append(' ').Append(k.GetType().Name).Append('/').Append(k.Visibility == Visibility.Visible ? "v" : "c").Append('/').Append(k.Opacity.ToString("0.#"));
            sb.Append('\n');
        }
        return sb.ToString();
    }

    public async Task<string?> EvalOnTileAsync(string id, string js)
    {
        var tile = Get(id);
        if (tile is null) return "__prism_eval_error: unknown tile";
        if (tile.View is null) return "__prism_eval_error: view suspended/closed (tile is warm)";
        if (tile.View?.CoreWebView2 is not { } core) return "__prism_eval_error: CoreWebView2 not initialized";
        if (IsParkable(tile)) await WakeAsync(tile);
        try { return await core.ExecuteScriptAsync(js); }
        catch (Exception ex) { return "__prism_eval_error: " + ex.GetType().Name + ": " + ex.Message; }
    }

    public IEnumerable<(string Id, bool Covered, bool Peeked)> VeilStates() =>
        _tiles.Values.Select(t => (t.Id, t.Covered, t.Peeked));

    public event Action? CoverageChanged;

    public event Action<string>? FullscreenRequested;

    /// <summary>Fill slot: a HUMAN tap forwarded to the player's own
    /// fullscreen control (same doctrine as Skip - never self-initiated).
    /// The page's fullscreen element fills the WebView, i.e. the slot.</summary>
    public async Task RequestPlayerFullscreenAsync(string id)
    {
        const string js = @"(function(){
  function vis(e){return !!(e&&e.offsetWidth>0&&e.offsetHeight>0);}
  var cands=document.querySelectorAll('button,[role=button]');
  for(var i=0;i<cands.length;i++){var c=cands[i];
    if(c.hasAttribute('data-prism-veil')||c.hasAttribute('data-prism-ui'))continue;
    var name=((c.getAttribute('aria-label')||'')+' '+(c.getAttribute('title')||'')).trim();
    var cls=(typeof c.className==='string'?c.className:'')+' '+(c.getAttribute('data-a-target')||'')+' '+(c.getAttribute('data-testid')||'');
    if((/full\s*-?screen|fullscreen/i.test(name)||/fullscreen|full-screen/i.test(cls))&&vis(c)){c.click();return 'clicked';}}
  var v=document.querySelector('video');
  if(v&&v.requestFullscreen){v.requestFullscreen().catch(function(){});return 'requested';}
  return 'none';})()";
        var res = await EvalOnTileAsync(id, js);
        _onStatus($"fill-slot {id}: {res ?? "no view"}");
    }

    /// <summary>Break progress on the card - "◐ Intermission · Ad 1 of 2 · 0:14".
    /// Adapter observation (frame.adInfo) through core; display only.</summary>
    public void SetAdInfo(string id, string count, double remaining)
    {
        var tile = Get(id);
        if (tile is null) return;
        if (tile.Caption is { } time)
        {
            if (remaining >= 0)
            {
                var sec = (int)Math.Round(remaining);
                var clock = sec >= 3600
                    ? $"{sec / 3600}:{sec % 3600 / 60:00}:{sec % 60:00}"
                    : $"{sec / 60}:{sec % 60:00}";
                time.Text = clock + " left";
                time.Visibility = Visibility.Visible;
                tile.AdTimeLeft = clock + " left";
            }
            else { time.Visibility = Visibility.Collapsed; tile.AdTimeLeft = null; }
            if (tile.CardMinimal) ApplyArtAttribution(tile);   // the collapsed icon carries the time left too
        }
        if (tile.CountText is { } ct)
        {
            ct.Text = string.IsNullOrEmpty(count) ? "" : "Ad " + count;
            ct.Visibility = string.IsNullOrEmpty(count) ? Visibility.Collapsed : Visibility.Visible;
        }
    }

    public void HideIntermission(string id)
    {
        var tile = Get(id);
        if (tile is { Kind: SurfaceKind.Hidden }) { tile.Covered = false; _onStatus($"audio intermission down: {id}"); CoverageChanged?.Invoke(); return; }
        if (tile?.Intermission is not { } g) return;
        if (tile.SkipChip is { } chip) chip.Visibility = Visibility.Collapsed;
        tile.Covered = false;
        tile.Peeked = false;                                         // a peek never outlives its break
        tile.PeekTimer?.Stop();
        if (_peekBack.TryGetValue(tile.Id, out var backChip)) backChip.Visibility = Visibility.Collapsed;   // the peek's own way back goes with it
        SyncMutedStrip(tile);
        StopSkipHole(tile);
        if (tile.PeekChip is { } pc) pc.Content = "Show ad 15s";
        if (tile.Caption is { } cap) cap.Visibility = Visibility.Collapsed;
        if (tile.CountText is { } cnt) cnt.Visibility = Visibility.Collapsed;
        // The picture is gone, so its attribution goes with it - a stale caption
        // over the next image would be a wrong label, which is the one thing
        // spec 5 does not allow. CardMinimal is a per-tile CHOICE and persists.
        tile.ArtInfo = null;
        ApplyArtAttribution(tile);
        g.IsHitTestVisible = true;
        Fade(g, g.Opacity, 0, 150);                                  // uncover FAST (spec 26)
        SyncCornerX(tile);
        SyncAdDebug();
        _onStatus($"intermission down: {id}");
        CoverageChanged?.Invoke();
    }

    public void SetIntermissionSkip(string id, bool available, string? target = null)
    {
        var tile = Get(id);
        if (tile is null) return;
        tile.SkipTarget = available ? target : null;
        // The cutout - the player's OWN button, really visible and really
        // clickable through the veil - is the default; the card's chip is the
        // fallback when no control selector was observed.
        if (tile.SkipChip is { } chip)
            chip.Visibility = available && string.IsNullOrEmpty(target) ? Visibility.Visible : Visibility.Collapsed;
        if (available && !string.IsNullOrEmpty(target)) StartSkipHole(tile);
        else StopSkipHole(tile);
    }

    private void StartSkipHole(Tile tile)
    {
        if (tile.SkipHoleTimer is null)
        {
            var t = _canvas.DispatcherQueue.CreateTimer();
            t.Interval = TimeSpan.FromMilliseconds(500);
            t.IsRepeating = true;
            var captured = tile;
            t.Tick += async (_, __) => await PollSkipHoleAsync(captured);
            tile.SkipHoleTimer = t;
        }
        tile.SkipHoleTimer.Start();
        _ = PollSkipHoleAsync(tile);
    }

    private void StopSkipHole(Tile tile)
    {
        tile.SkipHoleTimer?.Stop();
        ClearHole(tile);
    }

    private async Task PollSkipHoleAsync(Tile tile)
    {
        if (!tile.Covered || tile.SkipTarget is not { Length: > 0 } sel) { StopSkipHole(tile); return; }
        var js = "(function(){var els=document.querySelectorAll(" + JsonSerializer.Serialize(sel) + ");"
            + "for(var i=0;i<els.length;i++){var e=els[i],r=e.getBoundingClientRect();"
            + "if(r.width>0&&r.height>0)return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height});}return null;})()";
        var raw = await EvalOnTileAsync(tile.Id, js);
        if (!tile.Covered) return;
        try
        {
            if (raw is null || raw == "null") { ClearHole(tile); return; }
            using var outer = JsonDocument.Parse(raw);
            if (outer.RootElement.ValueKind != JsonValueKind.String) { ClearHole(tile); return; }
            using var inner = JsonDocument.Parse(outer.RootElement.GetString()!);
            var r = inner.RootElement;
            SetHole(tile, r.GetProperty("x").GetDouble(), r.GetProperty("y").GetDouble(),
                r.GetProperty("w").GetDouble(), r.GetProperty("h").GetDouble());
        }
        catch { ClearHole(tile); }
    }

    /// <summary>Cut the veil open over the player's own Skip button: the four
    /// slab clips leave the button visible - and clickable, since every veil
    /// layer is hit-test invisible - with an amber ring marking the opening.</summary>
    private void SetHole(Tile tile, double x, double y, double w, double h)
    {
        if (tile.SubSlabs.Length != 4) return;
        const double pad = 4;
        x -= pad; y -= pad; w += pad * 2; h += pad * 2;
        double cw = tile.Rect.W, ch = tile.Rect.H;
        x = Math.Max(0, Math.Min(x, cw)); y = Math.Max(0, Math.Min(y, ch));
        w = Math.Max(0, Math.Min(w, cw - x)); h = Math.Max(0, Math.Min(h, ch - y));
        if (w < 8 || h < 8) { ClearHole(tile); return; }
        var rects = new[]
        {
            new Windows.Foundation.Rect(0, 0, cw, y),
            new Windows.Foundation.Rect(0, y + h, cw, Math.Max(0, ch - y - h)),
            new Windows.Foundation.Rect(0, y, x, h),
            new Windows.Foundation.Rect(x + w, y, Math.Max(0, cw - x - w), h),
        };
        for (var i = 0; i < 4; i++)
        {
            tile.SubSlabs[i].Clip = new RectangleGeometry { Rect = rects[i] };
            tile.ArtSlabs[i].Clip = new RectangleGeometry { Rect = rects[i] };
        }
        if (tile.SkipRing is { } ring)
        {
            ring.Margin = new Thickness(x - 2, y - 2, 0, 0);
            ring.Width = w + 4; ring.Height = h + 4;
            ring.Visibility = Visibility.Visible;
        }
    }

    private void ClearHole(Tile tile)
    {
        if (tile.SubSlabs.Length != 4) return;
        tile.SubSlabs[0].Clip = null; tile.ArtSlabs[0].Clip = null;
        for (var i = 1; i < 4; i++)
        {
            tile.SubSlabs[i].Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, 0, 0) };
            tile.ArtSlabs[i].Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, 0, 0) };
        }
        if (tile.SkipRing is { } ring) ring.Visibility = Visibility.Collapsed;
    }

    // ------------------------------------------------------- wall shot
    /// <summary>
    /// The wall shot as the wall looks (2026-09-23, "it was just a screenshot of the disney plus home page"): the windows on screen in their
    /// stacking order - never a hidden work or lookup page, which had been drawn full size over everything - each window's own page
    /// (a DRM-black frame gives way to the tile's poster), then Prism's own layers blended over it as they stand: a window's title bar and
    /// break card, the Watch page, and whatever the caller draws above the canvas (the stage bar, the menus, pop-ups).
    /// </summary>
    public async Task<string?> CaptureWallAsync(Func<byte[], int, int, Task>? above = null)
    {
        var cw = (int)Math.Max(1, _canvas.ActualWidth);
        var ch = (int)Math.Max(1, _canvas.ActualHeight);
        if (cw < 8 || ch < 8) return null;
        var wall = new byte[cw * ch * 4];
        for (var i = 0; i < wall.Length; i += 4) { wall[i] = 0x0F; wall[i + 1] = 0x0C; wall[i + 2] = 0x0A; wall[i + 3] = 0xFF; }
        var byContainer = _tiles.Values.ToDictionary(t => (UIElement)t.Container, t => t);
        var layers = _canvas.Children.Select((c, i) => (c, i)).OrderBy(x => Canvas.GetZIndex(x.c)).ThenBy(x => x.i).Select(x => x.c).ToList();
        foreach (var layer in layers)
        {
            if (!byContainer.TryGetValue(layer, out var tile)) { await BlendElementAsync(wall, cw, ch, layer); continue; }   // the Watch page and the rest of Prism's own
            if (tile.Kind == SurfaceKind.Hidden || tile.HiddenPresence || tile.Container.Visibility != Visibility.Visible || tile.Container.Opacity < 0.01) continue;
            var r = tile.Rect;
            int rx = (int)r.X, ry = (int)r.Y, rw = (int)r.W, rh = (int)r.H;
            if (rw < 2 || rh < 2) continue;
            if (tile.View?.CoreWebView2 is { } core)
            {
                byte[]? px = null;
                try
                {
                    using var mem = new InMemoryRandomAccessStream();
                    await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, mem);
                    mem.Seek(0);
                    var dec = await BitmapDecoder.CreateAsync(mem);
                    var data = await dec.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore,
                        new BitmapTransform { ScaledWidth = (uint)rw, ScaledHeight = (uint)rh, InterpolationMode = BitmapInterpolationMode.Linear },
                        ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
                    px = data.DetachPixelData();
                }
                catch { px = null; }
                if (px is null || AvgChannel(px) < 6)                    // DRM-black or no view
                {
                    px = new byte[rw * rh * 4];
                    for (var i = 0; i < px.Length; i += 4) { px[i] = 0x0F; px[i + 1] = 0x0C; px[i + 2] = 0x0A; px[i + 3] = 0xFF; }
                    // a protected frame is black to every capture, by design: the title's own picture stands in (2026-09-23), else the poster
                    if (!await ComposeTitleArtAsync(tile.Id, px, rw, rh)) await ComposePosterAsync(tile.Id, px, rw, rh);
                }
                for (var yy = 0; yy < rh; yy++)
                {
                    var wy = ry + yy; if (wy < 0 || wy >= ch) continue;
                    for (var xx = 0; xx < rw; xx++)
                    {
                        var wx = rx + xx; if (wx < 0 || wx >= cw) continue;
                        var si = (yy * rw + xx) * 4; var di = (wy * cw + wx) * 4;
                        wall[di] = px[si]; wall[di + 1] = px[si + 1]; wall[di + 2] = px[si + 2]; wall[di + 3] = 0xFF;
                    }
                }
            }
            // Prism's own layers on the window - everything in it but the page: the snapshot while it loads, the break card, the title bar,
            // a visualization's picture (a window with no page is all Prism's)
            foreach (var child in tile.Container.Children.ToList())
                if (!ReferenceEquals(child, tile.ViewHost)) await BlendElementAsync(wall, cw, ch, child);
        }
        if (above is not null) await above(wall, cw, ch);
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Prism");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "prism-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".png");
        using (var fs = File.Create(path))
        {
            var enc = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, fs.AsRandomAccessStream());
            enc.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore, (uint)cw, (uint)ch, 96, 96, wall);
            await enc.FlushAsync();
        }
        return path;
    }

    /// <summary>One of Prism's own XAML layers blended onto the wall shot where it stands (premultiplied alpha): a layer that holds no page.</summary>
    public async Task BlendElementAsync(byte[] wall, int cw, int ch, UIElement el)
    {
        if (el.Visibility != Visibility.Visible || el.Opacity < 0.01 || el is not FrameworkElement fe || fe.ActualWidth < 1 || fe.ActualHeight < 1) return;
        try
        {
            var o = fe.TransformToVisual(_canvas).TransformPoint(new Windows.Foundation.Point(0, 0));
            int ex = (int)Math.Round(o.X), ey = (int)Math.Round(o.Y), ew = (int)Math.Ceiling(fe.ActualWidth), eh = (int)Math.Ceiling(fe.ActualHeight);
            if (ex >= cw || ey >= ch || ex + ew <= 0 || ey + eh <= 0) return;
            var rtb = new RenderTargetBitmap();
            await rtb.RenderAsync(fe, ew, eh);
            int pw = rtb.PixelWidth, ph = rtb.PixelHeight;
            if (pw < 1 || ph < 1) return;
            var src = (await rtb.GetPixelsAsync()).ToArray();
            for (var yy = 0; yy < eh; yy++)
            {
                var wy = ey + yy; if (wy < 0 || wy >= ch) continue;
                var sy = Math.Min(ph - 1, yy * ph / eh);
                for (var xx = 0; xx < ew; xx++)
                {
                    var wx = ex + xx; if (wx < 0 || wx >= cw) continue;
                    var sx = Math.Min(pw - 1, xx * pw / ew);
                    var si = (sy * pw + sx) * 4; var a = src[si + 3];
                    if (a == 0) continue;
                    var di = (wy * cw + wx) * 4;
                    if (a == 255) { wall[di] = src[si]; wall[di + 1] = src[si + 1]; wall[di + 2] = src[si + 2]; continue; }
                    var k = 255 - a;
                    wall[di] = (byte)Math.Min(255, src[si] + wall[di] * k / 255);
                    wall[di + 1] = (byte)Math.Min(255, src[si + 1] + wall[di + 1] * k / 255);
                    wall[di + 2] = (byte)Math.Min(255, src[si + 2] + wall[di + 2] * k / 255);
                }
            }
        }
        catch { /* a layer that cannot be rendered is left out, never the shot */ }
    }

    /// <summary>Center the tile's cached poster over a substrate-filled tile
    /// buffer; silently does nothing when no poster is cached.</summary>
    /// <summary>The picture of what plays on a video window, as its service shows it (the host fetches it from core's word): the image's bytes, or null.</summary>
    public Func<string, Task<byte[]?>>? TitleArtFor;
    /// <summary>The title's picture over the whole window, cropped to fill it (UniformToFill). False when there is none.</summary>
    private async Task<bool> ComposeTitleArtAsync(string id, byte[] px, int rw, int rh)
    {
        if (TitleArtFor is null) return false;
        try
        {
            var bytes = await TitleArtFor(id);
            if (bytes is null || bytes.Length < 64) return false;
            using var mem = new InMemoryRandomAccessStream();
            await mem.WriteAsync(bytes.AsBuffer());
            mem.Seek(0);
            var dec = await BitmapDecoder.CreateAsync(mem);
            double iw = dec.PixelWidth, ih = dec.PixelHeight;
            if (iw < 2 || ih < 2) return false;
            var scale = Math.Max(rw / iw, rh / ih);
            var sw = (uint)Math.Max(rw, Math.Ceiling(iw * scale)); var sh = (uint)Math.Max(rh, Math.Ceiling(ih * scale));
            var data = await dec.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore,
                new BitmapTransform { ScaledWidth = sw, ScaledHeight = sh, InterpolationMode = BitmapInterpolationMode.Fant },
                ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
            var src = data.DetachPixelData();
            int ox = (int)((sw - rw) / 2), oy = (int)((sh - rh) / 2);
            for (var y = 0; y < rh; y++)
                for (var x = 0; x < rw; x++)
                {
                    var si = ((y + oy) * (int)sw + (x + ox)) * 4; var di = (y * rw + x) * 4;
                    px[di] = src[si]; px[di + 1] = src[si + 1]; px[di + 2] = src[si + 2]; px[di + 3] = 0xFF;
                }
            return true;
        }
        catch { return false; }
    }

    private async Task ComposePosterAsync(string id, byte[] px, int rw, int rh)
    {
        var posterPath = Path.Combine(_store.Root, "posters", id + ".img");
        if (!File.Exists(posterPath)) return;
        try
        {
            using var pf = File.OpenRead(posterPath);
            var pd = await BitmapDecoder.CreateAsync(pf.AsRandomAccessStream());
            var maxW = Math.Max(32.0, rw / 3.0); var maxH = Math.Max(32.0, rh / 3.0);
            var scale = Math.Min(1.0, Math.Min(maxW / pd.PixelWidth, maxH / pd.PixelHeight));
            var sw = (int)Math.Max(1, pd.PixelWidth * scale); var sh = (int)Math.Max(1, pd.PixelHeight * scale);
            var pdata = await pd.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied,
                new BitmapTransform { ScaledWidth = (uint)sw, ScaledHeight = (uint)sh, InterpolationMode = BitmapInterpolationMode.Fant },
                ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
            var pp = pdata.DetachPixelData();
            var ox = (rw - sw) / 2; var oy = (rh - sh) / 2;
            for (var yy = 0; yy < sh; yy++)
            {
                var ty = oy + yy; if (ty < 0 || ty >= rh) continue;
                for (var xx = 0; xx < sw; xx++)
                {
                    var tx = ox + xx; if (tx < 0 || tx >= rw) continue;
                    var si = (yy * sw + xx) * 4; var di = (ty * rw + tx) * 4;
                    int a = pp[si + 3];
                    if (a == 0) continue;
                    px[di] = (byte)(pp[si] + px[di] * (255 - a) / 255);
                    px[di + 1] = (byte)(pp[si + 1] + px[di + 1] * (255 - a) / 255);
                    px[di + 2] = (byte)(pp[si + 2] + px[di + 2] * (255 - a) / 255);
                }
            }
        }
        catch { /* poster is decoration - the substrate stands alone */ }
    }

    /// <summary>A window's picture, small and grey (2026-10-06, the logo watch's frames): null when there is no view or the capture fails.</summary>
    public async Task<byte[]?> CaptureGrayAsync(string id, int w, int h)
    {
        if (Get(id) is not { } t || t.View?.CoreWebView2 is not { } core) return null;
        try
        {
            using var mem = new InMemoryRandomAccessStream();
            await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Jpeg, mem);
            mem.Seek(0);
            var dec = await BitmapDecoder.CreateAsync(mem);
            var data = await dec.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore, new BitmapTransform { ScaledWidth = (uint)w, ScaledHeight = (uint)h, InterpolationMode = BitmapInterpolationMode.Linear }, ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
            var px = data.DetachPixelData();
            var g = new byte[w * h];
            for (int i = 0, j = 0; j < g.Length; i += 4, j++) g[j] = (byte)((px[i] * 29 + px[i + 1] * 150 + px[i + 2] * 77) >> 8);
            return g;
        }
        catch { return null; }
    }
    /// <summary>The break watch's look at a window (2026-10-06): the 320x180 grey frame the break model scores and, when asked, a
    /// 960x540 picture for the text reader - one capture for both.</summary>
    public async Task<(byte[] Gray, SoftwareBitmap? Big, byte[]? BigGray)?> CaptureForWatchAsync(string id, bool withBig)
    {
        if (Get(id) is not { } t || t.View?.CoreWebView2 is not { } core) return null;
        try
        {
            using var mem = new InMemoryRandomAccessStream();
            await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Jpeg, mem);
            mem.Seek(0);
            var dec = await BitmapDecoder.CreateAsync(mem);
            var data = await dec.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore, new BitmapTransform { ScaledWidth = BreakModel.W, ScaledHeight = BreakModel.H, InterpolationMode = BitmapInterpolationMode.Linear }, ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
            var px = data.DetachPixelData();
            var g = new byte[BreakModel.W * BreakModel.H];
            for (int i = 0, j = 0; j < g.Length; i += 4, j++) g[j] = (byte)((px[i] * 29 + px[i + 1] * 150 + px[i + 2] * 77) >> 8);
            SoftwareBitmap? big = null; byte[]? bigGray = null;
            if (withBig)
            {
                // one 960x540 read for both the text reader (its bitmap) and the QR finder (its grey)
                var bd = await dec.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, new BitmapTransform { ScaledWidth = 960, ScaledHeight = 540, InterpolationMode = BitmapInterpolationMode.Linear }, ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
                var bp = bd.DetachPixelData();
                big = SoftwareBitmap.CreateCopyFromBuffer(bp.AsBuffer(), BitmapPixelFormat.Bgra8, 960, 540, BitmapAlphaMode.Premultiplied);
                bigGray = new byte[960 * 540];
                for (int i = 0, j = 0; j < bigGray.Length; i += 4, j++) bigGray[j] = (byte)((bp[i] * 29 + bp[i + 1] * 150 + bp[i + 2] * 77) >> 8);
            }
            return (g, big, bigGray);
        }
        catch { return null; }
    }

    /// <summary>A signal the host read about a window, sent on as the page's own would be (the break watch's ad-break).</summary>
    public void PostAsPage(string id, string json) => ForwardWithId(id, json);

    // Two voices say a window is in a break: the page's own ad signal and the break watch (2026-10-07, an Ad debug report: YouTube TV
    // played its own Sponsored ad inside HGTV's break, the page's "ad over" a minute later took the cover down while the network's
    // commercials ran on and the break watch still read 99%). Core hears one: a break while either says so, over when both say over.
    private readonly Dictionary<string, bool> _pageAd = new(), _watchAd = new();

    /// <summary>The break watch's word on a window: posted on as the page's ad-break, joined with the page's own.</summary>
    public void WatchAdBreak(string id, bool active) => JoinAdBreak(id, () => _watchAd[id] = active);

    /// <summary>The page's own ad-break, joined with the break watch's (true when it was handled here).</summary>
    private bool PageAdBreak(string id, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("type", out var ty) || ty.GetString() != "ad-break"
                || !doc.RootElement.TryGetProperty("active", out var a) || (a.ValueKind != JsonValueKind.True && a.ValueKind != JsonValueKind.False)) return false;
            var on = a.ValueKind == JsonValueKind.True;
            JoinAdBreak(id, () => _pageAd[id] = on);
            return true;
        }
        catch { return false; }
    }

    private void JoinAdBreak(string id, Action set)
    {
        var was = _pageAd.GetValueOrDefault(id) || _watchAd.GetValueOrDefault(id);
        set();
        var now = _pageAd.GetValueOrDefault(id) || _watchAd.GetValueOrDefault(id);
        // each voice's own change still reaches core when the joined word is unchanged only if it says a break (a repeat true is harmless,
        // a lone false would end the other voice's break)
        if (now == was && !now) return;
        if (now == was) { _onStatus("ad-break " + id + ": still a break (page " + _pageAd.GetValueOrDefault(id) + ", break watch " + _watchAd.GetValueOrDefault(id) + ")"); return; }
        ForwardWithId(id, "{\"type\":\"ad-break\",\"active\":" + (now ? "true" : "false") + "}");
    }

    /// <summary>The wall's windows whose page is at an address containing this (the logo watch's choice of windows).</summary>
    public List<string> TilesAt(string part) => _tiles.Values.Where(t => t.Kind != SurfaceKind.Hidden && !t.HiddenPresence && (t.View?.Source?.ToString() ?? "").Contains(part, StringComparison.OrdinalIgnoreCase)).Select(t => t.Id).ToList();

    private static double AvgChannel(byte[] px)
    {
        long sum = 0; var n = 0;
        for (var i = 0; i + 2 < px.Length; i += 64) { sum += px[i] + px[i + 1] + px[i + 2]; n += 3; }
        return n == 0 ? 255 : sum / (double)n;
    }

    // ---------------------------------------------------------- diagnostics
    /// <summary>EME probe for the M1 report (§12 windows tests): logs per-tile robustness.</summary>
    public event Action<string, string>? EmeResult;

    public async Task ProbeEmeAsync(string id)
    {
        if (Get(id)?.View?.CoreWebView2 is { } core) await core.ExecuteScriptAsync(EmeProbeJs);
    }

    public IEnumerable<string> LiveTileIds() => _tiles.Where(t => t.Value.View is not null).Select(t => t.Key);

    /// <summary>App-close snapshot pass (§18 persistence): freeze every live
    /// tile so the next boot shows the last dashboard within ~2s (§8/§16).</summary>
    /// <summary>Close time (2026-09-08): every timer that draws into the window stops before the window tears down - a
    /// now-playing tick into the torn-down tree ended the host as a stowed exception (0xc000027b, E_UNEXPECTED from XAML).</summary>
    public void StopTimers()
    {
        foreach (var t in _tiles.Values.ToArray())
        {
            try { t.NpTimer?.Stop(); } catch { }
            try { t.Viz?.Dispose(); } catch { }
        }
    }

    public async Task FreezeAllAsync()
    {
        foreach (var id in LiveTileIds().ToArray())
        {
            try { await FreezeAsync(id); } catch { }
        }
    }

    // ------------------------------------------------------------- helpers
    private Tile? Get(string id) => _tiles.TryGetValue(id, out var t) ? t : null;

    private Tile GetOrCreateVisual(string id)
    {
        if (_tiles.TryGetValue(id, out var existing)) return existing;
        var substrate = new Border { Background = new SolidColorBrush(Dark) };
        var snap = new Image { Stretch = Stretch.UniformToFill };
        var overlay = new Grid { IsHitTestVisible = false };
        var shield = new Border { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), Visibility = Visibility.Collapsed };
        long lastShieldMove = 0;
        shield.PointerMoved += (_, __) => { var now = Environment.TickCount64; if (now - lastShieldMove > 1500) { lastShieldMove = now; PageInteraction?.Invoke(id); } };
        shield.PointerPressed += (_, __) => ShieldPressed?.Invoke(id);
        overlay.Children.Add(substrate);
        overlay.Children.Add(snap);
        var container = new Grid();
        // The WebView lives in a Canvas: a Canvas never layout-clips its
        // children, so a zoomed-out view (laid out LARGER than the slot, then
        // scaled down) shows the whole reflowed page instead of a clipped corner.
        var viewHost = new Canvas();
        container.Children.Add(viewHost);
        container.Children.Add(shield);                                // the stage shield, beneath the overlay's own controls
        container.Children.Add(overlay);                               // overlay stays last = on top
        _canvas.Children.Add(container);
        var tile = new Tile { Id = id, Profile = id, Container = container, ViewHost = viewHost, Overlay = overlay, SnapImage = snap, Shield = shield };
        _tiles[id] = tile;
        return tile;
    }

    /// <summary>Dev only: each move or resize of a surface, for the hover that comes and goes (2026-09-25).</summary>
    public static Action<string>? DevTrace;
    private void ApplyRect(Tile tile, ChannelRect r)
    {
        DevTrace?.Invoke("rect " + tile.Id + " " + (int)r.X + "," + (int)r.Y + " " + (int)r.W + "x" + (int)r.H + (tile.Rect.X == r.X && tile.Rect.Y == r.Y && tile.Rect.W == r.W && tile.Rect.H == r.H ? " (same)" : ""));
        tile.Rect = r;
        Canvas.SetLeft(tile.Container, tile.HiddenPresence ? -(Math.Max(1, r.W) + 64) : r.X);   // hidden: parked left of the canvas, full size
        Canvas.SetTop(tile.Container, tile.HiddenPresence ? 0 : r.Y);
        tile.Container.Width = Math.Max(0, r.W);
        tile.Container.Height = Math.Max(0, r.H);
        ApplyViewport(tile);                                          // the fit follows the rect
    }

    // 2026-09-23: the wall died at every boot (stowed 0xc000027b / E_UNEXPECTED in BitmapSource.SetSource) once the boot cache held
    // two snapshots that still existed - multiview's windows. The synchronous SetSource over a managed stream adapter reads on a
    // pool thread that calls back into the UI thread; the second in a row failed. The file is read whole here and decoded by the
    // async call from native memory; the latest request for an image wins if an older decode finishes after it.
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<Image, string> _imageWanted = new();
    private static async void TrySetImage(Image img, string path)
    {
        try
        {
            if (!File.Exists(path)) return;
            _imageWanted.AddOrUpdate(img, path);
            var bytes = File.ReadAllBytes(path);
            using var ms = new InMemoryRandomAccessStream();
            await ms.WriteAsync(bytes.AsBuffer());
            ms.Seek(0);
            var bmp = new BitmapImage();
            await bmp.SetSourceAsync(ms);
            if (_imageWanted.TryGetValue(img, out var want) && want == path) img.Source = bmp;
        }
        catch { }
    }

    private void ForwardWithId(string id, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object ||
                !doc.RootElement.TryGetProperty("type", out _)) return;
            var dict = new Dictionary<string, object?>();
            foreach (var p in doc.RootElement.EnumerateObject()) dict[p.Name] = JsonValue(p.Value);
            dict["id"] = id;
            _forwardEvent(id, JsonSerializer.Serialize(dict));
        }
        catch { }
    }

    private static object? JsonValue(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        _ => e.Clone(),
    };

    /// <summary>~60fps manual fade — the composition-layer skeleton's crossfade.</summary>
    private void Fade(UIElement el, double from, double to, double durationMs)
    {
        if (durationMs <= 0) { el.Opacity = to; return; }
        var timer = _canvas.DispatcherQueue.CreateTimer();
        var t0 = Environment.TickCount64;
        timer.Interval = TimeSpan.FromMilliseconds(16);
        timer.Tick += (_, __) =>
        {
            var k = Math.Min(1.0, (Environment.TickCount64 - t0) / durationMs);
            el.Opacity = from + (to - from) * k;
            if (k >= 1) timer.Stop();
        };
        timer.Start();
    }

    private static async Task<bool> LooksBlackAsync(IRandomAccessStream png)
    {
        try
        {
            var decoder = await BitmapDecoder.CreateAsync(png);
            var data = await decoder.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore,
                new BitmapTransform { ScaledWidth = 32, ScaledHeight = 18, InterpolationMode = BitmapInterpolationMode.NearestNeighbor },
                ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
            var px = data.DetachPixelData();
            long sum = 0;
            for (var i = 0; i < px.Length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
            return sum / (px.Length / 4.0 * 3.0) < 6;                  // avg channel < 6/255 ≈ black
        }
        catch { return false; }
    }

    /// <summary>Injected into every tile at document creation: readiness + the
    /// adapter frame API, reported as SurfaceEvents through the host (§16/§5).</summary>
    private const string TileBootstrapJs = @"
(function () {
  if (window.__prismTileBooted) return; window.__prismTileBooted = true;
  var post = function (o) { try { window.chrome.webview.postMessage(JSON.stringify(o)); } catch (e) {} };
  // Media the document cannot show: an element inside a shadow root (music-* custom elements) or never attached to
  // the DOM plays all the same, and document.querySelectorAll never lists it - Amazon Music's station played on,
  // muted, while every scan below saw no element (2026-09-16). play() is wrapped before any page script runs and the
  // element remembered; mediaList() is what both scans read.
  var offDom = [];
  try {
    var origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      try { if (offDom.indexOf(this) < 0) { offDom.push(this); if (offDom.length > 24) offDom.shift(); } } catch (e) {}
      return origPlay.apply(this, arguments);
    };
  } catch (e) {}
  // B-226 (2026-09-17): a keepalive is not media. Apple Music's page holds an 11 s MUTED blob: audio element that it
  // restarts the moment it ends, all the while the player is paused (host.log 15:38, named by the ended signal below):
  // the scans read it as playing, so a paused Apple showed as playing and every restart cost a report round trip.
  // A muted element shorter than 15 s is that: nothing a person would hear or watch.
  var keepalive = function (m) { try { return !!m.muted && isFinite(m.duration) && m.duration > 0 && m.duration < 15; } catch (e) { return false; } };
  var mediaList = function () {
    var out = [], list = document.querySelectorAll('video,audio'), i;
    for (i = 0; i < list.length; i++) { if (!keepalive(list[i])) out.push(list[i]); }
    for (i = 0; i < offDom.length; i++) { if (out.indexOf(offDom[i]) < 0 && !keepalive(offDom[i])) out.push(offDom[i]); }
    return out;
  };
  window.__prismMediaList = mediaList;
  var fired = false;
  var firstPaint = function () { if (!fired) { fired = true; post({ type: 'first-paint' }); } };
  requestAnimationFrame(function () { requestAnimationFrame(firstPaint); });
  addEventListener('load', function () { setTimeout(firstPaint, 300); });
  // The per-tile bridge core's FRAME_PRELUDE_JS binds window.frame to
  // (adapters.ts): the prelude REPLACES any window.frame, so the shell's job
  // is to provide PrismTile, not frame itself. (frame.adBreak was a silent
  // no-op without this - YouTube ads showed uncovered, 2026-08-31.)
  window.PrismTile = {
    notifyReady: function () { post({ type: 'adapter-ready' }); },
    notifyAdBreak: function (a) { post({ type: 'ad-break', active: !!a }); },
    notifySkipAvailable: function (a, t) { post({ type: 'skip-available', available: !!a, target: t || undefined }); },
    notifyAdInfo: function (c, r) { post({ type: 'ad-info', count: c || undefined, remaining: (r == null || r < 0) ? undefined : +r }); },
    notifyPosition: function (p, d) { post({ type: 'media-position', position: +p || 0, duration: (d == null || d < 0) ? null : +d }); },
    // Quick play cross-service lookup (2026-09-16): an adapter's musicLookup script answers core's question (search /
    // add to playlist / station from song) with the token core handed it; core matches the answer to its wait
    notifyMusicResult: function (r) { try { post({ type: 'music-result', token: String(r && r.token || ''), op: String(r && r.op || 'lookup'), ok: !!(r && r.ok), candidates: (r && r.candidates) || undefined, error: (r && r.error) ? String(r.error) : undefined, count: (r && typeof r.count === 'number') ? r.count : undefined, total: (r && typeof r.total === 'number') ? r.total : undefined }); } catch (e) {} },
  };
  // a person's tap only (2026-09-28): a pointer event an adapter's own script dispatches is the wall's doing, not the person's - core reads
  // 'interaction' as the person acting (the resume after a restart stands aside for it, a stopped autoplay is let go)
  addEventListener('pointerdown', function (e) { if (e.isTrusted) post({ type: 'interaction' }); }, true);
  // the EME trace (2026-09-21, 'paramount reports 480p but is capable of 4k through Edge'): which key system and robustness the
  // page's player asks for and is granted - host.log 'page eme'. A read of the page's own calls, never a change to them.
  // which keys the player binds to its video, and their key statuses as the license answers (usable / output-restricted)
  // the HDCP answer made MONOTONIC (2026-09-21, B-260): this runtime's PlayReady CDM answers getStatusForPolicy 'usable' for
  // HDCP 2.2 and 'output-restricted' for 1.1 to 2.1 on the same keys at the same moment - an engaged 2.2 link satisfies every
  // lower version, so a lower ask is answered from the highest version the CDM itself attests. Never a claim the CDM did not
  // make: a version the CDM calls restricted stays restricted unless a HIGHER one is usable. Paramount+ asks 1.4 for HD.
  (function () { try { var gs = MediaKeys.prototype.getStatusForPolicy; var order = ['1.0', '1.1', '1.2', '1.3', '1.4', '2.0', '2.1', '2.2', '2.3']; MediaKeys.prototype.getStatusForPolicy = function (policy) { var mk = this; var p = gs.apply(mk, arguments); var v = policy && policy.minHdcpVersion; var at = order.indexOf(v); if (at < 0) return p; return p.then(function (st) { if (st !== 'output-restricted') return st; var higher = order.slice(at + 1); return (function next(i) { if (i >= higher.length) return st; return gs.call(mk, { minHdcpVersion: higher[i] }).then(function (h) { if (h === 'usable') { post({ type: 'prism-eme', hdcp: v, answered: 'usable via ' + higher[i] }); return 'usable'; } return next(i + 1); }, function () { return next(i + 1); }); })(0); }); }; } catch (e) {} })();
  (function () { try { var cm = MediaKeySystemAccess.prototype.createMediaKeys; MediaKeySystemAccess.prototype.createMediaKeys = function () { var a = this; var rob = []; try { rob = (a.getConfiguration().videoCapabilities || []).map(function (v) { return v.robustness || '-'; }).slice(0, 3); } catch (e) {} post({ type: 'prism-eme', created: a.keySystem, robustness: rob }); var r = cm.apply(a, arguments); r.then(function (mk) { try { mk.__prismKs = a.keySystem + ' ' + rob.join('/'); } catch (e) {} }, function () {}); return r; }; } catch (e) {} })();
  (function () { try { var sm = HTMLMediaElement.prototype.setMediaKeys; HTMLMediaElement.prototype.setMediaKeys = function (mk) { try { post({ type: 'prism-eme', bound: mk ? (mk.__prismKs || 'untagged') : 'none' }); } catch (e) {} return sm.apply(this, arguments); }; var cs = MediaKeys.prototype.createSession; MediaKeys.prototype.createSession = function () { var mk = this; var sess = cs.apply(this, arguments); try { sess.addEventListener('keystatuseschange', function () { try { var st = {}; sess.keyStatuses.forEach(function (v) { st[v] = (st[v] || 0) + 1; }); post({ type: 'prism-eme', keys: mk.__prismKs || 'untagged', statuses: st }); } catch (e) {} }); } catch (e) {} return sess; }; } catch (e) {} })();
  (function () { try { var orig = Navigator.prototype.requestMediaKeySystemAccess; if (!orig) return; Navigator.prototype.requestMediaKeySystemAccess = function (ks, cfgs) { var want = []; try { for (var i = 0; i < cfgs.length; i++) { var vc = cfgs[i].videoCapabilities || []; for (var j = 0; j < vc.length && j < 3; j++) want.push((vc[j].robustness || '-') + ':' + String(vc[j].contentType || '').slice(0, 40)); } } catch (e) {} var p = orig.apply(this, arguments); p.then(function (a) { try { var c = a.getConfiguration(); var got = (c.videoCapabilities || []).map(function (v) { return (v.robustness || '-') + ':' + String(v.contentType || '').slice(0, 40); }); post({ type: 'prism-eme', ks: ks, want: want.slice(0, 6), got: got.slice(0, 4) }); } catch (e) {} }, function (e) { post({ type: 'prism-eme', ks: ks, want: want.slice(0, 6), error: String(e && e.name) }); }); return p; }; } catch (e) {} })();
  // the page's own console errors, forwarded to the host's log (a player's reason for its error, 2026-09-21); at most one a
  // second, the first 240 characters, never to core
  (function () { var last = 0; var orig = console.error; console.error = function () { try { var now = Date.now(); if (now - last > 1000) { last = now; var parts = []; for (var i = 0; i < arguments.length && i < 4; i++) { var a = arguments[i]; parts.push(typeof a === 'string' ? a : (a && a.message) ? a.message : String(a)); } post({ type: 'prism-console', text: parts.join(' ').slice(0, 240) }); } } catch (e) {} return orig.apply(console, arguments); }; })();
  var lastMove = 0;   // the stage bar rides a pointer MOVE too (a tap pauses most players): host-only, never an interaction for core's keeper
  addEventListener('pointermove', function () { var now = Date.now(); if (now - lastMove > 1500) { lastMove = now; post({ type: 'pointer-move' }); } }, true);
  // Spec 32 Media Session capture: the page registers its own handlers for
  // the OS media keys. Remembering them lets Prism's player control run the
  // service's own next / previous / seek - the page's code, on a human's tap.
  var handlers = {};
  try {
    var ms = navigator.mediaSession;
    if (ms && typeof ms.setActionHandler === 'function') {
      var origSet = ms.setActionHandler.bind(ms);
      ms.setActionHandler = function (action, fn) {
        if (typeof fn === 'function') handlers[action] = fn; else delete handlers[action];
        return origSet(action, fn);
      };
    }
  } catch (e) {}
  window.__prismMediaAction = function (action) {
    var fn = handlers[action];
    if (typeof fn !== 'function') return false;
    try { fn({ action: action }); return true; } catch (e) { return false; }
  };
  // Now-playing report (spec 32): what the Media Session says (title, artist,
  // artwork) and where the audible element is. Polled; edges are posted, the
  // position on a slow cadence for the progress bar. null = nothing to show.
  var lastNP = '';
  var lastPosPost = 0;
  // the service's library as the adapter's musicLibrary script gathered it (Apple Music: MusicKit) - carried
  // with the report, and on its own while nothing plays: the quick-play menu is wanted BEFORE anything plays
  var libNow = function () { try { var l = window.__prismMusicLibrary; return l && l.cache ? l.cache : null; } catch (e) { return null; } };
  // VP-2 (2026-09-19): a VIDEO adapter's library (Continue Watching, My List) and face, carried on the same report (core video.ts)
  var vlibNow = function () { try { var l = window.__prismVideoLibrary; return l && l.cache ? l.cache : null; } catch (e) { return null; } };
  var vctxNow = function () { try { return typeof window.__prismVideoContext === 'function' ? window.__prismVideoContext() : null; } catch (e) { return null; } };
  var vprofNow = function () { try { return typeof window.__prismVideoProfiles === 'function' ? window.__prismVideoProfiles() : null; } catch (e) { return null; } };
  var vliveNow = function () { try { var l = window.__prismVideoLive; return l && l.cache ? l.cache : null; } catch (e) { return null; } };
  var npDiag = { runs: 0, posts: 0, lastErr: null, lastPlaying: null, beatRuns: 0 };
  window.__prismNpDiag = npDiag;
  // B-198: every periodic scan is registered here. The host beats once a second (SurfaceManager._beat); a scan whose
  // own interval has not run for longer than its period (+1.5 s) runs from the beat instead - Pandora's first pause
  // cleared the intervals this script armed at document creation (2026-09-14), a page's timer sweep the script cannot
  // prevent. An adapter's tick (window.__prismAdapterTick) is beaten the same way.
  var beats = [];
  var every = function (fn, ms) { var b = { fn: fn, ms: ms, at: Date.now() }; beats.push(b); setInterval(function () { b.at = Date.now(); fn(); }, ms); return b; };
  window.__prismBeat = function () {
    var now = Date.now();
    for (var i = 0; i < beats.length; i++) { var b = beats[i]; if (now - b.at > b.ms + 1500) { b.at = now; npDiag.beatRuns++; try { b.fn(); } catch (e) {} } }
    try { if (typeof window.__prismAdapterTick === 'function') window.__prismAdapterTick(); } catch (e) {}
  };
  var npScan = function () {
    try {
      npDiag.runs++;
      var ms2 = navigator.mediaSession;
      var md = ms2 ? ms2.metadata : null;
      var list = mediaList();
      var el = null;
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (!m.paused && m.readyState >= 2) { el = m; break; }
        if (!el && m.readyState >= 1 && m.duration > 0) el = m;
      }
      if (!md && !el) {
        var lib0 = libNow();
        var vlib0 = vlibNow();
        var vprof0 = vprofNow();
        var vlive0 = vliveNow();
        // a page's own error with no media element left (2026-10-05, Netflix's 'Too many people are using your account right now' modal: the
        // video is gone, so nothing below ran and core never heard the error) is posted as the video context on its own
        var verr0 = (function () { var c = vctxNow(); return c && c.kind === 'error' ? c : null; })();
        if (lib0 || vlib0 || vprof0 || vlive0 || verr0) { var lk = 'lib:' + JSON.stringify(lib0) + '|' + JSON.stringify(vlib0) + '|' + JSON.stringify(vprof0) + '|' + JSON.stringify(vlive0) + '|' + JSON.stringify(verr0); if (lk !== lastNP) { lastNP = lk; post({ type: 'now-playing', info: { playing: false, library: lib0, videoLibrary: vlib0, videoProfiles: vprof0, videoLive: vlive0, video: verr0 } }); } return; }
        if (lastNP !== '') { lastNP = ''; post({ type: 'now-playing', info: null }); }
        return;
      }
      var art = null;
      if (md && md.artwork && md.artwork.length) { var best = md.artwork[md.artwork.length - 1]; art = (best && best.src) || null; }
      // the collection (album / playlist / station) as the PAGE reports it, through the adapter's probe when it has one;
      // its `playing` (the page's own transport: Pandora's Pause control) may assert playing where no element in the
      // document says so (B-132)
      var ctx = (function () { try { return typeof window.__prismMusicContext === 'function' ? window.__prismMusicContext() : null; } catch (e) { return null; } })();
      var vctx = vctxNow();
      var info = {
        playing: !!(el && !el.paused) || !!(ctx && ctx.playing === true) || !!(vctx && vctx.playing === true),
        // No document.title fallback (this block is a C# verbatim string: no
        // double quotes below). Media Session metadata is what the page SAYS is
        // playing; the tab title is not. On music.apple.com the fallback reported
        // the tab title - Apple Music - Web Player - as a track name for a promo
        // loop (observed on the wall 2026-09-03), and concept-scenes 2.5.2 point
        // 3 (P4) is explicit that a missing title leaves line 1 EMPTY rather than
        // promoting something else. An empty line is honest; a page title in the
        // track slot is confidently wrong on a wall a room can see.
        title: md && md.title ? md.title : '',
        artist: md && md.artist ? md.artist : '',
        album: md && md.album ? md.album : '',
        artwork: art,
        // the collection (album / playlist / station) as the PAGE reports it, through the adapter's probe when it has one
        context: ctx,
        library: libNow(),
        video: vctx,
        videoLibrary: vlibNow(),
        videoPlayState: (function () { try { return window.__prismVideoPlayState || null; } catch (e) { return null; } })(),
        videoProfiles: vprofNow(),
        videoLive: vliveNow(),
        playState: (function () { try { return window.__prismMusicPlayState || null; } catch (e) { return null; } })(),
        actions: Object.keys(handlers)
      };
      var key = JSON.stringify(info);
      var now = Date.now();
      if (key !== lastNP || (info.playing && now - lastPosPost > 4000)) {
        lastNP = key; lastPosPost = now;
        info.position = el && isFinite(el.currentTime) ? el.currentTime : null;
        info.duration = el && isFinite(el.duration) && el.duration > 0 ? el.duration : null;
        // B-148: the page's own clock wins when the adapter reads one - Pandora's un-paused element can be the
        // pre-buffered NEXT track, parked at 0.2 s while the tuner bar counts the current one
        if (ctx && typeof ctx.position === 'number') { info.position = ctx.position; if (typeof ctx.duration === 'number' && ctx.duration > 0) info.duration = ctx.duration; }
        if (vctx && typeof vctx.position === 'number' && info.position === null) { info.position = vctx.position; if (typeof vctx.duration === 'number' && vctx.duration > 0) info.duration = vctx.duration; }
        post({ type: 'now-playing', info: info });
        npDiag.posts++;
      }
      npDiag.lastPlaying = info.playing;
    } catch (e) { npDiag.lastErr = String(e && e.message || e); }
  };
  every(npScan, 1000);
  // B-132: a report on demand (core asks on every playback signal) and on the media events themselves - the
  // interval alone went silent on Pandora while the page played
  // coalesced: a media transition raises several events within milliseconds (ended, emptied, playing) and each
  // asked for a report - three reports in three milliseconds repainted the face and re-toggled the stage feed and
  // the audio capture each time (2026-09-07). One report, 120 ms after the last ask.
  // ... and a second look 700 ms later: the media element pauses at once, the page's own transport (Pandora's Pause
  // control, the adapter's context.playing) re-renders after it, and a pause event raised inside the 120 ms window
  // was dropped - the one report said playing (B-198, 2026-09-14). The second scan posts only when something changed.
  var reportPending = null;
  var reportAgain = null;
  window.__prismReportNow = function () {
    if (reportPending) return;
    reportPending = setTimeout(function () {
      reportPending = null; lastNP = ''; lastPosPost = 0; npScan();
      if (reportAgain) clearTimeout(reportAgain);
      reportAgain = setTimeout(function () { reportAgain = null; npScan(); }, 700);
    }, 120);
  };
  ['playing', 'pause', 'ended', 'emptied'].forEach(function (ev) { addEventListener(ev, function () { setTimeout(window.__prismReportNow, 50); }, true); });
  // B-148 (2026-09-08): an off-canvas surface is an occluded window to Chromium, and its timers are throttled to about
  // one run a minute - the 1 s interval above ran five times in ten minutes of Pandora, so the clock sat still (and the
  // B-132 reporter 'went silent'). Media events are not throttled: the playing element's timeupdate drives a report
  // every few seconds instead.
  var lastTimeUpdate = 0;
  addEventListener('timeupdate', function () { var n = Date.now(); if (n - lastTimeUpdate > 3000) { lastTimeUpdate = n; window.__prismReportNow(); } }, true);
  // Prism's own keys must work while the page has focus: Esc closes a Prism
  // overlay, F8 / F10 / F11 are the host's. Forwarded, never swallowed - the
  // page still sees them (its own Esc handling keeps working).
  var lastKeyInteraction = 0;
  addEventListener('keydown', function (e) {
    // a person's key only (2026-10-06: turning captions off from Prism's menu also opened Watch and made the video small): an
    // adapter closing the service's own menu with a scripted Escape (Apple TV's tracks, Apple Music's row menu) is not the person's Esc for Prism
    if (e.isTrusted && (e.key === 'Escape' || e.key === 'F8' || e.key === 'F10' || e.key === 'F11')) post({ type: 'prism-hostkey', key: e.key });
    // Ctrl+Shift+W opens Watch (2026-09-28) - and is kept from the page (a browser closes its window on it)
    if (e.isTrusted && e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'W' || e.key === 'w')) { e.preventDefault(); e.stopImmediatePropagation(); post({ type: 'prism-hostkey', key: 'Ctrl+Shift+W' }); return; }
    // the universal player (2026-09-21): while the player's own fullscreen is up (the stage), the transport keys are Prism's -
    // Space, the arrows, Enter - taken from the page so it does not act on them too (its own controls are hidden then).
    // Only a person's key (isTrusted): an adapter's own key event is the wall's verb on its way to the player (Netflix and
    // Disney+ seek by their players' keys) - taken here it never arrived, and came back as a new stage key, a loop (B-261)
    if (e.isTrusted && document.fullscreenElement && (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') && !(e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) {
      post({ type: 'prism-hostkey', key: e.key === ' ' ? 'Space' : e.key });
      e.preventDefault(); e.stopPropagation();
    }
    // B-42: a key is human input too (a human Esc out of fullscreen is the human's intent, never fought - spec 26);
    // throttled so typing a search does not flood the channel
    var now = Date.now();
    if (now - lastKeyInteraction > 400) { lastKeyInteraction = now; post({ type: 'interaction' }); }
  }, true);
  // Playback reporting - the fuel of the audio-focus machine (spec 3): the
  // audible tile is the one the human last made audible. Netflix's player
  // never let media events reach even window-capture listeners (2026-08-31),
  // so propagation is NOT trusted: observed state is POLLED, events merely
  // trigger an immediate re-scan. Edges are reported, plus any never-seen
  // playing element (covers 1-to-1 player swaps behind a muted trailer).
  var lastPlaying = false;
  var seenPlaying = (typeof WeakSet === 'function') ? new WeakSet() : { has: function () { return true; }, add: function () {} };
  var scan = function () {
    try {
      var found = [];
      var list = mediaList();
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (!m.paused && m.readyState >= 2) found.push(m);
      }
      var now = found.length > 0;
      var fresh = false;
      for (var j = 0; j < found.length; j++) { if (!seenPlaying.has(found[j])) { fresh = true; seenPlaying.add(found[j]); } }
      if (now !== lastPlaying || (now && fresh)) {
        lastPlaying = now;
        post({ type: 'playback', playing: now });
      }
    } catch (e) {}
  };
  // B-123: the adapter's session watch (window.__prismSession) - posted on change only
  var lastSession = '';
  every(function () { try { var s = window.__prismSession || ''; if (s && s !== lastSession) { lastSession = s; post({ type: 'session', state: s }); } } catch (e) {} }, 1500);
  every(scan, 800);
  var kick = function () { setTimeout(scan, 0); };
  addEventListener('playing', kick, true);
  addEventListener('pause', kick, true);
  // B-42: the media `ended` event carries its own marker so core's presentation keeper / onEnd can
  // tell an end from a pause (a bare playing:false is doubt - nothing happens - by design)
  addEventListener('ended', function (e) {
    var el = e.target;
    if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') && !keepalive(el)) {
      lastPlaying = false;
      // B-226 (2026-09-17): the element is named in the signal (core ignores the extra fields; host.log shows them) - which
      // element Apple Music's idle page restarts every few seconds was unknown from the outside
      var name = {};
      try { name = { dur: el.duration, src: String(el.currentSrc || el.src || '').slice(0, 48), inDom: document.contains(el), muted: el.muted, vol: el.volume, loop: el.loop }; } catch (e) {}
      post({ type: 'playback', playing: false, ended: true, el: name });
    }
    kick();
  }, true);
  addEventListener('emptied', kick, true);
  addEventListener('volumechange', function (e) {
    // in-page unmute of a playing player = audible intent NOW; the edge
    // logic would stay silent (already playing), so post directly
    var el = e.target;
    if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') && !el.paused && !el.muted && el.volume > 0) {
      post({ type: 'playback', playing: true });
    }
    kick();
  }, true);
})();";

    private const string EmeProbeJs = @"
(async () => {
  async function probe(ks, list) {
    for (const r of list) {
      try {
        const cfg = [{ initDataTypes: ['cenc'],
          videoCapabilities: [{ contentType: 'video/mp4; codecs=""avc1.640028""', robustness: r }],
          audioCapabilities: [{ contentType: 'audio/mp4; codecs=""mp4a.40.2""', robustness: '' }] }];
        const a = await navigator.requestMediaKeySystemAccess(ks, cfg);
        return a.getConfiguration().videoCapabilities[0].robustness || r || 'accepted-any';
      } catch (e) {}
    }
    return 'rejected';
  }
  const playready = await probe('com.microsoft.playready.recommendation', ['3000', '2000', '']);
  const widevine = await probe('com.widevine.alpha', ['HW_SECURE_ALL', 'SW_SECURE_DECODE', 'SW_SECURE_CRYPTO', '']);
  window.chrome.webview.postMessage(JSON.stringify({ type: 'eme', playready, widevine }));
})();";
}
