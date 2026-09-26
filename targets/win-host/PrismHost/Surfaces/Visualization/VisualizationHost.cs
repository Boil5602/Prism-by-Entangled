using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using PrismHost.Visualizations;

namespace PrismHost.Surfaces.Visualization;

/// <summary>
/// §32 Layer 1 audio source: bands of the host's own loopback FFT (win-host-spec
/// §6). `Bands(n)` returns n values in 0..1, low → high frequency; all zero when
/// nothing plays. Agent 3's renderers read this; the WASAPI implementation is
/// Services/Audio/WasapiLoopbackFft.cs. (If Agent 3's branch lands an identical
/// interface, keep one - the signature is the contract.)
/// </summary>
public interface IVisualizationAudioSource
{
    float[] Bands(int n);
    /// <summary>A visualization became active / idle: the source may start or stop capturing (idle when nothing plays).</summary>
    void SetDemand(bool active);
}

// VisualizationFeed - what core pushes per visualization - lives in
// PrismHost.Core/VisualizationFeed.cs: pure parsing, no WinUI, asserted in CI.

/// <summary>
/// What a visualization style implements (Agent 3 plugs Prism Beams / Spectrum /
/// Ribbon / Bloom in here; the host ships a plain bars renderer so the surface is
/// never empty). Attached once to the host panel; Render is called ~30 Hz while
/// the feed is active and once with zero bands when it goes idle.
/// </summary>
public interface IVisualizationRenderer
{
    void Attach(Panel host);
    void Detach(Panel host);
    /// <summary>The feed changed (track, artwork, active); called on the UI thread.</summary>
    void Update(VisualizationFeed feed);
    /// <summary>One frame: bands in 0..1, low → high; the panel's current size.</summary>
    void Render(float[] bands, double width, double height);
}

/// <summary>Style id → renderer. Agent 3 registers styles here; unknown styles fall back to bars.</summary>
public static class VisualizationStyles
{
    private static readonly Dictionary<string, Func<IVisualizationRenderer>> Factories = new(StringComparer.OrdinalIgnoreCase);
    public static void Register(string style, Func<IVisualizationRenderer> factory) => Factories[style] = factory;
    public static IVisualizationRenderer Create(string style) => Factories.TryGetValue(style, out var f) ? f() : new BarsRenderer();
    public static IEnumerable<string> Known => Factories.Keys;
}

/// <summary>
/// The visualization surface: a dark panel, a renderer, a 30 Hz tick pulling
/// bands from the audio source while the feed says its source is playing.
/// Reduced motion (Windows setting) drops the tick to 10 Hz and asks for fewer bands.
///
/// Idle (concept-scenes §2.5.2 point 6) is NOT a stopped tick: with no source,
/// a paused source, or a playing source that is momentarily silent, the panel
/// keeps drifting on <c>VisualizationChrome.Ambient</c> at 10 Hz - dim beams on
/// the dark substrate, no beat, never a black screen. The audio capture is
/// released all the same (SetDemand(false)), so an idle wall costs no FFT.
/// </summary>
public sealed class VisualizationHost : Grid, IDisposable
{
    public string Style { get; }
    public string Source { get; }
    public string ArtworkMode { get; private set; }
    public VisualizationFeed Feed { get; private set; } = VisualizationFeed.Idle;

    /// <summary>
    /// concept-scenes §2.5.2 point 2: the SHELL samples the artwork bitmap and
    /// hands the RGBA bytes to CORE (facet, url, base64), which derives the
    /// dominant colours and the tinted palette and pushes them back in the feed.
    /// Set once by MainWindow.WireVisualizations; null = no tint, the pack's
    /// palette stands.
    /// </summary>
    public static Action<string, string, string>? ArtworkSampled;

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    private readonly IVisualizationAudioSource? _audio;
    private IVisualizationRenderer _renderer;   // rebuilt after a COM failure in the draw (2026-09-08)
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _timer;
    private readonly System.Diagnostics.Stopwatch _clock = System.Diagnostics.Stopwatch.StartNew();
    private bool _demand;
    private string? _sampledArtwork;

    /// <summary>Draw past the tile (over neighbours) instead of clipping to it - the household's choice per visualization.</summary>
    public bool Spill { get; }

    /// <summary>B-221: a mirror (the mini player) draws the same visual but leaves the artwork sampling to the stage's own host.</summary>
    private readonly bool _sampleArtwork;

    public VisualizationHost(string style, string source, string artwork, IVisualizationAudioSource? audio, bool spill = false, bool sampleArtwork = true)
    {
        Style = style; Source = source; ArtworkMode = artwork; _audio = audio; Spill = spill; _sampleArtwork = sampleArtwork;
        Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x14, 0x17, 0x1C));
        IsHitTestVisible = false;                                    // a tap on the placement is the tile container's (reveal)
        // Beams reach far past the stage. Contained (the default) clips the host to its own bounds so a renderer
        // never draws over a neighbour on a shared wall; "spill" lets it, on purpose (the maintainer liked the look,
        // 2026-09-05). The window edge still clips either way.
        SizeChanged += (_, e) => Clip = Spill ? null : new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, e.NewSize.Width, e.NewSize.Height) };
        _renderer = VisualizationStyles.Create(style);
        _renderer.Attach(this);
        _timer = DispatcherQueue.CreateTimer();
        _timer.Tick += (_, __) => Tick();
        Loaded += (_, __) => StartTick();                            // the ambient drift runs from the moment the surface has a size
    }

    public void SetFeed(string json)
    {
        Feed = VisualizationFeed.Parse(json);
        ArtworkMode = Feed.ArtworkMode;
        _renderer.Update(Feed);
        var want = Feed.Active;
        if (want != _demand)
        {
            _demand = want;
            _audio?.SetDemand(want);
        }
        StartTick();
        SampleArtwork();
    }

    /// <summary>Live feed at the pack's rate; idle at the ambient rate - the tick never stops while the surface is alive.</summary>
    private void StartTick()
    {
        _timer.Interval = TimeSpan.FromMilliseconds(_demand && !_reducedMotion ? 33 : 100);
        _timer.Start();
    }

    private static bool _reducedMotion => MotionReduced;   // live: the rail toggle takes effect at once

    private int BandCount => _reducedMotion ? 16 : 64;

    /// <summary>
    /// Motion policy for the wall. The system's reduced-motion setting is the
    /// DEFAULT, not the law: a Prism frame is an appliance, and someone who turns
    /// animation effects off on their desktop has not asked the wall in their
    /// kitchen to stop moving. Measured on a real wall 2026-09-04 - with
    /// ClientAreaAnimation=False the renderer ran at 10fps with no beat and
    /// attack/release clamped, so a band feed swinging 0.2..0.96 drew as a flat
    /// line. Device rail: "Full motion".
    /// </summary>
    // Default ON (2026-09-05): twice the wall was "barely moving" because Windows' ClientAreaAnimation was off,
    // which is a performance setting on a PC far more often than an accessibility one. The Device toggle turns
    // it off and is remembered; the environment variable wins over both when set.
    public static bool ForceFullMotion = Environment.GetEnvironmentVariable("PRISM_FULL_MOTION") is { Length: > 0 } fm ? fm == "1" : PrismHost.HostPrefs.GetBool("fullMotion", true);

    /// <summary>True when this wall should damp its motion (system setting, unless overridden).</summary>
    public static bool MotionReduced
    {
        get
        {
            if (ForceFullMotion) return false;
            try { return !new Windows.UI.ViewManagement.UISettings().AnimationsEnabled; } catch { return false; }
        }
    }

    /// <summary>Set by the shell so the band feed can be seen in host.log.</summary>
    public static Action<string>? BandDiagnostic;
    private TimeSpan _lastBandReport;

    private void Tick()
    {
        // A frame must never take the wall down: an exception inside a DispatcherQueueTimer callback ends the process
        // with no managed report (WinUI 3). Caught and logged here instead, once per second at most (2026-09-07).
        try { TickCore(); }
        catch (Exception ex)
        {
            if (_clock.Elapsed - _lastFrameError > TimeSpan.FromSeconds(1)) { _lastFrameError = _clock.Elapsed; BandDiagnostic?.Invoke("render frame failed: " + ex.GetType().Name + ": " + ex.Message + " @ " + string.Join(" | ", (ex.StackTrace ?? "").Split('\n').Select(f => f.Trim()).Where(f => f.Contains("PrismHost")).Take(3))); }
        }
    }
    private TimeSpan _lastFrameError = TimeSpan.Zero;

    private void TickCore()
    {
        var bands = _demand ? _audio?.Bands(BandCount) ?? Array.Empty<float>() : Array.Empty<float>();
        // §2.5.2 point 6: nothing playing - or playing but silent - drifts on the ambient signal instead of going black.
        var live = false;
        foreach (var b in bands) if (b > 0.004f) { live = true; break; }
        if (!live) bands = VisualizationChrome.Ambient(_clock.Elapsed.TotalSeconds, BandCount);

        // Diagnostic: what the renderer is ACTUALLY handed. Every question about
        // "the beams hardly move" has been answered by measuring rather than
        // reasoning, and the answer was never where the guess said it was. Once a
        // second, so it costs nothing.
        if (BandDiagnostic is { } report && _clock.Elapsed - _lastBandReport > TimeSpan.FromSeconds(1))
        {
            _lastBandReport = _clock.Elapsed;
            float lo = 1f, hi = 0f, sum = 0f;
            foreach (var b in bands) { if (b < lo) lo = b; if (b > hi) hi = b; sum += b; }
            report($"bands live={live} n={bands.Length} min={lo:F3} max={hi:F3} avg={(bands.Length > 0 ? sum / bands.Length : 0):F3} demand={_demand}");
        }

        try { _renderer.Render(bands, ActualWidth, ActualHeight); }
        catch (System.Runtime.InteropServices.COMException ex)
        {
            // 2026-09-08: a COM failure inside the draw (E_UNEXPECTED, seen once during a fake break) was followed by the
            // process ending. A renderer is cheap: build a fresh one and let the next frame try; the old one is left behind.
            BandDiagnostic?.Invoke("render: COM failure " + ex.HResult.ToString("X8") + " - renderer rebuilt");
            _renderer = VisualizationStyles.Create(Style);
        }
    }

    /// <summary>Backdrop mode only: sample the art once per track and let CORE derive the palette from it.</summary>
    private void SampleArtwork()
    {
        if (!_sampleArtwork) return;
        if (Feed.ArtworkMode != "backdrop" || !Feed.Active || Feed.Artwork is not { } url) { _sampledArtwork = null; return; }
        if (url == _sampledArtwork || ArtworkSampled is null) return;
        _sampledArtwork = url;
        _ = SampleArtworkAsync(Source, url);
    }

    private static async Task SampleArtworkAsync(string source, string url)
    {
        try
        {
            var bytes = await Http.GetByteArrayAsync(url);
            using var ms = new Windows.Storage.Streams.InMemoryRandomAccessStream();
            await ms.WriteAsync(System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsBuffer(bytes));
            ms.Seek(0);
            var dec = await Windows.Graphics.Imaging.BitmapDecoder.CreateAsync(ms);
            var px = await dec.GetPixelDataAsync(
                Windows.Graphics.Imaging.BitmapPixelFormat.Bgra8, Windows.Graphics.Imaging.BitmapAlphaMode.Premultiplied,
                new Windows.Graphics.Imaging.BitmapTransform { ScaledWidth = 32, ScaledHeight = 32, InterpolationMode = Windows.Graphics.Imaging.BitmapInterpolationMode.Fant },
                Windows.Graphics.Imaging.ExifOrientationMode.IgnoreExifOrientation, Windows.Graphics.Imaging.ColorManagementMode.DoNotColorManage);
            var bgra = px.DetachPixelData();
            for (var i = 0; i + 3 < bgra.Length; i += 4) (bgra[i], bgra[i + 2]) = (bgra[i + 2], bgra[i]);   // BGRA -> RGBA; core reads RGBA
            ArtworkSampled?.Invoke(source, url, Convert.ToBase64String(bgra));
        }
        catch { /* no sample, no tint: the pack's palette stands (§32) */ }
    }

    public void Dispose()
    {
        BandDiagnostic?.Invoke("visualization host disposed: " + Source);
        _timer.Stop();
        if (_demand) _audio?.SetDemand(false);
        _renderer.Detach(this);
    }
}

/// <summary>The host's own minimal style: bars in the brand amber on the dark substrate. Never the product look - a proof the seam renders.</summary>
public sealed class BarsRenderer : IVisualizationRenderer
{
    private readonly List<Microsoft.UI.Xaml.Shapes.Rectangle> _bars = new();
    private Canvas? _canvas;
    private TextBlock? _label;
    private static readonly SolidColorBrush Amber = new(Windows.UI.Color.FromArgb(255, 0xF2, 0xB1, 0x4C));
    private static readonly SolidColorBrush Dim = new(Windows.UI.Color.FromArgb(255, 0x9A, 0x9C, 0xA8));

    public void Attach(Panel host)
    {
        _canvas = new Canvas();
        _label = new TextBlock { Foreground = Dim, FontSize = 12, Margin = new Thickness(10, 8, 10, 0), TextTrimming = TextTrimming.CharacterEllipsis, Text = "" };
        host.Children.Add(_canvas);
        host.Children.Add(_label);
    }

    public void Detach(Panel host)
    {
        if (_canvas is not null) host.Children.Remove(_canvas);
        if (_label is not null) host.Children.Remove(_label);
        _bars.Clear();
    }

    public void Update(VisualizationFeed feed)
    {
        if (_label is null) return;
        _label.Text = feed.Active ? string.Join("  ·  ", new[] { feed.Title, feed.Artist }.Where(s => !string.IsNullOrEmpty(s))) : "";
    }

    public void Render(float[] bands, double width, double height)
    {
        if (_canvas is null || width <= 0 || height <= 0) return;
        while (_bars.Count < bands.Length)
        {
            var r = new Microsoft.UI.Xaml.Shapes.Rectangle { Fill = Amber, RadiusX = 1, RadiusY = 1 };
            _bars.Add(r); _canvas.Children.Add(r);
        }
        var n = bands.Length;
        var gap = 2.0;
        var bw = Math.Max(1, (width - gap * (n + 1)) / n);
        for (var i = 0; i < _bars.Count; i++)
        {
            var bar = _bars[i];
            if (i >= n) { bar.Visibility = Visibility.Collapsed; continue; }
            bar.Visibility = Visibility.Visible;
            var h = Math.Max(1, Math.Min(1, bands[i]) * (height - 28));
            bar.Width = bw; bar.Height = h;
            Canvas.SetLeft(bar, gap + i * (bw + gap));
            Canvas.SetTop(bar, height - h - 4);
        }
    }
}
