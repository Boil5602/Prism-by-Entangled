using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;
using PrismHost.Visualizations;
using Microsoft.UI.Xaml.Shapes;

namespace PrismHost;

/// <summary>
/// Visualizations on the wall (dashboard-schema §32): the surface itself is
/// core-placed (surface.createVisualization → SurfaceManager, fed by
/// surface.setVisualizationFeed and the WASAPI FFT); SM-3 plugs the four
/// style packs into its renderer registry and adds what the surface does not
/// carry - the hit-testable chrome (the surface is not hit-testable by design:
/// a tap belongs to the placement).
///
/// The chrome IS the Prism Beams composition's furniture
/// (docs/concept-scenes.md §2.5.2), a thin overlay on each visualization
/// tile's rect, refreshed on scene apply, on resize and on the 2 s poll:
///
///   point 3  metadata line, bottom-left, monospace: "title — artist" and,
///            dimmer, "hidden facet · ♪ exclusive" / "hidden facet · muted";
///            empty whenever nothing is playing. The text comes from
///            VisualizationChrome.Metadata and the audio-owner fact from
///            core's /state audioOwner - the host never guesses it.
///   point 4  transport, bottom-right: prev · play/pause · next, §32 layer 3
///            pass-through only, unmapped actions DISABLED and never hidden.
///   point 5  style/mode label, top-right, EDIT MODE ONLY.
///
/// §2.5.3 reveal: a single tap anywhere on the visualization reveals the hidden
/// facet's native player (§6a); while it is revealed this chrome steps aside
/// entirely so the player owns its pixels and its taps, and Back / the corner
/// affordance collapses it. Long-press / right-click still opens the §6a sheet.
/// </summary>
public sealed partial class MainWindow
{
    private readonly Dictionary<string, Grid> _vizChrome = new();
    private DispatcherTimer? _vizPoll;
    private DispatcherTimer? _vizClock;   // the one-second tick for the time text and the bar
    private SwitchableAudioSource? _vizAudio;
    private bool _vizTestSignal;
    private bool _vizPalettesRegistered;

    /// <summary>Called once from WireSceneModelUi: the styles into the host's registry; the audio source behind a live switch.</summary>
    private void WireVisualizations()
    {
        StyleRenderer.RegisterAll();
        PrismHost.Surfaces.Visualization.VisualizationHost.BandDiagnostic = line => LogLine("viz " + line);
        StyleRenderer.BeamDiagnostic = line => LogLine("viz " + line);
        _vizAudio = new SwitchableAudioSource(_surfaces.AudioSource);
        _surfaces.AudioSource = _vizAudio;
        // §2.5.2 point 2: the surface samples the art, CORE derives the dominant colours and the tinted palette.
        Surfaces.Visualization.VisualizationHost.ArtworkSampled = (source, url, rgbaBase64) =>
            DispatcherQueue.TryEnqueue(() => _brain.Call(HostCalls.NoteArtworkColors, source, url, rgbaBase64));
        LogLine("visualization styles registered: " + string.Join(", ", Surfaces.Visualization.VisualizationStyles.Known));
    }

    /// <summary>
    /// Declare the loaded packs' palettes to core once the brain is live, so core
    /// (not the host) computes every tinted palette. Idempotent; called from the
    /// visualization sync, which only runs with a model in hand.
    /// </summary>
    private void RegisterStylePalettes()
    {
        if (_vizPalettesRegistered) return;
        _vizPalettesRegistered = true;
        _brain.Call(HostCalls.RegisterStylePalettes, StylePacks.PalettesJson());
    }

    /// <summary>
    /// §2.5.2 point 5: the style/mode label shows in edit mode only. "Edit mode"
    /// on this host = one of the configuration surfaces is open over the wall.
    /// </summary>
    private bool VisualizationEditMode => _builder is not null || _rail is not null || _layoutEditor is not null || _facetEditor is not null;

    private void SetVisualizationTestSignal(bool on)
    {
        _vizTestSignal = on;
        if (_vizAudio is not null) _vizAudio.TestSignal = on;
        SetPill(on ? "Prism · visualizations on the test signal (new placements)" : "Prism · visualizations on the loopback feed");
    }

    private sealed record VizTile(string Id, string Source, string Style, string Artwork);

    /// <summary>
    /// The visualization tiles on the wall right now (id, hidden source tile id,
    /// style, artwork mode) and, beside them, core's audio owner (§3) - the one
    /// fact the metadata line's "♪ exclusive / muted" half rests on. Both come
    /// out of the same PrismRuntime.state() read, so the line can never disagree
    /// with core about who owns audio.
    /// </summary>
    /// <summary>B-150: core's one wall mute switch, as last read - the mute button and the MUTED pill show this and nothing else.</summary>
    private bool _wallMuted;

    private async Task<(List<VizTile> Tiles, string? AudioOwner)> VisualizationTilesAsync()
    {
        var out_ = new List<VizTile>();
        string? owner = null;
        var raw = await _brain.EvalAsync("PrismRuntime.state()");
        if (raw is null) return (out_, null);
        try
        {
            string inner;
            using (var outer = JsonDocument.Parse(raw)) inner = outer.RootElement.ValueKind == JsonValueKind.String ? outer.RootElement.GetString()! : raw;
            using var st = JsonDocument.Parse(inner);
            if (st.RootElement.TryGetProperty("audioOwner", out var ao) && ao.ValueKind == JsonValueKind.String) owner = ao.GetString();
            _wallMuted = st.RootElement.TryGetProperty("muted", out var wm) && wm.ValueKind == JsonValueKind.True;   // B-150: the wall's one mute switch
            RootGrid.DispatcherQueue.TryEnqueue(SyncVolumeSlider);   // an open slider follows the switch (0 while muted)
            string Str(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
            _vizRevealedInCore = null;
            foreach (var t in st.RootElement.GetProperty("tiles").EnumerateArray())
            {
                if (t.TryGetProperty("visualization", out var v) && v.ValueKind == JsonValueKind.Object)
                    out_.Add(new VizTile(Str(t, "id"), Str(v, "source"), Str(v, "style"), Str(v, "artwork")));
                // §32: the tile core is showing as a transient overlay right now - a reveal from the
                // remote or the §6a sheet moves the chrome exactly like a tap on the wall does.
                if (t.TryGetProperty("revealed", out var rv) && rv.ValueKind == JsonValueKind.String) _vizRevealedInCore = Str(t, "id");
            }
        }
        catch { }
        return (out_, owner);
    }

    /// <summary>The hidden facet core reports as revealed, whoever asked for it (the wall, the remote, a deep link).</summary>
    private string? _vizRevealedInCore;

    /// <summary>Place / move / remove the chrome overlays to match the wall, then keep transport availability fresh while any exists.</summary>
    private bool _vizSyncing;

    private async Task SyncVisualizationsAsync()
    {
        // Re-entrancy guard: two of these in flight means two ExecuteScript round
        // trips racing on the brain WebView, which deadlocks the UI thread.
        if (_vizSyncing) return;
        _vizSyncing = true;
        try
        {
        await ReadModelAsync();
        RegisterStylePalettes();
        var (tiles, _) = await VisualizationTilesAsync();
        var wanted = new HashSet<string>();
        foreach (var t in tiles)
        {
            var id = t.Id;
            if (_surfaces.RectOf(id) is not { } r || r.W < 40 || r.H < 30) continue;
            wanted.Add(id);
            // the visual follows the music (2026-09-07): when a stage moves to another source, its chrome - transport, block,
            // Quick play - follows too. Built once per stage before, so a pick on Pandora left Apple Music's chrome up (B-136).
            if (_vizChrome.TryGetValue(id, out var stale) && _vizParts.TryGetValue(id, out var sp) && sp.Source != t.Source)
            {
                RootGrid.Children.Remove(stale); _vizChrome.Remove(id); _vizParts.Remove(id);
                LogLine($"viz chrome rebuilt for {id}: source {sp.Source} -> {t.Source}");
            }
            if (!_vizChrome.TryGetValue(id, out var g))
            {
                g = BuildVisualizationChrome(id, t.Source);
                Canvas.SetZIndex(g, 20);
                RootGrid.Children.Add(g);
                _vizChrome[id] = g;
                LogLine($"viz chrome built for {id} at {r.X},{r.Y} {r.W}x{r.H} (source {t.Source}, style {t.Style})");
            }
            if (_vizParts.TryGetValue(id, out var p))
            {
                // P5b: a style or artwork-mode change (and a scene applying, which
                // builds fresh chrome above) restarts the label's 4s window.
                if (p.StyleId != t.Style || p.Artwork != t.Artwork) p.LabelSince = DateTimeOffset.UtcNow;
                p.StyleId = t.Style; p.Artwork = t.Artwork;
            }
            g.Margin = new Thickness(r.X, r.Y, 0, 0);
            g.Width = r.W; g.Height = r.H;
            if (_vizParts.TryGetValue(id, out var pp)) ApplyPosterPlacement(pp, r.W, r.H);   // B-184: the centred poster scales with the stage
        }
        LogLine($"viz sync: {tiles.Count} visualization tile(s) in core state, {wanted.Count} with a usable rect, {_vizChrome.Count} chrome built");
        foreach (var id in _vizChrome.Keys.ToList())
            if (!wanted.Contains(id)) { RootGrid.Children.Remove(_vizChrome[id]); _vizChrome.Remove(id); }
        if (wanted.Count > 0)
        {
            await RefreshVisualizationTransportAsync();
            if (_vizPoll is null)
            {
                _vizPoll = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
                // the clock ticks every second between reports (2026-09-08): the shown position is interpolated from the last
                // report locally, so the seconds advance without a core read
                _vizClock ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };   // four ticks a second: a 1 s timer drifting across second boundaries held a second and then stepped two
                _vizClock.Tick += (_, __) => { foreach (var parts in _vizParts.Values) { try { RenderTransportTime(parts); } catch { } } };
                _vizClock.Start();
                _vizPoll.Tick += async (_, __) => await RefreshVisualizationTransportAsync();
            }
            _vizPoll.Start();
            // NO separate clock ticker. A 250ms DispatcherTimer that walked
            // _vizParts and re-rendered each one wedged the UI thread: any
            // exception in a timer tick - or iterating the dictionary while a
            // sync mutated it - takes the dispatcher with it, and the wall froze
            // with the log stopped and the CPU idle (2026-09-04, three times).
            // The readout updates on the existing poll instead: coarser, alive.
        }
        else _vizPoll?.Stop();
        }
        finally { _vizSyncing = false; }
    }


    private sealed class VizChromeParts
    {
        public Button Prev = null!, Play = null!, Next = null!, Restart = null!, Sound = null!, Up = null!, Down = null!, Offer = null!;
        public FontIcon UpIcon = null!, DownIcon = null!;
        /// <summary>B-160: the filled thumb shown while the verdict stands (a liked song never gets re-pressed unknowingly).</summary>
        public Viewbox UpFilled = null!, DownFilled = null!;
        /// <summary>B-169: the thought bubble over the half-moon during a break - the soundscape playing instead of the ad (nothing for None).</summary>
        public StackPanel SoundBubble = null!; public TextBlock SoundBubbleText = null!; public Canvas BubbleLayer = null!;
        public FontIcon PlayIcon = null!;
        /// <summary>§2.5.2 point 3 as amended by P4: TWO lines — line 1 the title, line 2 the artist then the state (the state alone in mono).</summary>
        public TextBlock Title = null!, Artist = null!, State = null!;
        public StackPanel Line2 = null!;
        /// <summary>§2.5.2 point 5 as amended by P5b: "PRISM BEAMS · backdrop: album art", top-right, 4s after a change, pinned in edit mode.</summary>
        public TextBlock Label = null!;
        /// <summary>When the style/artwork last changed (or the scene applied): the start of P5b's 4s window.</summary>
        public DateTimeOffset LabelSince = DateTimeOffset.UtcNow;
        public StackPanel Row = null!;
        /// <summary>Elapsed / total beside the transport, and the thin progress bar along the bottom edge.</summary>
        public TextBlock Time = null!;
        public Button Mute = null!;
        /// <summary>B-221: the mini player's corner button - live only while the stage fills the wall.</summary>
        public Button Mini = null!;
        /// <summary>B-151: the prominent MUTED label, top centre, while the wall's one switch is on (B-150) - whoever owns the audio, loaded or not.</summary>
        public Border MutedBanner = null!;
        public Button SeekBack = null!, SeekFwd = null!;
        public Button Order = null!;
        public string? OrderKind, OrderId, OrderName, OrderLabel, OrderSpot;   // the collection the order button acts on, from the last transport read
        public FontIcon MuteIcon = null!;
        /// <summary>Whether core reports this source as the §3 audio owner (i.e. audible).</summary>
        public bool Owns;
        public ProgressRing Spinner = null!;
        public Rectangle Bar = null!, BarTrack = null!;
        /// <summary>Last position core reported, and when - the display interpolates between 2s polls so the clock ticks.</summary>
        public double PosSec, DurSec;
        public DateTimeOffset PosAt = DateTimeOffset.UtcNow;
        /// <summary>When a page report was last accepted as the clock's anchor (resync every 10 s, or at once on a large gap).</summary>
        public DateTimeOffset PosAnchoredAt = DateTimeOffset.MinValue;
        public string Source = "", StyleId = "", Artwork = "";
        /// <summary>2026-09-14: the poster the block shows for the length of an ad break - one random image from the imagery cache, chosen when the break starts, dropped when it ends - instead of the service's own "Advertisement" placeholder.</summary>
        public string? BreakArt;
        /// <summary>2026-09-15: the page's own count of the break's ads ("2 of 3") while the source is covered - the clock names the ad, since a 30 s clock starting over three times read as one stuck ad.</summary>
        public string? AdCount;
        /// <summary>Line 3 of the metadata block: the album.</summary>
        public TextBlock Album = null!;
        /// <summary>Line 0: the service's name, small and spaced, above the title.</summary>
        public TextBlock Service = null!;
        /// <summary>Line 4: the collection playing - a station or playlist name the page reported.</summary>
        public TextBlock Collection = null!;
        /// <summary>Quick play: the last five collections this source played from.</summary>
        public Button Recent = null!;
        /// <summary>The artwork card, top-right: a clear copy of the cover (the backdrop blurs it on purpose; the maintainer wanted to SEE it, 2026-09-06).</summary>
        public Border ArtCard = null!; public Image Art = null!; public string ArtUrl = "";
        /// <summary>2026-09-14: the half-moon in the poster's top-left corner while the poster is a break image - the mark the Veil extension puts on every cover.</summary>
        public TextBlock BreakGlyph = null!;
        /// <summary>Whether the source declared album art: "backdrop: album art" vs "backdrop: none" in the P5b label.</summary>
        public bool HasArt;
        public bool Playing;
    }
    private readonly Dictionary<string, VizChromeParts> _vizParts = new();
    private string? _workLine, _workName, _workFailLine;   // the status feed's held line for work in hand, and whose; the last failure said

    // Segoe Fluent / MDL2 transport glyphs, named so the file stays ASCII on disk (the host's sources are mixed cp1252/UTF-8).
    private const string GlyphPrevious = "", GlyphNext = "", GlyphPlay = "", GlyphPause = "";
    // Speaker glyphs for the mute toggle (Segoe Fluent / MDL2), named so this
    // file stays ASCII on disk like the transport glyphs above.
    private const string GlyphSeekBack = "\uED3C", GlyphSeekFwd = "\uED3D";
    private const string GlyphAudioOn = "\uE767", GlyphAudioOff = "\uE74F";
    private const string GlyphNextVisual = "\uE8AB";   // Switch
    private const string GlyphRecent = "\uEC4F";
    private const string GlyphMiniPlayer = "\uE73F";     // BackToWindow (arrows inward: shrink) - B-221: the mini player; the "open in new window" arrow read as expand (2026-09-17)       // MusicNote - B-149: Quick play is the music (stations, playlists, per service)
    private const string GlyphOrder = "\uE8B1";        // Shuffle - the play order (2026-09-17, spec 32 layer 5): in order, the service's shuffle, true shuffle, in reverse
    private const string GlyphStartOver = "\uE72C";    // Refresh - B-141: Start over (a station tunes afresh, a playlist from the top)
    private const string GlyphLike = "\uE8E1", GlyphDislike = "\uE8E0";   // B-155: thumbs, to the service's algorithm
    private const string GlyphSoundscape = "\u25D0";   // the half-moon the Veil extension marks an intermission with (video.js __prismmoon) - B-149: the soundscape wheel; the music note is Quick play's

    // The composition's type. P4 asks for three treatments: the title in the
    // display face at semibold, the artist in dim sans, the state alone in dim
    // mono. The design tokens name Space Grotesk + IBM Plex Mono; neither is
    // bundled yet (B-96, accepted low priority), so these are the honest local
    // fallbacks and no shot matches the mockup pixel-for-pixel until it lands.
    private static readonly Microsoft.UI.Xaml.Media.FontFamily VizMono = new("Consolas");
    private static readonly Microsoft.UI.Xaml.Media.FontFamily VizDisplay = new("Segoe UI");
    private static readonly Microsoft.UI.Xaml.Media.FontFamily VizSans = new("Segoe UI");
    private static readonly SolidColorBrush VizNowInk = new(Windows.UI.Color.FromArgb(255, 0xE8, 0xEC, 0xF2));
    private static readonly SolidColorBrush VizDimInk = new(Windows.UI.Color.FromArgb(255, 0x8A, 0x93, 0xA2));
    /// <summary>The amber of the MUTED pill: the thing to notice (CLAUDE.md contrast rule) - the mute button's glyph and border while the wall is muted (B-213).</summary>
    private static readonly SolidColorBrush VizAmberInk = new(Windows.UI.Color.FromArgb(255, 0xF0, 0xA8, 0x3C));
    private static readonly SolidColorBrush VizAmberEdge = new(Windows.UI.Color.FromArgb(0xB0, 0xF0, 0xA8, 0x3C));
    private static readonly SolidColorBrush VizNoEdge = new(Windows.UI.Color.FromArgb(0, 0, 0, 0));

    /// <summary>
    /// The household's request (2026-09-06): another look, right now, from the wall. The next pack in
    /// StylePacks order is written into the scene's visualization (so it sticks across restarts) and the
    /// scene re-applied; a visualization change counts as a reshape, so the surface is rebuilt in place.
    /// </summary>
    private async Task CycleVisualizationStyleAsync(string tileId)
    {
        await ReadModelAsync();
        if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } scene) { SetPill("Prism · no active scene"); return; }
        var s = scene.Clone();
        System.Text.Json.Nodes.JsonObject? viz = null;
        if (s.Assign.TryGetValue(tileId, out var refId)) viz = s.Visualizations.FirstOrDefault(v => v["id"]?.GetValue<string>() == refId);
        viz ??= s.Visualizations.FirstOrDefault(v => v["id"]?.GetValue<string>() == tileId) ?? s.Visualizations.FirstOrDefault();
        if (viz is null) { SetPill("Prism · this scene has no visualization"); return; }
        var packs = StylePacks.All();
        var cur = viz["style"]?.GetValue<string>() ?? packs[0].Id;
        var idx = packs.ToList().FindIndex(p => p.Id == cur);
        var next = packs[(idx + 1 + packs.Count) % packs.Count];
        viz["style"] = next.Id;
        var raw = await ModelCallAsync("modelSaveScene", s.ToJson());
        try { if (raw is not null && System.Text.Json.Nodes.JsonNode.Parse(raw) is System.Text.Json.Nodes.JsonObject r && r["ok"]?.GetValue<bool>() != true) { SetPill("Prism · could not change the visual"); return; } } catch { }
        LogLine("visual: " + tileId + " " + cur + " -> " + next.Id);
        SetPill("Prism · " + next.Name + " - " + next.Blurb);
        await ReadModelAsync();
        // In place: only the visualization surface is rebuilt. A full scene apply re-runs the
        // boot-silent rule and mutes the room (found by the maintainer on 2026-09-06).
        _brain.Call(HostCalls.RestyleVisualization, tileId, next.Id, viz["artwork"]?.GetValue<string>());
    }

    /// <summary>
    /// Visual style, on the spot: the twenty packs and the artwork mode in a dialog over the scene,
    /// each pick written into the scene and applied in place (restyleVisualization - the music is
    /// never touched). Spill and anything structural stay in the builder. "Takes you entirely out
    /// of the scene to do small configs, no good" (2026-09-06).
    /// </summary>
    /// <summary>
    /// Section 26 ambient audio (opt-in, 2026-09-07): what plays instead of silence while a service runs its ads. A
    /// lounge-level choice, saved on every hidden music source's placement settings (the scene model) and applied
    /// live through core (no re-apply, the music keeps playing). The soundscapes are synthesized on the device by
    /// the first-party page at tiles.prism/soundscape - nothing downloaded, nothing licensed.
    /// </summary>
    /// <summary>The soundscapes (docs/concept-scenes.md section 6): id, name, one line. "off" is None - the default.</summary>
    /// <summary>The twelve CC0 field recordings (docs/soundscape-credits.md), chosen 2026-09-08 - the synthesized set is gone.</summary>
    private static readonly (string id, string name, string tip)[] AdsSounds = {
        ("off", "None", "the break is muted, nothing else"),
        ("random", "Random", "every recording once, in a shuffled order, before any repeats - never None"),
        ("bayou", "Bayou", "frogs and insects over still water"),
        ("midwest-forest", "Midwest Forest", "a summer night in the trees"),
        ("wind-shutter", "Wind & Shutter", "wind working at a loose shutter"),
        ("heavy-storm", "Heavy Storm", "rain in sheets, thunder behind it"),
        ("river", "River", "fast water over stones"),
        ("beach-cave", "Beach Coast Cave", "surf heard from inside a sea cave"),
        ("park-meadow", "City Park Meadow", "birds and a breeze, the city far off"),
        ("wind-chimes", "Wind Chimes at Night", "chimes in a slow night wind"),
        ("city", "Bustling City", "a street in full swing"),
        ("bees", "Bees Swarming", "a hive at work"),
        ("arcade", "Pinball Arcade", "bells, flippers and the crowd"),
        ("star-walk", "Star Walk", "a slow, open night"),
    };
    /// <summary>Scene settings saved with the synthesized ids keep working: the page maps them the same way.</summary>
    private static string LegacySound(string id) => id switch { "crickets" => "midwest-forest", "whales" => "beach-cave", "rain" => "heavy-storm", "ocean" => "beach-cave", "wind" => "wind-shutter", _ => id };

    /// <summary>The active scene's soundscape for ad breaks (its first music facet's intermission.ambient), "off" when none - read from the cached model.</summary>
    private string CurrentAdsSound()
    {
        if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } scene) return "off";
        foreach (var h in scene.Hidden)
        {
            var f = h["facet"]?.GetValue<string>();
            if (f is not null && scene.Settings.TryGetValue(f, out var so) && so["intermission"] is System.Text.Json.Nodes.JsonObject io && io["ambient"]?.GetValue<string>() is { Length: > 0 } a) return LegacySound(a);
        }
        return "off";
    }

    /// <summary>Write the scene's soundscape for every music facet and tell core - the wheel and the During ads... sheet land here.</summary>
    private async Task SetAdsSoundAsync(string id)
    {
        await ReadModelAsync();
        if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } sc) { SetPill("Prism \u00B7 no active scene"); return; }
        var facets = sc.Hidden.Select(h => h["facet"]?.GetValue<string>()).Where(f => f is not null).Select(f => f!).ToList();
        if (facets.Count == 0) { SetPill("Prism \u00B7 this scene has no music source"); return; }
        var s = sc.Clone();
        foreach (var f in facets)
        {
            if (!s.Settings.TryGetValue(f, out var so)) { so = new System.Text.Json.Nodes.JsonObject(); s.Settings[f] = so; }
            if (id == "off") { if (so["intermission"] is System.Text.Json.Nodes.JsonObject io0) io0.Remove("ambient"); }
            else { var io = so["intermission"] as System.Text.Json.Nodes.JsonObject; if (io is null) { io = new System.Text.Json.Nodes.JsonObject(); so["intermission"] = io; } io["ambient"] = id; }
        }
        await ModelCallAsync("modelSaveScene", s.ToJson());
        LogLine("ads sound: " + sid + " -> " + id);
        _brain.Call(HostCalls.SetIntermissionAmbient, id == "off" ? null : id);
        SetPill(id == "off" ? "Prism \u00B7 ads are silent" : "Prism \u00B7 " + id + " during ads");
        await ReadModelAsync();
        _ = RefreshVisualizationTransportAsync();
    }

    private Popup? _soundWheel;
    private DispatcherTimer? _soundWheelClose;

    // ---- B-184: the poster's place - top-right card, or centred and enlarged - one preference for every service, kept on this machine
    private bool _posterCentred = HostPrefs.GetBool("posterCentred", false);

    private void TogglePoster()
    {
        _posterCentred = !_posterCentred;
        HostPrefs.Set("posterCentred", _posterCentred);
        foreach (var (tileId, parts) in _vizParts)
        {
            var g = _vizChrome.TryGetValue(tileId, out var gg) ? gg : null;
            ApplyPosterPlacement(parts, g?.Width ?? 0, g?.Height ?? 0);
        }
        LogLine("poster: " + (_posterCentred ? "centred" : "top right"));
    }

    private void ApplyPosterPlacement(VizChromeParts parts, double w, double h)
    {
        var card = parts.ArtCard;
        // the enlarged poster's side: three fifths of the stage's shorter side, never smaller than the corner card
        var side = Math.Max(200, Math.Round(Math.Min(w > 0 ? w : 1000, h > 0 ? h : 600) * 0.6));
        // B-185: the clock sits just under that square whether or not the poster is in it (the card is centred 20 px above centre)
        parts.Time.Margin = new Thickness(0, side + 8, 0, 0);
        if (_posterCentred)
        {
            card.Width = side; card.Height = side;
            card.HorizontalAlignment = HorizontalAlignment.Center; card.VerticalAlignment = VerticalAlignment.Center;
            card.Margin = new Thickness(0, 0, 0, 40);   // a touch above centre: the block sits along the bottom
            card.CornerRadius = new CornerRadius(22);
        }
        else
        {
            card.Width = 200; card.Height = 200;
            card.HorizontalAlignment = HorizontalAlignment.Right; card.VerticalAlignment = VerticalAlignment.Top;
            card.Margin = new Thickness(0, 22, 22, 0);
            card.CornerRadius = new CornerRadius(14);
        }
    }

    /// <summary>Random (2026-09-09): the recording core navigated each music source's soundscape surface to - read off the navigated event, so the bubble and the block can name it.</summary>
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, string> _ambientNow = new();
    private void NoteAmbientEvent(string eventJson)
    {
        try
        {
            if (!eventJson.Contains("\"ambient:")) return;
            using var doc = JsonDocument.Parse(eventJson);
            var root = doc.RootElement;
            if (root.GetProperty("type").GetString() != "navigated") return;
            var id = root.GetProperty("id").GetString() ?? "";
            var url = root.GetProperty("url").GetString() ?? "";
            if (!id.StartsWith("ambient:", StringComparison.Ordinal)) return;
            var m = System.Text.RegularExpressions.Regex.Match(url, @"[?&]sound=([A-Za-z0-9\-]+)");
            if (m.Success) _ambientNow[id["ambient:".Length..]] = m.Groups[1].Value;
        }
        catch { }
    }

    // ---- B-176: the wall's volume, a slider that rises over the mute button on hover (every page's Windows session, the soundscape included)
    private Popup? _volumePopup;
    private DispatcherTimer? _volumeClose;
    private bool _volumeDragging, _volumeSyncing;
    private Slider? _volumeSlider; private TextBlock? _volumePct;

    /// <summary>2026-09-09: "if I hit mute, volume should go to zero, and if I hit unmute, volume should return to previous level" - the
    /// slider reads 0 while the wall is muted and the remembered level otherwise; dragging it to 0 is a mute, dragging a muted wall up is an unmute.</summary>
    private void SyncVolumeSlider()
    {
        if (_volumeSlider is not { } s || _volumePct is not { } p) return;
        _volumeSyncing = true;
        try { var v = _wallMuted ? 0 : Math.Round(_surfaces.WallVolume * 100); s.Value = v; p.Text = $"{v:0}%"; }
        finally { _volumeSyncing = false; }
    }

    private void ShowVolumeSlider(Button anchor, string source)
    {
        if (_volumePopup is { IsOpen: true }) { _volumeClose?.Stop(); return; }
        CloseVolumeSlider();
        var v0 = _wallMuted ? 0 : Math.Round(_surfaces.WallVolume * 100);
        var pct = new TextBlock { Text = $"{v0:0}%", FontFamily = VizMono, FontSize = 12, Foreground = VizDimInk, HorizontalAlignment = HorizontalAlignment.Center };
        var slider = new Slider { Orientation = Orientation.Vertical, Minimum = 0, Maximum = 100, Value = v0, Height = 150, HorizontalAlignment = HorizontalAlignment.Center, IsThumbToolTipEnabled = false };
        _volumeSlider = slider; _volumePct = pct;
        slider.ValueChanged += (_, e) =>
        {
            if (_volumeSyncing) return;
            pct.Text = $"{e.NewValue:0}%";
            if (e.NewValue <= 0) { if (!_wallMuted) _brain.Call(HostCalls.TileCommand, source, "mute"); return; }   // zero is the mute; the level stays remembered
            if (_wallMuted) _brain.Call(HostCalls.TileCommand, source, "unmute");
            _surfaces.SetWallVolume(e.NewValue / 100);
        };
        slider.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, __) => { _volumeDragging = true; _volumeClose?.Stop(); }), true);
        slider.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler((_, __) => { _volumeDragging = false; _volumeClose?.Start(); }), true);
        slider.PointerCaptureLost += (_, __) => { _volumeDragging = false; _volumeClose?.Start(); };
        var col = new StackPanel { Spacing = 6, Padding = new Thickness(10, 10, 10, 8) };
        col.Children.Add(new TextBlock { Text = "VOLUME", FontFamily = VizMono, FontSize = 10, Foreground = VizDimInk, HorizontalAlignment = HorizontalAlignment.Center });
        col.Children.Add(slider);
        col.Children.Add(pct);
        var card = new Border
        {
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE8, 0x12, 0x14, 0x1A)), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xFF, 0xFF, 0xFF)),
            BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Child = col,
        };
        const double w = 66, h = 218;
        var at = anchor.TransformToVisual(RootGrid).TransformPoint(new Windows.Foundation.Point(0, 0));
        var x = Math.Max(8, Math.Min(RootGrid.ActualWidth - w - 8, at.X + anchor.ActualWidth / 2 - w / 2));
        var y = Math.Max(8, at.Y - h - 6);
        var popup = new Popup { XamlRoot = RootGrid.XamlRoot, HorizontalOffset = x, VerticalOffset = y, IsLightDismissEnabled = false, Child = card };
        _volumePopup = popup;
        _volumeClose ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _volumeClose.Tick -= VolumeCloseTick; _volumeClose.Tick += VolumeCloseTick;
        card.PointerEntered += (_, __) => _volumeClose.Stop();
        card.PointerExited += (_, __) => { if (!_volumeDragging) _volumeClose.Start(); };
        popup.IsOpen = true;
    }
    private void VolumeCloseTick(object? sender, object e) { if (!_volumeDragging) CloseVolumeSlider(); }
    private void CloseVolumeSlider()
    {
        _volumeClose?.Stop();
        if (_volumePopup is { } p) { p.IsOpen = false; _volumePopup = null; _volumeSlider = null; _volumePct = null; HostPrefs.Set("wallVolume", _surfaces.WallVolume); }
    }

    /// <summary>
    /// B-144: the wheel. Six round picks fan out around the centre from a dot, each a beat after the last; the centre names
    /// the current pick. It closes a moment after the pointer leaves it, or on a pick. Not a Flyout: those light-dismiss on
    /// a WebView2 hover (memory: winui-webview2-gotchas).
    /// </summary>
    private async Task ShowSoundWheelAsync(Button anchor)
    {
        if (_soundWheel is { IsOpen: true }) { _soundWheelClose?.Stop(); return; }
        await ReadModelAsync();
        var current = CurrentAdsSound();
        const double size = 440, r = 178;   // fourteen picks: the chosen one centred, the rest packed around it (2026-09-09)
        var wheel = new Grid { Width = size, Height = size, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)) };
        var disc = new Ellipse { Width = size, Height = size, Fill = new SolidColorBrush(Windows.UI.Color.FromArgb(0xD8, 0x12, 0x14, 0x1A)), Stroke = new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xFF, 0xFF, 0xFF)), StrokeThickness = 1 };
        wheel.Children.Add(disc);
        // 2026-09-09: floating bubbles that keep out of each other's way. The chosen one sits in the centre; the rest start
        // on two rings and are relaxed apart - rectangles with a gap, kept inside the disc and off the centre bubble - for a
        // fixed number of passes, so the arrangement is settled before it is shown and nothing drifts afterwards.
        wheel.Children.Add(new TextBlock { Text = "INTERMISSION", FontFamily = VizMono, FontSize = 10, Foreground = VizDimInk, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 0, 62) });
        var canvas = new Canvas { Width = size, Height = size };
        wheel.Children.Add(canvas);
        var sb = new Microsoft.UI.Xaml.Media.Animation.Storyboard();
        var picks = new List<(Button b, string id, double w, double h, bool centre)>();
        var pos = new (double x, double y)[AdsSounds.Length];
        for (var i = 0; i < AdsSounds.Length; i++)
        {
            var (id, name, tip) = AdsSounds[i];
            var isCurrent = id == current || id == LegacySound(current);
            var b = new Button { Content = name, FontSize = 12.5, Padding = new Thickness(10, 6, 10, 6), MinWidth = 68, HorizontalContentAlignment = HorizontalAlignment.Center, CornerRadius = new CornerRadius(16), Opacity = 0 };
            if (isCurrent) b.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xF0, 0xA8, 0x3C));
            ToolTipService.SetToolTip(b, tip);
            b.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            var w = Math.Max(b.DesiredSize.Width, 68); var h = Math.Max(b.DesiredSize.Height, 32);
            var ang = -Math.PI / 2 + i * 2 * Math.PI / AdsSounds.Length;
            var rr = i % 2 == 0 ? r : r - 52;
            pos[i] = isCurrent ? (size / 2, size / 2 + 8) : (size / 2 + rr * Math.Cos(ang), size / 2 + rr * Math.Sin(ang));
            picks.Add((b, id, w, h, isCurrent));
            Canvas.SetLeft(b, size / 2 - w / 2); Canvas.SetTop(b, size / 2 - h / 2);
            canvas.Children.Add(b);   // in the tree first: a button measured outside it reports a narrower pill than it draws
        }
        void Arrange()
        {
        // 2026-09-09: measured IN the tree (Loaded, after a layout pass) - the earlier out-of-tree measure gave rectangles
        // narrower than the drawn pills, and the packing kept those apart while the pills still touched
        for (var i = 0; i < picks.Count; i++)
        {
            var b = picks[i].b;
            b.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            var w = Math.Max(Math.Max(b.ActualWidth, b.DesiredSize.Width), 68); var h = Math.Max(Math.Max(b.ActualHeight, b.DesiredSize.Height), 32);
            picks[i] = (b, picks[i].id, w, h, picks[i].centre);
        }
        const double gap = 9, edge = 8;
        for (var pass = 0; pass < 120; pass++)
        {
            for (var a = 0; a < picks.Count; a++)
            {
                if (picks[a].centre) continue;
                for (var c = 0; c < picks.Count; c++)
                {
                    if (a == c) continue;
                    var dx = pos[a].x - pos[c].x; var dy = pos[a].y - pos[c].y;
                    var ox = (picks[a].w + picks[c].w) / 2 + gap - Math.Abs(dx);
                    var oy = (picks[a].h + picks[c].h) / 2 + gap - Math.Abs(dy);
                    if (ox <= 0 || oy <= 0) continue;
                    var other = picks[c].centre;                       // the centre bubble never moves; the mover takes the whole step
                    var share = other ? 1.0 : 0.5;
                    if (ox < oy) { var s = (dx >= 0 ? 1 : -1) * ox * share; pos[a].x += s; if (!other) pos[c].x -= s; }
                    else { var s = (dy >= 0 ? 1 : -1) * oy * share; pos[a].y += s; if (!other) pos[c].y -= s; }
                }
                // inside the disc: the pill's far corner stays within the rim
                var rx = pos[a].x - size / 2; var ry = pos[a].y - size / 2;
                var half = Math.Sqrt(picks[a].w * picks[a].w + picks[a].h * picks[a].h) / 2;
                var dist = Math.Sqrt(rx * rx + ry * ry);
                var max = size / 2 - edge - half;
                if (dist > max && dist > 0) { pos[a].x = size / 2 + rx * max / dist; pos[a].y = size / 2 + ry * max / dist; }
            }
        }
        for (var i = 0; i < picks.Count; i++)
        {
            var (b, id, w, h, isCentre) = picks[i];
            var cx = pos[i].x; var cy = pos[i].y;
            Canvas.SetLeft(b, cx - w / 2); Canvas.SetTop(b, cy - h / 2);
            // 2026-09-09: no scale on the pills - a RenderTransform scale stretches the pill's rasterized surface, so text drawn
            // at a fifth of its size blurred until the animation ended ("everything starts blurred and comes into focus");
            // the fan-out is a move and a fade, drawn sharp from the first frame
            var tr = new CompositeTransform { CenterX = w / 2, CenterY = h / 2, TranslateX = (size / 2 - cx) * 0.6, TranslateY = (size / 2 - cy) * 0.6 };
            b.RenderTransform = tr;
            var delay = TimeSpan.FromMilliseconds(isCentre ? 0 : 40 * i);
            var ease = new Microsoft.UI.Xaml.Media.Animation.BackEase { EasingMode = Microsoft.UI.Xaml.Media.Animation.EasingMode.EaseOut, Amplitude = 0.6 };
            foreach (var (prop, to) in new[] { ("TranslateX", 0.0), ("TranslateY", 0.0) })
            {
                var da = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { To = to, Duration = new Duration(TimeSpan.FromMilliseconds(260)), BeginTime = delay, EasingFunction = ease, EnableDependentAnimation = true };
                Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(da, tr); Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(da, prop); sb.Children.Add(da);
            }
            var op = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { To = 1.0, Duration = new Duration(TimeSpan.FromMilliseconds(180)), BeginTime = delay, EnableDependentAnimation = true };
            Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(op, b); Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(op, "Opacity"); sb.Children.Add(op);
            var pick = id;
            b.Click += (_, __) => { CloseSoundWheel(); _ = SetAdsSoundAsync(pick); };
        }
        }
        var discTr = new ScaleTransform { CenterX = size / 2, CenterY = size / 2, ScaleX = 0.94, ScaleY = 0.94 };   // a breath, not a bloom: a scaled surface goes soft
        disc.RenderTransform = discTr; disc.Opacity = 0;
        foreach (var prop in new[] { "ScaleX", "ScaleY" })
        {
            var da = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { To = 1.0, Duration = new Duration(TimeSpan.FromMilliseconds(240)), EasingFunction = new Microsoft.UI.Xaml.Media.Animation.BackEase { EasingMode = Microsoft.UI.Xaml.Media.Animation.EasingMode.EaseOut, Amplitude = 0.4 }, EnableDependentAnimation = true };
            Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(da, discTr); Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(da, prop); sb.Children.Add(da);
        }
        var dop = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { To = 1.0, Duration = new Duration(TimeSpan.FromMilliseconds(160)), EnableDependentAnimation = true };
        Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(dop, disc); Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(dop, "Opacity"); sb.Children.Add(dop);
        // above the anchor, centred on it; kept on screen
        var at = anchor.TransformToVisual(RootGrid).TransformPoint(new Windows.Foundation.Point(0, 0));
        double x, y;
        if (at.Y - size - 6 >= 8) { x = Math.Max(8, Math.Min(RootGrid.ActualWidth - size - 8, at.X + anchor.ActualWidth / 2 - size / 2)); y = at.Y - size - 6; }
        else { x = Math.Min(RootGrid.ActualWidth - size - 8, at.X + anchor.ActualWidth + 6); y = Math.Max(8, Math.Min(RootGrid.ActualHeight - size - 8, at.Y + anchor.ActualHeight / 2 - size / 2)); }   // B-185: beside a button at the top edge
        CloseSoundWheel();
        var popup = new Popup { XamlRoot = RootGrid.XamlRoot, HorizontalOffset = x, VerticalOffset = y, IsLightDismissEnabled = false, Child = wheel };
        _soundWheel = popup;
        _soundWheelClose ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(350) };
        _soundWheelClose.Tick -= SoundWheelCloseTick; _soundWheelClose.Tick += SoundWheelCloseTick;
        wheel.PointerEntered += (_, __) => _soundWheelClose.Stop();
        wheel.PointerExited += (_, __) => _soundWheelClose.Start();
        popup.IsOpen = true;
        var arranged = false;
        void ArrangeAndShow() { if (arranged) return; arranged = true; canvas.UpdateLayout(); Arrange(); sb.Begin(); }
        canvas.Loaded += (_, __) => ArrangeAndShow();
        if (canvas.IsLoaded) ArrangeAndShow();
    }
    private void SoundWheelCloseTick(object? sender, object e) => CloseSoundWheel();
    private void CloseSoundWheel()
    {
        _soundWheelClose?.Stop();
        if (_soundWheel is { } p) { p.IsOpen = false; _soundWheel = null; }
    }

    private async Task AdsSoundModalAsync(string tileId)
    {
        await ReadModelAsync();
        if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } scene) { SetPill("Prism · no active scene"); return; }
        var facets = scene.Hidden.Select(h => h["facet"]?.GetValue<string>()).Where(f => f is not null).Select(f => f!).ToList();
        if (facets.Count == 0) { SetPill("Prism · this scene has no music source"); return; }
        var current = "off";
        foreach (var f in facets) if (scene.Settings.TryGetValue(f, out var so) && so["intermission"] is System.Text.Json.Nodes.JsonObject io && io["ambient"]?.GetValue<string>() is { Length: > 0 } a) { current = a; break; }
        var options = AdsSounds;
        var col = new StackPanel { Spacing = 10, Width = 440 };
        col.Children.Add(Meta("When a service plays an ad, the wall mutes it. Instead of silence, a field recording - twelve, all CC0, bundled with Prism, nothing fetched. It follows the mute button like any other sound. Applied as you pick."));
        var list = new StackPanel { Spacing = 3 };
        async Task CommitAsync(string id)
        {
            await ReadModelAsync();
            if (_model.Scene(sid) is not { } sc) return;
            var s = sc.Clone();
            foreach (var f in facets)
            {
                if (!s.Settings.TryGetValue(f, out var so)) { so = new System.Text.Json.Nodes.JsonObject(); s.Settings[f] = so; }
                if (id == "off") { if (so["intermission"] is System.Text.Json.Nodes.JsonObject io0) io0.Remove("ambient"); }
                else { var io = so["intermission"] as System.Text.Json.Nodes.JsonObject; if (io is null) { io = new System.Text.Json.Nodes.JsonObject(); so["intermission"] = io; } io["ambient"] = id; }
            }
            await ModelCallAsync("modelSaveScene", s.ToJson());
            LogLine("ads sound: " + sid + " -> " + id);
            _brain.Call(HostCalls.SetIntermissionAmbient, id == "off" ? null : id);
            SetPill(id == "off" ? "Prism · ads are silent" : "Prism · " + id + " during ads");
        }
        foreach (var (id, name, tip) in options)
        {
            var b = new ToggleButton { Content = name + "  ·  " + tip, IsChecked = current == id, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 6, 12, 6) };
            var pick = id;
            b.Click += (_, __) => { foreach (var o in list.Children.OfType<ToggleButton>()) o.IsChecked = ReferenceEquals(o, b); _ = CommitAsync(pick); };
            list.Children.Add(b);
        }
        col.Children.Add(list);
        var dlg = new ContentDialog { Title = "Intermission", Content = new ScrollViewer { Content = col, MaxHeight = 520 }, CloseButtonText = "Done", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        try { await dlg.ShowAsync(); } catch { }
    }

    private async Task VisualStyleModalAsync(string tileId)
    {
        await ReadModelAsync();
        if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } scene) { SetPill("Prism · no active scene"); return; }
        System.Text.Json.Nodes.JsonObject? viz = null;
        if (scene.Assign.TryGetValue(tileId, out var refId)) viz = scene.Visualizations.FirstOrDefault(v => v["id"]?.GetValue<string>() == refId);
        viz ??= scene.Visualizations.FirstOrDefault(v => v["id"]?.GetValue<string>() == tileId) ?? scene.Visualizations.FirstOrDefault();
        if (viz is null) { SetPill("Prism · this scene has no visualization"); return; }
        var vizId = viz["id"]?.GetValue<string>() ?? tileId;
        var style = viz["style"]?.GetValue<string>() ?? "prism-beams"; var artwork = viz["artwork"]?.GetValue<string>() ?? "off";

        async Task CommitAsync()
        {
            await ReadModelAsync();
            if (_model.Scene(sid) is not { } sc) return;
            var s = sc.Clone();
            var v = s.Visualizations.FirstOrDefault(x => x["id"]?.GetValue<string>() == vizId);
            if (v is null) return;
            v["style"] = style; v["artwork"] = artwork;
            await ModelCallAsync("modelSaveScene", s.ToJson());
            LogLine("visual: " + tileId + " style=" + style + " artwork=" + artwork + " (modal)");
            _brain.Call(HostCalls.RestyleVisualization, tileId, style, artwork);
        }

        var col = new StackPanel { Spacing = 10, Width = 460 };
        col.Children.Add(Meta("Applied as you pick; the music keeps playing. Spill past the tile lives in the scene builder."));
        col.Children.Add(Section("ARTWORK"));
        var artRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        foreach (var (mode, tip) in new[] { ("off", "the pack's own palette"), ("backdrop", "the cover blurred behind the scene, palette tinted toward it"), ("focal", "the cover sharp in the middle") })
        {
            var m = mode;
            var tb = new ToggleButton { Content = mode, IsChecked = artwork == m, Padding = new Thickness(12, 5, 12, 5) };
            ToolTipService.SetToolTip(tb, tip);
            tb.Click += (_, __) => { artwork = m; foreach (var o in artRow.Children.OfType<ToggleButton>()) o.IsChecked = ReferenceEquals(o, tb); _ = CommitAsync(); };
            artRow.Children.Add(tb);
        }
        col.Children.Add(artRow);
        col.Children.Add(Section("PACK"));
        var packs = new StackPanel { Spacing = 3 };
        string? family = null;
        foreach (var pack in StylePacks.All())
        {
            var fam = Tableaus.Environment.Contains(pack.Id) ? "ENVIRONMENT" : Tableaus.Community.Contains(pack.Id) ? "COMMUNITY" : "ORIGINALS";
            if (fam != family) { family = fam; packs.Children.Add(new TextBlock { Text = fam, FontSize = 10.5, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeDim, CharacterSpacing = 140, Margin = new Thickness(0, 8, 0, 2) }); }
            var pid = pack.Id;
            var b = new ToggleButton { Content = pack.Name + "  ·  " + pack.Blurb, IsChecked = style == pid, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 6, 10, 6) };
            b.Click += (_, __) => { style = pid; foreach (var o in packs.Children.OfType<ToggleButton>()) o.IsChecked = ReferenceEquals(o, b); _ = CommitAsync(); };
            packs.Children.Add(b);
        }
        col.Children.Add(new ScrollViewer { Content = packs, MaxHeight = 420, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        var dlg = new ContentDialog { Title = "Visual style", Content = col, CloseButtonText = "Done", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        try { await dlg.ShowAsync(); } catch { }
    }

    /// <summary>Quick play: a flyout of the last five collections core remembers for this source; a pick goes there and presses Play.</summary>
    /// <summary>
    /// Quick play (2026-09-06), grouped by service since 2026-09-07: with one music source the menu is flat (the last
    /// five, then Playlists / Stations); with more, each service is its own submenu named for it, with the one on
    /// the stage and any signed-out one marked, and "Add a music service…" at the foot. A pick on another service
    /// plays there and core moves the visual to it (the visual follows the music).
    /// </summary>
    private async Task ShowQuickPlayAsync(Button anchor, string source, string? openService = null)
    {
        await RefreshMusicSourcesAsync();
        var sources = _musicSources;
        var presenter = (Style)RootGrid.Resources["PrismMenuPresenter"];
        if (sources.Count == 0)
        {
            var menu0 = new MenuFlyout { MenuFlyoutPresenterStyle = presenter };
            menu0.Items.Add(new MenuFlyoutItem { Text = "Nothing yet. Play something from the revealed page once", IsEnabled = false });
            menu0.Items.Add(new MenuFlyoutSeparator());
            var add0 = new MenuFlyoutItem { Text = "Add a music service\u2026" };
            add0.Click += (_, __) => _ = ChangeMusicServiceAsync(source, add: true);
            menu0.Items.Add(add0);
            menu0.ShowAt(anchor);
            return;
        }
        // B-206 (2026-09-15): "give me a little play button next to each service name in the menu" - one row per service at the
        // top level: the play button on the left switches the wall to it and plays on (what its page holds, else what it last
        // played - core's switchToService), the name says what that is and opens the service's recents and playlists. The
        // B-205 "Switch to" entry inside each submenu was one click too many and is gone.
        List<TransportState> rows;
        try { rows = await ReadTransportAsync(); } catch { rows = new(); }
        var panel = new StackPanel { Spacing = 2, Width = 340 };
        var flyout = new Flyout { Content = panel, Placement = FlyoutPlacementMode.Top, FlyoutPresenterStyle = QuickPlayPresenterStyle() };
        // B-215 (2026-09-16): the app menu's shield (MainWindow.Menu.cs) - while the flyout is open an invisible XAML grid covers
        // the wall, so the pointer never touches a WebView2 (its input path counts as "outside" and light-dismisses the menu).
        // The way in never crossed the wall (button -> flyout -> submenus), but a pick among lookup candidates closes the chain
        // and leaves the pointer over the wall where the row was; the reopened menu died at the first pointer move.
        var shield = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)) };
        Canvas.SetZIndex(shield, 999);
        shield.PointerPressed += (_, e) => { e.Handled = true; flyout.Hide(); };
        flyout.Opened += (_, __) => { if (!RootGrid.Children.Contains(shield)) RootGrid.Children.Add(shield); };
        flyout.Closed += (_, __) => { RootGrid.Children.Remove(shield); LogLine("quick play: panel closed"); };
        var clear = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        var nameButtons = new Dictionary<string, Button>();
        foreach (var s in sources)
        {
            var t = rows.FirstOrDefault(x => x.TileId == s.tile || x.Facet == s.tile);
            var what = t?.Collection ?? t?.ResumeLabel ?? t?.Title ?? t?.ResumeTitle;
            var signedOut = s.session == "signed-out";
            var row = new Grid { ColumnSpacing = 4 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            // B-207 (2026-09-15): the service ON the stage with a track loaded gets a replay mark - a circle with a small triangle
            // in it - and its press is Start over (B-141: a station tunes afresh, a playlist or album starts from its first
            // track), on purpose; the others keep the plain Play, so the two are told apart at a glance
            // ... "it said it was already on Apple Music, so it should've just had the replay symbol": on the stage is enough -
            // with nothing loaded core's Start over falls back to the remembered collection, queued afresh
            var replay = s.active && !signedOut;
            UIElement mark;
            if (replay)
            {
                var g = new Grid();
                g.Children.Add(new FontIcon { Glyph = "\uE72C", FontSize = 16, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });   // the circle (Refresh)
                g.Children.Add(new FontIcon { Glyph = GlyphPlay, FontSize = 6, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(1, 0, 0, 0) });   // the triangle inside it
                mark = g;
            }
            else mark = new FontIcon { Glyph = GlyphPlay, FontSize = 14 };
            var play = new Button { Content = mark, Padding = new Thickness(11, 8, 11, 8), Background = clear, BorderThickness = new Thickness(0), IsEnabled = !signedOut, VerticalAlignment = VerticalAlignment.Stretch };
            ToolTipService.SetToolTip(play, signedOut ? "Sign in to " + s.name + " first" : replay ? "Start " + (what ?? s.name) + " over" : VisualizationChrome.SwitchToLabel(s.name, what));
            var (tile3, name3, what3) = (s.tile, s.name, what);
            play.Click += (_, __) =>
            {
                flyout.Hide();
                if (replay) { LogLine("start over: " + tile3); _brain.Call(HostCalls.TileCommand, tile3, "restart"); SetPill("Prism \u00B7 starting " + (what3 ?? name3) + " over\u2026"); return; }
                LogLine("switch to service: " + tile3); _brain.Call(HostCalls.ResumeService, tile3); SetPill("Prism \u00B7 " + name3 + (what3 is null ? "" : " \u00B7 " + what3 + "\u2026"));
            };
            var label = new Grid();
            label.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            label.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var text = new StackPanel();
            text.Children.Add(new TextBlock { Text = s.name + (s.active ? "  \u00B7  on the stage" : "") + (signedOut ? "  \u00B7  sign in" : ""), FontSize = 13, TextTrimming = TextTrimming.CharacterEllipsis });
            if (what is { Length: > 0 }) text.Children.Add(new TextBlock { Text = what, FontSize = 10, Foreground = VizDimInk, TextTrimming = TextTrimming.CharacterEllipsis });
            var chevron = new TextBlock { Text = "\u203A", FontSize = 16, Foreground = VizDimInk, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 0, 0) };
            Grid.SetColumn(text, 0); Grid.SetColumn(chevron, 1); label.Children.Add(text); label.Children.Add(chevron);
            var name = new Button { Content = label, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new Thickness(8, 6, 8, 6), Background = clear, BorderThickness = new Thickness(0) };
            ToolTipService.SetToolTip(name, s.name + ": recents and playlists");
            var sub = new MenuFlyout { MenuFlyoutPresenterStyle = presenter, Placement = FlyoutPlacementMode.Right };
            // Cross-service lookup (2026-09-16): "if I hear something on Spotify and am managing a playlist on Apple, I can add the song
            // (if available on the Apple service) to my Apple service". Opening a service's entry asks ITS page - core's musicLookup,
            // the adapter's script, the service's own catalog in the person's own session - for the song the wall is playing now, and
            // offers what the page can do with it: add to one of the account's playlists, or start a station from it. The rows are
            // built now and filled as core's answer lands; a verb the service cannot do stays grey with the reason, never hidden.
            // the head is a label, not a command: its own template (LookupHeadTemplate) so it never renders in the control's
            // disabled grey - "dark gray on dark gray. Very hard for human eyes to read" (2026-09-16; win-host-spec 5, contrast)
            var lookupHead = new MenuFlyoutItem { Text = "Looking for the song playing now\u2026", IsEnabled = false, Foreground = VizNowInk };
            if (LookupHeadTemplate(withArt: false) is { } headTemplate) lookupHead.Template = headTemplate;
            lookupHead.Click += (_, __) => { if (ToolTipService.GetToolTip(lookupHead) is string why) SetPill("Prism \u00B7 " + why); };   // a press reads the note aloud in the pill (the menu closes, as any press does)
            var lookupPick = new MenuFlyoutSubItem { Text = "Which one is it?", IsEnabled = false, Visibility = Visibility.Collapsed };
            var lookupAdd = new MenuFlyoutSubItem { Text = "Add to a playlist", IsEnabled = false };
            var lookupStation = new MenuFlyoutItem { Text = "Create station from this song", IsEnabled = false };
            sub.Items.Add(lookupHead); sub.Items.Add(lookupPick); sub.Items.Add(lookupAdd); sub.Items.Add(lookupStation); sub.Items.Add(new MenuFlyoutSeparator());
            var (tileL, nameL) = (s.tile, s.name);
            // a pick among candidates closes the menu (a menu item always does); the same screen comes straight back with the answer
            Func<Task> reopen = async () =>
            {
                // B-215, read from host.log 12:36 (2026-09-16): a pick closes the service's menu chain (a menu item always does) but
                // the Quick play panel itself STAYS open - its IsOpen held for the whole 800 ms wait. Hiding it and building a new
                // one was the "whole menu closes" the person saw. The way back is the same button's menu shown again, in place.
                await WhenFlyoutClosedAsync(sub);
                await Task.Delay(120);
                if (flyout.IsOpen)
                {
                    try { sub.ShowAt(name); LogLine("lookup reopen: " + nameL + " submenu shown again in place"); return; }
                    catch (Exception ex) { LogLine("lookup reopen in place failed: " + ex.Message); }
                }
                LogLine("lookup reopen: " + nameL + " (panel closed - opening Quick play again)");
                await WhenFlyoutClosedAsync(flyout);
                await Task.Delay(150);
                await ShowQuickPlayAsync(anchor, source, tileL);
            };
            sub.Opening += (_, __) => _ = RunLookupAsync(tileL, nameL, sub, lookupHead, lookupPick, lookupAdd, lookupStation, reopen);
            // the station row's target (the found song) is painted into its Tag; the handler is wired once, here
            lookupStation.Click += (_, __) =>
            {
                if (lookupStation.Tag is not ValueTuple<string, string> hit) { if (ToolTipService.GetToolTip(lookupStation) is string why) SetPill("Prism \u00B7 " + why); return; }   // inert: the reason, in the pill
                LogLine("lookup station: " + tileL + " " + hit.Item1);
                _ = RuntimeEvalAsync("PrismRuntime.musicStationFromSong(" + Q(tileL) + ", " + Q(hit.Item1) + ")");
                SetPill("Prism \u00B7 starting a " + nameL + " station from " + hit.Item2 + "\u2026");
                _ = ReportLookupActionAsync(tileL, nameL);
            };
            if (!await AddServiceMenuItemsAsync(sub.Items, s.tile, s.name)) sub.Items.Add(new MenuFlyoutItem { Text = signedOut ? "Signed out. Open the player to sign in" : "Nothing yet. Play something from the revealed page once", IsEnabled = false });
            // each service's own player: sign-in (the setup card) for a signed-out one; for the rest the same inline window
            // as the sheet's "Open the full app" - the preferred way in (user, 2026-09-08), not the setup card
            sub.Items.Add(new MenuFlyoutSeparator());
            var open = new MenuFlyoutItem { Text = signedOut ? "Sign in to " + s.name + "\u2026" : "Open the player\u2026" };
            var (tile2, signedOut2) = (s.tile, signedOut);
            open.Click += (_, __) => { flyout.Hide(); OpenRoute("prism://facet/" + Uri.EscapeDataString(tile2) + "/reveal?mode=window" + (signedOut2 ? "&signin=1" : "")); };   // B-193
            sub.Items.Add(open);
            name.Flyout = sub;
            nameButtons[s.tile] = name;
            Grid.SetColumn(play, 0); Grid.SetColumn(name, 1);
            row.Children.Add(play); row.Children.Add(name);
            panel.Children.Add(row);
        }
        panel.Children.Add(new Border { Height = 1, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x3A, 0xF0, 0xA8, 0x3C)), Margin = new Thickness(6, 4, 6, 4) });
        var add = new Button { Content = new TextBlock { Text = "Add a music service\u2026", FontSize = 13 }, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 6, 10, 6), Background = clear, BorderThickness = new Thickness(0) };
        add.Click += (_, __) => { flyout.Hide(); _ = ChangeMusicServiceAsync(source, add: true); };
        panel.Children.Add(add);
        if (openService is not null && nameButtons.TryGetValue(openService, out var reopenBtn))
            flyout.Opened += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() =>
            {
                try { reopenBtn.Flyout?.ShowAt(reopenBtn); LogLine("quick play reopen: " + openService + " submenu shown"); }
                catch (Exception ex) { LogLine("quick play reopen failed: " + ex.Message); }
            });
        flyout.ShowAt(anchor);
    }

    /// <summary>B-215: resolves once the flyout is closed - at once when it already is; after its Closed event otherwise, with a Hide of its own if the close never comes.</summary>
    private static async Task WhenFlyoutClosedAsync(FlyoutBase flyout, int timeoutMs = 800)
    {
        if (!flyout.IsOpen) return;
        var closed = new TaskCompletionSource<bool>();
        EventHandler<object> onClosed = (_, __) => closed.TrySetResult(true);
        flyout.Closed += onClosed;
        try
        {
            if (!flyout.IsOpen) return;
            await Task.WhenAny(closed.Task, Task.Delay(timeoutMs));
            if (flyout.IsOpen) { flyout.Hide(); await Task.WhenAny(closed.Task, Task.Delay(timeoutMs)); }
        }
        finally { flyout.Closed -= onClosed; }
    }

    /// <summary>Quick play cross-service lookup: start core's search on this service's page and paint its answer into the rows as it lands (polled while the menu is open).</summary>
    private async Task RunLookupAsync(string tile, string service, MenuFlyout menu, MenuFlyoutItem head, MenuFlyoutSubItem pick, MenuFlyoutSubItem add, MenuFlyoutItem station, Func<Task> reopen)
    {
        try
        {
            await RuntimeEvalAsync("PrismRuntime.musicLookup(" + Q(tile) + ")");
            var deadline = DateTime.UtcNow.AddSeconds(12);
            string? last = null;
            while (menu.IsOpen && DateTime.UtcNow < deadline)
            {
                var raw = await RuntimeEvalAsync("PrismRuntime.musicLookupState(" + Q(tile) + ")");
                // B-227 (2026-09-17): a settled answer is painted and the polling goes on while the menu is open - the page's
                // fresh playlist report (asked for on open) lands a moment after the answer, and the rows follow it
                if (raw is not null && raw != last) { last = raw; PaintLookup(raw, tile, service, head, pick, add, station, reopen); }
                await Task.Delay(350);
            }
        }
        catch (Exception ex) { LogLine("lookup paint failed (" + tile + "): " + ex.Message); }
    }

    private static string Cap(string s) => s.Length > 0 ? char.ToUpperInvariant(s[0]) + s[1..] : s;

    /// <summary>Paint one lookup state (core's musicLookupState JSON) into the rows. True once the state has settled.</summary>
    private bool PaintLookup(string raw, string tile, string service, MenuFlyoutItem head, MenuFlyoutSubItem pick, MenuFlyoutSubItem add, MenuFlyoutItem station, Func<Task> reopen)
    {
        if (System.Text.Json.Nodes.JsonNode.Parse(raw) is not System.Text.Json.Nodes.JsonObject st) return false;
        var status = st["status"]?.GetValue<string>() ?? "idle";
        var song = st["song"] as System.Text.Json.Nodes.JsonObject;
        var title = song?["title"]?.GetValue<string>(); var artist = song?["artist"]?.GetValue<string>();
        var songText = title is { Length: > 0 } ? title + (artist is { Length: > 0 } ? "  \u00B7  " + artist : "") : "the song playing now";
        var match = st["match"] as System.Text.Json.Nodes.JsonObject;
        var matchId = match?["id"]?.GetValue<string>();
        var matchTitle = match?["title"]?.GetValue<string>() ?? title ?? "";
        var matchArtist = match?["artist"]?.GetValue<string>() ?? artist;
        var reason = st["reason"]?.GetValue<string>();
        // 2026-09-17: a lone title-only / artist-only hit is the answer, said with core's confidence (the rule table in
        // music-lookup.ts) instead of a one-row chooser - "no confirmation required in this case, just let the user know
        // the confidence probability". 90 and up is a full match and reads as plain Found.
        var confidence = st["confidence"] as System.Text.Json.Nodes.JsonObject;
        var percent = confidence?["percent"]?.GetValue<int>() ?? 100;
        var because = confidence?["because"] is System.Text.Json.Nodes.JsonArray bc ? string.Join("  \u00B7  ", bc.OfType<System.Text.Json.Nodes.JsonValue>().Select(v => v.GetValue<string>())) : "";
        var unsure = status == "found" && percent < 90;
        head.Text = status switch
        {
            "searching" or "idle" => "Looking for " + songText + " on " + service + "\u2026",
            "found" when unsure => service + " has " + matchTitle + (matchArtist is { Length: > 0 } ? "  \u00B7  " + matchArtist : ""),
            "found" => "Found on " + service + ": " + matchTitle + (matchArtist is { Length: > 0 } ? "  \u00B7  " + matchArtist : ""),
            "ambiguous" => service + " has something like " + songText + " - pick the right one below",
            "not-found" => songText + " is not on " + service,
            // B-228 (2026-09-17): the wall having no song is not the service lacking a search ("it says No cross-service search
            // exists for Spotify, which is not true, we've been using it")
            "unavailable" when st["why"]?.GetValue<string>() == "no-song" => "Nothing is playing on the wall to look up",
            "unavailable" => "No cross-service search on " + service,   // 2026-09-16: "shorter, but intuitive"; the why is on the ? badge, the verb rows and the pill
            _ => "Could not search " + service + (reason is { Length: > 0 } ? ": " + reason : ""),
        };
        // the percent's own words, on a hover of the badge and on a press of the row ("can we just put that into a tooltip
        // on the 35% number?", 2026-09-17)
        var sureness = unsure ? percent + "% likely the same song" + (because.Length > 0 ? " - " + because : "") : "";
        ToolTipService.SetToolTip(head, status == "unavailable" ? Cap(reason ?? "not available here") : unsure ? sureness : match?["url"]?.GetValue<string>() is { Length: > 0 } mu ? mu : null);
        // WinUI shows no tooltip on a disabled control ("the tooltip isn't giving me anything", 2026-09-16): the note's row is
        // enabled while unavailable so the ? can be hovered, and while unsure so the percent can be; its template draws no
        // command look and a press says the note in the pill
        head.IsEnabled = status == "unavailable" || unsure;
        // contrast (2026-09-16): light ink for information, amber for the thing to notice - never the disabled grey; the found
        // song's artwork sits above the words so the eye lands there
        var found0 = status == "found" && matchId is { Length: > 0 };
        head.Foreground = found0 ? LookupAmber : VizNowInk;
        Microsoft.UI.Xaml.Media.Imaging.BitmapImage? art = null;
        if (found0 && (match?["artwork"]?.GetValue<string>() ?? song?["artwork"]?.GetValue<string>()) is { Length: > 0 } artUrl) { try { art = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(artUrl)); } catch { } }
        head.Tag = art;
        if (LookupHeadTemplate(withArt: art is not null, withHelp: status == "unavailable", badge: unsure ? percent + "%" : null, badgeTip: sureness) is { } tpl) head.Template = tpl;
        // the service's candidates as radio rows: while ambiguous (core says so only for two or more), and after a pick too
        // (the chosen one marked, the others one press away). A lone partial hit never comes here: it is found, with its
        // percent above. A menu item closes the menu when pressed - WinUI gives no way round that - so the pick brings the
        // same screen straight back with the answer painted (reopen), instead of asking the person to go out and in again.
        pick.Items.Clear();
        var picked = st["picked"]?.GetValue<bool>() == true;
        var chooser = (status == "ambiguous" || (status == "found" && picked)) && st["candidates"] is System.Text.Json.Nodes.JsonArray cands && cands.Count > 1;
        if (chooser)
        {
            foreach (var c in ((System.Text.Json.Nodes.JsonArray)st["candidates"]!).OfType<System.Text.Json.Nodes.JsonObject>())
            {
                var cid = c["id"]?.GetValue<string>(); if (cid is null) continue;
                var ct = c["title"]?.GetValue<string>() ?? cid; var ca = c["artist"]?.GetValue<string>(); var cal = c["album"]?.GetValue<string>();
                var chosen = cid == matchId;
                // 2026-09-18: "under Which one is it, I should see the confidence level of the 3 items" - each row says its own percent,
                // the reasons on its tooltip (the same rule table as the head's badge)
                var cconf = c["confidence"] as System.Text.Json.Nodes.JsonObject;
                var cpct = cconf?["percent"]?.GetValue<int>();
                var cwhy = cconf?["because"] is System.Text.Json.Nodes.JsonArray cbc ? string.Join("  \u00B7  ", cbc.OfType<System.Text.Json.Nodes.JsonValue>().Select(v => v.GetValue<string>())) : "";
                var mi = new MenuFlyoutItem { Text = ct + (ca is { Length: > 0 } ? "  \u00B7  " + ca : "") + (cal is { Length: > 0 } ? "  \u00B7  " + cal : "") + (cpct is int cp ? "  \u00B7  " + cp + "%" : ""), Icon = chosen ? new FontIcon { Glyph = "\uE73E" } : null, Foreground = chosen ? LookupAmber : VizNowInk };
                if (cpct is int cp2) ToolTipService.SetToolTip(mi, cp2 + "% likely the same song" + (cwhy.Length > 0 ? " - " + cwhy : ""));
                var (cid2, ct2) = (cid, ct);
                mi.Click += async (_, __) =>
                {
                    LogLine("lookup pick: " + tile + " " + cid2 + (cid2 == matchId ? " (already the pick)" : ""));
                    if (cid2 == matchId) { try { await reopen(); } catch (Exception ex) { LogLine("lookup reopen failed: " + ex.Message); } return; }   // the menu closed on the press all the same: bring it back
                    await RuntimeEvalAsync("PrismRuntime.musicLookupPick(" + Q(tile) + ", " + Q(cid2) + ")");
                    SetPill("Prism \u00B7 " + ct2 + " it is");
                    try { await reopen(); } catch (Exception ex) { LogLine("lookup reopen failed: " + ex.Message); }
                };
                pick.Items.Add(mi);
            }
        }
        pick.Text = picked ? "Not this one? Pick another" : "Which one is it?";
        pick.Visibility = chooser ? Visibility.Visible : Visibility.Collapsed; pick.IsEnabled = chooser;
        // add to a playlist: the account's playlists as the page listed them; one the service owns (edit false) stays grey with the reason
        add.Items.Clear();
        var found = status == "found" && matchId is { Length: > 0 };
        var count = 0;
        if (st["playlists"] is System.Text.Json.Nodes.JsonArray pls)
        {
            foreach (var pl in pls.OfType<System.Text.Json.Nodes.JsonObject>())
            {
                var pid = pl["id"]?.GetValue<string>(); var pname = pl["name"]?.GetValue<string>(); if (pid is null || pname is null) continue;
                var editable = pl["edit"]?.GetValue<bool>() != false;
                var mi = new MenuFlyoutItem { Text = pname, IsEnabled = editable };
                ToolTipService.SetToolTip(mi, editable ? "Add " + matchTitle + " to " + pname : pname + " is " + service + "'s own playlist, so it can't be added to");
                var (pid2, pname2, mid2, mt2) = (pid, pname, matchId ?? "", matchTitle);
                mi.Click += (_, __) =>
                {
                    LogLine("lookup add: " + tile + " " + mid2 + " -> " + pid2);
                    _ = RuntimeEvalAsync("PrismRuntime.musicAddToPlaylist(" + Q(tile) + ", " + Q(pid2) + ", " + Q(mid2) + ")");
                    SetPill("Prism \u00B7 adding " + mt2 + " to " + pname2 + "\u2026");
                    _ = ReportLookupActionAsync(tile, service);
                };
                add.Items.Add(mi); count++;
            }
        }
        // 2026-09-16: WinUI shows no tooltip on a disabled control, so a grey verb's reason was never readable. An inert verb stays
        // enabled, in dim ink, with its reason on the tooltip, as its submenu's one row, and in the pill when pressed.
        var cannotAdd = (st["cannot"] as System.Text.Json.Nodes.JsonObject)?["add"]?.GetValue<string>();   // B-218: Pandora's page offers no Add to playlist on a free account
        var notHere = status == "unavailable" ? Cap(reason ?? "not available here") : "Available once the song is found on " + service;   // the note itself, not a pointer to it ("why does the tooltip just say Unavailable", 2026-09-16)
        var addWhy = cannotAdd is { Length: > 0 } ? cannotAdd : !found ? notHere : count == 0 ? service + " has not listed your playlists yet - open it once" : null;
        add.Text = "Add to a playlist";
        if (addWhy is not null)
        {
            add.Items.Clear();
            var whyRow = new MenuFlyoutItem { Text = addWhy, Foreground = VizNowInk };
            if (LookupHeadTemplate(withArt: false) is { } wt) whyRow.Template = wt;
            var addWhy2 = addWhy;
            whyRow.Click += (_, __) => SetPill("Prism \u00B7 " + addWhy2);
            add.Items.Add(whyRow);
        }
        add.IsEnabled = true;
        add.Foreground = addWhy is null ? VizNowInk : VizDimInk;
        ToolTipService.SetToolTip(add, addWhy ?? ("Add " + matchTitle + " to one of your " + service + " playlists"));
        // a station seeded from the song: a human's pick, so it takes the audio and the stage follows
        var cannotStation = (st["cannot"] as System.Text.Json.Nodes.JsonObject)?["station"]?.GetValue<string>();   // B-218: Spotify's Web API cannot start a song radio
        var stationWhy = cannotStation is { Length: > 0 } ? cannotStation : !found ? notHere : null;
        station.IsEnabled = true;
        station.Foreground = stationWhy is null ? VizNowInk : VizDimInk;
        ToolTipService.SetToolTip(station, stationWhy ?? ("Start a " + service + " station from " + matchTitle));
        station.Tag = stationWhy is null && found ? (matchId!, matchTitle) : null;   // the row's handler (wired once in the menu builder) reads this at the press; null = say why
        return status is not ("searching" or "idle");
    }

    /// <summary>After an add / station press: read the action's outcome from core and say it in the pill.</summary>
    private async Task ReportLookupActionAsync(string tile, string service)
    {
        var deadline = DateTime.UtcNow.AddSeconds(12);
        while (DateTime.UtcNow < deadline)
        {
            await Task.Delay(500);
            var raw = await RuntimeEvalAsync("PrismRuntime.musicLookupState(" + Q(tile) + ")");
            if (raw is null || System.Text.Json.Nodes.JsonNode.Parse(raw) is not System.Text.Json.Nodes.JsonObject st) continue;
            if (st["action"] is not System.Text.Json.Nodes.JsonObject a) continue;
            var status = a["status"]?.GetValue<string>(); if (status == "pending") continue;
            var op = a["op"]?.GetValue<string>(); var song = a["song"]?.GetValue<string>() ?? "the song"; var pl = a["playlist"]?.GetValue<string>(); var err = a["error"]?.GetValue<string>();
            if (status == "ok") SetPill(op == "add" ? "Prism \u00B7 added " + song + " to " + pl : "Prism \u00B7 " + service + " station from " + song + " is starting");
            else SetPill("Prism \u00B7 " + service + " would not " + (op == "add" ? "add " + song + " to " + pl : "start a station from " + song) + (err is { Length: > 0 } ? " - " + err : ""));
            LogLine("lookup " + op + " " + status + " (" + tile + ")" + (err is { Length: > 0 } ? ": " + err : ""));
            return;
        }
    }

    private static readonly SolidColorBrush LookupAmber = new(Windows.UI.Color.FromArgb(255, 0xF2, 0xB1, 0x4C));
    private static ControlTemplate? _lookupHeadArt, _lookupHeadText, _lookupHeadHelp;

    /// <summary>The lookup head row's template: the words in the row's own Foreground (light ink, amber for a find), never the
    /// control's disabled grey, with the found song's artwork (the row's Tag, a BitmapImage) above them when there is one.
    /// A MenuFlyout holds only menu items, so the label is a MenuFlyoutItem re-templated into a plain block (2026-09-16).</summary>
    /// <summary>The head row's template: the artwork above the words when there is one, and an amber badge beside the words
    /// when there is one (the confidence's percent, 2026-09-17) whose tooltip is badgeTip (the reasons) - a badge's template
    /// is not cached, the percent being part of it.</summary>
    private ControlTemplate? LookupHeadTemplate(bool withArt, bool withHelp = false, string? badge = null, string? badgeTip = null)
    {
        if (withHelp && _lookupHeadHelp is not null) return _lookupHeadHelp;
        if (withHelp) return _lookupHeadHelp = LookupHelpTemplate();
        var badged = badge is { Length: > 0 };
        if (!badged && withArt && _lookupHeadArt is not null) return _lookupHeadArt;
        if (!badged && !withArt && _lookupHeadText is not null) return _lookupHeadText;
        const string ns = "xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'";
        var art = withArt
            ? "<Border Width='72' Height='72' CornerRadius='6' HorizontalAlignment='Left' Background='#FF1A1B24' Margin='0,0,0,8'><Image Source='{TemplateBinding Tag}' Stretch='UniformToFill'/></Border>"
            : "";
        var words = "<TextBlock Text='{TemplateBinding Text}' Foreground='{TemplateBinding Foreground}' FontSize='13' VerticalAlignment='Center' TextWrapping='Wrap' MaxWidth='" + (badged ? "270" : "320") + "'/>";
        var line = badged
            ? "<StackPanel Orientation='Horizontal'>" + words +
              "<Border Height='20' MinWidth='20' Padding='7,0' CornerRadius='10' Margin='10,0,0,0' VerticalAlignment='Center' Background='#F2B14C' ToolTipService.ToolTip='" + System.Security.SecurityElement.Escape(badgeTip ?? "") + "'>" +
              "<TextBlock Text='" + System.Security.SecurityElement.Escape(badge) + "' FontSize='12' FontWeight='Bold' Foreground='#12131A' HorizontalAlignment='Center' VerticalAlignment='Center'/></Border></StackPanel>"
            : words;
        var xaml = "<ControlTemplate " + ns + " TargetType='MenuFlyoutItem'><StackPanel Padding='12,8,12,6' Background='Transparent'>" + art + line + "</StackPanel></ControlTemplate>";
        try
        {
            var t = (ControlTemplate)Microsoft.UI.Xaml.Markup.XamlReader.Load(xaml);
            if (!badged) { if (withArt) _lookupHeadArt = t; else _lookupHeadText = t; }
            return t;
        }
        catch (Exception ex) { LogLine("lookup head template failed: " + ex.Message); return null; }   // the row falls back to the stock look rather than taking the menu down
    }

    /// <summary>The head row when the service cannot be searched from the wall: the words, then a round ? badge in amber -
    /// the row's tooltip carries the adapter's own reason (2026-09-16, Amazon Music first).</summary>
    private ControlTemplate? LookupHelpTemplate()
    {
        const string ns = "xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'";
        var xaml = "<ControlTemplate " + ns + " TargetType='MenuFlyoutItem'><StackPanel Orientation='Horizontal' Padding='12,8,12,6' Background='Transparent'>" +
                   "<TextBlock Text='{TemplateBinding Text}' Foreground='{TemplateBinding Foreground}' FontSize='13' VerticalAlignment='Center' TextWrapping='Wrap' MaxWidth='280'/>" +
                   "<Border Width='18' Height='18' CornerRadius='9' Margin='10,0,0,0' VerticalAlignment='Center' Background='#F2B14C'><TextBlock Text='?' FontSize='12' FontWeight='Bold' Foreground='#12131A' HorizontalAlignment='Center' VerticalAlignment='Center'/></Border>" +
                   "</StackPanel></ControlTemplate>";
        try { return (ControlTemplate)Microsoft.UI.Xaml.Markup.XamlReader.Load(xaml); }
        catch (Exception ex) { LogLine("lookup help template failed: " + ex.Message); return null; }
    }

    /// <summary>Play orders (2026-09-17): the transport's order menu for the collection playing - Continue (a saved spot), In order,
    /// the service's Shuffle, True shuffle, In reverse; the standing one marked, a verb the service cannot do grey with the reason.</summary>
    private async Task ShowOrderFlyoutAsync(VizChromeParts parts)
    {
        var source = parts.Source; var kind = parts.OrderKind; var id = parts.OrderId; var name = parts.OrderName ?? "the playlist";
        if (kind is null || id is null) return;
        _ = RuntimeEvalAsync("PrismRuntime.musicPrepareOrder(" + Q(source) + ", " + Q(kind) + ", " + Q(id) + ")");   // 2026-09-18: the list read while the person reads the menu
        string? cannotShuffle = null, cannotOwn = null, cannotRepeat = null; int? spot = null, count = null; string? standingId = null, standingLabel = null; var repeat = false;
        try
        {
            var raw = await RuntimeEvalAsync("PrismRuntime.musicLibrary(" + Q(source) + ")");
            if (raw is not null && System.Text.Json.Nodes.JsonNode.Parse(raw) is System.Text.Json.Nodes.JsonObject lib)
            {
                var orders = lib["orders"] as System.Text.Json.Nodes.JsonObject;
                cannotShuffle = orders?["shuffle"] is System.Text.Json.Nodes.JsonValue sv && sv.TryGetValue<string>(out var sreason) ? sreason : null;
                cannotOwn = orders?["own"] is System.Text.Json.Nodes.JsonValue ov && ov.TryGetValue<string>(out var oreason) ? oreason : null;
                cannotRepeat = orders?["repeat"] is System.Text.Json.Nodes.JsonValue rv && rv.TryGetValue<string>(out var rreason) ? rreason : null;
                repeat = lib["repeat"] is System.Text.Json.Nodes.JsonValue rpv && rpv.TryGetValue<bool>(out var rp) && rp;
                var standing = lib["order"] as System.Text.Json.Nodes.JsonObject;
                standingId = standing?["id"]?.GetValue<string>(); standingLabel = standing?["label"]?.GetValue<string>();
                spot = standing?["spot"] is System.Text.Json.Nodes.JsonValue spv && spv.TryGetValue<int>(out var sp) ? sp : null;
                count = standing?["count"] is System.Text.Json.Nodes.JsonValue cnv && cnv.TryGetValue<int>(out var cn) ? cn : null;
            }
        }
        catch (Exception ex) { LogLine("order menu: library read failed: " + ex.Message); }
        var presenter = (Style)RootGrid.Resources["PrismMenuPresenter"];
        var menu = new MenuFlyout { MenuFlyoutPresenterStyle = presenter, Placement = FlyoutPlacementMode.Top };
        var head = new MenuFlyoutItem { Text = name, IsEnabled = false, Foreground = VizNowInk };
        if (LookupHeadTemplate(withArt: false) is { } tpl) head.Template = tpl;
        menu.Items.Add(head);
        if (standingId == id && spot is int s1 && count is int c1 && c1 > 0)
        {
            var cont = new MenuFlyoutItem { Text = "Continue " + (standingLabel ?? "") + "  (" + s1 + " of " + c1 + ")", Foreground = LookupAmber, Icon = new FontIcon { Glyph = "\uE768", Foreground = VizDimInk } };
            ToolTipService.SetToolTip(cont, "Carry on where it left off, in the same order");
            cont.Click += (_, __) => { LogLine("order: continue " + source + " " + id + " at " + s1); _brain.Call(HostCalls.ResumeService, source); SetPill("Prism · " + name + ", continuing " + (standingLabel ?? "") + "…"); };
            menu.Items.Add(cont);
            menu.Items.Add(new MenuFlyoutSeparator());
        }
        var current = standingId == id ? standingLabel : null;
        // 2026-09-18: "our goal is algorithmic transparency, and those services aren't transparent" - the service's shuffle is
        // named for what it is, and Prism's is described by its rule
        var svcApp = SceneItemOf(source, null) is { } si0 && si0.App is { } ap0 ? _model.App(ap0) : null;
        var svc = svcApp?.Name ?? "The service";
        // 2026-09-18: "put the Prism logo next to true shuffle, give the Apple option an Apple logo (if legal), and the other
        // options a simple grayscale icon". The service's shuffle wears the service's OWN icon as the service serves it (the
        // App's poster, section 31 - the same image the wall already shows for the App; nothing of the service's is drawn by
        // us); True shuffle wears Prism's mark; the rest wear grey glyphs.
        IconElement? svcIcon = null;
        try
        {
            if (svcApp is not null && await _posters.GetAsync(svcApp.Id, svcApp.Name, svcApp.BaseUrl) is { ImagePath: { Length: > 0 } ip } && System.IO.File.Exists(ip))
                svcIcon = new ImageIcon { Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(ip)) };
        }
        catch (Exception ex) { LogLine("order menu: service icon failed: " + ex.Message); }
        IconElement? prismIcon = null;
        try
        {
            var mark = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "prism-icon.png");
            if (System.IO.File.Exists(mark)) prismIcon = new ImageIcon { Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(mark)) };
        }
        catch (Exception ex) { LogLine("order menu: Prism mark failed: " + ex.Message); }
        IconElement Grey(string glyph) => new FontIcon { Glyph = glyph, Foreground = VizDimInk };
        foreach (var (order, verb, cannot, tip, icon) in new (string, string, string?, string, IconElement?)[] {
            ("normal", "In order", null, "The playlist as the service lists it, from the top", Grey("\uE8FD")),
            ("shuffle", "Shuffle", cannotShuffle, svc + "'s algorithmic shuffle. It comes from the music service, and music services shuffle with non-transparent algorithms that often weigh your listening habits, a track's popularity, your recent play history and skip rates to curate the queue. True shuffle, below, is Prism's: uniformly random, nothing weighted.", svcIcon ?? Grey("\uE8B1")),
            ("true-shuffle", "True shuffle", cannotOwn, "Prism's true shuffle: every track once, in a uniformly random order, before any repeat - a fresh draw each time; the rule is published, nothing is weighted", prismIcon ?? Grey("\uE8B1")),
            ("reverse", "In reverse", cannotOwn, "From the last track to the first", Grey("\uE74A")) })
        {
            var label = order == "normal" ? "in order" : order == "shuffle" ? "shuffle" : order == "true-shuffle" ? "true shuffle" : "in reverse";
            var chosen = current is not null ? current == label : order == "normal" && standingId != id;
            var v = new MenuFlyoutItem { Text = chosen ? verb + "  \u00B7  now" : verb, IsEnabled = cannot is null, Icon = icon, Foreground = chosen ? LookupAmber : VizNowInk };
            ToolTipService.SetToolTip(v, cannot is null ? tip : Cap(cannot));
            var (o2, verb2) = (order, verb);
            v.Click += (_, __) => { LogLine("order: " + source + " " + kind + " " + id + " " + o2); _brain.Call(HostCalls.PlayCollection, source, kind, id, o2); SetPill("Prism · " + name + ", " + verb2.ToLowerInvariant() + "…"); };
            menu.Items.Add(v);
        }
        // Repeat (2026-09-18): a switch beside the order, not an order - "one that can be enabled in addition to the selected
        // order". The service's own repeat-all for its orders; Prism's next pass (a fresh draw for true shuffle) for its own.
        menu.Items.Add(new MenuFlyoutSeparator());
        var prismStanding = standingLabel is "true shuffle" or "in reverse" && standingId == id;
        var repeatCannot = prismStanding ? null : cannotRepeat;   // a Prism order repeats whatever the service offers
        var rep = new ToggleMenuFlyoutItem { Text = "Repeat", IsChecked = repeat, IsEnabled = repeatCannot is null, Icon = new FontIcon { Glyph = "\uE8EE", Foreground = VizDimInk }, Foreground = repeat ? LookupAmber : VizNowInk };
        ToolTipService.SetToolTip(rep, repeatCannot is not null ? Cap(repeatCannot) : "Play the list again when it ends, in the order chosen above. True shuffle draws afresh each pass");
        rep.Click += (_, __) => { var on = rep.IsChecked; LogLine("order: repeat " + source + " " + on); _ = RuntimeEvalAsync("PrismRuntime.musicRepeat(" + Q(source) + ", " + (on ? "true" : "false") + ")"); SetPill("Prism · " + name + (on ? " repeats" : " plays once")); };
        menu.Items.Add(rep);
        menu.ShowAt(parts.Order);
    }

    /// <summary>The Quick play flyout's presenter, styled like the app menu (PrismMenuPresenter) - a plain Flyout has no menu presenter style to borrow.</summary>
    private static Style QuickPlayPresenterStyle()
    {
        var st = new Style(typeof(FlyoutPresenter));
        st.Setters.Add(new Setter(Control.RequestedThemeProperty, ElementTheme.Dark));
        st.Setters.Add(new Setter(Control.BackgroundProperty, new SolidColorBrush(Windows.UI.Color.FromArgb(0xF2, 0x12, 0x13, 0x1A))));
        st.Setters.Add(new Setter(Control.BorderBrushProperty, new SolidColorBrush(Windows.UI.Color.FromArgb(0x3A, 0xF0, 0xA8, 0x3C))));
        st.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(1)));
        st.Setters.Add(new Setter(Control.CornerRadiusProperty, new CornerRadius(8)));
        st.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(4, 6, 4, 6)));
        st.Setters.Add(new Setter(FrameworkElement.MinWidthProperty, 0.0));
        st.Setters.Add(new Setter(FrameworkElement.MaxWidthProperty, 420.0));
        return st;
    }

    /// <summary>One service's entries into a menu or submenu: the last five it played from, then its Playlists / Stations. True when anything went in.</summary>
    private async Task<bool> AddServiceMenuItemsAsync(IList<MenuFlyoutItemBase> into, string source, string? service)
    {
        var raw = await RuntimeEvalAsync("PrismRuntime.musicRecent(" + Q(source) + ")");
        var any = false;
        var prefix = service is { Length: > 0 } ? service + ": " : "";
        try
        {
            if (raw is not null && System.Text.Json.Nodes.JsonNode.Parse(raw) is System.Text.Json.Nodes.JsonArray arr)
                foreach (var e in arr.OfType<System.Text.Json.Nodes.JsonObject>())
                {
                    var url = e["url"]?.GetValue<string>(); var label = e["label"]?.GetValue<string>() ?? ""; var kind = e["kind"]?.GetValue<string>() ?? ""; var artist = e["artist"]?.GetValue<string>();
                    if (url is null) continue;
                    var text = label + (artist is { Length: > 0 } && kind == "album" ? "  ·  " + artist : "");
                    var item = new MenuFlyoutItem { Text = text };
                    ToolTipService.SetToolTip(item, kind + "  ·  " + url);
                    var u = url;
                    item.Click += (_, __) => { LogLine("quick play: " + source + " -> " + u); _brain.Call(HostCalls.PlayRecent, source, u); SetPill("Prism · loading " + prefix + text + "…"); };
                    into.Add(item); any = true;
                }
        }
        catch { }
        // the service's library, as the page listed it: pick and it plays through the service's own queue - no page visit
        var libRaw = await RuntimeEvalAsync("PrismRuntime.musicLibrary(" + Q(source) + ")");
        try
        {
            if (libRaw is not null && System.Text.Json.Nodes.JsonNode.Parse(libRaw) is System.Text.Json.Nodes.JsonObject lib)
            {
                // Play orders (2026-09-17): the row is one press, as before ("I hate burying those in the menus") - it carries on a saved
                // spot in a Prism-ordered play of this playlist, else plays it in order; the order itself is chosen on the transport's
                // order button. The standing order's playlist says so on its row.
                var standing = lib["order"] as System.Text.Json.Nodes.JsonObject;
                var standingId = standing?["id"]?.GetValue<string>();
                var standingSpot = standing?["spot"] is System.Text.Json.Nodes.JsonValue spv && spv.TryGetValue<int>(out var spot) ? spot : (int?)null;
                var standingCount = standing?["count"] is System.Text.Json.Nodes.JsonValue cnv && cnv.TryGetValue<int>(out var cnt) ? cnt : (int?)null;
                var standingLabel = standing?["label"]?.GetValue<string>();
                foreach (var (key, title) in new[] { ("playlists", "Playlists"), ("stations", "Stations") })
                {
                    if (lib[key] is not System.Text.Json.Nodes.JsonArray items || items.Count == 0) continue;
                    var sub = new MenuFlyoutSubItem { Text = title + "  (" + items.Count + ")" };
                    foreach (var it in items.OfType<System.Text.Json.Nodes.JsonObject>().Take(60))
                    {
                        var id = it["id"]?.GetValue<string>(); var name = it["name"]?.GetValue<string>(); var kind = it["kind"]?.GetValue<string>() ?? (key == "stations" ? "station" : "playlist");
                        if (id is null || name is null) continue;
                        var (i2, k2, n2) = (id, kind, name);
                        var continues = standingId == id && standingSpot is int sp && standingCount is int sc && sc > 0 && standingLabel is { Length: > 0 };
                        // a press plays the playlist in its own default order (2026-09-24, "we should just leave it as the default and let the user set the
                        // order once it has been selected"); a saved spot in a Prism order is carried on only when asked - the row's right-click
                        var mi = new MenuFlyoutItem { Text = name, Foreground = VizNowInk };
                        mi.Click += (_, __) => { LogLine("quick play: " + source + " " + k2 + " " + i2 + " (in order)"); if (continues) _brain.Call(HostCalls.PlayCollection, source, k2, i2, "normal"); else _brain.Call(HostCalls.PlayCollection, source, k2, i2); SetPill("Prism · loading " + prefix + n2 + "…"); };
                        if (continues)
                        {
                            var carry = new MenuFlyoutItem { Text = "Carry on: " + standingLabel + ", " + standingSpot + " of " + standingCount };
                            carry.Click += (_, __) => { LogLine("quick play: " + source + " " + k2 + " " + i2 + " (carry on)"); _brain.Call(HostCalls.PlayCollection, source, k2, i2); SetPill("Prism · carrying on " + prefix + n2 + "…"); };
                            var cf = new MenuFlyout(); cf.Items.Add(carry);
                            mi.ContextFlyout = cf;
                            ToolTipService.SetToolTip(mi, "Plays in order. Right-click to carry on the " + standingLabel + " where it left off (" + standingSpot + " of " + standingCount + ").");
                        }
                        sub.Items.Add(mi);
                    }
                    if (any) into.Add(new MenuFlyoutSeparator());
                    into.Add(sub); any = true;
                }
            }
        }
        catch { }
        return any;
    }

    private Grid BuildVisualizationChrome(string tileId, string source)
    {
        var g = new Grid { HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(1, 0, 0, 0)) };
        var parts = new VizChromeParts { Source = source };

        // ---- point 3 (P4): the metadata BLOCK, bottom-left, two lines
        var meta = new StackPanel { Orientation = Orientation.Vertical, Spacing = 2, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(28, 0, 0, 26), IsHitTestVisible = false };
        // Wall type, not desktop type. 13px was unreadable from across a room -
        // "I can't tell what is running" - and the whole point of this block is
        // that someone walking past knows what is playing without touching
        // anything. The two lines keep P4's shape and treatments.
        parts.Title = new TextBlock { Text = "", FontFamily = VizDisplay, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 34, Foreground = VizNowInk, MaxWidth = 900, TextTrimming = TextTrimming.CharacterEllipsis };
        parts.Line2 = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 0, HorizontalAlignment = HorizontalAlignment.Left };
        parts.Artist = new TextBlock { Text = "", FontFamily = VizSans, FontSize = 19, Foreground = VizDimInk, MaxWidth = 620, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Bottom };
        parts.State = new TextBlock { Text = "", FontFamily = VizMono, FontSize = 13, Foreground = VizDimInk, VerticalAlignment = VerticalAlignment.Bottom };
        parts.Spinner = new ProgressRing { Width = 14, Height = 14, IsActive = false, Visibility = Visibility.Collapsed, Margin = new Thickness(8, 0, 0, 3), VerticalAlignment = VerticalAlignment.Bottom, Foreground = VizNowInk };
        parts.Line2.Children.Add(parts.Artist); parts.Line2.Children.Add(parts.State); parts.Line2.Children.Add(parts.Spinner);
        parts.Album = new TextBlock { Text = "", FontFamily = VizSans, FontSize = 16, Foreground = VizDimInk, Opacity = 0.85, MaxWidth = 620, TextTrimming = TextTrimming.CharacterEllipsis };
        parts.Service = new TextBlock { Text = "", FontFamily = VizSans, FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, CharacterSpacing = 140, Foreground = VizDimInk, Opacity = 0.9 };
        parts.Collection = new TextBlock { Text = "", FontFamily = VizSans, FontSize = 16, Foreground = VizDimInk, MaxWidth = 620, TextTrimming = TextTrimming.CharacterEllipsis };
        meta.Children.Add(parts.Service); meta.Children.Add(parts.Title); meta.Children.Add(parts.Line2); meta.Children.Add(parts.Album); meta.Children.Add(parts.Collection);

        // ---- the artwork card, top-right: the cover itself, clear, framed. Backdrop mode keeps blurring it behind the scene.
        parts.Art = new Image { Stretch = Stretch.UniformToFill };
        parts.ArtCard = new Border { Width = 200, Height = 200, CornerRadius = new CornerRadius(14), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x60, 0xF0, 0xA8, 0x3C)), BorderThickness = new Thickness(1), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xC0, 0x0B, 0x0D, 0x12)), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 22, 22, 0), Visibility = Visibility.Collapsed, IsHitTestVisible = true, Child = parts.Art };
        // B-184 (2026-09-09): a tap on the poster moves it between the top-right corner and the centre, enlarged; the choice is
        // this machine's (host-prefs posterCentred) and holds across services and restarts
        parts.ArtCard.Tapped += (_, e) => { e.Handled = true; TogglePoster(); };
        // 2026-09-14: "show the little intermission symbol in the top left corner of the ad posters" - the half-moon chip the
        // Veil extension wears on every cover, over the break image only; the service's own artwork carries no mark.
        {
            var artGrid = new Grid();
            parts.ArtCard.Child = null;   // the image was the card's child; an element with two parents throws (0x800F1000 "No installed components were detected" - the 12:06 build's dead player, 2026-09-14)
            artGrid.Children.Add(parts.Art);
            parts.BreakGlyph = new TextBlock
            {
                Text = GlyphSoundscape, FontFamily = new FontFamily("Segoe UI Symbol"), FontSize = 15, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xF0, 0xA8, 0x3C)),
                HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(8, 6, 0, 0), Padding = new Thickness(6, 3, 6, 3),
                Visibility = Visibility.Collapsed, IsHitTestVisible = false,
            };
            var chip = new Border { Child = parts.BreakGlyph, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x80, 0x0A, 0x0C, 0x0F)), CornerRadius = new CornerRadius(6), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(8, 6, 0, 0), IsHitTestVisible = false };
            parts.BreakGlyph.Margin = new Thickness(0);
            chip.Visibility = Visibility.Collapsed;
            parts.BreakGlyph.RegisterPropertyChangedCallback(UIElement.VisibilityProperty, (d, _) => chip.Visibility = ((UIElement)d).Visibility);
            artGrid.Children.Add(chip);
            parts.ArtCard.Child = artGrid;
        }

        // ---- point 5: the style/mode label, top-right, edit mode only
        parts.Label = new TextBlock { Text = "", FontFamily = VizMono, FontSize = 11, Foreground = VizDimInk, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 236, 16, 0), IsHitTestVisible = false };

        // ---- point 4: transport, bottom-right - §32 layer 3 pass-through, unmapped actions disabled, never hidden
        // The transport rests VISIBLE (0.85), not hidden at 0.4: on a wall across
        // the room a control you cannot see is a control you do not have. It
        // still brightens under the pointer and settles back, but never fades to
        // near-nothing. Bigger glyphs and padding for the same reason.
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 12, 16), Padding = new Thickness(10, 5, 10, 5), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xDD, 0x12, 0x13, 0x1A)), CornerRadius = new CornerRadius(12), Opacity = 0.85 };
        // elapsed / total, monospace so the digits do not jitter as they tick
        // B-185 (2026-09-09): the clock stands on its own, centred under the place the enlarged poster takes - and stays
        // there whether the poster is in the centre or in its corner (ApplyPosterPlacement sets the margin from the same geometry)
        parts.Time = new TextBlock { Text = "", FontFamily = VizMono, FontSize = 22, Foreground = VizDimInk, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, IsHitTestVisible = false };
        ApplyPosterPlacement(parts, 0, 0);   // both the card and the clock exist now (a placement before the clock was built took the chrome down, 2026-09-09)
        Button Ctl(string glyph, string tip, Action click)
        {
            var b = new Button { Content = new FontIcon { Glyph = glyph, FontSize = 20 }, Padding = new Thickness(12, 7, 12, 7), IsEnabled = false };
            ToolTipService.SetToolTip(b, tip);
            b.Click += (_, __) => click();
            return b;
        }
        // The metadata line says "hidden facet - muted"; without this the wall
        // states the mute and offers no way out of it, and the only control was a
        // right-click context sheet nobody finds across a room.
        // B-213 (2026-09-16): "I should be able to press mute before the music starts ... It appears grayed out. But I pressed it
        // anyway and when the music started, it did so muted." The button IS live at every moment - the wall's switch is one
        // switch (B-150) - but it sat at 0.65 opacity whenever its source did not own the audio, which is every source before
        // the music starts, beside Previous/Next drawn disabled for the same look. Full ink always; muted reads as a state
        // (amber glyph and edge, the MUTED pill), and a press answers on the wall at once instead of after the next poll.
        parts.MuteIcon = new FontIcon { Glyph = GlyphAudioOff, FontSize = 20, Foreground = VizNowInk };
        parts.Mute = new Button { Content = parts.MuteIcon, Padding = new Thickness(12, 7, 12, 7), BorderThickness = new Thickness(1), BorderBrush = VizNoEdge, CornerRadius = new CornerRadius(6) };
        parts.Mute.Click += (_, __) =>
        {
            // A tap here is unambiguously human, which is also what §3 wants:
            // it both flips the mute and arms this source for audio focus.
            SetWallMutedFromWall(parts.Source, !_wallMuted);   // B-150: the wall's switch
        };
        // B-176 (2026-09-09): hover (or a long look) and the wall's volume slider rises over the button - "no way to change
        // the volume during intermission (no way to change the volume anyway)"
        parts.Mute.PointerEntered += (_, __) => ShowVolumeSlider(parts.Mute, parts.Source);
        parts.Mute.PointerExited += (_, __) => _volumeClose?.Start();
        row.Children.Add(parts.Mute);
        // Another look, on demand (2026-09-06): the next style pack, written into the scene so it sticks.
        // 2026-09-10: the three corner buttons share one size and one solid face. The default Button fill is a
        // near-transparent white that vanished over a bright visual ("they get washed out a lot"), and sizing each
        // by its own glyph (a 40px icon, a 38px symbol) left the three at different widths. Same dark card as the
        // transport row; the fill holds under the pointer and a press too - the default template swaps in its own
        // translucent fills for those states, so each button pins ours through lightweight styling.
        Button Corner(UIElement face, string tip)
        {
            var b = new Button { Content = face, Width = 96, Height = 78, Padding = new Thickness(0), HorizontalAlignment = HorizontalAlignment.Left, HorizontalContentAlignment = HorizontalAlignment.Center, VerticalContentAlignment = VerticalAlignment.Center, CornerRadius = new CornerRadius(12), BorderThickness = new Thickness(1),
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xDD, 0x12, 0x13, 0x1A)), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xFF, 0xFF, 0xFF)) };
            b.Resources["ButtonBackgroundPointerOver"] = new SolidColorBrush(Windows.UI.Color.FromArgb(0xEE, 0x1C, 0x1E, 0x28));
            b.Resources["ButtonBackgroundPressed"] = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF4, 0x26, 0x28, 0x34));
            b.Resources["ButtonBorderBrushPointerOver"] = new SolidColorBrush(Windows.UI.Color.FromArgb(0x80, 0xF0, 0xA8, 0x3C));
            b.Resources["ButtonBorderBrushPressed"] = new SolidColorBrush(Windows.UI.Color.FromArgb(0xB0, 0xF0, 0xA8, 0x3C));
            OwnHover(b);   // the fills above, held by the button itself (memory: hover-loss-tooltips)
            ToolTipService.SetToolTip(b, tip);
            return b;
        }
        var visual = Corner(new FontIcon { Glyph = GlyphNextVisual, FontSize = 40 }, "Next visual - cycles Prism Beams, Spectrum, Ribbon and Bloom, and keeps your pick in the scene");
        visual.Click += (_, __) => _ = CycleVisualizationStyleAsync(tileId);
        // Quick play (2026-09-06): the last five albums / playlists / stations this source played from, one tap each -
        // so nobody goes all the way into the service's page for the thing they played yesterday.
        parts.Recent = Corner(new FontIcon { Glyph = GlyphRecent, FontSize = 40 }, "Quick play - the last five things this source played from");
        parts.Recent.Click += (_, __) => _ = ShowQuickPlayAsync(parts.Recent, parts.Source);
        // B-144 (2026-09-08): the soundscape wheel - hover (or tap) and the sounds fan out around it; a tap on one is the
        // scene's pick for every ad break, None the default. The same setting as the sheet's During ads...
        parts.Sound = Corner(new TextBlock { Text = GlyphSoundscape, FontSize = 38, FontFamily = new FontFamily("Segoe UI Symbol"), VerticalAlignment = VerticalAlignment.Center }, "Intermission plays a soundscape instead of silence");
        parts.Sound.PointerEntered += (_, __) => _ = ShowSoundWheelAsync(parts.Sound);
        parts.Sound.Click += (_, __) => _ = ShowSoundWheelAsync(parts.Sound);
        parts.Sound.PointerExited += (_, __) => _soundWheelClose?.Start();
        // B-185 (2026-09-09): "move Intermission and Next Visual to the top left, and move the Quickplay button underneath those
        // (last), all 3 vertically stacked and larger than they were (maybe 200%)"
        var stack = new StackPanel { Orientation = Orientation.Vertical, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(22, 22, 0, 0) };
        stack.Children.Add(parts.Sound); stack.Children.Add(visual); stack.Children.Add(parts.Recent);
        // B-221 (2026-09-16): the mini player - this visual and its transport in a small always-on-top window with no title bar
        var miniBtn = Corner(new FontIcon { Glyph = GlyphMiniPlayer, FontSize = 34 }, "Mini player - this visual and its controls in a small window that stays on top of everything, no title bar. The music keeps playing here; sign-in and settings stay in the full player. Esc or a double-click on it brings the full player back");
        miniBtn.Click += (_, __) => OpenMiniPlayer(tileId, source);
        parts.Mini = miniBtn;
        stack.Children.Add(miniBtn);
        // B-169 (2026-09-08): "a little thought bubble pointing to the Intermission symbol ... says Crickets... but don't say anything for None"
        parts.SoundBubbleText = new TextBlock { Text = "", FontFamily = VizSans, FontSize = 13, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x12, 0x13, 0x1A)) };
        var bubbleBody = new Border { Child = parts.SoundBubbleText, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF2, 0xF0, 0xA8, 0x3C)), CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 5, 12, 5) };
        // B-185: the half-moon lives at the top-left now, so the bubble sits to its right and points left
        var pointer = new Microsoft.UI.Xaml.Shapes.Polygon { Fill = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF2, 0xF0, 0xA8, 0x3C)), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, -1, 0) };
        pointer.Points.Add(new Windows.Foundation.Point(7, 0)); pointer.Points.Add(new Windows.Foundation.Point(0, 6)); pointer.Points.Add(new Windows.Foundation.Point(7, 12));
        parts.SoundBubble = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Visibility = Visibility.Collapsed, IsHitTestVisible = false };
        parts.SoundBubble.Children.Add(pointer); parts.SoundBubble.Children.Add(bubbleBody);
        // 2026-09-09: the bubble lives on a Canvas of its own - placed by coordinates, taking part in no layout - after it was
        // seen "centred and alternating between the top and the bottom": as a Grid child its margin took part in the arrange
        parts.BubbleLayer = new Canvas { IsHitTestVisible = false };
        parts.BubbleLayer.Children.Add(parts.SoundBubble);
        // Skip back / forward through the page's OWN seek handlers (§32
        // pass-through). Reveal is for signing in; the wall player should cover
        // the rest.
        parts.SeekBack = Ctl(GlyphSeekBack, "Skip back", () => _brain.Call(HostCalls.TileCommand, parts.Source, "seekbackward"));
        row.Children.Add(parts.SeekBack);
        // B-141 (2026-09-08): Start over - the collection the page holds, queued again: a station refreshes, a playlist starts from the top
        parts.Restart = Ctl(GlyphStartOver, "Start over", () => _brain.Call(HostCalls.TileCommand, parts.Source, "restart"));
        row.Children.Add(parts.Restart);
        parts.Prev = Ctl(GlyphPrevious, "Previous", () => _brain.Call(HostCalls.TileCommand, parts.Source, "prev"));
        parts.PlayIcon = new FontIcon { Glyph = GlyphPlay, FontSize = 22 };
        parts.Play = new Button { Content = parts.PlayIcon, Padding = new Thickness(12, 7, 12, 7), IsEnabled = false };
        parts.Play.Click += (_, __) => { _brain.Call(HostCalls.TileCommand, parts.Source, parts.Playing ? "pause" : "play"); _ = Task.Delay(400).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = RefreshVisualizationTransportAsync())); };   // B-151: the MUTED pill follows the press
        parts.Next = Ctl(GlyphNext, "Next", () => _brain.Call(HostCalls.TileCommand, parts.Source, "next"));
        parts.SeekFwd = Ctl(GlyphSeekFwd, "Skip forward", () => _brain.Call(HostCalls.TileCommand, parts.Source, "seekforward"));
        // Play orders (2026-09-17): the order the playlist plays in - in order, the service's shuffle, Prism's true shuffle, in
        // reverse - chosen here for whatever is playing ("let them open the playlist the normal way, and then let them press a
        // button in the controls that gives them the order configurations"); a saved spot is continued from here too
        parts.Order = Ctl(GlyphOrder, "Play order", () => _ = ShowOrderFlyoutAsync(parts));
        // 2026-09-14: the service's own offer, in its own words (Pandora: "Get more skips" once the skips are spent - watch an ad
        // for more). Hidden until the page shows one; a press goes to the page's own button, and the ad that follows is a break.
        parts.Offer = new Button { Content = "", Padding = new Thickness(14, 7, 14, 7), Visibility = Visibility.Collapsed, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xF0, 0xA8, 0x3C)) };
        ToolTipService.SetToolTip(parts.Offer, "The service's own offer. It may play an ad, which the wall covers like any break");
        parts.Offer.Click += (_, __) => { _brain.Call(HostCalls.TileCommand, parts.Source, "offer"); _ = Task.Delay(900).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = RefreshVisualizationTransportAsync())); };
        // B-155 (2026-09-08): thumbs up / down - the verdict goes to the service (Apple's ratings API, Pandora's thumbs), lit amber when it stands
        parts.UpIcon = new FontIcon { Glyph = GlyphLike, FontSize = 20 }; parts.DownIcon = new FontIcon { Glyph = GlyphDislike, FontSize = 20 };
        // B-160 (2026-09-08): the verdict shows as a FILLED white thumb ("more traditionally"), the outline while none stands.
        // Filled shapes: Material Design icons thumb_up / thumb_down (Apache-2.0), 24-unit paths in a 20 px viewbox.
        static Viewbox Filled(string path) => new() { Width = 20, Height = 20, Visibility = Visibility.Collapsed, Child = new Microsoft.UI.Xaml.Shapes.Path { Fill = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xF2, 0xF4, 0xF8)), Data = (Microsoft.UI.Xaml.Media.Geometry)Microsoft.UI.Xaml.Markup.XamlBindingHelper.ConvertValue(typeof(Microsoft.UI.Xaml.Media.Geometry), path) } };
        parts.UpFilled = Filled("M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z");
        parts.DownFilled = Filled("M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z");
        var upBox = new Grid(); upBox.Children.Add(parts.UpIcon); upBox.Children.Add(parts.UpFilled);
        var downBox = new Grid(); downBox.Children.Add(parts.DownIcon); downBox.Children.Add(parts.DownFilled);
        parts.Up = new Button { Content = upBox, Padding = new Thickness(12, 7, 12, 7), IsEnabled = false }; ToolTipService.SetToolTip(parts.Up, "Thumbs up tells the service you like this");
        parts.Down = new Button { Content = downBox, Padding = new Thickness(12, 7, 12, 7), IsEnabled = false }; ToolTipService.SetToolTip(parts.Down, "Thumbs down tells the service to play less of this");
        parts.Up.Click += (_, __) => { _brain.Call(HostCalls.TileCommand, parts.Source, "thumbup"); _ = Task.Delay(900).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = RefreshVisualizationTransportAsync())); };
        parts.Down.Click += (_, __) => { _brain.Call(HostCalls.TileCommand, parts.Source, "thumbdown"); _ = Task.Delay(900).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = RefreshVisualizationTransportAsync())); };
        row.Children.Add(parts.Down); row.Children.Add(parts.Up);
        row.Children.Add(parts.Prev); row.Children.Add(parts.Play); row.Children.Add(parts.Next); row.Children.Add(parts.SeekFwd); row.Children.Add(parts.Order); row.Children.Add(parts.Offer);
        parts.Row = row;
        // B-151 (2026-09-08): "a more prominent label on the screen indicating we're muted right now" - top centre, a tap unmutes
        var mb = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center };
        mb.Children.Add(new FontIcon { Glyph = GlyphAudioOff, FontSize = 18, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xF0, 0xA8, 0x3C)) });
        mb.Children.Add(new TextBlock { Text = "MUTED", FontFamily = VizMono, FontSize = 15, CharacterSpacing = 160, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xF0, 0xA8, 0x3C)), VerticalAlignment = VerticalAlignment.Center });
        mb.Children.Add(new TextBlock { Text = "tap to unmute", FontFamily = VizSans, FontSize = 12, Foreground = VizDimInk, VerticalAlignment = VerticalAlignment.Center });
        parts.MutedBanner = new Border { Child = mb, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 14, 0, 0), Padding = new Thickness(16, 8, 16, 8), CornerRadius = new CornerRadius(20), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xD0, 0x12, 0x13, 0x1A)), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x66, 0xF0, 0xA8, 0x3C)), BorderThickness = new Thickness(1), Visibility = Visibility.Collapsed };
        parts.MutedBanner.Tapped += (_, e) => { e.Handled = true; SetWallMutedFromWall(parts.Source, false); };

        // A thin progress bar along the very bottom edge: at a glance, from across
        // the room, how far through the track we are. Display only - seeking is a
        // §32 pass-through question and no seek control is offered here.
        parts.BarTrack = new Rectangle { Height = 3, Fill = new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xFF, 0xFF, 0xFF)), VerticalAlignment = VerticalAlignment.Bottom, HorizontalAlignment = HorizontalAlignment.Stretch, IsHitTestVisible = false, Visibility = Visibility.Collapsed };
        parts.Bar = new Rectangle { Height = 3, Fill = new SolidColorBrush(Windows.UI.Color.FromArgb(0xEE, 0xF0, 0xA8, 0x3C)), VerticalAlignment = VerticalAlignment.Bottom, HorizontalAlignment = HorizontalAlignment.Left, IsHitTestVisible = false, Width = 0, Visibility = Visibility.Collapsed };
        g.Children.Add(meta); g.Children.Add(parts.ArtCard); g.Children.Add(parts.Label); g.Children.Add(parts.BarTrack); g.Children.Add(parts.Bar); g.Children.Add(row); g.Children.Add(stack); g.Children.Add(parts.Time); g.Children.Add(parts.MutedBanner); g.Children.Add(parts.BubbleLayer);
        _vizParts[tileId] = parts;

        // the transport brightens under the pointer and settles back; it is never removed (point 4).
        DispatcherTimer? dim = null;
        void Show()
        {
            row.Opacity = 1;
            dim ??= new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            dim.Stop();
            dim.Tick -= OnDim; dim.Tick += OnDim;
            dim.Start();
        }
        void OnDim(object? s, object e) { dim?.Stop(); row.Opacity = 0.85; }   // settles back to visible, never to near-nothing
        g.PointerEntered += (_, __) => Show();
        g.PointerMoved += (_, __) => Show();
        g.Tapped += (_, e) =>
        {
            if (e.OriginalSource is DependencyObject d && IsInside(d, row)) return;      // a transport press is not a reveal
            e.Handled = true;
            Show();
        };
        g.RightTapped += (_, e) => { e.Handled = true; var item = SceneItemOf(tileId, null); if (item is not null) ShowContextSheet(item, e.GetPosition(RootGrid)); };
        g.Holding += (_, e) => { if (e.HoldingState == Microsoft.UI.Input.HoldingState.Started) { e.Handled = true; var item = SceneItemOf(tileId, null); if (item is not null) ShowContextSheet(item, e.GetPosition(RootGrid)); } };
        return g;
    }

    /// <summary>
    /// §2.5.3: while a hidden facet's player is revealed, the chrome over the
    /// visualizations it feeds steps aside - the player owns those pixels and
    /// those taps, and the visualization underneath keeps running untouched
    /// (its surface is never stopped, so the beams resume mid-animation when the
    /// player is tucked away). Called from the reveal and the collapse, and on
    /// the poll so a reveal from the remote or the sheet lands the same way.
    /// </summary>
    /// <summary>
    /// Elapsed / total beside the transport, and the bar along the bottom edge.
    /// A live stream reports no duration: the elapsed time still shows and the
    /// bar stays hidden rather than pretending to a position in a track that has
    /// no end. Interpolated from the last report so the clock ticks each tick
    /// instead of stepping every 2 seconds.
    /// </summary>
    private void RenderTransportTime(VizChromeParts parts)
    {
        static string Clock(double sec)
        {
            if (double.IsNaN(sec) || double.IsInfinity(sec) || sec < 0) sec = 0;
            var ts = TimeSpan.FromSeconds(sec);
            return ts.TotalHours >= 1 ? ((int)ts.TotalHours) + ":" + ts.Minutes.ToString("00") + ":" + ts.Seconds.ToString("00")
                                      : ts.Minutes + ":" + ts.Seconds.ToString("00");
        }

        if (!parts.Playing && parts.PosSec <= 0)
        {
            parts.Time.Text = "";
            parts.Bar.Visibility = Visibility.Collapsed;
            parts.BarTrack.Visibility = Visibility.Collapsed;
            return;
        }

        var shown = parts.PosSec + (parts.Playing ? (DateTimeOffset.UtcNow - parts.PosAt).TotalSeconds : 0);
        var dur = parts.DurSec;
        if (dur > 0) shown = Math.Min(shown, dur);

        parts.Time.Text = VisualizationChrome.BreakClock(parts.AdCount, dur > 0 ? Clock(shown) + " / " + Clock(dur) : Clock(shown));   // 2026-09-15: the ad's number, when the page counts them

        var host = parts.Bar.Parent as FrameworkElement;
        var width = host?.ActualWidth ?? 0;
        if (dur > 0 && width > 0)
        {
            parts.BarTrack.Visibility = Visibility.Visible;
            parts.Bar.Visibility = Visibility.Visible;
            parts.Bar.Width = Math.Max(0, Math.Min(width, width * (shown / dur)));
        }
        else
        {
            parts.BarTrack.Visibility = Visibility.Collapsed;
            parts.Bar.Visibility = Visibility.Collapsed;
        }
    }

    private void ApplyVisualizationRevealState()
    {
        // A visualization's chrome is a RootGrid child at z 20, ABOVE the tile
        // canvas (default z 0) that carries every surface. In Music Lounge the
        // stage is the whole canvas, so that chrome is the size of the wall - and
        // while it is hit-testable it swallows every click meant for whatever a
        // Prism screen has put on the canvas underneath. That is how App setup
        // came up unclickable: the page was there, at surface z 900, under a
        // full-screen transparent chrome. So the chrome steps aside for a screen
        // exactly as it does for a reveal (§2.5.3's rule, applied to editors).
        var showing = _revealedTile ?? _vizRevealedInCore;
        foreach (var (tileId, parts) in _vizParts)
        {
            if (!_vizChrome.TryGetValue(tileId, out var g)) continue;
            // Either identifier means "this visualization's player is up". A
            // reveal resolves through TileOfFacetAsync, which returns the FIRST
            // wall tile whose item.Facet matches - and for a Music Lounge scene
            // that is the STAGE (SceneItemOf reports a music-visualization item
            // whose Facet is its source), so _revealedTile holds "stage" while
            // parts.Source holds the hidden facet id. Comparing only against
            // Source left the chrome visible and HIT-TESTABLE over the revealed
            // player: every click hit the chrome instead of Apple Music, and the
            // corner Back tucked it away again. §2.5.3 requires the opposite -
            // the player owns its own pixels and taps while it is up.
            // 2026-09-08, one rule for every service: while ANY hidden music player is up - the stage's own source or another
            // service's, via Quick play or the sheet - every visualization's chrome steps aside. Matching the revealed id
            // against this chrome's source left Spotify's window under a hit-testable full-wall chrome ("can't click anything")
            // while Apple Music's, the stage's source, worked. The player owns the wall while it is up (concept-scenes 2.5.3).
            var revealed = showing is not null;
            // Reveal-only, deliberately. A previous attempt also hid the chrome
            // whenever any editor screen was open; one stale field then hid the
            // transport and the tap target for good, and the wall had no controls
            // at all. The rail covering App setup - the bug that motivated it - is
            // fixed at the source instead (CloseRail() in OpenAppSetup /
            // OpenFacetEditor), so this stays narrow.
            // B-156 (2026-09-08): App setup too. Its page sits at surface z 900 UNDER this chrome (a RootGrid child above the
            // canvas, with a hit-testable background the size of the wall in a lounge), so a sign-in came up with the transport
            // drawn over Spotify and not one click reaching the page. _asSession is the setup's own flag: set at open,
            // cleared at close, and both call here
            var stepAside = revealed || _asSession;
            if (g.Opacity == 0 != stepAside)
                LogLine($"viz chrome {tileId}: {(stepAside ? (_asSession && !revealed ? "hidden (app setup)" : "hidden (player revealed)") : "visible")}  source={parts.Source} revealedTile={_revealedTile ?? "-"} core={_vizRevealedInCore ?? "-"}");
            g.Opacity = stepAside ? 0 : 1;
            g.IsHitTestVisible = !stepAside;
        }
    }

    private static bool IsInside(DependencyObject d, DependencyObject ancestor)
    {
        for (var x = d; x is not null; x = VisualTreeHelper.GetParent(x)) if (ReferenceEquals(x, ancestor)) return true;
        return false;
    }

    /// <summary>
    /// One pass over the composition's live parts (§2.5.2 points 3, 4 and 5):
    /// transport availability from the source's Media Session actions (core's
    /// transportAvailability reading - enable what the page registered, disable
    /// the rest, never hide), the metadata line, and the edit-mode label. Every
    /// fact here is core's: `nowPlaying` for the track and the playing state,
    /// `/state.audioOwner` for §3 exclusivity.
    /// </summary>
    /// <summary>
    /// B-213: the mute button and the MUTED pill drawn from the wall's one switch (B-150). The button is never dimmed and
    /// never disabled - it acts at every moment, music or not. Muted is a state to notice: amber glyph, amber edge, the pill;
    /// unmuted is the plain speaker in light ink. Who owns the audio lives in the tooltip and the metadata line, not in the button's opacity.
    /// </summary>
    private void ApplyMuteLook(VizChromeParts parts)
    {
        parts.MuteIcon.Glyph = _wallMuted ? GlyphAudioOff : GlyphAudioOn;
        parts.MuteIcon.Foreground = _wallMuted ? VizAmberInk : VizNowInk;
        parts.Mute.BorderBrush = _wallMuted ? VizAmberEdge : VizNoEdge;
        parts.Mute.Opacity = 1.0;
        parts.MutedBanner.Visibility = _wallMuted ? Visibility.Visible : Visibility.Collapsed;   // B-151: the wall's switch
        ToolTipService.SetToolTip(parts.Mute, VisualizationChrome.MuteTip(_wallMuted, parts.Owns));
    }

    /// <summary>
    /// A press on the wall flips the switch: core is told (the §3 path - an unmute takes the audio for this source), and the
    /// wall answers at once - every stage's button, pill and slider redraw from the new value before the 150 ms refresh
    /// reads core's own word. The press used to wait for that refresh, and before the music started nothing on the button
    /// changed in a way a person across the room could see.
    /// </summary>
    private void SetWallMutedFromWall(string source, bool muted)
    {
        _brain.Call(HostCalls.TileCommand, source, muted ? "mute" : "unmute");
        _wallMuted = muted;
        foreach (var (_, p) in _vizParts) ApplyMuteLook(p);
        SyncVolumeSlider();
        _ = Task.Delay(150).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = RefreshVisualizationTransportAsync()));
    }

    /// <summary>The transport poll runs from a DispatcherQueueTimer as an async lambda: an exception past its first await would end the process with no managed report. Caught and logged here (2026-09-07).</summary>
    private async Task RefreshVisualizationTransportAsync()
    {
        try { await RefreshVisualizationTransportCoreAsync(); }
        catch (Exception ex) { LogLine("transport refresh failed: " + ex.GetType().Name + ": " + ex.Message + " @ " + (ex.StackTrace ?? "").Split('\n').FirstOrDefault()?.Trim()); }
    }

    private async Task RefreshVisualizationTransportCoreAsync()
    {
        if (_vizParts.Count == 0) return;
        List<TransportState> transport;
        try { transport = await ReadTransportAsync(); }
        catch { return; }   // a failed read is a skipped frame, never a dead dispatcher
        await RefreshMusicSourcesAsync();   // the sheet and the menu read this cache
        // 2026-09-18: the status feed says what the wall is doing in the background - a track-list read and how far it has got -
        // and says when it is done ("we should have some kind of processing/loading indicator")
        var working = transport.FirstOrDefault(x => x.Work is { Length: > 0 });
        if (working?.Work is { } wfail && wfail.StartsWith('!'))
        {
            // 2026-09-19: a read that failed - said once, fading, and the held line released
            var svcName = working.Facet is { } wf3 && _model.Facet(wf3) is { } wmf3 && _model.App(wmf3.App) is { } wma3 ? wma3.Name : null;
            var line = "Prism " + (char)0xB7 + " " + (svcName is { Length: > 0 } ? svcName + ": " : "") + wfail.Substring(1);
            if (line != _workLine) { _workLine = null; _workName = null; _workFailLine = line; ReleasePill(line); }
        }
        else if (working?.Work is { } wtext)
        {
            var svcName = working.Facet is { } wf && _model.Facet(wf) is { } wmf && _model.App(wmf.App) is { } wma ? wma.Name : null;
            var line = "Prism " + (char)0xB7 + " " + (svcName is { Length: > 0 } ? svcName + ": " : "") + wtext;
            // held while the work runs: re-asserted on every beat the pill is not showing it (a passing line, or a hide)
            if (line != _workLine || PillLine.Text != line || PillBorder.Visibility != Visibility.Visible) { _workLine = line; _workName = working.Facet; SetPill(line, hold: true); }
        }
        else if (_workLine is not null)
        {
            var svcName = _workName is { } wf2 && _model.Facet(wf2) is { } wmf2 && _model.App(wmf2.App) is { } wma2 ? wma2.Name : null;
            _workLine = null; _workName = null;
            ReleasePill("Prism " + (char)0xB7 + " " + (svcName is { Length: > 0 } ? svcName + ": " : "") + "the list is ready");
        }
        var (_, audioOwner) = await VisualizationTilesAsync();
        var editMode = VisualizationEditMode;
        foreach (var (tileId, parts) in _vizParts)
        {
            var t = transport.FirstOrDefault(x => x.TileId == parts.Source || x.Facet == parts.Source);
            parts.Playing = t?.Playing == true;
            parts.PlayIcon.Glyph = parts.Playing ? GlyphPause : GlyphPlay;
            parts.Prev.IsEnabled = t?.Prev == true;
            parts.Next.IsEnabled = t?.Next == true;
            parts.Offer.Content = t?.Offer ?? ""; parts.Offer.Visibility = string.IsNullOrWhiteSpace(t?.Offer) ? Visibility.Collapsed : Visibility.Visible;   // 2026-09-14: the page's own offer, only while it shows one
            // B-141: the page names what it holds; B-209 (2026-09-16): also a pick in flight or one that could not start (Start over re-queues it)
            // and a remembered resume point ("waiting to play - tap play to resume", B-204) - core's restartMusic covers all three, and after a
            // restart the button sat grey exactly when a person wanted it to try the station again
            parts.Restart.IsEnabled = t?.Collection is { Length: > 0 } || t?.Pending is { Length: > 0 } || t?.ResumeTitle is not null || t?.ResumeLabel is not null || t?.Title is { Length: > 0 };   // a loaded track too (2026-09-16)
            var rateable = t?.Rate == true && (parts.Playing || !string.IsNullOrWhiteSpace(t?.Title));   // B-155: a track is there to judge
            parts.Up.IsEnabled = rateable; parts.Down.IsEnabled = rateable;
            var up = t?.Rating == 1; var down = t?.Rating == -1;   // B-160: filled while the verdict stands
            parts.UpIcon.Visibility = up ? Visibility.Collapsed : Visibility.Visible; parts.UpFilled.Visibility = up ? Visibility.Visible : Visibility.Collapsed;
            parts.DownIcon.Visibility = down ? Visibility.Collapsed : Visibility.Visible; parts.DownFilled.Visibility = down ? Visibility.Visible : Visibility.Collapsed;
            ToolTipService.SetToolTip(parts.Up, up ? "You like this, and the service knows" : "Thumbs up tells the service you like this");
            ToolTipService.SetToolTip(parts.Restart, t?.CollectionKind switch { "station" => "Refresh the station and tune it again from the top", "playlist" => "Start the playlist over from its first track", "album" => "Start the album over from its first track", _ => t?.Pending is { Length: > 0 } ? "Try again and queue it afresh from the top" : t?.ResumeLabel is { Length: > 0 } rl ? "Start " + rl + " over from the top" : "Start over" });
            // Play orders (2026-09-17): the button acts on the collection the page holds (a playlist or an album), else on the standing order
            var orderKind = t?.OrderId is { Length: > 0 } ? t.OrderKind : t?.CollectionKind;
            var orderId = t?.OrderId is { Length: > 0 } ? t.OrderId : t?.CollectionId;
            parts.OrderKind = orderKind; parts.OrderId = orderId; parts.OrderName = t?.OrderName ?? t?.Collection; parts.OrderLabel = t?.Order; parts.OrderSpot = t?.OrderSpot;
            parts.Order.IsEnabled = orderId is { Length: > 0 } && orderKind is "playlist" or "album";
            ToolTipService.SetToolTip(parts.Order, !parts.Order.IsEnabled ? (orderKind == "station" ? "A station has no order to choose" : "Play order works once a playlist or album is playing") : "Play order" + (t?.Order is { Length: > 0 } ol ? ": " + ol + (t.OrderSpot is { Length: > 0 } os ? ", " + os : "") : ""));
            parts.SeekBack.IsEnabled = t?.SeekBack == true;   // §32: disabled, never hidden
            parts.SeekFwd.IsEnabled = t?.SeekFwd == true;
            parts.Play.IsEnabled = t is not null && (parts.Playing ? t.Pause : t.Play);
            // point 3: the line, and who owns audio, exactly as core reports them
            var owns = audioOwner is { } o && t is not null && (o == t.TileId || o == t.Facet);
            // point 3 (P4): line 1 the title, line 2 the artist then the state.
            // The three pieces come from core's nowPlaying FIELDS - nothing here
            // parses a joined "title - artist" string, so the block renders the
            // same before and after the seed's DEMO_TRACK.line split (CS-10.5).
            // a loaded track stays on the wall while paused (state "paused"); only nothing-loaded is an empty block
            var pending = t?.Pending is { Length: > 0 } pn ? pn : null;
            var loaded = parts.Playing || !string.IsNullOrWhiteSpace(t?.Title) || pending is not null;
            var serviceName = t?.Facet is { } tf && _model.Facet(tf) is { } mf && _model.App(mf.App) is { } ma ? ma.Name : null;
            // Play orders (2026-09-17): the collection line says the order when this tile plays in one - the page names no
            // collection for a Prism-made queue, so the order's own collection stands in
            var collectionLine = t?.Collection;
            var prismOrder = t?.Order is "true shuffle" or "in reverse";   // a Prism-made queue: the page names the song as its container, never the playlist
            // B-233: over the wall's own queue (the page names no collection) or the order's own collection - never over a station
            // or another playlist the page has moved on to while the order still stands
            var pageHoldsOther = t?.CollectionKind is { Length: > 0 } && t.CollectionId is { Length: > 0 } && t.CollectionId != t.OrderId;
            if (t?.Order is { Length: > 0 } od && !pageHoldsOther && (prismOrder || string.IsNullOrEmpty(t.Collection) || t.Collection == t.OrderName)) collectionLine = (t.OrderName ?? t.Collection ?? "") + "  \u00B7  " + od + (t.OrderSpot is { Length: > 0 } osp ? "  \u00B7  " + osp : "") + (t.Repeat ? "  \u00B7  repeat" + (t.OrderPass is > 1 ? " " + t.OrderPass : "") : "");
            else if (t?.Repeat == true && !string.IsNullOrEmpty(collectionLine)) collectionLine += "  \u00B7  repeat";
            var block = VisualizationChrome.Metadata(loaded, t?.Title, t?.Artist, owns && !_wallMuted, t?.Album, parts.Playing, serviceName, collectionLine);   // B-165: line 2 follows the one switch
            // B-204 (2026-09-15): "It says Apple music is on the stage but I see nothing" - a source back on its page with nothing
            // loaded (every restart boots paused, section 10) showed the service's name over an empty block and a dead Play.
            // Core remembers what the tile played: the block names it and says how to get it back; Play resumes it.
            if (!loaded && t?.ResumeTitle is { Length: > 0 } rt) block = VisualizationChrome.ResumeBlock(serviceName, rt, t.ResumeArtist, t.ResumeLabel);
            parts.Collection.Text = block.Collection.Length > 0 ? "\u25CE  " + block.Collection : ""; parts.Collection.Visibility = block.Collection.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
            parts.Service.Text = block.Service.ToUpperInvariant(); parts.Service.Visibility = block.Service.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
            parts.Title.Text = block.Title;
            parts.Artist.Text = block.Artist;
            parts.Album.Text = block.Album; parts.Album.Visibility = block.Album.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
            // the artwork card follows the cover the source declared; a change swaps the image, none hides the card
            // 2026-09-08: a visual that places the art itself ("focal" - the cover in the centre) needs no second copy top right.
            // B-182 (2026-09-09): a tableau pack paints the scene over the art layer, so it never places it - the card shows for those
            // 2026-09-14: "instead of the 'Advertisement' poster in the middle of the page, can we show a random nature/universe
            // photo instead?" - during a break the card shows one image from the section 27 imagery cache (the CC0 pool: nature
            // and space), picked once per break; the service's own artwork is back the moment the break ends.
            var inBreak = t?.Intermission == true;
            if (!inBreak) parts.BreakArt = null;
            else if (parts.BreakArt is null) { try { var pick = _surfaces.Art.RandomArt(); parts.BreakArt = pick is null ? null : new Uri(pick).AbsoluteUri; } catch { parts.BreakArt = null; } }
            parts.AdCount = inBreak ? t?.AdCount : null;   // 2026-09-15: "Ad 2 of 3" beside the clock while the break runs
            var artUrl = loaded && (parts.Artwork != "focal" || StyleRenderer.PaintsScene(parts.StyleId)) ? (inBreak && parts.BreakArt is not null ? parts.BreakArt : (t?.Artwork ?? "")) : "";
            parts.BreakGlyph.Visibility = inBreak && parts.BreakArt is not null && artUrl.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
            if (artUrl != parts.ArtUrl)
            {
                parts.ArtUrl = artUrl;
                if (artUrl.Length > 0 && Uri.TryCreate(artUrl, UriKind.Absolute, out var artUri))
                {
                    try { parts.Art.Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(artUri) { DecodePixelWidth = 400 }; parts.ArtCard.Visibility = Visibility.Visible; }
                    catch { parts.ArtCard.Visibility = Visibility.Collapsed; }
                }
                else { parts.Art.Source = null; parts.ArtCard.Visibility = Visibility.Collapsed; }
            }
            parts.State.Text = block.Artist.Length > 0 && block.State.Length > 0 ? VisualizationChrome.MetaSeparator + block.State : block.State;
            parts.Line2.Visibility = block.Line2.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
            // B-143 (2026-09-08): an ad break the wall is covering says so - Intermission, as the extension calls it - and
            // what the wall does about it (muted; or the soundscape it plays instead). The service's own "Advertisement" is
            // not the wall's word, and a block that only named the ad read as if the wall had not noticed.
            // B-169: the bubble over the half-moon while a break plays a soundscape
            {
                var bsnd = t?.Intermission == true ? CurrentAdsSound() : "off";
                var show = bsnd != "off" && parts.Sound.ActualWidth > 0;
                if (show) try
                {
                    var actual = bsnd == "random" && _ambientNow.TryGetValue(parts.Source, out var an) ? an : bsnd;   // Random: the recording core chose for this break
                    parts.SoundBubbleText.Text = (AdsSounds.FirstOrDefault(x => x.id == actual).name ?? actual) + (bsnd == "random" ? " (random)" : "") + "…";
                    parts.SoundBubble.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
                    var at = parts.Sound.TransformToVisual(_vizChrome.TryGetValue(tileId, out var gg) ? gg : parts.Sound).TransformPoint(new Windows.Foundation.Point(0, 0));
                    var bw = parts.SoundBubble.DesiredSize.Width; var bh = parts.SoundBubble.DesiredSize.Height;
                    if (at.X <= 0 && at.Y <= 0) show = false;   // the button has no place yet: no bubble, rather than one at the wall's corner
                    else { Canvas.SetLeft(parts.SoundBubble, at.X + parts.Sound.ActualWidth + 6); Canvas.SetTop(parts.SoundBubble, Math.Max(0, at.Y + parts.Sound.ActualHeight / 2 - bh / 2)); }   // B-185: beside the button, pointing at it
                }
                catch { show = false; }
                parts.SoundBubble.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
            }
            if (t?.Intermission == true)
            {
                var snd = CurrentAdsSound();
                if (snd == "random" && _ambientNow.TryGetValue(parts.Source, out var chosen)) snd = chosen;   // the block names the recording, not the setting
                parts.Title.Text = VisualizationChrome.IntermissionTitle; parts.Artist.Text = ""; parts.Album.Visibility = Visibility.Collapsed;
                parts.State.Text = VisualizationChrome.IntermissionState(snd == "off" ? null : snd);
                parts.Line2.Visibility = Visibility.Visible;
            }
            // the loading signal: a pick the page has not started yet takes over line 2 (and line 1 while nothing is loaded)
            if (pending is not null)
            {
                if (parts.Title.Text.Length == 0) parts.Title.Text = pending;
                parts.State.Text = (block.Artist.Length > 0 ? VisualizationChrome.MetaSeparator : "") + VisualizationChrome.PendingState(pending, t!.PendingFailed, serviceName);
                parts.Spinner.IsActive = t.PendingFailed is null; parts.Spinner.Visibility = t.PendingFailed is null ? Visibility.Visible : Visibility.Collapsed;
                parts.Line2.Visibility = Visibility.Visible;
            }
            else if (t?.Session == "signed-out" && parts.Title.Text.Length == 0)
            {
                // B-123: the page is signed out and nothing is loaded - the block says so instead of standing empty
                parts.Title.Text = serviceName ?? ""; parts.State.Text = VisualizationChrome.SignedOutState(serviceName);
                parts.Spinner.IsActive = false; parts.Spinner.Visibility = Visibility.Collapsed; parts.Line2.Visibility = Visibility.Visible;
            }
            else { parts.Spinner.IsActive = false; parts.Spinner.Visibility = Visibility.Collapsed; }
            // whether the SOURCE declared art is core's fact too (the transport
            // row's Artwork), not a guess: it picks "backdrop: album art" vs
            // "backdrop: none" in the label below.
            parts.HasArt = !string.IsNullOrWhiteSpace(t?.Artwork);
            parts.Owns = owns;
            ApplyMuteLook(parts);   // B-150: the switch, not the ownership; B-213: never dimmed
            if (_mini is not null && tileId == _miniTile) _mini.Update(parts.Playing, t?.Title, t?.Artist, t?.Prev == true, t?.Next == true, t is not null && (parts.Playing ? t.Pause : t.Play), _wallMuted, t?.Collection, serviceName, t?.Rate == true && (parts.Playing || !string.IsNullOrWhiteSpace(t?.Title)), t?.Rating ?? 0);   // B-221
            ApplyMiniLook(tileId, parts);
            // point 5 (P5b): "PRISM BEAMS · backdrop: album art" for 4s after a
            // style/artwork change or a scene applying; pinned while editing.
            // §32 layer 3: position/duration are the PAGE's, reported through core.
            // Core polls every 2s, so the readout interpolates between reports
            // rather than jumping - the estimate is only ever used for display.
            if (t?.Position is { } rp)
            {
                // B-153: a report is a whole-second value that lags the local clock by transit and truncation - snapping to it
                // made the seconds jump (23, 24, 25, 23, 27). Within a couple of seconds the report only NUDGES the clock, and
                // the clock never steps back by less than a second; a bigger gap (a seek, a new track) snaps
                // Settled 2026-09-08 ("just use our own timer and sync it up every 10 seconds"): the wall runs its own clock from
                // the last accepted report. A report is accepted at once when the gap is large (a seek, a new track) or the
                // page is paused, otherwise only every 10 s - and then never as a backward step of less than a second
                var now = DateTimeOffset.UtcNow;
                var shownNow = parts.PosSec + (parts.Playing ? (now - parts.PosAt).TotalSeconds : 0);
                var since = (now - parts.PosAnchoredAt).TotalSeconds;
                if (!parts.Playing || parts.PosSec <= 0 || Math.Abs(rp - shownNow) >= 2.5) { parts.PosSec = rp; parts.PosAnchoredAt = now; }
                else if (since >= 10) { parts.PosSec = rp > shownNow || shownNow - rp >= 1.0 ? rp : shownNow; parts.PosAnchoredAt = now; }
                else parts.PosSec = shownNow;
                parts.PosAt = now;
            }
            parts.DurSec = t?.Duration ?? 0;
            try { RenderTransportTime(parts); } catch { /* a readout is never worth the dispatcher */ }

            var age = (DateTimeOffset.UtcNow - parts.LabelSince).TotalSeconds;
            parts.Label.Text = VisualizationChrome.StyleLabel(StylePacks.Get(parts.StyleId).Name, parts.Artwork, parts.HasArt, editMode, age);
            foreach (var (b, tip) in new[] { (parts.Prev, "Previous"), (parts.Next, "Next"), (parts.Play, parts.Playing ? "Pause" : "Play") })
                ToolTipService.SetToolTip(b, b.IsEnabled ? tip : tip + ". The player didn't register this action (§32 layer 3: pass-through only, never simulated)");
        }
        ApplyVisualizationRevealState();
    }
}
